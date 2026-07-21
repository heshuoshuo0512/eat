import { createHash, randomUUID } from 'node:crypto';
import { createEmbedding, getAiProviderStatus, isAiProviderEnabled } from './aiProvider.js';
import { loadHealthKnowledgeDocuments } from './healthKnowledgeBase.js';

export const RETRIEVAL_EMBEDDING_DIM = 1536;
export const RETRIEVAL_INDEX_VERSION = '002_retrieval_pgvector';

const DEFAULT_SOURCE_TYPES = ['dish', 'health_knowledge'];
const QUERY_CACHE_TTL_MS = 5 * 60 * 1000;
const QUERY_CACHE_MAX = 256;
const postgresReady = new WeakSet();
const sqliteReady = new WeakSet();
const queryEmbeddingCache = new Map();

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function parseList(value) {
  const parsed = parseJson(value, value);
  if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
  if (parsed == null || parsed === '') return [];
  return String(parsed).split(/[,，、/]/).map((item) => item.trim()).filter(Boolean);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function contentHash(document) {
  return createHash('sha256').update(JSON.stringify(stableValue({
    title: document.title,
    content: document.content,
    searchText: document.searchText,
    metadata: document.metadata,
  }))).digest('hex');
}

function requiredText(value, field) {
  const text = String(value || '').trim();
  if (!text) throw Object.assign(new Error(`${field} is required`), { status: 400 });
  return text;
}

function normalizeTenantId(value) {
  return requiredText(value || 'default', 'tenantId').slice(0, 160);
}

function normalizeSourceTypes(sourceTypes) {
  const values = Array.isArray(sourceTypes) && sourceTypes.length ? sourceTypes : DEFAULT_SOURCE_TYPES;
  return [...new Set(values.map((value) => requiredText(value, 'sourceType').slice(0, 80)))];
}

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function normalizedQuery(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function retrievalDocumentId({ tenantId = 'default', sourceType, sourceId, chunkIndex = 0 }) {
  const tenant = encodeURIComponent(normalizeTenantId(tenantId));
  const type = encodeURIComponent(requiredText(sourceType, 'sourceType'));
  const source = encodeURIComponent(requiredText(sourceId, 'sourceId'));
  const chunk = clampInteger(chunkIndex, 0, Number.MAX_SAFE_INTEGER, 0);
  return `retrieval:${tenant}:${type}:${source}:chunk:${chunk}`;
}

export function validateEmbedding(embedding, expectedDimension = RETRIEVAL_EMBEDDING_DIM) {
  if (!Array.isArray(embedding) || embedding.length !== expectedDimension) {
    const actual = Array.isArray(embedding) ? embedding.length : 0;
    throw Object.assign(new Error(`Embedding dimension mismatch: expected ${expectedDimension}, received ${actual}`), {
      code: 'EMBEDDING_DIMENSION_MISMATCH',
      expectedDimension,
      actualDimension: actual,
    });
  }
  const normalized = embedding.map(Number);
  if (normalized.some((value) => !Number.isFinite(value))) {
    throw Object.assign(new Error('Embedding contains non-finite values'), { code: 'INVALID_EMBEDDING' });
  }
  return normalized;
}

function normalizeDocument(document, fallbackTenantId) {
  const tenantId = normalizeTenantId(document.tenantId || document.metadata?.tenantId || fallbackTenantId);
  const sourceType = requiredText(document.sourceType, 'sourceType');
  const sourceId = requiredText(document.sourceId, 'sourceId');
  const chunkIndex = clampInteger(document.chunkIndex ?? document.metadata?.chunkIndex, 0, Number.MAX_SAFE_INTEGER, 0);
  const title = requiredText(document.title || document.name, 'title');
  const content = requiredText(document.content, 'content');
  const metadata = { ...(document.metadata || {}), tenantId, chunkIndex };
  const searchText = String(document.searchText || `${title} ${content}`).normalize('NFKC').trim();
  const normalized = {
    id: retrievalDocumentId({ tenantId, sourceType, sourceId, chunkIndex }),
    tenantId,
    sourceType,
    sourceId,
    chunkIndex,
    title,
    content,
    searchText,
    metadata,
  };
  return { ...normalized, contentHash: contentHash(normalized) };
}

function rowValue(row, camel, snake = camel) {
  return row?.[camel] ?? row?.[snake];
}

function asBoolean(value) {
  if (typeof value === 'string') return !['', '0', 'false', 'no'].includes(value.toLowerCase());
  return Boolean(value);
}

export function buildDishIndexDocuments(dishes = [], stalls = [], canteens = [], tenantId = 'default') {
  const stallById = new Map(stalls.map((stall) => [rowValue(stall, 'id'), stall]));
  const canteenById = new Map(canteens.map((canteen) => [rowValue(canteen, 'id'), canteen]));

  return dishes.map((dish) => {
    const dishTenantId = normalizeTenantId(rowValue(dish, 'tenantId', 'tenant_id') || tenantId);
    const stallId = rowValue(dish, 'stallId', 'stall_id');
    const joinedStall = stallById.get(stallId) || {};
    const canteenId = rowValue(dish, 'canteenId', 'canteen_id') || rowValue(joinedStall, 'canteenId', 'canteen_id');
    const joinedCanteen = canteenById.get(canteenId) || {};
    const parentCanteenId = rowValue(dish, 'parentCanteenId', 'parent_canteen_id') || rowValue(joinedCanteen, 'parentId', 'parent_id');
    const parentCanteen = canteenById.get(parentCanteenId) || {};
    const ingredients = parseList(rowValue(dish, 'ingredients', 'ingredients_json'));
    const tags = parseList(rowValue(dish, 'tags', 'tags_json'));
    const allergens = parseList(rowValue(dish, 'allergens', 'allergens_json'));
    const mealTypes = parseList(rowValue(dish, 'mealTypes', 'meal_types_json'));
    const nutrition = rowValue(dish, 'nutrition') || {};
    const name = requiredText(rowValue(dish, 'name'), 'dish.name');
    const stallName = rowValue(dish, 'stallName', 'stall_name') || rowValue(joinedStall, 'name') || '';
    const canteenName = rowValue(dish, 'canteenName', 'canteen_name') || rowValue(joinedCanteen, 'name') || '';
    const parentCanteenName = rowValue(dish, 'parentCanteenName', 'parent_canteen_name') || rowValue(parentCanteen, 'name') || '';
    const price = Number(rowValue(dish, 'price') || 0);
    const details = [
      `菜品：${name}`,
      `菜系：${rowValue(dish, 'cuisine') || '未分类'}`,
      `口味：${rowValue(dish, 'taste') || '未标注'}`,
      `食材：${ingredients.join('、') || '未标注'}`,
      `过敏原：${allergens.join('、') || '无已知标注'}`,
      `标签：${tags.join('、') || '无'}`,
      `餐次：${mealTypes.join('、') || '未标注'}`,
      `位置：${[parentCanteenName, canteenName, stallName].filter(Boolean).join(' > ') || '未标注'}`,
      `价格：${price} 元`,
      `营养：${Number(nutrition.calories ?? rowValue(dish, 'calories') ?? 0)} kcal，蛋白质 ${Number(nutrition.protein ?? rowValue(dish, 'protein') ?? 0)}g，脂肪 ${Number(nutrition.fat ?? rowValue(dish, 'fat') ?? 0)}g，碳水 ${Number(nutrition.carbs ?? rowValue(dish, 'carbs') ?? 0)}g`,
      `描述：${rowValue(dish, 'description') || ''}`,
    ];
    return {
      tenantId: dishTenantId,
      sourceType: 'dish',
      sourceId: requiredText(rowValue(dish, 'id'), 'dish.id'),
      chunkIndex: 0,
      title: name,
      content: details.join('。'),
      searchText: [name, rowValue(dish, 'cuisine'), rowValue(dish, 'taste'), ...ingredients, ...allergens, ...tags, stallName, canteenName, parentCanteenName, rowValue(dish, 'description')].filter(Boolean).join(' '),
      metadata: {
        tenantId: dishTenantId,
        dishId: rowValue(dish, 'id'),
        stallId,
        stallName,
        canteenId,
        canteenName,
        parentCanteenId: parentCanteenId || null,
        parentCanteenName: parentCanteenName || null,
        price,
        halal: asBoolean(rowValue(dish, 'halal')),
        ingredients,
        allergens,
        tags,
        mealTypes,
      },
    };
  });
}

export function buildHealthIndexDocuments(documents = [], tenantId = 'default') {
  return documents.map((document) => ({
    ...document,
    tenantId,
    metadata: { ...(document.metadata || {}), tenantId },
  }));
}

async function ensureSqliteRetrievalSchema(db) {
  if (sqliteReady.has(db)) return;
  for (const definition of [
    "chunk_index INTEGER NOT NULL DEFAULT 0",
    "search_text TEXT NOT NULL DEFAULT ''",
    "embedding_model TEXT",
    "content_hash TEXT NOT NULL DEFAULT ''",
    "indexed_at TEXT",
  ]) {
    try { await db.exec(`ALTER TABLE rag_documents ADD COLUMN ${definition}`); } catch {}
  }
  try {
    const legacyChunks = await db.prepare("SELECT id FROM rag_documents WHERE id LIKE '%:chunk:%'").all();
    for (const row of legacyChunks) {
      const match = String(row.id).match(/:chunk:(\d+)$/);
      if (match) await db.prepare('UPDATE rag_documents SET chunk_index = ? WHERE id = ?').run(Number(match[1]), row.id);
    }
  } catch {}
  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rag_documents_tenant_source_chunk
      ON rag_documents(tenant_id, source_type, source_id, chunk_index);
    CREATE INDEX IF NOT EXISTS idx_rag_documents_tenant_type
      ON rag_documents(tenant_id, source_type, indexed_at);
    CREATE TABLE IF NOT EXISTS retrieval_index_runs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      status TEXT NOT NULL,
      document_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      embedding_model TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_retrieval_index_runs_tenant_started
      ON retrieval_index_runs(tenant_id, started_at DESC);
  `);
  sqliteReady.add(db);
}

async function postgresReadiness(db) {
  const result = await db.pool.query(`
    SELECT
      EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS has_vector,
      EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS has_trgm,
      (
        SELECT format_type(attribute.atttypid, attribute.atttypmod)
        FROM pg_attribute attribute
        WHERE attribute.attrelid = 'rag_documents'::regclass
          AND attribute.attname = 'embedding'
          AND NOT attribute.attisdropped
      ) AS embedding_type,
      EXISTS(
        SELECT 1 FROM pg_indexes
        WHERE schemaname = current_schema() AND indexname = 'idx_rag_documents_embedding_hnsw'
      ) AS has_hnsw,
      EXISTS(
        SELECT 1 FROM pg_indexes
        WHERE schemaname = current_schema() AND indexname = 'idx_rag_documents_search_trgm'
      ) AS has_trigram_index
  `);
  return result.rows[0] || {};
}

export async function ensureRetrievalIndex(db) {
  if (!db) throw new Error('Database connection is required');
  if (!db.pool) {
    await ensureSqliteRetrievalSchema(db);
    return { driver: 'sqlite', ready: true, mode: 'lexical_fallback' };
  }
  if (postgresReady.has(db.pool)) return { driver: 'postgres', ready: true, mode: 'hybrid' };
  const status = await postgresReadiness(db);
  if (!status.has_vector || !status.has_trgm || status.embedding_type !== `vector(${RETRIEVAL_EMBEDDING_DIM})` || !status.has_hnsw || !status.has_trigram_index) {
    throw Object.assign(new Error('PostgreSQL retrieval schema is not ready; run migration 008_retrieval_pgvector'), {
      code: 'RETRIEVAL_SCHEMA_NOT_READY',
      details: status,
    });
  }
  postgresReady.add(db.pool);
  return { driver: 'postgres', ready: true, mode: 'hybrid' };
}

function embeddingProviderFrom(options = {}) {
  if (Object.hasOwn(options, 'embeddingProvider') && options.embeddingProvider !== undefined) return options.embeddingProvider;
  return isAiProviderEnabled() ? createEmbedding : null;
}

function embeddingConfigurationFrom(options = {}) {
  const embeddingProvider = embeddingProviderFrom(options);
  const configuredModel = String(getAiProviderStatus().embeddingModel || 'text-embedding-3-small').trim();
  const hasCustomProvider = Object.hasOwn(options, 'embeddingProvider')
    && embeddingProvider
    && embeddingProvider !== createEmbedding;
  const customModel = String(options.embeddingModel || embeddingProvider?.embeddingModel || '').trim();
  return {
    embeddingProvider,
    embeddingModel: hasCustomProvider ? (customModel || 'custom-embedding-1536') : configuredModel,
  };
}

function embeddingModelFrom(options = {}) {
  return embeddingConfigurationFrom(options).embeddingModel;
}

async function existingDocument(db, document) {
  if (db.pool) {
    const result = await db.pool.query(
      `SELECT id, content_hash, embedding_model, embedding IS NOT NULL AS has_embedding
       FROM rag_documents
       WHERE tenant_id = $1 AND source_type = $2 AND source_id = $3 AND chunk_index = $4`,
      [document.tenantId, document.sourceType, document.sourceId, document.chunkIndex],
    );
    return result.rows[0] || null;
  }
  const row = await db.prepare(
    `SELECT id, content_hash, embedding_model, embedding_json
     FROM rag_documents
     WHERE tenant_id = ? AND source_type = ? AND source_id = ? AND chunk_index = ?`,
  ).get(document.tenantId, document.sourceType, document.sourceId, document.chunkIndex);
  return row ? { ...row, has_embedding: Boolean(row.embedding_json) } : null;
}

async function upsertPostgresDocument(db, document, embedding, embeddingModel, indexedAt) {
  await db.pool.query(
    `INSERT INTO rag_documents (
       id, tenant_id, source_type, source_id, chunk_index, title, content,
       search_text, metadata_json, metadata, embedding_json, embedding,
       embedding_model, content_hash, indexed_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10::jsonb, $11, $12::vector,
       $13, $14, $15, $16
     )
     ON CONFLICT (tenant_id, source_type, source_id, chunk_index) DO UPDATE SET
       id = EXCLUDED.id,
       title = EXCLUDED.title,
       content = EXCLUDED.content,
       search_text = EXCLUDED.search_text,
       metadata_json = EXCLUDED.metadata_json,
       metadata = EXCLUDED.metadata,
       embedding_json = EXCLUDED.embedding_json,
       embedding = CASE
         WHEN EXCLUDED.embedding IS NOT NULL THEN EXCLUDED.embedding
         WHEN rag_documents.content_hash = EXCLUDED.content_hash THEN rag_documents.embedding
         ELSE NULL
       END,
       embedding_model = CASE
         WHEN EXCLUDED.embedding IS NOT NULL THEN EXCLUDED.embedding_model
         WHEN rag_documents.content_hash = EXCLUDED.content_hash THEN rag_documents.embedding_model
         ELSE NULL
       END,
       content_hash = EXCLUDED.content_hash,
       indexed_at = EXCLUDED.indexed_at,
       updated_at = EXCLUDED.updated_at`,
    [
      document.id, document.tenantId, document.sourceType, document.sourceId, document.chunkIndex,
      document.title, document.content, document.searchText, JSON.stringify(document.metadata),
      JSON.stringify(document.metadata), embedding ? JSON.stringify(embedding) : null,
      embedding ? JSON.stringify(embedding) : null, embedding ? embeddingModel : null,
      document.contentHash, indexedAt, indexedAt,
    ],
  );
}

async function upsertSqliteDocument(db, document, embedding, embeddingModel, indexedAt) {
  await db.prepare(
    `INSERT INTO rag_documents (
       id, tenant_id, source_type, source_id, chunk_index, title, content,
       search_text, metadata_json, embedding_json, embedding_model, content_hash, indexed_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, source_type, source_id, chunk_index) DO UPDATE SET
       id = excluded.id,
       title = excluded.title,
       content = excluded.content,
       search_text = excluded.search_text,
       metadata_json = excluded.metadata_json,
       embedding_json = CASE
         WHEN excluded.embedding_json IS NOT NULL THEN excluded.embedding_json
         WHEN rag_documents.content_hash = excluded.content_hash THEN rag_documents.embedding_json
         ELSE NULL
       END,
       embedding_model = CASE
         WHEN excluded.embedding_json IS NOT NULL THEN excluded.embedding_model
         WHEN rag_documents.content_hash = excluded.content_hash THEN rag_documents.embedding_model
         ELSE NULL
       END,
       content_hash = excluded.content_hash,
       indexed_at = excluded.indexed_at,
       updated_at = excluded.updated_at`,
  ).run(
    document.id, document.tenantId, document.sourceType, document.sourceId, document.chunkIndex,
    document.title, document.content, document.searchText, JSON.stringify(document.metadata),
    embedding ? JSON.stringify(embedding) : null, embedding ? embeddingModel : null,
    document.contentHash, indexedAt, indexedAt,
  );
}

export async function upsertRetrievalDocuments(db, documents, options = {}) {
  await ensureRetrievalIndex(db);
  const tenantId = normalizeTenantId(options.tenantId || 'default');
  const normalizedDocuments = documents.map((document) => normalizeDocument(document, tenantId));
  const { embeddingProvider, embeddingModel } = embeddingConfigurationFrom(options);
  const failures = [];
  let indexedCount = 0;
  let skippedCount = 0;
  let embeddedCount = 0;

  for (const document of normalizedDocuments) {
    const existing = await existingDocument(db, document);
    const unchanged = existing?.content_hash === document.contentHash;
    const hasCurrentEmbedding = unchanged && existing?.has_embedding && existing?.embedding_model === embeddingModel;
    if (unchanged && (!embeddingProvider || hasCurrentEmbedding) && existing.id === document.id) {
      skippedCount += 1;
      continue;
    }

    let embedding = null;
    if (embeddingProvider && !hasCurrentEmbedding) {
      try {
        embedding = validateEmbedding(await embeddingProvider(`${document.title}\n${document.content}`));
        embeddedCount += 1;
      } catch (error) {
        failures.push({ id: document.id, sourceType: document.sourceType, sourceId: document.sourceId, error: error.message, code: error.code || 'EMBEDDING_FAILED' });
      }
    }
    const indexedAt = new Date().toISOString();
    if (db.pool) await upsertPostgresDocument(db, document, embedding, embeddingModel, indexedAt);
    else await upsertSqliteDocument(db, document, embedding, embeddingModel, indexedAt);
    indexedCount += 1;
  }

  return {
    documentCount: normalizedDocuments.length,
    indexedCount,
    skippedCount,
    embeddedCount,
    failureCount: failures.length,
    failures,
    documents: normalizedDocuments,
    embeddingModel,
  };
}

function mapSearchRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    chunkIndex: Number(row.chunk_index || 0),
    title: row.title,
    name: row.title,
    content: row.content,
    snippet: String(row.content || '').slice(0, 220),
    metadata: parseJson(row.metadata, parseJson(row.metadata_json, {})),
    lexicalScore: Number(row.lexical_score || 0),
    vectorScore: Number(row.vector_score || 0),
    exactMatch: Boolean(row.exact_match),
  };
}

function tokenize(value) {
  const text = normalizedQuery(value);
  const words = text.match(/[a-z0-9]+|[\u4e00-\u9fff]{1,4}/g) || [];
  const chars = [...text].filter((character) => /[\u4e00-\u9fff]/.test(character));
  return [...new Set([...words, ...chars])];
}

async function postgresLexicalSearch(db, query, tenantId, sourceTypes, limit) {
  const result = await db.pool.query(
    `SELECT id, tenant_id, source_type, source_id, chunk_index, title, content,
            metadata_json, metadata,
            GREATEST(
              similarity(search_text, $2),
              CASE WHEN lower(title) = lower($2) THEN 1 ELSE 0 END,
              CASE WHEN strpos(lower(title), lower($2)) > 0 THEN 0.9 ELSE 0 END,
              CASE WHEN strpos(lower(search_text), lower($2)) > 0 THEN 0.75 ELSE 0 END
            ) AS lexical_score,
            lower(title) = lower($2) AS exact_match
     FROM rag_documents
     WHERE tenant_id = $1
       AND source_type = ANY($3::text[])
       AND (search_text % $2 OR strpos(lower(search_text), lower($2)) > 0)
     ORDER BY lexical_score DESC, indexed_at DESC NULLS LAST
     LIMIT $4`,
    [tenantId, query, sourceTypes, limit],
  );
  return result.rows.map(mapSearchRow);
}

async function postgresVectorSearch(db, embedding, embeddingModel, tenantId, sourceTypes, limit, minimumSimilarity) {
  const result = await db.pool.query(
    `SELECT id, tenant_id, source_type, source_id, chunk_index, title, content,
            metadata_json, metadata,
            1 - (embedding <=> $2::vector) AS vector_score
     FROM rag_documents
     WHERE tenant_id = $1
       AND source_type = ANY($3::text[])
       AND embedding IS NOT NULL
       AND embedding_model = $6
       AND 1 - (embedding <=> $2::vector) >= $5
     ORDER BY embedding <=> $2::vector
     LIMIT $4`,
    [tenantId, JSON.stringify(embedding), sourceTypes, limit, minimumSimilarity, embeddingModel],
  );
  return result.rows.map(mapSearchRow);
}

async function postgresVectorDocumentStats(db, tenantId, sourceTypes, embeddingModel) {
  const result = await db.pool.query(
    `SELECT COUNT(*) AS candidate_count,
            COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded_count,
            COUNT(*) FILTER (
              WHERE embedding IS NOT NULL AND embedding_model = $3
            ) AS compatible_count,
            COUNT(*) FILTER (
              WHERE embedding IS NOT NULL AND embedding_model IS DISTINCT FROM $3
            ) AS model_mismatch_count
     FROM rag_documents
     WHERE tenant_id = $1 AND source_type = ANY($2::text[])`,
    [tenantId, sourceTypes, embeddingModel],
  );
  const row = result.rows[0] || {};
  return {
    candidateCount: Number(row.candidate_count || 0),
    embeddedCount: Number(row.embedded_count || 0),
    compatibleCount: Number(row.compatible_count || 0),
    modelMismatchCount: Number(row.model_mismatch_count || 0),
    invalidDimensionCount: 0,
    invalidEmbeddingCount: 0,
  };
}

async function sqliteCandidateRows(db, tenantId, sourceTypes) {
  const rows = await db.prepare('SELECT * FROM rag_documents WHERE tenant_id = ?').all(tenantId);
  const allowed = new Set(sourceTypes);
  return rows.filter((row) => allowed.has(row.source_type));
}

function dotSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm) || 1);
}

function sqliteLexicalSearch(rows, query, limit) {
  const terms = tokenize(query);
  const normalized = normalizedQuery(query);
  return rows.map((row) => {
    const title = normalizedQuery(row.title);
    const haystack = normalizedQuery(row.search_text || `${row.title} ${row.content}`);
    const termScore = terms.reduce((sum, term) => sum + (haystack.includes(term) ? (term.length > 1 ? 2 : 1) : 0), 0);
    const exactMatch = title === normalized;
    const lexicalScore = termScore + (exactMatch ? 12 : title.includes(normalized) ? 8 : haystack.includes(normalized) ? 4 : 0);
    return mapSearchRow({ ...row, lexical_score: lexicalScore, exact_match: exactMatch });
  }).filter((row) => row.lexicalScore > 0)
    .sort((left, right) => right.lexicalScore - left.lexicalScore || left.title.localeCompare(right.title, 'zh-CN'))
    .slice(0, limit);
}

function inspectSqliteVectorRows(rows, embeddingModel) {
  const compatibleRows = [];
  const stats = {
    candidateCount: rows.length,
    embeddedCount: 0,
    compatibleCount: 0,
    modelMismatchCount: 0,
    invalidDimensionCount: 0,
    invalidEmbeddingCount: 0,
  };
  for (const row of rows) {
    if (row.embedding_json == null || row.embedding_json === '') continue;
    stats.embeddedCount += 1;
    if (String(row.embedding_model || '') !== embeddingModel) {
      stats.modelMismatchCount += 1;
      continue;
    }
    try {
      const storedEmbedding = validateEmbedding(parseJson(row.embedding_json, []));
      compatibleRows.push({ ...row, retrieval_embedding: storedEmbedding });
      stats.compatibleCount += 1;
    } catch (error) {
      if (error.code === 'EMBEDDING_DIMENSION_MISMATCH') stats.invalidDimensionCount += 1;
      else stats.invalidEmbeddingCount += 1;
    }
  }
  return { compatibleRows, stats };
}

function sqliteVectorSearch(rows, embedding, limit, minimumSimilarity) {
  return rows.map((row) => {
    return mapSearchRow({ ...row, vector_score: dotSimilarity(embedding, row.retrieval_embedding) });
  }).filter((row) => row.vectorScore >= minimumSimilarity)
    .sort((left, right) => right.vectorScore - left.vectorScore)
    .slice(0, limit);
}

function vectorIndexWarnings(stats, embeddingModel) {
  if (!stats) return [];
  const warnings = [];
  const partialFallback = stats.compatibleCount > 0 ? 'lexical_for_affected_documents' : 'lexical';
  if (stats.modelMismatchCount > 0) {
    warnings.push({
      code: 'EMBEDDING_MODEL_MISMATCH',
      message: `${stats.modelMismatchCount} indexed embedding(s) do not use ${embeddingModel}`,
      fallback: partialFallback,
      details: { embeddingModel, affectedDocumentCount: stats.modelMismatchCount },
    });
  }
  if (stats.invalidDimensionCount > 0) {
    warnings.push({
      code: 'STORED_EMBEDDING_DIMENSION_MISMATCH',
      message: `${stats.invalidDimensionCount} indexed embedding(s) do not have ${RETRIEVAL_EMBEDDING_DIM} dimensions`,
      fallback: partialFallback,
      details: { expectedDimension: RETRIEVAL_EMBEDDING_DIM, affectedDocumentCount: stats.invalidDimensionCount },
    });
  }
  if (stats.invalidEmbeddingCount > 0) {
    warnings.push({
      code: 'STORED_EMBEDDING_INVALID',
      message: `${stats.invalidEmbeddingCount} indexed embedding(s) contain invalid values`,
      fallback: partialFallback,
      details: { affectedDocumentCount: stats.invalidEmbeddingCount },
    });
  }
  if (stats.embeddedCount === 0 && stats.candidateCount > 0) {
    warnings.push({
      code: 'INDEX_EMBEDDINGS_UNAVAILABLE',
      message: 'No indexed documents have embeddings for vector retrieval',
      fallback: 'lexical',
    });
  }
  return warnings;
}

function fuseResults(lexicalResults, vectorResults, query, limit, rrfK = 60) {
  const fused = new Map();
  const add = (item, rank, source) => {
    const current = fused.get(item.id) || { ...item, score: 0, matchSources: [] };
    current.score += 1 / (rrfK + rank + 1);
    if (item.exactMatch) current.score += 0.05;
    current.matchSources = [...new Set([...current.matchSources, source])];
    current.lexicalScore = Math.max(current.lexicalScore || 0, item.lexicalScore || 0);
    current.vectorScore = Math.max(current.vectorScore || 0, item.vectorScore || 0);
    fused.set(item.id, current);
  };
  lexicalResults.forEach((item, rank) => add(item, rank, 'lexical'));
  vectorResults.forEach((item, rank) => add(item, rank, 'vector'));
  const normalized = normalizedQuery(query);
  return [...fused.values()].map((item) => ({
    ...item,
    matchReasons: [
      ...(normalizedQuery(item.title) === normalized ? ['name_exact'] : []),
      ...(item.matchSources.includes('lexical') ? ['lexical'] : []),
      ...(item.matchSources.includes('vector') ? ['semantic'] : []),
    ],
  })).sort((left, right) => right.score - left.score || right.lexicalScore - left.lexicalScore)
    .slice(0, limit);
}

async function queryEmbedding(query, provider, model) {
  if (!provider) return null;
  const key = `${model}\n${normalizedQuery(query)}`;
  const cached = queryEmbeddingCache.get(key);
  if (cached && Date.now() - cached.createdAt < QUERY_CACHE_TTL_MS) return cached.embedding;
  const embedding = validateEmbedding(await provider(query));
  if (queryEmbeddingCache.size >= QUERY_CACHE_MAX) queryEmbeddingCache.delete(queryEmbeddingCache.keys().next().value);
  queryEmbeddingCache.set(key, { embedding, createdAt: Date.now() });
  return embedding;
}

export function clearRetrievalEmbeddingCache() {
  queryEmbeddingCache.clear();
}

export async function searchRetrievalIndex(db, query, options = {}) {
  await ensureRetrievalIndex(db);
  const normalized = requiredText(query, 'query').normalize('NFKC').trim();
  const tenantId = normalizeTenantId(options.tenantId || 'default');
  const sourceTypes = normalizeSourceTypes(options.sourceTypes);
  const limit = clampInteger(options.limit, 1, 50, 8);
  const candidateLimit = Math.min(100, Math.max(limit * 3, 12));
  const { embeddingProvider, embeddingModel } = embeddingConfigurationFrom(options);
  const warnings = [];
  let embedding = null;
  if (embeddingProvider) {
    try {
      embedding = await queryEmbedding(normalized, embeddingProvider, embeddingModel);
    } catch (error) {
      warnings.push({ code: error.code || 'EMBEDDING_UNAVAILABLE', message: error.message, fallback: 'lexical' });
    }
  } else {
    warnings.push({ code: 'EMBEDDING_UNAVAILABLE', message: 'Embedding provider is not configured', fallback: 'lexical' });
  }

  let lexicalResults;
  let vectorResults = [];
  let vectorStats = null;
  if (db.pool) {
    const searches = [postgresLexicalSearch(db, normalized, tenantId, sourceTypes, candidateLimit)];
    if (embedding) {
      searches.push(postgresVectorDocumentStats(db, tenantId, sourceTypes, embeddingModel));
      searches.push(postgresVectorSearch(db, embedding, embeddingModel, tenantId, sourceTypes, candidateLimit, Number(options.minimumSimilarity ?? 0.1)));
    }
    const results = await Promise.all(searches);
    [lexicalResults] = results;
    vectorStats = results[1] || null;
    vectorResults = results[2] || [];
  } else {
    const rows = await sqliteCandidateRows(db, tenantId, sourceTypes);
    lexicalResults = sqliteLexicalSearch(rows, normalized, candidateLimit);
    if (embedding) {
      const inspected = inspectSqliteVectorRows(rows, embeddingModel);
      vectorStats = inspected.stats;
      vectorResults = sqliteVectorSearch(inspected.compatibleRows, embedding, candidateLimit, Number(options.minimumSimilarity ?? 0.1));
    }
  }

  warnings.push(...vectorIndexWarnings(vectorStats, embeddingModel));
  const vectorEnabled = Boolean(embedding && vectorStats?.compatibleCount > 0);

  const items = fuseResults(lexicalResults, vectorResults, normalized, limit, clampInteger(options.rrfK, 1, 1000, 60));
  return {
    items,
    warnings,
    meta: {
      tenantId,
      sourceTypes,
      driver: db.pool ? 'postgres' : 'sqlite',
      retrievalModes: ['lexical', ...(vectorEnabled ? ['vector'] : [])],
      degraded: warnings.length > 0,
      degradationReasons: [...new Set(warnings.map((warning) => warning.code))],
      embeddingModel,
      embeddingDimension: RETRIEVAL_EMBEDDING_DIM,
      vectorDocumentCount: vectorStats?.compatibleCount ?? null,
      embeddingModelMismatchCount: vectorStats?.modelMismatchCount ?? null,
      invalidEmbeddingDimensionCount: vectorStats?.invalidDimensionCount ?? null,
      invalidEmbeddingCount: vectorStats?.invalidEmbeddingCount ?? null,
      indexVersion: RETRIEVAL_INDEX_VERSION,
    },
  };
}

export async function deleteRetrievalSource(db, { tenantId = 'default', sourceType, sourceId }) {
  await ensureRetrievalIndex(db);
  const tenant = normalizeTenantId(tenantId);
  const type = requiredText(sourceType, 'sourceType');
  const source = requiredText(sourceId, 'sourceId');
  if (db.pool) {
    const result = await db.pool.query(
      'DELETE FROM rag_documents WHERE tenant_id = $1 AND source_type = $2 AND source_id = $3',
      [tenant, type, source],
    );
    return { deletedCount: result.rowCount || 0 };
  }
  const result = await db.prepare('DELETE FROM rag_documents WHERE tenant_id = ? AND source_type = ? AND source_id = ?')
    .run(tenant, type, source);
  return { deletedCount: result.changes || 0 };
}

async function loadDishRows(db, tenantId, dishId = null) {
  const params = [tenantId];
  let dishFilter = '';
  if (dishId) {
    dishFilter = ' AND d.id = ?';
    params.push(dishId);
  }
  return db.prepare(
    `SELECT d.*,
            s.name AS stall_name, s.canteen_id AS canteen_id,
            c.name AS canteen_name, c.parent_id AS parent_canteen_id,
            parent.name AS parent_canteen_name
     FROM dishes d
     JOIN stalls s ON s.id = d.stall_id AND s.tenant_id = d.tenant_id
     JOIN canteens c ON c.id = s.canteen_id AND c.tenant_id = d.tenant_id
     LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = d.tenant_id
     WHERE d.tenant_id = ? AND d.status = 'active'${dishFilter}`,
  ).all(...params);
}

export async function syncDishRetrievalDocument(db, { tenantId = 'default', dishId, embeddingProvider, embeddingModel } = {}) {
  const tenant = normalizeTenantId(tenantId);
  const sourceId = requiredText(dishId, 'dishId');
  await ensureRetrievalIndex(db);
  const rows = await loadDishRows(db, tenant, sourceId);
  if (!rows.length) return deleteRetrievalSource(db, { tenantId: tenant, sourceType: 'dish', sourceId });
  return upsertRetrievalDocuments(db, buildDishIndexDocuments(rows, [], [], tenant), { tenantId: tenant, embeddingProvider, embeddingModel });
}

async function startIndexRun(db, tenantId, embeddingModel) {
  const runId = `retrieval-run-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  await db.prepare(
    `INSERT INTO retrieval_index_runs (id, tenant_id, status, embedding_model, started_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(runId, tenantId, 'running', embeddingModel, startedAt);
  return runId;
}

async function finishIndexRun(db, runId, status, documentCount, failureCount, error = null) {
  await db.prepare(
    `UPDATE retrieval_index_runs
     SET status = ?, document_count = ?, failure_count = ?, error = ?, completed_at = ?
     WHERE id = ?`,
  ).run(status, documentCount, failureCount, error, new Date().toISOString(), runId);
}

async function pruneDocuments(db, tenantId, sourceType, keepIds) {
  if (db.pool) {
    if (!keepIds.length) {
      const result = await db.pool.query('DELETE FROM rag_documents WHERE tenant_id = $1 AND source_type = $2', [tenantId, sourceType]);
      return result.rowCount || 0;
    }
    const result = await db.pool.query(
      'DELETE FROM rag_documents WHERE tenant_id = $1 AND source_type = $2 AND NOT (id = ANY($3::text[]))',
      [tenantId, sourceType, keepIds],
    );
    return result.rowCount || 0;
  }
  const rows = await db.prepare('SELECT id FROM rag_documents WHERE tenant_id = ? AND source_type = ?').all(tenantId, sourceType);
  const keep = new Set(keepIds);
  let deletedCount = 0;
  for (const row of rows) {
    if (!keep.has(row.id)) deletedCount += (await db.prepare('DELETE FROM rag_documents WHERE id = ?').run(row.id)).changes || 0;
  }
  return deletedCount;
}

export async function reindexRetrieval(db, options = {}) {
  await ensureRetrievalIndex(db);
  const tenantId = normalizeTenantId(options.tenantId || 'default');
  const sourceTypes = normalizeSourceTypes(options.sourceTypes);
  const embeddingModel = embeddingModelFrom(options);
  const runId = await startIndexRun(db, tenantId, embeddingModel);
  let documentCount = 0;
  let failureCount = 0;
  try {
    const documents = [];
    if (sourceTypes.includes('dish')) {
      const dishDocuments = options.dishes !== undefined
        ? buildDishIndexDocuments(options.dishes, options.stalls || [], options.canteens || [], tenantId)
        : buildDishIndexDocuments(await loadDishRows(db, tenantId), [], [], tenantId);
      documents.push(...dishDocuments);
    }
    if (sourceTypes.includes('health_knowledge')) {
      const healthDocuments = options.healthDocuments !== undefined
        ? options.healthDocuments
        : loadHealthKnowledgeDocuments({
            root: options.healthRoot,
            chunkSize: options.healthChunkSize,
            chunkOverlap: options.healthChunkOverlap,
          });
      documents.push(...buildHealthIndexDocuments(healthDocuments, tenantId));
    }

    const result = await upsertRetrievalDocuments(db, documents, { ...options, tenantId, embeddingModel });
    documentCount = result.documentCount;
    failureCount = result.failureCount;
    let prunedCount = 0;
    if (options.prune !== false) {
      for (const sourceType of sourceTypes) {
        const keepIds = result.documents.filter((document) => document.sourceType === sourceType).map((document) => document.id);
        prunedCount += await pruneDocuments(db, tenantId, sourceType, keepIds);
      }
    }
    await finishIndexRun(db, runId, 'completed', documentCount, failureCount);
    return { runId, tenantId, sourceTypes, prunedCount, ...result };
  } catch (error) {
    await finishIndexRun(db, runId, 'failed', documentCount, Math.max(1, failureCount), error.message).catch(() => {});
    throw error;
  }
}

export async function getRetrievalIndexStatus(db, { tenantId = 'default' } = {}) {
  const tenant = normalizeTenantId(tenantId);
  if (db.pool) {
    let readiness;
    try { readiness = await postgresReadiness(db); } catch (error) { readiness = { error: error.message }; }
    if (!readiness.has_vector || !readiness.has_trgm || readiness.embedding_type !== `vector(${RETRIEVAL_EMBEDDING_DIM})` || !readiness.has_hnsw || !readiness.has_trigram_index) {
      return { tenantId: tenant, driver: 'postgres', ready: false, indexVersion: RETRIEVAL_INDEX_VERSION, details: readiness };
    }
  } else {
    await ensureSqliteRetrievalSchema(db);
  }

  const embeddingPresence = db.pool ? 'embedding IS NOT NULL' : 'embedding_json IS NOT NULL';
  const counts = await db.prepare(
    `SELECT source_type, COUNT(*) AS document_count,
            SUM(CASE WHEN ${embeddingPresence} THEN 1 ELSE 0 END) AS embedded_count,
            MAX(indexed_at) AS last_indexed_at
     FROM rag_documents WHERE tenant_id = ? GROUP BY source_type ORDER BY source_type`,
  ).all(tenant);
  const latestRun = await db.prepare(
    `SELECT * FROM retrieval_index_runs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT 1`,
  ).get(tenant);
  return {
    tenantId: tenant,
    driver: db.pool ? 'postgres' : 'sqlite',
    ready: true,
    mode: db.pool ? 'hybrid' : 'lexical_fallback',
    indexVersion: RETRIEVAL_INDEX_VERSION,
    embeddingDimension: RETRIEVAL_EMBEDDING_DIM,
    documentCount: counts.reduce((sum, row) => sum + Number(row.document_count || 0), 0),
    embeddedCount: counts.reduce((sum, row) => sum + Number(row.embedded_count || 0), 0),
    sourceCounts: counts.map((row) => ({
      sourceType: row.source_type,
      documentCount: Number(row.document_count || 0),
      embeddedCount: Number(row.embedded_count || 0),
      lastIndexedAt: row.last_indexed_at || null,
    })),
    lastIndexedAt: counts.map((row) => row.last_indexed_at).filter(Boolean).sort().at(-1) || null,
    failureCount: Number(latestRun?.failure_count || 0),
    latestRun: latestRun ? {
      id: latestRun.id,
      status: latestRun.status,
      documentCount: Number(latestRun.document_count || 0),
      failureCount: Number(latestRun.failure_count || 0),
      embeddingModel: latestRun.embedding_model || null,
      error: latestRun.error || null,
      startedAt: latestRun.started_at,
      completedAt: latestRun.completed_at || null,
    } : null,
  };
}

export async function listRetrievalTenantIds(db) {
  try {
    const rows = await db.prepare("SELECT id FROM tenants WHERE status = 'active' ORDER BY id").all();
    return rows.length ? rows.map((row) => row.id) : ['default'];
  } catch {
    return ['default'];
  }
}
