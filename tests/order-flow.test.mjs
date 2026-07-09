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
let db;

function today() {
  return new Date().toISOString().slice(0, 10);
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

async function login(username, password) {
  const { data } = await req('/api/auth/login', { method: 'POST', body: { username, password } });
  return data.token;
}

/* ================================================================== */
/*  Order flow: creation, supply decrement, role enforcement, status   */
/* ================================================================== */
describe('Order flow', () => {
  let adminToken;
  let studentToken;
  let otherStudentToken;

  before(async () => {
    db = openDatabase(':memory:');
    const app = createApp({ db });
    server = createServer(app.handler);
    server.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    adminToken = await login('admin', 'admin123');
    studentToken = await login('演示学生', 'student123');

    // Register a second student so we can test isolation
    const reg = await req('/api/auth/register', {
      method: 'POST',
      body: { username: '第二学生', password: 'pass456', nickname: '小二' },
    });
    otherStudentToken = reg.data.token;

    // Create a published menu for today with known supply limits
    await req('/api/admin/menus', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'order-menu-1',
        canteenId: 'north',
        date: today(),
        mealType: 'lunch',
        status: 'published',
        items: [
          { dishId: 'd-chicken-bowl', price: 13, supplyLimit: 5, supplyCount: 0, soldOut: false },
          { dishId: 'd-egg-tomato', price: 11, supplyLimit: 3, supplyCount: 0, soldOut: false },
        ],
      },
    });
  });

  after(() => server.close());

  /* ── Student creates order and receives pickup code ──────────── */
  it('student creates order from today menu and receives pickup code, total, and items', async () => {
    const { status, data } = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [{ dishId: 'd-chicken-bowl', quantity: 2 }] },
    });
    assert.equal(status, 201);
    assert.ok(data.order, 'response contains order');
    const { order } = data;

    // Pickup code: non-empty string
    assert.ok(typeof order.pickupCode === 'string' && order.pickupCode.length > 0, 'pickupCode is a non-empty string');

    // Total: 2 × 13 = 26
    assert.equal(order.totalAmount, 26);

    // Items shape
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0].dishId, 'd-chicken-bowl');
    assert.equal(order.items[0].quantity, 2);
    assert.equal(order.items[0].price, 13);

    // Status starts as pending
    assert.equal(order.status, 'pending');
  });

  /* ── Supply decrements on order creation ─────────────────────── */
  it('creating an order increments supplyCount; soldOut flips when supplyLimit is reached', async () => {
    // supplyLimit for d-egg-tomato is 3; place an order for 3 units
    const { status, data } = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [{ dishId: 'd-egg-tomato', quantity: 3 }] },
    });
    assert.equal(status, 201);

    // Verify supply has decremented via today menu
    const menu = await req('/api/menus/today?mealType=lunch');
    assert.equal(menu.status, 200);
    const eggItem = menu.data.dishes.find((d) => d.id === 'd-egg-tomato');
    assert.ok(eggItem, 'egg-tomato dish should be in today menu');
    assert.equal(eggItem.menuItem.supplyCount, 3, 'supplyCount equals ordered quantity');
    assert.equal(eggItem.supplyStatus, 'sold_out', 'dish is sold out when supplyLimit reached');

    // Attempting to order a sold-out dish should fail
    const overOrder = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [{ dishId: 'd-egg-tomato', quantity: 1 }] },
    });
    assert.equal(overOrder.status, 400);
    assert.ok(overOrder.data.error, 'error message present for sold-out item');
  });

  /* ── Student lists only own orders ───────────────────────────── */
  it('student can list only their own orders, not another student\'s', async () => {
    // Other student creates their own order
    await req('/api/orders', {
      method: 'POST',
      token: otherStudentToken,
      body: { items: [{ dishId: 'd-chicken-bowl', quantity: 1 }] },
    });

    // First student lists orders
    const mine = await req('/api/orders', { token: studentToken });
    assert.equal(mine.status, 200);
    assert.ok(Array.isArray(mine.data.orders), 'returns orders array');

    // All returned orders belong to the requesting student
    for (const order of mine.data.orders) {
      assert.equal(order.userId, 'u-demo-student', 'each order belongs to the requesting student');
    }

    // Second student sees only their own
    const theirs = await req('/api/orders', { token: otherStudentToken });
    assert.equal(theirs.status, 200);
    assert.ok(theirs.data.orders.length >= 1, 'other student has at least one order');
    assert.ok(
      theirs.data.orders.every((o) => o.userId !== 'u-demo-student'),
      'other student does not see first student\'s orders',
    );
  });

  /* ── Student cannot update order status ──────────────────────── */
  it('student cannot transition order status (403)', async () => {
    const list = await req('/api/orders', { token: studentToken });
    const orderId = list.data.orders[0].id;

    const { status, data } = await req(`/api/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      token: studentToken,
      body: { status: 'preparing' },
    });
    assert.equal(status, 403);
    assert.ok(data.error, 'error message present');
  });

  /* ── Admin can transition order status ───────────────────────── */
  it('admin can transition order through valid status chain: pending → preparing → ready → completed', async () => {
    const list = await req('/api/orders', { token: studentToken });
    const orderId = list.data.orders[0].id;

    const transitions = ['preparing', 'ready', 'completed'];
    let currentStatus = 'pending';
    for (const nextStatus of transitions) {
      const { status, data } = await req(`/api/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        token: adminToken,
        body: { status: nextStatus },
      });
      assert.equal(status, 200);
      assert.equal(data.order.status, nextStatus, `transitioned from ${currentStatus} → ${nextStatus}`);
      currentStatus = nextStatus;
    }
  });

  /* ── Invalid status transition returns 400 ───────────────────── */
  it('invalid status transition returns 400', async () => {
    // Create a fresh order in pending state
    const created = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [{ dishId: 'd-chicken-bowl', quantity: 1 }] },
    });
    assert.equal(created.status, 201);
    const orderId = created.data.order.id;

    // pending → completed (skipping preparing/ready) is invalid
    const { status, data } = await req(`/api/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'completed' },
    });
    assert.equal(status, 400);
    assert.ok(data.error, 'error message for invalid transition');
  });

  /* ── Invalid quantities return 400 ───────────────────────────── */
  it('invalid quantities (zero, negative, exceeding remaining supply) return 400', async () => {
    // Zero quantity
    const zero = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [{ dishId: 'd-chicken-bowl', quantity: 0 }] },
    });
    assert.equal(zero.status, 400);

    // Negative quantity
    const neg = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [{ dishId: 'd-chicken-bowl', quantity: -1 }] },
    });
    assert.equal(neg.status, 400);

    // Exceeding remaining supply (d-chicken-bowl has supplyLimit 5; some already ordered)
    const menu = await req('/api/menus/today?mealType=lunch');
    const chickenItem = menu.data.dishes.find((d) => d.id === 'd-chicken-bowl');
    const remaining = chickenItem.menuItem.supplyLimit - chickenItem.menuItem.supplyCount;
    const over = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [{ dishId: 'd-chicken-bowl', quantity: remaining + 1 }] },
    });
    assert.equal(over.status, 400);
  });

  /* ── Empty items array returns 400 ───────────────────────────── */
  it('order with empty items array returns 400', async () => {
    const { status } = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [] },
    });
    assert.equal(status, 400);
  });

  /* ── Unauthenticated order creation returns 401 ─────────────── */
  it('unauthenticated request to create order returns 401', async () => {
    const { status } = await req('/api/orders', {
      method: 'POST',
      body: { items: [{ dishId: 'd-chicken-bowl', quantity: 1 }] },
    });
    assert.equal(status, 401);
  });

  /* ── Admin can list all orders ───────────────────────────────── */
  it('admin listing orders sees orders from all students', async () => {
    const { status, data } = await req('/api/admin/orders', { token: adminToken });
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.orders), 'returns orders array');
    // Should contain orders from both students
    const userIds = new Set(data.orders.map((o) => o.userId));
    assert.ok(userIds.size >= 2, 'admin sees orders from multiple students');
  });
});
