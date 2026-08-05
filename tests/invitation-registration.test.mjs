import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';

let baseUrl;
let db;
let server;
let adminToken;

async function request(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

describe('invitation registration', { concurrency: false }, () => {
  before(async () => {
    process.env.NODE_ENV = 'test';
    db = openDatabase(':memory:');
    server = createServer(createApp({ db, invitationRegistrationMode: 'invitation' }).handler);
    server.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const created = await request('/api/auth/register', {
      method: 'POST', body: { username: 'invitation-admin', password: 'Admin123', nickname: 'Invitation admin' }
    });
    assert.equal(created.status, 201);
    await db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(created.data.user.id);
    const loggedIn = await request('/api/auth/login', {
      method: 'POST', body: { identifier: 'invitation-admin', password: 'Admin123' }
    });
    assert.equal(loggedIn.status, 200);
    adminToken = loggedIn.data.token;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('issues one-time codes without storing plaintext and consumes a code atomically', async () => {
    const issued = await request('/api/admin/invitations', {
      method: 'POST', token: adminToken, body: { count: 1 }
    });
    assert.equal(issued.status, 201);
    const invitation = issued.data.invitations[0];
    assert.match(invitation.code, /^[A-Z0-9]{16}$/);
    const stored = await db.prepare('SELECT code_hash, code_hint, status FROM pilot_invitations WHERE id = ?').get(invitation.id);
    assert.equal(stored.status, 'active');
    assert.equal(stored.code_hint, invitation.code.slice(-4));
    assert.notEqual(stored.code_hash, invitation.code);

    const registration = { phone: '13800138701', invitationCode: invitation.code, password: 'Student123', agreementVersion: '2026-07' };
    const created = await request('/api/auth/register', { method: 'POST', body: registration });
    assert.equal(created.status, 201);
    assert.equal(created.data.user.phoneVerified, false);

    const consumed = await db.prepare('SELECT status, used_user_id FROM pilot_invitations WHERE id = ?').get(invitation.id);
    assert.equal(consumed.status, 'consumed');
    assert.equal(consumed.used_user_id, created.data.user.id);
    const replay = await request('/api/auth/register', { method: 'POST', body: { ...registration, phone: '13800138702' } });
    assert.equal(replay.status, 403);
    assert.equal(replay.data.code, 'INVALID_INVITATION_CODE');
  });

  it('does not expose codes when listing and prevents students from managing invitations', async () => {
    const listed = await request('/api/admin/invitations', { token: adminToken });
    assert.equal(listed.status, 200);
    assert.ok(listed.data.invitations.length >= 1);
    assert.equal(Object.hasOwn(listed.data.invitations[0], 'code'), false);

    const student = await request('/api/auth/register', {
      method: 'POST', body: { username: 'invitation-student', password: 'Student123', nickname: 'Invitation student' }
    });
    assert.equal(student.status, 201);
    const forbidden = await request('/api/admin/invitations', { token: student.data.token });
    assert.equal(forbidden.status, 403);
  });

  it('rejects revoked invitations', async () => {
    const issued = await request('/api/admin/invitations', {
      method: 'POST', token: adminToken, body: { count: 1 }
    });
    const invitation = issued.data.invitations[0];
    const revoked = await request(`/api/admin/invitations/${encodeURIComponent(invitation.id)}`, { method: 'DELETE', token: adminToken });
    assert.equal(revoked.status, 200);
    const registration = await request('/api/auth/register', {
      method: 'POST', body: { phone: '13800138703', invitationCode: invitation.code, password: 'Student123', agreementVersion: '2026-07' }
    });
    assert.equal(registration.status, 403);
  });
});
