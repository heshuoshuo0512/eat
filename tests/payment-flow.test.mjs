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
/*  Payment flow: pay, cancel with rollback, admin analytics           */
/* ================================================================== */
describe('Payment flow', () => {
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

    // Register a second student
    const reg = await req('/api/auth/register', {
      method: 'POST',
      body: { username: '支付测试学生', password: 'pay789', nickname: '小付' },
    });
    otherStudentToken = reg.data.token;

    // Create a published menu with known supply limits
    await req('/api/admin/menus', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'pay-menu-1',
        canteenId: 'north',
        date: today(),
        mealType: 'lunch',
        status: 'published',
        items: [
          { dishId: 'd-chicken-bowl', price: 13, supplyLimit: 10, supplyCount: 0, soldOut: false },
          { dishId: 'd-egg-tomato', price: 11, supplyLimit: 3, supplyCount: 0, soldOut: false },
        ],
      },
    });
  });

  after(() => server.close());

  /* ── Owner can pay own pending order ──────────────────────────── */
  it('reservation rejects online payment and requires payment at the stall', async () => {
    // Create an order
    const created = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [{ dishId: 'd-chicken-bowl', quantity: 1 }] },
    });
    assert.equal(created.status, 201);
    const orderId = created.data.order.id;
    assert.equal(created.data.order.paymentStatus, 'unpaid', 'new order starts unpaid');

    // Pay it
    const { status, data } = await req(`/api/orders/${orderId}/pay`, {
      method: 'POST',
      token: studentToken,
    });
    assert.equal(status, 409);
    assert.equal(data.code, 'PAY_AT_STALL_REQUIRED');

    const current = await req('/api/orders', { token: studentToken });
    const order = current.data.orders.find((item) => item.id === orderId);
    assert.equal(order.paymentStatus, 'unpaid');
    assert.equal(order.paymentMethod, 'at_stall');
    assert.equal(order.paidAt, null);
  });

  /* ── Second student cannot pay another's order ────────────────── */
  it('student cannot pay another student\'s order (403)', async () => {
    // Student1 creates an order
    const created = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [{ dishId: 'd-chicken-bowl', quantity: 1 }] },
    });
    assert.equal(created.status, 201);
    const orderId = created.data.order.id;

    // Student2 tries to pay it
    const { status, data } = await req(`/api/orders/${orderId}/pay`, {
      method: 'POST',
      token: otherStudentToken,
    });
    assert.equal(status, 403);
    assert.ok(data.error, 'error message present');
  });

  /* ── Paying already-paid order returns 400 ────────────────────── */
  it('repeated online payment attempts remain rejected without creating a payment', async () => {
    const created = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [{ dishId: 'd-chicken-bowl', quantity: 1 }] },
    });
    assert.equal(created.status, 201);
    const orderId = created.data.order.id;

    // Pay once
    const first = await req(`/api/orders/${orderId}/pay`, { method: 'POST', token: studentToken });
    assert.equal(first.status, 409);
    assert.equal(first.data.code, 'PAY_AT_STALL_REQUIRED');

    // Pay again
    const { status, data } = await req(`/api/orders/${orderId}/pay`, {
      method: 'POST',
      token: studentToken,
    });
    assert.equal(status, 409);
    assert.equal(data.code, 'PAY_AT_STALL_REQUIRED');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM payments WHERE order_id = ?').get(orderId).count, 0);
  });

  /* ── Cancel pending order rolls back supplyCount and soldOut ──── */
  it('cancelling a pending reservation leaves catalog sales unchanged', async () => {
    const beforeSales = db.prepare("SELECT sales FROM dishes WHERE id = 'd-egg-tomato'").get().sales;
    // Order 3 units of egg-tomato (supplyLimit = 3), which will sell it out
    const created = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [{ dishId: 'd-egg-tomato', quantity: 3 }] },
    });
    assert.equal(created.status, 201);
    const orderId = created.data.order.id;

    // Verify dish is sold out
    // Cancel the order
    const { status, data } = await req(`/api/orders/${orderId}/cancel`, {
      method: 'POST',
      token: studentToken,
    });
    assert.equal(status, 200);
    assert.equal(data.order.status, 'cancelled', 'order status is cancelled');

    // Verify supply rolled back
    assert.equal(db.prepare("SELECT sales FROM dishes WHERE id = 'd-egg-tomato'").get().sales, beforeSales);

    // Ordering the same dish again should now succeed
    const reorder = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [{ dishId: 'd-egg-tomato', quantity: 1 }] },
    });
    assert.equal(reorder.status, 201, 'catalog remains reservable after cancellation');
  });

  /* ── Cancelling completed order returns 400 ───────────────────── */
  it('cancelling a completed order returns 400', async () => {
    // Create and advance to completed
    const created = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [{ dishId: 'd-chicken-bowl', quantity: 1 }] },
    });
    assert.equal(created.status, 201);
    const orderId = created.data.order.id;

    for (const next of ['preparing', 'ready', 'completed']) {
      await req(`/api/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        token: adminToken,
        body: { status: next },
      });
    }

    const { status, data } = await req(`/api/orders/${orderId}/cancel`, {
      method: 'POST',
      token: studentToken,
    });
    assert.equal(status, 400);
    assert.ok(data.error, 'error message for cancelling completed order');
  });

  /* ── Cancelling already-cancelled order returns 400 ───────────── */
  it('cancelling an already-cancelled order returns 400', async () => {
    const created = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [{ dishId: 'd-chicken-bowl', quantity: 1 }] },
    });
    assert.equal(created.status, 201);
    const orderId = created.data.order.id;

    // Cancel once
    const first = await req(`/api/orders/${orderId}/cancel`, { method: 'POST', token: studentToken });
    assert.equal(first.status, 200);

    // Cancel again
    const { status, data } = await req(`/api/orders/${orderId}/cancel`, {
      method: 'POST',
      token: studentToken,
    });
    assert.equal(status, 400);
    assert.ok(data.error, 'error message for double cancel');
  });

  /* ── Student cannot cancel another's order ────────────────────── */
  it('student cannot cancel another student\'s order (403)', async () => {
    const created = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [{ dishId: 'd-chicken-bowl', quantity: 1 }] },
    });
    assert.equal(created.status, 201);
    const orderId = created.data.order.id;

    const { status, data } = await req(`/api/orders/${orderId}/cancel`, {
      method: 'POST',
      token: otherStudentToken,
    });
    assert.equal(status, 403);
    assert.ok(data.error, 'error message present');
  });

  /* ── Admin order analytics ────────────────────────────────────── */
  it('admin order analytics returns todayOrders, todayRevenue, statusCounts, topDishes, soldOutItems', async () => {
    const created = await req('/api/orders', {
      method: 'POST',
      token: studentToken,
      body: { items: [{ dishId: 'd-chicken-bowl', quantity: 1 }] },
    });
    assert.equal(created.status, 201);
    for (const nextStatus of ['preparing', 'ready', 'completed']) {
      const transition = await req(`/api/admin/orders/${created.data.order.id}/status`, {
        method: 'PATCH',
        token: adminToken,
        body: { status: nextStatus },
      });
      assert.equal(transition.status, 200);
    }

    const { status, data } = await req('/api/admin/order-analytics', { token: adminToken });
    assert.equal(status, 200);

    // todayOrders: positive count (we created several orders today)
    assert.ok(typeof data.todayOrders === 'number' && data.todayOrders > 0, 'todayOrders is a positive number');

    // todayRevenue: sum of paid orders
    assert.ok(typeof data.todayRevenue === 'number' && data.todayRevenue >= 0, 'todayRevenue is a non-negative number');
    assert.ok(data.todayRevenue > 0, 'todayRevenue reflects paid orders');

    // statusCounts: object with at least one entry
    assert.ok(data.statusCounts && typeof data.statusCounts === 'object', 'statusCounts is an object');
    const totalFromStatus = Object.values(data.statusCounts).reduce((s, n) => s + n, 0);
    assert.equal(totalFromStatus, data.todayOrders, 'statusCounts sum equals todayOrders');

    // topDishes: array with dishId, dishName, totalQuantity, totalRevenue
    assert.ok(Array.isArray(data.topDishes), 'topDishes is an array');
    assert.ok(data.topDishes.length > 0, 'topDishes is non-empty');
    const first = data.topDishes[0];
    assert.ok(first.dishId, 'top dish has dishId');
    assert.ok(first.dishName, 'top dish has dishName');
    assert.ok(typeof first.totalQuantity === 'number' && first.totalQuantity > 0, 'top dish has positive totalQuantity');
    assert.ok(typeof first.totalRevenue === 'number' && first.totalRevenue > 0, 'top dish has positive totalRevenue');

    // soldOutItems: array (may be empty if no dish is currently sold out)
    assert.ok(Array.isArray(data.soldOutItems), 'soldOutItems is an array');
  });
});
