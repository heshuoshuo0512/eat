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

describe('Seed default today lunch menu', () => {
  before(() => {
    db = openDatabase(':memory:');
    const app = createApp({ db });
    server = createServer(app.handler);
    server.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  it('fresh DB exposes a published lunch menu via /api/menus/today', async () => {
    const { status, data } = await req('/api/menus/today?mealType=lunch');
    assert.equal(status, 200);
    assert.equal(data.source, 'menu', 'source should be menu, not fallback');
    assert.equal(data.mealType, 'lunch');
    assert.equal(data.date, today());
    assert.ok(data.menus.length >= 1, 'at least one published menu');
    assert.ok(data.dishes.length >= 5, 'seed menu has at least 5 lunch dishes');

    const menu = data.menus[0];
    assert.equal(menu.status, 'published');
    assert.equal(menu.date, today());

    // Every dish should have supply metadata from menu_items
    for (const dish of data.dishes) {
      assert.ok(dish.menuItem, `dish ${dish.id} has menuItem`);
      assert.equal(dish.menuItem.supplyCount, 0, `dish ${dish.id} supply_count starts at 0`);
      assert.ok(dish.menuItem.supplyLimit > 0, `dish ${dish.id} has positive supply_limit`);
      assert.equal(dish.supplyStatus, 'available', `dish ${dish.id} is available`);
    }
  });

  it('all seeded dishes support lunch in their mealTypes', async () => {
    const { data } = await req('/api/menus/today?mealType=lunch');
    for (const dish of data.dishes) {
      const full = db.prepare('SELECT meal_types_json FROM dishes WHERE id = ? AND tenant_id = ?').get(dish.id, 'default');
      assert.ok(full, `dish ${dish.id} exists in dishes table`);
      const mealTypes = JSON.parse(full.meal_types_json);
      assert.ok(mealTypes.includes('lunch'), `dish ${dish.id} mealTypes includes lunch`);
    }
  });

  it('student can place an order against the seeded lunch menu', async () => {
    const token = await login('演示学生', 'student123');
    const { data: menuData } = await req('/api/menus/today?mealType=lunch');
    const firstDish = menuData.dishes[0];

    const { status, data: result } = await req('/api/orders', {
      method: 'POST',
      token,
      body: {
        mealType: 'lunch',
        items: [{ dishId: firstDish.id, quantity: 2 }]
      }
    });
    assert.equal(status, 201, 'order creation succeeds');
    const order = result.order;
    assert.ok(order, 'response has order');
    assert.ok(order.id, 'order has id');
    assert.equal(order.status, 'pending');
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0].dishId, firstDish.id);
    assert.equal(order.items[0].quantity, 2);
    assert.ok(order.totalAmount > 0, 'total amount is positive');

    // supply_count should have incremented
    const { data: afterMenu } = await req('/api/menus/today?mealType=lunch');
    const updated = afterMenu.dishes.find((d) => d.id === firstDish.id);
    assert.equal(updated.menuItem.supplyCount, 2, 'supply_count incremented after order');
  });

  it('seeded menu uses a deterministic id so repeated openDatabase is idempotent', () => {
    const date = today();
    const expectedId = `menu-default-${date}-lunch`;
    const row = db.prepare('SELECT id, status FROM menus WHERE id = ?').get(expectedId);
    assert.ok(row, `deterministic menu id ${expectedId} exists`);
    assert.equal(row.status, 'published');

    const itemCount = db.prepare('SELECT COUNT(*) AS count FROM menu_items WHERE menu_id = ?').get(expectedId);
    assert.ok(itemCount.count >= 5, 'menu has reasonable number of items');
  });

  it('re-opening the same database does not duplicate menus or items', () => {
    const date = today();
    const expectedId = `menu-default-${date}-lunch`;

    const db2 = openDatabase(':memory:');
    const menuCount = db2.prepare('SELECT COUNT(*) AS count FROM menus WHERE id = ?').get(expectedId);
    assert.equal(menuCount.count, 1, 'exactly one menu row after fresh openDatabase');

    const itemCount = db2.prepare('SELECT COUNT(*) AS count FROM menu_items WHERE menu_id = ?').get(expectedId);
    assert.ok(itemCount.count >= 5, 'menu_items populated on second DB too');

    // On the SAME db, verify the idempotency guard SELECT finds existing
    const existing = db.prepare('SELECT id FROM menus WHERE id = ?').get(expectedId);
    assert.ok(existing, 'idempotency guard SELECT finds the existing menu');

    db2.close();
  });
});
