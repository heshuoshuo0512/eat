import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/database.js';
import {
  loadCampusPolicyKnowledgeBase,
  loadHealthKnowledgeDocuments,
  loadHealthKnowledgeBase,
} from '../server/healthKnowledgeBase.js';
import { GLOBAL_KNOWLEDGE_TENANT_ID } from '../server/knowledgeGovernance.js';
import {
  pruneInvalidKnowledgeScopes,
  searchRetrievalIndex,
  upsertRetrievalDocuments,
} from '../server/retrievalIndex.js';
import { buildKnowledgeAnswer } from '../server/retrievalService.js';

describe('health knowledge base RAG integration', () => {
  it('loads verified health extracts with citation metadata and chunks', () => {
    const documents = loadHealthKnowledgeDocuments({ chunkSize: 400, chunkOverlap: 40 });
    assert.ok(documents.length > 0);
    assert.ok(documents.some((doc) => doc.metadata.sourceIds.includes('who-healthy-diet')));
    assert.ok(documents.some((doc) => doc.metadata.sourceIds.includes('fda-food-allergy')));
    assert.ok(documents.every((doc) => doc.sourceType === 'health_knowledge'));
    assert.ok(documents.every((doc) => doc.metadata.sourceStatus === 'approved'));
    assert.ok(documents.every((doc) => doc.metadata.citation));
    assert.ok(documents.every((doc) => doc.metadata.publisher));
    assert.ok(documents.every((doc) => doc.metadata.version));
    assert.ok(documents.every((doc) => doc.metadata.reviewedAt));
    assert.ok(documents.every((doc) => doc.metadata.license));
    assert.ok(documents.every((doc) => doc.metadata.factStatus));
    assert.ok(documents.every((doc) => !doc.metadata.sourceFile.includes('08_index_and_audit')));
    assert.equal(new Set(documents.map((doc) => doc.id)).size, documents.length);
    assert.ok(documents.every((doc) => Number.isInteger(doc.metadata.chunkIndex)));

    const answer = buildKnowledgeAnswer({ query: '怎样均衡饮食', results: documents.slice(0, 1) });
    assert.equal(answer.citations.length, 1);
    for (const field of ['knowledgeDomain', 'publisher', 'version', 'reviewedAt', 'license', 'factStatus']) {
      assert.ok(answer.citations[0][field], `citation should include ${field}`);
    }
  });

  it('persists global health and tenant campus-policy chunks in separate scopes', async () => {
    const db = openDatabase(':memory:');
    try {
      const imported = await loadHealthKnowledgeBase(db, { chunkSize: 500, chunkOverlap: 50 });
      assert.ok(imported.count > 0);
      const policy = await loadCampusPolicyKnowledgeBase(db, { tenantId: 'default' });
      assert.ok(policy.count > 0);
      const result = await searchRetrievalIndex(db, '过敏原 交叉污染 呼吸困难', {
        tenantId: GLOBAL_KNOWLEDGE_TENANT_ID,
        sourceTypes: ['health_knowledge'],
        limit: 8,
        embeddingProvider: null
      });
      assert.ok(result.items.length);
      assert.equal(result.meta.degraded, false);
      assert.equal(result.meta.vectorMode, 'off');
      assert.deepEqual(result.meta.retrievalModes, ['lexical']);
      const health = result.items.find((item) => item.sourceType === 'health_knowledge');
      assert.ok(health, 'expected a health knowledge citation');
      assert.equal(health.metadata.sourceStatus, 'approved');
      assert.ok(health.metadata.sourceFile.includes('safety-allergen-emergency'));
      assert.match(health.id, /^retrieval:__global__:health_knowledge:/);

      const campus = await searchRetrievalIndex(db, '退款规则和失物招领怎么处理', {
        tenantId: 'default',
        sourceTypes: ['campus_policy'],
        limit: 5,
        embeddingProvider: null,
      });
      assert.ok(campus.items.some((item) => item.sourceId === 'knowledge:campus-services-unverified'));
      const otherTenant = await searchRetrievalIndex(db, '退款规则和失物招领怎么处理', {
        tenantId: 'other-campus',
        sourceTypes: ['campus_policy'],
        limit: 5,
        embeddingProvider: null,
      });
      assert.equal(otherTenant.items.length, 0);
    } finally {
      db.close();
    }
  });

  it('rejects invalid knowledge scopes and removes legacy tenant health documents', async () => {
    const db = openDatabase(':memory:');
    try {
      await assert.rejects(
        loadHealthKnowledgeBase(db, { tenantId: 'default' }),
        (error) => error.code === 'GLOBAL_KNOWLEDGE_SCOPE_REQUIRED',
      );
      await assert.rejects(
        loadCampusPolicyKnowledgeBase(db, { tenantId: GLOBAL_KNOWLEDGE_TENANT_ID }),
        (error) => error.code === 'TENANT_POLICY_SCOPE_REQUIRED',
      );
      await upsertRetrievalDocuments(db, [{
        tenantId: 'default',
        sourceType: 'health_knowledge',
        sourceId: 'legacy-health',
        chunkIndex: 0,
        title: '旧租户健康知识',
        content: '此记录应从租户作用域移除。',
        metadata: {},
      }], { tenantId: 'default', embeddingProvider: null });
      const cleanup = await pruneInvalidKnowledgeScopes(db);
      assert.equal(cleanup.deletedCount, 1);
      const stale = await searchRetrievalIndex(db, '旧租户健康知识', {
        tenantId: 'default',
        sourceTypes: ['health_knowledge'],
        embeddingProvider: null,
      });
      assert.equal(stale.items.length, 0);
    } finally {
      db.close();
    }
  });

  it('fails clearly for a missing knowledge base directory', () => {
    assert.throws(() => loadHealthKnowledgeDocuments({ root: 'data/does-not-exist' }), /健康知识库目录不存在/);
  });
});
