import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';

let db;
let server;
let baseUrl;
let studentToken;

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

describe('stable catalog bootstrap', () => {
  before(async () => {
    db = openDatabase(':memory:');
    server = createServer(createApp({ db }).handler);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await req('/api/auth/login', {
      method: 'POST',
      body: { username: '演示学生', password: 'student123' },
    });
    studentToken = login.data.token;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });

  it('keeps explicitly enabled demo menus inside the test fixture only', () => {
    assert.equal(process.env.ENABLE_DEMO_SEED, '1');
    assert.ok(db.prepare('SELECT COUNT(*) AS count FROM menus').get().count > 0);
    assert.ok(db.prepare('SELECT COUNT(*) AS count FROM menu_items').get().count > 0);
  });

  it('retires the student today-menu endpoint with a stable error code', async () => {
    const response = await req('/api/menus/today?mealType=lunch');
    assert.equal(response.status, 410);
    assert.equal(response.data.error.code, 'TODAY_MENU_RETIRED');
  });

  it('searches and reserves directly from the stable catalog', async () => {
    const search = await req('/api/dishes/search', {
      method: 'POST',
      token: studentToken,
      body: { query: '', page: 1, pageSize: 5 },
    });
    assert.equal(search.status, 200);
    const dish = search.data.items.find((item) => item.availability.orderable);
    assert.ok(dish);

    const reservation = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { idempotencyKey: 'stable-catalog-seed-test', items: [{ dishId: dish.id, quantity: 1 }] },
    });
    assert.equal(reservation.status, 201);
    assert.equal(reservation.data.order.orderType, 'reservation');
    assert.equal(reservation.data.order.paymentMethod, 'at_stall');
  });
});
