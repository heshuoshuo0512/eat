import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

let server;
let baseUrl;
let db;

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function login(username, password) {
  const { data } = await req('/api/auth/login', { method: 'POST', body: { username, password } });
  return data.token;
}

/* ================================================================== */
/*  Agent assistant tests                                              */
/* ================================================================== */
describe('POST /api/agent/assistant', () => {
  let adminToken;
  let studentToken;
  let otherStudentToken;

  before(async () => {
    db = openDatabase(':memory:');
    const app = createApp({ db });
    server = createServer(app.handler);
    server.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    adminToken = await login('admin', 'admin123');
    studentToken = await login('演示学生', 'student123');

    // Register a second student for isolation testing
    const reg = await req('/api/auth/register', {
      method: 'POST',
      body: { username: 'agent第二学生', password: 'pass789', nickname: '小测' },
    });
    otherStudentToken = reg.data.token;

    // Seed a published menu for today with known dishes
    await req('/api/admin/menus', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'agent-menu-1',
        canteenId: 'north',
        date: today(),
        mealType: 'lunch',
        status: 'published',
        items: [
          { dishId: 'd-chicken-bowl', price: 13, supplyLimit: 10, supplyCount: 0, soldOut: false },
          { dishId: 'd-egg-tomato', price: 11, supplyLimit: 8, supplyCount: 0, soldOut: false },
        ],
      },
    });

    // Create an order for the first student so order_status intent has data
    await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: {
        items: [
          { dishId: 'd-chicken-bowl', quantity: 1 },
        ],
        note: 'agent test order',
      },
    });

    // Create an order for the second student (must not leak into first student's agent response)
    await req('/api/orders', {
      method: 'POST',
      token: otherStudentToken,
      body: {
        items: [
          { dishId: 'd-egg-tomato', quantity: 2 },
        ],
        note: 'other student order',
      },
    });
  });

  after(() => server.close());

  /* ── Unauthenticated request returns 401 ──────────────────────── */
  it('unauthenticated POST returns 401', async () => {
    const { status, data } = await req('/api/agent/assistant', {
      method: 'POST',
      body: { query: '今天吃什么？' },
    });
    assert.equal(status, 401, 'should reject unauthenticated request with 401');
    assert.ok(data.error, 'error message present');
  });

  /* ── Structured response shape for a menu/nutrition query ─────── */
  it('authenticated student gets structured response with answer, intent, steps, toolResults, citations, plan, actions for a nutrition query', async () => {
    const { status, data } = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '减脂期午餐推荐什么？' },
    });
    assert.equal(status, 200, 'should return 200');
    assert.ok(typeof data.answer === 'string' && data.answer.length > 0, 'answer is non-empty string');
    assert.ok(typeof data.intent === 'string' && data.intent.length > 0, 'intent is non-empty string');
    assert.ok(Array.isArray(data.steps) && data.steps.length > 0, 'steps is non-empty array');
    for (const step of data.steps) {
      assert.ok(typeof step.tool === 'string', 'each step has a tool name');
      assert.ok(typeof step.status === 'string', 'each step has a status');
    }
    assert.ok(data.toolResults && typeof data.toolResults === 'object', 'toolResults is object');
    assert.ok(Array.isArray(data.citations), 'citations is array');
    assert.ok(data.plan, 'plan is present');
    assert.ok(Array.isArray(data.actions), 'actions is array');
  });

  /* ── Meal-planning intent for menu query ──────────────────────── */
  it('menu/nutrition query produces meal_planning intent with todayMenu tool result', async () => {
    const { data } = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '今天午餐有什么好吃的推荐？' },
    });
    assert.equal(data.intent, 'meal_planning', 'intent should be meal_planning');
    assert.ok(data.toolResults.todayMenu, 'toolResults includes todayMenu');
    assert.ok(typeof data.toolResults.todayMenu.dishCount === 'number', 'todayMenu has dishCount');
    assert.ok(data.toolResults.profile, 'toolResults includes profile');
  });

  /* ── Order status intent returns only the requesting user's orders ── */
  it('order query returns only requesting student orders, not another student', async () => {
    const { status, data } = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '我的订单状态是什么？' },
    });
    assert.equal(status, 200, 'should return 200');
    assert.equal(data.intent, 'order_status', 'intent should be order_status');

    // Must contain order data scoped to requesting student
    assert.ok(data.toolResults.orders, 'toolResults includes orders');
    assert.ok(Array.isArray(data.toolResults.orders), 'orders is array');
    assert.ok(data.toolResults.orders.length >= 1, 'at least one order for this student');

    // Every order must belong to the requesting student — never another student's
    const orderStep = data.steps.find((s) => s.tool === 'orders.mine');
    assert.ok(orderStep, 'steps include orders.mine tool call');

    // Cross-check: get the student's orders directly and verify IDs match
    const studentLogin = await req('/api/auth/login', { method: 'POST', body: { username: '演示学生', password: 'student123' } });
    const myOrders = await req('/api/orders', { token: studentLogin.data.token });
    const myOrderIds = new Set(myOrders.data.orders.map((o) => o.id));

    for (const order of data.toolResults.orders) {
      assert.ok(myOrderIds.has(order.id), `order ${order.id} belongs to requesting student`);
    }
  });

  /* ── Response never leaks AI API key ──────────────────────────── */
  it('response contains no AI API key even when admin settings exist', async () => {
    // Save an AI key via admin
    await req('/api/admin/ai-settings', {
      method: 'PUT',
      token: adminToken,
      body: { apiKey: 'sk-secret-test-key-12345', chatModel: 'gpt-4o-mini' },
    });

    const { data } = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '推荐低脂高蛋白的菜品' },
    });

    const serialized = JSON.stringify(data);
    assert.ok(!serialized.includes('sk-secret-test-key-12345'), 'response must not contain raw API key');
    assert.ok(!serialized.includes('sk-secret'), 'response must not contain partial API key');

    // Clean up: clear the AI settings
    await req('/api/admin/ai-settings', { method: 'DELETE', token: adminToken });
  });

  /* ── Empty query returns 400 ──────────────────────────────────── */
  it('empty query returns 400', async () => {
    const { status } = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '' },
    });
    assert.ok(status >= 400, 'empty query should be rejected');
  });

  /* ── Existing meal-advisor still works ────────────────────────── */
  it('POST /api/agent/meal-advisor still returns answer, citations, and plan', async () => {
    const { status, data } = await req('/api/agent/meal-advisor', {
      method: 'POST',
      body: { query: '减脂期午餐推荐什么？' },
    });
    assert.equal(status, 200, 'meal-advisor should return 200');
    assert.ok(typeof data.answer === 'string' && data.answer.length > 0, 'answer is non-empty string');
    assert.ok(Array.isArray(data.citations), 'citations is array');
    assert.ok(data.citations.length > 0, 'at least one citation');
    for (const citation of data.citations) {
      assert.ok(typeof citation === 'object', 'citation is object');
      assert.ok(citation.id || citation.name, 'citation has id or name');
    }
    assert.ok(data.plan, 'plan is present');
    if (data.plan.picks) {
      assert.ok(Array.isArray(data.plan.picks), 'plan.picks is array');
      for (const pick of data.plan.picks) {
        assert.ok(pick.name, 'pick has name');
        assert.ok(typeof pick.price === 'number', 'pick has numeric price');
      }
    }
  });
});
