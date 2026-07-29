import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

let db;
let server;
let baseUrl;
let fixture;
let reindexRetrieval;
let runMealRecommendationWorkflow;

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

describe('catalog item type boundaries', () => {
  before(async () => {
    const previousDemoSeed = process.env.ENABLE_DEMO_SEED;
    process.env.ENABLE_DEMO_SEED = '1';
    const [{ createApp }, { openDatabase }, retrievalIndex, retrievalService] = await Promise.all([
      import('../server/app.js'),
      import('../server/database.js'),
      import('../server/retrievalIndex.js'),
      import('../server/retrievalService.js'),
    ]);
    reindexRetrieval = retrievalIndex.reindexRetrieval;
    runMealRecommendationWorkflow = retrievalService.runMealRecommendationWorkflow;
    db = openDatabase(':memory:');
    if (previousDemoSeed == null) delete process.env.ENABLE_DEMO_SEED;
    else process.env.ENABLE_DEMO_SEED = previousDemoSeed;
    const rows = db.prepare("SELECT id FROM dishes WHERE tenant_id = 'default' AND status = 'active' ORDER BY id LIMIT 5").all();
    assert.equal(rows.length, 5);
    fixture = {
      meal: rows[0].id,
      beverage: rows[1].id,
      addon: rows[2].id,
      fee: rows[3].id,
      variant: rows[4].id,
    };
    db.prepare("UPDATE dishes SET name = '目录分型测试主菜', catalog_item_type = 'meal', pricing_mode = 'variants', price = 25, price_display = '25-55元', pricing_json = ?, reservation_enabled = 1 WHERE id = ?")
      .run(JSON.stringify({ mode: 'variants', display: '25-55元', minAmount: 25, maxAmount: 55, budgetComparable: true, variants: [{ label: '1人份', amount: 25 }, { label: '3-4人份', amount: 55 }], modifiers: [] }), fixture.meal);
    db.prepare("UPDATE dishes SET name = '目录分型测试可乐', catalog_item_type = 'beverage', reservation_enabled = 1 WHERE id = ?").run(fixture.beverage);
    db.prepare("UPDATE dishes SET name = '目录分型测试加面', catalog_item_type = 'addon', reservation_enabled = 0 WHERE id = ?").run(fixture.addon);
    db.prepare("UPDATE dishes SET name = '目录分型测试打包费', catalog_item_type = 'fee', reservation_enabled = 0 WHERE id = ?").run(fixture.fee);
    db.prepare("UPDATE dishes SET name = '3-4人份', catalog_item_type = 'variant', parent_dish_id = ?, status = 'inactive', reservation_enabled = 0 WHERE id = ?")
      .run(fixture.meal, fixture.variant);

    const app = createApp({ db });
    server = createServer(app.handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    db?.close();
  });

  it('defaults browse and rankings to meals while keeping explicit catalog tabs', async () => {
    const browse = await request('/api/dishes/search', { method: 'POST', body: { pageSize: 100 } });
    assert.equal(browse.status, 200, JSON.stringify(browse.data));
    assert.ok(browse.data.items.length > 0);
    assert.ok(browse.data.items.every((dish) => dish.catalogItemType === 'meal'));
    assert.equal(browse.data.items.some((dish) => dish.id === fixture.beverage), false);

    const beverages = await request('/api/dishes/search', { method: 'POST', body: { itemType: 'beverage', pageSize: 100 } });
    assert.equal(beverages.status, 200, JSON.stringify(beverages.data));
    assert.deepEqual(beverages.data.items.map((dish) => dish.id), [fixture.beverage]);

    const addons = await request('/api/dishes/search', { method: 'POST', body: { itemType: 'addon', pageSize: 100 } });
    assert.equal(addons.status, 200, JSON.stringify(addons.data));
    assert.deepEqual(addons.data.items.map((dish) => dish.id), [fixture.addon]);
    assert.equal(addons.data.items[0].availability.orderable, false);

    const rankings = await request('/api/catalog/rankings?type=dishes&pageSize=50');
    assert.equal(rankings.status, 200);
    assert.ok(rankings.data.items.every((dish) => dish.catalogItemType === 'meal'));
  });

  it('finds beverages by name but excludes add-ons, fees and variants from generic search', async () => {
    const beverage = await request('/api/dishes/search', { method: 'POST', body: { query: '目录分型测试可乐', pageSize: 20 } });
    assert.equal(beverage.status, 200, JSON.stringify(beverage.data));
    assert.equal(beverage.data.items[0].id, fixture.beverage);

    const generic = await request('/api/dishes/search', { method: 'POST', body: { query: '目录分型测试', pageSize: 100 } });
    assert.equal(generic.status, 200, JSON.stringify(generic.data));
    const ids = generic.data.items.map((dish) => dish.id);
    assert.ok(ids.includes(fixture.meal));
    assert.ok(ids.includes(fixture.beverage));
    assert.equal(ids.includes(fixture.addon), false);
    assert.equal(ids.includes(fixture.fee), false);
    assert.equal(ids.includes(fixture.variant), false);
  });

  it('resolves an inactive serving tier to its canonical parent dish', async () => {
    const detail = await request(`/api/dishes/${fixture.variant}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.id, fixture.meal);
    assert.equal(detail.data.canonicalDishId, fixture.meal);
    assert.equal(detail.data.redirectedFromDishId, fixture.variant);
    assert.equal(detail.data.pricing.mode, 'variants');
  });

  it('keeps non-meal catalog products out of meal recommendations', async () => {
    const candidate = (id, name, catalogItemType) => ({
      id,
      tenantId: 'default',
      stallId: 'stall-test',
      name,
      catalogItemType,
      status: 'active',
      price: 10,
      taste: '清淡',
      cuisine: '测试',
      ingredients: [],
      allergens: [],
      tags: [],
      mealTypes: ['lunch'],
      nutrition: { calories: 0, protein: 0, fat: 0, carbs: 0 },
      factStatus: { nutrition: 'unknown', recipe: 'unknown', halal: 'unknown', dietary: 'unknown', spice: 'unknown' },
      safetyDeclarations: [{ allergenCode: '*', status: 'unknown' }],
      availability: { orderable: true, status: 'reservable', price: 10 },
    });
    const result = await runMealRecommendationWorkflow({
      tenantId: 'default',
      query: '推荐一顿午餐',
      profile: { onboardingStatus: 'completed', mealType: 'lunch', budgetMax: 30 },
      options: { requireOrderable: false, mode: 'alternatives', limit: 5 },
      candidates: [
        candidate('meal-test', '测试主餐', 'meal'),
        candidate('beverage-test', '测试饮品', 'beverage'),
        candidate('addon-test', '测试加购', 'addon'),
      ],
    });
    assert.deepEqual(result.recommendations.map((dish) => dish.id), ['meal-test']);
  });

  it('indexes active meals and beverages but removes variants, fees and add-ons from RAG', async () => {
    const result = await reindexRetrieval(db, {
      tenantId: 'default',
      sourceTypes: ['dish'],
      embeddingProvider: null,
      catalogIntroductionAllowStale: true,
    });
    assert.equal(result.failureCount, 0);
    const indexed = new Set(db.prepare("SELECT source_id FROM rag_documents WHERE tenant_id = 'default' AND source_type = 'dish'").all().map((row) => row.source_id));
    assert.ok(indexed.has(fixture.meal));
    assert.ok(indexed.has(fixture.beverage));
    assert.equal(indexed.has(fixture.addon), false);
    assert.equal(indexed.has(fixture.fee), false);
    assert.equal(indexed.has(fixture.variant), false);
  });
});
