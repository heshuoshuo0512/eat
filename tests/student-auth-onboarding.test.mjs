import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { phoneLookupHash } from '../server/security.js';

let baseUrl;
let db;
let server;
let originalNodeEnv;
let originalSmsTestCode;

async function request(path, { method = 'POST', body, token, ip = '203.0.113.1' } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    status: response.status,
    data: await response.json().catch(() => null)
  };
}

async function issueCode(phone, purpose, ip) {
  const response = await request('/api/auth/verification-codes', {
    body: { phone, purpose },
    ip
  });
  assert.equal(response.status, 202);
  assert.equal(response.data.testCode, '246810');
  return response.data.testCode;
}

async function register(phone, ip, overrides = {}) {
  const verificationCode = await issueCode(phone, 'register', ip);
  return request('/api/auth/register', {
    body: {
      phone,
      verificationCode,
      password: 'Student123',
      nickname: 'New student',
      agreementVersion: '2026-07',
      ...overrides
    },
    ip
  });
}

describe('student phone authentication and onboarding', { concurrency: false }, () => {
  before(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalSmsTestCode = process.env.SMS_TEST_CODE;
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
    if (originalSmsTestCode === undefined) delete process.env.SMS_TEST_CODE;
    else process.env.SMS_TEST_CODE = originalSmsTestCode;
  });

  it('registers a masked phone student with a pending neutral profile', async () => {
    const phone = '13800138101';
    const verificationCode = await issueCode(phone, 'register', '203.0.113.11');

    const weak = await request('/api/auth/register', {
      body: { phone, verificationCode, password: '12345678', agreementVersion: '2026-07' },
      ip: '203.0.113.11'
    });
    assert.equal(weak.status, 400);
    assert.equal(weak.data.code, 'INVALID_PASSWORD');

    const created = await request('/api/auth/register', {
      body: { phone, verificationCode, password: 'Student123', nickname: 'Phone student', agreementVersion: '2026-07' },
      ip: '203.0.113.11'
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.user.role, 'student');
    assert.equal(created.data.user.maskedPhone, '138****8101');
    assert.equal(created.data.user.phoneVerified, true);
    assert.equal(created.data.state.profile.onboardingStatus, 'pending');
    assert.equal(created.data.state.profile.allergyStatus, 'unknown');
    assert.equal(created.data.state.profile.spiceLevel, 0);
    assert.doesNotMatch(JSON.stringify(created.data), new RegExp(phone));

    const duplicate = await request('/api/auth/register', {
      body: { phone, verificationCode, password: 'Student123', agreementVersion: '2026-07' },
      ip: '203.0.113.11'
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.data.code, 'PHONE_ALREADY_REGISTERED');
  });

  it('expires codes, enforces resend delay, and stops after five failed checks', async () => {
    const expiringPhone = '13800138102';
    await issueCode(expiringPhone, 'register', '203.0.113.12');
    const expiring = await db.prepare('SELECT id FROM auth_verification_codes WHERE phone_hash = ? ORDER BY created_at DESC LIMIT 1').get(phoneLookupHash(expiringPhone));
    await db.prepare('UPDATE auth_verification_codes SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', expiring.id);
    const expired = await request('/api/auth/register', {
      body: { phone: expiringPhone, verificationCode: '246810', password: 'Student123', agreementVersion: '2026-07' },
      ip: '203.0.113.12'
    });
    assert.equal(expired.status, 400);
    assert.equal(expired.data.code, 'VERIFICATION_CODE_EXPIRED');

    const lockedPhone = '13800138103';
    await issueCode(lockedPhone, 'register', '203.0.113.13');
    const resend = await request('/api/auth/verification-codes', {
      body: { phone: lockedPhone, purpose: 'register' },
      ip: '203.0.113.13'
    });
    assert.equal(resend.status, 429);
    assert.equal(resend.data.code, 'CODE_RESEND_TOO_SOON');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await request('/api/auth/register', {
        body: { phone: lockedPhone, verificationCode: '000000', password: 'Student123', agreementVersion: '2026-07' },
        ip: '203.0.113.13'
      });
      assert.equal(failed.status, 400);
      assert.equal(failed.data.code, 'INVALID_VERIFICATION_CODE');
    }
    const row = await db.prepare('SELECT attempts, consumed_at FROM auth_verification_codes WHERE phone_hash = ? ORDER BY created_at DESC LIMIT 1').get(phoneLookupHash(lockedPhone));
    assert.equal(row.attempts, 5);
    assert.ok(row.consumed_at);
    const afterLimit = await request('/api/auth/register', {
      body: { phone: lockedPhone, verificationCode: '246810', password: 'Student123', agreementVersion: '2026-07' },
      ip: '203.0.113.13'
    });
    assert.equal(afterLimit.status, 400);
    assert.equal(afterLimit.data.code, 'VERIFICATION_CODE_EXPIRED');
  });

  it('limits verification-code sends to five per phone and IP each hour', async () => {
    const createdAt = new Date(Date.now() - 2 * 60_000).toISOString();
    const expiresAt = new Date(Date.now() + 3 * 60_000).toISOString();
    const insert = db.prepare('INSERT INTO auth_verification_codes (id, tenant_id, phone_hash, purpose, code_hash, requested_ip, attempts, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const phone = '13800138106';
    for (let index = 0; index < 5; index += 1) {
      await insert.run(`phone-limit-${index}`, 'default', phoneLookupHash(phone), 'reset_password', 'unused:hash', `203.0.113.${30 + index}`, 0, expiresAt, createdAt, createdAt);
      await insert.run(`ip-limit-${index}`, 'default', `unrelated-phone-${index}`, 'register', 'unused:hash', '203.0.113.60', 0, expiresAt, createdAt, createdAt);
    }

    const phoneLimited = await request('/api/auth/verification-codes', {
      body: { phone, purpose: 'register' },
      ip: '203.0.113.61'
    });
    assert.equal(phoneLimited.status, 429);
    assert.equal(phoneLimited.data.code, 'CODE_RATE_LIMITED');

    const ipLimited = await request('/api/auth/verification-codes', {
      body: { phone: '13800138107', purpose: 'register' },
      ip: '203.0.113.60'
    });
    assert.equal(ipLimited.status, 429);
    assert.equal(ipLimited.data.code, 'CODE_RATE_LIMITED');
  });

  it('does not expose a test code when production has no SMS provider', async () => {
    delete process.env.SMS_TEST_CODE;
    process.env.NODE_ENV = 'production';
    try {
      const unavailable = await request('/api/auth/verification-codes', {
        body: { phone: '13800138108', purpose: 'register' },
        ip: '203.0.113.68'
      });
      assert.equal(unavailable.status, 503);
      assert.equal(unavailable.data.code, 'SMS_PROVIDER_NOT_CONFIGURED');
      assert.equal('testCode' in unavailable.data, false);
    } finally {
      process.env.NODE_ENV = 'test';
      process.env.SMS_TEST_CODE = '246810';
    }
  });

  it('invalidates existing JWTs after password reset and prevents code replay', async () => {
    const phone = '13800138104';
    const created = await register(phone, '203.0.113.14');
    assert.equal(created.status, 201);
    const oldToken = created.data.token;

    const deferred = await request('/api/health/profile/onboarding', {
      method: 'PATCH',
      body: { status: 'deferred' },
      token: oldToken,
      ip: '203.0.113.14'
    });
    assert.equal(deferred.status, 200);

    const resetCode = await issueCode(phone, 'reset_password', '203.0.113.14');
    const reset = await request('/api/auth/password/reset', {
      body: { phone, verificationCode: resetCode, newPassword: 'Changed123' },
      ip: '203.0.113.14'
    });
    assert.equal(reset.status, 200);

    const oldTokenResult = await request('/api/health/profile/onboarding', {
      method: 'PATCH',
      body: { status: 'deferred' },
      token: oldToken,
      ip: '203.0.113.14'
    });
    assert.equal(oldTokenResult.status, 401);

    const oldPassword = await request('/api/auth/login', { body: { identifier: phone, password: 'Student123' }, ip: '203.0.113.14' });
    assert.equal(oldPassword.status, 401);
    const newPassword = await request('/api/auth/login', { body: { identifier: phone, password: 'Changed123' }, ip: '203.0.113.14' });
    assert.equal(newPassword.status, 200);

    const replay = await request('/api/auth/password/reset', {
      body: { phone, verificationCode: resetCode, newPassword: 'Another123' },
      ip: '203.0.113.14'
    });
    assert.equal(replay.status, 400);
    assert.equal(replay.data.code, 'VERIFICATION_CODE_EXPIRED');
  });

  it('allows only one concurrent registration to consume a verification code', async () => {
    const phone = '13800138109';
    const verificationCode = await issueCode(phone, 'register', '203.0.113.69');
    const body = {
      phone,
      verificationCode,
      password: 'Student123',
      agreementVersion: '2026-07'
    };

    const responses = await Promise.all([
      request('/api/auth/register', { body, ip: '203.0.113.69' }),
      request('/api/auth/register', { body, ip: '203.0.113.70' })
    ]);
    const statuses = responses.map((response) => response.status);
    assert.equal(statuses.filter((status) => status === 201).length, 1);
    const rejected = responses.find((response) => response.status !== 201);
    assert.ok([400, 409].includes(rejected?.status));
    assert.ok(['VERIFICATION_CODE_EXPIRED', 'PHONE_ALREADY_REGISTERED'].includes(rejected?.data.code));
    const users = await db.prepare('SELECT COUNT(*) AS count FROM users WHERE phone_hash = ?').get(phoneLookupHash(phone));
    assert.equal(users.count, 1);
  });

  it('defers onboarding once and completes only a valid safety profile', async () => {
    const created = await register('13800138105', '203.0.113.15');
    assert.equal(created.status, 201);
    const token = created.data.token;

    const deferred = await request('/api/health/profile/onboarding', {
      method: 'PATCH', body: { status: 'deferred' }, token, ip: '203.0.113.15'
    });
    assert.equal(deferred.status, 200);
    assert.equal(deferred.data.profile.onboardingStatus, 'deferred');
    const deferredAgain = await request('/api/health/profile/onboarding', {
      method: 'PATCH', body: { status: 'deferred' }, token, ip: '203.0.113.15'
    });
    assert.equal(deferredAgain.status, 200);
    assert.equal(deferredAgain.data.profile.onboardingStatus, 'deferred');

    const missingSafety = await request('/api/health/profile', {
      method: 'PUT', body: { budgetMax: 35 }, token, ip: '203.0.113.15'
    });
    assert.equal(missingSafety.status, 400);
    assert.equal(missingSafety.data.code, 'ALLERGY_STATUS_REQUIRED');

    const missingAllergen = await request('/api/health/profile', {
      method: 'PUT', body: { allergyStatus: 'declared', allergies: [], budgetMax: 35 }, token, ip: '203.0.113.15'
    });
    assert.equal(missingAllergen.status, 400);
    assert.equal(missingAllergen.data.code, 'ALLERGEN_REQUIRED');

    const completed = await request('/api/health/profile', {
      method: 'PUT',
      token,
      ip: '203.0.113.15',
      body: {
        allergyStatus: 'none',
        allergies: ['should be cleared'],
        avoid: ['cilantro'],
        budgetMax: 35,
        goal: 'healthy',
        mealType: 'lunch',
        taste: '不限',
        halalOnly: false,
        dietaryPattern: 'unrestricted',
        spiceLevel: 0,
        nutritionFocus: [],
        preferLowCrowd: false,
        favoriteTags: []
      }
    });
    assert.equal(completed.status, 200);
    assert.equal(completed.data.profile.onboardingStatus, 'completed');
    assert.equal(completed.data.profile.allergyStatus, 'none');
    assert.deepEqual(completed.data.profile.allergies, []);
    assert.deepEqual(completed.data.profile.avoid, ['cilantro']);

    const cannotDowngrade = await request('/api/health/profile/onboarding', {
      method: 'PATCH', body: { status: 'deferred' }, token, ip: '203.0.113.15'
    });
    assert.equal(cannotDowngrade.status, 200);
    assert.equal(cannotDowngrade.data.profile.onboardingStatus, 'completed');
  });
});
