import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';

test('the default operations task routes to the operations analytics tool', async () => {
  const db = openDatabase(':memory:');
  const app = createApp({ db });
  const server = createServer(app.handler);

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    const login = await loginResponse.json();

    const response = await fetch(`${baseUrl}/api/agent/assistant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${login.token}`,
      },
      body: JSON.stringify({ query: '统计今天营业收入、热销菜品和售罄数量' }),
    });
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.intent, 'operations');
    assert.ok(result.steps.some((step) => step.tool === 'orders.analytics'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});

test('the lunch shortcut loads the menu and recommendation tools', async () => {
  const db = openDatabase(':memory:');
  const app = createApp({ db });
  const server = createServer(app.handler);

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    const login = await loginResponse.json();

    const response = await fetch(`${baseUrl}/api/agent/assistant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${login.token}`,
      },
      body: JSON.stringify({ query: '推荐今天午餐中的素食菜品' }),
    });
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.intent, 'meal_recommendation');
    assert.ok(result.steps.some((step) => step.tool === 'menu.today'));
    assert.ok(result.steps.some((step) => step.tool === 'meal.recommend'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});
