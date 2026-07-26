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
  it('compose stack separates role creation, migration, grants and runtime services', () => {
    const compose = readText('docker-compose.yml');
    for (const service of ['db-roles:', 'db-migrate:', 'db-grants:', 'api:', 'postgres:', 'redis:', 'minio:', 'minio-init:', 'nginx:']) {
      assert.match(compose, new RegExp(`\\n  ${service}`));
    }
    assert.match(compose, /SMART_CANTEEN_SECRET: \$\{SMART_CANTEEN_SECRET:\?set SMART_CANTEEN_SECRET in \.env\}/);
    assert.match(compose, /DATABASE_MIGRATION_URL: \$\{DOCKER_DATABASE_MIGRATION_URL:/);
    assert.match(compose, /DATABASE_URL: \$\{DOCKER_DATABASE_URL:/);
    assert.match(compose, /DATABASE_WORKER_URL: \$\{DOCKER_DATABASE_WORKER_URL:/);
    assert.match(compose, /DB_MIGRATE: 0/);
    assert.match(compose, /service_completed_successfully/);
    assert.match(compose, /\/api\/health\/ready/);
    assert.match(compose, /S3_BUCKET: \$\{S3_BUCKET:-\}/);
    assert.match(compose, /condition: service_healthy/);
    assert.doesNotMatch(compose, /container_name:/);
    assert.match(compose, /POSTGRES_PORT:-55432/);
    assert.match(compose, /WEB_PORT:-8080/);
    const apiService = compose.slice(compose.indexOf('\n  api:'), compose.indexOf('\n  postgres:'));
    assert.doesNotMatch(apiService, /DATABASE_MIGRATION_URL/);
  });

  it('provides an explicit existing-database ownership handoff', () => {
    const script = readText('scripts/reassign-postgres-owner.sql');
    assert.match(script, /legacy_owner is required/);
    assert.match(script, /REASSIGN OWNED BY :"legacy_owner" TO smart_canteen_migrator/);
  });

  it('packages both retrieval knowledge bases in the runtime image', () => {
    const dockerfile = readText('Dockerfile');
    assert.match(dockerfile, /COPY data\/health-knowledge-bases \.\/knowledge\/health-knowledge-bases/);
    assert.match(dockerfile, /COPY data\/campus-dining-knowledge \.\/data\/campus-dining-knowledge/);
  });

  it('environment template documents production secrets and storage switches', () => {
    const env = readText('.env.example');
    for (const key of [
      'SMART_CANTEEN_SECRET=', 'DB_DRIVER=postgres', 'DB_MIGRATE=0',
      'DATABASE_MIGRATION_URL=', 'DATABASE_URL=', 'DATABASE_WORKER_URL=',
      'PG_POOL_MAX=', 'REDIS_URL=', 'REDIS_REQUIRED=1', 'OUTBOX_WORKER_ENABLED=1',
      'TRUSTED_PROXY_CIDRS=', 'INTERNAL_METRICS_TOKEN=', 'UPLOAD_URL_TTL_SECONDS=',
      'S3_BUCKET=', 'S3_ENDPOINT=', 'AI_BASE_URL='
    ]) {
      assert.match(env, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('documents the role-separated RLS cutover and rollback order', () => {
    const runbook = readText('docs/后端架构与RLS部署手册-2026-07-26.md');
    for (const text of [
      'smart_canteen_migrator', 'smart_canteen_api', 'smart_canteen_worker',
      'scripts/create-postgres-roles.sql', 'scripts/migrate-postgres.mjs',
      'scripts/provision-postgres-roles.sql', 'npm run test:postgres-rls',
      '/api/health/ready', 'REDIS_REQUIRED=1', '回滚'
    ]) {
      assert.match(runbook, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
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

  it('OpenAPI documents rotating sessions, probes, metrics and private uploads', () => {
    const openapi = readText('openapi/smart-canteen.yaml');
    for (const text of [
      '/auth/refresh:', '/auth/logout:', '/auth/logout-all:', 'AuthSessionResponse:',
      '/health/live:', '/health/ready:', '/internal/metrics:', 'RuntimeMetrics:',
      '/uploads/{id}/content:', 'tenant_id/user_id/upload-uuid.ext', 'upload://upload-uuid',
      'Short-lived signed', 'private S3/MinIO bucket'
    ]) {
      assert.match(openapi, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.doesNotMatch(openapi, /PUBLIC_UPLOAD_BASE_URL|S3_PUBLIC_URL/);
  });

  it('does not expose the local private upload volume through Nginx', () => {
    const nginx = readText('nginx/nginx.conf');
    assert.doesNotMatch(nginx, /location \/uploads\//);
    assert.match(nginx, /location \/api\//);
  });

  it('README documents local and S3 upload storage contracts', () => {
    const readme = readText('README.md');
    for (const text of [
      'S3_BUCKET', 'UPLOAD_DIR', 'tenant_id/user_id/upload-uuid.ext', 'provider', 'storageKey',
      'upload://<id>', '/api/uploads/{id}/content', '均保持私有'
    ]) {
      assert.match(readme, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('CI workflow enforces tests build compose and docker gates', () => {
    const workflow = readText('.github/workflows/ci.yml');
    for (const text of ['npm ci', 'node --check server/app.js', 'node --check server/outbox.js', 'npm test', 'npm run build', 'docker compose config --quiet', 'docker build -t smart-canteen-ci .']) {
      assert.match(workflow, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(workflow, /AI_API_KEY: ''/);
    assert.match(workflow, /OPENAI_API_KEY: ''/);
    assert.match(workflow, /codex\/release-candidate-\*/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /npm run build:miniapp/);
    assert.match(workflow, /npm run test:postgres-rls/);
  });

  it('ships Docker-based k6 scenarios without a runtime dependency', () => {
    const runner = readText('scripts/run-k6.mjs');
    const scenario = readText('tests/performance/smart-canteen.js');
    assert.match(runner, /grafana\/k6:0\.54\.0/);
    for (const name of ['catalog', 'session', 'community', 'agent']) {
      assert.match(scenario, new RegExp(name));
    }
    assert.match(scenario, /http_req_failed/);
    assert.match(scenario, /http_req_duration/);
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

  it('echoes request id on ordinary successful API responses', async () => {
    const db = openDatabase(':memory:');
    const app = createApp({ db });
    const server = createServer(app.handler);
    await new Promise((resolve) => server.listen(0, resolve));
    try {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const res = await fetch(`${baseUrl}/api/canteens`, { headers: { 'X-Request-Id': 'trace-success-1' } });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-request-id'), 'trace-success-1');
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
