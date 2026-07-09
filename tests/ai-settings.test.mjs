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

describe('admin AI settings', () => {
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

  it('allows admin to read, save, and clear masked AI provider settings', async () => {
    const login = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
    assert.equal(login.status, 200);
    const token = login.data.token;

    const initial = await req('/api/admin/ai-settings', { token });
    assert.equal(initial.status, 200);
    assert.equal(initial.data.status.enabled, false);

    const saved = await req('/api/admin/ai-settings', {
      method: 'PUT',
      token,
      body: { apiKey: 'sk-test', baseUrl: 'https://example.com/v1', embeddingModel: 'emb', chatModel: 'chat', timeoutMs: 3000 }
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.settings.apiKey, '********');
    assert.equal(saved.data.settings.baseUrl, 'https://example.com/v1');
    assert.equal(saved.data.status.enabled, true);
    assert.equal(saved.data.status.source, 'admin');

    const cleared = await req('/api/admin/ai-settings', { method: 'DELETE', token });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.data.settings.apiKey, '');
    assert.equal(cleared.data.status.enabled, false);
  });

  it('rejects student access to AI provider settings', async () => {
    const login = await req('/api/auth/login', { method: 'POST', body: { username: '演示学生', password: 'student123' } });
    const denied = await req('/api/admin/ai-settings', { token: login.data.token });
    assert.equal(denied.status, 403);
  });
});
