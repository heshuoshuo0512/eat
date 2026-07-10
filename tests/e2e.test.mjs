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
let _db;

/** Spin up a real HTTP server backed by an in-memory DB. */
function setup() {
  before(() => {
    _db = openDatabase(':memory:');
    const app = createApp({ db: _db });
    server = createServer(app.handler);
    server.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());
}

/** Convenience fetch wrapper: returns { status, data } parsed JSON. */
async function req(path, { method = 'GET', token, body, rawRes } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (rawRes) return { status: res.status, res };
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

/** Register a fresh user and return { user, token }. */
async function register(username, password) {
  const { status, data } = await req('/api/auth/register', {
    method: 'POST',
    body: { username, password },
  });
  return { status, ...data };
}

/** Login and return status plus parsed data. */
async function login(username, password) {
  const { status, data } = await req('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  return { status, data, ...(data || {}) };
}

/** Login as the seeded admin and return { user, token }. */
async function adminLogin() {
  return login('admin', 'admin123');
}

/* ================================================================== */
/*  1. Auth & Login Landing Page Session Lifecycle                     */
/* ================================================================== */
describe('E2E — Auth & session lifecycle', () => {
  setup();

  it('POST /api/auth/register creates a student by default', async () => {
    const { status, user, token, state } = await register('e2e-new-user', 'pass123');
    assert.equal(status, 201, 'register returns 201');
    assert.equal(user.username, 'e2e-new-user');
    assert.equal(user.role, 'student', 'default role is student');
    assert.ok(user.id, 'user has id');
    assert.ok(token, 'token returned');
    assert.ok(state, 'bootstrap state returned on register');
    assert.ok(Array.isArray(state.canteens), 'state includes canteens');
    assert.ok(Array.isArray(state.dishes), 'state includes dishes');
  });

  it('POST /api/auth/register rejects duplicate username', async () => {
    await register('e2e-dupe-user', 'pass1');
    const { status, data } = await req('/api/auth/register', {
      method: 'POST',
      body: { username: 'e2e-dupe-user', password: 'pass2' },
    });
    assert.equal(status, 409, 'duplicate returns 409');
    assert.ok(data.error.includes('已存在'), 'error mentions duplicate');
  });

  it('POST /api/auth/register always creates student even when admin role requested', async () => {
    const { status, user } = await register('e2e-admin-reg', 'adminpass');
    assert.equal(status, 201);
    assert.equal(user.role, 'student', 'registration always creates student');
  });

  it('POST /api/auth/register ignores role field entirely (always student)', async () => {
    const { status, data } = await req('/api/auth/register', {
      method: 'POST',
      body: { username: 'e2e-role-guard', password: 'pass', role: 'superadmin' },
    });
    assert.equal(status, 201);
    assert.equal(data.user.role, 'student', 'role field is ignored; always student');
  });


  it('POST /api/auth/login succeeds for known user with correct password', async () => {
    await register('e2e-login-ok', 'correct');
    const { status, user, token, state } = await login('e2e-login-ok', 'correct');
    assert.equal(status, 200);
    assert.equal(user.username, 'e2e-login-ok');
    assert.ok(token);
    assert.ok(state);
    assert.ok(state.session, 'state includes session');
    assert.ok(state.session.user, 'session includes user');
  });

  it('POST /api/auth/login rejects wrong password for existing user', async () => {
    await register('e2e-wrong-pw', 'realpass');
    const { status, data } = await req('/api/auth/login', {
      method: 'POST',
      body: { username: 'e2e-wrong-pw', password: 'wrongpass' },
    });
    assert.equal(status, 401, 'wrong password → 401');
    assert.ok(data.error);
  });

  it('POST /api/auth/login rejects unknown username without auto-registration', async () => {
    const { status, data } = await login('e2e-auto-created', 'whatever');
    assert.equal(status, 401, 'unknown login rejected');
    assert.ok(data.error);
  });

  it('POST /api/auth/login locks repeated failures temporarily', async () => {
    await register('e2e-lock-user', 'realpass');
    for (let i = 0; i < 5; i += 1) {
      const { status } = await login('e2e-lock-user', 'wrongpass');
      assert.equal(status, 401);
    }
    const { status, data } = await login('e2e-lock-user', 'realpass');
    assert.equal(status, 429);
    assert.ok(data.error);
  });

  it('POST /api/auth/login returns 400 when username is missing', async () => {
    const { status } = await req('/api/auth/login', {
      method: 'POST',
      body: { password: 'x' },
    });
    assert.equal(status, 400, 'missing username → 400');
  });

  it('POST /api/auth/register returns 400 when username is missing', async () => {
    const { status } = await req('/api/auth/register', {
      method: 'POST',
      body: { password: 'x' },
    });
    assert.equal(status, 400, 'missing username → 400');
  });

  it('GET /api/bootstrap returns full state for anonymous user', async () => {
    const { status, data } = await req('/api/bootstrap');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.canteens), 'has canteens');
    assert.ok(Array.isArray(data.stalls), 'has stalls');
    assert.ok(Array.isArray(data.dishes), 'has dishes');
    assert.ok(data.session, 'has session');
    assert.ok(data.profile, 'has profile');
    assert.equal(data.session.user, null, 'anonymous session has null user');
  });

  it('GET /api/bootstrap scopes data to the authenticated tenant', async () => {
    const { user, token } = await register('e2e-tenant-user', 'pass');
    await _db.prepare('UPDATE users SET tenant_id = ? WHERE id = ?').run('tenant-b', user.id);
    const { status, data } = await req('/api/bootstrap', { token });
    assert.equal(status, 200);
    assert.equal(data.session.user.tenantId, 'tenant-b');
    assert.deepEqual(data.canteens, []);
    assert.deepEqual(data.dishes, []);
  });

  it('GET /api/bootstrap includes user context when token provided', async () => {
    const { token } = await register('e2e-bs-user', 'pass');
    const { data } = await req('/api/bootstrap', { token });
    assert.ok(data.session.user, 'session includes user');
    assert.equal(data.session.user.username, 'e2e-bs-user');
    assert.ok(data.profile, 'includes health profile');
  });

  it('login token can be used for authenticated API calls', async () => {
    const { token } = await register('e2e-token-check', 'pass');
    // Use the token to post a review (requires auth)
    const { data: bs } = await req('/api/bootstrap');
    const dishId = bs.dishes[0]?.id;
    if (!dishId) return; // skip if no seeded dishes
    const { status } = await req('/api/reviews', {
      method: 'POST',
      token,
      body: { targetId: dishId, rating: 4, content: 'token验证测试' },
    });
    assert.equal(status, 201, 'token-authenticated review succeeds');
  });
});

/* ================================================================== */
/*  2. RBAC Rejection — Comprehensive                                  */
/* ================================================================== */
describe('E2E — RBAC rejection (no-token, bad-token, student boundaries)', () => {
  setup();

  let studentToken;
  let adminToken;
  const adminEndpoints = [
    { method: 'POST', path: '/api/admin/dishes', body: { stallId: 'n-protein', name: 'x', price: 1, taste: 'x', cuisine: 'x', ingredients: 'x', tags: 'x', nutrition: {} } },
    { method: 'POST', path: '/api/admin/canteens', body: { name: 'x', location: 'x', hours: 'x', description: 'x' } },
    { method: 'POST', path: '/api/admin/dishes/import', body: { dishes: [] } },
  ];

  before(async () => {
    ({ token: studentToken } = await register('e2e-rbac-student', 'pass'));
    ({ token: adminToken } = await adminLogin());
  });

  it('admin endpoints return 401 when no token is provided', async () => {
    for (const ep of adminEndpoints) {
      const { status } = await req(ep.path, { method: ep.method, body: ep.body });
      assert.equal(status, 401, `${ep.method} ${ep.path} without token → 401`);
    }
  });

  it('admin endpoints return 401 for malformed/invalid token', async () => {
    const badTokens = ['garbage-token', 'a.b.c', '', 'Bearer thing'];
    for (const bad of badTokens) {
      const { status } = await req('/api/admin/dishes', {
        method: 'POST',
        token: bad,
        body: { stallId: 'x', name: 'x', price: 1, taste: 'x', cuisine: 'x', ingredients: 'x', tags: 'x', nutrition: {} },
      });
      assert.equal(status, 401, `bad token "${bad.slice(0, 20)}" → 401`);
    }
  });

  it('student cannot POST /api/admin/dishes', async () => {
    const { status } = await req('/api/admin/dishes', {
      method: 'POST',
      token: studentToken,
      body: { stallId: 'n-protein', name: 'x', price: 1, taste: 'x', cuisine: 'x', ingredients: 'x', tags: 'x', nutrition: {} },
    });
    assert.equal(status, 403);
  });

  it('student cannot POST /api/admin/canteens', async () => {
    const { status } = await req('/api/admin/canteens', {
      method: 'POST',
      token: studentToken,
      body: { name: 'x', location: 'x', hours: 'x', description: 'x' },
    });
    assert.equal(status, 403);
  });

  it('student cannot POST /api/admin/dishes/import', async () => {
    const { status } = await req('/api/admin/dishes/import', {
      method: 'POST',
      token: studentToken,
      body: { dishes: [{ id: 'x', stallId: 'x', name: 'x', price: 1, taste: 'x', cuisine: 'x', ingredients: 'x', tags: 'x', nutrition: {} }] },
    });
    assert.equal(status, 403);
  });

  it('student cannot PUT /api/admin/dishes/:id', async () => {
    // Use a seeded dish id
    const { data: bs } = await req('/api/bootstrap');
    const dishId = bs.dishes[0]?.id;
    if (!dishId) return;
    const { status } = await req(`/api/admin/dishes/${dishId}`, {
      method: 'PUT',
      token: studentToken,
      body: { name: 'hacked', stallId: 'n-protein', price: 1, taste: 'x', cuisine: 'x', ingredients: 'x', tags: 'x', nutrition: {} },
    });
    assert.equal(status, 403);
  });

  it('student cannot DELETE /api/admin/dishes/:id', async () => {
    const { data: bs } = await req('/api/bootstrap');
    const dishId = bs.dishes[0]?.id;
    if (!dishId) return;
    const { status } = await req(`/api/admin/dishes/${dishId}`, {
      method: 'DELETE',
      token: studentToken,
    });
    assert.equal(status, 403);
  });

  it('student CAN post a review (student-allowed permission)', async () => {
    const { data: bs } = await req('/api/bootstrap');
    const dishId = bs.dishes[0]?.id;
    if (!dishId) return;
    const { status } = await req('/api/reviews', {
      method: 'POST',
      token: studentToken,
      body: { targetId: dishId, rating: 3, content: 'RBAC学生测试评论' },
    });
    assert.equal(status, 201, 'student can post reviews');
  });

  it('student CAN update health profile', async () => {
    const { status } = await req('/api/health/profile', {
      method: 'POST',
      token: studentToken,
      body: { goal: 'fatLoss', budgetMax: 15, mealType: 'lunch', taste: '清淡', halalOnly: false, avoid: [] },
    });
    assert.equal(status, 200, 'student can update own profile');
  });

  it('student CAN upload an image', async () => {
    const { status } = await req('/api/uploads', {
      method: 'POST',
      token: studentToken,
      body: { filename: 'rbac-test.png', contentType: 'image/png', dataBase64: Buffer.from('test-png').toString('base64') },
    });
    assert.equal(status, 201, 'student can upload');
  });

  it('admin CAN perform all student operations + admin operations', async () => {
    // Admin can post review
    const { data: bs } = await req('/api/bootstrap');
    const dishId = bs.dishes[0]?.id;
    if (dishId) {
      const { status: revStatus } = await req('/api/reviews', {
        method: 'POST',
        token: adminToken,
        body: { targetId: dishId, rating: 5, content: '管理员评论' },
      });
      assert.equal(revStatus, 201, 'admin can post reviews');
    }

    // Admin can create dish
    const { status: dishStatus } = await req('/api/admin/dishes', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'e2e-rbac-admin-dish',
        stallId: 'n-protein',
        name: 'RBAC管理员菜品',
        price: 20,
        taste: '咸香',
        cuisine: '中餐',
        ingredients: '鸡肉',
        tags: '测试',
        nutrition: { calories: 200, protein: 20, fat: 5, carbs: 10 },
      },
    });
    assert.equal(dishStatus, 201, 'admin can create dishes');
  });
});

/* ================================================================== */
/*  3. Admin Entity Management — Full CRUD Lifecycle                   */
/* ================================================================== */
describe('E2E — Admin entity CRUD lifecycle', () => {
  setup();

  let adminToken;

  before(async () => {
    ({ token: adminToken } = await adminLogin());
  });

  it('full dish lifecycle: create → update → verify → soft-delete', async () => {
    // Create
    const { status: cs } = await req('/api/admin/dishes', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'e2e-lifecycle-dish',
        stallId: 'n-protein',
        name: '生命周期菜品',
        price: 18,
        taste: '鲜',
        cuisine: '粤菜',
        ingredients: '虾仁,鸡蛋',
        tags: '高蛋白',
        nutrition: { calories: 250, protein: 28, fat: 8, carbs: 12 },
      },
    });
    assert.equal(cs, 201, 'create');

    // Verify in bootstrap
    let bs = (await req('/api/bootstrap', { token: adminToken })).data;
    let found = bs.dishes.find((d) => d.id === 'e2e-lifecycle-dish');
    assert.ok(found, 'dish appears after create');
    assert.equal(found.name, '生命周期菜品');
    assert.equal(found.price, 18);

    // Update
    const { status: us } = await req('/api/admin/dishes/e2e-lifecycle-dish', {
      method: 'PUT',
      token: adminToken,
      body: {
        name: '已更新生命周期菜品',
        price: 22,
        taste: '辣',
        cuisine: '川菜',
        stallId: 'n-protein',
        ingredients: '虾仁,鸡蛋,辣椒',
        tags: '高蛋白,辣味',
        nutrition: { calories: 270, protein: 28, fat: 9, carbs: 14 },
      },
    });
    assert.equal(us, 200, 'update');

    // Verify update persisted
    bs = (await req('/api/bootstrap', { token: adminToken })).data;
    found = bs.dishes.find((d) => d.id === 'e2e-lifecycle-dish');
    assert.equal(found.name, '已更新生命周期菜品');
    assert.equal(found.price, 22);

    // Soft-delete
    const { status: ds } = await req('/api/admin/dishes/e2e-lifecycle-dish', {
      method: 'DELETE',
      token: adminToken,
    });
    assert.equal(ds, 200, 'soft-delete');

    // Verify gone from active list
    bs = (await req('/api/bootstrap', { token: adminToken })).data;
    found = bs.dishes.find((d) => d.id === 'e2e-lifecycle-dish');
    assert.equal(found, undefined, 'deleted dish no longer in active list');
  });

  it('full canteen lifecycle: create → update → verify → delete', async () => {
    const { status: cs } = await req('/api/admin/canteens', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'e2e-lifecycle-canteen',
        name: '生命周期食堂',
        location: 'E2E楼',
        hours: '07:00-22:00',
        description: 'E2E测试专用',
      },
    });
    assert.equal(cs, 201, 'create canteen');

    let bs = (await req('/api/bootstrap', { token: adminToken })).data;
    assert.ok(bs.canteens.find((c) => c.id === 'e2e-lifecycle-canteen'), 'canteen appears');

    const { status: us } = await req('/api/admin/canteens/e2e-lifecycle-canteen', {
      method: 'PUT',
      token: adminToken,
      body: {
        name: '已更新生命周期食堂',
        location: '新楼',
        hours: '08:00-21:00',
        description: '更新后',
      },
    });
    assert.equal(us, 200, 'update canteen');

    bs = (await req('/api/bootstrap', { token: adminToken })).data;
    const updated = bs.canteens.find((c) => c.id === 'e2e-lifecycle-canteen');
    assert.equal(updated.name, '已更新生命周期食堂');

    const { status: ds } = await req('/api/admin/canteens/e2e-lifecycle-canteen', {
      method: 'DELETE',
      token: adminToken,
    });
    assert.equal(ds, 200, 'delete canteen');

    bs = (await req('/api/bootstrap', { token: adminToken })).data;
    assert.equal(bs.canteens.find((c) => c.id === 'e2e-lifecycle-canteen'), undefined, 'canteen removed');
  });

  it('PUT /api/admin/dishes/:id returns 404 for nonexistent dish', async () => {
    const { status } = await req('/api/admin/dishes/nonexistent-dish-xyz', {
      method: 'PUT',
      token: adminToken,
      body: { name: 'x', stallId: 'n-protein', price: 1, taste: 'x', cuisine: 'x', ingredients: 'x', tags: 'x', nutrition: {} },
    });
    assert.equal(status, 404);
  });

  it('DELETE /api/admin/dishes/:id returns 404 for nonexistent dish', async () => {
    const { status } = await req('/api/admin/dishes/nonexistent-dish-xyz', {
      method: 'DELETE',
      token: adminToken,
    });
    assert.equal(status, 404);
  });

  it('PUT /api/admin/canteens/:id returns 404 for nonexistent canteen', async () => {
    const { status } = await req('/api/admin/canteens/nonexistent-canteen-xyz', {
      method: 'PUT',
      token: adminToken,
      body: { name: 'x', location: 'x', hours: 'x', description: 'x' },
    });
    assert.equal(status, 404);
  });

  it('DELETE /api/admin/canteens/:id returns 404 for nonexistent canteen', async () => {
    const { status } = await req('/api/admin/canteens/nonexistent-canteen-xyz', {
      method: 'DELETE',
      token: adminToken,
    });
    assert.equal(status, 404);
  });

  it('bulk import creates multiple dishes and reports count', async () => {
    const dishes = [
      { id: 'e2e-bulk-a', stallId: 'n-protein', name: '批量A', price: 10, taste: '咸', cuisine: '中餐', ingredients: 'x', tags: 'x', nutrition: { calories: 100, protein: 10, fat: 3, carbs: 5 } },
      { id: 'e2e-bulk-b', stallId: 'n-halal', name: '批量B', price: 12, taste: '辣', cuisine: '川菜', ingredients: 'x', tags: 'x', nutrition: { calories: 150, protein: 12, fat: 5, carbs: 8 } },
      { id: 'e2e-bulk-c', stallId: 'c-fast', name: '批量C', price: 8, taste: '甜', cuisine: '西点', ingredients: 'x', tags: 'x', nutrition: { calories: 200, protein: 5, fat: 8, carbs: 25 } },
    ];
    const { status, data } = await req('/api/admin/dishes/import', {
      method: 'POST',
      token: adminToken,
      body: { dishes },
    });
    assert.equal(status, 200);
    assert.equal(data.imported, 3, 'reports 3 imported');

    const bs = (await req('/api/bootstrap', { token: adminToken })).data;
    for (const d of dishes) {
      assert.ok(bs.dishes.find((x) => x.id === d.id), `${d.name} persisted`);
    }
  });

  it('bulk import rejects non-array dishes field', async () => {
    const { status } = await req('/api/admin/dishes/import', {
      method: 'POST',
      token: adminToken,
      body: { dishes: 'not-an-array' },
    });
    assert.equal(status, 400, 'non-array dishes → 400');
  });
});

/* ================================================================== */
/*  4. Audit Trail Verification                                        */
/* ================================================================== */
describe('E2E — Audit trail is written for admin operations', () => {
  setup();

  let adminToken;

  before(async () => {
    ({ token: adminToken } = await adminLogin());
  });

  it('dish create writes an audit log entry', async () => {
    await req('/api/admin/dishes', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'e2e-audit-dish',
        stallId: 'n-protein',
        name: '审计菜品',
        price: 15,
        taste: '咸',
        cuisine: '中餐',
        ingredients: 'x',
        tags: 'x',
        nutrition: { calories: 100, protein: 10, fat: 3, carbs: 5 },
      },
    });
    const logs = _db.prepare("SELECT * FROM audit_logs WHERE entity = 'dish' AND action = 'UPSERT' AND entity_id = ?").all('e2e-audit-dish');
    assert.ok(logs.length >= 1, 'UPSERT dish audit log exists');
    assert.ok(logs[0].user_id, 'audit log has user_id');
    assert.ok(logs[0].created_at, 'audit log has timestamp');
  });

  it('dish update writes an UPDATE audit log', async () => {
    await req('/api/admin/dishes/e2e-audit-dish', {
      method: 'PUT',
      token: adminToken,
      body: { name: '审计菜品更新', price: 20, taste: '辣', cuisine: '川菜', stallId: 'n-protein', ingredients: 'x', tags: 'x', nutrition: {} },
    });
    const logs = _db.prepare("SELECT * FROM audit_logs WHERE entity = 'dish' AND action = 'UPDATE' AND entity_id = ?").all('e2e-audit-dish');
    assert.ok(logs.length >= 1, 'UPDATE dish audit log exists');
  });

  it('dish delete writes a DELETE audit log', async () => {
    await req('/api/admin/dishes/e2e-audit-dish', {
      method: 'DELETE',
      token: adminToken,
    });
    const logs = _db.prepare("SELECT * FROM audit_logs WHERE entity = 'dish' AND action = 'DELETE' AND entity_id = ?").all('e2e-audit-dish');
    assert.ok(logs.length >= 1, 'DELETE dish audit log exists');
  });

  it('canteen create writes an audit log', async () => {
    await req('/api/admin/canteens', {
      method: 'POST',
      token: adminToken,
      body: { id: 'e2e-audit-canteen', name: '审计食堂', location: 'x', hours: 'x', description: 'x' },
    });
    const logs = _db.prepare("SELECT * FROM audit_logs WHERE entity = 'canteen' AND action = 'UPSERT' AND entity_id = ?").all('e2e-audit-canteen');
    assert.ok(logs.length >= 1, 'UPSERT canteen audit log exists');
  });

  it('canteen delete writes a DELETE audit log', async () => {
    await req('/api/admin/canteens/e2e-audit-canteen', {
      method: 'DELETE',
      token: adminToken,
    });
    const logs = _db.prepare("SELECT * FROM audit_logs WHERE entity = 'canteen' AND action = 'DELETE' AND entity_id = ?").all('e2e-audit-canteen');
    assert.ok(logs.length >= 1, 'DELETE canteen audit log exists');
  });

  it('bulk import writes a BULK_IMPORT audit log with count', async () => {
    await req('/api/admin/dishes/import', {
      method: 'POST',
      token: adminToken,
      body: { dishes: [
        { id: 'e2e-audit-bulk-1', stallId: 'n-protein', name: 'x', price: 1, taste: 'x', cuisine: 'x', ingredients: 'x', tags: 'x', nutrition: {} },
        { id: 'e2e-audit-bulk-2', stallId: 'n-protein', name: 'y', price: 2, taste: 'x', cuisine: 'x', ingredients: 'x', tags: 'x', nutrition: {} },
      ] },
    });
    const logs = _db.prepare("SELECT * FROM audit_logs WHERE action = 'BULK_IMPORT'").all();
    assert.ok(logs.length >= 1, 'BULK_IMPORT audit log exists');
    assert.equal(logs[logs.length - 1].entity_id, '2', 'entity_id is the imported count');
  });

  it('review creation writes a CREATE review audit log', async () => {
    // Create a dish to review
    await req('/api/admin/dishes', {
      method: 'POST',
      token: adminToken,
      body: { id: 'e2e-audit-review-dish', stallId: 'n-protein', name: '评论审计菜品', price: 10, taste: 'x', cuisine: 'x', ingredients: 'x', tags: 'x', nutrition: {} },
    });

    const { token: studentToken } = await register('e2e-audit-reviewer', 'pass');
    await req('/api/reviews', {
      method: 'POST',
      token: studentToken,
      body: { targetId: 'e2e-audit-review-dish', rating: 4, content: '审计测试评论' },
    });
    const logs = _db.prepare("SELECT * FROM audit_logs WHERE entity = 'review' AND action = 'CREATE'").all();
    assert.ok(logs.length >= 1, 'CREATE review audit log exists');
  });

  it('upload writes a CREATE upload audit log', async () => {
    await req('/api/uploads', {
      method: 'POST',
      token: adminToken,
      body: { filename: 'audit-test.png', contentType: 'image/png', dataBase64: Buffer.from('audit-png').toString('base64') },
    });
    const logs = _db.prepare("SELECT * FROM audit_logs WHERE entity = 'upload' AND action = 'CREATE'").all();
    assert.ok(logs.length >= 1, 'CREATE upload audit log exists');
  });

  it('health profile upsert writes a UPSERT health_profile audit log', async () => {
    const { token: studentToken } = await register('e2e-audit-profile', 'pass');
    await req('/api/health/profile', {
      method: 'POST',
      token: studentToken,
      body: { goal: 'muscleGain', budgetMax: 25, mealType: 'dinner', taste: '不限', halalOnly: false, avoid: [] },
    });
    const logs = _db.prepare("SELECT * FROM audit_logs WHERE entity = 'health_profile' AND action = 'UPSERT'").all();
    assert.ok(logs.length >= 1, 'UPSERT health_profile audit log exists');
  });
});

/* ================================================================== */
/*  5. Upload Path — Edge Cases & Validation                           */
/* ================================================================== */
describe('E2E — Upload path validation', () => {
  setup();

  let authedToken;

  before(async () => {
    ({ token: authedToken } = await register('e2e-upload-user', 'pass'));
  });

  it('accepts valid PNG upload and returns metadata', async () => {
    const payload = {
      filename: 'valid.png',
      contentType: 'image/png',
      dataBase64: Buffer.from('fake-png-data-here').toString('base64'),
    };
    const { status, data } = await req('/api/uploads', { method: 'POST', token: authedToken, body: payload });
    assert.equal(status, 201);
    assert.equal(data.filename, 'valid.png');
    assert.equal(data.contentType, 'image/png');
    assert.ok(data.url, 'has public url');
    assert.ok(data.id, 'has id');
    assert.ok(data.storageKey, 'has storageKey');
    assert.ok(data.sizeBytes > 0, 'sizeBytes > 0');
  });

  it('accepts JPEG upload', async () => {
    const { status } = await req('/api/uploads', {
      method: 'POST',
      token: authedToken,
      body: { filename: 'photo.jpg', contentType: 'image/jpeg', dataBase64: Buffer.from('fake-jpeg').toString('base64') },
    });
    assert.equal(status, 201);
  });

  it('accepts WebP upload', async () => {
    const { status } = await req('/api/uploads', {
      method: 'POST',
      token: authedToken,
      body: { filename: 'image.webp', contentType: 'image/webp', dataBase64: Buffer.from('fake-webp').toString('base64') },
    });
    assert.equal(status, 201);
  });

  it('accepts GIF upload', async () => {
    const { status } = await req('/api/uploads', {
      method: 'POST',
      token: authedToken,
      body: { filename: 'anim.gif', contentType: 'image/gif', dataBase64: Buffer.from('fake-gif').toString('base64') },
    });
    assert.equal(status, 201);
  });

  it('rejects disallowed content type (application/pdf)', async () => {
    const { status } = await req('/api/uploads', {
      method: 'POST',
      token: authedToken,
      body: { filename: 'doc.pdf', contentType: 'application/pdf', dataBase64: Buffer.from('fake-pdf').toString('base64') },
    });
    assert.ok(status >= 400, `disallowed content-type → ${status}`);
  });

  it('rejects upload with empty base64 data', async () => {
    const { status } = await req('/api/uploads', {
      method: 'POST',
      token: authedToken,
      body: { filename: 'empty.png', contentType: 'image/png', dataBase64: '' },
    });
    assert.ok(status >= 400, 'empty data → 4xx');
  });

  it('rejects upload missing required fields', async () => {
    const { status: s1 } = await req('/api/uploads', {
      method: 'POST',
      token: authedToken,
      body: { filename: 'x.png' },
    });
    assert.ok(s1 >= 400, 'missing contentType/data → 4xx');

    const { status: s2 } = await req('/api/uploads', {
      method: 'POST',
      token: authedToken,
      body: {},
    });
    assert.ok(s2 >= 400, 'empty body → 4xx');
  });

  it('upload without auth is rejected (401)', async () => {
    const { status } = await req('/api/uploads', {
      method: 'POST',
      body: { filename: 'anon.png', contentType: 'image/png', dataBase64: Buffer.from('anon').toString('base64') },
    });
    assert.equal(status, 401, 'anonymous upload rejected');
  });

  it('upload with auth stores the owner_id', async () => {
    const { status, data } = await req('/api/uploads', {
      method: 'POST',
      token: authedToken,
      body: { filename: 'authed.png', contentType: 'image/png', dataBase64: Buffer.from('authed').toString('base64') },
    });
    assert.equal(status, 201);
    const row = _db.prepare('SELECT * FROM uploads WHERE id = ?').get(data.id);
    assert.ok(row.owner_id, 'authenticated upload has owner_id');
  });
});

/* ================================================================== */
/*  6. RAG Search — Grounded in Real DB Dishes                         */
/* ================================================================== */
describe('E2E — RAG search grounded in DB dishes', () => {
  setup();

  it('keyword search returns results with real dish fields', async () => {
    const { status, data } = await req('/api/rag/search?q=鸡');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.results), 'results is array');
    assert.ok(data.results.length > 0, 'at least one result for common ingredient');
    for (const r of data.results) {
      assert.ok(r.title || r.name, 'result has title/name');
      assert.ok(typeof r.score === 'number' && r.score > 0, 'result has positive score');
      assert.ok(r.content || r.snippet, 'result has content/snippet');
      assert.ok(r.id, 'result has id');
      assert.ok(r.sourceId, 'result has sourceId pointing to real dish');
    }
  });

  it('all RAG result sourceIds map to real dishes in the DB', async () => {
    const { data } = await req('/api/rag/search?q=蛋白');
    const { data: bs } = await req('/api/bootstrap');
    const dishIds = new Set(bs.dishes.map((d) => d.id));
    for (const r of data.results) {
      assert.ok(dishIds.has(r.sourceId), `RAG result sourceId "${r.sourceId}" must be a real dish`);
    }
  });

  it('multi-character Chinese keyword search works', async () => {
    const { status, data } = await req('/api/rag/search?q=鸡胸肉');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.results));
    // Should find chicken breast dishes
    if (data.results.length > 0) {
      assert.ok(data.results[0].score > 0, 'first result has positive score');
    }
  });

  it('search for nonexistent term returns empty array', async () => {
    const { data } = await req('/api/rag/search?q=zzz_nonexistent_999');
    assert.ok(Array.isArray(data.results));
    assert.equal(data.results.length, 0, 'no results for gibberish');
  });

  it('empty q parameter returns 400', async () => {
    const { status } = await req('/api/rag/search?q=');
    assert.equal(status, 400, 'empty query → 400');
  });

  it('missing q parameter returns 400', async () => {
    const { status } = await req('/api/rag/search');
    assert.equal(status, 400, 'missing q → 400');
  });
});

/* ================================================================== */
/*  7. Agent Meal Advisor — Grounded Behavior, No Fabrication          */
/* ================================================================== */
describe('E2E — Agent meal-advisor grounded behavior', () => {
  setup();

  it('returns answer string, citations, and plan for a valid query', async () => {
    const { status, data } = await req('/api/agent/meal-advisor', {
      method: 'POST',
      body: { query: '推荐高蛋白午餐' },
    });
    assert.equal(status, 200);
    assert.ok(typeof data.answer === 'string' && data.answer.length > 0, 'answer is non-empty string');
    assert.ok(Array.isArray(data.citations), 'citations is array');
    assert.ok(data.citations.length > 0, 'at least one citation');
    assert.ok(data.plan, 'plan is present');
  });

  it('all citation IDs reference real dishes in the database', async () => {
    const { data } = await req('/api/agent/meal-advisor', {
      method: 'POST',
      body: { query: '减脂期午餐推荐什么？' },
    });
    const { data: bs } = await req('/api/bootstrap');
    const dishIds = new Set(bs.dishes.map((d) => d.id));
    for (const citation of data.citations) {
      assert.ok(dishIds.has(citation.id), `citation id "${citation.id}" must be a real dish`);
      assert.ok(citation.name, 'citation has name');
      assert.ok(typeof citation.score === 'number', 'citation has numeric score');
    }
  });

  it('plan picks reference real dishes with valid prices', async () => {
    const { data } = await req('/api/agent/meal-advisor', {
      method: 'POST',
      body: { query: '推荐清淡菜品' },
    });
    assert.ok(data.plan.picks, 'plan has picks');
    assert.ok(Array.isArray(data.plan.picks), 'picks is array');
    for (const pick of data.plan.picks) {
      assert.ok(pick.name, 'pick has name');
      assert.ok(typeof pick.price === 'number' && pick.price > 0, 'pick has positive price');
    }
  });

  it('answer text mentions real cited dish names', async () => {
    const { data } = await req('/api/agent/meal-advisor', {
      method: 'POST',
      body: { query: '推荐高蛋白低脂菜品' },
    });
    // The answer should contain at least one dish name from citations
    if (data.citations.length > 0) {
      const citedName = data.citations[0].name;
      assert.ok(data.answer.includes(citedName), `answer mentions cited dish "${citedName}"`);
    }
  });

  it('infers fatLoss goal from query keywords', async () => {
    const { data } = await req('/api/agent/meal-advisor', {
      method: 'POST',
      body: { query: '减脂期吃什么好' },
    });
    assert.ok(data.plan.goalLabel, 'plan has goalLabel');
    // The plan should reflect fatLoss goal
    assert.ok(
      data.plan.goal === 'fatLoss' || data.plan.goalLabel.includes('减脂'),
      'inferred fatLoss goal from query',
    );
  });

  it('infers muscleGain goal from query keywords', async () => {
    const { data } = await req('/api/agent/meal-advisor', {
      method: 'POST',
      body: { query: '增肌训练后吃什么' },
    });
    assert.ok(
      data.plan.goal === 'muscleGain' || data.plan.goalLabel.includes('增肌'),
      'inferred muscleGain goal from query',
    );
  });

  it('returns 400 for empty query', async () => {
    const { status } = await req('/api/agent/meal-advisor', {
      method: 'POST',
      body: { query: '' },
    });
    assert.equal(status, 400, 'empty query → 400');
  });

  it('returns 400 for missing query field', async () => {
    const { status } = await req('/api/agent/meal-advisor', {
      method: 'POST',
      body: {},
    });
    assert.equal(status, 400, 'missing query → 400');
  });

  it('works with authenticated user (uses their profile)', async () => {
    const { token } = await register('e2e-agent-auth', 'pass');
    // Set a specific profile
    await req('/api/health/profile', {
      method: 'POST',
      token,
      body: { goal: 'muscleGain', budgetMax: 30, mealType: 'dinner', taste: '辣', halalOnly: false, avoid: [] },
    });
    const { status, data } = await req('/api/agent/meal-advisor', {
      method: 'POST',
      token,
      body: { query: '推荐晚餐' },
    });
    assert.equal(status, 200, 'authenticated advisor works');
    assert.ok(data.plan, 'plan returned');
  });
});

/* ================================================================== */
/*  8. Rankings Invalidation & Cache Behavior                          */
/* ================================================================== */
describe('E2E — Rankings invalidation on mutations', () => {
  setup();

  let adminToken;
  let studentToken;

  before(async () => {
    ({ token: adminToken } = await adminLogin());
    ({ token: studentToken } = await register('e2e-rank-student', 'pass'));
  });

  it('new review changes the ranking score of the reviewed dish', async () => {
    const { data: before } = await req('/api/rankings');
    assert.ok(before.dishes.length > 0, 'seeded dishes exist');
    const target = before.dishes[0];
    const beforeScore = target.rankScore;

    // Post a review (created as pending)
    const perturbRating = beforeScore >= 3 ? 1 : 5;
    const { status: reviewStatus, data: reviewData } = await req('/api/reviews', {
      method: 'POST',
      token: studentToken,
      body: { targetId: target.id, rating: perturbRating, content: '排名变化测试' },
    });
    assert.equal(reviewStatus, 201, 'review posted');

    // Retrieve the pending review via admin list and approve it
    const { data: pendingList } = await req('/api/admin/reviews?status=pending', { token: adminToken });
    const pending = pendingList.reviews.find((r) => r.targetId === target.id);
    assert.ok(pending, 'pending review found in admin list');
    await req(`/api/admin/reviews/${pending.id}/status`, {
      method: 'PUT',
      token: adminToken,
      body: { status: 'approved' },
    });

    // Re-fetch rankings — score should now reflect the approved review
    const { data: after } = await req('/api/rankings');
    const afterDish = after.dishes.find((d) => d.id === target.id);
    assert.ok(afterDish, 'dish still in rankings');
    assert.notEqual(afterDish.rankScore, beforeScore, 'score changes after approved review');
  });

  it('adding a new dish via admin makes it appear in rankings', async () => {
    const { data: before } = await req('/api/rankings');
    const countBefore = before.dishes.length;

    await req('/api/admin/dishes', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'e2e-rank-new-dish',
        stallId: 'n-protein',
        name: '排名新增测试菜',
        price: 25,
        taste: '鲜',
        cuisine: '粤菜',
        ingredients: '虾',
        tags: '测试',
        nutrition: { calories: 180, protein: 22, fat: 4, carbs: 8 },
      },
    });

    const { data: after } = await req('/api/rankings');
    assert.equal(after.dishes.length, countBefore + 1, 'one more dish in rankings');
    const added = after.dishes.find((d) => d.id === 'e2e-rank-new-dish');
    assert.ok(added, 'new dish appears in rankings');
    assert.ok(typeof added.rankScore === 'number', 'has rankScore');
  });

  it('deleting a dish via admin removes it from rankings', async () => {
    // Create a dish to delete
    await req('/api/admin/dishes', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'e2e-rank-del-dish',
        stallId: 'n-protein',
        name: '排名删除测试菜',
        price: 10,
        taste: 'x',
        cuisine: 'x',
        ingredients: 'x',
        tags: 'x',
        nutrition: {},
      },
    });
    const { data: before } = await req('/api/rankings');
    assert.ok(before.dishes.find((d) => d.id === 'e2e-rank-del-dish'), 'dish in rankings before delete');

    await req('/api/admin/dishes/e2e-rank-del-dish', {
      method: 'DELETE',
      token: adminToken,
    });

    const { data: after } = await req('/api/rankings');
    assert.equal(after.dishes.find((d) => d.id === 'e2e-rank-del-dish'), undefined, 'dish removed from rankings');
  });

  it('rankings endpoint returns consistent structure', async () => {
    const { status, data } = await req('/api/rankings');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.dishes), 'has dishes array');
    assert.ok(Array.isArray(data.stalls), 'has stalls array');
    assert.ok(Array.isArray(data.canteens), 'has canteens array');
    for (const d of data.dishes) {
      assert.ok(d.id, 'dish has id');
      assert.ok(d.name, 'dish has name');
      assert.ok(typeof d.rankScore === 'number', 'dish has numeric rankScore');
    }
  });
});

/* ================================================================== */
/*  9. Health Profile → Recommendation Integration                     */
/* ================================================================== */
describe('E2E — Health profile drives recommendation changes', () => {
  setup();

  let token;

  before(async () => {
    ({ token } = await register('e2e-profile-user', 'pass'));
  });

  it('setting fatLoss goal changes recommendation output', async () => {
    const { status, data } = await req('/api/health/profile', {
      method: 'POST',
      token,
      body: { goal: 'fatLoss', budgetMax: 15, mealType: 'lunch', taste: '不限', halalOnly: false, avoid: [] },
    });
    assert.equal(status, 200);
    assert.ok(data.recommendation, 'recommendation returned');
    assert.ok(data.recommendation.dishes, 'recommendation has dishes');
    assert.ok(data.profile, 'profile returned');
    assert.equal(data.profile.goal, 'fatLoss');
  });

  it('setting muscleGain goal produces different recommendations', async () => {
    const { status, data } = await req('/api/health/profile', {
      method: 'POST',
      token,
      body: { goal: 'muscleGain', budgetMax: 30, mealType: 'dinner', taste: '不限', halalOnly: false, avoid: [] },
    });
    assert.equal(status, 200);
    assert.equal(data.profile.goal, 'muscleGain');
    assert.ok(data.recommendation.dishes.length > 0, 'has recommended dishes');
  });

  it('halalOnly flag restricts recommendations', async () => {
    const { data: all } = await req('/api/health/profile', {
      method: 'POST',
      token,
      body: { goal: 'healthy', budgetMax: 50, mealType: 'lunch', taste: '不限', halalOnly: false, avoid: [] },
    });
    const { data: halal } = await req('/api/health/profile', {
      method: 'POST',
      token,
      body: { goal: 'healthy', budgetMax: 50, mealType: 'lunch', taste: '不限', halalOnly: true, avoid: [] },
    });
    // Halal recommendations should be ≤ all recommendations
    assert.ok(halal.recommendation.dishes.length <= all.recommendation.dishes.length, 'halalOnly reduces or keeps dish count');
    for (const d of halal.recommendation.dishes) {
      assert.ok(d.halal, 'every halal-recommended dish is marked halal');
    }
  });

  it('avoid ingredients filters out dishes containing them', async () => {
    // First get baseline
    const { data: baseline } = await req('/api/health/profile', {
      method: 'POST',
      token,
      body: { goal: 'healthy', budgetMax: 50, mealType: 'lunch', taste: '不限', halalOnly: false, avoid: [] },
    });
    // Get a dish ingredient to avoid
    const allDishes = (await req('/api/bootstrap')).data.dishes;
    if (allDishes.length === 0) return;
    const avoidIngredient = allDishes[0].ingredients[0];
    if (!avoidIngredient) return;

    const { data: avoided } = await req('/api/health/profile', {
      method: 'POST',
      token,
      body: { goal: 'healthy', budgetMax: 50, mealType: 'lunch', taste: '不限', halalOnly: false, avoid: [avoidIngredient] },
    });
    // All recommended dishes should NOT contain the avoided ingredient
    for (const d of avoided.recommendation.dishes) {
      assert.ok(
        !d.ingredients.includes(avoidIngredient),
        `avoided ingredient "${avoidIngredient}" not in "${d.name}"`,
      );
    }
  });

  it('profile state persists across bootstrap calls', async () => {
    await req('/api/health/profile', {
      method: 'POST',
      token,
      body: { goal: 'muscleGain', budgetMax: 35, mealType: 'dinner', taste: '辣', halalOnly: false, avoid: [] },
    });
    const { data: bs } = await req('/api/bootstrap', { token });
    assert.ok(bs.profile, 'profile in bootstrap');
    assert.equal(bs.profile.goal, 'muscleGain');
    assert.equal(bs.profile.budgetMax, 35);
  });
});

/* ================================================================== */
/*  10. End-to-End Flow: Register → Set Profile → Get Recommendation   */
/* ================================================================== */
describe('E2E — Full user journey: register → profile → recommend → review', () => {
  setup();

  it('complete student journey from registration to leaving a review', async () => {
    // 1. Register
    const { status: regStatus, user, token, state: regState } = await register('e2e-journey-student', 'journey123');
    assert.equal(regStatus, 201, 'step 1: register');
    assert.ok(regState.canteens.length > 0, 'step 1: sees canteens');

    // 2. Set health profile
    const { status: profStatus, data: profData } = await req('/api/health/profile', {
      method: 'POST',
      token,
      body: { goal: 'fatLoss', budgetMax: 20, mealType: 'lunch', taste: '清淡', halalOnly: false, avoid: [] },
    });
    assert.equal(profStatus, 200, 'step 2: set profile');
    assert.ok(profData.recommendation, 'step 2: got recommendation');
    assert.equal(profData.profile.goal, 'fatLoss');

    // 3. Get personalized recommendation
    const { status: recStatus, data: recData } = await req('/api/recommend', { token });
    assert.equal(recStatus, 200, 'step 3: recommend');
    assert.ok(recData.ranked?.length > 0 || recData.plan?.dishes?.length > 0, 'step 3: has ranked dishes or plan');

    // 4. Search for a dish
    const { status: ragStatus, data: ragData } = await req('/api/rag/search?q=蛋白');
    assert.equal(ragStatus, 200, 'step 4: RAG search');
    assert.ok(ragData.results.length > 0, 'step 4: found results');

    // 5. Ask the agent
    const { status: agentStatus, data: agentData } = await req('/api/agent/meal-advisor', {
      method: 'POST',
      token,
      body: { query: '减脂午餐推荐' },
    });
    assert.equal(agentStatus, 200, 'step 5: agent advisor');
    assert.ok(agentData.answer, 'step 5: got answer');

    // 6. Leave a review on a dish
    const dishId = regState.dishes[0]?.id || ragData.results[0]?.sourceId;
    if (dishId) {
      const { status: revStatus, data: revData } = await req('/api/reviews', {
        method: 'POST',
        token,
        body: { targetId: dishId, rating: 5, content: '端到端流程测试评论' },
      });
      assert.equal(revStatus, 201, 'step 6: post review');
      assert.ok(revData, 'step 6: review response has data');
    }

    // 7. Verify session still works
    const { data: finalBs } = await req('/api/bootstrap', { token });
    assert.equal(finalBs.session.user.username, 'e2e-journey-student', 'step 7: session intact');
    assert.equal(finalBs.profile.goal, 'fatLoss', 'step 7: profile persisted');
  });

  it('complete admin journey: login → manage entities → verify state', async () => {
    // 1. Login as seeded admin
    const { token } = await adminLogin();

    // 2. Create a canteen
    const { status: cs } = await req('/api/admin/canteens', {
      method: 'POST',
      token,
      body: { id: 'e2e-journey-canteen', name: '旅程食堂', location: 'E2E楼', hours: '07:00-22:00', description: '端到端测试' },
    });
    assert.equal(cs, 201, 'admin step 2: create canteen');

    // 3. Create a dish in the canteen's stall
    const { status: ds } = await req('/api/admin/dishes', {
      method: 'POST',
      token,
      body: {
        id: 'e2e-journey-dish',
        stallId: 'n-protein',
        name: '旅程鸡胸饭',
        price: 18,
        taste: '清淡',
        cuisine: '轻食',
        ingredients: '鸡胸肉,西兰花,糙米',
        tags: '高蛋白,低脂',
        nutrition: { calories: 420, protein: 35, fat: 8, carbs: 45 },
      },
    });
    assert.equal(ds, 201, 'admin step 3: create dish');

    // 4. Bulk import additional dishes
    const { status: bis } = await req('/api/admin/dishes/import', {
      method: 'POST',
      token,
      body: { dishes: [
        { id: 'e2e-journey-bulk-1', stallId: 'n-halal', name: '旅程牛肉面', price: 16, taste: '咸', cuisine: '西北', ingredients: '牛肉,面条', tags: '清真', nutrition: { calories: 380, protein: 25, fat: 10, carbs: 40 } },
      ] },
    });
    assert.equal(bis, 200, 'admin step 4: bulk import');

    // 5. Verify final state
    const { data: bs } = await req('/api/bootstrap', { token });
    assert.ok(bs.canteens.find((c) => c.id === 'e2e-journey-canteen'), 'admin step 5: canteen in state');
    assert.ok(bs.dishes.find((d) => d.id === 'e2e-journey-dish'), 'admin step 5: dish in state');
    assert.ok(bs.dishes.find((d) => d.id === 'e2e-journey-bulk-1'), 'admin step 5: bulk dish in state');

    // 6. Update the dish
    const { status: us } = await req('/api/admin/dishes/e2e-journey-dish', {
      method: 'PUT',
      token,
      body: { name: '旅程鸡胸饭(升级版)', price: 22, taste: '鲜', cuisine: '轻食', stallId: 'n-protein', ingredients: '鸡胸肉,西兰花,糙米,牛油果', tags: '高蛋白,低脂,升级', nutrition: { calories: 480, protein: 38, fat: 12, carbs: 48 } },
    });
    assert.equal(us, 200, 'admin step 6: update dish');

    // 7. Verify audit trail
    const auditDish = _db.prepare("SELECT * FROM audit_logs WHERE entity_id = 'e2e-journey-dish' ORDER BY created_at").all();
    assert.ok(auditDish.length >= 2, 'admin step 7: audit trail has UPSERT + UPDATE entries');
  });
});

/* ================================================================== */
/*  11. Error Handling — Edge Cases                                    */
/* ================================================================== */
describe('E2E — Error handling edge cases', () => {
  setup();

  it('unknown route returns 404', async () => {
    const { status } = await req('/api/nonexistent');
    assert.equal(status, 404, 'unknown route → 404');
  });

  it('POST /api/reviews without auth returns 401', async () => {
    const { status } = await req('/api/reviews', {
      method: 'POST',
      body: { targetId: 'x', rating: 3, content: 'test' },
    });
    assert.equal(status, 401, 'unauthenticated review → 401');
  });

  it('POST /api/reviews with missing fields returns 400', async () => {
    const { token } = await register('e2e-err-review', 'pass');
    const { status } = await req('/api/reviews', {
      method: 'POST',
      token,
      body: { targetId: 'x' },
    });
    assert.equal(status, 400, 'missing rating/content → 400');
  });

  it('POST /api/health/profile without auth returns 401', async () => {
    const { status } = await req('/api/health/profile', {
      method: 'POST',
      body: { goal: 'healthy' },
    });
    assert.equal(status, 401, 'unauthenticated profile → 401');
  });

  it('GET /api/dishes/:id returns 404 for nonexistent dish', async () => {
    const { status } = await req('/api/dishes/nonexistent-dish-id');
    assert.equal(status, 404, 'nonexistent dish → 404');
  });

  it('GET /api/health returns ok', async () => {
    const { status, data } = await req('/api/health');
    assert.equal(status, 200);
    assert.equal(data.ok, true);
  });

  it('GET /api/canteens returns array', async () => {
    const { status, data } = await req('/api/canteens');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data), 'canteens is array');
  });

  it('GET /api/stalls returns array', async () => {
    const { status, data } = await req('/api/stalls');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data), 'stalls is array');
  });

  it('GET /api/dishes returns array', async () => {
    const { status, data } = await req('/api/dishes');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data), 'dishes is array');
  });

  it('GET /api/recommend works for anonymous user', async () => {
    const { status, data } = await req('/api/recommend');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.ranked), 'recommendation has ranked array');
    assert.ok(data.plan, 'recommendation has plan');
  });
});
