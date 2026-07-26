import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { createRefreshToken, createToken, refreshTokenTenant } from '../server/security.js';

let db;
let server;
let baseUrl;
let originalNodeEnv;
let originalSmsCode;

async function request(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '203.0.113.90',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function register(phone) {
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
      agreementVersion: '2026-07'
    }
  });
}

describe('rotating authentication sessions', { concurrency: false }, () => {
  before(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalSmsCode = process.env.SMS_TEST_CODE;
    process.env.NODE_ENV = 'test';
    process.env.SMS_TEST_CODE = '246810';
    db = openDatabase(':memory:');
    server = createServer(createApp({ db }).handler);
    server.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalSmsCode === undefined) delete process.env.SMS_TEST_CODE;
    else process.env.SMS_TEST_CODE = originalSmsCode;
  });

  it('returns compatible access fields and rotates the refresh token', async () => {
    const created = await register('13800138201');
    assert.equal(created.status, 201);
    assert.equal(created.data.token, created.data.accessToken);
    assert.equal(created.data.expiresIn, 900);
    assert.match(created.data.refreshToken, /^sc_rt_/);

    const beforeRefresh = await request('/api/orders', { token: created.data.accessToken });
    assert.equal(beforeRefresh.status, 200);

    const refreshed = await request('/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: created.data.refreshToken }
    });
    assert.equal(refreshed.status, 200);
    assert.notEqual(refreshed.data.refreshToken, created.data.refreshToken);
    assert.notEqual(refreshed.data.accessToken, created.data.accessToken);
    assert.equal((await request('/api/orders', { token: refreshed.data.accessToken })).status, 200);
  });

  it('parses current and legacy refresh tokens without consuming random separators', () => {
    for (let index = 0; index < 500; index += 1) {
      const token = createRefreshToken('tenant-cn-01');
      assert.match(token, /^sc_rt_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      assert.equal(refreshTokenTenant(token), 'tenant-cn-01');
    }
    const legacyTenant = Buffer.from('default').toString('base64url');
    assert.equal(refreshTokenTenant(`sc_rt_${legacyTenant}_random_part_with_underscores`), 'default');
    assert.equal(refreshTokenTenant(createRefreshToken('测试校区-01')), '测试校区-01');
  });

  it('revokes the whole family when a rotated token is replayed', async () => {
    const created = await register('13800138202');
    const firstRefresh = await request('/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: created.data.refreshToken }
    });
    assert.equal(firstRefresh.status, 200);

    const replay = await request('/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: created.data.refreshToken }
    });
    assert.equal(replay.status, 401);
    assert.equal(replay.data.code, 'REFRESH_TOKEN_REUSED');
    assert.equal((await request('/api/orders', { token: firstRefresh.data.accessToken })).status, 401);
    assert.equal((await request('/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: firstRefresh.data.refreshToken }
    })).status, 401);
  });

  it('supports current-session and all-device logout', async () => {
    const created = await register('13800138203');
    const secondLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { identifier: '13800138203', password: 'Student123' }
    });
    assert.equal(secondLogin.status, 200);

    const logout = await request('/api/auth/logout', {
      method: 'POST',
      token: created.data.accessToken,
      body: { refreshToken: created.data.refreshToken }
    });
    assert.equal(logout.status, 200);
    assert.equal((await request('/api/orders', { token: created.data.accessToken })).status, 401);
    assert.equal((await request('/api/orders', { token: secondLogin.data.accessToken })).status, 200);

    const logoutAll = await request('/api/auth/logout-all', {
      method: 'POST',
      token: secondLogin.data.accessToken,
      body: {}
    });
    assert.equal(logoutAll.status, 200);
    assert.equal((await request('/api/orders', { token: secondLogin.data.accessToken })).status, 401);
  });

  it('rejects stateless legacy tokens in production unless explicitly enabled', async () => {
    const user = await db.prepare("SELECT * FROM users WHERE role = 'student' LIMIT 1").get();
    const legacyToken = createToken(user);
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_LEGACY_STATELESS_TOKENS;
    try {
      assert.equal((await request('/api/orders', { token: legacyToken })).status, 401);
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });
});
