import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { catalogTasteGroups, classifyCatalogTaste } from '../server/catalogTasteGroups.js';

let db;
let server;
let baseUrl;
let token;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  });
  return { status: response.status, data: await response.json() };
}

before(async () => {
  db = openDatabase(':memory:');
  // The full test runner enables demo fixtures globally. This contract must
  // still exercise the production state where no real ranking signals exist.
  db.prepare('UPDATE dishes SET rating = 0, review_count = 0, sales = 0').run();
  db.prepare('UPDATE stalls SET rating = 0').run();
  server = createServer(createApp({ db }).handler);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

describe('real catalog regions and rankings', () => {
  it('uses stable business groups and keeps explicit regional labels auditable', () => {
    assert.ok(catalogTasteGroups('meal').some((group) => group.label === '米饭套餐'));
    assert.equal(classifyCatalogTaste({ itemType: 'meal', catalogCategory: '家常热菜' }).label, '家常热菜');
    const inferred = classifyCatalogTaste({ itemType: 'meal', catalogCategory: '其他餐食' });
    assert.equal(inferred.source, 'derived');
    assert.equal(inferred.confidence, 'inferred');
    const verified = classifyCatalogTaste({ itemType: 'meal', regionalTaste: '微辣' });
    assert.equal(verified.id.startsWith('regional-'), true);
    assert.equal(verified.source, 'regional_taste');
  });

  it('returns an explicit ranking empty state instead of zero-score ranks', async () => {
    const result = await request('/api/catalog/rankings?type=dishes');
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.items, []);
    assert.equal(result.data.ranking.available, false);
    assert.equal(result.data.ranking.reason, 'INSUFFICIENT_REAL_SIGNALS');
  });

  it('exposes region metadata and never substitutes client-side fake groups', async () => {
    const result = await request('/api/catalog/regions?itemType=meal');
    assert.equal(result.status, 200);
    assert.equal(result.data.itemType, 'meal');
    assert.ok(Array.isArray(result.data.regions));
    assert.equal(result.data.meta.source, 'derived');
    assert.equal(result.data.meta.confidence, 'inferred');
  });
});
