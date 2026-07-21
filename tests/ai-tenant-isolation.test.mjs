import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { createToken } from '../server/security.js';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

function providerServer(requests, delayMs) {
  return createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({
      authorization: request.headers.authorization,
      path: request.url,
      body: JSON.parse(body || '{}'),
    });
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { tool_calls: [] } }] }));
  });
}

test('concurrent agent requests keep AI provider credentials tenant-scoped', async () => {
  const providerARequests = [];
  const providerBRequests = [];
  const providerA = providerServer(providerARequests, 35);
  const providerB = providerServer(providerBRequests, 5);
  const providerABaseUrl = `${await listen(providerA)}/v1`;
  const providerBBaseUrl = `${await listen(providerB)}/v1`;
  const db = openDatabase(':memory:');
  const appServer = createServer(createApp({ db }).handler);

  try {
    const appBaseUrl = await listen(appServer);
    const request = async (path, { method = 'GET', token, body } = {}) => {
      const response = await fetch(`${appBaseUrl}${path}`, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, data: await response.json() };
    };

    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin123' },
    });
    const defaultToken = login.data.token;
    const timestamp = new Date().toISOString();
    await db.prepare('INSERT INTO tenants (id, name, status, plan, ai_quota, storage_quota_mb, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('tenant-b', '租户 B', 'active', 'enterprise', 1000, 10240, timestamp, timestamp);
    await db.prepare('INSERT INTO users (id, tenant_id, username, password_hash, nickname, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('u-tenant-b-admin', 'tenant-b', 'tenant-b-admin', 'unused', '租户 B 管理员', 'admin', timestamp, timestamp);
    const tenantBToken = createToken({ id: 'u-tenant-b-admin', username: 'tenant-b-admin', role: 'admin' });

    const saveA = await request('/api/admin/ai-settings', {
      method: 'PUT',
      token: defaultToken,
      body: { apiKey: 'sk-tenant-a', baseUrl: providerABaseUrl, chatModel: 'chat-a', embeddingModel: 'embed-a', visionModel: 'vision-a', timeoutMs: 2000 },
    });
    const saveB = await request('/api/admin/ai-settings', {
      method: 'PUT',
      token: tenantBToken,
      body: { apiKey: 'sk-tenant-b', baseUrl: providerBBaseUrl, chatModel: 'chat-b', embeddingModel: 'embed-b', visionModel: 'vision-b', timeoutMs: 2000 },
    });
    assert.equal(saveA.status, 200);
    assert.equal(saveB.status, 200);

    const [runA, runB] = await Promise.all([
      request('/api/agent/assistant', { method: 'POST', token: defaultToken, body: { query: '统计今天营业收入和热销菜品' } }),
      request('/api/agent/assistant', { method: 'POST', token: tenantBToken, body: { query: '统计今天营业收入和热销菜品' } }),
    ]);
    assert.equal(runA.status, 200);
    assert.equal(runB.status, 200);
    assert.equal(providerARequests.length, 1);
    assert.equal(providerBRequests.length, 1);
    assert.equal(providerARequests[0].authorization, 'Bearer sk-tenant-a');
    assert.equal(providerBRequests[0].authorization, 'Bearer sk-tenant-b');
    assert.equal(providerARequests[0].body.model, 'chat-a');
    assert.equal(providerBRequests[0].body.model, 'chat-b');

    const usage = await db.prepare("SELECT tenant_id, model FROM ai_usage_logs WHERE feature = 'canteen-agent' ORDER BY tenant_id").all();
    assert.deepEqual(usage.map((row) => [row.tenant_id, row.model]), [['default', 'chat-a'], ['tenant-b', 'chat-b']]);
    const serializedRuns = JSON.stringify([runA.data, runB.data]);
    assert.doesNotMatch(serializedRuns, /sk-tenant-a|sk-tenant-b/);
  } finally {
    await close(appServer);
    await close(providerA);
    await close(providerB);
    await db.close();
  }
});
