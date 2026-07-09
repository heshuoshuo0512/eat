import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { resolveRuntimeSecret } from '../server/security.js';

function readText(path) {
  return readFileSync(path, 'utf8');
}

describe('Deployment contract', () => {
  it('compose stack includes API, PostgreSQL, Redis, MinIO and Nginx health checks', () => {
    const compose = readText('docker-compose.yml');
    for (const service of ['api:', 'postgres:', 'redis:', 'minio:', 'nginx:']) {
      assert.match(compose, new RegExp(`\\n  ${service}`));
    }
    assert.match(compose, /SMART_CANTEEN_SECRET: \$\{SMART_CANTEEN_SECRET:\?set SMART_CANTEEN_SECRET in \.env\}/);
    assert.match(compose, /DB_MIGRATE: \$\{DB_MIGRATE:-1\}/);
    assert.match(compose, /S3_BUCKET: \$\{S3_BUCKET:-\}/);
    assert.match(compose, /condition: service_healthy/);
  });

  it('environment template documents production secrets and storage switches', () => {
    const env = readText('.env.example');
    for (const key of ['SMART_CANTEEN_SECRET=', 'DB_DRIVER=postgres', 'DB_MIGRATE=1', 'DATABASE_URL=', 'REDIS_URL=', 'S3_BUCKET=', 'S3_ENDPOINT=', 'AI_BASE_URL=']) {
      assert.match(env, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('production rejects missing, weak, or placeholder SMART_CANTEEN_SECRET', () => {
    assert.throws(() => resolveRuntimeSecret({ NODE_ENV: 'production' }), /SMART_CANTEEN_SECRET/);
    assert.throws(() => resolveRuntimeSecret({ NODE_ENV: 'production', SMART_CANTEEN_SECRET: 'short' }), /SMART_CANTEEN_SECRET/);
    assert.throws(() => resolveRuntimeSecret({ NODE_ENV: 'production', SMART_CANTEEN_SECRET: 'replace-with-at-least-32-random-bytes' }), /SMART_CANTEEN_SECRET/);
    assert.equal(resolveRuntimeSecret({ NODE_ENV: 'production', SMART_CANTEEN_SECRET: '12345678901234567890123456789012' }), '12345678901234567890123456789012');
  });

  it('OpenAPI documents tenant and menu operations plus dedicated AI permission', () => {
    const spec = readText('openapi/smart-canteen.yaml');
    for (const route of ['/admin/tenants:', '/admin/tenants/{id}:', '/admin/menus:', '/admin/menus/{id}:']) {
      assert.match(spec, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(spec, /Requires tenant:manage/);
    assert.match(spec, /Requires ai:configure/);
    assert.match(spec, /status=archived/);
  });

  it('OpenAPI documents latest menu supply and AI usage contracts', () => {
    const spec = readText('openapi/smart-canteen.yaml');
    for (const text of ['/menus/today:', '/admin/menus/batch:', '/admin/ai-usage:', 'AiUsageResponse:', 'AiQuota:', 'MenuBatchRequest:', 'MenuListResponse:']) {
      assert.match(spec, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(spec, /date, mealType, status, limit and offset/);
    assert.match(spec, /AI monthly quota exhausted/);
    assert.match(spec, /source\.menuSource/);
  });

  it('README documents today menu, menu hardening and AI quota operations', () => {
    const readme = readText('README.md');
    for (const text of ['/api/menus/today', '/api/admin/menus/batch', '/api/admin/ai-usage', 'AI 月额度', 'source=menu', 'source=fallback', '事务化校验食堂和菜品归属']) {
      assert.match(readme, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(readme, /返回 `429`/);
  });

  it('OpenAPI documents tenant-scoped upload storage metadata', () => {
    const openapi = readText('openapi/smart-canteen.yaml');
    for (const text of ['tenant_id/upload-uuid.ext', 'provider', 'storageKey', 'S3_BUCKET', 'S3/MinIO', 'PUBLIC_UPLOAD_BASE_URL', 'S3_PUBLIC_URL']) {
      assert.match(openapi, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('README documents local and S3 upload storage contracts', () => {
    const readme = readText('README.md');
    for (const text of ['S3_BUCKET', 'UPLOAD_DIR', 'tenant_id/upload-uuid.ext', 'provider', 'storageKey', 'signed URL', 'bucket 私有化']) {
      assert.match(readme, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('CI workflow enforces tests build compose and docker gates', () => {
    const workflow = readText('.github/workflows/ci.yml');
    for (const text of ['npm ci', 'node --check server/app.js', 'npm test', 'npm run build', 'docker compose config --quiet', 'docker build -t smart-canteen-ci .']) {
      assert.match(workflow, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(workflow, /AI_API_KEY: ''/);
    assert.match(workflow, /OPENAI_API_KEY: ''/);
  });

  it('README documents CI quality gate', () => {
    const readme = readText('README.md');
    for (const text of ['.github/workflows/ci.yml', 'npm ci', 'npm test', 'npm run build', 'docker compose config --quiet', 'docker build -t smart-canteen-ci .']) {
      assert.match(readme, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });
});

describe('Request tracing', () => {
  it('echoes request id on health responses', async () => {
    const db = openDatabase(':memory:');
    const app = createApp({ db });
    const server = createServer(app.handler);
    await new Promise((resolve) => server.listen(0, resolve));
    try {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const res = await fetch(`${baseUrl}/api/health`, { headers: { 'X-Request-Id': 'trace-test-1' } });
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.deepEqual(data, { ok: true });
      assert.equal(res.headers.get('x-request-id'), 'trace-test-1');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('includes request id on error payloads', async () => {
    const db = openDatabase(':memory:');
    const app = createApp({ db });
    const server = createServer(app.handler);
    await new Promise((resolve) => server.listen(0, resolve));
    try {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const res = await fetch(`${baseUrl}/api/missing`, { headers: { 'X-Request-Id': 'trace-error-1' } });
      const data = await res.json();
      assert.equal(res.status, 404);
      assert.equal(res.headers.get('x-request-id'), 'trace-error-1');
      assert.equal(data.requestId, 'trace-error-1');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
