import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { completePublicProfile } from './community-test-helpers.mjs';

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
    await completePublicProfile(req, studentToken, 'Canteen Review Student');

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

  it('posting a valid canteen review is automatically approved and published', async () => {
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

    assert.equal(data.review.status, 'approved');
    assert.equal(data.moderation.status, 'approved');
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
    await completePublicProfile(req, studentToken, 'Dish Review Student');

    const boot = await req('/api/bootstrap');
    dishId = boot.data.dishes[0].id;

    // Authenticate as admin for moderation workflow
    const adminLogin = await req('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin123' },
    });
    adminToken = adminLogin.data.token;
  });

  it('valid dish review is automatically approved and appears in detail', async () => {
    const { status, data } = await req('/api/reviews', {
      method: 'POST',
      token: studentToken,
      body: { targetId: dishId, rating: 5, content: '这个菜品非常好吃' },
    });
    assert.equal(status, 201);
    assert.equal(data.review.status, 'approved');
    const dishRes = await req(`/api/dishes/${dishId}`);
    assert.equal(dishRes.status, 200);
    const approved = dishRes.data.reviews.find((r) => r.content === '这个菜品非常好吃');
    assert.ok(approved, 'approved review appears in dish detail');
    assert.equal(approved.rating, 5);
  });

  it('enriched dish review includes catalog metadata after automatic moderation', async () => {
    const { status, data } = await req('/api/reviews', {
      method: 'POST',
      token: studentToken,
      body: { targetId: dishId, rating: 3, content: '还行吧不算特别好' },
    });
    assert.equal(status, 201);
    assert.ok(data.review.dish, 'response includes dish metadata');
    assert.ok(data.review.stall || data.review.canteen, 'response includes location metadata');
    assert.equal(data.review.status, 'approved');

    const dishRes = await req(`/api/dishes/${dishId}`);
    assert.equal(dishRes.status, 200);
    const approved = dishRes.data.reviews.find((r) => r.content === '还行吧不算特别好');
    assert.ok(approved, 'approved review appears in public dish detail');
    assert.equal(approved.rating, 3);
  });
});
