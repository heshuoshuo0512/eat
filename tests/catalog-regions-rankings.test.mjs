import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { MIN_CATALOG_REGION_ITEMS, catalogTasteGroups, classifyCatalogTaste } from '../server/catalogTasteGroups.js';

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
  it('classifies each dish by regional evidence instead of meal category', () => {
    const groups = new Set(catalogTasteGroups('meal').map((group) => group.id));
    assert.equal(groups.has('cantonese'), true);
    assert.equal(groups.has('northeast'), true);
    assert.equal(groups.has('sichuan-hunan'), true);
    assert.equal(groups.has('rice'), false);

    const cases = [
      ['\u80a0\u7c89', 'cantonese'],
      ['\u5730\u4e09\u9c9c', 'northeast'],
      ['\u9c7c\u9999\u8089\u4e1d', 'sichuan-hunan'],
      ['\u51c9\u76ae', 'northwest'],
      ['\u9999\u8fa3\u80a5\u80a0\u7c89 / \u9762', 'sichuan-hunan'],
      ['\u8001\u5317\u4eac\u70b8\u9171\u9762', 'beijing-shandong'],
      ['\u996d\u56e2', 'japanese'],
      ['\u6c49\u5821', 'western-fast-food'],
      ['\u9ebb\u8fa3\u70eb', 'hotpot'],
    ];
    for (const [name, expectedId] of cases) {
      const result = classifyCatalogTaste({ itemType: 'meal', name });
      assert.equal(result.id, expectedId, name);
      assert.equal(result.evidence[0].field, 'name', name);
      assert.equal(result.evidence[0].rule, 'dish_name_cue', name);
    }

    const unresolved = classifyCatalogTaste({ itemType: 'meal', name: '\u897f\u7ea2\u67ff\u9e21\u86cb\u9762', taste: '\u5fae\u8fa3' });
    assert.equal(unresolved.id.startsWith('regional-'), true);
    assert.equal(unresolved.confidence, 'unresolved');
    assert.deepEqual(unresolved.evidence, []);

    const verified = classifyCatalogTaste({ itemType: 'meal', regionalTaste: '\u7ca4\u83dc' });
    assert.equal(verified.id, 'cantonese');
    assert.equal(verified.source, 'regional_taste');
    assert.equal(verified.confidence, 'verified');
    assert.equal(verified.evidence[0].field, 'regionalTaste');
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
    assert.equal(result.data.meta.minRegionItems, MIN_CATALOG_REGION_ITEMS);
    assert.ok(result.data.meta.hiddenSmallGroupCount >= 0);
    assert.ok(result.data.meta.hiddenSmallItemCount >= 0);
    assert.ok(result.data.regions.every((region) => region.count >= MIN_CATALOG_REGION_ITEMS));
    assert.equal(
      result.data.regions.reduce((sum, region) => sum + region.count, 0) + result.data.meta.hiddenSmallItemCount,
      result.data.meta.total,
    );
  });
});
