/**
 * pgvector Integration - Industry Standard Vector Storage
 * 
 * Uses PostgreSQL pgvector extension for:
 * - Proper vector columns (VECTOR(1536))
 * - Cosine similarity search (<=> operator)
 * - IVFFlat/HNSW indexing for performance
 * - Hybrid search (vector + full-text)
 */

import { Pool } from 'pg';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import { isAiProviderEnabled, providerConfig } from './aiProvider.js';

/* ── Configuration ──────────────────────────────────────────────────── */

const EMBEDDING_DIM = 1536; // text-embedding-3-small dimension
const INDEX_TYPE = 'hnsw'; // or 'ivfflat'
const HNSW_M = 16; // HNSW parameter
const HNSW_EF_CONSTRUCTION = 64; // HNSW parameter

/* ── pgvector Pool ──────────────────────────────────────────────────── */

let pgPool = null;

export function getPGPool() {
  if (!pgPool) {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL not set');
    }
    pgPool = new Pool({ connectionString: dbUrl });
  }
  return pgPool;
}

/* ── Schema Migration ────────────────────────────────────────────────── */

/**
 * Enable pgvector extension and create vector tables.
 * Run this once during database initialization.
 */
export async function migrateVectorSchema(db) {
  const pool = getPGPool();
  const client = await pool.connect();
  
  try {
    // Enable pgvector extension
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    console.log('[pgvector] Extension enabled');

    // Create vector table for RAG documents
    await client.query(`
      CREATE TABLE IF NOT EXISTS rag_vectors (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        embedding VECTOR(${EMBEDDING_DIM}),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('[pgvector] rag_vectors table created');

    // Create HNSW index for fast similarity search
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_rag_vectors_embedding 
      ON rag_vectors 
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = ${HNSW_M}, ef_construction = ${HNSW_EF_CONSTRUCTION})
    `);
    console.log('[pgvector] HNSW index created');

    // Create full-text search index for hybrid search
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_rag_vectors_content_fts 
      ON rag_vectors 
      USING gin(to_tsvector('english', content))
    `);
    console.log('[pgvector] Full-text index created');

    // Create metadata index
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_rag_vectors_metadata 
      ON rag_vectors 
      USING gin(metadata)
    `);
    console.log('[pgvector] Metadata index created');

    return { success: true };
  } catch (err) {
    console.error('[pgvector] Migration failed:', err.message);
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}

/* ── Embeddings ──────────────────────────────────────────────────────── */

function getEmbeddings() {
  const config = providerConfig();
  if (!config.enabled) {
    throw new Error('AI provider not configured for embeddings');
  }
  
  return new OpenAIEmbeddings({
    openAIApiKey: config.apiKey,
    modelName: 'text-embedding-3-small',
    batchSize: 512,
  });
}

/* ── Document Operations ────────────────────────────────────────────── */

/**
 * Insert or update a document with embedding.
 */
export async function upsertDocument(doc) {
  const pool = getPGPool();
  const embeddings = getEmbeddings();
  
  // Generate embedding
  const embedding = await embeddings.embedQuery(doc.content);
  
  await pool.query(
    `INSERT INTO rag_vectors (id, content, metadata, embedding, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (id) DO UPDATE 
     SET content = EXCLUDED.content, 
         metadata = EXCLUDED.metadata, 
         embedding = EXCLUDED.embedding, 
         updated_at = NOW()`,
    [doc.id, doc.content, JSON.stringify(doc.metadata || {}), JSON.stringify(embedding)]
  );
  
  return { id: doc.id };
}

/**
 * Batch insert documents with embeddings.
 */
export async function batchUpsertDocuments(documents, batchSize = 100) {
  const results = [];
  
  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(doc => upsertDocument(doc)));
    results.push(...batchResults);
  }
  
  return results;
}

/* ── Vector Search ──────────────────────────────────────────────────── */

/**
 * Cosine similarity search using pgvector.
 */
export async function vectorSearch(query, options = {}) {
  const pool = getPGPool();
  const embeddings = getEmbeddings();
  const limit = options.limit || 8;
  const threshold = options.threshold || 0.7;
  
  // Generate query embedding
  const queryEmbedding = await embeddings.embedQuery(query);
  
  // Search using cosine distance operator (<=>)
  const result = await pool.query(
    `SELECT id, content, metadata, 
            1 - (embedding <=> $1::vector) as similarity
     FROM rag_vectors
     WHERE 1 - (embedding <=> $1::vector) > $2
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [JSON.stringify(queryEmbedding), threshold, limit]
  );
  
  return result.rows.map(row => ({
    id: row.id,
    content: row.content,
    metadata: JSON.parse(row.metadata),
    score: parseFloat(row.similarity),
  }));
}

/**
 * Full-text search using PostgreSQL.
 */
export async function fullTextSearch(query, options = {}) {
  const pool = getPGPool();
  const limit = options.limit || 8;
  
  const result = await pool.query(
    `SELECT id, content, metadata,
            ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) as rank
     FROM rag_vectors
     WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)
     ORDER BY rank DESC
     LIMIT $2`,
    [query, limit]
  );
  
  return result.rows.map(row => ({
    id: row.id,
    content: row.content,
    metadata: JSON.parse(row.metadata),
    score: parseFloat(row.rank),
  }));
}

/**
 * Hybrid search combining vector and full-text search.
 * Uses Reciprocal Rank Fusion (RRF) for score combination.
 */
export async function hybridSearch(query, options = {}) {
  const limit = options.limit || 8;
  const rrfK = options.rrfK || 60; // RRF parameter
  
  // Run both searches in parallel
  const [vectorResults, ftsResults] = await Promise.all([
    vectorSearch(query, { limit: limit * 2 }),
    fullTextSearch(query, { limit: limit * 2 }),
  ]);
  
  // Calculate RRF scores
  const scores = new Map();
  
  vectorResults.forEach((result, rank) => {
    const rrfScore = 1 / (rrfK + rank + 1);
    scores.set(result.id, {
      ...result,
      score: (scores.get(result.id)?.score || 0) + rrfScore,
      sources: [...(scores.get(result.id)?.sources || []), 'vector'],
    });
  });
  
  ftsResults.forEach((result, rank) => {
    const rrfScore = 1 / (rrfK + rank + 1);
    scores.set(result.id, {
      ...result,
      score: (scores.get(result.id)?.score || 0) + rrfScore,
      sources: [...(scores.get(result.id)?.sources || []), 'fts'],
    });
  });
  
  // Sort by combined score and return top results
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/* ── LangChain Integration ────────────────────────────────────────────── */

/**
 * Create a LangChain PGVectorStore.
 * This integrates with LangChain's vector store interface.
 */
export async function createLangChainVectorStore(documents = []) {
  const embeddings = getEmbeddings();
  const pool = getPGPool();
  
  if (documents.length > 0) {
    return await PGVectorStore.fromDocuments(documents, embeddings, {
      pool,
      tableName: 'rag_vectors',
      columns: {
        id: 'id',
        vector: 'embedding',
        content: 'content',
        metadata: 'metadata',
      },
    });
  }
  
  return new PGVectorStore(embeddings, {
    pool,
    tableName: 'rag_vectors',
    columns: {
      id: 'id',
      vector: 'embedding',
      content: 'content',
      metadata: 'metadata',
    },
  });
}

/* ── Migration from Legacy ────────────────────────────────────────────── */

/**
 * Migrate documents from legacy rag_documents table to pgvector.
 */
export async function migrateFromLegacy(db) {
  const pool = getPGPool();
  const embeddings = getEmbeddings();
  
  // Read from legacy table
  const rows = await db.prepare(
    'SELECT id, title, content, metadata_json FROM rag_documents WHERE content IS NOT NULL'
  ).all();
  
  console.log(`[pgvector] Migrating ${rows.length} documents from legacy table`);
  
  const documents = rows.map(row => 
    new Document({
      pageContent: row.content,
      metadata: { 
        id: row.id, 
        title: row.title,
        ...JSON.parse(row.metadata_json || '{}')
      }
    })
  );
  
  // Insert into pgvector table
  const results = await batchUpsertDocuments(documents.map(doc => ({
    id: doc.metadata.id,
    content: doc.pageContent,
    metadata: doc.metadata,
  })));
  
  console.log(`[pgvector] Migrated ${results.length} documents`);
  return results;
}

/* ── Statistics ──────────────────────────────────────────────────────── */

/**
 * Get vector store statistics.
 */
export async function getStats() {
  const pool = getPGPool();
  
  const result = await pool.query(`
    SELECT 
      COUNT(*) as total_documents,
      COUNT(DISTINCT metadata->>'source_type') as source_types,
      AVG(embedding <=> embedding) as avg_similarity,
      MIN(created_at) as oldest,
      MAX(updated_at) as newest
    FROM rag_vectors
  `);
  
  return result.rows[0];
}

/* ── Export ────────────────────────────────────────────────────────────── */

export {
  EMBEDDING_DIM,
  INDEX_TYPE,
  HNSW_M,
  HNSW_EF_CONSTRUCTION,
};
