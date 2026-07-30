import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

let db;
let server;
let baseUrl;
let adminToken;
let studentToken;
let reindexRetrieval;
let fixture;

async function request(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function login(username, password) {
  const result = await request('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.token;
}

function dishPayload(row, overrides = {}) {
  return {
    stallId: row.stall_id,
    name: row.name,
    catalogItemType: row.catalog_item_type || 'meal',
    catalogCategory: row.catalog_category || '其他餐食',
    price: row.price,
    taste: row.taste,
    cuisine: row.cuisine,
    ingredients: JSON.parse(row.ingredients_json || '[]'),
    tags: JSON.parse(row.tags_json || '[]'),
    nutrition: {
      calories: row.calories,
      protein: row.protein,
      fat: row.fat,
      carbs: row.carbs,
    },
    status: 'active',
    ...overrides,
  };
}

function listItems(result, key) {
  if (Array.isArray(result.data)) return result.data;
  if (Array.isArray(result.data?.[key])) return result.data[key];
  return result.data?.items || [];
}

describe('catalog publication boundary', () => {
  before(async () => {
    const previousDemoSeed = process.env.ENABLE_DEMO_SEED;
    process.env.ENABLE_DEMO_SEED = '1';
    const [{ createApp }, { openDatabase }, retrievalIndex] = await Promise.all([
      import('../server/app.js'),
      import('../server/database.js'),
      import('../server/retrievalIndex.js'),
    ]);
    reindexRetrieval = retrievalIndex.reindexRetrieval;
    db = openDatabase(':memory:');
    if (previousDemoSeed == null) delete process.env.ENABLE_DEMO_SEED;
    else process.env.ENABLE_DEMO_SEED = previousDemoSeed;

    const mealRows = db.prepare(`SELECT d.*, s.canteen_id
      FROM dishes d JOIN stalls s ON s.id = d.stall_id
      WHERE d.tenant_id = 'default' AND d.status = 'active' AND d.catalog_item_type = 'meal'
      ORDER BY d.id LIMIT 3`).all();
    assert.equal(mealRows.length, 3);
    fixture = {
      structural: mealRows[0],
      pending: mealRows[1],
      hierarchy: mealRows[2],
      stallId: mealRows[2].stall_id,
      canteenId: mealRows[2].canteen_id,
    };

    const app = createApp({ db });
    server = createServer(app.handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    adminToken = await login('admin', 'admin123');
    const registered = await request('/api/auth/register', {
      method: 'POST',
      body: { username: 'publication-boundary-student', password: 'student123', nickname: 'Publication Boundary Student' },
    });
    assert.equal(registered.status, 201, JSON.stringify(registered.data));
    studentToken = registered.data.token;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    db?.close();
  });

  it('keeps structural rows in the admin catalog but forcibly excludes them from publication and RAG', async () => {
    const response = await request(`/api/admin/dishes/${fixture.structural.id}`, {
      method: 'PUT',
      token: adminToken,
      body: dishPayload(fixture.structural, {
        catalogItemType: 'addon',
        reviewStatus: 'approved',
        retrievalEligible: true,
      }),
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.savedEntity.reviewStatus, 'excluded');
    assert.equal(response.data.savedEntity.retrievalEligible, false);

    const search = await request('/api/dishes/search', { method: 'POST', body: { query: fixture.structural.name, itemType: 'addon', pageSize: 50 } });
    assert.equal(search.status, 200);
    assert.equal(search.data.items.some((item) => item.id === fixture.structural.id), false);

    const adminTree = await request(`/api/admin/catalog/tree?include=dishes&q=${encodeURIComponent(fixture.structural.name)}`, { token: adminToken });
    assert.equal(adminTree.status, 200);
    assert.ok(JSON.stringify(adminTree.data).includes(fixture.structural.id));
  });

  it('removes pending dishes from all student reads and write targets', async () => {
    db.prepare("UPDATE dishes SET review_status = 'pending', retrieval_eligible = 0 WHERE id = ?").run(fixture.pending.id);

    const [search, detail, ranking, favorite, eaten, post, review] = await Promise.all([
      request('/api/dishes/search', { method: 'POST', body: { query: fixture.pending.name, pageSize: 50 } }),
      request(`/api/dishes/${fixture.pending.id}`),
      request('/api/catalog/rankings?type=dishes&pageSize=100'),
      request('/api/preferences/dishes', { method: 'PUT', token: studentToken, body: { dishId: fixture.pending.id, favorite: true } }),
      request(`/api/preferences/dishes/${fixture.pending.id}/eaten`, { method: 'POST', token: studentToken }),
      request('/api/posts', { method: 'POST', token: studentToken, body: { targetType: 'dish', targetId: fixture.pending.id, content: '这道菜不应被公开关联。' } }),
      request('/api/reviews', { method: 'POST', token: studentToken, body: { targetType: 'dish', targetId: fixture.pending.id, rating: 4, content: '这条评价不应写入。' } }),
    ]);
    assert.equal(search.status, 200);
    assert.equal(search.data.items.some((item) => item.id === fixture.pending.id), false);
    assert.equal(detail.status, 404);
    assert.equal(ranking.status, 200);
    assert.equal(ranking.data.items.some((item) => item.id === fixture.pending.id), false);
    for (const result of [favorite, eaten, post, review]) {
      assert.equal(result.status, 404, JSON.stringify(result.data));
    }
  });

  it('requires every parent in the hierarchy to be published before browsing or indexing children', async () => {
    db.prepare("UPDATE canteens SET review_status = 'pending', retrieval_eligible = 0 WHERE id = ?").run(fixture.canteenId);

    const [canteens, stalls, venues, catalogStalls, dishSearch, dishDetail, stallRanking, venueRanking] = await Promise.all([
      request('/api/canteens'),
      request('/api/stalls'),
      request('/api/catalog/venues'),
      request('/api/catalog/stalls?pageSize=100'),
      request('/api/dishes/search', { method: 'POST', body: { query: fixture.hierarchy.name, pageSize: 50 } }),
      request(`/api/dishes/${fixture.hierarchy.id}`),
      request('/api/catalog/rankings?type=stalls&pageSize=100'),
      request('/api/catalog/rankings?type=venues&pageSize=100'),
    ]);
    assert.equal(listItems(canteens, 'canteens').some((item) => item.id === fixture.canteenId), false);
    assert.equal(listItems(stalls, 'stalls').some((item) => item.id === fixture.stallId), false);
    assert.equal(listItems(venues, 'venues').some((item) => item.id === fixture.canteenId), false);
    assert.equal(listItems(catalogStalls, 'stalls').some((item) => item.id === fixture.stallId), false);
    assert.equal(dishSearch.data.items.some((item) => item.id === fixture.hierarchy.id), false);
    assert.equal(dishDetail.status, 404);
    assert.equal(stallRanking.data.items.some((item) => item.id === fixture.stallId), false);
    assert.equal(venueRanking.data.items.some((item) => item.id === fixture.canteenId), false);

    const reindex = await reindexRetrieval(db, {
      tenantId: 'default',
      sourceTypes: ['dish', 'stall', 'canteen'],
      embeddingProvider: null,
      catalogIntroductionAllowStale: true,
    });
    assert.equal(reindex.failureCount, 0);
    const indexed = new Set(db.prepare("SELECT source_type || ':' || source_id AS id FROM rag_documents WHERE tenant_id = 'default'").all().map((row) => row.id));
    assert.equal(indexed.has(`dish:${fixture.hierarchy.id}`), false);
    assert.equal(indexed.has(`stall:${fixture.stallId}`), false);
    assert.equal(indexed.has(`canteen:${fixture.canteenId}`), false);
  });
});
