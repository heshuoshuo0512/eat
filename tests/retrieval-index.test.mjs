import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from '../server/database.js';
import {
  RETRIEVAL_EMBEDDING_DIM,
  buildDishIndexDocuments,
  deleteRetrievalSource,
  getRetrievalIndexStatus,
  reindexRetrieval,
  retrievalDocumentId,
  searchRetrievalIndex,
  upsertRetrievalDocuments,
  validateEmbedding,
} from '../server/retrievalIndex.js';

const ROOT = resolve(import.meta.dirname, '..');
const vector1536 = () => Array.from({ length: RETRIEVAL_EMBEDDING_DIM }, (_, index) => index === 0 ? 1 : 0);

function document(tenantId, sourceId, title, content = title) {
  return {
    tenantId,
    sourceType: 'dish',
    sourceId,
    title,
    content,
    searchText: `${title} ${content}`,
    metadata: { tenantId, dishId: sourceId },
  };
}

describe('retrieval index contracts', () => {
  it('builds tenant-qualified deterministic document IDs', () => {
    const first = retrievalDocumentId({ tenantId: 'tenant-a', sourceType: 'dish', sourceId: 'dish-1' });
    const second = retrievalDocumentId({ tenantId: 'tenant-b', sourceType: 'dish', sourceId: 'dish-1' });
    assert.match(first, /^retrieval:tenant-a:dish:dish-1:chunk:0$/);
    assert.notEqual(first, second);
  });

  it('accepts only finite 1536-dimension production embeddings', () => {
    assert.equal(validateEmbedding(vector1536()).length, RETRIEVAL_EMBEDDING_DIM);
    assert.throws(() => validateEmbedding([1, 2, 3]), (error) => error.code === 'EMBEDDING_DIMENSION_MISMATCH');
    const invalid = vector1536();
    invalid[2] = Number.NaN;
    assert.throws(() => validateEmbedding(invalid), (error) => error.code === 'INVALID_EMBEDDING');
  });

  it('builds dish documents with location, allergens, nutrition and tenant metadata', () => {
    const documents = buildDishIndexDocuments([
      {
        id: 'dish-1', tenantId: 'tenant-a', stallId: 'stall-1', name: '番茄鸡蛋面', price: 12,
        taste: '清淡', cuisine: '面食', ingredients: ['番茄', '鸡蛋'], allergens: ['蛋类'],
        tags: ['高蛋白'], mealTypes: ['lunch'], halal: false,
        nutrition: { calories: 420, protein: 20, fat: 10, carbs: 60 }, description: '现煮面食',
      },
    ], [
      { id: 'stall-1', canteenId: 'canteen-1', name: '面食窗口' },
    ], [
      { id: 'canteen-1', name: '第一食堂' },
    ], 'tenant-a');
    assert.equal(documents.length, 1);
    assert.equal(documents[0].metadata.tenantId, 'tenant-a');
    assert.equal(documents[0].metadata.canteenName, '第一食堂');
    assert.deepEqual(documents[0].metadata.allergens, ['蛋类']);
    assert.match(documents[0].content, /420 kcal/);
    assert.match(documents[0].searchText, /番茄 鸡蛋/);
  });
});

describe('SQLite retrieval fallback', () => {
  it('keeps same source ID isolated by tenant and searches only requested source types', async () => {
    const db = openDatabase(':memory:');
    try {
      await upsertRetrievalDocuments(db, [
        document('tenant-a', 'dish-shared', '番茄鸡蛋面', '番茄 鸡蛋 清淡 面食'),
        document('tenant-b', 'dish-shared', '麻辣牛肉面', '牛肉 麻辣 面食'),
      ], { embeddingProvider: async () => vector1536() });

      const tenantA = await searchRetrievalIndex(db, '番茄鸡蛋', { tenantId: 'tenant-a', sourceTypes: ['dish'], embeddingProvider: null });
      const tenantB = await searchRetrievalIndex(db, '番茄鸡蛋', { tenantId: 'tenant-b', sourceTypes: ['dish'], embeddingProvider: null });
      assert.equal(tenantA.items.length, 1);
      assert.equal(tenantA.items[0].sourceId, 'dish-shared');
      assert.equal(tenantA.items[0].tenantId, 'tenant-a');
      assert.equal(tenantB.items.length, 0);
    } finally {
      db.close();
    }
  });

  it('is idempotent and skips unchanged documents with a current embedding', async () => {
    const db = openDatabase(':memory:');
    let embeddingCalls = 0;
    const provider = async () => {
      embeddingCalls += 1;
      return vector1536();
    };
    try {
      const source = document('tenant-a', 'dish-1', '青菜豆腐', '青菜 豆腐 清淡');
      const first = await upsertRetrievalDocuments(db, [source], { embeddingProvider: provider, embeddingModel: 'test-1536' });
      const second = await upsertRetrievalDocuments(db, [source], { embeddingProvider: provider, embeddingModel: 'test-1536' });
      assert.equal(first.indexedCount, 1);
      assert.equal(second.skippedCount, 1);
      assert.equal(embeddingCalls, 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rag_documents').get().count, 1);
    } finally {
      db.close();
    }
  });

  it('falls back to lexical retrieval when query embedding has the wrong dimension', async () => {
    const db = openDatabase(':memory:');
    try {
      await upsertRetrievalDocuments(db, [document('tenant-a', 'dish-1', '菌菇鸡肉饭', '菌菇 鸡肉 高蛋白')], { embeddingProvider: null });
      const result = await searchRetrievalIndex(db, '菌菇鸡肉', {
        tenantId: 'tenant-a',
        sourceTypes: ['dish'],
        embeddingProvider: async () => [1, 2, 3],
        embeddingModel: 'wrong-dimension-query-model',
      });
      assert.equal(result.items[0].sourceId, 'dish-1');
      assert.equal(result.meta.degraded, true);
      assert.equal(result.meta.retrievalModes.includes('vector'), false);
      assert.equal(result.warnings[0].code, 'EMBEDDING_DIMENSION_MISMATCH');
    } finally {
      db.close();
    }
  });

  it('uses only documents embedded with the current model for SQLite vector retrieval', async () => {
    const db = openDatabase(':memory:');
    try {
      await upsertRetrievalDocuments(db, [
        document('tenant-a', 'dish-old', '甲项', '红色方块'),
      ], { embeddingProvider: async () => vector1536(), embeddingModel: 'old-model' });
      await upsertRetrievalDocuments(db, [
        document('tenant-a', 'dish-current', '乙项', '蓝色圆形'),
      ], { embeddingProvider: async () => vector1536(), embeddingModel: 'current-model' });

      const result = await searchRetrievalIndex(db, '高蛋白午餐', {
        tenantId: 'tenant-a',
        sourceTypes: ['dish'],
        embeddingProvider: async () => vector1536(),
        embeddingModel: 'current-model',
      });

      assert.deepEqual(result.items.map((item) => item.sourceId), ['dish-current']);
      assert.deepEqual(result.items[0].matchReasons, ['semantic']);
      assert.equal(result.meta.vectorDocumentCount, 1);
      assert.equal(result.meta.embeddingModelMismatchCount, 1);
      assert.equal(result.meta.degraded, true);
      assert.ok(result.meta.retrievalModes.includes('vector'));
      assert.equal(result.warnings[0].code, 'EMBEDDING_MODEL_MISMATCH');

      await deleteRetrievalSource(db, { tenantId: 'tenant-a', sourceType: 'dish', sourceId: 'dish-current' });
      const onlyOldModel = await searchRetrievalIndex(db, '高蛋白午餐', {
        tenantId: 'tenant-a',
        sourceTypes: ['dish'],
        embeddingProvider: async () => vector1536(),
        embeddingModel: 'current-model',
      });
      assert.deepEqual(onlyOldModel.meta.retrievalModes, ['lexical']);
      assert.equal(onlyOldModel.meta.vectorDocumentCount, 0);
      assert.equal(onlyOldModel.meta.degraded, true);
      assert.equal(onlyOldModel.warnings[0].code, 'EMBEDDING_MODEL_MISMATCH');
    } finally {
      db.close();
    }
  });

  it('excludes malformed stored SQLite vectors and reports lexical degradation', async () => {
    const db = openDatabase(':memory:');
    try {
      const source = document('tenant-a', 'dish-invalid', '低脂套餐', '低脂 套餐');
      await upsertRetrievalDocuments(db, [source], { embeddingProvider: null });
      db.prepare('UPDATE rag_documents SET embedding_json = ?, embedding_model = ? WHERE source_id = ?')
        .run(JSON.stringify([1, 2, 3]), 'stored-invalid-model', source.sourceId);

      const result = await searchRetrievalIndex(db, '低脂套餐', {
        tenantId: 'tenant-a',
        sourceTypes: ['dish'],
        embeddingProvider: async () => vector1536(),
        embeddingModel: 'stored-invalid-model',
      });

      assert.equal(result.items[0].sourceId, 'dish-invalid');
      assert.equal(result.items[0].matchReasons.includes('semantic'), false);
      assert.equal(result.meta.vectorDocumentCount, 0);
      assert.equal(result.meta.invalidEmbeddingDimensionCount, 1);
      assert.equal(result.meta.degraded, true);
      assert.deepEqual(result.meta.retrievalModes, ['lexical']);
      assert.equal(result.warnings[0].code, 'STORED_EMBEDDING_DIMENSION_MISMATCH');
    } finally {
      db.close();
    }
  });

  it('rebuilds injected dish and health snapshots, reports status, prunes, and deletes by tenant source', async () => {
    const db = openDatabase(':memory:');
    const dishes = [{
      id: 'dish-1', tenantId: 'tenant-a', stallId: 'stall-1', name: '低脂鸡肉饭', price: 16,
      taste: '清淡', cuisine: '简餐', ingredients: ['鸡肉', '杂粮'], tags: ['低脂'], allergens: [],
      mealTypes: ['lunch'], nutrition: { calories: 460, protein: 32, fat: 8, carbs: 55 }, description: '高蛋白午餐',
    }];
    const stalls = [{ id: 'stall-1', canteenId: 'canteen-1', name: '轻食窗口' }];
    const canteens = [{ id: 'canteen-1', name: '第一食堂' }];
    const healthDocuments = [{
      sourceType: 'health_knowledge', sourceId: 'health:protein', chunkIndex: 0,
      title: '蛋白质摄入', content: '均衡饮食应结合个体情况安排蛋白质来源。', metadata: { citation: 'internal' },
    }];
    try {
      const rebuilt = await reindexRetrieval(db, {
        tenantId: 'tenant-a', dishes, stalls, canteens, healthDocuments, embeddingProvider: null,
      });
      assert.equal(rebuilt.documentCount, 2);
      assert.equal(rebuilt.failureCount, 0);
      const status = await getRetrievalIndexStatus(db, { tenantId: 'tenant-a' });
      assert.equal(status.ready, true);
      assert.equal(status.documentCount, 2);
      assert.equal(status.latestRun.status, 'completed');

      const deleted = await deleteRetrievalSource(db, { tenantId: 'tenant-a', sourceType: 'dish', sourceId: 'dish-1' });
      assert.equal(deleted.deletedCount, 1);
      const afterDelete = await getRetrievalIndexStatus(db, { tenantId: 'tenant-a' });
      assert.equal(afterDelete.documentCount, 1);
    } finally {
      db.close();
    }
  });
});

describe('PostgreSQL retrieval migration', () => {
  it('filters PostgreSQL vector retrieval by the current embedding model', async () => {
    const calls = [];
    const db = {
      pool: {
        async query(sql, params = []) {
          calls.push({ sql, params });
          if (sql.includes('FROM pg_extension')) {
            return { rows: [{ has_vector: true, has_trgm: true, embedding_type: 'vector(1536)', has_hnsw: true, has_trigram_index: true }] };
          }
          if (sql.includes('COUNT(*) FILTER')) {
            return { rows: [{ candidate_count: '1', embedded_count: '1', compatible_count: '1', model_mismatch_count: '0' }] };
          }
          return { rows: [] };
        },
      },
    };

    const result = await searchRetrievalIndex(db, 'semantic query', {
      tenantId: 'tenant-a',
      sourceTypes: ['dish'],
      embeddingProvider: async () => vector1536(),
      embeddingModel: 'current-model',
    });

    const vectorCall = calls.find((call) => call.sql.includes('ORDER BY embedding <=>'));
    assert.ok(vectorCall);
    assert.match(vectorCall.sql, /embedding_model = \$6/);
    assert.equal(vectorCall.params[5], 'current-model');
    assert.deepEqual(result.meta.retrievalModes, ['lexical', 'vector']);
    assert.equal(result.meta.degraded, false);
  });

  it('counts only live PostgreSQL vectors in index status', async () => {
    let countSql = '';
    const db = {
      pool: {
        async query(sql) {
          if (sql.includes('FROM pg_extension')) {
            return { rows: [{ has_vector: true, has_trgm: true, embedding_type: 'vector(1536)', has_hnsw: true, has_trigram_index: true }] };
          }
          return { rows: [] };
        },
      },
      prepare(sql) {
        if (sql.includes('GROUP BY source_type')) countSql = sql;
        return {
          all: async () => [{ source_type: 'dish', document_count: '2', embedded_count: '1', last_indexed_at: null }],
          get: async () => undefined,
        };
      },
    };

    const status = await getRetrievalIndexStatus(db, { tenantId: 'tenant-a' });
    assert.match(countSql, /embedding IS NOT NULL/);
    assert.doesNotMatch(countSql, /embedding_json IS NOT NULL/);
    assert.equal(status.embeddedCount, 1);
  });

  it('uses fail-fast extensions, vector(1536), tenant uniqueness, trigram and HNSW indexes', () => {
    const migration = readFileSync(resolve(ROOT, 'migrations/postgres/002_retrieval_pgvector.sql'), 'utf8');
    assert.match(migration, /CREATE EXTENSION IF NOT EXISTS vector/);
    assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pg_trgm/);
    assert.match(migration, /vector\(1536\)/);
    assert.match(migration, /tenant_id, source_type, source_id, chunk_index/);
    assert.match(migration, /gin\(search_text gin_trgm_ops\)/);
    assert.match(migration, /USING hnsw\(embedding vector_cosine_ops\)/);
    assert.doesNotMatch(migration, /EXCEPTION WHEN OTHERS THEN\s+NULL/i);
  });

  it('uses the pgvector PostgreSQL 17 image', () => {
    const compose = readFileSync(resolve(ROOT, 'docker-compose.yml'), 'utf8');
    assert.match(compose, /image:\s*pgvector\/pgvector:pg17/);
  });

  it('does not expose a label-only embedding model override in the reindex CLI', () => {
    const script = readFileSync(resolve(ROOT, 'scripts/reindex-retrieval.mjs'), 'utf8');
    assert.doesNotMatch(script, /--embedding-model/);
  });
});
