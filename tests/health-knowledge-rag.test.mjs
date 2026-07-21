import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/database.js';
import { loadHealthKnowledgeDocuments, loadHealthKnowledgeBase } from '../server/healthKnowledgeBase.js';
import { searchRetrievalIndex } from '../server/retrievalIndex.js';

describe('health knowledge base RAG integration', () => {
  it('loads verified health extracts with citation metadata and chunks', () => {
    const documents = loadHealthKnowledgeDocuments({ chunkSize: 400, chunkOverlap: 40 });
    assert.ok(documents.length > 0);
    assert.ok(documents.some((doc) => doc.metadata.sourceFile.includes('WHO-healthy-diet')));
    assert.ok(documents.some((doc) => doc.metadata.sourceFile.includes('FDA-food-allergy')));
    assert.ok(documents.every((doc) => doc.sourceType === 'health_knowledge'));
    assert.ok(documents.every((doc) => doc.metadata.sourceStatus));
    assert.ok(documents.every((doc) => doc.metadata.citation));
    assert.equal(new Set(documents.map((doc) => doc.id)).size, documents.length);
    assert.ok(documents.every((doc) => Number.isInteger(doc.metadata.chunkIndex)));
  });

  it('persists tenant-safe chunks and retrieves a health citation through the retrieval index', async () => {
    const db = openDatabase(':memory:');
    try {
      const imported = await loadHealthKnowledgeBase(db, { chunkSize: 500, chunkOverlap: 50 });
      assert.ok(imported.count > 0);
      const result = await searchRetrievalIndex(db, '过敏原 交叉污染 呼吸困难', {
        tenantId: 'default',
        sourceTypes: ['health_knowledge'],
        limit: 8,
        embeddingProvider: null
      });
      assert.ok(result.items.length);
      assert.equal(result.meta.degraded, true);
      const health = result.items.find((item) => item.sourceType === 'health_knowledge');
      assert.ok(health, 'expected a health knowledge citation');
      assert.equal(health.metadata.sourceStatus, 'verified_page');
      assert.ok(health.metadata.sourceFile.includes('FDA-food-allergy'));
      assert.match(health.id, /^retrieval:default:health_knowledge:/);
    } finally {
      db.close();
    }
  });

  it('fails clearly for a missing knowledge base directory', () => {
    assert.throws(() => loadHealthKnowledgeDocuments({ root: 'data/does-not-exist' }), /健康知识库目录不存在/);
  });
});
