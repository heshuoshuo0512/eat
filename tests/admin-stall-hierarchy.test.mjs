import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';

let server;
let baseUrl;
let adminToken;
let studentToken;

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function login(username, password) {
  const response = await req('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.equal(response.status, 200);
  return response.data.token;
}

const rootPayload = {
  id: 'stall-hierarchy-root',
  canteenId: 'north',
  name: '测试一级档口',
  floor: '1F',
  category: '综合档口',
  rating: 4.5,
  avgPrice: 15,
  open: true,
  description: '用于管理员层级测试。'
};

describe('admin stall hierarchy', () => {
  before(async () => {
    const app = createApp({ db: openDatabase(':memory:') });
    server = createServer(app.handler);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    adminToken = await login('admin', 'admin123');
    studentToken = await login('演示学生', 'student123');
  });

  after(() => server.close());

  it('keeps existing stalls as top-level and preserves direct dishes', async () => {
    const response = await req('/api/bootstrap', { token: adminToken });
    assert.equal(response.status, 200);
    const existing = response.data.stalls.find((stall) => stall.id === 'n-protein');
    assert.ok(existing);
    assert.equal(existing.parentId, null);
    assert.ok(response.data.dishes.some((dish) => dish.stallId === existing.id));
  });

  it('creates a top-level stall and a child stall in the same canteen', async () => {
    const root = await req('/api/admin/stalls', { method: 'POST', token: adminToken, body: rootPayload });
    assert.equal(root.status, 201);
    const createdRoot = root.data.stalls.find((stall) => stall.id === rootPayload.id);
    assert.equal(createdRoot.parentId, null);

    const child = await req('/api/admin/stalls', {
      method: 'POST',
      token: adminToken,
      body: { ...rootPayload, id: 'stall-hierarchy-child', name: '测试子档口', parentId: rootPayload.id }
    });
    assert.equal(child.status, 201);
    const createdChild = child.data.stalls.find((stall) => stall.id === 'stall-hierarchy-child');
    assert.equal(createdChild.parentId, rootPayload.id);
    assert.equal(createdChild.canteenId, rootPayload.canteenId);
  });

  it('rejects cross-canteen parents, third-level nesting, self-parenting, and cycles', async () => {
    const crossCanteen = await req('/api/admin/stalls', {
      method: 'POST', token: adminToken,
      body: { ...rootPayload, id: 'stall-cross-canteen', canteenId: 'central', parentId: rootPayload.id }
    });
    assert.equal(crossCanteen.status, 400);

    const thirdLevel = await req('/api/admin/stalls', {
      method: 'POST', token: adminToken,
      body: { ...rootPayload, id: 'stall-third-level', parentId: 'stall-hierarchy-child' }
    });
    assert.equal(thirdLevel.status, 400);

    const selfParent = await req(`/api/admin/stalls/${rootPayload.id}`, {
      method: 'PUT', token: adminToken, body: { parentId: rootPayload.id }
    });
    assert.equal(selfParent.status, 400);

    const cycle = await req(`/api/admin/stalls/${rootPayload.id}`, {
      method: 'PUT', token: adminToken, body: { parentId: 'stall-hierarchy-child' }
    });
    assert.equal(cycle.status, 400);
  });

  it('blocks deleting a parent with children and rejects student writes', async () => {
    const blocked = await req(`/api/admin/stalls/${rootPayload.id}`, { method: 'DELETE', token: adminToken });
    assert.equal(blocked.status, 409);

    const forbidden = await req('/api/admin/stalls', {
      method: 'POST', token: studentToken,
      body: { ...rootPayload, id: 'student-stall' }
    });
    assert.equal(forbidden.status, 403);
  });

  it('ships portable migration contracts for the hierarchy', () => {
    const runtimeMigration = readFileSync('server/migrations/006_admin_stall_hierarchy.sql', 'utf8');
    const postgresBaseline = readFileSync('migrations/postgres/001_initial_schema.sql', 'utf8');
    assert.match(runtimeMigration, /parent_id/i);
    assert.match(runtimeMigration, /stalls\s*\(\s*tenant_id\s*,\s*parent_id\s*\)/i);
    assert.match(postgresBaseline, /parent_id\s+TEXT\s+REFERENCES\s+stalls/i);
    assert.match(postgresBaseline, /stalls\s*\(\s*tenant_id\s*,\s*parent_id\s*\)/i);
  });
});
