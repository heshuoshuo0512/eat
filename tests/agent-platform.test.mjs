import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';

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

describe('Enterprise agent platform runtime', () => {
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
      body: { username: 'platform第二学生', password: 'pass789', nickname: '平台小测' },
    });
    otherStudentToken = reg.data.token;

    await req('/api/admin/menus', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'platform-menu-1',
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

  it('assistant returns dish-search plan, summary, and high-risk confirmation action', async () => {
    const { status, data } = await proposeOrder(studentToken);
    assert.equal(status, 200);
    assert.ok(typeof data.plan?.goal === 'string' && data.plan.goal.length > 0, 'plan has goal');
    assert.ok(Array.isArray(data.plan.steps), 'plan has steps');
    assert.ok(data.plan.steps.some((step) => step.tool === 'order.create.propose'), 'plan includes order.create.propose');
    assert.equal(data.plan.riskLevel, 'high');
    assert.ok(data.plan.guardrails.includes('高风险动作只生成待确认动作，不直接执行'));
    assert.ok(data.summary?.text.includes('待确认动作 1 个'));
    assert.ok(data.search?.items?.length, 'dish search result is present');
    assert.equal(data.mealPlan, null, 'dish-search intent does not execute the recommendation workflow');
    const createAction = data.actions.find((action) => action.type === 'create_order');
    assert.ok(createAction, 'create_order action present');
    assert.equal(createAction.requiresConfirmation, true);
    assert.equal(createAction.riskLevel, 'high');
  });

  it('tool catalog and registry expose metadata without leaking AI secrets', async () => {
    await req('/api/admin/ai-settings', {
      method: 'PUT',
      token: adminToken,
      body: { apiKey: 'sk-platform-secret-12345', chatModel: 'gpt-4o-mini' },
    });

    const { status, data } = await proposeOrder(studentToken);
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.toolResults.catalog), 'catalog is array');
    assert.ok(data.toolResults.catalog.some((entry) => entry.name === 'menu.today'), 'catalog includes menu.today');
    assert.ok(data.toolResults.catalog.some((entry) => entry.name === 'order.create.propose'), 'catalog includes order.create.propose');
    assert.ok(Array.isArray(data.toolResults.registry), 'registry is array');
    for (const entry of data.toolResults.registry) {
      assert.ok(typeof entry.title === 'string' && entry.title.length > 0, 'registry entry has title');
      assert.ok(typeof entry.category === 'string' && entry.category.length > 0, 'registry entry has category');
      assert.ok(typeof entry.riskLevel === 'string' && entry.riskLevel.length > 0, 'registry entry has riskLevel');
      assert.ok(typeof entry.status === 'string' && entry.status.length > 0, 'registry entry has status');
    }
    const serialized = JSON.stringify(data);
    assert.ok(!serialized.includes('sk-platform-secret-12345'));
    assert.ok(!serialized.includes('sk-platform-secret'));

    await req('/api/admin/ai-settings', { method: 'DELETE', token: adminToken });
  });

  it('action center lists only current user actions and supports status=all', async () => {
    const agentRes = await proposeOrder(studentToken);
    assert.equal(agentRes.status, 200);
    const action = agentRes.data.actions.find((item) => item.type === 'create_order');
    assert.ok(action?.id);

    const mine = await req('/api/agent/actions', { token: studentToken });
    assert.equal(mine.status, 200);
    assert.ok(mine.data.actions.some((item) => item.id === action.id));

    const other = await req('/api/agent/actions', { token: otherStudentToken });
    assert.equal(other.status, 200);
    assert.ok(!other.data.actions.some((item) => item.id === action.id));

    const all = await req('/api/agent/actions?status=all', { token: studentToken });
    assert.equal(all.status, 200);
    assert.ok(all.data.actions.some((item) => item.id === action.id));
  });

  it('reject action marks pending action rejected and blocks later confirmation', async () => {
    const agentRes = await proposeOrder(studentToken);
    const action = agentRes.data.actions.find((item) => item.type === 'create_order');
    assert.ok(action?.id);

    const rejectRes = await req(`/api/agent/actions/${action.id}/reject`, { method: 'POST', token: studentToken });
    assert.equal(rejectRes.status, 200);
    assert.equal(rejectRes.data.action.status, 'rejected');

    const confirmRes = await req(`/api/agent/actions/${action.id}/confirm`, { method: 'POST', token: studentToken });
    assert.equal(confirmRes.status, 400);

    const rejected = await req('/api/agent/actions?status=rejected', { token: studentToken });
    assert.ok(rejected.data.actions.some((item) => item.id === action.id));

    const pending = await req('/api/agent/actions', { token: studentToken });
    assert.ok(!pending.data.actions.some((item) => item.id === action.id));
  });

  it('confirmed action appears in confirmed action center with result order and leaves pending list', async () => {
    const agentRes = await proposeOrder(studentToken);
    const action = agentRes.data.actions.find((item) => item.type === 'create_order');
    assert.ok(action?.id);

    const confirmRes = await req(`/api/agent/actions/${action.id}/confirm`, { method: 'POST', token: studentToken });
    assert.equal(confirmRes.status, 200);
    assert.ok(confirmRes.data.action.result.order.id);

    const confirmed = await req('/api/agent/actions?status=confirmed', { token: studentToken });
    assert.ok(confirmed.data.actions.some((item) => item.id === action.id && item.result.order.id));

    const pending = await req('/api/agent/actions', { token: studentToken });
    assert.ok(!pending.data.actions.some((item) => item.id === action.id));
  });

  it('agent stream returns named text/event-stream events with parseable data JSON', async () => {
    const agentRes = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '今天午餐推荐什么？' },
    });
    assert.equal(agentRes.status, 200);
    const sessionId = agentRes.data.sessionId;
    assert.ok(sessionId);

    const res = await fetch(`${baseUrl}/api/agent/stream?sessionId=${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('text/event-stream'));
    assert.ok(text.includes('event: agent.session'));
    assert.ok(text.includes('event: agent.message'));
    assert.ok(text.includes('event: agent.snapshot'));
    assert.ok(text.includes('event: agent.done'));
    const firstDataLine = text.split('\n').find((line) => line.startsWith('data: '));
    assert.ok(firstDataLine, 'has data line');
    assert.doesNotThrow(() => JSON.parse(firstDataLine.slice(6)));
  });

  it('assistant exposes final-form metadata, long memory, personas, and eval scores', async () => {
    const first = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '我不吃辣，今天午餐推荐什么？' },
    });
    assert.equal(first.status, 200);
    assert.ok(first.data.toolResults.catalog.some((tool) => tool.name === 'order.create.propose' && tool.parameters?.properties?.items), 'catalog exposes function parameters');
    assert.ok(first.data.steps.some((step) => step.tool === 'memory.long_term'), 'long-term memory tool is traced');
    assert.ok(first.data.personas.some((persona) => persona.name === 'nutritionist'), 'meal planning uses nutritionist persona');
    assert.equal(first.data.eval.safetyScore, 1);

    const second = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '继续按我的偏好推荐', sessionId: first.data.sessionId },
    });
    assert.equal(second.status, 200);
    assert.equal(second.data.memory.preferences.taste, '不辣');
  });

  it('realtime stream-run emits live run events and eval dashboard records metrics', async () => {
    const res = await fetch(`${baseUrl}/api/agent/stream-run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({ query: '午餐来一份番茄鸡蛋盖饭，帮我下单' }),
    });
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('text/event-stream'));
    assert.ok(text.includes('event: agent.run.started'));
    assert.ok(text.includes('event: agent.tool.finished'));
    assert.ok(text.includes('event: agent.action_required'));
    assert.ok(text.includes('event: agent.eval'));
    assert.ok(text.includes('event: agent.done'));
    const dataLines = text.split('\n').filter((line) => line.startsWith('data: '));
    assert.ok(dataLines.length >= 5);
    for (const line of dataLines) assert.doesNotThrow(() => JSON.parse(line.slice(6)));

    const studentEval = await req('/api/agent/evals', { token: studentToken });
    assert.equal(studentEval.status, 403);

    const adminEval = await req('/api/agent/evals', { token: adminToken });
    assert.equal(adminEval.status, 200);
    assert.ok(adminEval.data.metrics.totalRuns >= 1);
    assert.ok(adminEval.data.runs.length >= 1);
  });

  it('invalid action center status returns 400', async () => {
    const { status } = await req('/api/agent/actions?status=weird', { token: studentToken });
    assert.equal(status, 400);
  });
});
