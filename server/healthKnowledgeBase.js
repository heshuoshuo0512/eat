import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  approvedKnowledgeDocuments,
  CAMPUS_POLICY_SOURCE_TYPE,
  GLOBAL_KNOWLEDGE_TENANT_ID,
  HEALTH_KNOWLEDGE_SOURCE_TYPE,
  loadKnowledgeBundle,
} from './knowledgeGovernance.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(MODULE_DIR, '../data/health-knowledge-bases');
const EXCLUDED_FILES = new Set(['README.md', 'sources.md']);
const EXCLUDED_DIRECTORIES = new Set(['08_index_and_audit']);

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'document';
}

function categoryFor(relativePath) {
  return relativePath.split(/[\\/]/)[0] || 'unknown';
}

function sourceMetadata(content) {
  const sourceUrl = content.match(/^来源：([^\n\r]+)/m)?.[1]?.trim() || null;
  const sourceStatus = content.match(/状态[：:]\s*([a-z_]+)/i)?.[1] || (sourceUrl ? 'verified_page' : 'internal_required');
  const sourceIds = content.match(/^用途：([^\n\r]+)/m)?.[1]?.trim() || null;
  const title = content.match(/^#\s+([^\n\r]+)/m)?.[1]?.trim() || null;
  return { sourceUrl, sourceStatus, sourceIds, documentTitle: title };
}

function chunkText(content, chunkSize, chunkOverlap) {
  const text = String(content || '').trim();
  if (!text) return [];
  const size = Math.max(80, Number(chunkSize) || 900);
  const overlap = Math.max(0, Math.min(size - 1, Number(chunkOverlap) || 120));
  const step = size - overlap;
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += step) {
    const chunk = text.slice(offset, offset + size).trim();
    if (chunk) chunks.push({ content: chunk, offset });
    if (offset + size >= text.length) break;
  }
  return chunks;
}

function markdownFiles(root) {
  if (!existsSync(root)) throw new Error(`健康知识库目录不存在：${root}`);
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !EXCLUDED_DIRECTORIES.has(entry.name)) visit(path);
      else if (extname(entry.name).toLowerCase() === '.md' && !EXCLUDED_FILES.has(entry.name)) files.push(path);
    }
  };
  visit(root);
  return files.sort();
}

function hasGovernedBundle(root) {
  const required = ['sources.json', 'documents.json', 'food-composition-references.json'];
  const present = required.filter((name) => existsSync(resolve(root, name)));
  if (present.length && present.length !== required.length) {
    const missing = required.filter((name) => !present.includes(name));
    throw new Error(`知识治理文件不完整，缺少：${missing.join('、')}`);
  }
  return present.length === required.length;
}

function governedDocuments({ root, sourceType, tenantId, chunkSize, chunkOverlap, now } = {}) {
  const bundle = loadKnowledgeBundle({ root });
  return approvedKnowledgeDocuments(bundle, { sourceType, tenantId, now }).flatMap((document) => {
    const source = bundle.sourceById.get(document.sourceId);
    const baseId = `knowledge:${document.id}`;
    return chunkText(document.content, chunkSize, chunkOverlap).map((chunk, chunkIndex) => ({
      id: `${baseId}:chunk:${chunkIndex}`,
      sourceType: document.sourceType,
      sourceId: baseId,
      ...(document.tenantId ? { tenantId: document.tenantId } : {}),
      title: document.title,
      content: chunk.content,
      searchText: [document.title, ...document.searchTerms, chunk.content].join(' '),
      metadata: {
        category: document.category,
        knowledgeDomain: document.knowledgeDomain,
        sourceFile: `documents.json#${document.id}`,
        sourceUrl: source.url,
        sourceStatus: source.reviewStatus,
        sourceIds: [document.sourceId],
        publisher: source.publisher,
        version: document.version,
        sourceVersion: source.sourceVersion,
        reviewedAt: document.reviewedAt,
        reviewedBy: document.reviewedBy,
        license: source.license,
        factStatus: document.factStatus,
        applicablePopulation: document.applicablePopulation,
        safetyBoundary: document.safetyBoundary,
        aliases: document.searchTerms,
        citations: document.citations,
        citation: document.citations[0],
        chunkIndex,
        chunkOffset: chunk.offset,
        evidenceType: document.sourceType === CAMPUS_POLICY_SOURCE_TYPE
          ? 'tenant_campus_policy'
          : 'approved_global_knowledge',
      },
    }));
  });
}

/** Load approved markdown extracts as RAG-ready chunk documents. */
export function loadHealthKnowledgeDocuments({ root = process.env.HEALTH_KB_DIR || DEFAULT_ROOT, chunkSize = process.env.HEALTH_KB_CHUNK_SIZE, chunkOverlap = process.env.HEALTH_KB_CHUNK_OVERLAP } = {}) {
  const resolvedRoot = resolve(root);
  if (hasGovernedBundle(resolvedRoot)) {
    return governedDocuments({
      root: resolvedRoot,
      sourceType: HEALTH_KNOWLEDGE_SOURCE_TYPE,
      chunkSize,
      chunkOverlap,
    });
  }
  return markdownFiles(resolvedRoot).flatMap((file) => {
    const content = readFileSync(file, 'utf8');
    const relativePath = relative(resolvedRoot, file);
    const source = sourceMetadata(content);
    const baseId = `health:${slug(relativePath.replace(/\\/g, '/').replace(/\.md$/i, ''))}`;
    return chunkText(content, chunkSize, chunkOverlap).map((chunk, chunkIndex) => ({
      id: `${baseId}:chunk:${chunkIndex}`,
      sourceType: 'health_knowledge',
      sourceId: baseId,
      title: source.documentTitle || basename(file, '.md'),
      content: chunk.content,
      metadata: {
        category: categoryFor(relativePath),
        sourceFile: relativePath.replace(/\\/g, '/'),
        sourceUrl: source.sourceUrl,
        sourceStatus: source.sourceStatus,
        sourceIds: source.sourceIds,
        chunkIndex,
        chunkOffset: chunk.offset,
        citation: source.sourceUrl || relativePath.replace(/\\/g, '/'),
      },
    }));
  });
}

/** Load health documents into the tenant-safe retrieval index. */
export async function loadHealthKnowledgeBase(db, options = {}) {
  const documents = loadHealthKnowledgeDocuments(options);
  let index = null;
  if (db && documents.length) {
    const { buildHealthIndexDocuments, upsertRetrievalDocuments } = await import('./retrievalIndex.js');
    const tenantId = String(options.tenantId || GLOBAL_KNOWLEDGE_TENANT_ID);
    if (tenantId !== GLOBAL_KNOWLEDGE_TENANT_ID) {
      throw Object.assign(new Error(`健康知识只能写入 ${GLOBAL_KNOWLEDGE_TENANT_ID} 全局作用域`), {
        code: 'GLOBAL_KNOWLEDGE_SCOPE_REQUIRED',
      });
    }
    const indexedDocuments = buildHealthIndexDocuments(documents, tenantId);
    index = await upsertRetrievalDocuments(db, indexedDocuments, {
      tenantId,
      ...(Object.hasOwn(options, 'embeddingProvider') ? { embeddingProvider: options.embeddingProvider } : {}),
      ...(options.embeddingModel ? { embeddingModel: options.embeddingModel } : {})
    });
  }
  return { count: documents.length, documents, index };
}

/** Load approved tenant-specific campus policy documents. */
export function loadCampusPolicyKnowledgeDocuments({
  root = process.env.HEALTH_KB_DIR || DEFAULT_ROOT,
  tenantId = 'default',
  chunkSize = process.env.HEALTH_KB_CHUNK_SIZE,
  chunkOverlap = process.env.HEALTH_KB_CHUNK_OVERLAP,
  now,
} = {}) {
  const resolvedRoot = resolve(root);
  if (!hasGovernedBundle(resolvedRoot)) return [];
  return governedDocuments({
    root: resolvedRoot,
    sourceType: CAMPUS_POLICY_SOURCE_TYPE,
    tenantId: String(tenantId),
    chunkSize,
    chunkOverlap,
    now,
  });
}

/** Persist approved campus policy chunks for one tenant. */
export async function loadCampusPolicyKnowledgeBase(db, options = {}) {
  const tenantId = String(options.tenantId || 'default');
  if (tenantId === GLOBAL_KNOWLEDGE_TENANT_ID) {
    throw Object.assign(new Error('校园制度必须写入所属租户，不能写入全局作用域'), {
      code: 'TENANT_POLICY_SCOPE_REQUIRED',
    });
  }
  const documents = loadCampusPolicyKnowledgeDocuments({ ...options, tenantId });
  let index = null;
  if (db && documents.length) {
    const { buildHealthIndexDocuments, upsertRetrievalDocuments } = await import('./retrievalIndex.js');
    const indexedDocuments = buildHealthIndexDocuments(documents, tenantId);
    index = await upsertRetrievalDocuments(db, indexedDocuments, {
      tenantId,
      ...(Object.hasOwn(options, 'embeddingProvider') ? { embeddingProvider: options.embeddingProvider } : {}),
      ...(options.embeddingModel ? { embeddingModel: options.embeddingModel } : {})
    });
  }
  return { count: documents.length, documents, index };
}

export function loadFoodCompositionReferences({ root = process.env.HEALTH_KB_DIR || DEFAULT_ROOT } = {}) {
  return loadKnowledgeBundle({ root: resolve(root) }).foodComposition;
}

export { CAMPUS_POLICY_SOURCE_TYPE, DEFAULT_ROOT, GLOBAL_KNOWLEDGE_TENANT_ID, chunkText };
