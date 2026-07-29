#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openPostgresDatabase } from '../server/database.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const db = await openPostgresDatabase(databaseUrl, { migrate: false, applicationName: 'catalog-classification-acceptance' });
let server;

try {
  server = createServer(createApp({ db }).handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = 'GET', body } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const payload = await response.json();
    return { status: response.status, data: payload };
  };
  const search = (body) => request('/api/dishes/search', { method: 'POST', body: { pageSize: 50, ...body } });

  const [meals, snacks, beverages, addons, genericBalls, rankings] = await Promise.all([
    search({}),
    search({ itemType: 'snack' }),
    search({ itemType: 'beverage' }),
    search({ itemType: 'addon' }),
    search({ query: '丸子' }),
    request('/api/catalog/rankings?type=dishes&pageSize=50'),
  ]);
  for (const response of [meals, snacks, beverages, addons, genericBalls, rankings]) assert.equal(response.status, 200);
  assert.ok(meals.data.items.length > 0 && meals.data.items.every((item) => item.catalogItemType === 'meal'));
  assert.ok(snacks.data.items.length > 0 && snacks.data.items.every((item) => item.catalogItemType === 'snack'));
  assert.ok(beverages.data.items.length > 0 && beverages.data.items.every((item) => item.catalogItemType === 'beverage'));
  assert.ok(addons.data.items.length > 0 && addons.data.items.every((item) => item.catalogItemType === 'addon'));
  assert.ok(addons.data.items.every((item) => item.availability.orderable === false));
  assert.ok(genericBalls.data.items.every((item) => ['meal', 'beverage', 'snack'].includes(item.catalogItemType)));
  assert.ok(rankings.data.items.every((item) => item.catalogItemType === 'meal'));

  const [oldServingTier, duplicateNoodle, flavorParent, normalizedTomatoNoodle, invalidSection] = await Promise.all([
    request('/api/dishes/dish-58240b793c681e'),
    request('/api/dishes/dish-b43ac7746192af'),
    request('/api/dishes/dish-073fc872e79d15'),
    request('/api/dishes/dish-19a612019d757f'),
    search({ itemType: 'section' }),
  ]);
  assert.equal(oldServingTier.status, 200);
  assert.equal(oldServingTier.data.id, 'dish-2a3b8d894013ac');
  assert.equal(duplicateNoodle.status, 200);
  assert.equal(duplicateNoodle.data.id, 'dish-ba91190defb150');
  assert.equal(flavorParent.status, 200);
  assert.equal(flavorParent.data.name, '掉渣饼');
  assert.equal(flavorParent.data.priceDisplay, '3-3.5元');
  assert.equal(normalizedTomatoNoodle.status, 200);
  assert.equal(normalizedTomatoNoodle.data.name, '番茄肉酱面');
  assert.equal(invalidSection.status, 400);

  const database = await db.runWithContext({
    tenantId: 'default', userId: 'catalog-acceptance', role: 'student', requestId: 'catalog-acceptance',
  }, async () => {
    const types = await db.query(`SELECT catalog_item_type, COUNT(*)::integer AS count
      FROM dishes WHERE tenant_id = 'default' GROUP BY catalog_item_type ORDER BY catalog_item_type`);
    const rag = await db.query(`SELECT d.catalog_item_type, COUNT(*)::integer AS count
      FROM rag_documents r JOIN dishes d ON d.id = r.source_id AND d.tenant_id = r.tenant_id
      WHERE r.tenant_id = 'default' AND r.source_type = 'dish'
      GROUP BY d.catalog_item_type ORDER BY d.catalog_item_type`);
    const malformed = await db.query(`SELECT id, name FROM dishes
      WHERE tenant_id = 'default' AND status = 'active'
        AND catalog_item_type IN ('meal','beverage','snack')
        AND (name ~ '^[[:space:]]*([0-9０-９]+[[:space:]]*[.、]|[.、])'
          OR name LIKE '%低消' OR name LIKE '%款')`);
    const ragCoverage = await db.query(`SELECT d.id, d.name, COUNT(r.id)::integer AS document_count,
        MAX(r.title) AS rag_title
      FROM dishes d
      LEFT JOIN rag_documents r
        ON r.tenant_id = d.tenant_id AND r.source_type = 'dish' AND r.source_id = d.id
      WHERE d.tenant_id = 'default' AND d.status = 'active'
        AND d.catalog_item_type IN ('meal','beverage','snack')
      GROUP BY d.id, d.name
      HAVING COUNT(r.id) <> 1 OR MAX(r.title) <> d.name`);
    return {
      typeCounts: Object.fromEntries(types.rows.map((row) => [row.catalog_item_type, Number(row.count)])),
      ragTypes: Object.fromEntries(rag.rows.map((row) => [row.catalog_item_type, Number(row.count)])),
      malformedNames: malformed.rows,
      ragCoverageIssues: ragCoverage.rows,
    };
  });
  assert.deepEqual(Object.keys(database.ragTypes).sort(), ['beverage', 'meal', 'snack']);
  assert.deepEqual(database.malformedNames, []);
  assert.deepEqual(database.ragCoverageIssues, []);

  console.log(JSON.stringify({
    ok: true,
    database,
    api: {
      defaultType: meals.data.meta.itemType,
      mealTotal: meals.data.page.total,
      snackTotal: snacks.data.page.total,
      beverageTotal: beverages.data.page.total,
      addonTotal: addons.data.page.total,
      genericBallResultCount: genericBalls.data.page.total,
      rankingCount: rankings.data.items.length,
      variantRedirect: oldServingTier.data.id,
      duplicateRedirect: duplicateNoodle.data.id,
      flavorParent: { id: flavorParent.data.id, name: flavorParent.data.name, priceDisplay: flavorParent.data.priceDisplay },
      normalizedTomatoNoodle: { id: normalizedTomatoNoodle.data.id, name: normalizedTomatoNoodle.data.name },
    },
  }, null, 2));
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.close();
}
