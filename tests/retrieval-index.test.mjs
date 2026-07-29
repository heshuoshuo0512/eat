import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from '../server/database.js';
import {
  RETRIEVAL_EMBEDDING_DIM,
  buildCanteenIndexDocuments,
  buildDishIndexDocuments,
  buildStallIndexDocuments,
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

  it('accepts only finite 1024-dimension production embeddings', () => {
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

  it('uses approved area and venue introductions as location semantics without changing dish facts', () => {
    const approvedIntroduction = (factualSummary, recommendationCopy, id) => ({
      id, batchId: 'intro-batch', version: 1, status: 'approved', factualSummary, recommendationCopy,
      semanticLabels: ['赶课友好'], boundaryCodes: ['CATALOG_DERIVED'], evidenceIds: [`canteen:${id}`], confidence: { level: 'high', score: 0.9 },
    });
    const [document] = buildDishIndexDocuments([
      { id: 'dish-location', tenantId: 'tenant-a', stallId: 'stall-location', name: '鸡肉饭', price: 12, ingredients: [], allergens: [] },
    ], [
      { id: 'stall-location', canteenId: 'area-location', name: '米饭档' },
    ], [
      { id: 'venue-location', name: '燕鸣湖', introduction: approvedIntroduction('燕鸣湖是东区餐饮场所。', '从目录结构看可能适合多样化选餐。', 'venue-location') },
      { id: 'area-location', parentId: 'venue-location', name: '燕鸣湖二楼', introduction: approvedIntroduction('燕鸣湖二楼收录多个档口。', '从目录标签看可能适合赶课选餐。', 'area-location') },
    ], 'tenant-a');

    assert.match(document.searchText, /燕鸣湖二楼收录多个档口/);
    assert.match(document.searchText, /赶课选餐/);
    assert.match(document.content, /所属餐厅语义：目录事实摘要/);
    assert.match(document.content, /所属场所语义：目录推测建议/);
    assert.equal(document.metadata.evidenceType, 'tenant_dish_fact');
    assert.deepEqual(document.metadata.locationSemanticEvidence.map((item) => item.entityId), ['area-location', 'venue-location']);
  });

  it('adds explicit hierarchy terms to venue and dining-area retrieval documents', () => {
    const documents = buildCanteenIndexDocuments([
      { id: 'venue', tenantId: 'tenant-a', name: '西区大食堂' },
      { id: 'area', tenantId: 'tenant-a', name: '大榕树餐厅', parentId: 'venue' },
    ], 'tenant-a');
    assert.match(documents.find((item) => item.sourceId === 'venue').searchText, /餐饮场所.*食堂/);
    assert.match(documents.find((item) => item.sourceId === 'area').searchText, /餐厅.*楼层.*餐区/);
  });

  it('uses AI annotations only as explicitly estimated search evidence', () => {
    const documents = buildDishIndexDocuments([{
      id: 'dish-ai-1',
      tenantId: 'tenant-a',
      stallId: 'stall-1',
      name: '轻享餐',
      price: 15,
      ingredients: [],
      allergens: [],
      safetyDeclarations: [{ allergenCode: '*', status: 'unknown', source: 'menu_document' }],
      factStatus: { nutrition: 'unknown', recipe: 'unknown', halal: 'unknown', dietary: 'unknown', spice: 'unknown' },
      aiAnnotation: {
        dishId: 'dish-ai-1',
        factStatus: 'estimated',
        safetyStatus: 'unknown',
        aliases: ['鸡胸肉轻食'],
        cuisineCandidates: ['轻食'],
        cookingMethods: ['煮'],
        tasteProfiles: ['清淡'],
        spiceLevel: 0,
        mealTypes: ['lunch'],
        ingredientHypotheses: [{ name: '鸡胸肉', role: 'primary', confidence: 0.7, basis: 'model_prior', referenceIds: [] }],
        seasoningHypotheses: [],
        allergenHints: [{ allergenCode: 'soy', confidence: 0.3, reason: '调味方式可能使用酱油', referenceIds: [] }],
        nutritionEstimate: {
          basis: 'per_serving',
          portionAssumption: '按普通轻食一份估算',
          caloriesKcal: { min: 300, max: 650 },
          proteinG: { min: 15, max: 40 },
          fatG: { min: 5, max: 25 },
          carbsG: { min: 25, max: 75 },
          confidence: 0.4,
          referenceIds: [],
        },
        scenarioTags: ['训练后'],
        nutritionGoalTags: ['高蛋白候选'],
        linkedConceptIds: [],
        sourceIds: [],
        uncertaintyNotes: ['真实配方待核验'],
        fieldConfidence: { ingredients: 0.7 },
      },
      aiAnnotationMeta: { id: 'annotation-1', batchId: 'pilot', model: 'deepseek-v4-flash', promptVersion: 'v1', status: 'schema_validated' },
    }], [{ id: 'stall-1', canteenId: 'canteen-1', name: '轻食档' }], [{ id: 'canteen-1', name: '第一食堂' }], 'tenant-a');

    assert.deepEqual(documents[0].metadata.ingredients, []);
    assert.deepEqual(documents[0].metadata.allergens, []);
    assert.equal(documents[0].metadata.factStatus.recipe, 'unknown');
    assert.equal(documents[0].metadata.aiEstimated.factStatus, 'estimated');
    assert.equal(documents[0].metadata.aiEstimated.safetyStatus, 'unknown');
    assert.deepEqual(documents[0].metadata.semanticEvidenceTypes, ['tenant_dish_fact', 'ai_estimated']);
    assert.match(documents[0].searchText, /鸡胸肉.*训练后.*高蛋白候选/);
    assert.match(documents[0].content, /AI预标注.*估算候选/s);
    assert.match(documents[0].content, /真实状态仍为未知/);
  });

  it('builds non-orderable stall documents with aliases and full service-area location', () => {
    const documents = buildStallIndexDocuments(
      [{ id: 'stall-east', tenantId: 'tenant-a', canteenId: 'east-dongdahuo', name: '益和堂', aliases: ['益禾堂'], floor: '未标注', open: false }],
      [
        { id: 'east-zone', name: '东区餐饮与服务区' },
        { id: 'east-dongdahuo', name: '东区东大活', parentId: 'east-zone' },
      ],
      'tenant-a',
    );
    assert.equal(documents.length, 1);
    assert.equal(documents[0].sourceType, 'stall');
    assert.match(documents[0].searchText, /益禾堂/);
    assert.match(documents[0].content, /东区餐饮与服务区 > 东区东大活 > 未标注/);
    assert.match(documents[0].content, /来源确认店铺与校园目录关系；预约状态由运营端独立维护/);
    assert.equal(documents[0].metadata.orderable, false);
    assert.equal(documents[0].metadata.supplyConfirmed, false);
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

  it('rebuilds tenant catalog and global health snapshots in separate scopes', async () => {
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
        tenantId: 'tenant-a', sourceTypes: ['dish', 'stall'], dishes, stalls, canteens, embeddingProvider: null,
      });
      assert.equal(rebuilt.documentCount, 2);
      assert.equal(rebuilt.failureCount, 0);
      const global = await reindexRetrieval(db, {
        tenantId: '__global__', sourceTypes: ['health_knowledge'], healthDocuments, embeddingProvider: null,
      });
      assert.equal(global.documentCount, 1);
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
      async query(sql, params = []) {
        return this.pool.query(sql, params);
      },
      pool: {
        async query(sql, params = []) {
          calls.push({ sql, params });
          if (sql.includes('FROM pg_extension')) {
            return { rows: [{ has_vector: true, has_trgm: true, embedding_type: 'vector(1024)', has_hnsw: true, has_trigram_index: true }] };
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

  it('uses fail-fast extensions, vector(1024), tenant uniqueness, trigram and HNSW indexes', () => {
    const migration = readFileSync(resolve(ROOT, 'migrations/postgres/002_retrieval_pgvector.sql'), 'utf8');
    assert.match(migration, /CREATE EXTENSION IF NOT EXISTS vector/);
    assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pg_trgm/);
    assert.match(migration, /vector\(1024\)/);
    assert.match(migration, /tenant_id, source_type, source_id, chunk_index/);
    assert.match(migration, /gin\(search_text gin_trgm_ops\)/);
    assert.match(migration, /USING hnsw\(embedding vector_cosine_ops\)/);
    assert.doesNotMatch(migration, /EXCEPTION WHEN OTHERS THEN\s+NULL/i);
  });

  it('uses the pgvector PostgreSQL 16 image', () => {
    const compose = readFileSync(resolve(ROOT, 'docker-compose.yml'), 'utf8');
    assert.match(compose, /image:\s*pgvector\/pgvector:pg16/);
  });

  it('does not expose a label-only embedding model override in the reindex CLI', () => {
    const script = readFileSync(resolve(ROOT, 'scripts/reindex-retrieval.mjs'), 'utf8');
    assert.doesNotMatch(script, /--embedding-model/);
  });
});
