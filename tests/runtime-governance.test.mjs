import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';

const originalRedisRequired = process.env.REDIS_REQUIRED;
const originalMetricsToken = process.env.INTERNAL_METRICS_TOKEN;

afterEach(() => {
  if (originalRedisRequired === undefined) delete process.env.REDIS_REQUIRED;
  else process.env.REDIS_REQUIRED = originalRedisRequired;
  if (originalMetricsToken === undefined) delete process.env.INTERNAL_METRICS_TOKEN;
  else process.env.INTERNAL_METRICS_TOKEN = originalMetricsToken;
});

function fakeCache(initialStatus) {
  const values = new Map();
  let statusValue = initialStatus;
  return {
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) { values.set(key, value); },
    async del(key) { return values.delete(key) ? 1 : 0; },
    async increment(key) {
      const value = Number(values.get(key) || 0) + 1;
      values.set(key, value);
      return value;
    },
    async status() { return statusValue; },
    setStatus(value) { statusValue = value; }
  };
}

async function withApp(cache, operation) {
  const app = createApp({ db: openDatabase(':memory:'), cache });
  const server = createServer(app.handler);
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    await operation(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    app.metrics.close();
  }
}

describe('runtime health and metrics governance', { concurrency: false }, () => {
  it('keeps liveness independent and rejects memory fallback when Redis is required', async () => {
    process.env.REDIS_REQUIRED = '1';
    const cache = fakeCache({ ok: true, backend: 'memory', distributed: false, degraded: true });
    await withApp(cache, async (baseUrl) => {
      const live = await fetch(`${baseUrl}/api/health/live`);
      assert.equal(live.status, 200);
      assert.equal((await live.json()).status, 'live');

      const degraded = await fetch(`${baseUrl}/api/health/ready`);
      assert.equal(degraded.status, 503);
      assert.equal((await degraded.json()).status, 'not_ready');

      cache.setStatus({ ok: true, backend: 'redis', distributed: true, degraded: false });
      const ready = await fetch(`${baseUrl}/api/health/ready`);
      assert.equal(ready.status, 200);
      assert.equal((await ready.json()).status, 'ready');
    });
  });

  it('protects internal metrics with the dedicated token or audit permission', async () => {
    process.env.INTERNAL_METRICS_TOKEN = 'runtime-metrics-test-token';
    const cache = fakeCache({ ok: true, backend: 'memory', distributed: false, degraded: false });
    await withApp(cache, async (baseUrl) => {
      const denied = await fetch(`${baseUrl}/api/internal/metrics`);
      assert.equal(denied.status, 401);

      const allowed = await fetch(`${baseUrl}/api/internal/metrics`, {
        headers: { 'X-Internal-Token': 'runtime-metrics-test-token' }
      });
      assert.equal(allowed.status, 200);
      const metrics = await allowed.json();
      assert.equal(typeof metrics.http.latencyMs.p95, 'number');
      assert.deepEqual(metrics.outbox, { pending: 0, processing: 0, dead: 0 });
    });
  });
});
