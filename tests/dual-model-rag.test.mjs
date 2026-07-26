import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  createEmbeddings,
  generateAgentToolCalls,
  generateGroundedAgentAnswer,
  getAiProviderStatus,
  validateGroundedAgentAnswer,
  withAiRuntimeConfig,
} from '../server/aiProvider.js';
import { openDatabase } from '../server/database.js';
import {
  clearRetrievalEmbeddingCache,
  getRetrievalIndexStatus,
  searchRetrievalIndex,
  upsertRetrievalDocuments,
} from '../server/retrievalIndex.js';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}/v1`;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

function requestServer(handler) {
  return createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body || '{}');
    const result = handler({ request, payload });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(result));
  });
}

function document(sourceId, title, content = title) {
  return {
    tenantId: '__global__',
    sourceType: 'campus_dining_knowledge',
    sourceId,
    title,
    content,
    metadata: { tenantId: '__global__', evidenceType: 'global_semantic_knowledge' },
  };
}

describe('split chat and embedding providers', () => {
  const chatRequests = [];
  const embeddingRequests = [];
  let chatServer;
  let embeddingServer;
  let chatBaseUrl;
  let embeddingBaseUrl;

  before(async () => {
    chatServer = requestServer(({ request, payload }) => {
      chatRequests.push({ path: request.url, authorization: request.headers.authorization, payload });
      return { choices: [{ message: { content: JSON.stringify({ answer: '建议选择证据中的鸡肉饭，价格为 ¥12。', citationIds: ['dish-1'] }) } }] };
    });
    embeddingServer = requestServer(({ request, payload }) => {
      embeddingRequests.push({ path: request.url, authorization: request.headers.authorization, payload });
      return { data: payload.input.map((_, index) => ({ index, embedding: [1, index, 0, 0] })) };
    });
    [chatBaseUrl, embeddingBaseUrl] = await Promise.all([listen(chatServer), listen(embeddingServer)]);
  });

  after(async () => {
    await Promise.all([close(chatServer), close(embeddingServer)]);
  });

  it('routes chat and batched embeddings to independent endpoints and credentials', async () => {
    const result = await withAiRuntimeConfig({
      chatBaseUrl,
      chatApiKey: 'chat-secret',
      chatModel: 'deepseek-test',
      embeddingBaseUrl,
      embeddingApiKey: 'embedding-secret',
      embeddingModel: 'qwen-test',
      embeddingDimension: 4,
      embeddingBatchSize: 2,
      vectorMode: 'active',
    }, async () => {
      const status = getAiProviderStatus();
      const embeddings = await createEmbeddings(['first', 'second']);
      const grounded = await generateGroundedAgentAnswer({
        query: '推荐一份午餐',
        intent: 'dish_search',
        deterministicAnswer: '找到鸡肉饭。',
        citations: [{ id: 'dish-1', sourceType: 'dish', title: '鸡肉饭', snippet: '鸡肉饭，¥12，当前可售' }],
      });
      return { status, embeddings, grounded };
    });

    assert.equal(result.status.chat.baseUrl, chatBaseUrl);
    assert.equal(result.status.embedding.baseUrl, embeddingBaseUrl);
    assert.equal(result.status.embedding.dimension, 4);
    assert.equal(result.status.embedding.vectorMode, 'active');
    assert.deepEqual(result.embeddings, [[1, 0, 0, 0], [1, 1, 0, 0]]);
    assert.equal(result.grounded.answer.includes('鸡肉饭'), true);
    assert.deepEqual(result.grounded.citationIds, ['dish-1']);
    assert.equal(chatRequests.at(-1).authorization, 'Bearer chat-secret');
    assert.equal(chatRequests.at(-1).payload.model, 'deepseek-test');
    assert.equal(embeddingRequests.at(-1).authorization, 'Bearer embedding-secret');
    assert.equal(embeddingRequests.at(-1).payload.model, 'qwen-test');
  });

  it('rejects unknown citations and unsupported price claims', () => {
    const citations = [{ id: 'dish-1', title: '鸡肉饭', snippet: '价格 ¥12' }];
    assert.equal(validateGroundedAgentAnswer({ answer: '推荐鸡肉饭。', citationIds: ['unknown'] }, citations).reason, 'UNKNOWN_CITATION');
    assert.equal(validateGroundedAgentAnswer({ answer: '推荐鸡肉饭，价格 ¥99。', citationIds: ['dish-1'] }, citations).reason, 'UNSUPPORTED_PRICE_CLAIM');
    assert.equal(validateGroundedAgentAnswer({ answer: '推荐鸡肉饭，价格99元。', citationIds: ['dish-1'] }, citations).reason, 'UNSUPPORTED_PRICE_CLAIM');
    assert.equal(validateGroundedAgentAnswer({ answer: '鸡肉饭约500kcal。', citationIds: ['dish-1'] }, citations).reason, 'UNSUPPORTED_PRICE_CLAIM');
  });

  it('opens a request-local chat circuit after routing fails and skips grounded generation', async () => {
    let requestCount = 0;
    const failingServer = createServer(async (request, response) => {
      requestCount += 1;
      for await (const _chunk of request) { /* drain request */ }
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'provider unavailable' } }));
    });
    const failingBaseUrl = await listen(failingServer);
    try {
      const result = await withAiRuntimeConfig({
        chatBaseUrl: failingBaseUrl,
        chatApiKey: 'chat-secret',
        chatModel: 'deepseek-test',
        chatTimeoutMs: 1000,
      }, async () => {
        await assert.rejects(generateAgentToolCalls({
          query: '推荐午餐',
          tools: [{ name: 'dish.search', title: '找菜', parameters: { type: 'object', properties: {} } }],
        }), /provider unavailable/);
        const grounded = await generateGroundedAgentAnswer({
          query: '推荐午餐',
          intent: 'dish_search',
          deterministicAnswer: '确定性回答',
          citations: [{ id: 'dish-1', sourceType: 'dish', title: '鸡肉饭', snippet: '当前可售' }],
        });
        return { grounded, status: getAiProviderStatus() };
      });
      assert.equal(requestCount, 1);
      assert.equal(result.grounded.reason, 'CHAT_PROVIDER_CIRCUIT_OPEN');
      assert.equal(result.status.chat.circuitOpen, true);
    } finally {
      await close(failingServer);
    }
  });
});

describe('local 1024-compatible SQLite experiment contracts', () => {
  it('batches embeddings, records experiment metadata, and skips unchanged content', async () => {
    const db = openDatabase(':memory:');
    const documents = Array.from({ length: 5 }, (_, index) => document(`concept-${index}`, `概念 ${index}`));
    const calls = [];
    const singleProvider = async () => [1, 0, 0, 0];
    try {
      const options = {
        embeddingProvider: singleProvider,
        embeddingBatchProvider: async (inputs) => {
          calls.push(inputs);
          return inputs.map((_, index) => [1, index, 0, 0]);
        },
        embeddingModel: 'qwen-local-test',
        embeddingDimension: 4,
        embeddingBatchSize: 2,
        embeddingConcurrency: 1,
        vectorMode: 'active',
      };
      const first = await upsertRetrievalDocuments(db, documents, options);
      const second = await upsertRetrievalDocuments(db, documents, options);
      assert.equal(first.embeddedCount, 5);
      assert.equal(first.batchCount, 3);
      assert.deepEqual(calls.map((items) => items.length), [2, 2, 1]);
      assert.equal(second.skippedCount, 5);
      assert.equal(calls.length, 3);

      const status = await getRetrievalIndexStatus(db, { tenantId: '__global__' });
      assert.equal(status.embeddedCount, 5);
    } finally {
      db.close();
    }
  });

  it('keeps shadow ranking lexical while exposing vector comparison, then activates vector recall explicitly', async () => {
    const db = openDatabase(':memory:');
    const queryProvider = async () => [0, 1, 0, 0];
    try {
      await upsertRetrievalDocuments(db, [
        document('concept-a', '甲概念', '完全不同的中文描述'),
        document('concept-b', '乙概念', '另一个无关描述'),
      ], {
        embeddingProvider: queryProvider,
        embeddingBatchProvider: async () => [[1, 0, 0, 0], [0, 1, 0, 0]],
        embeddingModel: 'qwen-local-test',
        embeddingDimension: 4,
        vectorMode: 'active',
      });

      const shadow = await searchRetrievalIndex(db, 'semantic-query-zzz', {
        tenantId: '__global__',
        sourceTypes: ['campus_dining_knowledge'],
        embeddingProvider: queryProvider,
        embeddingModel: 'qwen-local-test',
        embeddingDimension: 4,
        vectorMode: 'shadow',
      });
      assert.deepEqual(shadow.items, []);
      assert.deepEqual(shadow.meta.retrievalModes, ['lexical', 'vector_shadow']);
      assert.equal(shadow.meta.trace.vectorTopIds[0], 'concept-b');

      const active = await searchRetrievalIndex(db, 'semantic-query-zzz', {
        tenantId: '__global__',
        sourceTypes: ['campus_dining_knowledge'],
        embeddingProvider: queryProvider,
        embeddingModel: 'qwen-local-test',
        embeddingDimension: 4,
        vectorMode: 'active',
        channels: ['vector'],
      });
      assert.equal(active.items[0].sourceId, 'concept-b');
      assert.equal(active.items[0].matchReasons.includes('semantic'), true);
      assert.equal(active.meta.embeddingDimension, 4);
    } finally {
      db.close();
    }
  });

  it('coalesces concurrent query embeddings across retrieval scopes', async () => {
    const db = openDatabase(':memory:');
    let providerCalls = 0;
    const queryProvider = async () => {
      providerCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return [0, 1, 0, 0];
    };
    try {
      clearRetrievalEmbeddingCache();
      await upsertRetrievalDocuments(db, [
        document('concept-concurrent', 'Concurrent concept', 'Shared semantic query'),
      ], {
        embeddingProvider: queryProvider,
        embeddingBatchProvider: async () => [[0, 1, 0, 0]],
        embeddingModel: 'qwen-concurrent-test',
        embeddingDimension: 4,
        vectorMode: 'active',
      });

      const options = {
        tenantId: '__global__',
        sourceTypes: ['campus_dining_knowledge'],
        embeddingProvider: queryProvider,
        embeddingModel: 'qwen-concurrent-test',
        embeddingDimension: 4,
        vectorMode: 'active',
        channels: ['vector'],
      };
      const results = await Promise.all([
        searchRetrievalIndex(db, 'same concurrent query', options),
        searchRetrievalIndex(db, 'same concurrent query', options),
        searchRetrievalIndex(db, 'same concurrent query', options),
      ]);

      assert.equal(providerCalls, 1);
      assert.equal(results.every((result) => result.items[0]?.sourceId === 'concept-concurrent'), true);
    } finally {
      clearRetrievalEmbeddingCache();
      db.close();
    }
  });

  it('does not allow an experiment dimension to be written into vector(1536)', async () => {
    const db = {
      async query(sql) {
        return this.pool.query(sql);
      },
      pool: {
        async query(sql) {
          if (sql.includes('FROM pg_extension')) {
            return { rows: [{ has_vector: true, has_trgm: true, embedding_type: 'vector(1536)', has_hnsw: true, has_trigram_index: true }] };
          }
          return { rows: [] };
        },
      },
    };
    await assert.rejects(
      upsertRetrievalDocuments(db, [document('concept-a', '概念 A')], {
        embeddingProvider: async () => [1, 0, 0, 0],
        embeddingModel: 'qwen-local-test',
        embeddingDimension: 4,
        vectorMode: 'active',
      }),
      (error) => error.code === 'POSTGRES_EMBEDDING_DIMENSION_UNSUPPORTED',
    );
  });
});
