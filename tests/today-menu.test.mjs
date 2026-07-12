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

describe('Today menu recommendation loop', () => {
  before(() => {
    db = openDatabase(':memory:');
    const app = createApp({ db });
    server = createServer(app.handler);
    server.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  it('today menu returns published items with supply status, excluding draft menus', async () => {
    const token = await login('admin', 'admin123');
    await req('/api/admin/menus', {
      method: 'POST',
      token,
      body: {
        id: 'today-published',
        canteenId: 'north',
        date: today(),
        mealType: 'lunch',
        status: 'published',
        items: [
          { dishId: 'd-chicken-bowl', price: 13, supplyLimit: 80, soldOut: false },
          { dishId: 'd-beef-noodle', price: 18, supplyLimit: 20, soldOut: true }
        ]
      }
    });
    await req('/api/admin/menus', {
      method: 'POST',
      token,
      body: {
        id: 'today-draft',
        canteenId: 'north',
        date: today(),
        mealType: 'lunch',
        status: 'draft',
        items: [{ dishId: 'd-oat', price: 9, supplyLimit: 30 }]
      }
    });

    const { status, data } = await req('/api/menus/today?mealType=lunch');
    assert.equal(status, 200);
    assert.equal(data.source, 'menu');
    const dishIds = data.dishes.map((dish) => dish.id);
    assert.ok(dishIds.includes('d-chicken-bowl'), 'published available dish present');
    assert.ok(dishIds.includes('d-beef-noodle'), 'published sold-out dish still exposed');
    assert.ok(!dishIds.includes('d-oat'), 'draft menu dish excluded');
    const chickenBowl = data.dishes.find((d) => d.id === 'd-chicken-bowl');
    assert.equal(chickenBowl.supplyStatus, 'available');
    assert.equal(chickenBowl.price, 13);
    const beefNoodle = data.dishes.find((d) => d.id === 'd-beef-noodle');
    assert.equal(beefNoodle.supplyStatus, 'sold_out');
  });

  it('recommendation prioritizes today menu and falls back when no published menu exists', async () => {
    const studentToken = await login('演示学生', 'student123');
    await req('/api/health/profile', { method: 'PUT', token: studentToken, body: { goal: 'healthy', budgetMax: 30, mealType: 'lunch', taste: '不限', halalOnly: false, avoid: [] } });

    const lunch = await req('/api/recommend', { token: studentToken });
    assert.equal(lunch.status, 200);
    assert.equal(lunch.data.source, 'menu');
    assert.ok(lunch.data.ranked.length > 0);
    assert.ok(lunch.data.ranked.some((dish) => dish.id === 'd-chicken-bowl'), 'manually added dish present in ranked');

    await req('/api/health/profile', { method: 'PUT', token: studentToken, body: { goal: 'healthy', budgetMax: 30, mealType: 'breakfast', taste: '不限', halalOnly: false, avoid: [] } });
    const breakfast = await req('/api/recommend', { token: studentToken });
    assert.equal(breakfast.status, 200);
    assert.equal(breakfast.data.source, 'fallback');
    assert.ok(breakfast.data.ranked.length > 0);
  });
});
