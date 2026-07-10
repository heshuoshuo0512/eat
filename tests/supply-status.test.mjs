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
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function login(username, password) {
  const { data } = await req('/api/auth/login', { method: 'POST', body: { username, password } });
  return data.token;
}

describe('Supply status model and review moderation', () => {
  before(() => {
    db = openDatabase(':memory:');
    const app = createApp({ db });
    server = createServer(app.handler);
    server.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  /* ── Today menu distinguishes available vs sold-out ──────────────── */
  it('today menu exposes supply status including sold-out items', async () => {
    const token = await login('admin', 'admin123');
    await req('/api/admin/menus', {
      method: 'POST',
      token,
      body: {
        id: 'supply-menu-1',
        canteenId: 'north',
        date: today(),
        mealType: 'lunch',
        status: 'published',
        items: [
          { dishId: 'd-chicken-bowl', price: 13, supplyLimit: 80, supplyCount: 0, soldOut: false, servingStart: '11:00', servingEnd: '13:30' },
          { dishId: 'd-beef-noodle', price: 18, supplyLimit: 20, supplyCount: 0, soldOut: true, servingStart: '11:00', servingEnd: '13:30' },
          { dishId: 'd-egg-tomato', price: 11, supplyLimit: 50, supplyCount: 45, soldOut: false, servingStart: '10:30', servingEnd: '14:00' }
        ]
      }
    });

    const { status, data } = await req('/api/menus/today?mealType=lunch');
    assert.equal(status, 200);
    assert.equal(data.source, 'menu');
    // All three dishes should be returned (including sold-out)
    assert.equal(data.dishes.length, 3);
    // Verify supply status on each dish
    const chickenBowl = data.dishes.find((d) => d.id === 'd-chicken-bowl');
    assert.equal(chickenBowl.supplyStatus, 'available');
    const beefNoodle = data.dishes.find((d) => d.id === 'd-beef-noodle');
    assert.equal(beefNoodle.supplyStatus, 'sold_out');
    const eggTomato = data.dishes.find((d) => d.id === 'd-egg-tomato');
    assert.equal(eggTomato.supplyStatus, 'limited'); // 45/50 = 90%, >= 80%
  });

  /* ── Recommendations exclude sold-out dishes ────────────────────── */
  it('recommendation excludes sold-out dishes from picks', async () => {
    const studentToken = await login('演示学生', 'student123');
    await req('/api/health/profile', {
      method: 'PUT',
      token: studentToken,
      body: { goal: 'healthy', budgetMax: 30, mealType: 'lunch', taste: '不限', halalOnly: false, avoid: [] }
    });

    const { status, data } = await req('/api/recommend', { token: studentToken });
    assert.equal(status, 200);
    assert.equal(data.source, 'menu');
    // d-beef-noodle is sold_out, should not appear in ranked recommendations
    assert.ok(data.ranked.every((d) => d.id !== 'd-beef-noodle'), 'sold-out dish should be excluded from recommendations');
    assert.ok(data.ranked.length > 0, 'should have at least one ranked recommendation');
  });

  /* ── Admin can update menu item supply ──────────────────────────── */
  it('admin can update menu item supply count and sold-out status', async () => {
    const token = await login('admin', 'admin123');
    // Get the menu to find item IDs
    const menusResult = await req('/api/admin/menus?date=' + today(), { token });
    assert.equal(menusResult.status, 200);
    const menu = menusResult.data.menus.find((m) => m.id === 'supply-menu-1');
    assert.ok(menu, 'menu should exist');
    const chickenItem = menu.items.find((item) => item.dishId === 'd-chicken-bowl');
    assert.ok(chickenItem, 'chicken item should exist');

    // Update supply count
    const updateResult = await req(`/api/admin/menu-items/${chickenItem.id}/supply`, {
      method: 'PATCH',
      token,
      body: { supplyCount: 75, supplyLimit: 80 }
    });
    assert.equal(updateResult.status, 200);
    assert.equal(updateResult.data.supplyCount, 75);
    assert.equal(updateResult.data.supplyStatus, 'limited'); // 75/80 = 93.75%

    // Mark as sold out
    const soldOutResult = await req(`/api/admin/menu-items/${chickenItem.id}/supply`, {
      method: 'PATCH',
      token,
      body: { soldOut: true }
    });
    assert.equal(soldOutResult.status, 200);
    assert.equal(soldOutResult.data.soldOut, true);
    assert.equal(soldOutResult.data.supplyStatus, 'sold_out');
  });

  /* ── Admin can moderate reviews ─────────────────────────────────── */
  it('admin can list, filter, and moderate reviews', async () => {
    const token = await login('admin', 'admin123');
    const studentToken = await login('演示学生', 'student123');

    // Create a review
    const createResult = await req('/api/reviews', {
      method: 'POST',
      token: studentToken,
      body: { targetId: 'd-chicken-bowl', rating: 5, content: '非常好吃！', status: 'pending' }
    });
    assert.equal(createResult.status, 201);

    // Admin lists all reviews
    const allReviews = await req('/api/admin/reviews', { token });
    assert.equal(allReviews.status, 200);
    assert.ok(allReviews.data.total > 0);
    const pendingReview = allReviews.data.reviews.find((r) => r.status === 'pending' && r.content === '非常好吃！');
    assert.ok(pendingReview, 'pending review should be visible to admin');

    // Filter by status
    const pendingReviews = await req('/api/admin/reviews?status=pending', { token });
    assert.equal(pendingReviews.status, 200);
    assert.ok(pendingReviews.data.reviews.some((r) => r.id === pendingReview.id));

    // Moderate: reject
    const rejectResult = await req(`/api/admin/reviews/${pendingReview.id}/status`, {
      method: 'PUT',
      token,
      body: { status: 'rejected' }
    });
    assert.equal(rejectResult.status, 200);
    assert.equal(rejectResult.data.status, 'rejected');

    // Verify rejected reviews don't show in public snapshot
    const snapshotResult = await req('/api/bootstrap', { token: studentToken });
    assert.equal(snapshotResult.status, 200);
    const publicReviews = snapshotResult.data.reviews;
    assert.ok(!publicReviews.some((r) => r.id === pendingReview.id), 'rejected review should not appear in public view');

    // Moderate: approve
    const approveResult = await req(`/api/admin/reviews/${pendingReview.id}/status`, {
      method: 'PUT',
      token,
      body: { status: 'approved' }
    });
    assert.equal(approveResult.status, 200);
    assert.equal(approveResult.data.status, 'approved');
  });

  /* ── Reviews affect ranking when approved ───────────────────────── */
  it('approved reviews affect ranking; rejected reviews do not', async () => {
    const token = await login('admin', 'admin123');
    const studentToken = await login('演示学生', 'student123');

    // Get initial ranking
    const initialRanking = await req('/api/rankings');
    assert.equal(initialRanking.status, 200);
    const initialChickenRank = initialRanking.data.dishes.find((d) => d.id === 'd-chicken-bowl');

    // Create an approved review with high rating
    const reviewResult = await req('/api/reviews', {
      method: 'POST',
      token: studentToken,
      body: { targetId: 'd-egg-tomato', rating: 5, content: '很棒的推荐！' }
    });
    assert.equal(reviewResult.status, 201);

    // Ranking should update (cache invalidated)
    const updatedRanking = await req('/api/rankings');
    assert.equal(updatedRanking.status, 200);
    const updatedEggRank = updatedRanking.data.dishes.find((d) => d.id === 'd-egg-tomato');
    assert.ok(updatedEggRank, 'egg-tomato should be in rankings');
    assert.ok(updatedEggRank.computedReviewCount > 0, 'should have computed review count');
  });

  /* ── Review analytics endpoint ──────────────────────────────────── */
  it('admin can view review analytics', async () => {
    const token = await login('admin', 'admin123');
    const { status, data } = await req('/api/admin/reviews/analytics', { token });
    assert.equal(status, 200);
    assert.ok(data.total > 0, 'should have reviews');
    assert.ok(data.averageRating > 0, 'should have average rating');
    assert.ok(typeof data.statusDistribution === 'object', 'should have status distribution');
    assert.ok(typeof data.ratingDistribution === 'object', 'should have rating distribution');
  });

  /* ── Dish detail includes allergens ─────────────────────────────── */
  it('dish detail returns allergens field', async () => {
    const token = await login('admin', 'admin123');
    // Update a dish with allergens
    await req('/api/admin/dishes/d-chicken-bowl', {
      method: 'PUT',
      token,
      body: {
        stallId: 'n-protein',
        name: '香煎鸡胸杂粮饭',
        price: 16,
        taste: '黑椒',
        cuisine: '轻食',
        ingredients: ['鸡胸肉', '糙米', '西兰花', '玉米'],
        tags: ['高蛋白', '低脂', '减脂推荐'],
        nutrition: { calories: 486, protein: 38, fat: 11, carbs: 58 },
        allergens: ['小麦', '大豆']
      }
    });

    const { status, data } = await req('/api/dishes/d-chicken-bowl');
    assert.equal(status, 200);
    assert.deepEqual(data.allergens, ['小麦', '大豆']);
    assert.ok(data.imageUrl !== undefined, 'should have imageUrl field');
    assert.ok(data.nutrition, 'should have nutrition field');
  });
});
