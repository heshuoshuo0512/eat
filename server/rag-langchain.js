/**
 * LangChain RAG Chain - Industry Standard Implementation
 * 
 * Uses LangChain's RetrievalQAChain with:
 * - OpenAI embeddings (text-embedding-3-small)
 * - pgvector for vector storage
 * - Hybrid search (vector + lexical)
 * - Grounded answer generation with citations
 */

import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence, RunnablePassthrough } from '@langchain/core/runnables';
import { PromptTemplate } from '@langchain/core/prompts';
import { createRetrievalChain } from 'langchain/chains/retrieval';
import { createStuffDocumentsChain } from 'langchain/chains/combine_documents';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { Pool } from 'pg';
import { buildDishDocuments, embedText, cosineSimilarity, searchDocuments } from './rag.js';
import { isAiProviderEnabled, providerConfig } from './aiProvider.js';

/* ── Configuration ──────────────────────────────────────────────────── */

const EMBEDDING_MODEL = 'text-embedding-3-small';
const CHAT_MODEL = 'gpt-4o-mini';
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;
const RETRIEVER_K = 8;

/* ── pgvector Pool ──────────────────────────────────────────────────── */

let pgPool = null;

function getPGPool() {
  if (!pgPool) {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return null;
    pgPool = new Pool({ connectionString: dbUrl });
  }
  return pgPool;
}

/* ── Embeddings ──────────────────────────────────────────────────────── */

function getEmbeddings() {
  const config = providerConfig();
  if (!config.enabled) return null;
  
  return new OpenAIEmbeddings({
    openAIApiKey: config.apiKey,
    modelName: EMBEDDING_MODEL,
    batchSize: 512,
  });
}

/* ── Vector Store ────────────────────────────────────────────────────── */

/**
 * Create a vector store from documents.
 * Uses pgvector if DATABASE_URL is set, otherwise falls back to MemoryVectorStore.
 */
export async function createVectorStore(documents = []) {
  const embeddings = getEmbeddings();
  if (!embeddings) {
    console.warn('[RAG-LangChain] No embeddings available, using in-memory store');
    return await MemoryVectorStore.fromDocuments(documents, embeddings || undefined);
  }

  const pool = getPGPool();
  if (pool) {
    try {
      // Try pgvector first
      const store = await PGVectorStore.fromDocuments(documents, embeddings, {
        pool,
        tableName: 'rag_vectors',
        columns: {
          id: 'id',
          vector: 'embedding',
          content: 'content',
          metadata: 'metadata',
        },
      });
      console.log('[RAG-LangChain] Using pgvector store');
      return store;
    } catch (err) {
      console.warn('[RAG-LangChain] pgvector failed, falling back to memory:', err.message);
    }
  }

  // Fallback to in-memory
  return await MemoryVectorStore.fromDocuments(documents, embeddings);
}

/**
 * Load existing documents from database into vector store.
 */
export async function loadVectorStoreFromDB(db) {
  const rows = await db.prepare(
    'SELECT id, title, content, metadata_json FROM rag_documents WHERE content IS NOT NULL LIMIT 1000'
  ).all();

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

  return await createVectorStore(documents);
}

/* ── RAG Chain ────────────────────────────────────────────────────────── */

const RAG_SYSTEM_PROMPT = `你是智慧食堂的智能营养顾问。基于以下检索到的菜品信息回答用户问题。

规则：
1. 只基于提供的上下文信息回答，不要编造
2. 如果上下文中没有相关信息，明确说明
3. 引用具体的菜品名称和营养信息
4. 给出实用的饮食建议

上下文：
{context}

用户问题：{input}`;

/**
 * Create a LangChain RAG chain.
 * Uses RetrievalQAChain with grounded answer generation.
 */
export async function createRAGChain(vectorStore, options = {}) {
  const config = providerConfig();
  if (!config.enabled) {
    throw new Error('AI provider not configured');
  }

  const model = new ChatOpenAI({
    openAIApiKey: config.apiKey,
    modelName: options.model || CHAT_MODEL,
    temperature: 0.3,
    maxTokens: 1024,
  });

  const prompt = PromptTemplate.fromTemplate(RAG_SYSTEM_PROMPT);

  // Create retrieval chain
  const combineDocsChain = await createStuffDocumentsChain({
    llm: model,
    prompt,
    outputParser: new StringOutputParser(),
  });

  const retriever = vectorStore.asRetriever({
    k: options.k || RETRIEVER_K,
  });

  const retrievalChain = await createRetrievalChain({
    retriever,
    combineDocsChain,
  });

  return retrievalChain;
}

/* ── Hybrid Search (LangChain + Legacy) ──────────────────────────────── */

/**
 * Hybrid search combining LangChain vector search with legacy lexical search.
 * Falls back to legacy search if LangChain fails.
 */
export async function hybridSearch(query, db, options = {}) {
  const limit = options.limit || 8;
  
  // Try LangChain vector search first
  try {
    const vectorStore = await loadVectorStoreFromDB(db);
    const results = await vectorStore.similaritySearchWithScore(query, limit);
    
    if (results.length > 0) {
      return results.map(([doc, score]) => ({
        id: doc.metadata.id,
        title: doc.metadata.title,
        content: doc.pageContent,
        score: 1 - score, // Convert distance to similarity
        source: 'langchain-vector'
      }));
    }
  } catch (err) {
    console.warn('[RAG-LangChain] Vector search failed:', err.message);
  }

  // Fallback to legacy hybrid search
  const { searchDocumentsHybrid } = await import('./rag.js');
  return await searchDocumentsHybrid(query, db, limit);
}

/* ── Grounded Answer Generation ──────────────────────────────────────── */

/**
 * Generate a grounded meal answer using LangChain RAG chain.
 * Falls back to legacy method if LangChain fails.
 */
export async function generateGroundedAnswer({ query, profile, db, dishes, stalls, canteens }) {
  const config = providerConfig();
  if (!config.enabled) {
    // Use legacy template answer
    const { answerMealQuestion } = await import('./rag.js');
    return await answerMealQuestion({ query, profile, dishes, stalls, canteens, db });
  }

  try {
    // Build documents
    const documents = buildDishDocuments(dishes, stalls, canteens);
    const docs = documents.map(doc => 
      new Document({
        pageContent: doc.content,
        metadata: { id: doc.id, title: doc.title }
      })
    );

    // Create vector store and RAG chain
    const vectorStore = await createVectorStore(docs);
    const ragChain = await createRAGChain(vectorStore);

    // Run RAG chain
    const result = await ragChain.invoke({
      input: query,
    });

    return {
      answer: result.answer,
      citations: result.context?.map(doc => ({
        id: doc.metadata.id,
        title: doc.metadata.title,
        snippet: doc.pageContent.slice(0, 200)
      })) || [],
      source: 'langchain-rag'
    };
  } catch (err) {
    console.warn('[RAG-LangChain] RAG chain failed, falling back to legacy:', err.message);
    const { answerMealQuestion } = await import('./rag.js');
    return await answerMealQuestion({ query, profile, dishes, stalls, canteens, db });
  }
}

/* ── Document Chunking ────────────────────────────────────────────────── */

/**
 * Split documents into chunks for better retrieval.
 * Uses recursive character text splitter.
 */
export function splitDocuments(documents, chunkSize = CHUNK_SIZE, chunkOverlap = CHUNK_OVERLAP) {
  const chunks = [];
  
  for (const doc of documents) {
    const text = doc.pageContent || doc.content || '';
    const metadata = doc.metadata || {};
    
    // Simple recursive character splitting
    for (let i = 0; i < text.length; i += chunkSize - chunkOverlap) {
      const chunk = text.slice(i, i + chunkSize);
      if (chunk.trim()) {
        chunks.push(new Document({
          pageContent: chunk,
          metadata: { ...metadata, chunkIndex: Math.floor(i / (chunkSize - chunkOverlap)) }
        }));
      }
    }
  }
  
  return chunks;
}

/* ── Export ────────────────────────────────────────────────────────────── */

export {
  getEmbeddings,
  getPGPool,
  EMBEDDING_MODEL,
  CHAT_MODEL,
  RETRIEVER_K,
};
