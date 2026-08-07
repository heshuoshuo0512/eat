import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { phoneLookupHash } from '../server/security.js';

const ENV_KEYS = [
  'NODE_ENV',
  'SMS_TEST_CODE',
  'SMS_PROVIDER',
  'PILOT_MODE',
  'PILOT_DISABLED_FEATURES',
  'PILOT_ENABLED_FEATURES',
  'PILOT_ALLOWED_PHONE_HASHES'
];

let originals;
let db;
let server;
let baseUrl;

async function request(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    status: response.status,
    headers: response.headers,
    data: await response.json().catch(() => ({}))
  };
}

async function register(phone, agreementVersion = '2026-07') {
  const code = await request('/api/auth/verification-codes', {
    method: 'POST',
    body: { phone, purpose: 'register' }
  });
  assert.equal(code.status, 202);
  return request('/api/auth/register', {
    method: 'POST',
    body: {
      phone,
      verificationCode: code.data.testCode,
      password: 'Student123',
      agreementVersion
    }
  });
}

describe('closed pilot and self-service account controls', { concurrency: false }, () => {
  before(() => {
    originals = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    process.env.NODE_ENV = 'test';
    process.env.SMS_TEST_CODE = '246810';
    process.env.SMS_PROVIDER = 'disabled';
    process.env.PILOT_MODE = 'open';
    process.env.PILOT_DISABLED_FEATURES = '';
    process.env.PILOT_ENABLED_FEATURES = '';
    db = openDatabase(':memory:');
    server = createServer(createApp({ db }).handler);
    server.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const key of ENV_KEYS) {
      if (originals[key] === undefined) delete process.env[key];
      else process.env[key] = originals[key];
    }
  });

  it('requires the exact current agreement version for phone registration', async () => {
    const result = await register('13800138301', '2026-06');
    assert.equal(result.status, 409);
    assert.equal(result.data.code, 'AGREEMENT_VERSION_OUTDATED');
  });

  it('closes registration and community writes in team pilot mode', async () => {
    const existing = await register('13800138302');
    assert.equal(existing.status, 201);
    process.env.PILOT_MODE = 'team';

    const registration = await request('/api/auth/verification-codes', {
      method: 'POST',
      body: { phone: '13800138303', purpose: 'register' }
    });
    assert.equal(registration.status, 403);
    assert.equal(registration.data.code, 'PILOT_REGISTRATION_CLOSED');

    const post = await request('/api/posts', {
      method: 'POST',
      token: existing.data.accessToken,
      body: {}
    });
    assert.equal(post.status, 403);
    assert.equal(post.data.code, 'PILOT_FEATURE_DISABLED');
    process.env.PILOT_ENABLED_FEATURES = 'community_write';
    const enabledPost = await request('/api/posts', {
      method: 'POST',
      token: existing.data.accessToken,
      body: {}
    });
    assert.notEqual(enabledPost.data.code, 'PILOT_FEATURE_DISABLED');
    assert.notEqual(enabledPost.status, 403);
    process.env.PILOT_ENABLED_FEATURES = '';
    process.env.PILOT_MODE = 'open';
  });

  it('accepts only hashed invite-list phone numbers in invite mode', async () => {
    const invitedPhone = '13800138306';
    process.env.PILOT_MODE = 'invite';
    process.env.PILOT_ALLOWED_PHONE_HASHES = phoneLookupHash(invitedPhone);

    const invited = await register(invitedPhone);
    assert.equal(invited.status, 201);
    const rejected = await request('/api/auth/verification-codes', {
      method: 'POST',
      body: { phone: '13800138307', purpose: 'register' }
    });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.data.code, 'PILOT_INVITATION_REQUIRED');
    process.env.PILOT_MODE = 'open';
    process.env.PILOT_ALLOWED_PHONE_HASHES = '';
  });

  it('does not honour SMS_TEST_CODE outside the test environment', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PILOT_MODE = 'open';
    process.env.SMS_TEST_CODE = '246810';
    process.env.SMS_PROVIDER = 'disabled';
    const result = await request('/api/auth/verification-codes', {
      method: 'POST',
      body: { phone: '13800138304', purpose: 'register' }
    });
    assert.equal(result.status, 503);
    assert.equal(result.data.code, 'SMS_PROVIDER_NOT_CONFIGURED');
    process.env.NODE_ENV = 'test';
    process.env.SMS_PROVIDER = 'disabled';
  });

  it('exports only the signed-in account data and deletes a verified student account', async () => {
    const created = await register('13800138305');
    assert.equal(created.status, 201);
    const token = created.data.accessToken;

    const exported = await request('/api/account/export', { token });
    assert.equal(exported.status, 200);
    assert.equal(exported.headers.get('content-disposition'), 'attachment; filename="smart-canteen-account-export.json"');
    assert.equal(exported.data.account.phone, '13800138305');
    assert.equal(exported.data.account.agreementVersion, '2026-07');

    const deletionCode = await request('/api/auth/verification-codes', {
      method: 'POST',
      body: { phone: '13800138305', purpose: 'delete_account' }
    });
    assert.equal(deletionCode.status, 202);

    const deleted = await request('/api/account', {
      method: 'DELETE',
      token,
      body: {
        confirmation: 'DELETE_MY_ACCOUNT',
        phone: '13800138305',
        verificationCode: deletionCode.data.testCode
      }
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.data.deleted, true);
    assert.equal((await request('/api/orders', { token })).status, 401);
    assert.equal(await db.prepare('SELECT id FROM users WHERE id = ?').get(created.data.user.id), undefined);
  });
});
