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
/*  Enterprise agent tests                                             */
/* ================================================================== */

describe('Enterprise agent: session memory, confirmation-gated actions, tool traces', () => {
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
      body: { username: 'enterprise第二学生', password: 'pass789', nickname: '企业小测' },
    });
    otherStudentToken = reg.data.token;

    // Seed a published menu for today with known dishes
    await req('/api/admin/menus', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'enterprise-menu-1',
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
  });

  after(() => server.close());

  /* -------------------------------------------------------------- */
  /*  1. Tool traces use named registry-style tools with statuses    */
  /* -------------------------------------------------------------- */
  it('agent response includes named tool steps with statuses, no raw secrets', async () => {
    // Save a known AI key so we can assert it never leaks
    await req('/api/admin/ai-settings', {
      method: 'PUT',
      token: adminToken,
      body: { apiKey: 'sk-enterprise-secret-test-99999', chatModel: 'gpt-4o-mini' },
    });

    const { status, data } = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '推荐低脂高蛋白的菜品' },
    });
    assert.equal(status, 200, 'should return 200');

    // Steps must be an array of registry-style tool calls
    assert.ok(Array.isArray(data.steps) && data.steps.length >= 2, 'steps is non-empty array');
    for (const step of data.steps) {
      assert.ok(typeof step.tool === 'string' && step.tool.length > 0, 'each step has a non-empty tool name');
      assert.ok(typeof step.status === 'string' && step.status.length > 0, 'each step has a non-empty status');
      assert.ok(step.status === 'success' || step.status === 'error', `step status is success or error, got: ${step.status}`);
    }

    // Tool names should be registry-style (dotted names like profile.load, menu.today)
    const toolNames = data.steps.map((s) => s.tool);
    assert.ok(toolNames.some((n) => n.includes('.')), 'at least one tool uses dotted registry-style naming');
    assert.ok(toolNames.includes('profile.load'), 'steps include profile.load');
    assert.ok(toolNames.includes('menu.today'), 'steps include menu.today');
    assert.ok(toolNames.includes('rag.meal_advisor'), 'steps include rag.meal_advisor');

    // Serialized response must never contain the raw API key
    const serialized = JSON.stringify(data);
    assert.ok(!serialized.includes('sk-enterprise-secret-test-99999'), 'response must not contain raw AI API key');
    assert.ok(!serialized.includes('sk-enterprise-secret'), 'response must not contain partial AI API key');

    // toolResults should include a registry summary mapping tool names to statuses
    assert.ok(data.toolResults && typeof data.toolResults === 'object', 'toolResults is object');
    assert.ok(Array.isArray(data.toolResults.registry), 'toolResults.registry is array');
    for (const entry of data.toolResults.registry) {
      assert.ok(typeof entry.tool === 'string', 'registry entry has tool name');
      assert.ok(typeof entry.status === 'string', 'registry entry has status');
    }

    // Clean up AI settings
    await req('/api/admin/ai-settings', { method: 'DELETE', token: adminToken });
  });

  /* -------------------------------------------------------------- */
  /*  2. Session memory: follow-up reuses prior topic                */
  /* -------------------------------------------------------------- */
  it('session memory lets a follow-up query reuse previous topic context', async () => {
    // First turn: ask about low-fat options — establishes a topic
    const first = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '推荐低脂菜品' },
    });
    assert.equal(first.status, 200, 'first query returns 200');
    assert.ok(first.data.sessionId, 'first response includes sessionId');

    const sessionId = first.data.sessionId;

    // Second turn: follow-up with same sessionId reuses the session
    const second = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '那高蛋白的呢？', sessionId },
    });
    assert.equal(second.status, 200, 'follow-up query returns 200');
    assert.equal(second.data.sessionId, sessionId, 'follow-up reuses the same sessionId');

    // Response must still be structured and substantive
    assert.ok(typeof second.data.answer === 'string' && second.data.answer.length > 0, 'follow-up answer is non-empty');
    assert.ok(second.data.intent, 'follow-up has intent');
    assert.ok(Array.isArray(second.data.steps) && second.data.steps.length >= 2, 'follow-up has tool steps');
    assert.ok(Array.isArray(second.data.citations), 'follow-up has citations');

    // Verify the session is queryable via events endpoint
    const eventsRes = await req(`/api/agent/events?sessionId=${encodeURIComponent(sessionId)}`, {
      token: studentToken,
    });
    assert.equal(eventsRes.status, 200, 'events endpoint returns 200');
    assert.ok(Array.isArray(eventsRes.data.messages), 'events include messages array');
    // At least 4 messages: user1, assistant1, user2, assistant2
    assert.ok(eventsRes.data.messages.length >= 4, `session has at least 4 messages (got ${eventsRes.data.messages.length})`);

    // Messages should alternate user/assistant roles
    const roles = eventsRes.data.messages.map((m) => m.role);
    assert.ok(roles.includes('user'), 'messages include user role');
    assert.ok(roles.includes('assistant'), 'messages include assistant role');
  });

  /* -------------------------------------------------------------- */
  /*  3. Agent proposes create_order but does NOT execute it          */
  /* -------------------------------------------------------------- */
  it('agent proposes create_order action without executing — no order is created', async () => {
    // Count orders before
    const beforeOrders = await req('/api/orders', { token: studentToken });
    const countBefore = beforeOrders.data.orders.length;

    // Query using the actual seeded dish name to trigger order inference
    const { status, data } = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '来一份番茄鸡蛋盖饭，帮我下单' },
    });
    assert.equal(status, 200, 'agent returns 200');

    // Must include a pending create_order action requiring confirmation
    assert.ok(Array.isArray(data.actions), 'actions is array');
    const createAction = data.actions.find((a) => a.type === 'create_order');
    assert.ok(createAction, 'response includes a create_order action');
    assert.equal(createAction.status, 'pending', 'action status is pending');
    assert.equal(createAction.requiresConfirmation, true, 'action requires confirmation');
    assert.ok(createAction.id, 'action has an id for later confirmation');
    assert.ok(createAction.payload && Array.isArray(createAction.payload.items), 'action payload includes items array');
    assert.ok(createAction.payload.items.length >= 1, 'action has at least one item');

    // CRITICAL: no order must have been created in the DB
    const afterOrders = await req('/api/orders', { token: studentToken });
    assert.equal(afterOrders.data.orders.length, countBefore, 'no new order was created without confirmation');
  });

  /* -------------------------------------------------------------- */
  /*  4. Confirming own create_order creates order + pickup code     */
  /* -------------------------------------------------------------- */
  it('confirming own create_order action creates an order and returns pickup code', async () => {
    // Step 1: Get a pending create_order action
    const agentRes = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '来一份番茄鸡蛋盖饭，帮我下单' },
    });
    assert.equal(agentRes.status, 200, 'agent returns 200');
    const createAction = agentRes.data.actions.find((a) => a.type === 'create_order');
    assert.ok(createAction, 'create_order action present');

    // Step 2: Confirm the action
    const confirmRes = await req(`/api/agent/actions/${createAction.id}/confirm`, {
      method: 'POST',
      token: studentToken,
    });
    assert.equal(confirmRes.status, 200, 'confirm returns 200');

    // Response wraps result in { action: { ... result: { order: ... } } }
    assert.ok(confirmRes.data.action, 'confirm response includes action');
    assert.equal(confirmRes.data.action.status, 'confirmed', 'action status is confirmed');
    assert.ok(confirmRes.data.action.result, 'action has result');
    assert.ok(confirmRes.data.action.result.order, 'result includes order');

    const order = confirmRes.data.action.result.order;
    assert.ok(order.id, 'order has id');
    assert.ok(order.pickupCode, 'order has pickupCode');
    assert.ok(typeof order.pickupCode === 'string' && order.pickupCode.length >= 4, 'pickupCode is a string of at least 4 chars');
    assert.ok(order.totalAmount > 0, 'order totalAmount > 0');
    assert.ok(Array.isArray(order.items) && order.items.length > 0, 'order has items');
    assert.equal(order.status, 'pending', 'new order status is pending');

    // Step 3: Verify the order exists in the user's order list
    const ordersRes = await req('/api/orders', { token: studentToken });
    const created = ordersRes.data.orders.find((o) => o.id === order.id);
    assert.ok(created, 'confirmed order appears in user order list');
    assert.equal(created.pickupCode, order.pickupCode, 'pickupCode matches');
  });

  /* -------------------------------------------------------------- */
  /*  5. Another user cannot confirm someone else's pending action   */
  /* -------------------------------------------------------------- */
  it('another user cannot confirm someone else\'s pending action', async () => {
    // Student A gets a pending create_order action
    const agentRes = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '来一份番茄鸡蛋盖饭，帮我下单' },
    });
    assert.equal(agentRes.status, 200, 'agent returns 200');
    const createAction = agentRes.data.actions.find((a) => a.type === 'create_order');
    assert.ok(createAction, 'create_order action present for student A');

    // Student B tries to confirm Student A's action — must be rejected
    const crossRes = await req(`/api/agent/actions/${createAction.id}/confirm`, {
      method: 'POST',
      token: otherStudentToken,
    });
    // The confirmAgentAction queries by tenant_id AND user_id, so other user gets 404
    assert.ok(crossRes.status === 403 || crossRes.status === 404, `cross-user confirm rejected with ${crossRes.status}`);
  });

  /* -------------------------------------------------------------- */
  /*  6. Agent event endpoint returns session events/snapshot        */
  /* -------------------------------------------------------------- */
  it('GET /api/agent/events?sessionId=... returns session event snapshot', async () => {
    // Create a session with a query
    const agentRes = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '今天午餐推荐什么？' },
    });
    assert.equal(agentRes.status, 200, 'agent returns 200');
    const sessionId = agentRes.data.sessionId;
    assert.ok(sessionId, 'response includes sessionId');

    // Fetch events for this session
    const eventsRes = await req(`/api/agent/events?sessionId=${encodeURIComponent(sessionId)}`, {
      token: studentToken,
    });
    assert.equal(eventsRes.status, 200, 'events endpoint returns 200');

    // Response includes session metadata
    assert.ok(eventsRes.data.session, 'response includes session metadata');
    assert.equal(eventsRes.data.session.id, sessionId, 'session id matches');
    assert.ok(typeof eventsRes.data.session.title === 'string', 'session has title');

    // Response includes messages
    assert.ok(Array.isArray(eventsRes.data.messages), 'response includes messages array');
    assert.ok(eventsRes.data.messages.length >= 2, 'at least user + assistant messages');

    // Each message has role and content
    for (const msg of eventsRes.data.messages) {
      assert.ok(typeof msg.role === 'string', 'message has role');
      assert.ok(typeof msg.content === 'string', 'message has content');
    }

    // Messages should include user query and assistant response
    const userMsg = eventsRes.data.messages.find((m) => m.role === 'user');
    assert.ok(userMsg, 'messages include user message');

    const assistantMsg = eventsRes.data.messages.find((m) => m.role === 'assistant');
    assert.ok(assistantMsg, 'messages include assistant response');

    // Response includes actions
    assert.ok(Array.isArray(eventsRes.data.actions), 'response includes actions array');
  });

  /* -------------------------------------------------------------- */
  /*  7. Unauthenticated action confirm returns 401                  */
  /* -------------------------------------------------------------- */
  it('unauthenticated POST to confirm action returns 401', async () => {
    const { status } = await req('/api/agent/actions/agent-action-fake-id/confirm', {
      method: 'POST',
    });
    assert.equal(status, 401, 'unauthenticated confirm returns 401');
  });

  /* -------------------------------------------------------------- */
  /*  8. Confirming a non-existent action returns 404                */
  /* -------------------------------------------------------------- */
  it('confirming a non-existent action returns 404', async () => {
    const { status } = await req('/api/agent/actions/agent-action-nonexistent/confirm', {
      method: 'POST',
      token: studentToken,
    });
    assert.equal(status, 404, 'non-existent action returns 404');
  });
});
