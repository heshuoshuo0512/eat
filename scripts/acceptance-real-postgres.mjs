#!/usr/bin/env node
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { openPostgresDatabase } from '../server/database.js';
import { hashPassword } from '../server/security.js';

if (!process.env.LOCAL_DATABASE_MIGRATION_URL || !process.env.LOCAL_DATABASE_URL) {
  throw new Error('LOCAL_DATABASE_MIGRATION_URL and LOCAL_DATABASE_URL are required');
}

const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const studentId = `accept-student-${suffix}`;
const adminId = `accept-admin-${suffix}`;
const studentName = `accept_student_${suffix}`;
const adminName = `accept_admin_${suffix}`;
const password = `Accept-${suffix}-Pass9`;
const migrationDb = await openPostgresDatabase(process.env.LOCAL_DATABASE_MIGRATION_URL, { migrate: false, applicationName: 'acceptance-fixture' });
const apiDb = await openPostgresDatabase(process.env.LOCAL_DATABASE_URL, { migrate: false, applicationName: 'acceptance-api' });
const createdOrders = [];
const originalSales = new Map();
const report = { counts: {}, bootstrap: {}, search: {}, reservation: {}, cleanup: false };
let server;

async function insertUser(id, username, role, passwordHash, timestamp) {
  await migrationDb.prepare(`
    INSERT INTO users (id, tenant_id, username, password_hash, nickname, role, created_at, updated_at)
    VALUES (?, 'default', ?, ?, ?, ?, ?, ?)
  `).run(id, username, passwordHash, username, role, timestamp, timestamp);
  await migrationDb.prepare(`
    INSERT INTO health_profiles (user_id, tenant_id, onboarding_status, allergy_status, updated_at)
    VALUES (?, 'default', 'completed', 'none', ?)
  `).run(id, timestamp);
}

async function removeAcceptanceUsers() {
  const users = await migrationDb.query("SELECT id FROM users WHERE tenant_id='default' AND username LIKE 'accept\\_%' ESCAPE '\\'");
  for (const { id: userId } of users.rows) {
    const orders = await migrationDb.prepare("SELECT id FROM orders WHERE tenant_id='default' AND user_id=?").all(userId);
    for (const { id: orderId } of orders) {
      await migrationDb.prepare("DELETE FROM payments WHERE tenant_id='default' AND order_id=?").run(orderId);
      await migrationDb.prepare("DELETE FROM order_items WHERE tenant_id='default' AND order_id=?").run(orderId);
      await migrationDb.prepare("DELETE FROM orders WHERE tenant_id='default' AND id=?").run(orderId);
    }
    await migrationDb.prepare("DELETE FROM auth_sessions WHERE tenant_id='default' AND user_id=?").run(userId);
    await migrationDb.prepare("DELETE FROM health_profiles WHERE tenant_id='default' AND user_id=?").run(userId);
    await migrationDb.prepare("DELETE FROM users WHERE tenant_id='default' AND id=?").run(userId);
  }
}

try {
  await removeAcceptanceUsers();
  const countResult = await migrationDb.runWithContext({
    tenantId: 'default', userId: 'catalog-acceptance', role: 'super_admin', requestId: `accept-counts-${suffix}`,
  }, async () => migrationDb.query(`SELECT
      (SELECT COUNT(*) FROM canteens WHERE tenant_id='default') AS venues,
      (SELECT COUNT(*) FROM stalls WHERE tenant_id='default') AS stalls,
      (SELECT COUNT(*) FROM dishes WHERE tenant_id='default') AS dishes,
      (SELECT COUNT(*) FROM catalog_import_rows WHERE tenant_id='default') AS audit_rows,
      (SELECT COUNT(*) FROM catalog_import_rows WHERE tenant_id='default' AND status='accepted') AS accepted,
      (SELECT COUNT(*) FROM catalog_import_rows WHERE tenant_id='default' AND status='review_required') AS review_required,
      (SELECT COUNT(*) FROM catalog_import_rows WHERE tenant_id='default' AND status='excluded') AS excluded,
      (SELECT COUNT(*) FROM rag_documents) AS rag_documents,
      (SELECT COUNT(*) FROM dish_ai_annotations WHERE tenant_id='default' AND status='schema_validated') AS schema_validated_annotations,
      (SELECT COUNT(*) FROM users WHERE tenant_id='default') AS users,
      (SELECT COUNT(*) FROM menus WHERE tenant_id='default') AS menus,
      (SELECT COUNT(*) FROM menu_items WHERE tenant_id='default') AS menu_items`));
  report.counts = Object.fromEntries(Object.entries(countResult.rows[0]).map(([key, value]) => [key, Number(value)]));

  const passwordHash = await hashPassword(password);
  const timestamp = new Date().toISOString();
  await insertUser(studentId, studentName, 'student', passwordHash, timestamp);
  await insertUser(adminId, adminName, 'admin', passwordHash, timestamp);

  server = createServer(createApp({ db: apiDb }).handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = 'GET', token, body, idempotencyKey } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, bytes: Buffer.byteLength(text), data: text ? JSON.parse(text) : null };
  };
  const login = async (username) => (await request('/api/auth/login', { method: 'POST', body: { username, password } })).data.token;
  const studentToken = await login(studentName);
  const adminToken = await login(adminName);

  const bootstrap = await request('/api/bootstrap', { token: studentToken });
  report.bootstrap = {
    status: bootstrap.status,
    bytes: bootstrap.bytes,
    hasDishes: Object.hasOwn(bootstrap.data, 'dishes'),
    stats: bootstrap.data.catalogStats,
  };

  const searchBody = { query: '', pageSize: 7, reservationOnly: true };
  const page1 = await request('/api/dishes/search', { method: 'POST', token: studentToken, body: { ...searchBody, page: 1 } });
  const page2 = await request('/api/dishes/search', { method: 'POST', token: studentToken, body: { ...searchBody, page: 2 } });
  report.search = {
    status: page1.status,
    page1Count: page1.data.items.length,
    page2Count: page2.data.items.length,
    total: page1.data.page.total,
    disjoint: !page1.data.items.some((left) => page2.data.items.some((right) => left.id === right.id)),
  };

  const catalog = await migrationDb.query(`
    SELECT d.id, d.stall_id, d.sales, d.pricing_mode
    FROM dishes d
    JOIN stalls s ON s.id=d.stall_id AND s.tenant_id=d.tenant_id
    WHERE d.tenant_id='default' AND d.status='active'
      AND d.reservation_enabled=TRUE AND s.reservation_enabled=TRUE
    ORDER BY CASE WHEN d.pricing_mode IN ('per_weight','variants') THEN 0 ELSE 1 END, d.id
    LIMIT 200
  `);
  const first = catalog.rows[0];
  const second = catalog.rows.find((row) => row.stall_id !== first?.stall_id);
  if (!first || !second) throw new Error('Not enough reservable dishes across stalls');
  originalSales.set(first.id, Number(first.sales));

  const idempotencyKey = `accept-idempotency-${suffix}`;
  const created = await request('/api/orders', {
    method: 'POST',
    token: studentToken,
    idempotencyKey,
    body: { items: [{ dishId: first.id, quantity: 1 }] },
  });
  if (created.data?.order?.id) createdOrders.push(created.data.order.id);
  const repeated = await request('/api/orders', {
    method: 'POST', token: studentToken, idempotencyKey, body: { items: [{ dishId: first.id, quantity: 1 }] },
  });
  const mixed = await request('/api/orders', {
    method: 'POST', token: studentToken, idempotencyKey: `accept-mixed-${suffix}`,
    body: { items: [{ dishId: first.id, quantity: 1 }, { dishId: second.id, quantity: 1 }] },
  });
  const payment = await request(`/api/orders/${created.data.order.id}/pay`, { method: 'POST', token: studentToken });
  const salesBefore = Number((await migrationDb.prepare("SELECT sales FROM dishes WHERE tenant_id='default' AND id=?").get(first.id)).sales);

  await request(`/api/admin/orders/${created.data.order.id}/status`, { method: 'PATCH', token: adminToken, body: { status: 'preparing' } });
  await request(`/api/admin/orders/${created.data.order.id}/status`, { method: 'PATCH', token: adminToken, body: { status: 'ready' } });
  let priceGate = null;
  let priceConfirmation = null;
  if (created.data.order.pricingStatus === 'pending_confirmation') {
    priceGate = await request(`/api/admin/orders/${created.data.order.id}/status`, { method: 'PATCH', token: adminToken, body: { status: 'completed' } });
    priceConfirmation = await request(`/api/admin/orders/${created.data.order.id}/price`, {
      method: 'PATCH', token: adminToken, body: { finalAmount: created.data.order.estimatedAmount },
    });
  }
  const completed = await request(`/api/admin/orders/${created.data.order.id}/status`, { method: 'PATCH', token: adminToken, body: { status: 'completed' } });
  const salesAfter = Number((await migrationDb.prepare("SELECT sales FROM dishes WHERE tenant_id='default' AND id=?").get(first.id)).sales);
  report.reservation = {
    createStatus: created.status,
    orderType: created.data.order.orderType,
    paymentMethod: created.data.order.paymentMethod,
    pricingStatus: created.data.order.pricingStatus,
    idempotentSameId: repeated.data.order.id === created.data.order.id,
    mixedStatus: mixed.status,
    mixedCode: mixed.data.code,
    paymentStatus: payment.status,
    paymentCode: payment.data.code,
    priceGateStatus: priceGate?.status ?? 'not_required',
    priceGateCode: priceGate?.data?.code ?? null,
    priceConfirmationStatus: priceConfirmation?.status ?? 'not_required',
    completeStatus: completed.status,
    completedPaymentStatus: completed.data.order.paymentStatus,
    salesDelta: salesAfter - salesBefore,
  };
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const orderId of createdOrders) {
    await migrationDb.prepare("DELETE FROM payments WHERE tenant_id='default' AND order_id=?").run(orderId);
    await migrationDb.prepare("DELETE FROM order_items WHERE tenant_id='default' AND order_id=?").run(orderId);
    await migrationDb.prepare("DELETE FROM orders WHERE tenant_id='default' AND id=?").run(orderId);
  }
  for (const [dishId, sales] of originalSales) {
    await migrationDb.prepare("UPDATE dishes SET sales=? WHERE tenant_id='default' AND id=?").run(sales, dishId);
  }
  for (const userId of [studentId, adminId]) {
    await migrationDb.prepare("DELETE FROM auth_sessions WHERE tenant_id='default' AND user_id=?").run(userId);
    await migrationDb.prepare("DELETE FROM health_profiles WHERE tenant_id='default' AND user_id=?").run(userId);
    await migrationDb.prepare("DELETE FROM users WHERE tenant_id='default' AND id=?").run(userId);
  }
  report.cleanup = true;
  await Promise.allSettled([apiDb.close(), migrationDb.close()]);
}

console.log(JSON.stringify(report, null, 2));
