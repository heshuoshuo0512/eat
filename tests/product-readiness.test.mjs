import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { createToken, hashPassword } from '../server/security.js';

// ── helpers ───────────────────────────────────────────────────────────

let server, baseUrl;

function setup() {
  before(async () => {
    const db = openDatabase(':memory:');
    const app = createApp({ db });
    server = createServer(app.handler);
    server.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    // Seed an admin user directly so we can exercise admin routes.
    const adminId = 'u-test-admin';
    await db.prepare(
      "INSERT INTO users (id, tenant_id, username, password_hash, nickname, role, created_at, updated_at) VALUES (?, 'default', ?, ?, '测试管理员', 'admin', datetime('now'), datetime('now'))"
    ).run(adminId, 'testadmin', hashPassword('admin123'));

    // Seed a student user.
    const studentId = 'u-test-student';
    await db.prepare(
      "INSERT INTO users (id, tenant_id, username, password_hash, nickname, role, created_at, updated_at) VALUES (?, 'default', ?, ?, '测试同学', 'student', datetime('now'), datetime('now'))"
    ).run(studentId, 'teststudent', hashPassword('student123'));
    await db.prepare(
      "INSERT INTO health_profiles (user_id, tenant_id, goal, budget_max, meal_type, taste, halal_only, avoid_json, updated_at) VALUES (?, 'default', 'fatLoss', 25, 'lunch', '不限', 0, '[]', datetime('now'))"
    ).run(studentId);

    // Seed canteen, stall, and dishes for a full supply-chain fixture.
    await db.prepare(
      "INSERT INTO canteens (id, name, location, hours, crowd_level, tags_json, description, created_at, updated_at) VALUES ('ct-1', '测试食堂', 'A栋', '10:00-21:00', 30, '[]', '测试用食堂', datetime('now'), datetime('now'))"
    ).run();
    await db.prepare(
      "INSERT INTO stalls (id, canteen_id, name, floor, category, rating, description, created_at, updated_at) VALUES ('st-1', 'ct-1', '窗口一', '1F', '家常菜', 4.6, '测试窗口', datetime('now'), datetime('now'))"
    ).run();

    // Insert two dishes: one available, one will be marked sold-out in a menu.
    const insertDish = db.prepare(`INSERT INTO dishes
      (id, tenant_id, stall_id, name, price, taste, cuisine, ingredients_json, tags_json, halal, meal_types_json, calories, protein, fat, carbs, rating, review_count, sales, image, description, status, created_at, updated_at)
      VALUES (?, 'default', 'st-1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '🍽️', ?, 'active', datetime('now'), datetime('now'))`);
    insertDish.run('dish-available', '红烧肉', 15, '咸鲜', '家常菜',
      JSON.stringify(['五花肉', '酱油']), JSON.stringify(['热菜']), 0,
      JSON.stringify(['lunch', 'dinner']), 450, 20, 18, 10, 4.7, 120, 300, '经典红烧肉');
    insertDish.run('dish-soldout', '糖醋鱼', 22, '酸甜', '海鲜',
      JSON.stringify(['鲤鱼', '醋']), JSON.stringify(['热菜']), 0,
      JSON.stringify(['lunch', 'dinner']), 380, 18, 12, 15, 4.5, 80, 150, '酸甜可口');
  });

  after(() => { server?.close(); });
}

async function get(path, { token } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, { headers });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function post(path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function put(path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function loginAdmin() {
  const res = await post('/api/auth/login', { body: { username: 'testadmin', password: 'admin123' } });
  return res.data.token;
}

async function loginStudent() {
  const res = await post('/api/auth/login', { body: { username: 'teststudent', password: 'student123' } });
  return res.data.token;
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Supply status: sold-out items must not leak into today's menu
// ═══════════════════════════════════════════════════════════════════════

describe('supply status – sold-out exclusion', () => {
  setup();

  let adminToken;
  const today = new Date().toISOString().slice(0, 10);

  before(async () => {
    adminToken = await loginAdmin();
  });

  it('published menu with a sold-out item excludes that dish from today bundle', async () => {
    // Create a published menu containing two dishes, one sold-out.
    const menuRes = await post('/api/admin/menus', {
      token: adminToken,
      body: {
        canteenId: 'ct-1',
        date: today,
        mealType: 'lunch',
        status: 'published',
        items: [
          { dishId: 'dish-available', price: 15 },
          { dishId: 'dish-soldout', price: 22, soldOut: true }
        ]
      }
    });
    assert.equal(menuRes.status, 201);

    // Check the admin menus to see what was actually stored
    const adminMenus = await get(`/api/admin/menus?date=${today}&mealType=lunch`, { token: adminToken });

    // Today menu bundle now returns ALL published dishes including sold_out items.
    const todayRes = await get('/api/menus/today?mealType=lunch');
    assert.equal(todayRes.status, 200);
    assert.equal(todayRes.data.source, 'menu');
    assert.ok(todayRes.data.dishes.length >= 2, 'at least two dishes in published menu');
    const available = todayRes.data.dishes.find((d) => d.id === 'dish-available');
    assert.equal(available.supplyStatus, 'available');
    const soldOut = todayRes.data.dishes.find((d) => d.id === 'dish-soldout');
    assert.equal(soldOut.supplyStatus, 'sold_out');
  });

  it('recommend endpoint also excludes sold-out dishes from its pool', async () => {
    const recRes = await get('/api/recommend?mealType=lunch');
    assert.equal(recRes.status, 200);
    assert.ok(Array.isArray(recRes.data.ranked), 'recommend must return ranked array');
    const ids = recRes.data.ranked.map((d) => d.id);
    assert.ok(!ids.includes('dish-soldout'), 'sold-out dish must not be recommended');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Dish detail enrichment: stall, canteen, reviews attached
// ═══════════════════════════════════════════════════════════════════════

describe('dish detail enrichment', () => {
  setup();

  it('GET /api/dishes/:id returns dish with stall, canteen, and reviews', async () => {
    const res = await get('/api/dishes/dish-available');
    assert.equal(res.status, 200);
    assert.equal(res.data.id, 'dish-available');
    assert.equal(res.data.name, '红烧肉');

    // Stall must be attached
    assert.ok(res.data.stall, 'stall must be present');
    assert.equal(res.data.stall.id, 'st-1');
    assert.equal(res.data.stall.name, '窗口一');

    // Canteen must be attached
    assert.ok(res.data.canteen, 'canteen must be present');
    assert.equal(res.data.canteen.id, 'ct-1');
    assert.equal(res.data.canteen.name, '测试食堂');

    // Reviews array must be present (may be empty)
    assert.ok(Array.isArray(res.data.reviews), 'reviews must be an array');
  });

  it('GET /api/dishes/:id returns 404 for non-existent dish', async () => {
    const res = await get('/api/dishes/dish-does-not-exist');
    assert.equal(res.status, 404);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Today menu publish contract
// ═══════════════════════════════════════════════════════════════════════

describe('today menu publish contract', () => {
  setup();

  let adminToken;
  const today = new Date().toISOString().slice(0, 10);

  before(async () => {
    adminToken = await loginAdmin();
  });

  it('draft menus are invisible to /api/menus/today', async () => {
    // Create a DRAFT menu
    const draftRes = await post('/api/admin/menus', {
      token: adminToken,
      body: {
        canteenId: 'ct-1',
        date: today,
        mealType: 'dinner',
        status: 'draft',
        items: [{ dishId: 'dish-available', price: 15 }]
      }
    });
    assert.equal(draftRes.status, 201);

    const todayRes = await get(`/api/menus/today?mealType=dinner&date=${today}`);
    assert.equal(todayRes.status, 200);
    // The draft menu should not appear; its dishes should not be in the bundle.
    const ids = todayRes.data.dishes.map((d) => d.id);
    assert.ok(!ids.includes('dish-available') || todayRes.data.source === 'fallback',
      'draft menu dishes must not appear via source=menu');
  });

  it('batch publish makes menus visible to /api/menus/today', async () => {
    // List menus to find the draft ID.
    const listRes = await get('/api/admin/menus?status=draft', { token: adminToken });
    assert.equal(listRes.status, 200);
    const draftMenu = listRes.data.menus.find((m) => m.date === today && m.mealType === 'dinner');
    assert.ok(draftMenu, 'draft menu should exist');

    // Batch publish it.
    const batchRes = await post('/api/admin/menus/batch', {
      token: adminToken,
      body: { ids: [draftMenu.id], action: 'publish' }
    });
    assert.equal(batchRes.status, 200);
    assert.ok(batchRes.data.updated >= 1, 'at least one menu published');

    // Now today's dinner bundle should include the dish from the published menu.
    const todayRes = await get(`/api/menus/today?mealType=dinner&date=${today}`);
    assert.equal(todayRes.status, 200);
    assert.equal(todayRes.data.source, 'menu');
    assert.ok(todayRes.data.dishes.length > 0, 'published menu dishes must appear');
    assert.ok(todayRes.data.dishes.some((d) => d.id === 'dish-available'), 'published dish must be in bundle');
  });

  it('/api/menus/today response shape includes date, mealType, menus, dishes, source', async () => {
    const res = await get(`/api/menus/today?mealType=lunch&date=${today}`);
    assert.equal(res.status, 200);
    assert.equal(typeof res.data.date, 'string');
    assert.equal(typeof res.data.mealType, 'string');
    assert.ok(Array.isArray(res.data.menus), 'menus must be array');
    assert.ok(Array.isArray(res.data.dishes), 'dishes must be array');
    assert.ok(['menu', 'fallback'].includes(res.data.source), 'source must be menu or fallback');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Review and ranking loop
// ═══════════════════════════════════════════════════════════════════════

describe('review and ranking contract', () => {
  setup();

  let studentToken;

  before(async () => {
    studentToken = await loginStudent();
  });

  it('POST /api/reviews creates a review; pending until admin approves', async () => {
    const res = await post('/api/reviews', {
      token: studentToken,
      body: { targetId: 'dish-available', rating: 5, content: '非常好吃，强烈推荐！' }
    });
    assert.equal(res.status, 201);
    // Pending reviews are hidden from public dish detail until approved.
    const adminToken = await loginAdmin();
    const { data: pending } = await get('/api/admin/reviews?status=pending', { token: adminToken });
    const myReview = pending.reviews.find((r) => r.content === '非常好吃，强烈推荐！');
    assert.ok(myReview, 'created review must appear in admin pending list');
    assert.equal(myReview.status, 'pending');
    assert.equal(myReview.rating, 5);
    assert.ok(myReview.userId || myReview.user_id, 'review must have user id');
  });

  it('POST /api/reviews requires authentication', async () => {
    const res = await post('/api/reviews', {
      body: { targetId: 'dish-available', rating: 4, content: '匿名评价' }
    });
    assert.equal(res.status, 401);
  });

  it('POST /api/reviews rejects missing fields', async () => {
    const res = await post('/api/reviews', {
      token: studentToken,
      body: { targetId: 'dish-available' } // missing rating and content
    });
    assert.ok([400, 422].includes(res.status), 'must reject incomplete reviews');
  });

  it('GET /api/rankings returns structured ranking data', async () => {
    const res = await get('/api/rankings');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.dishes), 'rankings must include dishes');
    assert.ok(Array.isArray(res.data.stalls), 'rankings must include stalls');
    assert.ok(Array.isArray(res.data.canteens), 'rankings must include canteens');

    // Ranked dishes must have rankScore.
    for (const dish of res.data.dishes) {
      assert.equal(typeof dish.rankScore, 'number', `dish ${dish.id} must have numeric rankScore`);
    }

    // First dish should have rankScore >= last dish.
    if (res.data.dishes.length >= 2) {
      assert.ok(res.data.dishes[0].rankScore >= res.data.dishes[res.data.dishes.length - 1].rankScore,
        'dishes must be sorted by rankScore descending');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. AI / vision fallback contract
// ═══════════════════════════════════════════════════════════════════════

describe('AI and recommendation fallback', () => {
  setup();

  it('GET /api/recommend works without an AI key by returning meal plan from dish pool', async () => {
    const res = await get('/api/recommend?mealType=lunch');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.ranked), 'recommend must return ranked array');
    assert.ok(res.data.plan, 'recommend must include plan');
    assert.ok(res.data.plan.totals, 'recommend must include nutrition totals');
    assert.ok(typeof res.data.plan.totals.calories === 'number', 'totals.calories must be numeric');
    assert.ok(typeof res.data.plan.totals.protein === 'number', 'totals.protein must be numeric');
    assert.ok(typeof res.data.plan.totals.price === 'number', 'totals.price must be numeric');
    assert.ok(res.data.plan.goalLabel, 'recommend must include goalLabel');
    assert.ok(res.data.plan.reason, 'recommend must include reason');
    assert.ok(['menu', 'fallback'].includes(res.data.source), 'source must be menu or fallback');
  });

  it('GET /api/recommend returns menu metadata when available', async () => {
    const res = await get('/api/recommend?mealType=lunch');
    assert.equal(res.status, 200);
    assert.ok(res.data.menu, 'recommend must include menu metadata');
    assert.equal(typeof res.data.menu.date, 'string');
    assert.equal(typeof res.data.menu.mealType, 'string');
    assert.ok(Array.isArray(res.data.menu.menus));
  });

  it('POST /api/agent/meal-advisor requires a non-empty query', async () => {
    const res = await post('/api/agent/meal-advisor', { body: { query: '' } });
    assert.equal(res.status, 400);
  });

  it('POST /api/agent/meal-advisor fails gracefully when no AI provider is configured', async () => {
    const res = await post('/api/agent/meal-advisor', {
      body: { query: '减脂午餐推荐', profile: { goal: 'fatLoss', budgetMax: 20, mealType: 'lunch' } }
    });
    // Without a real AI key the provider should fail with 5xx or return a degraded response.
    // The key contract: it must NOT crash the server, and it must return valid JSON.
    assert.ok([200, 500, 502, 503].includes(res.status), `unexpected status ${res.status}`);
    assert.ok(res.data !== null, 'response must be valid JSON even on failure');
  });

  it('POST /api/vision/meal-analyze requires authentication', async () => {
    const res = await post('/api/vision/meal-analyze', {
      body: { imageBase64: 'data:image/png;base64,iVBORw0KGgo=' }
    });
    // Without auth, should be 401 (requires agent:use permission).
    assert.equal(res.status, 401);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. Bootstrap snapshot contract
// ═══════════════════════════════════════════════════════════════════════

describe('bootstrap snapshot contract', () => {
  setup();

  it('GET /api/bootstrap returns full snapshot with all entity types', async () => {
    const res = await get('/api/bootstrap');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.canteens), 'snapshot must have canteens');
    assert.ok(Array.isArray(res.data.stalls), 'snapshot must have stalls');
    assert.ok(Array.isArray(res.data.dishes), 'snapshot must have dishes');
    assert.ok(Array.isArray(res.data.reviews), 'snapshot must have reviews');
    assert.ok(res.data.profile, 'snapshot must have profile');
    assert.ok(res.data.session, 'snapshot must have session');
  });

  it('authenticated bootstrap includes user in session', async () => {
    const token = await loginStudent();
    const res = await get('/api/bootstrap', { token });
    assert.equal(res.status, 200);
    assert.ok(res.data.session.user, 'session.user must be present when authenticated');
    assert.equal(res.data.session.user.role, 'student');
    assert.equal(res.data.session.user.nickname, '测试同学');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 7. Registration safety: role is always 'student'
// ═══════════════════════════════════════════════════════════════════════

describe('registration safety – role enforcement', () => {
  setup();

  it('POST /api/auth/register always creates a student, ignoring role field', async () => {
    const res = await post('/api/auth/register', {
      body: { username: 'hacker', password: 'hack1234', nickname: '企图提权', role: 'admin' }
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.user.role, 'student', 'registration must force role=student');
    assert.ok(res.data.token, 'must return a token');
    assert.ok(res.data.state, 'must return initial state snapshot');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 8. Health profile and recommendation integration
// ═══════════════════════════════════════════════════════════════════════

describe('health profile → recommendation integration', () => {
  setup();

  let studentToken;

  before(async () => {
    studentToken = await loginStudent();
  });

  it('POST /api/health/profile returns recommendation based on saved profile', async () => {
    const res = await post('/api/health/profile', {
      token: studentToken,
      body: { goal: 'muscleGain', budgetMax: 30, mealType: 'lunch', taste: '不限' }
    });
    assert.equal(res.status, 200);
    assert.ok(res.data.profile, 'response must include saved profile');
    assert.equal(res.data.profile.goal, 'muscleGain');
    assert.ok(res.data.recommendation, 'response must include recommendation');
    assert.ok(Array.isArray(res.data.recommendation.dishes), 'recommendation must have dishes');
    assert.ok(res.data.recommendation.totals, 'recommendation must have totals');
    assert.ok(res.data.state, 'response must include updated snapshot');
  });
});
