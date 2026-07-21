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

async function proposeOrder(token) {
  return await req('/api/agent/assistant', {
    method: 'POST',
    token,
    body: { query: '午餐来一份番茄鸡蛋盖饭，帮我下单' },
  });
}

/* ================================================================== */
/*  Agent final-upgrade contracts                                      */
/* ================================================================== */

describe('Agent final upgrade: function-call metadata, permission denial, memory governance, eval suite, action safety', () => {
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

    const reg = await req('/api/auth/register', {
      method: 'POST',
      body: { username: 'final第二学生', password: 'pass789', nickname: '终测小测' },
    });
    otherStudentToken = reg.data.token;

    await req('/api/admin/menus', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'final-menu-1',
        canteenId: 'north',
        date: today(),
        mealType: 'lunch',
        status: 'published',
        items: [
          { dishId: 'd-chicken-bowl', price: 13, supplyLimit: 30, supplyCount: 0, soldOut: false, servingStart: '00:00', servingEnd: '23:59' },
          { dishId: 'd-egg-tomato', price: 11, supplyLimit: 30, supplyCount: 0, soldOut: false, servingStart: '00:00', servingEnd: '23:59' },
        ],
      },
    });
  });

  after(() => server.close());

  /* ---------------------------------------------------------------- */
  /*  1. Function-call metadata: catalog tools have JSON Schema params */
  /* ---------------------------------------------------------------- */
  it('tool catalog entries expose valid JSON Schema parameters for native function-call routing', async () => {
    const { status, data } = await proposeOrder(studentToken);
    assert.equal(status, 200);

    const catalog = data.toolResults.catalog;
    assert.ok(Array.isArray(catalog) && catalog.length >= 8, 'catalog has at least 8 tools');

    for (const entry of catalog) {
      assert.ok(typeof entry.name === 'string' && entry.name.length > 0, `${entry.name} has name`);
      assert.ok(typeof entry.title === 'string' && entry.title.length > 0, `${entry.name} has title`);
      assert.ok(typeof entry.category === 'string', `${entry.name} has category`);
      assert.ok(typeof entry.riskLevel === 'string', `${entry.name} has riskLevel`);
      assert.ok(typeof entry.requiresConfirmation === 'boolean', `${entry.name} has requiresConfirmation`);
      assert.ok(entry.parameters && entry.parameters.type === 'object', `${entry.name} has parameters.type=object`);
      assert.ok(entry.parameters.properties !== undefined, `${entry.name} has parameters.properties`);
    }

    const mealAdvisor = catalog.find((e) => e.name === 'rag.meal_advisor');
    assert.ok(mealAdvisor, 'rag.meal_advisor in catalog');
    assert.deepEqual(mealAdvisor.parameters.required, ['query'], 'rag.meal_advisor requires query param');
    assert.equal(mealAdvisor.parameters.properties.query.type, 'string', 'query param is string');

    const orderCreate = catalog.find((e) => e.name === 'order.create.propose');
    assert.ok(orderCreate, 'order.create.propose in catalog');
    assert.deepEqual(orderCreate.parameters.required, ['items'], 'order.create.propose requires items param');
    assert.equal(orderCreate.parameters.properties.items.type, 'array', 'items param is array');
    assert.ok(orderCreate.parameters.properties.items.items.properties.dishId, 'items[].dishId defined');
    assert.ok(orderCreate.parameters.properties.items.items.properties.quantity, 'items[].quantity defined');
    assert.deepEqual(orderCreate.parameters.properties.items.items.required, ['dishId', 'quantity'], 'item fields required');

    const menuToday = catalog.find((e) => e.name === 'menu.today');
    assert.ok(menuToday, 'menu.today in catalog');
    assert.equal(menuToday.parameters.properties.mealType.type, 'string', 'menu.today has mealType string param');
    assert.equal(menuToday.parameters.properties.date.type, 'string', 'menu.today has date string param');
  });

  /* ---------------------------------------------------------------- */
  /*  2. Tool permission denial: student cannot access eval dashboard  */
  /* ---------------------------------------------------------------- */
  it('unauthorized student gets 403 on eval dashboard — permission boundary enforced', async () => {
    const studentRes = await req('/api/agent/evals', { token: studentToken });
    assert.equal(studentRes.status, 403);

    const otherRes = await req('/api/agent/evals', { token: otherStudentToken });
    assert.equal(otherRes.status, 403);

    const adminRes = await req('/api/agent/evals', { token: adminToken });
    assert.equal(adminRes.status, 200);
    assert.ok(adminRes.data.metrics !== undefined, 'admin gets metrics');
    assert.ok(Array.isArray(adminRes.data.runs), 'admin gets runs array');
  });

  /* ---------------------------------------------------------------- */
  /*  3. Memory governance: preferences accumulate across agent calls  */
  /* ---------------------------------------------------------------- */
  it('memory governance: preferences accumulate across assistant calls with halalOnly and goal', async () => {
    const first = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '我不吃辣，要清真，今天午餐推荐' },
    });
    assert.equal(first.status, 200);
    assert.ok(first.data.memory, 'first call returns memory');
    assert.equal(first.data.memory.preferences.taste, '不辣');
    assert.equal(first.data.memory.preferences.halalOnly, true);

    const second = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '我要减脂餐，推荐一下', sessionId: first.data.sessionId },
    });
    assert.equal(second.status, 200);
    assert.equal(second.data.memory.preferences.taste, '不辣', 'taste preserved from first call');
    assert.equal(second.data.memory.preferences.halalOnly, true, 'halalOnly preserved from first call');
    assert.equal(second.data.memory.preferences.goal, 'fatLoss', 'goal accumulated from second call');
    assert.ok(second.data.memory.updatedAt, 'memory has updatedAt');
  });

  it('memory isolation: different users have independent preference stores', async () => {
    const first = await req('/api/agent/assistant', {
      method: 'POST',
      token: otherStudentToken,
      body: { query: '我要增肌餐，高蛋白的' },
    });
    assert.equal(first.status, 200);
    assert.equal(first.data.memory.preferences.goal, 'muscleGain');

    const studentCheck = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '推荐午餐' },
    });
    assert.equal(studentCheck.status, 200);
    assert.equal(studentCheck.data.memory.preferences.goal, 'fatLoss', 'student goal not overwritten by other user');
    assert.equal(studentCheck.data.memory.preferences.taste, '不辣', 'student taste not overwritten');
  });

  /* ---------------------------------------------------------------- */
  /*  4. Eval suite: runner records case results with metric fields    */
  /* ---------------------------------------------------------------- */
  it('eval suite runner records per-run case results with all metric fields', async () => {
    const { status, data } = await proposeOrder(studentToken);
    assert.equal(status, 200);

    assert.ok(data.eval, 'eval present in response');
    assert.equal(typeof data.eval.groundednessScore, 'number', 'groundednessScore is number');
    assert.equal(typeof data.eval.toolSuccessRate, 'number', 'toolSuccessRate is number');
    assert.equal(typeof data.eval.safetyScore, 'number', 'safetyScore is number');
    assert.equal(typeof data.eval.riskLevel, 'string', 'riskLevel is string');
    assert.ok(data.eval.toolSuccessRate >= 0 && data.eval.toolSuccessRate <= 1, 'toolSuccessRate in [0,1]');
    assert.ok(data.eval.groundednessScore >= 0 && data.eval.groundednessScore <= 1, 'groundednessScore in [0,1]');
    assert.ok(data.eval.safetyScore >= 0 && data.eval.safetyScore <= 1, 'safetyScore in [0,1]');
    assert.ok(['low', 'medium', 'high'].includes(data.eval.riskLevel), 'riskLevel is valid');

    const evals = await req('/api/agent/evals', { token: adminToken });
    assert.equal(evals.status, 200);
    const m = evals.data.metrics;
    assert.ok(m.totalRuns >= 1, 'at least 1 eval run recorded');
    assert.equal(typeof m.avgGroundedness, 'number', 'avgGroundedness');
    assert.equal(typeof m.avgToolSuccess, 'number', 'avgToolSuccess');
    assert.equal(typeof m.avgSafety, 'number', 'avgSafety');
    assert.equal(typeof m.avgLatencyMs, 'number', 'avgLatencyMs');
    assert.ok(Array.isArray(m.risks), 'risks distribution array present');

    const latestRun = evals.data.runs[0];
    assert.ok(latestRun, 'runs returned');
    assert.equal(typeof latestRun.intent, 'string', 'run has intent');
    assert.ok(typeof latestRun.toolCount === 'number' && latestRun.toolCount >= 1, 'run has toolCount');
    assert.ok(typeof latestRun.actionCount === 'number', 'run has actionCount');
    assert.ok(typeof latestRun.latencyMs === 'number' && latestRun.latencyMs >= 0, 'run has latencyMs');
    assert.ok(typeof latestRun.groundednessScore === 'number', 'run has groundednessScore');
    assert.ok(typeof latestRun.toolSuccessRate === 'number', 'run has toolSuccessRate');
    assert.ok(typeof latestRun.safetyScore === 'number', 'run has safetyScore');
    assert.ok(typeof latestRun.riskLevel === 'string', 'run has riskLevel');
    assert.ok(latestRun.createdAt, 'run has createdAt');
  });

  /* ---------------------------------------------------------------- */
  /*  5. High-risk action safety: risk object, confirmation gate       */
  /* ---------------------------------------------------------------- */
  it('high-risk create_order action carries risk object, requiresConfirmation, and high riskLevel', async () => {
    const { status, data } = await proposeOrder(studentToken);
    assert.equal(status, 200);

    const action = data.actions.find((a) => a.type === 'create_order');
    assert.ok(action, 'create_order action present');
    assert.equal(action.requiresConfirmation, true, 'requiresConfirmation is true');
    assert.equal(action.riskLevel, 'high', 'riskLevel is high');
    assert.ok(action.risk, 'risk object present');
    assert.equal(action.risk.level, 'high', 'risk.level is high');
    assert.ok(typeof action.risk.reason === 'string' && action.risk.reason.length > 0, 'risk.reason is non-empty string');
    assert.ok(action.id.startsWith('agent-action-'), 'action id has agent-action- prefix');
    assert.ok(action.payload, 'action has payload');
    assert.ok(Array.isArray(action.payload.items), 'payload.items is array');
    assert.ok(action.payload.items.length > 0, 'payload.items has items');
    assert.equal(action.status, 'pending', 'action starts as pending');
  });

  it('action lifecycle: confirm removes requiresConfirmation, reject blocks confirm, both leave pending', async () => {
    const agent1 = await proposeOrder(studentToken);
    const a1 = agent1.data.actions.find((a) => a.type === 'create_order');
    assert.ok(a1?.id);

    const confirmRes = await req(`/api/agent/actions/${a1.id}/confirm`, { method: 'POST', token: studentToken });
    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.data.action.status, 'confirmed');
    assert.equal(confirmRes.data.action.requiresConfirmation, false, 'confirmed action no longer requires confirmation');
    assert.equal(confirmRes.data.action.riskLevel, 'high', 'riskLevel preserved after confirm');
    assert.ok(confirmRes.data.action.result.order, 'confirm returns order result');

    const agent2 = await proposeOrder(studentToken);
    const a2 = agent2.data.actions.find((a) => a.type === 'create_order');
    assert.ok(a2?.id);

    const rejectRes = await req(`/api/agent/actions/${a2.id}/reject`, { method: 'POST', token: studentToken });
    assert.equal(rejectRes.status, 200);
    assert.equal(rejectRes.data.action.status, 'rejected');
    assert.deepEqual(rejectRes.data.action.result, {}, 'rejected action has empty result');

    const reconfirm = await req(`/api/agent/actions/${a2.id}/confirm`, { method: 'POST', token: studentToken });
    assert.equal(reconfirm.status, 400, 'cannot confirm already-rejected action');

    const pending = await req('/api/agent/actions', { token: studentToken });
    assert.ok(!pending.data.actions.some((a) => a.id === a1.id), 'confirmed action absent from pending');
    assert.ok(!pending.data.actions.some((a) => a.id === a2.id), 'rejected action absent from pending');
  });

  /* ---------------------------------------------------------------- */
  /*  6. Action center returns enriched risk metadata                  */
  /* ---------------------------------------------------------------- */
  it('action center list entries carry risk object, riskLevel, and requiresConfirmation', async () => {
    const agentRes = await proposeOrder(studentToken);
    const action = agentRes.data.actions.find((a) => a.type === 'create_order');
    assert.ok(action?.id);

    const list = await req('/api/agent/actions', { token: studentToken });
    assert.equal(list.status, 200);
    const entry = list.data.actions.find((a) => a.id === action.id);
    assert.ok(entry, 'action found in list');
    assert.equal(entry.riskLevel, 'high', 'list entry has riskLevel');
    assert.ok(entry.risk, 'list entry has risk object');
    assert.equal(entry.risk.level, 'high', 'list risk.level');
    assert.ok(typeof entry.risk.reason === 'string', 'list risk.reason');
    assert.equal(entry.requiresConfirmation, true, 'list entry requiresConfirmation');
    assert.equal(entry.type, 'create_order', 'list entry type');
    assert.equal(entry.status, 'pending', 'list entry status');
  });
});
