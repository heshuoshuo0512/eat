import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { businessDate } from '../server/time.js';

let db;
let server;
let baseUrl;
let adminToken;
let studentToken;

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function login(username, password) {
  return (await req('/api/auth/login', { method: 'POST', body: { username, password } })).data.token;
}

describe('retired today-menu compatibility', () => {
  before(async () => {
    db = openDatabase(':memory:');
    server = createServer(createApp({ db }).handler);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    adminToken = await login('admin', 'admin123');
    studentToken = await login('演示学生', 'student123');
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });

  it('returns 410 even if a legacy menu row exists', async () => {
    const created = await req('/api/admin/menus', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'legacy-menu-ignored',
        canteenId: 'north',
        date: businessDate(),
        mealType: 'lunch',
        status: 'published',
        items: [{ dishId: 'd-chicken-bowl', price: 1, supplyLimit: 1 }],
      },
    });
    assert.equal(created.status, 201);

    const retired = await req('/api/menus/today?mealType=lunch');
    assert.equal(retired.status, 410);
    assert.equal(retired.data.error.code, 'TODAY_MENU_RETIRED');
  });

  it('recommendations use the stable catalog and expose no menu metadata', async () => {
    const response = await req('/api/recommend?mealType=lunch', { token: studentToken });
    assert.equal(response.status, 200);
    assert.equal(response.data.source, 'stable_catalog');
    assert.equal(response.data.menu, null);
    assert.equal(response.data.catalog.source, 'stable_catalog');
    assert.ok(response.data.ranked.length > 0);
    const chicken = response.data.ranked.find((dish) => dish.id === 'd-chicken-bowl');
    assert.equal(chicken.price, 16, 'legacy menu price does not override the catalog');
  });
});
