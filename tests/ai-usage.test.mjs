import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';

let db;
let server;
let baseUrl;

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function login(username, password) {
  const response = await req('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.equal(response.status, 200);
  return response.data.token;
}

describe('AI usage governance', () => {
  before(() => {
    db = openDatabase(':memory:');
    server = createServer(createApp({ db }).handler);
    server.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server.close();
    db.close();
  });

  it('records meal advisor usage and exposes tenant summary to admin', async () => {
    const studentToken = await login('演示学生', 'student123');
    const adminToken = await login('admin', 'admin123');

    const answer = await req('/api/agent/meal-advisor', { method: 'POST', token: studentToken, body: { question: '午餐想吃高蛋白低脂有什么推荐？' } });
    assert.equal(answer.status, 200);
    assert.ok(answer.data.answer);

    const usage = await req('/api/admin/ai-usage', { token: adminToken });
    assert.equal(usage.status, 200);
    assert.equal(usage.data.total, 1);
    assert.equal(usage.data.logs[0].feature, 'meal-advisor');
    assert.equal(usage.data.logs[0].status, 'success');
    assert.equal(usage.data.logs[0].tenantId, 'default');
    assert.ok(usage.data.logs[0].inputTokens > 0);
    assert.ok(usage.data.summary.some((item) => item.feature === 'meal-advisor' && item.status === 'success' && item.count === 1));
  });

  it('records failed student vision usage without hiding the original error', async () => {
    const studentToken = await login('演示学生', 'student123');
    const adminToken = await login('admin', 'admin123');

    const failed = await req('/api/vision/meal-analyze', { method: 'POST', token: studentToken, body: { filename: 'dish.txt', contentType: 'text/plain', dataBase64: 'bad' } });
    assert.equal(failed.status, 400);

    const usage = await req('/api/admin/ai-usage', { token: adminToken });
    assert.equal(usage.status, 200);
    const visionLog = usage.data.logs.find((log) => log.feature === 'student-vision');
    assert.equal(visionLog.status, 'failure');
    assert.equal(visionLog.imageCount, 1);
    assert.ok(visionLog.error);
  });

  it('blocks AI calls when tenant monthly quota is exhausted', async () => {
    const studentToken = await login('演示学生', 'student123');
    const adminToken = await login('admin', 'admin123');

    const usageBefore = await req('/api/admin/ai-usage', { token: adminToken });
    assert.equal(usageBefore.status, 200);
    await req('/api/admin/tenants/default', { method: 'PUT', token: adminToken, body: { name: '默认校园', status: 'active', plan: 'enterprise', aiQuota: usageBefore.data.quota.used, storageQuotaMb: 10240 } });

    const blocked = await req('/api/agent/meal-advisor', { method: 'POST', token: studentToken, body: { question: '今天继续推荐午餐' } });
    assert.equal(blocked.status, 429);
    assert.match(blocked.data.error, /AI 月额度已用完/);

    const usageAfter = await req('/api/admin/ai-usage', { token: adminToken });
    assert.equal(usageAfter.data.total, usageBefore.data.total);
    assert.equal(usageAfter.data.quota.remaining, 0);
  });

  it('rejects student access to AI usage logs', async () => {
    const studentToken = await login('演示学生', 'student123');
    const denied = await req('/api/admin/ai-usage', { token: studentToken });
    assert.equal(denied.status, 403);
  });
});
