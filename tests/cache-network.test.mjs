import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCache, rankingCacheKey } from '../server/cache.js';
import { addressInCidr, clientIpFromRequest } from '../server/network.js';

const originalRedisUrl = process.env.REDIS_URL;

afterEach(() => {
  if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = originalRedisUrl;
});

describe('cache primitives', () => {
  it('supports atomic counters and token-checked leases in memory fallback', async () => {
    delete process.env.REDIS_URL;
    const cache = createCache();
    assert.equal(await cache.increment('rate:test', 5000), 1);
    assert.equal(await cache.increment('rate:test', 5000), 2);
    assert.equal(await cache.setIfAbsent('lease:test', 'owner-a', 5000), true);
    assert.equal(await cache.setIfAbsent('lease:test', 'owner-b', 5000), false);
    assert.equal(await cache.deleteIfValue('lease:test', 'owner-b'), false);
    assert.equal(await cache.deleteIfValue('lease:test', 'owner-a'), true);
    assert.equal(await cache.get('lease:test'), null);
    assert.deepEqual(await cache.status(), { ok: true, backend: 'memory', distributed: false, degraded: false });
  });

  it('builds tenant, date and meal-specific ranking keys', () => {
    assert.equal(
      rankingCacheKey({ tenantId: 'tenant-a', date: '2026-07-26', mealType: 'lunch' }),
      'sc:v1:tenant-a:ranking:2026-07-26:lunch'
    );
    assert.notEqual(
      rankingCacheKey({ tenantId: 'tenant-a' }),
      rankingCacheKey({ tenantId: 'tenant-b' })
    );
  });
});

describe('trusted proxy client IP parsing', () => {
  it('supports IPv4 and IPv6 CIDR matching', () => {
    assert.equal(addressInCidr('127.0.0.9', '127.0.0.0/8'), true);
    assert.equal(addressInCidr('10.2.3.4', '10.0.0.0/8'), true);
    assert.equal(addressInCidr('192.168.1.1', '10.0.0.0/8'), false);
    assert.equal(addressInCidr('::1', '::1/128'), true);
    assert.equal(addressInCidr('2001:db8::10', '2001:db8::/32'), true);
  });

  it('uses forwarded addresses only behind configured trusted proxies', () => {
    const trustedRequest = {
      headers: { 'x-forwarded-for': '198.51.100.10, 10.0.0.2' },
      socket: { remoteAddress: '127.0.0.1' }
    };
    assert.equal(clientIpFromRequest(trustedRequest, ['127.0.0.0/8', '10.0.0.0/8']), '198.51.100.10');

    const untrustedRequest = {
      headers: { 'x-forwarded-for': '198.51.100.10' },
      socket: { remoteAddress: '203.0.113.20' }
    };
    assert.equal(clientIpFromRequest(untrustedRequest, ['127.0.0.0/8']), '203.0.113.20');
  });
});
