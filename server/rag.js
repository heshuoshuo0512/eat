import { buildMealPlan, normalizeProfile } from '../src/domain/recommendation.js';
import { createEmbedding, generateGroundedMealAnswer, isAiProviderEnabled } from './aiProvider.js';

/* ── tokeniser (shared by lexical + embedding paths) ─────────────── */

function tokenize(input) {
  const text = String(input || '').toLowerCase();
  const words = text.match(/[a-z0-9]+|[\u4e00-\u9fa5]{1,4}/g) || [];
  const chars = [...text].filter((char) => /[\u4e00-\u9fa5]/.test(char));
  return [...new Set([...words, ...chars].filter((item) => item.trim().length > 0))];
}

/* ── document builder (unchanged) ────────────────────────────────── */

export function buildDishDocuments(dishes, stalls = [], canteens = []) {
  return dishes.map((dish) => {
    const stall = stalls.find((item) => item.id === dish.stallId);
    const canteen = canteens.find((item) => item.id === stall?.canteenId);
    const nutrition = dish.nutrition || {};
    return {
      id: `dish:${dish.id}`,
      sourceType: 'dish',
      sourceId: dish.id,
      title: dish.name,
      name: dish.name,
      content: `${dish.name}，${dish.cuisine}，${dish.taste}，${dish.description || ''}。食材：${dish.ingredients.join('、')}。标签：${dish.tags.join('、')}。营养：${nutrition.calories} kcal，蛋白 ${nutrition.protein}g，脂肪 ${nutrition.fat}g，碳水 ${nutrition.carbs}g。地点：${canteen?.name || ''} ${stall?.name || ''}。价格 ${dish.price} 元。`,
      metadata: { dishId: dish.id, stallId: dish.stallId, canteenId: canteen?.id, price: dish.price, halal: dish.halal }
    };
  });
}

/* ── lexical search (unchanged) ──────────────────────────────────── */

export function searchDocuments(query, documents, limit = 8) {
  const terms = tokenize(query);
  if (!terms.length) throw Object.assign(new Error('请输入检索问题'), { status: 400 });
  return documents
    .map((doc) => {
      const haystack = `${doc.title} ${doc.content}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? (term.length > 1 ? 2 : 1) : 0), 0);
      return { ...doc, score };
    })
    .filter((doc) => doc.score > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, 'zh-CN'))
    .slice(0, limit)
    .map((doc) => ({ ...doc, snippet: doc.content.slice(0, 180) }));
}

/* ── simple local embedding (deterministic, no external API) ─────── */

const DEFAULT_EMBED_DIM = 128;

/**
 * Generate a deterministic local fallback embedding from text.
 * Uses character-level hashing with bigram features. Real deployments can set
 * AI_API_KEY / OPENAI_API_KEY to use an OpenAI-compatible embedding provider;
 * this fallback keeps local development and tests deterministic.
 */
export function embedText(text, dim = DEFAULT_EMBED_DIM) {
  const tokens = tokenize(text);
  const vec = new Float64Array(dim);
  for (const token of tokens) {
    let h = 0;
    for (let i = 0; i < token.length; i++) h = ((h << 5) - h + token.charCodeAt(i)) | 0;
    vec[Math.abs(h) % dim] += 1;
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    const bi = tokens[i] + tokens[i + 1];
    let h = 0;
    for (let j = 0; j < bi.length; j++) h = ((h << 5) - h + bi.charCodeAt(j)) | 0;
    vec[Math.abs(h) % dim] += 0.5;
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) vec[i] /= norm;
  return Array.from(vec);
}

export function cosineSimilarity(a, b) {
  let dot = 0, nA = 0, nB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; nA += a[i] * a[i]; nB += b[i] * b[i]; }
  return dot / (Math.sqrt(nA) * Math.sqrt(nB) || 1);
}

/* ── DB-backed embedding storage ─────────────────────────────────── */

/**
 * Upsert documents into rag_documents with embeddings.
 * Works for both SQLite and PostgreSQL (embedding_json is TEXT in both).
 */
export async function storeDocumentEmbeddings(db, documents) {
  const ts = new Date().toISOString();
  const useRemoteEmbedding = isAiProviderEnabled();
  for (const doc of documents) {
    let embedding = null;
    if (useRemoteEmbedding) {
      try { embedding = await createEmbedding(doc.content); } catch {}
    }
    embedding ||= embedText(doc.content);
    await db.prepare(
      `INSERT INTO rag_documents (id, source_type, source_id, title, content, metadata_json, embedding_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content, metadata_json=excluded.metadata_json, embedding_json=excluded.embedding_json, updated_at=excluded.updated_at`
    ).run(doc.id, doc.sourceType, doc.sourceId, doc.title, doc.content, JSON.stringify(doc.metadata), JSON.stringify(embedding), ts);
  }
}

/**
 * Vector similarity search over in-memory documents (no DB required).
 */
export function searchByEmbedding(queryEmbedding, documentsWithEmbeddings, limit = 8) {
  return documentsWithEmbeddings
    .map((doc) => ({ ...doc, score: cosineSimilarity(queryEmbedding, doc.embedding) }))
    .filter((doc) => doc.score > 0.01)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((doc) => ({ ...doc, snippet: doc.content.slice(0, 180) }));
}

/**
 * Hybrid search: try pgvector SQL first, fall back to in-memory embedding,
 * then return null so the caller can fall back to lexical search.
 *
 * @returns {Array|null} search results or null if no embedding data
 */
export async function searchDocumentsHybrid(query, db, limit = 8) {
  let queryVec = null;
  if (isAiProviderEnabled()) {
    try { queryVec = await createEmbedding(query); } catch {}
  }
  queryVec ||= embedText(query);

  // 1. Try PostgreSQL native vector search (pgvector)
  if (db.pool) {
    try {
      const pgSql = `SELECT id, source_type, source_id, title, content, metadata_json,
                             1 - (embedding <=> $1::vector) AS score
                      FROM rag_documents
                      WHERE embedding IS NOT NULL
                      ORDER BY embedding <=> $1::vector
                      LIMIT $2`;
      const res = await db.pool.query(pgSql, [JSON.stringify(queryVec), limit]);
      if (res.rows.length > 0) {
        return res.rows.map((r) => ({
          id: r.source_id,
          sourceType: r.source_type,
          sourceId: r.source_id,
          title: r.title,
          name: r.title,
          content: r.content,
          metadata: parseJsonSafe(r.metadata_json, {}),
          score: Number(r.score),
          snippet: r.content.slice(0, 180),
        }));
      }
    } catch {
      // pgvector not available or column missing — fall through
    }
  }

  // 2. In-memory embedding search from embedding_json column
  try {
    const rows = await db.prepare('SELECT * FROM rag_documents WHERE embedding_json IS NOT NULL').all();
    if (rows.length > 0) {
      const docs = rows.map((r) => ({
        id: r.id,
        sourceType: r.source_type,
        sourceId: r.source_id,
        title: r.title,
        name: r.title,
        content: r.content,
        metadata: parseJsonSafe(r.metadata_json, {}),
        embedding: parseJsonSafe(r.embedding_json, []),
      }));
      const results = searchByEmbedding(queryVec, docs, limit);
      if (results.length > 0) return results;
    }
  } catch {
    // embedding_json column might not exist yet — fall through
  }

  return null;
}

function parseJsonSafe(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

/* ── meal advisor (unchanged logic, optional DB hybrid search) ───── */

function inferProfile(query, profile = {}) {
  const text = String(query || '');
  const inferred = normalizeProfile(profile);
  if (text.includes('减脂') || text.includes('低脂') || text.includes('低热量')) inferred.goal = 'fatLoss';
  if (text.includes('增肌') || text.includes('训练') || text.includes('高蛋白')) inferred.goal = 'muscleGain';
  if (text.includes('早餐')) inferred.mealType = 'breakfast';
  if (text.includes('晚餐')) inferred.mealType = 'dinner';
  if (text.includes('午餐')) inferred.mealType = 'lunch';
  if (text.includes('清真')) inferred.halalOnly = true;
  return inferred;
}

/**
 * Answer a meal question. When AI_API_KEY / OPENAI_API_KEY is configured, uses
 * an OpenAI-compatible LLM for grounded response text after RAG + rules. Without
 * provider credentials, returns the deterministic template answer.
 */
export async function answerMealQuestion({ query, profile, dishes, stalls, canteens, db }) {
  if (!String(query || '').trim()) throw Object.assign(new Error('请输入咨询问题'), { status: 400 });
  const inferredProfile = inferProfile(query, profile);

  let citations;
  if (db) {
    const hybrid = await searchDocumentsHybrid(query, db, 5);
    if (hybrid && hybrid.length > 0) {
      citations = hybrid;
    }
  }
  if (!citations) {
    const documents = buildDishDocuments(dishes, stalls, canteens);
    citations = searchDocuments(query, documents, 5);
  }

  const plan = buildMealPlan(dishes, inferredProfile);
  const citedNames = citations.slice(0, 3).map((item) => item.name || item.title).join('、') || '当前菜品库';
  const pickNames = plan.dishes.map((dish) => dish.name).join('、') || '暂无完全匹配餐品';
  const templateAnswer = `根据真实菜品库检索到的 ${citedNames}，并结合你的目标"${plan.goalLabel}"，建议优先考虑：${pickNames}。${plan.reason}`;
  const normalizedCitations = citations.map((item) => ({ id: item.sourceId, name: item.name || item.title, score: item.score, snippet: item.snippet }));
  let answer = templateAnswer;
  let answerSource = 'template';
  if (isAiProviderEnabled()) {
    try {
      answer = await generateGroundedMealAnswer({ query, profile: inferredProfile, citations: normalizedCitations, plan: { ...plan, picks: plan.dishes } }) || templateAnswer;
      answerSource = answer === templateAnswer ? 'template' : 'llm';
    } catch {}
  }
  return {
    answer,
    answerSource,
    citations: normalizedCitations,
    plan: { ...plan, picks: plan.dishes }
  };
}
