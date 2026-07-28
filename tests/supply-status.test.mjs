import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';

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

async function searchDish(id) {
  const response = await req('/api/dishes/search', {
    method: 'POST',
    token: studentToken,
    body: { query: '', page: 1, pageSize: 20 },
  });
  assert.equal(response.status, 200);
  return response.data.items.find((dish) => dish.id === id);
}

describe('reservation availability', () => {
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

  it('uses reservable and reservation_paused instead of stock claims', async () => {
    const dish = await searchDish('d-chicken-bowl');
    assert.equal(dish.availability.status, 'reservable');
    assert.equal(dish.availability.orderable, true);
    assert.ok(!('supplyCount' in dish));
    assert.ok(!('soldOut' in dish));
  });

  it('dish operators can pause and resume one dish', async () => {
    const paused = await req('/api/admin/dishes/d-chicken-bowl/reservation', {
      method: 'PATCH', token: adminToken, body: { enabled: false },
    });
    assert.equal(paused.status, 200);
    assert.equal((await searchDish('d-chicken-bowl')).availability.status, 'reservation_paused');

    const blocked = await req('/api/orders', {
      method: 'POST', token: studentToken,
      body: { idempotencyKey: 'paused-dish-order-test', items: [{ dishId: 'd-chicken-bowl', quantity: 1 }] },
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.code, 'RESERVATION_PAUSED');

    const resumed = await req('/api/admin/dishes/d-chicken-bowl/reservation', {
      method: 'PATCH', token: adminToken, body: { enabled: true },
    });
    assert.equal(resumed.status, 200);
    assert.equal((await searchDish('d-chicken-bowl')).availability.status, 'reservable');
  });

  it('stall operators can pause and resume every dish at the stall', async () => {
    const paused = await req('/api/admin/stalls/n-protein/reservation', {
      method: 'PATCH', token: adminToken, body: { enabled: false },
    });
    assert.equal(paused.status, 200);
    assert.equal((await searchDish('d-chicken-bowl')).availability.status, 'reservation_paused');

    const resumed = await req('/api/admin/stalls/n-protein/reservation', {
      method: 'PATCH', token: adminToken, body: { enabled: true },
    });
    assert.equal(resumed.status, 200);
    assert.equal((await searchDish('d-chicken-bowl')).availability.status, 'reservable');
  });
});
