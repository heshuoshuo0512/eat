import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
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
/*  Agent final-upgrade governance contracts                           */
/* ================================================================== */

describe('Agent final upgrade governance', () => {
  let adminToken;
  let studentToken;
  let otherToken;

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
      body: { username: 'gov二学生', password: 'pass789', nickname: '治理小测' },
    });
    otherToken = reg.data.token;

    // Seed a published menu so agent's order flow works
    await req('/api/admin/menus', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'gov-menu-1',
        canteenId: 'north',
        date: today(),
        mealType: 'lunch',
        status: 'published',
        items: [
          { dishId: 'd-chicken-bowl', price: 13, supplyLimit: 30, supplyCount: 0, soldOut: false },
          { dishId: 'd-egg-tomato', price: 11, supplyLimit: 30, supplyCount: 0, soldOut: false },
        ],
      },
    });
  });

  after(() => server.close());

  /* ---------------------------------------------------------------- */
  /*  1. Memory governance: expose current user memory, clear own only  */
  /* ---------------------------------------------------------------- */

  it('memory governance: GET /api/agent/memory exposes current user memory with preferences', async () => {
    // First, make an assistant call to accumulate memory for the student
    const asst = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '我不吃辣，要清真，推荐午餐' },
    });
    assert.equal(asst.status, 200);
    assert.ok(asst.data.memory, 'assistant returns memory');

    // Now use the dedicated memory endpoint
    const mem = await req('/api/agent/memory', { token: studentToken });
    assert.equal(mem.status, 200);
    assert.ok(mem.data.memory, 'memory object present');
    assert.equal(typeof mem.data.memory.summary, 'string', 'memory.summary is string');
    assert.ok(mem.data.memory.preferences, 'memory.preferences is object');
    assert.equal(mem.data.memory.preferences.taste, '不辣', 'taste persisted from assistant call');
    assert.equal(mem.data.memory.preferences.halalOnly, true, 'halalOnly persisted');
    assert.ok(mem.data.memory.updatedAt, 'memory.updatedAt present');
  });

  it('memory governance: DELETE /api/agent/memory clears own memory', async () => {
    // Clear student's memory
    const clear = await req('/api/agent/memory', { method: 'DELETE', token: studentToken });
    assert.equal(clear.status, 200);
    assert.deepEqual(clear.data.memory.preferences, {}, 'preferences reset to empty');
    assert.equal(clear.data.memory.summary, '', 'summary reset to empty');

    // Verify GET returns empty
    const after = await req('/api/agent/memory', { token: studentToken });
    assert.equal(after.status, 200);
    assert.deepEqual(after.data.memory.preferences, {}, 'GET confirms empty preferences');
    assert.equal(after.data.memory.summary, '', 'GET confirms empty summary');
  });

  it('memory governance: clearing own memory does not affect other user memory', async () => {
    // Build memory for other user
    const asst = await req('/api/agent/assistant', {
      method: 'POST',
      token: otherToken,
      body: { query: '我要增肌餐，高蛋白的' },
    });
    assert.equal(asst.status, 200);
    assert.equal(asst.data.memory.preferences.goal, 'muscleGain', 'other user has goal');

    // Clear student (fresh user, no memory built up)
    const clear = await req('/api/agent/memory', { method: 'DELETE', token: studentToken });
    assert.equal(clear.status, 200);

    // Other user's memory must remain intact
    const otherMem = await req('/api/agent/memory', { token: otherToken });
    assert.equal(otherMem.status, 200);
    assert.equal(otherMem.data.memory.preferences.goal, 'muscleGain', 'other user memory unaffected');
    assert.equal(otherMem.data.memory.preferences.taste, undefined, 'other user taste not set (unaffected)');
  });

  /* ---------------------------------------------------------------- */
  /*  2. Eval case CRUD/list/run — student rejected, admin full       */
  /* ---------------------------------------------------------------- */

  it('eval cases: student access rejected on all CRUD endpoints', async () => {
    const list = await req('/api/agent/eval-cases', { token: studentToken });
    assert.equal(list.status, 403, 'student GET returns 403');

    const create = await req('/api/agent/eval-cases', {
      method: 'POST',
      token: studentToken,
      body: { name: 'test', query: '推荐午餐' },
    });
    assert.equal(create.status, 403, 'student POST returns 403');

    const del = await req('/api/agent/eval-cases/nonexistent', { method: 'DELETE', token: studentToken });
    assert.equal(del.status, 403, 'student DELETE returns 403');
  });

  it('eval cases: admin creates, lists, updates, and deletes eval cases', async () => {
    // Create
    const created = await req('/api/agent/eval-cases', {
      method: 'POST',
      token: adminToken,
      body: {
        name: 'Halal Lunch Recommend',
        query: '推荐清真午餐',
        expectedIntent: 'meal_planning',
        requiredTools: ['rag.meal_advisor'],
        forbiddenTools: [],
        expectAction: false,
      },
    });
    assert.equal(created.status, 201, 'create returns 201');
    assert.ok(created.data.case, 'case object present');
    assert.equal(created.data.case.name, 'Halal Lunch Recommend');
    assert.equal(created.data.case.query, '推荐清真午餐');
    assert.equal(created.data.case.expectedIntent, 'meal_planning');
    assert.deepEqual(created.data.case.requiredTools, ['rag.meal_advisor']);
    assert.equal(created.data.case.enabled, true);
    assert.ok(created.data.case.id, 'case has id');
    assert.ok(created.data.case.createdAt, 'case has createdAt');

    const caseId = created.data.case.id;

    // List
    const list = await req('/api/agent/eval-cases', { token: adminToken });
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.data.cases), 'cases is array');
    assert.ok(list.data.cases.length >= 1, 'at least 1 case');
    const found = list.data.cases.find((c) => c.id === caseId);
    assert.ok(found, 'created case found in list');

    // Update
    const updated = await req(`/api/agent/eval-cases/${caseId}`, {
      method: 'PUT',
      token: adminToken,
      body: { name: 'Updated Halal', enabled: false },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.case.name, 'Updated Halal');
    assert.equal(updated.data.case.enabled, false);
    assert.ok(updated.data.case.updatedAt, 'updatedAt present after update');

    // Verify list reflects update
    const list2 = await req('/api/agent/eval-cases', { token: adminToken });
    const found2 = list2.data.cases.find((c) => c.id === caseId);
    assert.equal(found2.name, 'Updated Halal');
    assert.equal(found2.enabled, false);

    // Delete
    const del = await req(`/api/agent/eval-cases/${caseId}`, { method: 'DELETE', token: adminToken });
    assert.equal(del.status, 200);
    assert.equal(del.data.deleted, true);

    // Verify gone
    const list3 = await req('/api/agent/eval-cases', { token: adminToken });
    assert.ok(!list3.data.cases.some((c) => c.id === caseId), 'case removed after delete');
  });

  it('eval cases: run records per-case results with pass/score/metrics', async () => {
    // Create a case
    const created = await req('/api/agent/eval-cases', {
      method: 'POST',
      token: adminToken,
      body: {
        name: 'Menu Query',
        query: '今天午餐吃什么',
        expectedIntent: 'meal_planning',
        requiredTools: ['rag.meal_advisor', 'menu.today'],
        forbiddenTools: [],
      },
    });
    assert.equal(created.status, 201);

    // Run the case
    const run = await req(`/api/agent/eval-cases/${created.data.case.id}/run`, {
      method: 'POST',
      token: adminToken,
    });
    assert.equal(run.status, 200);
    assert.ok(run.data.run, 'run result present');
    assert.equal(typeof run.data.run.passed, 'boolean', 'passed is boolean');
    assert.equal(typeof run.data.run.score, 'number', 'score is number');
    assert.ok(run.data.run.score >= 0 && run.data.run.score <= 1, 'score in [0,1]');
    assert.equal(typeof run.data.run.matchedIntent, 'boolean', 'matchedIntent is boolean');
    assert.equal(typeof run.data.run.hasRequired, 'boolean', 'hasRequired is boolean');
    assert.equal(typeof run.data.run.hasForbidden, 'boolean', 'hasForbidden is boolean');
    assert.equal(typeof run.data.run.hasAction, 'boolean', 'hasAction is boolean');
    assert.ok(run.data.run.createdAt, 'run has createdAt');
    assert.equal(run.data.run.caseId, created.data.case.id, 'run linked to case');
    assert.equal(run.data.run.intent, 'meal_planning', 'run captured intent');

    // Student cannot run cases
    const studRun = await req(`/api/agent/eval-cases/${created.data.case.id}/run`, {
      method: 'POST',
      token: studentToken,
    });
    assert.equal(studRun.status, 403, 'student cannot run eval case');
  });

  /* ---------------------------------------------------------------- */
  /*  3. Action audit hardening: payloadHash, expiresAt, no secrets    */
  /* ---------------------------------------------------------------- */

  it('action audit hardening: created action exposes payloadHash and expiresAt', async () => {
    const agent = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '帮我下单一份番茄鸡蛋盖饭' },
    });
    assert.equal(agent.status, 200);
    const action = agent.data.actions.find((a) => a.type === 'create_order');
    assert.ok(action, 'create_order action present');

    // payloadHash
    assert.ok(action.payloadHash, 'action has payloadHash');
    assert.equal(typeof action.payloadHash, 'string', 'payloadHash is string');
    assert.ok(action.payloadHash.length > 0, 'payloadHash non-empty');
    // Verify it's a hex-encoded SHA-256
    assert.match(action.payloadHash, /^[0-9a-f]{64}$/, 'payloadHash is 64 hex chars (SHA-256)');

    // expiresAt
    assert.ok(action.expiresAt, 'action has expiresAt');
    assert.equal(typeof action.expiresAt, 'string', 'expiresAt is string');
    // Should be a future ISO date (at least close to now)
    const expires = new Date(action.expiresAt).getTime();
    assert.ok(!Number.isNaN(expires), 'expiresAt is valid date');
    assert.ok(expires > Date.now() - 1000, 'expiresAt is in the future');

    // Verify payloadHash matches SHA-256 of the serialized payload
    const expectedHash = createHash('sha256').update(JSON.stringify(action.payload)).digest('hex');
    assert.equal(action.payloadHash, expectedHash, 'payloadHash matches SHA-256 of payload');
  });

  it('action audit hardening: action center list includes payloadHash and expiresAt', async () => {
    // Trigger an action first
    const agent = await req('/api/agent/assistant', {
      method: 'POST',
      token: studentToken,
      body: { query: '帮我下单番茄鸡蛋盖饭' },
    });
    const actionId = agent.data.actions.find((a) => a.type === 'create_order')?.id;
    assert.ok(actionId, 'action created');

    // Query action center
    const list = await req('/api/agent/actions', { token: studentToken });
    assert.equal(list.status, 200);
    const entry = list.data.actions.find((a) => a.id === actionId);
    assert.ok(entry, 'action found in list');

    // Audit fields present
    assert.ok(entry.payloadHash, 'list entry has payloadHash');
    assert.match(entry.payloadHash, /^[0-9a-f]{64}$/, 'list entry payloadHash is SHA-256 hex');
    assert.ok(entry.expiresAt, 'list entry has expiresAt');
    assert.ok(new Date(entry.expiresAt).getTime() > 0, 'list entry expiresAt is valid date');

    // No AI key leakage — payload should be plain order info, not API keys
    assert.ok(entry.payload, 'list entry has payload');
    assert.equal(typeof entry.payload, 'object', 'payload is object');
    // Order payload should have items, not API secrets
    assert.ok(Array.isArray(entry.payload.items), 'payload.items is array');
    assert.ok(!('apiKey' in entry.payload), 'payload does not contain apiKey');
    assert.ok(!('api_key' in entry.payload), 'payload does not contain api_key');
    assert.ok(!('OPENAI_API_KEY' in entry.payload), 'payload does not contain OPENAI_API_KEY');
    assert.ok(!('SMART_CANTEEN_SECRET' in entry.payload), 'payload does not contain app secret');

    // Confirm action to verify hash survives status change
    const confirm = await req(`/api/agent/actions/${actionId}/confirm`, { method: 'POST', token: studentToken });
    assert.equal(confirm.status, 200);
    assert.ok(confirm.data.action.payloadHash, 'confirmed action has payloadHash');
    assert.match(confirm.data.action.payloadHash, /^[0-9a-f]{64}$/, 'confirmed payloadHash is valid');
  });

  /* ---------------------------------------------------------------- */
  /*  4. Deployment readiness: returns agent/runtime/schema checks     */
  /* ---------------------------------------------------------------- */

  it('deployment readiness: endpoint returns agent, runtime, and schema checks without AI keys', async () => {
    const ready = await req('/api/deployment/readiness');
    assert.equal(ready.status, 200, 'readiness returns 200');

    assert.equal(ready.data.ok, true, 'overall ok is true');

    // Agent check
    assert.ok(ready.data.checks.agent, 'agent check present');
    assert.equal(ready.data.checks.agent.status, 'ok', 'agent check status ok');

    // Runtime check
    assert.ok(ready.data.checks.runtime, 'runtime check present');
    assert.equal(ready.data.checks.runtime.status, 'ok', 'runtime check status ok');
    assert.ok(ready.data.checks.runtime.node, 'runtime check has node version');
    assert.ok(ready.data.checks.runtime.platform, 'runtime check has platform');

    // Schema check
    assert.ok(ready.data.checks.schema, 'schema check present');
    assert.equal(ready.data.checks.schema.status, 'ok', 'schema check status ok');
    assert.ok(Array.isArray(ready.data.checks.schema.tables), 'schema check has tables array');
    assert.ok(ready.data.checks.schema.tables.includes('users'), 'tables includes users');
    assert.ok(ready.data.checks.schema.tables.includes('dishes'), 'tables includes dishes');
    assert.ok(ready.data.checks.schema.tables.includes('agent_actions'), 'tables includes agent_actions');
    assert.ok(ready.data.checks.schema.tables.includes('agent_memories'), 'tables includes agent_memories');

    // No AI key leakage
    assert.equal(ready.data.aiKeysConfigured, false, 'aiKeysConfigured is false (no keys exposed)');
    assert.ok(!('aiSettings' in ready.data), 'readiness does not leak aiSettings');
    assert.ok(!('apiKey' in ready.data.checks), 'checks do not contain raw apiKey');
  });
});
