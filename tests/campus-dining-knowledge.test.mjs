import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  buildCampusDiningIndexDocuments,
  deriveDishSemanticLabels,
  GLOBAL_KNOWLEDGE_TENANT_ID,
  interpretCampusDiningQuery,
  loadCampusDiningChallengeQueries,
  loadCampusDiningCorpus,
} from '../server/campusDiningKnowledgeBase.js';
import { createApp, inferAgentIntent } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { buildDishIndexDocuments, reindexRetrieval, searchRetrievalIndex } from '../server/retrievalIndex.js';
import { parseDishSearchRequest } from '../server/retrievalService.js';

const EXPECTED_CATEGORY_COUNTS = {
  dish_archetype: 220,
  ingredient: 90,
  flavor_method: 60,
  nutrition_role: 40,
  campus_scenario: 40,
  dietary_safety: 30,
  stall_format: 20,
};

const EXPECTED_QUERY_COUNTS = {
  dish_alias: 70,
  ingredient_flavor: 40,
  budget_meal_supply: 35,
  nutrition_goal: 40,
  dietary_safety: 45,
  campus_context: 30,
  multi_constraint_combination: 25,
  ambiguity_adversarial: 15,
};

function objectContains(actual, expected) {
  return Object.entries(expected).every(([key, value]) => {
    if (Array.isArray(value)) return value.every((item) => (actual[key] || []).includes(item));
    return actual[key] === value;
  });
}

describe('strict 500 concept and 300 query corpus', () => {
  const corpus = loadCampusDiningCorpus();

  it('meets exact category and query quotas without duplicate canonical records', () => {
    assert.equal(corpus.concepts.length, 500);
    assert.equal(corpus.queries.length, 300);
    assert.deepEqual(corpus.report.categoryCounts, EXPECTED_CATEGORY_COUNTS);
    assert.deepEqual(corpus.report.queryCounts, EXPECTED_QUERY_COUNTS);
    assert.equal(corpus.report.approvedConceptCount, 500);
    assert.equal(corpus.report.ambiguousAliasCount, 0);
    assert.equal(new Set(corpus.concepts.map((item) => item.id)).size, 500);
    assert.equal(new Set(corpus.concepts.map((item) => item.canonicalName)).size, 500);
    assert.ok(corpus.concepts.every((item) => item.aliases.length >= 2));
    assert.ok(corpus.concepts.filter((item) => item.aliases.length >= 5).length >= 50);
  });

  it('fully annotates evaluation queries and keeps every reference resolvable', () => {
    const conceptIds = new Set(corpus.concepts.map((item) => item.id));
    for (const query of corpus.queries) {
      assert.ok(query.expectedIntent);
      assert.ok(Array.isArray(query.expectedConceptIds));
      assert.ok(query.expectedHardFilters && typeof query.expectedHardFilters === 'object');
      assert.ok(Array.isArray(query.expectedSoftSignals));
      assert.ok(query.requiredTools.length);
      assert.ok(query.forbiddenTools.length);
      assert.ok(query.expectedSourceTypes.length);
      assert.ok(query.forbiddenOutcomes.length);
      assert.equal(typeof query.allowEmptyResult, 'boolean');
      assert.ok(query.expectedExplanation);
      assert.ok(query.safetyPrompt);
      assert.ok(query.expectedConceptIds.every((id) => conceptIds.has(id)));
    }
    assert.ok(corpus.concepts.every((concept) => concept.relatedConceptIds.every((id) => conceptIds.has(id))));
  });

  it('passes intent, concept and safety interpretation quality gates', () => {
    const intentPasses = corpus.queries.filter((query) => inferAgentIntent(query.query) === query.expectedIntent).length;
    assert.ok(intentPasses / corpus.queries.length >= 0.97, `intent accuracy was ${intentPasses}/${corpus.queries.length}`);

    const conceptQueries = corpus.queries.filter((query) => query.expectedConceptIds.length);
    const conceptPasses = conceptQueries.filter((query) => {
      const topThree = new Set(interpretCampusDiningQuery(query.query).conceptIds.slice(0, 3));
      return query.expectedConceptIds.some((id) => topThree.has(id));
    }).length;
    assert.ok(conceptPasses / conceptQueries.length >= 0.95, `concept Top-3 was ${conceptPasses}/${conceptQueries.length}`);

    const safetyQueries = corpus.queries.filter((query) => query.stratum === 'dietary_safety');
    const safetyPasses = safetyQueries.filter((query) => objectContains(parseDishSearchRequest(query.query).filters, query.expectedHardFilters)).length;
    assert.equal(safetyPasses, safetyQueries.length, 'all dietary safety hard filters must survive interpretation');

    const parsed = parseDishSearchRequest('午餐预算20元，只吃清真且不能有花生');
    assert.deepEqual(parsed.interpreted.hardConstraints, parsed.filters);
  });

  it('never derives safety facts from generic archetypes or zero nutrition values', () => {
    const labels = deriveDishSemanticLabels({
      name: '未核验样例菜',
      ingredients: ['鸡胸肉', '西兰花', '糙米'],
      tags: [],
      allergens: [],
      nutrition: { calories: 0, protein: 0, fat: 0, carbs: 0 },
      sodium: 0,
      sugar: 0,
    });
    assert.ok(labels.includes('蛋白质来源'));
    assert.ok(labels.includes('蔬菜来源'));
    assert.ok(labels.includes('主食来源'));
    assert.equal(labels.includes('低钠'), false);
    assert.equal(labels.includes('低糖'), false);
    assert.equal(labels.some((label) => label.includes('无过敏')), false);
  });

  it('keeps a separate, fully annotated challenge set out of the retrieval corpus', () => {
    const challenges = loadCampusDiningChallengeQueries();
    const conceptIds = new Set(corpus.concepts.map((item) => item.id));
    const baseQueryIds = new Set(corpus.queries.map((item) => item.id));
    assert.equal(challenges.length, 50);
    assert.deepEqual(
      Object.fromEntries(Object.entries(Object.groupBy(challenges, (item) => item.challengeType)).map(([key, values]) => [key, values.length])),
      { typo: 10, colloquial: 10, long_condition: 10, negation: 10, adversarial_conflict: 10 },
    );
    assert.ok(challenges.every((item) => baseQueryIds.has(item.baseQueryId)));
    assert.ok(challenges.every((item) => item.expectedConceptIds.every((id) => conceptIds.has(id))));
  });
});

describe('global campus knowledge lexical index', () => {
  let db;
  let corpus;

  before(async () => {
    db = openDatabase(':memory:');
    corpus = loadCampusDiningCorpus();
    await reindexRetrieval(db, {
      tenantId: GLOBAL_KNOWLEDGE_TENANT_ID,
      sourceTypes: ['campus_dining_knowledge'],
      embeddingProvider: null,
    });
  });

  after(() => db?.close());

  it('indexes approved concepts only and never indexes evaluation queries', async () => {
    const rows = await db.prepare("SELECT source_id, embedding_json FROM rag_documents WHERE tenant_id = ? AND source_type = 'campus_dining_knowledge'").all(GLOBAL_KNOWLEDGE_TENANT_ID);
    const conceptIds = new Set(corpus.concepts.map((item) => item.id));
    const queryIds = new Set(corpus.queries.map((item) => item.id));
    const challengeIds = new Set(loadCampusDiningChallengeQueries().map((item) => item.id));
    assert.equal(rows.length, 500);
    assert.ok(rows.every((row) => conceptIds.has(row.source_id)));
    assert.ok(rows.every((row) => !queryIds.has(row.source_id)));
    assert.ok(rows.every((row) => !challengeIds.has(row.source_id)));
    assert.ok(rows.every((row) => row.embedding_json == null), 'lexical-only indexing must not create vectors');
    assert.equal(buildCampusDiningIndexDocuments().length, 500);
  });

  it('meets the lexical Hit@5 gate across all queries with expected concepts', async () => {
    const queries = corpus.queries.filter((query) => query.expectedConceptIds.length);
    let hits = 0;
    for (const query of queries) {
      const result = await searchRetrievalIndex(db, query.query, {
        tenantId: GLOBAL_KNOWLEDGE_TENANT_ID,
        sourceTypes: ['campus_dining_knowledge'],
        limit: 5,
        embeddingProvider: null,
      });
      if (result.items.some((item) => query.expectedConceptIds.includes(item.sourceId))) hits += 1;
    }
    assert.ok(hits / queries.length >= 0.9, `lexical Hit@5 was ${hits}/${queries.length}`);
  });

  it('keeps campus knowledge global and dish evidence tenant-owned', async () => {
    await assert.rejects(
      reindexRetrieval(db, { tenantId: 'school-a', sourceTypes: ['campus_dining_knowledge'], embeddingProvider: null }),
      (error) => error.code === 'GLOBAL_KNOWLEDGE_SCOPE_REQUIRED',
    );
    const local = await searchRetrievalIndex(db, '早八前', { tenantId: 'school-a', sourceTypes: ['campus_dining_knowledge'], embeddingProvider: null });
    const global = await searchRetrievalIndex(db, '早八前', { tenantId: GLOBAL_KNOWLEDGE_TENANT_ID, sourceTypes: ['campus_dining_knowledge'], embeddingProvider: null });
    assert.equal(local.items.length, 0);
    assert.ok(global.items.some((item) => item.title === '早八前'));

    const dishDocuments = buildDishIndexDocuments([
      { id: 'dish-a', tenantId: 'school-a', name: '鸡胸杂粮饭', price: 18, cuisine: '轻食', taste: '清淡', ingredients: ['鸡胸肉', '糙米', '西兰花'], tags: [], allergens: [], mealTypes: ['lunch'], nutrition: { calories: 460, protein: 36, fat: 9, carbs: 56 } },
    ], [{ id: 'stall-a', tenantId: 'school-a', canteenId: 'canteen-a', name: '轻食档' }], [{ id: 'canteen-a', tenantId: 'school-a', name: '测试食堂' }], 'school-a');
    assert.equal(dishDocuments[0].metadata.evidenceType, 'tenant_dish_fact');
    assert.ok(dishDocuments[0].metadata.semanticLabels.includes('高蛋白'));
    assert.equal(dishDocuments[0].tenantId, 'school-a');
  });
});

describe('agent global knowledge integration', () => {
  let db;
  let server;
  let baseUrl;

  before(async () => {
    db = openDatabase(':memory:');
    await reindexRetrieval(db, {
      tenantId: GLOBAL_KNOWLEDGE_TENANT_ID,
      sourceTypes: ['campus_dining_knowledge'],
      embeddingProvider: null,
    });
    server = createServer(createApp({ db }).handler);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    db?.close();
  });

  async function request(path, { token, body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body || {}),
    });
    return { status: response.status, data: await response.json() };
  }

  it('combines current-school execution with read-only global citations', async () => {
    const login = await request('/api/auth/login', { body: { username: '演示学生', password: 'student123' } });
    assert.equal(login.status, 200);
    const response = await request('/api/agent/assistant', {
      token: login.data.token,
      body: { query: '早八前是什么校园用餐场景' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.intent, 'knowledge_qa');
    const campusCitation = response.data.citations.find((item) => item.sourceType === 'campus_dining_knowledge');
    assert.ok(campusCitation, 'agent should cite the global campus knowledge corpus');
    assert.equal(campusCitation.tenantId, GLOBAL_KNOWLEDGE_TENANT_ID);
    assert.equal(campusCitation.metadata.evidenceType, 'global_semantic_knowledge');
    assert.equal(response.data.actions.some((action) => action.type === 'create_order'), false);

    const recommendation = await request('/api/recommend', {
      token: login.data.token,
      body: { query: '午餐推荐高蛋白菜品' },
    });
    assert.equal(recommendation.status, 200);
    assert.deepEqual(recommendation.data.meta.interpreted.hardConstraints, recommendation.data.meta.interpreted.filters);
    assert.ok(recommendation.data.evidence.dishes.every((item) => item.metadata.evidenceType === 'tenant_dish_fact'));
  });
});
