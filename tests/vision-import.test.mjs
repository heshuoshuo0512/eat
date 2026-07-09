import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { normalizeVisionDishSuggestion } from '../server/aiProvider.js';

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

describe('admin vision dish import', () => {
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

  it('normalizes vision suggestions into safe dish form defaults', () => {
    const suggestion = normalizeVisionDishSuggestion({
      name: '番茄鸡蛋盖饭',
      taste: '不辣',
      cuisine: '家常菜',
      ingredients: ['番茄', '鸡蛋', '米饭'],
      tags: '快餐 高性价比',
      nutrition: { calories: 560.4, protein: 18.2, fat: 16.6, carbs: 82.1 },
      confidence: 1.8,
      notes: '请确认'
    });
    assert.deepEqual(suggestion.ingredients, ['番茄', '鸡蛋', '米饭']);
    assert.deepEqual(suggestion.tags, ['快餐', '高性价比']);
    assert.deepEqual(suggestion.nutrition, { calories: 560, protein: 18, fat: 17, carbs: 82 });
    assert.equal(suggestion.confidence, 1);
  });

  it('rejects student access before invoking the vision provider', async () => {
    const login = await req('/api/auth/login', { method: 'POST', body: { username: '演示学生', password: 'student123' } });
    const denied = await req('/api/admin/dishes/vision-import', {
      method: 'POST',
      token: login.data.token,
      body: { filename: 'dish.jpg', contentType: 'image/jpeg', dataBase64: 'ZmFrZQ==' }
    });
    assert.equal(denied.status, 403);
  });

  it('returns a clear admin error when no AI key is configured', async () => {
    const login = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
    const result = await req('/api/admin/dishes/vision-import', {
      method: 'POST',
      token: login.data.token,
      body: { filename: 'dish.jpg', contentType: 'image/jpeg', dataBase64: 'ZmFrZQ==' }
    });
    assert.equal(result.status, 400);
    assert.match(result.data.error, /AI 配置/);
  });

  it('allows authenticated student meal analysis but requires configured vision AI', async () => {
    const login = await req('/api/auth/login', { method: 'POST', body: { username: '演示学生', password: 'student123' } });
    const result = await req('/api/vision/meal-analyze', {
      method: 'POST',
      token: login.data.token,
      body: { filename: 'meal.jpg', contentType: 'image/jpeg', dataBase64: 'ZmFrZQ==' }
    });
    assert.equal(result.status, 400);
    assert.match(result.data.error, /AI 配置/);
  });

  it('rejects anonymous student meal analysis', async () => {
    const result = await req('/api/vision/meal-analyze', {
      method: 'POST',
      body: { filename: 'meal.jpg', contentType: 'image/jpeg', dataBase64: 'ZmFrZQ==' }
    });
    assert.equal(result.status, 401);
  });
});
