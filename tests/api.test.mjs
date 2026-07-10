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

/** Spin up a real HTTP server backed by an in-memory DB. */
function setup() {
  before(() => {
    const db = openDatabase(':memory:');
    const app = createApp({ db });
    server = createServer(app.handler);
    server.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());
}

/** Convenience fetch wrapper: returns { status, data } parsed JSON. */
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

/* ================================================================== */
/*  1. Bootstrap returns seed data                                     */
/* ================================================================== */
describe('Bootstrap', () => {
  setup();

  it('returns seeded canteens, dishes, stalls, and reviews', async () => {
    const { status, data } = await req('/api/bootstrap');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.canteens), 'canteens is array');
    assert.ok(data.canteens.length >= 2, 'at least 2 seeded canteens');
    assert.ok(Array.isArray(data.dishes), 'dishes is array');
    assert.ok(data.dishes.length >= 4, 'at least 4 seeded dishes');
    assert.ok(Array.isArray(data.stalls), 'stalls is array');
    assert.ok(data.stalls.length >= 3, 'at least 3 seeded stalls');
    assert.ok(Array.isArray(data.reviews), 'reviews is array');
    assert.ok(data.reviews.length >= 1, 'at least 1 seeded review');
    // Every canteen has expected shape
    for (const c of data.canteens) {
      assert.ok(c.id && c.name && c.location && c.hours, `canteen ${c.id} has core fields`);
      assert.ok(Array.isArray(c.tags), `canteen ${c.id} tags is array`);
    }
  });

  it('health endpoint returns ok', async () => {
    const { status, data } = await req('/api/health');
    assert.equal(status, 200);
    assert.deepEqual(data, { ok: true });
  });
});

/* ================================================================== */
/*  2. Student login + role enforcement                                */
/* ================================================================== */
describe('Student auth and role enforcement', () => {
  setup();

  let studentToken;

  it('login with seeded student returns a token', async () => {
    const { status, data } = await req('/api/auth/login', {
      method: 'POST',
      body: { username: '演示学生', password: 'student123' },
    });
    assert.equal(status, 200);
    assert.ok(data.token, 'token returned');
    assert.equal(data.user.role, 'student');
    assert.equal(data.user.username, '演示学生');
    studentToken = data.token;
  });

  it('student cannot access admin endpoint (403)', async () => {
    const { status, data } = await req('/api/admin/canteens', {
      method: 'POST',
      token: studentToken,
      body: { name: 'hack', location: 'x', hours: 'y', description: 'z' },
    });
    assert.equal(status, 403);
    assert.ok(data.error, 'error message present');
  });

  it('login with wrong password returns 401', async () => {
    const { status } = await req('/api/auth/login', {
      method: 'POST',
      body: { username: '演示学生', password: 'wrong-password' },
    });
    assert.equal(status, 401);
  });

  it('login with unknown username is rejected', async () => {
    const { status, data } = await req('/api/auth/login', {
      method: 'POST',
      body: { username: '新人同学', password: 'student123' },
    });
    assert.equal(status, 401);
    assert.ok(data.error);
  });
});

/* ================================================================== */
/*  3. Admin login and entity creation                                 */
/* ================================================================== */
describe('Admin login and CRUD', () => {
  setup();

  let adminToken;

  it('login with seeded admin returns token with admin role', async () => {
    const { status, data } = await req('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin123' },
    });
    assert.equal(status, 200);
    assert.equal(data.user.role, 'admin');
    assert.ok(data.token);
    adminToken = data.token;
  });

  it('admin can create a canteen (persists in bootstrap)', async () => {
    const canteen = {
      id: 'test-canteen',
      name: '测试食堂',
      location: '测试楼',
      hours: '08:00-20:00',
      description: '专门用于测试的食堂',
      tags: ['测试', '临时'],
      crowdLevel: 10,
    };
    const { status, data } = await req('/api/admin/canteens', {
      method: 'POST',
      token: adminToken,
      body: canteen,
    });
    assert.equal(status, 201);
    // Response is a full snapshot; verify persistence
    const created = data.canteens.find((c) => c.id === 'test-canteen');
    assert.ok(created, 'new canteen appears in snapshot');
    assert.equal(created.name, '测试食堂');
    assert.equal(created.location, '测试楼');
    assert.deepEqual(created.tags, ['测试', '临时']);
  });

  it('admin can create a dish (persists in bootstrap)', async () => {
    const dish = {
      id: 'test-dish',
      stallId: 'n-protein',
      name: '测试鸡胸',
      price: 12,
      taste: '咸香',
      cuisine: '测试菜系',
      ingredients: '鸡胸肉,盐',
      tags: '测试,低脂',
      nutrition: { calories: 200, protein: 30, fat: 5, carbs: 10 },
    };
    const { status, data } = await req('/api/admin/dishes', {
      method: 'POST',
      token: adminToken,
      body: dish,
    });
    assert.equal(status, 201);
    // Verify the dish is now in the dishes snapshot
    const created = data.dishes.find((d) => d.id === 'test-dish');
    assert.ok(created, 'new dish appears in snapshot');
    assert.equal(created.name, '测试鸡胸');
    assert.equal(created.price, 12);
    assert.deepEqual(created.nutrition, { calories: 200, protein: 30, fat: 5, carbs: 10 });
    assert.deepEqual(created.ingredients, ['鸡胸肉', '盐']);
  });
});

/* ================================================================== */
/*  4. Reviews: auth required, persists                                */
/* ================================================================== */
describe('Reviews', () => {
  setup();

  let studentToken;
  let adminToken;
  let targetDishId;

  before(async () => {
    await req('/api/auth/register', {
      method: 'POST',
      body: { username: '评论学生', password: 'pass123' },
    });
    const login = await req('/api/auth/login', {
      method: 'POST',
      body: { username: '评论学生', password: 'pass123' },
    });
    studentToken = login.data.token;

    // Pick a seeded dish to review
    const boot = await req('/api/bootstrap');
    targetDishId = boot.data.dishes[0].id;

    // Authenticate as admin for moderation workflow
    const adminLogin = await req('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin123' },
    });
    adminToken = adminLogin.data.token;
  });

  it('posting a review without auth returns 401', async () => {
    const { status, data } = await req('/api/reviews', {
      method: 'POST',
      body: { targetId: targetDishId, rating: 5, content: '好' },
    });
    assert.equal(status, 401);
    assert.ok(data.error);
  });

  it('posting a review returns 201; pending review hidden until admin approves', async () => {
    // Submit student review
    const { status, data } = await req('/api/reviews', {
      method: 'POST',
      token: studentToken,
      body: { targetId: targetDishId, rating: 4, content: '不错不错' },
    });
    assert.equal(status, 201);
    // Response is the dish detail; pending review must NOT appear publicly
    assert.ok(data.reviews, 'dish detail includes reviews array');
    const mine = data.reviews.find((r) => r.content === '不错不错');
    assert.equal(mine, undefined, 'pending review not visible in public dish detail');

    // Admin locates the review in the pending list
    const pending = await req('/api/admin/reviews?status=pending', { token: adminToken });
    assert.equal(pending.status, 200);
    const pendingReview = pending.data.reviews.find((r) => r.content === '不错不错');
    assert.ok(pendingReview, 'review appears in admin pending list');
    assert.equal(pendingReview.status, 'pending');
    assert.equal(pendingReview.rating, 4);

    // Admin approves
    const approveRes = await req(`/api/admin/reviews/${pendingReview.id}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'approved' },
    });
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.data.status, 'approved');

    // After approval, review appears in public dish detail
    const dishRes = await req(`/api/dishes/${targetDishId}`);
    assert.equal(dishRes.status, 200);
    const approved = dishRes.data.reviews.find((r) => r.content === '不错不错');
    assert.ok(approved, 'approved review visible in public dish detail');
    assert.equal(approved.rating, 4);
  });

  it('approved review appears in bootstrap snapshot', async () => {
    const { data } = await req('/api/bootstrap');
    const mine = data.reviews.find((r) => r.content === '不错不错');
    assert.ok(mine, 'approved review persisted in bootstrap global feed');
    assert.equal(mine.rating, 4);
  });

  it('body.status=approved on student POST cannot skip pending', async () => {
    const { status } = await req('/api/reviews', {
      method: 'POST',
      token: studentToken,
      body: { targetId: targetDishId, rating: 2, content: '试图跳过审核', status: 'approved' },
    });
    assert.equal(status, 201);

    // Verify it still landed as pending, not approved
    const pending = await req('/api/admin/reviews?status=pending', { token: adminToken });
    const bypass = pending.data.reviews.find((r) => r.content === '试图跳过审核');
    assert.ok(bypass, 'review with body.status=approved still lands in pending');
    assert.equal(bypass.status, 'pending');
  });
});

/* ================================================================== */
/*  5. Health profile update changes recommendations                   */
/* ================================================================== */
describe('Health profile and recommendations', () => {
  setup();

  let studentToken;

  before(async () => {
    await req('/api/auth/register', {
      method: 'POST',
      body: { username: '健康学生', password: 'pass123' },
    });
    const login = await req('/api/auth/login', {
      method: 'POST',
      body: { username: '健康学生', password: 'pass123' },
    });
    studentToken = login.data.token;
  });

  it('default profile is healthy/lunch', async () => {
    const { data } = await req('/api/bootstrap', { token: studentToken });
    assert.equal(data.profile.goal, 'healthy');
    assert.equal(data.profile.mealType, 'lunch');
  });

  it('update health profile returns new profile + recommendation', async () => {
    const { status, data } = await req('/api/health/profile', {
      method: 'POST',
      token: studentToken,
      body: { goal: 'fatLoss', budgetMax: 15, mealType: 'lunch', halalOnly: true },
    });
    assert.equal(status, 200);
    assert.equal(data.profile.goal, 'fatLoss');
    assert.equal(data.profile.budgetMax, 15);
    assert.equal(data.profile.halalOnly, true);
    assert.ok(data.recommendation && Array.isArray(data.recommendation.dishes), 'recommendation contains dishes array');
  });

  it('updated profile persists across requests', async () => {
    const { data } = await req('/api/bootstrap', { token: studentToken });
    assert.equal(data.profile.goal, 'fatLoss');
    assert.equal(data.profile.halalOnly, true);
  });

  it('health profile update without auth returns 401', async () => {
    const { status } = await req('/api/health/profile', {
      method: 'POST',
      body: { goal: 'muscleGain' },
    });
    assert.equal(status, 401);
  });
});

/* ================================================================== */
/*  6. Error cases: oversized, missing fields, unknown routes          */
/* ================================================================== */
describe('Error handling', () => {
  setup();

  it('unknown route returns 404 JSON error', async () => {
    const { status, data } = await req('/api/nonexistent');
    assert.equal(status, 404);
    assert.ok(data.error, 'error field present');
  });

  it('missing required fields returns 400', async () => {
    const { status, data } = await req('/api/auth/register', {
      method: 'POST',
      body: { username: '只给用户名' },
    });
    assert.equal(status, 400);
    assert.ok(data.error.includes('缺少字段'), 'error mentions missing field');
  });

  it('invalid JSON body returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json at all',
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error, 'JSON parse error returns error field');
  });

  it('oversized body is rejected', async () => {
    const bigBody = JSON.stringify({ data: 'x'.repeat(200 * 1024) });
    try {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bigBody,
      });
      // If server responded before destroying the socket
      assert.equal(res.status, 413);
      const data = await res.json();
      assert.ok(data.error, 'oversized body returns error field');
    } catch (err) {
      // Server calls req.destroy() → ECONNRESET; this is valid rejection behavior
      assert.match(err.message || '', /ECONNRESET|fetch failed/i, 'oversized body causes connection reset (server rejected)');
    }
  });

  it('admin endpoint without token returns 401', async () => {
    const { status } = await req('/api/admin/dishes', {
      method: 'POST',
      body: { name: 'x' },
    });
    assert.equal(status, 401);
  });

  it('admin endpoint with invalid token returns 401', async () => {
    const { status } = await req('/api/admin/canteens', {
      method: 'POST',
      token: 'garbage.token.value',
      body: { name: 'x', location: 'x', hours: 'x', description: 'x' },
    });
    assert.equal(status, 401);
  });

  it('register with duplicate username returns 409', async () => {
    await req('/api/auth/register', {
      method: 'POST',
      body: { username: '唯一用户', password: 'pass123' },
    });
    const { status, data } = await req('/api/auth/register', {
      method: 'POST',
      body: { username: '唯一用户', password: 'pass456' },
    });
    assert.equal(status, 409);
    assert.ok(data.error.includes('已存在'), 'error mentions duplicate');
  });

  it('GET /api/dishes with nonexistent keyword returns empty result', async () => {
    const { status, data } = await req('/api/dishes?keyword=绝对不存在的菜品名称xyz');
    assert.equal(status, 200);
    assert.deepEqual(data, []);
  });
});
