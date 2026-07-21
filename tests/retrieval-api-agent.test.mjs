import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { loadHealthKnowledgeBase } from '../server/healthKnowledgeBase.js';

let server;
let baseUrl;
let db;
let adminToken;
let studentToken;

const fixtureIds = {
  safe: 'retrieval-api-safe',
  allergen: 'retrieval-api-allergen',
  nonHalal: 'retrieval-api-non-halal',
  soldOut: 'retrieval-api-sold-out'
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function login(username, password) {
  const response = await req('/api/auth/login', {
    method: 'POST',
    body: { username, password }
  });
  assert.equal(response.status, 200, `login failed for ${username}`);
  return response.data.token;
}

function dishBody(overrides) {
  return {
    stallId: 'n-halal',
    name: '检索验收清真鸡肉饭',
    price: 18,
    taste: '清淡',
    cuisine: '测试菜系',
    ingredients: ['鸡肉', '糙米', '西兰花'],
    allergens: [],
    tags: ['检索验收', '高蛋白'],
    halal: true,
    mealTypes: ['lunch'],
    nutrition: { calories: 420, protein: 36, fat: 8, carbs: 52 },
    description: '双检索接口验收使用的可下单清真菜品。',
    ...overrides
  };
}

function executedTools(response) {
  assert.ok(Array.isArray(response.steps), 'agent response includes executed steps');
  return response.steps.map((step) => step.tool);
}

function assertStatus(status, expected, data) {
  const detail = data?.error || data?.message || JSON.stringify(data);
  assert.equal(status, expected, detail || `expected HTTP ${expected}, received ${status}`);
}

describe('dual retrieval APIs and intent-specific agent tools', () => {
  before(async () => {
    db = openDatabase(':memory:');
    const app = createApp({ db });
    server = createServer(app.handler);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    adminToken = await login('admin', 'admin123');
    studentToken = await login('演示学生', 'student123');

    const fixtures = [
      dishBody({ id: fixtureIds.safe }),
      dishBody({
        id: fixtureIds.allergen,
        name: '检索验收花生鸡肉饭',
        price: 14,
        ingredients: ['鸡肉', '花生', '米饭'],
        allergens: ['花生'],
        nutrition: { calories: 500, protein: 30, fat: 16, carbs: 60 }
      }),
      dishBody({
        id: fixtureIds.nonHalal,
        stallId: 'n-protein',
        name: '检索验收非清真鸡胸饭',
        price: 13,
        halal: false
      }),
      dishBody({
        id: fixtureIds.soldOut,
        name: '检索验收售罄牛肉饭',
        price: 15,
        ingredients: ['牛肉', '米饭', '青菜'],
        nutrition: { calories: 530, protein: 32, fat: 13, carbs: 66 }
      })
    ];

    for (const fixture of fixtures) {
      const created = await req('/api/admin/dishes', {
        method: 'POST',
        token: adminToken,
        body: fixture
      });
      assert.equal(created.status, 201, `failed to create fixture dish ${fixture.id}`);
    }

    const menu = await req('/api/admin/menus', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'retrieval-api-menu',
        canteenId: 'north',
        date: today(),
        mealType: 'lunch',
        status: 'published',
        items: [
          { dishId: fixtureIds.safe, price: 14, supplyLimit: 30, supplyCount: 2, soldOut: false, servingStart: '00:00', servingEnd: '23:59' },
          { dishId: fixtureIds.allergen, price: 13, supplyLimit: 30, supplyCount: 2, soldOut: false, servingStart: '00:00', servingEnd: '23:59' },
          { dishId: fixtureIds.nonHalal, price: 12, supplyLimit: 30, supplyCount: 2, soldOut: false, servingStart: '00:00', servingEnd: '23:59' },
          { dishId: fixtureIds.soldOut, price: 12.5, supplyLimit: 20, supplyCount: 20, soldOut: true, servingStart: '00:00', servingEnd: '23:59' }
        ]
      }
    });
    assert.equal(menu.status, 201, 'failed to create retrieval fixture menu');

    const knowledge = await loadHealthKnowledgeBase(db, { chunkSize: 500, chunkOverlap: 50 });
    assert.ok(knowledge.count > 0, 'health knowledge fixtures were indexed');

    const order = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [{ dishId: fixtureIds.safe, quantity: 1 }], note: 'retrieval agent routing fixture' }
    });
    assert.equal(order.status, 201, 'failed to create order routing fixture');
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    db?.close();
  });

  it('POST /api/dishes/search returns the contract and preserves sold-out database truth', async () => {
    const { status, data } = await req('/api/dishes/search', {
      method: 'POST',
      token: studentToken,
      body: {
        query: '检索验收',
        filters: { mealType: 'lunch' },
        sort: 'relevance',
        limit: 20,
        offset: 0
      }
    });

    assertStatus(status, 200, data);
    assert.ok(data.interpreted && typeof data.interpreted === 'object');
    assert.ok(Array.isArray(data.items));
    assert.ok(data.availability && typeof data.availability.orderableCount === 'number');
    assert.ok(data.matchReasons && typeof data.matchReasons === 'object');
    assert.ok(Array.isArray(data.suggestedRelaxations));
    assert.deepEqual(data.page.limit, 20);
    assert.deepEqual(data.page.offset, 0);
    assert.ok(data.meta && data.meta.tenantId === 'default');

    const soldOut = data.items.find((item) => item.id === fixtureIds.soldOut);
    assert.ok(soldOut, 'sold-out catalog match remains visible in dish search');
    assert.equal(soldOut.availability.orderable, false);
    assert.equal(soldOut.availability.status, 'sold_out');
    assert.equal(soldOut.availability.price, 12.5, 'published menu price is authoritative');
    assert.ok(Array.isArray(soldOut.matchReasons));
    assert.deepEqual(data.matchReasons[soldOut.id], soldOut.matchReasons);
  });

  it('POST /api/recommend enforces hard constraints and builds mealPlan from the same ranking', async () => {
    const { status, data } = await req('/api/recommend', {
      method: 'POST',
      token: studentToken,
      body: {
        query: '午餐推荐，花生过敏，只吃清真，预算16元以内',
        context: { date: today(), time: '12:00', mealType: 'lunch' },
        profileOverride: {
          goal: 'fatLoss',
          budgetMax: 16,
          mealType: 'lunch',
          halalOnly: true,
          avoid: ['花生']
        },
        options: { mode: 'alternatives', limit: 3, requireOrderable: true }
      }
    });

    assertStatus(status, 200, data);
    assert.ok(Array.isArray(data.recommendations) && data.recommendations.length > 0);
    assert.equal(data.mealPlan.mode, 'alternatives');
    assert.ok(data.evidence && Array.isArray(data.evidence.dishes) && Array.isArray(data.evidence.knowledge));
    assert.ok(Array.isArray(data.warnings));
    assert.ok(Array.isArray(data.suggestedRelaxations));

    for (const item of data.recommendations) {
      const foodTerms = [...(item.ingredients || []), ...(item.allergens || [])];
      assert.equal(item.halal, true, `${item.name} must satisfy the halal constraint`);
      assert.ok(!foodTerms.includes('花生'), `${item.name} must satisfy the allergen/avoid constraint`);
      assert.ok(item.availability.price <= 16, `${item.name} must satisfy the per-option budget`);
      assert.equal(item.availability.orderable, true, `${item.name} must be currently orderable`);
      assert.notEqual(item.availability.status, 'sold_out');
    }

    const recommendationIds = data.recommendations.map((item) => item.id);
    const mealPlanIds = data.mealPlan.options.map((item) => item.dishId);
    assert.deepEqual(mealPlanIds, recommendationIds, 'mealPlan options come from the exact recommendation ordering');
    assert.deepEqual(data.evidence.dishes.map((item) => item.sourceId), recommendationIds);
    assert.ok(!recommendationIds.includes(fixtureIds.allergen));
    assert.ok(!recommendationIds.includes(fixtureIds.nonHalal));
    assert.ok(!recommendationIds.includes(fixtureIds.soldOut));
  });

  it('keeps the legacy GET /api/recommend response fields compatible', async () => {
    const { status, data } = await req('/api/recommend?mealType=lunch', { token: studentToken });
    assertStatus(status, 200, data);
    assert.ok(Array.isArray(data.ranked), 'legacy ranked field remains available');
    assert.ok(data.plan && Array.isArray(data.plan.dishes), 'legacy plan.dishes field remains available');
    assert.ok(data.plan.totals && typeof data.plan.totals === 'object', 'legacy plan.totals remains available');
    assert.ok(data.context && data.context.profile, 'legacy context.profile remains available');
    assert.ok(typeof data.source === 'string', 'legacy source remains available');
    assert.ok(data.menu && Array.isArray(data.menu.menus), 'legacy menu metadata remains available');
  });

  it('GET /api/rag/search returns dish citations even when health documents coexist', async () => {
    const healthCount = await db.prepare("SELECT COUNT(*) AS count FROM rag_documents WHERE source_type = 'health_knowledge'").get();
    assert.ok(healthCount.count > 0, 'the test database contains health knowledge documents');

    const { status, data } = await req(`/api/rag/search?q=${encodeURIComponent('检索验收 花生 交叉污染')}`);
    assertStatus(status, 200, data);
    assert.ok(Array.isArray(data.results) && data.results.length > 0);
    assert.ok(data.results.every((item) => item.sourceType === 'dish'), 'dish search must never leak health documents as dishes');
    assert.ok(
      data.results.some((item) => [fixtureIds.safe, fixtureIds.allergen, fixtureIds.nonHalal, fixtureIds.soldOut].includes(item.sourceId || item.id)),
      'results include a real dish fixture'
    );
  });

  it('order status intent executes orders.mine without recommendation retrieval', async () => {
    const { status, data } = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '我的订单状态和取餐码是什么？' }
    });
    assertStatus(status, 200, data);
    assert.equal(data.intent, 'order_status');

    const tools = executedTools(data);
    assert.ok(tools.includes('orders.mine'));
    for (const forbidden of ['meal.recommend', 'rag.meal_advisor', 'dish.search', 'knowledge.search', 'profile.load', 'menu.today']) {
      assert.ok(!tools.includes(forbidden), `order query must not execute ${forbidden}`);
    }
  });

  it('recommendation intent executes meal.recommend and no unrelated domain tool', async () => {
    const { status, data } = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '根据我的健康档案推荐今天午餐，预算16元以内' }
    });
    assertStatus(status, 200, data);
    assert.equal(data.intent, 'meal_recommendation');

    const tools = executedTools(data);
    assert.ok(tools.includes('meal.recommend'));
    assert.ok(!tools.includes('orders.mine'));
    assert.ok(!tools.includes('knowledge.search'));
  });

  it('knowledge question executes knowledge.search instead of meal recommendation', async () => {
    const { status, data } = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '健康知识问答：世界卫生组织建议成年人每天盐摄入量是多少？请给出依据。' }
    });
    assertStatus(status, 200, data);
    assert.equal(data.intent, 'knowledge_qa');

    const tools = executedTools(data);
    assert.ok(tools.includes('knowledge.search'));
    assert.ok(!tools.includes('meal.recommend'));
    assert.ok(!tools.includes('orders.mine'));
  });

  it('does not propose create_order when the user did not explicitly name an orderable dish', async () => {
    const beforeOrders = await req('/api/orders', { token: studentToken });
    assert.equal(beforeOrders.status, 200);

    const { status, data } = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '帮我下单一份午餐，什么都可以，随便选一个' }
    });
    assertStatus(status, 200, data);
    assert.ok(Array.isArray(data.actions));
    assert.ok(!data.actions.some((action) => action.type === 'create_order'));
    assert.ok(!executedTools(data).includes('order.create.propose'));

    const afterOrders = await req('/api/orders', { token: studentToken });
    assert.equal(afterOrders.status, 200);
    assert.equal(afterOrders.data.orders.length, beforeOrders.data.orders.length, 'ambiguous order request creates no order');
  });
});
