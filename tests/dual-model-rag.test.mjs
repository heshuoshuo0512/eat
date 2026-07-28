import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  createEmbeddings,
  generateDishAnnotationCandidates,
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
    const result = await handler({ request, payload });
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
      if (payload.messages?.[0]?.content?.includes('校园食堂菜品数据预标注器')) {
        return {
          model: 'provider-resolved-model',
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ annotations: [{ dishId: 'dish-1' }] }) } }],
        };
      }
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
    assert.equal(result.grounded.firstPassAccepted, true);
    assert.equal(result.grounded.repairAttempted, false);
    assert.equal(result.grounded.promptVersion, 'grounded-answer-v2');
    assert.equal('rejectedOutput' in result.grounded, false);
    assert.equal(chatRequests.at(-1).authorization, 'Bearer chat-secret');
    assert.equal(chatRequests.at(-1).payload.model, 'deepseek-test');
    const groundedPrompt = JSON.parse(chatRequests.at(-1).payload.messages.at(-1).content);
    assert.deepEqual(groundedPrompt.evidence[0].evidenceClasses, ['tenant_fact']);
    assert.deepEqual(groundedPrompt.requirements.allowedCitationIds, ['dish-1']);
    assert.equal(chatRequests.at(-1).payload.temperature, 0);
    assert.equal(embeddingRequests.at(-1).authorization, 'Bearer embedding-secret');
    assert.equal(embeddingRequests.at(-1).payload.model, 'qwen-test');
    assert.equal(embeddingRequests.at(-1).payload.dimensions, 4);
  });

  it('hoists repeated annotation health evidence while retaining per-dish allowed ids', async () => {
    const generated = await withAiRuntimeConfig({
      chatBaseUrl,
      chatApiKey: 'chat-secret',
      chatModel: 'claude-test',
    }, () => generateDishAnnotationCandidates({
      dishes: [{
        dish: { id: 'dish-1', name: '测试菜' },
        concepts: [],
        foodCompositionReferences: [],
        healthKnowledge: [{ id: 'health-1', title: '共享知识', content: '只用于边界说明' }],
      }],
      knowledge: { authority: 'ai_estimated' },
      promptVersion: 'test-v1',
    }));

    const request = chatRequests.at(-1).payload;
    const modelInput = JSON.parse(request.messages[1].content);
    assert.deepEqual(modelInput.dishes[0].healthKnowledgeIds, ['health-1']);
    assert.equal(modelInput.dishes[0].healthKnowledge, undefined);
    assert.equal(modelInput.knowledge.healthKnowledge[0].id, 'health-1');
    assert.ok(modelInput.outputSchema.properties.annotations.items.required.includes('fieldConfidence'));
    assert.equal(request.reasoning_effort, 'low');
    assert.equal(request.max_tokens, 12_000);
    assert.equal(generated.model, 'provider-resolved-model');
    assert.equal(generated.finishReason, 'stop');
    assert.deepEqual(generated.usage, { promptTokens: 100, completionTokens: 20, totalTokens: 120 });
  });

  it('rejects unknown citations and unsupported price claims', () => {
    const citations = [{ id: 'dish-1', title: '鸡肉饭', snippet: '价格 ¥12' }];
    assert.equal(validateGroundedAgentAnswer({ answer: '推荐鸡肉饭。', citationIds: ['unknown'] }, citations).reason, 'UNKNOWN_CITATION');
    assert.equal(validateGroundedAgentAnswer({ answer: '推荐鸡肉饭，价格 ¥99。', citationIds: ['dish-1'] }, citations).reason, 'UNSUPPORTED_PRICE_CLAIM');
    assert.equal(validateGroundedAgentAnswer({ answer: '推荐鸡肉饭，价格99元。', citationIds: ['dish-1'] }, citations).reason, 'UNSUPPORTED_PRICE_CLAIM');
    assert.equal(validateGroundedAgentAnswer({ answer: '鸡肉饭约500kcal。', citationIds: ['dish-1'] }, citations).reason, 'UNSUPPORTED_PRICE_CLAIM');
  });

  it('repairs a rejected grounded answer once without adding evidence', async () => {
    let requestCount = 0;
    const repairServer = requestServer(({ payload }) => {
      requestCount += 1;
      const input = JSON.parse(payload.messages.at(-1).content);
      if (requestCount === 1) {
        return { choices: [{ message: { content: JSON.stringify({ answer: '可以放心吃。', citationIds: ['dish-unknown'] }) } }] };
      }
      assert.equal(input.task, 'repair_grounded_answer_once');
      assert.equal(input.failureReason, 'UNSUPPORTED_SAFETY_CLAIM');
      assert.deepEqual(input.requirements.allowedCitationIds, ['dish-unknown']);
      const allergenWarning = input.requirements.evidenceRules[0].requiredStatements[0];
      return {
        choices: [{ message: { content: JSON.stringify({
          answer: allergenWarning,
          citationIds: ['dish-unknown'],
        }) } }],
      };
    });
    const repairBaseUrl = await listen(repairServer);
    try {
      const result = await withAiRuntimeConfig({
        chatBaseUrl: repairBaseUrl,
        chatApiKey: 'chat-secret',
        chatModel: 'deepseek-test',
      }, () => generateGroundedAgentAnswer({
        query: '这道菜能放心吃吗？',
        intent: 'dish_search',
        deterministicAnswer: '过敏信息未知。',
        citations: [{ id: 'dish-unknown', sourceType: 'dish', title: '测试菜', metadata: { safetyStatus: 'unknown' } }],
      }));
      assert.equal(requestCount, 2);
      assert.equal(result.firstPassAccepted, false);
      assert.equal(result.repairAttempted, true);
      assert.equal(result.repairAccepted, true);
      assert.equal(result.initialFailureReason, 'UNSUPPORTED_SAFETY_CLAIM');
      assert.equal(result.finalFailureReason, null);
      assert.deepEqual(result.citationIds, ['dish-unknown']);
    } finally {
      await close(repairServer);
    }
  });

  it('stops after one failed repair and returns a deterministic fallback signal', async () => {
    let requestCount = 0;
    const repairServer = requestServer(() => {
      requestCount += 1;
      return { choices: [{ message: { content: 'not-json' } }] };
    });
    const repairBaseUrl = await listen(repairServer);
    try {
      const result = await withAiRuntimeConfig({
        chatBaseUrl: repairBaseUrl,
        chatApiKey: 'chat-secret',
        chatModel: 'deepseek-test',
      }, () => generateGroundedAgentAnswer({
        query: '推荐午餐',
        intent: 'dish_search',
        deterministicAnswer: '使用确定性回答。',
        citations: [{ id: 'dish-1', sourceType: 'dish', title: '鸡肉饭' }],
      }));
      assert.equal(requestCount, 2);
      assert.equal(result.answer, null);
      assert.equal(result.repairAttempted, true);
      assert.equal(result.repairAccepted, false);
      assert.equal(result.initialFailureReason, 'INVALID_MODEL_JSON');
      assert.equal(result.finalFailureReason, 'INVALID_MODEL_JSON');
    } finally {
      await close(repairServer);
    }
  });

  it('reports chat timeouts with a stable provider error code', async () => {
    const slowServer = requestServer(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { choices: [{ message: { content: '{"answer":"late","citationIds":["dish-1"]}' } }] };
    });
    const slowBaseUrl = await listen(slowServer);
    try {
      await assert.rejects(withAiRuntimeConfig({
        chatBaseUrl: slowBaseUrl,
        chatApiKey: 'chat-secret',
        chatModel: 'deepseek-test',
        chatTimeoutMs: 10,
      }, () => generateGroundedAgentAnswer({
        query: '推荐午餐',
        citations: [{ id: 'dish-1', sourceType: 'dish', title: '鸡肉饭' }],
      })), (error) => error.code === 'AI_PROVIDER_TIMEOUT');
    } finally {
      await close(slowServer);
    }
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

      db.prepare("UPDATE rag_documents SET embedding_json = '[1,0,0]' WHERE source_id = 'concept-0'").run();
      const repaired = await upsertRetrievalDocuments(db, documents, options);
      assert.equal(repaired.embeddedCount, 1);
      assert.equal(repaired.skippedCount, 4);
      assert.equal(calls.length, 4);
      assert.equal(JSON.parse(db.prepare("SELECT embedding_json FROM rag_documents WHERE source_id = 'concept-0'").get().embedding_json).length, 4);

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

  it('does not allow an experiment dimension to be written into vector(1024)', async () => {
    const db = {
      async query(sql) {
        return this.pool.query(sql);
      },
      pool: {
        async query(sql) {
          if (sql.includes('FROM pg_extension')) {
            return { rows: [{ has_vector: true, has_trgm: true, embedding_type: 'vector(1024)', has_hnsw: true, has_trigram_index: true }] };
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
