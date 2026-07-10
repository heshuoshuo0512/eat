import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';

/* ------------------------------------------------------------------ */
/*  Helpers (same pattern as api.test.mjs)                             */
/* ------------------------------------------------------------------ */

let server;
let baseUrl;

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
/*  Canteen review contract                                            */
/* ================================================================== */
describe('Canteen reviews (targetType=canteen)', () => {
  setup();

  let studentToken;
  let canteenId;
  let adminToken;

  before(async () => {
    // Register a fresh student (avoids collision with seeded user)
    await req('/api/auth/register', {
      method: 'POST',
      body: { username: '食堂评价学生', password: 'pass123' },
    });
    const login = await req('/api/auth/login', {
      method: 'POST',
      body: { username: '食堂评价学生', password: 'pass123' },
    });
    studentToken = login.data.token;

    // Pick a seeded canteen
    const boot = await req('/api/bootstrap');
    canteenId = boot.data.canteens[0].id;

    // Authenticate as admin for moderation workflow
    const adminLogin = await req('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin123' },
    });
    adminToken = adminLogin.data.token;
  });

  it('posting a canteen review without auth returns 401', async () => {
    const { status, data } = await req('/api/reviews', {
      method: 'POST',
      body: { targetType: 'canteen', targetId: canteenId, rating: 5, content: '环境不错' },
    });
    assert.equal(status, 401);
    assert.ok(data.error, 'error message present');
  });

  it('posting a canteen review returns 201; pending hidden until admin approves', async () => {
    const { status, data } = await req('/api/reviews', {
      method: 'POST',
      token: studentToken,
      body: { targetType: 'canteen', targetId: canteenId, rating: 4, content: '环境很好菜品丰富' },
    });
    assert.equal(status, 201, 'successful canteen review returns 201');
    assert.ok(data.review, 'response contains review object');
    assert.equal(data.review.targetType, 'canteen', 'targetType is canteen');
    assert.equal(data.review.rating, 4, 'rating matches');
    assert.equal(data.review.targetId, canteenId, 'targetId matches');
    assert.ok(data.review.id, 'review has an id');
    assert.ok(data.review.user, 'review has user nickname');

    // Pending review must NOT appear in public bootstrap
    const bootBefore = await req('/api/bootstrap');
    const mineBefore = bootBefore.data.reviews.find((r) => r.content === '环境很好菜品丰富');
    assert.equal(mineBefore, undefined, 'pending canteen review not in bootstrap');

    // Admin locates it in pending list
    const pending = await req('/api/admin/reviews?status=pending', { token: adminToken });
    assert.equal(pending.status, 200);
    const pendingReview = pending.data.reviews.find((r) => r.content === '环境很好菜品丰富');
    assert.ok(pendingReview, 'canteen review appears in admin pending list');
    assert.equal(pendingReview.status, 'pending');
    assert.equal(pendingReview.rating, 4);

    // Admin approves
    const approveRes = await req(`/api/admin/reviews/${pendingReview.id}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'approved' },
    });
    assert.equal(approveRes.status, 200);

    // After approval, appears in bootstrap
    const bootAfter = await req('/api/bootstrap');
    const mineAfter = bootAfter.data.reviews.find((r) => r.content === '环境很好菜品丰富');
    assert.ok(mineAfter, 'approved canteen review appears in bootstrap');
    assert.equal(mineAfter.rating, 4);
  });

  it('posting a review for nonexistent canteen returns 404', async () => {
    const { status, data } = await req('/api/reviews', {
      method: 'POST',
      token: studentToken,
      body: { targetType: 'canteen', targetId: 'nonexistent-canteen-id', rating: 3, content: '这个食堂不存在' },
    });
    assert.equal(status, 404, 'nonexistent canteen returns 404');
    assert.ok(data.error, 'error message present');
  });

  it('posting a canteen review with out-of-range rating returns 400', async () => {
    const { status, data } = await req('/api/reviews', {
      method: 'POST',
      token: studentToken,
      body: { targetType: 'canteen', targetId: canteenId, rating: 6, content: '评分超出范围试试' },
    });
    assert.equal(status, 400, 'rating > 5 returns 400');
    assert.ok(data.error, 'error message present');
  });

  it('posting a canteen review with rating 0 returns 400', async () => {
    const { status, data } = await req('/api/reviews', {
      method: 'POST',
      token: studentToken,
      body: { targetType: 'canteen', targetId: canteenId, rating: 0, content: '零分评价测试' },
    });
    assert.equal(status, 400, 'rating < 1 returns 400');
    assert.ok(data.error, 'error message present');
  });
});

/* ================================================================== */
/*  Dish review enriched response                                      */
/* ================================================================== */
describe('Dish review response is enriched', () => {
  setup();

  let studentToken;
  let dishId;
  let adminToken;

  before(async () => {
    await req('/api/auth/register', {
      method: 'POST',
      body: { username: '菜品评价学生', password: 'pass123' },
    });
    const login = await req('/api/auth/login', {
      method: 'POST',
      body: { username: '菜品评价学生', password: 'pass123' },
    });
    studentToken = login.data.token;

    const boot = await req('/api/bootstrap');
    dishId = boot.data.dishes[0].id;

    // Authenticate as admin for moderation workflow
    const adminLogin = await req('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin123' },
    });
    adminToken = adminLogin.data.token;
  });

  it('dish review goes through moderation before appearing in detail', async () => {
    const { status, data } = await req('/api/reviews', {
      method: 'POST',
      token: studentToken,
      body: { targetId: dishId, rating: 5, content: '这个菜品非常好吃' },
    });
    assert.equal(status, 201);
    assert.ok(Array.isArray(data.reviews), 'response has reviews array');
    // Pending review must NOT appear in public dish detail
    const mine = data.reviews.find((r) => r.content === '这个菜品非常好吃');
    assert.equal(mine, undefined, 'pending review not visible in dish detail');

    // Admin locates and approves
    const pending = await req('/api/admin/reviews?status=pending', { token: adminToken });
    const pendingReview = pending.data.reviews.find((r) => r.content === '这个菜品非常好吃');
    assert.ok(pendingReview, 'review in admin pending list');
    assert.equal(pendingReview.status, 'pending');
    assert.equal(pendingReview.rating, 5);

    const approveRes = await req(`/api/admin/reviews/${pendingReview.id}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'approved' },
    });
    assert.equal(approveRes.status, 200);

    // After approval, review appears in dish detail
    const dishRes = await req(`/api/dishes/${dishId}`);
    assert.equal(dishRes.status, 200);
    const approved = dishRes.data.reviews.find((r) => r.content === '这个菜品非常好吃');
    assert.ok(approved, 'approved review appears in dish detail');
    assert.equal(approved.rating, 5);
  });

  it('enriched dish review includes dish metadata and requires moderation', async () => {
    const { status, data } = await req('/api/reviews', {
      method: 'POST',
      token: studentToken,
      body: { targetId: dishId, rating: 3, content: '还行吧不算特别好' },
    });
    assert.equal(status, 201);
    // Dish metadata always present in response regardless of review status
    assert.ok(data.name, 'response includes dish name');
    assert.ok(data.price != null, 'response includes dish price');
    assert.ok(data.stall || data.canteen !== undefined, 'response includes stall/canteen linkage');

    // Pending review must NOT appear in public dish detail
    const beforeApproval = data.reviews.find((r) => r.content === '还行吧不算特别好');
    assert.equal(beforeApproval, undefined, 'pending review not visible in dish detail');

    // Admin approves the review
    const pending = await req('/api/admin/reviews?status=pending', { token: adminToken });
    const pendingReview = pending.data.reviews.find((r) => r.content === '还行吧不算特别好');
    assert.ok(pendingReview, 'review in admin pending list');

    const approveRes = await req(`/api/admin/reviews/${pendingReview.id}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'approved' },
    });
    assert.equal(approveRes.status, 200);

    // After approval, verify public visibility
    const dishRes = await req(`/api/dishes/${dishId}`);
    assert.equal(dishRes.status, 200);
    const approved = dishRes.data.reviews.find((r) => r.content === '还行吧不算特别好');
    assert.ok(approved, 'approved review appears in public dish detail');
    assert.equal(approved.rating, 3);
  });
});
