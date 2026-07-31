import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';

let db;
let server;
let baseUrl;
let adminToken;
let claimedCode;
let originalNodeEnv;
let originalPilotMode;
let originalRegistrationMode;

async function request(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

describe('invitation management', { concurrency: false }, () => {
  before(async () => {
    originalNodeEnv = process.env.NODE_ENV;
    originalPilotMode = process.env.PILOT_MODE;
    originalRegistrationMode = process.env.PILOT_REGISTRATION_MODE;
    process.env.NODE_ENV = 'test';
    process.env.PILOT_MODE = 'open';
    process.env.PILOT_REGISTRATION_MODE = 'sms';
    db = openDatabase(':memory:');
    const app = createApp({ db });
    server = createServer(app.handler);
    server.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const registeredAdmin = await request('/api/auth/register', {
      method: 'POST', body: { username: 'invitation-admin', password: 'Admin123', nickname: 'Invitation admin' }
    });
    assert.equal(registeredAdmin.status, 201);
    await db.prepare("UPDATE users SET role = 'admin' WHERE username = ?").run('invitation-admin');
    const login = await request('/api/auth/login', { method: 'POST', body: { username: 'invitation-admin', password: 'Admin123' } });
    assert.equal(login.status, 200);
    adminToken = login.data.token;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalPilotMode === undefined) delete process.env.PILOT_MODE;
    else process.env.PILOT_MODE = originalPilotMode;
    if (originalRegistrationMode === undefined) delete process.env.PILOT_REGISTRATION_MODE;
    else process.env.PILOT_REGISTRATION_MODE = originalRegistrationMode;
  });

  it('creates an idempotent daily batch and exposes remaining quota', async () => {
    const saved = await request('/api/admin/invitations/settings', {
      method: 'PUT', token: adminToken,
      body: { dailyQuota: 3, autoIssue: true, expiresAfterDays: 30, claimTtlHours: 24, issueTime: '14:30', timeZone: 'Asia/Shanghai' }
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.batch.dailyQuota, 3);
    assert.equal(saved.data.settings.issueTime, '14:30');
    assert.equal(saved.data.counts.remainingQuota, 3);

    const repeated = await request('/api/admin/invitations/summary', { token: adminToken });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.data.batch.id, saved.data.batch.id);
    assert.equal(repeated.data.counts.generated, 0);
    const batches = await db.prepare('SELECT COUNT(*) AS count FROM pilot_invitation_batches WHERE tenant_id = ?').get('default');
    assert.equal(Number(batches.count), 1);
  });

  it('claims once, never returns plaintext from list, and only stores a hash', async () => {
    const summary = await request('/api/admin/invitations/summary', { token: adminToken });
    const claimed = await request(`/api/admin/invitations/${encodeURIComponent(summary.data.batch.id)}/claim`, { method: 'POST', token: adminToken, body: {} });
    assert.equal(claimed.status, 201);
    claimedCode = claimed.data.invitation.code;
    assert.match(claimedCode, /^[A-Z0-9][A-Z0-9_-]{7,63}$/);

    const listed = await request('/api/admin/invitations?status=claimed', { token: adminToken });
    assert.equal(listed.status, 200);
    assert.equal(listed.data.invitations.length, 1);
    assert.equal(Object.hasOwn(listed.data.invitations[0], 'code'), false);
    assert.doesNotMatch(JSON.stringify(listed.data), new RegExp(claimedCode));

    const stored = await db.prepare('SELECT code_hash, status FROM pilot_invitations WHERE id = ?').get(claimed.data.invitation.id);
    assert.notEqual(stored.code_hash, claimedCode);
    assert.equal(stored.status, 'active');
    assert.equal((await request(`/api/admin/invitations/${encodeURIComponent(summary.data.batch.id)}/claim`, { method: 'POST', token: adminToken, body: {} })).status, 201);
    assert.equal((await request(`/api/admin/invitations/${encodeURIComponent(summary.data.batch.id)}/claim`, { method: 'POST', token: adminToken, body: {} })).status, 201);
    const exhausted = await request(`/api/admin/invitations/${encodeURIComponent(summary.data.batch.id)}/claim`, { method: 'POST', token: adminToken, body: {} });
    assert.equal(exhausted.status, 409);
    assert.equal(exhausted.data?.code, 'INVITATION_DAILY_QUOTA_EXHAUSTED');
  });

  it('consumes a claimed code exactly once during invitation registration', async () => {
    const row = await db.prepare(`SELECT p.id, p.code_hash FROM pilot_invitations p
      JOIN pilot_invitation_claims c ON c.invitation_id = p.id
      WHERE p.status = 'active' ORDER BY p.created_at ASC LIMIT 1`).get();
    assert.ok(row);
    process.env.PILOT_REGISTRATION_MODE = 'invitation';
    const created = await request('/api/auth/register', {
      method: 'POST',
      body: { phone: '13800138901', invitationCode: claimedCode, password: 'Student123', agreementVersion: '2026-07' }
    });
    assert.equal(created.status, 201);
    assert.notEqual(row.code_hash, claimedCode);
    const consumed = await db.prepare('SELECT status, used_user_id FROM pilot_invitations WHERE id = ?').get(row.id);
    assert.equal(consumed.status, 'consumed');
    assert.equal(consumed.used_user_id, created.data.user.id);
    const summary = await request('/api/admin/invitations/summary', { token: adminToken });
    assert.equal(summary.status, 200);
    assert.equal(summary.data.registrations.count, 1);
    assert.equal(summary.data.registrations.items[0].phone, '138****8901');
    assert.doesNotMatch(JSON.stringify(summary.data.registrations), /13800138901/);
    const listed = await request('/api/admin/invitations?status=consumed', { token: adminToken });
    assert.equal(listed.status, 200);
    assert.equal(listed.data.invitations[0].usedPhone, '138****8901');
    assert.doesNotMatch(JSON.stringify(listed.data), /13800138901/);
    const reused = await request('/api/auth/register', {
      method: 'POST',
      body: { phone: '13800138902', invitationCode: claimedCode, password: 'Student123', agreementVersion: '2026-07' }
    });
    assert.equal(reused.status, 403);
    assert.equal(reused.data.code, 'INVALID_INVITATION_CODE');
    process.env.PILOT_REGISTRATION_MODE = 'sms';
  });

  it('allows editing an unused invitation expiry and revoking it through either delete route', async () => {
    const date = '2099-03-01';
    const saved = await request('/api/admin/invitations/settings', {
      method: 'PUT', token: adminToken,
      body: { dailyQuota: 2, autoIssue: true, expiresAfterDays: 30, businessDate: date }
    });
    assert.equal(saved.status, 200);
    const issued = await request(`/api/admin/invitations/batches/${date}/issue`, {
      method: 'POST', token: adminToken, body: { count: 2 }
    });
    assert.equal(issued.status, 201);
    const [first, second] = issued.data.invitations;
    const updatedExpiry = '2099-04-01T00:00:00.000Z';
    const updated = await request(`/api/admin/invitations/${encodeURIComponent(first.id)}`, {
      method: 'PATCH', token: adminToken, body: { expiresAt: updatedExpiry }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.invitation.expiresAt, updatedExpiry);

    const revoked = await request(`/api/admin/invitations/${encodeURIComponent(second.id)}`, {
      method: 'DELETE', token: adminToken
    });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.data.revoked, true);
    const listed = await request(`/api/admin/invitations?date=${date}`, { token: adminToken });
    assert.equal(listed.status, 200);
    const firstListed = listed.data.invitations.find((item) => item.id === first.id);
    const secondListed = listed.data.invitations.find((item) => item.id === second.id);
    assert.equal(firstListed.expiresAt, updatedExpiry);
    assert.equal(secondListed.status, 'revoked');
    assert.equal(Object.hasOwn(firstListed, 'code'), false);
    assert.equal(Object.hasOwn(secondListed, 'code'), false);
  });

  it('does not oversubscribe a batch under concurrent claims', async () => {
    const saved = await request('/api/admin/invitations/settings', {
      method: 'PUT', token: adminToken,
      body: { dailyQuota: 5, autoIssue: true }
    });
    const batchId = saved.data.batch.id;
    const results = await Promise.all(Array.from({ length: 5 }, () => request(`/api/admin/invitations/${encodeURIComponent(batchId)}/claim`, { method: 'POST', token: adminToken, body: {} })));
    assert.equal(results.filter((result) => result.status === 201).length, 2);
    assert.equal(results.filter((result) => result.status === 409).length, 3);
    assert.equal(results.some((result) => result.status >= 500), false);
    const batch = await db.prepare('SELECT issued_count, daily_quota FROM pilot_invitation_batches WHERE id = ?').get(batchId);
    assert.equal(Number(batch.issued_count), Number(batch.daily_quota));
  });

  it('reclaims expired claims without making the old plaintext usable', async () => {
    const date = '2099-01-01';
    const saved = await request('/api/admin/invitations/settings', {
      method: 'PUT', token: adminToken,
      body: { dailyQuota: 1, autoIssue: true, businessDate: date }
    });
    const claimed = await request(`/api/admin/invitations/${encodeURIComponent(saved.data.batch.id)}/claim`, {
      method: 'POST', token: adminToken, body: {}
    });
    assert.equal(claimed.status, 201);
    const expiredCode = claimed.data.invitation.code;
    await db.prepare('UPDATE pilot_invitation_claims SET claim_expires_at = ?, updated_at = ? WHERE invitation_id = ?')
      .run('2000-01-01T00:00:00.000Z', new Date().toISOString(), claimed.data.invitation.id);

    const summary = await request(`/api/admin/invitations/summary?date=${date}`, { token: adminToken });
    assert.equal(summary.status, 200);
    assert.equal(summary.data.counts.expired, 1);
    assert.equal(summary.data.counts.remainingQuota, 1);
    const expiredList = await request(`/api/admin/invitations?date=${date}&batchId=${encodeURIComponent(saved.data.batch.id)}&status=expired`, { token: adminToken });
    assert.equal(expiredList.status, 200);
    assert.equal(expiredList.data.invitations.length, 1);

    process.env.PILOT_REGISTRATION_MODE = 'invitation';
    const rejected = await request('/api/auth/register', {
      method: 'POST',
      body: { phone: '13800138903', invitationCode: expiredCode, password: 'Student123', agreementVersion: '2026-07' }
    });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.data.code, 'INVALID_INVITATION_CODE');
    process.env.PILOT_REGISTRATION_MODE = 'sms';

    const replacement = await request(`/api/admin/invitations/${encodeURIComponent(saved.data.batch.id)}/claim`, {
      method: 'POST', token: adminToken, body: {}
    });
    assert.equal(replacement.status, 201);
    assert.notEqual(replacement.data.invitation.code, expiredCode);
  });

  it('does not allow a student to access management statistics', async () => {
    const student = await request('/api/auth/register', {
      method: 'POST', body: { username: 'invitation-student', password: 'Student123', nickname: 'Invitation student' }
    });
    assert.equal(student.status, 201);
    const result = await request('/api/admin/invitations/summary', { token: student.data.token });
    assert.equal(result.status, 403);
  });

  it('keeps invitation statistics and records isolated by tenant', async () => {
    const defaultSummary = await request('/api/admin/invitations/summary', { token: adminToken });
    const defaultList = await request(`/api/admin/invitations?batchId=${encodeURIComponent(defaultSummary.data.batch.id)}`, { token: adminToken });
    assert.equal(defaultList.status, 200);
    assert.ok(defaultList.data.invitations.length > 0);

    const otherTenant = 'tenant-invitation-test';
    await db.prepare(`INSERT INTO tenants (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`).run(otherTenant, 'Invitation isolation test', new Date().toISOString(), new Date().toISOString());
    const adminUser = await db.prepare('SELECT id FROM users WHERE username = ?').get('invitation-admin');
    await db.prepare('UPDATE users SET tenant_id = ? WHERE id = ?').run(otherTenant, adminUser.id);
    try {
      const isolatedList = await request(`/api/admin/invitations?batchId=${encodeURIComponent(defaultSummary.data.batch.id)}`, { token: adminToken });
      assert.equal(isolatedList.status, 200);
      assert.equal(isolatedList.data.invitations.length, 0);
      const isolatedSummary = await request('/api/admin/invitations/summary', { token: adminToken });
      assert.equal(isolatedSummary.status, 200);
      assert.equal(isolatedSummary.data.registrations.count, 0);
    } finally {
      await db.prepare('UPDATE users SET tenant_id = ? WHERE id = ?').run('default', adminUser.id);
    }
  });

  it('validates the configured issue time', async () => {
    const invalid = await request('/api/admin/invitations/settings', {
      method: 'PUT', token: adminToken, body: { dailyQuota: 1, issueTime: '25:90' }
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.data.code, 'INVALID_INVITATION_ISSUE_TIME');
  });

  it('shows issuance timestamps and stops only future issuance for a batch', async () => {
    const date = '2099-05-01';
    const saved = await request('/api/admin/invitations/settings', {
      method: 'PUT', token: adminToken,
      body: { dailyQuota: 2, autoIssue: true, businessDate: date }
    });
    const issued = await request(`/api/admin/invitations/batches/${date}/issue`, {
      method: 'POST', token: adminToken, body: { count: 1 }
    });
    assert.equal(issued.status, 201);
    const listed = await request(`/api/admin/invitations?date=${date}`, { token: adminToken });
    assert.equal(listed.status, 200);
    assert.equal(listed.data.invitations[0].businessDate, date);
    assert.ok(listed.data.invitations[0].createdAt);
    const closed = await request(`/api/admin/invitations/batches/${encodeURIComponent(saved.data.batch.id)}/close`, {
      method: 'POST', token: adminToken, body: {}
    });
    assert.equal(closed.status, 200);
    assert.equal(closed.data.batch.status, 'closed');
    const blocked = await request(`/api/admin/invitations/batches/${date}/issue`, {
      method: 'POST', token: adminToken, body: { count: 1 }
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.code, 'INVITATION_BATCH_NOT_ACTIVE');
  });

});
