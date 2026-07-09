import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  embedText,
  cosineSimilarity,
  buildDishDocuments,
  searchDocuments,
  searchByEmbedding,
  storeDocumentEmbeddings,
  searchDocumentsHybrid,
  answerMealQuestion,
} from '../server/rag.js';
import { openDatabase } from '../server/database.js';
import { dishes, stalls, canteens } from '../src/domain/seedData.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Open an in-memory SQLite DB with full schema (including rag_documents). */
function memoryDb() {
  return openDatabase(':memory:');
}

/** A tiny dish fixture for focused unit tests. */
function dish(overrides) {
  return {
    id: 'test-1',
    stallId: 's1',
    name: '测试菜品',
    price: 12,
    taste: '咸鲜',
    cuisine: '家常',
    ingredients: ['豆腐', '青菜'],
    tags: ['低脂'],
    halal: false,
    mealTypes: ['lunch'],
    nutrition: { calories: 300, protein: 18, fat: 8, carbs: 40 },
    rating: 4.5,
    reviewCount: 10,
    sales: 100,
    image: '🍽️',
    description: '清淡可口的家常菜',
    ...overrides,
  };
}

/* ================================================================== */
/*  1. embedText: deterministic, correct dimension, L2-normalised      */
/* ================================================================== */
describe('embedText', () => {
  it('returns an array of the default dimension (128)', () => {
    const vec = embedText('鸡胸肉沙拉');
    assert.ok(Array.isArray(vec));
    assert.equal(vec.length, 128);
  });

  it('respects custom dimension', () => {
    const vec = embedText('鸡胸肉沙拉', 64);
    assert.equal(vec.length, 64);
  });

  it('is deterministic — same input produces identical vector', () => {
    const a = embedText('高蛋白低脂餐');
    const b = embedText('高蛋白低脂餐');
    assert.deepEqual(a, b);
  });

  it('produces L2-normalised vectors (norm ≈ 1)', () => {
    const vec = embedText('番茄炒蛋');
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    assert.ok(Math.abs(norm - 1) < 1e-10, `norm was ${norm}`);
  });

  it('different texts produce different embeddings', () => {
    const a = embedText('鸡胸肉');
    const b = embedText('红烧肉');
    assert.notDeepEqual(a, b);
  });
});

/* ================================================================== */
/*  2. cosineSimilarity: mathematical properties                       */
/* ================================================================== */
describe('cosineSimilarity', () => {
  it('self-similarity of a normalised vector is 1', () => {
    const vec = embedText('测试文本');
    const sim = cosineSimilarity(vec, vec);
    assert.ok(Math.abs(sim - 1) < 1e-10, `sim was ${sim}`);
  });

  it('is symmetric: sim(a,b) === sim(b,a)', () => {
    const a = embedText('鸡胸肉');
    const b = embedText('红烧肉');
    assert.ok(Math.abs(cosineSimilarity(a, b) - cosineSimilarity(b, a)) < 1e-10);
  });

  it('orthogonal vectors have similarity 0', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    assert.equal(cosineSimilarity(a, b), 0);
  });

  it('opposite vectors have similarity -1', () => {
    const a = [1, 0];
    const b = [-1, 0];
    assert.ok(Math.abs(cosineSimilarity(a, b) - (-1)) < 1e-10);
  });

  it('handles zero vector without NaN', () => {
    const zero = [0, 0, 0];
    const vec = [1, 2, 3];
    const sim = cosineSimilarity(zero, vec);
    assert.ok(!Number.isNaN(sim), 'should not be NaN');
    assert.equal(sim, 0);
  });
});

/* ================================================================== */
/*  3. buildDishDocuments: correct shape from real seed data            */
/* ================================================================== */
describe('buildDishDocuments', () => {
  const docs = buildDishDocuments(dishes, stalls, canteens);

  it('produces one document per dish', () => {
    assert.equal(docs.length, dishes.length);
  });

  it('each document has required fields: id, sourceType, sourceId, title, content, metadata', () => {
    for (const doc of docs) {
      assert.ok(doc.id.startsWith('dish:'), `id: ${doc.id}`);
      assert.equal(doc.sourceType, 'dish');
      assert.ok(doc.sourceId, 'sourceId');
      assert.ok(doc.title, 'title');
      assert.ok(doc.content.length > 20, 'content should be substantive');
      assert.ok(doc.metadata && typeof doc.metadata === 'object', 'metadata');
    }
  });

  it('content includes dish name, ingredients, and nutrition keywords', () => {
    const chicken = docs.find((d) => d.sourceId === 'd-chicken-bowl');
    assert.ok(chicken, 'should find chicken bowl doc');
    assert.ok(chicken.content.includes('鸡胸'), 'content includes dish name');
    assert.ok(chicken.content.includes('kcal'), 'content includes calorie unit');
  });

  it('metadata carries dishId, price, and halal flag', () => {
    const chicken = docs.find((d) => d.sourceId === 'd-chicken-bowl');
    assert.equal(chicken.metadata.dishId, 'd-chicken-bowl');
    assert.equal(chicken.metadata.price, 16);
    assert.equal(chicken.metadata.halal, false);
  });
});

/* ================================================================== */
/*  4. searchByEmbedding: in-memory vector search                      */
/* ================================================================== */
describe('searchByEmbedding', () => {
  const docs = buildDishDocuments(dishes, stalls, canteens);
  const docsWithEmb = docs.map((d) => ({ ...d, embedding: embedText(d.content) }));

  it('finds the queried dish as the top result', () => {
    const query = embedText('鸡胸肉杂粮饭');
    const results = searchByEmbedding(query, docsWithEmb, 3);
    assert.ok(results.length > 0, 'should return results');
    assert.equal(results[0].sourceId, 'd-chicken-bowl');
  });

  it('returns results sorted by descending score', () => {
    const query = embedText('高蛋白');
    const results = searchByEmbedding(query, docsWithEmb, 5);
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].score >= results[i].score, 'should be sorted desc');
    }
  });

  it('includes snippet field (first 180 chars of content)', () => {
    const query = embedText('鸡胸肉');
    const results = searchByEmbedding(query, docsWithEmb, 1);
    assert.ok(results[0].snippet, 'should have snippet');
    assert.ok(results[0].snippet.length <= 180, 'snippet <= 180 chars');
  });

  it('respects limit parameter', () => {
    const query = embedText('菜品');
    const results = searchByEmbedding(query, docsWithEmb, 2);
    assert.ok(results.length <= 2);
  });
});

/* ================================================================== */
/*  5. storeDocumentEmbeddings + searchDocumentsHybrid (SQLite path)   */
/* ================================================================== */
describe('storeDocumentEmbeddings + searchDocumentsHybrid (SQLite)', () => {
  let db;
  const docs = buildDishDocuments(dishes, stalls, canteens);

  before(() => {
    db = memoryDb();
  });

  after(() => {
    db.close();
  });

  it('storeDocumentEmbeddings persists documents to rag_documents table', async () => {
    await storeDocumentEmbeddings(db, docs);
    const rows = db.prepare('SELECT COUNT(*) AS cnt FROM rag_documents').get();
    assert.equal(rows.cnt, docs.length);
  });

  it('stored rows have non-null embedding_json', () => {
    const row = db.prepare('SELECT embedding_json FROM rag_documents WHERE id = ?').get('dish:d-chicken-bowl');
    assert.ok(row, 'row should exist');
    const emb = JSON.parse(row.embedding_json);
    assert.ok(Array.isArray(emb), 'embedding should be an array');
    assert.equal(emb.length, 128, 'default dim is 128');
  });

  it('searchDocumentsHybrid retrieves stored documents via in-memory embedding path', async () => {
    const results = await searchDocumentsHybrid('鸡胸肉杂粮饭', db, 3);
    assert.ok(results, 'hybrid should return results');
    assert.ok(results.length > 0);
    assert.equal(results[0].sourceId, 'd-chicken-bowl');
    assert.ok(results[0].score > 0, 'should have positive score');
    assert.ok(results[0].snippet, 'should have snippet');
  });

  it('searchDocumentsHybrid finds relevant dish for different query terms', async () => {
    const results = await searchDocumentsHybrid('清真牛肉面', db, 5);
    assert.ok(results && results.length > 0);
    const beefNoodle = results.find((r) => r.sourceId === 'd-beef-noodle');
    assert.ok(beefNoodle, 'beef noodle should appear in results');
  });

  it('storeDocumentEmbeddings is idempotent (upsert)', async () => {
    await storeDocumentEmbeddings(db, docs);
    const rows = db.prepare('SELECT COUNT(*) AS cnt FROM rag_documents').get();
    assert.equal(rows.cnt, docs.length, 'count should not double');
  });
});

/* ================================================================== */
/*  6. searchDocumentsHybrid: graceful fallback when no embeddings      */
/* ================================================================== */
describe('searchDocumentsHybrid fallback behaviour', () => {
  it('returns null when rag_documents is empty', async () => {
    const db = memoryDb();
    try {
      const results = await searchDocumentsHybrid('任何查询', db, 5);
      assert.equal(results, null, 'should return null when no embeddings');
    } finally {
      db.close();
    }
  });

  it('returns null when db has no rag_documents table at all', async () => {
    // Minimal DB without the RAG table — simulates legacy schema
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    try {
      const results = await searchDocumentsHybrid('任何查询', db, 5);
      assert.equal(results, null, 'should return null on missing table');
    } finally {
      db.close();
    }
  });
});

/* ================================================================== */
/*  7. searchDocuments (lexical) behaviour                             */
/* ================================================================== */
describe('searchDocuments (lexical)', () => {
  const docs = buildDishDocuments(dishes, stalls, canteens);

  it('finds documents matching Chinese query terms', () => {
    const results = searchDocuments('鸡胸肉', docs, 3);
    assert.ok(results.length > 0);
    const chicken = results.find((r) => r.sourceId === 'd-chicken-bowl');
    assert.ok(chicken, 'chicken bowl should match');
    assert.ok(chicken.score > 0);
  });

  it('throws on empty query', () => {
    assert.throws(() => searchDocuments('', docs), /请输入检索问题/);
  });

  it('returns empty array when nothing matches', () => {
    const results = searchDocuments('xyznonexistent123', docs);
    assert.equal(results.length, 0);
  });

  it('includes snippet in results', () => {
    const results = searchDocuments('鸡胸肉', docs, 1);
    assert.ok(results[0].snippet, 'should have snippet');
  });
});

/* ================================================================== */
/*  8. answerMealQuestion: integration with DB and lexical fallback     */
/* ================================================================== */
describe('answerMealQuestion', () => {
  it('uses lexical search when no db is provided', async () => {
    const result = await answerMealQuestion({
      query: '推荐高蛋白的菜',
      profile: {},
      dishes,
      stalls,
      canteens,
    });
    assert.ok(result.answer, 'should have answer text');
    assert.ok(Array.isArray(result.citations), 'should have citations');
    assert.ok(result.citations.length > 0);
    assert.ok(result.plan, 'should have plan');
  });

  it('uses hybrid search when db has embeddings', async () => {
    const db = memoryDb();
    try {
      const docs = buildDishDocuments(dishes, stalls, canteens);
      await storeDocumentEmbeddings(db, docs);

      const result = await answerMealQuestion({
        query: '推荐高蛋白的菜',
        profile: {},
        dishes,
        stalls,
        canteens,
        db,
      });
      assert.ok(result.answer, 'should have answer');
      assert.ok(result.citations.length > 0, 'should have citations from hybrid');
      // Citations from hybrid should include score
      assert.ok(result.citations[0].score > 0, 'citation should have score');
    } finally {
      db.close();
    }
  });

  it('falls back to lexical when hybrid returns null (empty DB)', async () => {
    const db = memoryDb();
    try {
      const result = await answerMealQuestion({
        query: '推荐高蛋白的菜',
        profile: {},
        dishes,
        stalls,
        canteens,
        db,
      });
      assert.ok(result.answer, 'should have answer via lexical fallback');
      assert.ok(result.citations.length > 0, 'should have citations from lexical');
    } finally {
      db.close();
    }
  });

  it('throws on empty query', async () => {
    await assert.rejects(
      () => answerMealQuestion({ query: '', profile: {}, dishes, stalls, canteens }),
      /请输入咨询问题/,
    );
  });

  it('infers fatLoss goal from query keywords', async () => {
    const result = await answerMealQuestion({
      query: '我想减脂，推荐低热量的菜',
      profile: {},
      dishes,
      stalls,
      canteens,
    });
    assert.ok(result.plan.goalLabel.includes('减脂') || result.plan.goal === 'fatLoss',
      'should infer fatLoss goal');
  });
});
