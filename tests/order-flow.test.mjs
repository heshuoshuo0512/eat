import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { businessDate } from '../server/time.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

let server;
let baseUrl;
let db;

function today() {
  return businessDate();
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
  it('student creates an at-stall reservation from the stable catalog', async () => {
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
    assert.equal(order.totalAmount, 32);
    assert.equal(order.estimatedAmount, 32);
    assert.equal(order.finalAmount, 32);
    assert.equal(order.orderType, 'reservation');
    assert.equal(order.paymentMethod, 'at_stall');
    assert.equal(order.pricingStatus, 'exact');

    // Items shape
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0].dishId, 'd-chicken-bowl');
    assert.equal(order.items[0].quantity, 2);
    assert.equal(order.items[0].price, 16);
    assert.equal(order.items[0].priceDisplay, '16元');

    // Status starts as pending
    assert.equal(order.status, 'pending');
  });

  /* ── Supply decrements on order creation ─────────────────────── */
  it('reuses an idempotency key without creating duplicate reservations or changing sales', async () => {
    // supplyLimit for d-egg-tomato is 3; place an order for 3 units
    const beforeSales = db.prepare("SELECT sales FROM dishes WHERE id = 'd-egg-tomato'").get().sales;
    const body = { idempotencyKey: 'order-flow-idempotency-egg', items: [{ dishId: 'd-egg-tomato', quantity: 3 }] };
    const first = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body,
    });
    const repeated = await req('/api/orders', { method: 'POST', token: studentToken, body });
    assert.equal(first.status, 201);
    assert.equal(repeated.status, 201);
    assert.equal(repeated.data.order.id, first.data.order.id);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM orders WHERE idempotency_key = 'order-flow-idempotency-egg'").get().count, 1);
    assert.equal(db.prepare("SELECT sales FROM dishes WHERE id = 'd-egg-tomato'").get().sales, beforeSales);

    // Verify supply has decremented via today menu
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
  it('invalid quantities and mixed-stall reservations return 400', async () => {
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
    const over = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [{ dishId: 'd-chicken-bowl', quantity: 21 }] },
    });
    assert.equal(over.status, 400);

    const mixed = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [{ dishId: 'd-chicken-bowl', quantity: 1 }, { dishId: 'd-egg-tomato', quantity: 1 }] },
    });
    assert.equal(mixed.status, 400);
    assert.equal(mixed.data.code, 'MIXED_STALL_ORDER');
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
