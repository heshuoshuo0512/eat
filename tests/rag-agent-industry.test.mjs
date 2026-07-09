/**
 * RAG/Agent Industry Standard Architecture Tests
 * 
 * Tests module structure and exports without requiring API keys.
 * Uses static analysis + file-level validation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const server = (name) => readFileSync(resolve(ROOT, 'server', name), 'utf8');

describe('RAG/Agent Industry Standard Architecture', () => {

  describe('Module Structure', () => {
    it('rag-langchain.js exports RAG chain functions', () => {
      const src = server('rag-langchain.js');
      assert.ok(src.includes('export async function createRAGChain'), 'createRAGChain');
      assert.ok(src.includes('export async function generateGroundedAnswer'), 'generateGroundedAnswer');
      assert.ok(src.includes('export async function hybridSearch'), 'hybridSearch');
      assert.ok(src.includes('export function splitDocuments'), 'splitDocuments');
      assert.ok(src.includes('export async function loadVectorStoreFromDB'), 'loadVectorStoreFromDB');
      assert.ok(src.includes('export async function createVectorStore'), 'createVectorStore');
    });

    it('rag-langchain.js uses LangChain imports', () => {
      const src = server('rag-langchain.js');
      assert.ok(src.includes('@langchain/openai'), 'imports ChatOpenAI');
      assert.ok(src.includes('@langchain/core/documents'), 'imports Document');
      assert.ok(src.includes('@langchain/core/runnables'), 'imports Runnables');
      assert.ok(src.includes('@langchain/core/prompts'), 'imports PromptTemplate');
      assert.ok(src.includes('langchain/chains/retrieval'), 'imports RetrievalChain');
    });

    it('agent-langchain.js exports Agent functions', () => {
      const src = server('agent-langchain.js');
      assert.ok(src.includes('export async function createCanteenAgent'), 'createCanteenAgent');
      assert.ok(src.includes('export async function runCanteenAgent'), 'runCanteenAgent');
      assert.ok(src.includes('export function registerCanteenTools'), 'registerCanteenTools');
      assert.ok(src.includes('export function registerTool'), 'registerTool');
      assert.ok(src.includes('export function getToolRegistry'), 'getToolRegistry');
    });

    it('agent-langchain.js implements ReAct pattern', () => {
      const src = server('agent-langchain.js');
      assert.ok(src.includes('createReactAgent'), 'uses createReactAgent');
      assert.ok(src.includes('AgentExecutor'), 'uses AgentExecutor');
      assert.ok(src.includes('Thought:'), 'ReAct prompt with Thought');
      assert.ok(src.includes('Action:'), 'ReAct prompt with Action');
      assert.ok(src.includes('Observation:'), 'ReAct prompt with Observation');
      assert.ok(src.includes('Final Answer:'), 'ReAct prompt with Final Answer');
    });

    it('agent-langchain.js implements dynamic tool registry', () => {
      const src = server('agent-langchain.js');
      assert.ok(src.includes('class ToolRegistry'), 'ToolRegistry class');
      assert.ok(src.includes('register(options)'), 'register method');
      assert.ok(src.includes('getToolsForUser'), 'getToolsForUser (role filtering)');
      assert.ok(src.includes('getCatalog'), 'getCatalog');
      assert.ok(src.includes('getByCategory'), 'getByCategory');
    });

    it('agent-langchain.js implements all 3 memory types', () => {
      const src = server('agent-langchain.js');
      assert.ok(src.includes('BufferMemory'), 'BufferMemory (short-term)');
      assert.ok(src.includes('ConversationSummaryMemory'), 'ConversationSummaryMemory (summary)');
      assert.ok(src.includes('class EpisodicMemory'), 'EpisodicMemory (episodic)');
      assert.ok(src.includes('async record(episode)'), 'episode recording');
      assert.ok(src.includes('async recall(query'), 'episode recall');
    });

    it('agent-langchain.js has 9 registered canteen tools', () => {
      const src = server('agent-langchain.js');
      const tools = ['session.load', 'memory.long_term', 'profile.load', 'menu.today',
        'rag.meal_advisor', 'orders.mine', 'orders.analytics', 'order.create.propose', 'session.save'];
      for (const tool of tools) {
        assert.ok(src.includes(`name: '${tool}'`), `tool: ${tool}`);
      }
    });

    it('vectorstore-pgvector.js exports vector operations', () => {
      const src = server('vectorstore-pgvector.js');
      assert.ok(src.includes('export async function migrateVectorSchema'), 'migrateVectorSchema');
      assert.ok(src.includes('export async function vectorSearch'), 'vectorSearch');
      assert.ok(src.includes('export async function fullTextSearch'), 'fullTextSearch');
      assert.ok(src.includes('export async function hybridSearch'), 'hybridSearch');
      assert.ok(src.includes('export async function batchUpsertDocuments'), 'batchUpsertDocuments');
      assert.ok(src.includes('export async function migrateFromLegacy'), 'migrateFromLegacy');
    });

    it('vectorstore-pgvector.js uses HNSW index', () => {
      const src = server('vectorstore-pgvector.js');
      assert.ok(src.includes('CREATE EXTENSION IF NOT EXISTS vector'), 'pgvector extension');
      assert.ok(src.includes('VECTOR('), 'vector column type');
      assert.ok(src.includes('USING hnsw'), 'HNSW index');
      assert.ok(src.includes('vector_cosine_ops'), 'cosine distance ops');
      assert.ok(src.includes('Reciprocal Rank Fusion'), 'RRF hybrid search');
    });

    it('vectorstore-pgvector.js has correct config', () => {
      const src = server('vectorstore-pgvector.js');
      assert.ok(src.includes('EMBEDDING_DIM = 1536'), '1536-dim embeddings');
      assert.ok(src.includes("INDEX_TYPE = 'hnsw'"), 'HNSW index type');
    });

    it('evaluation-ragas.js exports all RAGAS metrics', () => {
      const src = server('evaluation-ragas.js');
      assert.ok(src.includes('export async function evaluateFaithfulness'), 'faithfulness');
      assert.ok(src.includes('export async function evaluateAnswerRelevancy'), 'answer relevancy');
      assert.ok(src.includes('export async function evaluateContextPrecision'), 'context precision');
      assert.ok(src.includes('export async function evaluateContextRecall'), 'context recall');
      assert.ok(src.includes('export async function evaluateRAGExample'), 'composite evaluation');
      assert.ok(src.includes('export async function evaluateBatch'), 'batch evaluation');
      assert.ok(src.includes('export function createEvaluationPipeline'), 'evaluation pipeline');
    });

    it('evaluation-ragas.js has proper LLM-as-judge prompts', () => {
      const src = server('evaluation-ragas.js');
      assert.ok(src.includes('FAITHFULNESS_PROMPT'), 'faithfulness prompt');
      assert.ok(src.includes('ANSWER_RELEVANCY_PROMPT'), 'relevancy prompt');
      assert.ok(src.includes('CONTEXT_PRECISION_PROMPT'), 'precision prompt');
      assert.ok(src.includes('CONTEXT_RECALL_PROMPT'), 'recall prompt');
      assert.ok(src.includes('score: <分数>'), 'structured score output');
      assert.ok(src.includes('reason: <原因>'), 'structured reason output');
    });
  });

  describe('Dependencies', () => {
    it('package.json has LangChain dependencies', () => {
      const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
      assert.ok(pkg.dependencies['@langchain/core'], '@langchain/core installed');
      assert.ok(pkg.dependencies['@langchain/openai'], '@langchain/openai installed');
      assert.ok(pkg.dependencies['langchain'], 'langchain installed');
      assert.ok(pkg.dependencies['pgvector'], 'pgvector installed');
    });
  });

  describe('Documentation', () => {
    it('RAG-AGENT-ARCHITECTURE.md exists', () => {
      const src = readFileSync(resolve(ROOT, 'docs/RAG-AGENT-ARCHITECTURE.md'), 'utf8');
      assert.ok(src.includes('LangChain'), 'documents LangChain');
      assert.ok(src.includes('pgvector'), 'documents pgvector');
      assert.ok(src.includes('RAGAS'), 'documents RAGAS');
      assert.ok(src.includes('ReAct'), 'documents ReAct');
    });

    it('RAG-AGENT-UPGRADE-SUMMARY.md exists', () => {
      const src = readFileSync(resolve(ROOT, 'docs/RAG-AGENT-UPGRADE-SUMMARY.md'), 'utf8');
      assert.ok(src.includes('Completed Work'), 'has completed work section');
      assert.ok(src.includes('Architecture Comparison'), 'has comparison');
    });
  });
});
