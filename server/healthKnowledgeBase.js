import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeDocumentEmbeddings } from './rag.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(MODULE_DIR, '../data/health-knowledge-bases');
const EXCLUDED_FILES = new Set(['README.md', 'sources.md']);

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
      if (entry.isDirectory()) visit(path);
      else if (extname(entry.name).toLowerCase() === '.md' && !EXCLUDED_FILES.has(entry.name)) files.push(path);
    }
  };
  visit(root);
  return files.sort();
}

/** Load approved markdown extracts as RAG-ready chunk documents. */
export function loadHealthKnowledgeDocuments({ root = process.env.HEALTH_KB_DIR || DEFAULT_ROOT, chunkSize = process.env.HEALTH_KB_CHUNK_SIZE, chunkOverlap = process.env.HEALTH_KB_CHUNK_OVERLAP } = {}) {
  const resolvedRoot = resolve(root);
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

/** Load health documents and persist deterministic embeddings into rag_documents. */
export async function loadHealthKnowledgeBase(db, options = {}) {
  const documents = loadHealthKnowledgeDocuments(options);
  if (db && documents.length) await storeDocumentEmbeddings(db, documents);
  return { count: documents.length, documents };
}

export { DEFAULT_ROOT, chunkText };
