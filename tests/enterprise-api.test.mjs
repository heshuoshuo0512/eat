import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

let server;
let baseUrl;
let _db;

/** Spin up a real HTTP server backed by an in-memory DB. */
function setup() {
  before(() => {
    _db = openDatabase(':memory:');
    const app = createApp({ db: _db });
    server = createServer(app.handler);
    server.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());
}

/** Convenience fetch wrapper: returns { status, data } parsed JSON. */
async function req(path, { method = 'GET', token, body, rawRes } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (rawRes) return { status: res.status, res };
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function adminToken() {
  const { data } = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  return data.token;
}

/* ================================================================== */
/*  0. Enterprise tenants and menus                                    */
/* ================================================================== */
describe('Enterprise tenant and menu operations', () => {
  setup();

  it('admin can create and update tenants', async () => {
    const token = await adminToken();
    const created = await req('/api/admin/tenants', {
      method: 'POST',
      token,
      body: { id: 'tenant-campus-a', name: '未来校园 A', plan: 'enterprise', aiQuota: 5000, storageQuotaMb: 20480 },
    });
    assert.equal(created.status, 201);
    assert.ok(created.data.tenants.some((tenant) => tenant.id === 'tenant-campus-a'));

    const updated = await req('/api/admin/tenants/tenant-campus-a', {
      method: 'PUT',
      token,
      body: { name: '未来校园 A+', status: 'disabled', plan: 'trial', aiQuota: 0, storageQuotaMb: 0 },
    });
    assert.equal(updated.status, 200);
    const tenant = updated.data.tenants.find((item) => item.id === 'tenant-campus-a');
    assert.equal(tenant.status, 'disabled');
    assert.equal(tenant.aiQuota, 0);
    assert.equal(tenant.storageQuotaMb, 0);
  });

  it('rejects unknown tenant status instead of silently activating it', async () => {
    const token = await adminToken();
    const created = await req('/api/admin/tenants', {
      method: 'POST',
      token,
      body: { id: 'tenant-bad-status', name: '状态异常租户', status: 'suspended', aiQuota: 0, storageQuotaMb: 0 },
    });
    assert.equal(created.status, 400);
    assert.match(created.data.error, /租户状态/);

    const tenants = await req('/api/admin/tenants', { token });
    assert.ok(!tenants.data.tenants.some((tenant) => tenant.id === 'tenant-bad-status'));
  });

  it('rejects unsafe tenant ids', async () => {
    const token = await adminToken();
    const created = await req('/api/admin/tenants', {
      method: 'POST',
      token,
      body: { id: '../bad tenant', name: '非法租户' },
    });
    assert.equal(created.status, 400);
    assert.match(created.data.error, /租户 ID/);
  });

  it('blocks API access for users in disabled tenants', async () => {
    const token = await adminToken();
    await _db.prepare("INSERT INTO tenants (id, name, status, plan, ai_quota, storage_quota_mb, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run('tenant-disabled-api', '停用租户', 'disabled', 'trial', 100, 100, new Date().toISOString(), new Date().toISOString());
    await _db.prepare("INSERT INTO users (id, tenant_id, username, password_hash, nickname, role, created_at, updated_at) SELECT ?, ?, ?, password_hash, ?, ?, created_at, updated_at FROM users WHERE username = ?").run('u-disabled-operator', 'tenant-disabled-api', 'disabled-operator', '停用运营', 'operator', 'admin');

    const disabledLogin = await req('/api/auth/login', { method: 'POST', body: { username: 'disabled-operator', password: 'admin123' } });
    assert.equal(disabledLogin.status, 401);

    const disabledToken = (await import('../server/security.js')).createToken({ id: 'u-disabled-operator', role: 'operator', tenant_id: 'tenant-disabled-api' });
    const menus = await req('/api/admin/menus', { token: disabledToken });
    assert.equal(menus.status, 403);
    assert.match(menus.data.error, /租户已停用/);

    const adminMenus = await req('/api/admin/menus', { token });
    assert.equal(adminMenus.status, 200);
  });

  it('admin can create menus with dish items and archive them', async () => {
    const token = await adminToken();
    const created = await req('/api/admin/menus', {
      method: 'POST',
      token,
      body: {
        id: 'menu-lunch-a',
        canteenId: 'north',
        date: '2026-07-05',
        mealType: 'lunch',
        status: 'published',
        items: [{ dishId: 'd-chicken-bowl', price: 16, supplyLimit: 80 }],
      },
    });
    assert.equal(created.status, 201);
    const menu = created.data.menus.find((item) => item.id === 'menu-lunch-a');
    assert.equal(menu.status, 'published');
    assert.equal(menu.items[0].dishId, 'd-chicken-bowl');

    const archived = await req('/api/admin/menus/menu-lunch-a', { method: 'DELETE', token });
    assert.equal(archived.status, 200);
    assert.equal(archived.data.menus.find((item) => item.id === 'menu-lunch-a').status, 'archived');
  });

  it('filters menus by date meal type and status with total count', async () => {
    const token = await adminToken();
    await req('/api/admin/menus', { method: 'POST', token, body: { id: 'menu-filter-lunch', canteenId: 'north', date: '2026-07-06', mealType: 'lunch', status: 'published', items: [{ dishId: 'd-chicken-bowl', price: 16 }] } });
    await req('/api/admin/menus', { method: 'POST', token, body: { id: 'menu-filter-dinner', canteenId: 'north', date: '2026-07-06', mealType: 'dinner', status: 'draft', items: [{ dishId: 'd-beef-noodle', price: 18 }] } });

    const filtered = await req('/api/admin/menus?date=2026-07-06&mealType=lunch&status=published&limit=1&offset=0', { token });
    assert.equal(filtered.status, 200);
    assert.equal(filtered.data.total, 1);
    assert.deepEqual(filtered.data.menus.map((menu) => menu.id), ['menu-filter-lunch']);
  });

  it('rejects menu items that are not in the current tenant', async () => {
    const token = await adminToken();
    const invalidCanteen = await req('/api/admin/menus', { method: 'POST', token, body: { id: 'menu-invalid-canteen', canteenId: 'missing-canteen', date: '2026-07-07', mealType: 'lunch', items: [] } });
    assert.equal(invalidCanteen.status, 400);
    assert.match(invalidCanteen.data.error, /食堂不存在/);

    const invalidDish = await req('/api/admin/menus', { method: 'POST', token, body: { id: 'menu-invalid-dish', canteenId: 'north', date: '2026-07-07', mealType: 'lunch', items: [{ dishId: 'missing-dish', price: 9 }] } });
    assert.equal(invalidDish.status, 400);
    assert.match(invalidDish.data.error, /菜单菜品不存在/);

    const list = await req('/api/admin/menus?date=2026-07-07', { token });
    assert.equal(list.status, 200);
    assert.equal(list.data.total, 0);
  });

  it('batch publishes and archives menus', async () => {
    const token = await adminToken();
    await req('/api/admin/menus', { method: 'POST', token, body: { id: 'menu-batch-a', canteenId: 'north', date: '2026-07-08', mealType: 'lunch', status: 'draft', items: [{ dishId: 'd-chicken-bowl', price: 16 }] } });
    await req('/api/admin/menus', { method: 'POST', token, body: { id: 'menu-batch-b', canteenId: 'north', date: '2026-07-08', mealType: 'dinner', status: 'draft', items: [{ dishId: 'd-beef-noodle', price: 18 }] } });

    const published = await req('/api/admin/menus/batch', { method: 'POST', token, body: { action: 'publish', ids: ['menu-batch-a', 'menu-batch-b'] } });
    assert.equal(published.status, 200);
    assert.equal(published.data.updated, 2);
    assert.equal(published.data.menus.find((menu) => menu.id === 'menu-batch-a').status, 'published');

    const archived = await req('/api/admin/menus/batch', { method: 'POST', token, body: { action: 'archive', ids: ['menu-batch-a'] } });
    assert.equal(archived.status, 200);
    assert.equal(archived.data.updated, 1);
    assert.equal(archived.data.menus.find((menu) => menu.id === 'menu-batch-a').status, 'archived');
  });

  it('student cannot manage tenants or menus', async () => {
    const login = await req('/api/auth/login', { method: 'POST', body: { username: '演示学生', password: 'student123' } });
    const tenants = await req('/api/admin/tenants', { token: login.data.token });
    const menus = await req('/api/admin/menus', { method: 'POST', token: login.data.token, body: { canteenId: 'north-canteen', date: '2026-07-05', mealType: 'lunch' } });
    assert.equal(tenants.status, 403);
    assert.equal(menus.status, 403);
  });
});

/* ================================================================== */
/*  1. RBAC: student cannot write to admin endpoints                   */
/* ================================================================== */
describe('RBAC — student rejected from admin write endpoints', () => {
  setup();

  let studentToken;

  before(async () => {
    const { data } = await req('/api/auth/login', {
      method: 'POST',
      body: { username: '演示学生', password: 'student123' },
    });
    studentToken = data.token;
  });

  it('POST /api/admin/dishes returns 403 for student', async () => {
    const { status, data } = await req('/api/admin/dishes', {
      method: 'POST',
      token: studentToken,
      body: {
        stallId: 'n-protein',
        name: '违规菜品',
        price: 10,
        taste: '咸',
        cuisine: '违规',
        ingredients: 'x',
        tags: 'x',
        nutrition: { calories: 100, protein: 10, fat: 5, carbs: 5 },
      },
    });
    assert.equal(status, 403);
    assert.ok(data.error);
  });

  it('POST /api/admin/canteens returns 403 for student', async () => {
    const { status, data } = await req('/api/admin/canteens', {
      method: 'POST',
      token: studentToken,
      body: { name: '违规食堂', location: 'x', hours: 'x', description: 'x' },
    });
    assert.equal(status, 403);
    assert.ok(data.error);
  });

  it('PUT /api/admin/dishes/:id returns 403 for student', async () => {
    const { status } = await req('/api/admin/dishes/d-chicken-bowl', {
      method: 'PUT',
      token: studentToken,
      body: { name: '篡改' },
    });
    assert.equal(status, 403);
  });

  it('DELETE /api/admin/dishes/:id returns 403 for student', async () => {
    const { status } = await req('/api/admin/dishes/d-chicken-bowl', {
      method: 'DELETE',
      token: studentToken,
    });
    assert.equal(status, 403);
  });
});

/* ================================================================== */
/*  2. Admin can PUT / DELETE dishes                                   */
/* ================================================================== */
describe('Admin dish PUT and DELETE', () => {
  setup();

  let adminToken;

  before(async () => {
    const { data } = await req('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin123' },
    });
    adminToken = data.token;
  });

  it('PUT /api/admin/dishes/:id updates an existing dish', async () => {
    // First, create a dish via the existing POST endpoint
    const { status: createStatus, data: createData } = await req('/api/admin/dishes', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'enterprise-dish-put',
        stallId: 'n-protein',
        name: '待修改菜品',
        price: 15,
        taste: '咸香',
        cuisine: '中餐',
        ingredients: '鸡肉,盐',
        tags: '低脂',
        nutrition: { calories: 200, protein: 25, fat: 5, carbs: 10 },
      },
    });
    assert.equal(createStatus, 201);

    // PUT to update
    const { status, data } = await req('/api/admin/dishes/enterprise-dish-put', {
      method: 'PUT',
      token: adminToken,
      body: {
        name: '已修改菜品',
        price: 20,
        taste: '辣',
        cuisine: '川菜',
        stallId: 'n-protein',
        ingredients: '鸡肉,辣椒,盐',
        tags: '低脂,辣味',
        nutrition: { calories: 220, protein: 26, fat: 6, carbs: 12 },
      },
    });
    assert.equal(status, 200, 'PUT should return 200');

    // Verify persistence via bootstrap
    const { data: bootstrap } = await req('/api/bootstrap', { token: adminToken });
    const updated = bootstrap.dishes.find((d) => d.id === 'enterprise-dish-put');
    assert.ok(updated, 'dish persists after PUT');
    assert.equal(updated.name, '已修改菜品');
    assert.equal(updated.price, 20);
  });

  it('DELETE /api/admin/dishes/:id removes a dish', async () => {
    // Create then delete
    await req('/api/admin/dishes', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'enterprise-dish-del',
        stallId: 'n-protein',
        name: '待删除菜品',
        price: 10,
        taste: '咸',
        cuisine: '中餐',
        ingredients: 'x',
        tags: 'x',
        nutrition: { calories: 100, protein: 10, fat: 3, carbs: 5 },
      },
    });

    const { status } = await req('/api/admin/dishes/enterprise-dish-del', {
      method: 'DELETE',
      token: adminToken,
    });
    assert.equal(status, 200, 'DELETE should return 200');

    // Verify removed
    const { data: bootstrap } = await req('/api/bootstrap', { token: adminToken });
    const gone = bootstrap.dishes.find((d) => d.id === 'enterprise-dish-del');
    assert.equal(gone, undefined, 'deleted dish no longer in list');
  });

  it('DELETE nonexistent dish returns 404', async () => {
    const { status } = await req('/api/admin/dishes/dish-does-not-exist', {
      method: 'DELETE',
      token: adminToken,
    });
    assert.equal(status, 404);
  });
});

/* ================================================================== */
/*  3. Admin can PUT / DELETE canteens                                 */
/* ================================================================== */
describe('Admin canteen PUT and DELETE', () => {
  setup();

  let adminToken;

  before(async () => {
    const { data } = await req('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin123' },
    });
    adminToken = data.token;
  });

  it('PUT /api/admin/canteens/:id updates an existing canteen', async () => {
    await req('/api/admin/canteens', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'enterprise-canteen-put',
        name: '待修改食堂',
        location: '测试楼',
        hours: '08:00-20:00',
        description: '原始描述',
      },
    });

    const { status } = await req('/api/admin/canteens/enterprise-canteen-put', {
      method: 'PUT',
      token: adminToken,
      body: {
        name: '已修改食堂',
        location: '新楼',
        hours: '09:00-21:00',
        description: '更新后描述',
      },
    });
    assert.equal(status, 200, 'PUT should return 200');

    const { data: bootstrap } = await req('/api/bootstrap', { token: adminToken });
    const updated = bootstrap.canteens.find((c) => c.id === 'enterprise-canteen-put');
    assert.ok(updated, 'canteen persists after PUT');
    assert.equal(updated.name, '已修改食堂');
  });

  it('DELETE /api/admin/canteens/:id removes a canteen', async () => {
    await req('/api/admin/canteens', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'enterprise-canteen-del',
        name: '待删除食堂',
        location: '测试楼',
        hours: '08:00-20:00',
        description: '将被删除',
      },
    });

    const { status } = await req('/api/admin/canteens/enterprise-canteen-del', {
      method: 'DELETE',
      token: adminToken,
    });
    assert.equal(status, 200, 'DELETE should return 200');

    const { data: bootstrap } = await req('/api/bootstrap', { token: adminToken });
    const gone = bootstrap.canteens.find((c) => c.id === 'enterprise-canteen-del');
    assert.equal(gone, undefined, 'deleted canteen no longer in list');
  });
});

/* ================================================================== */
/*  4. Admin bulk import dishes                                        */
/* ================================================================== */
describe('Admin bulk import dishes', () => {
  setup();

  let adminToken;

  before(async () => {
    const { data } = await req('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin123' },
    });
    adminToken = data.token;
  });

  it('preview splits valid and invalid rows with row-level errors', async () => {
    const csvText = [
      '菜品ID,档口ID,菜名,价格,口味,菜系,食材,标签,热量,蛋白,脂肪,碳水',
      'csv-valid-1,n-protein,鸡胸饭,18,清爽,轻食,"鸡胸肉,糙米","高蛋白,低脂",520,38,9,68',
      'csv-bad,,,,辣,川菜,,,0,0,0,-1',
    ].join('\n');

    const preview = await req('/api/admin/dishes/import/preview', { method: 'POST', token: adminToken, body: { csvText } });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.validCount, 1);
    assert.equal(preview.data.errorCount, 1);
    assert.ok(preview.data.rows[0].valid);
    assert.deepEqual(preview.data.rows[0].errors, []);
    assert.ok(!preview.data.rows[1].valid);
    assert.ok(preview.data.rows[1].errors.some((e) => /缺少档口ID/.test(e)));
    assert.ok(preview.data.rows[1].errors.some((e) => /缺少菜名/.test(e)));
    assert.ok(preview.data.rows[1].errors.some((e) => /碳水必须是非负数字/.test(e)));
  });

  it('quoted CSV fields with embedded commas parse correctly', async () => {
    const csvText = [
      '菜品ID,档口ID,菜名,价格,口味,菜系,食材,标签,热量,蛋白,脂肪,碳水',
      'csv-comma-1,n-protein,"鸡胸饭,大份",18,清爽,轻食,"鸡胸肉, 糙米, 橄榄油","高蛋白, 低脂, 健身",520,38,9,68',
    ].join('\n');

    const preview = await req('/api/admin/dishes/import/preview', { method: 'POST', token: adminToken, body: { csvText } });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.validCount, 1);
    assert.equal(preview.data.rows[0].dish.name, '鸡胸饭,大份');
    assert.deepEqual(preview.data.rows[0].dish.ingredients, ['鸡胸肉', '糙米', '橄榄油']);
    assert.deepEqual(preview.data.rows[0].dish.tags, ['高蛋白', '低脂', '健身']);
  });

  it('confirm rejects CSV that contains validation errors', async () => {
    const csvText = [
      '菜品ID,档口ID,菜名,价格,口味,菜系,食材,标签,热量,蛋白,脂肪,碳水',
      'csv-valid-2,n-protein,鸡胸饭,18,清爽,轻食,鸡胸肉,高蛋白,520,38,9,68',
      'csv-bad-2,,,,辣,川菜,,,0,0,0,-1',
    ].join('\n');

    const rejected = await req('/api/admin/dishes/import/confirm', { method: 'POST', token: adminToken, body: { csvText } });
    assert.equal(rejected.status, 400);
  });

  it('confirm imports a valid-only CSV and persists the dish', async () => {
    const csvText = [
      '菜品ID,档口ID,菜名,价格,口味,菜系,食材,标签,热量,蛋白,脂肪,碳水',
      'csv-confirm-1,n-protein,确认鸡胸饭,18,清爽,轻食,鸡胸肉,高蛋白,520,38,9,68',
    ].join('\n');

    const confirmed = await req('/api/admin/dishes/import/confirm', { method: 'POST', token: adminToken, body: { csvText } });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.data.imported, 1);
    assert.ok(confirmed.data.state.dishes.some((dish) => dish.id === 'csv-confirm-1'));
  });

  it('student cannot preview CSV dish import', async () => {
    const { data: loginData } = await req('/api/auth/login', { method: 'POST', body: { username: '演示学生', password: 'student123' } });
    const csvText = '菜品ID,档口ID,菜名,价格,口味,菜系,食材,标签,热量,蛋白,脂肪,碳水\nx,n,x,1,x,x,x,x,0,0,0,0';
    const denied = await req('/api/admin/dishes/import/preview', { method: 'POST', token: loginData.token, body: { csvText } });
    assert.equal(denied.status, 403);
  });

  it('malformed CSV with unclosed quote returns 400', async () => {
    const csvText = [
      '菜品ID,档口ID,菜名,价格,口味,菜系,食材,标签,热量,蛋白,脂肪,碳水',
      'csv-bad-quote,n-protein,"未闭合引号,18,清爽,轻食,鸡胸肉,高蛋白,520,38,9,68',
    ].join('\n');

    const res = await req('/api/admin/dishes/import/preview', { method: 'POST', token: adminToken, body: { csvText } });
    assert.equal(res.status, 400);
  });
});

/* ================================================================== */
/*  5. Upload endpoint                                                 */
/* ================================================================== */
describe('POST /api/uploads', () => {
  setup();

  let adminToken;

  before(async () => {
    const { data } = await req('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin123' },
    });
    adminToken = data.token;
  });

  it('accepts authenticated JSON upload with filename, contentType, dataBase64', async () => {
    const payload = {
      filename: 'test-image.png',
      contentType: 'image/png',
      dataBase64: Buffer.from('fake-png-bytes').toString('base64'),
    };
    const { status, data } = await req('/api/uploads', {
      method: 'POST',
      token: adminToken,
      body: payload,
    });
    assert.equal(status, 201, 'upload should return 201');
    assert.ok(data.url || data.id, 'response contains url or id');
    assert.equal(data.filename, 'test-image.png');
    assert.equal(data.contentType, 'image/png');
  });

  it('rejects anonymous upload without auth token', async () => {
    const { status } = await req('/api/uploads', {
      method: 'POST',
      body: { filename: 'anon.png', contentType: 'image/png', dataBase64: Buffer.from('anon').toString('base64') },
    });
    assert.equal(status, 401, 'anonymous upload rejected');
  });

  it('rejects authenticated upload missing required fields', async () => {
    const { status } = await req('/api/uploads', {
      method: 'POST',
      token: adminToken,
      body: { filename: 'test.png' },
    });
    assert.ok(status >= 400, 'missing fields should return 4xx');
  });
});

/* ================================================================== */
/*  6. RAG search endpoint                                             */
/* ================================================================== */
describe('GET /api/rag/search', () => {
  setup();

  it('returns ranked documents for a keyword query', async () => {
    const { status, data } = await req('/api/rag/search?q=鸡胸肉');
    assert.equal(status, 200, 'search should return 200');
    assert.ok(Array.isArray(data.results), 'results is array');
    assert.ok(data.results.length > 0, 'at least one result for seeded dish keyword');
    // Each result has required fields
    for (const result of data.results) {
      assert.ok(result.title || result.name, 'result has title/name');
      assert.ok(result.score !== undefined, 'result has a relevance score');
      assert.ok(result.content || result.snippet, 'result has content/snippet');
    }
  });

  it('returns empty results for nonsensical query', async () => {
    const { status, data } = await req('/api/rag/search?q=xyznonexistent999');
    assert.equal(status, 200, 'empty results still 200');
    assert.ok(Array.isArray(data.results), 'results is array');
    assert.equal(data.results.length, 0, 'no results for gibberish');
  });

  it('rejects missing query parameter', async () => {
    const { status } = await req('/api/rag/search');
    assert.ok(status >= 400, 'missing q parameter should return 4xx');
  });
});

/* ================================================================== */
/*  7. Agent meal-advisor endpoint                                     */
/* ================================================================== */
describe('POST /api/agent/meal-advisor', () => {
  setup();

  it('returns answer, citations, and plan for a meal question', async () => {
    const { status, data } = await req('/api/agent/meal-advisor', {
      method: 'POST',
      body: { query: '减脂期午餐推荐什么？' },
    });
    assert.equal(status, 200, 'advisor should return 200');
    assert.ok(typeof data.answer === 'string' && data.answer.length > 0, 'answer is non-empty string');
    assert.ok(Array.isArray(data.citations), 'citations is array');
    // Citations must reference real dishes — not fabricated
    assert.ok(data.citations.length > 0, 'at least one citation');
    for (const citation of data.citations) {
      assert.ok(typeof citation === 'object', 'citation is object');
      assert.ok(citation.id || citation.name, 'citation has id or name');
    }
    assert.ok(data.plan, 'plan is present');
    if (data.plan.picks) {
      assert.ok(Array.isArray(data.plan.picks), 'plan.picks is array');
      for (const pick of data.plan.picks) {
        assert.ok(pick.name, 'pick has name');
        assert.ok(typeof pick.price === 'number', 'pick has numeric price');
      }
    }
  });

  it('returns 400 for empty query', async () => {
    const { status } = await req('/api/agent/meal-advisor', {
      method: 'POST',
      body: { query: '' },
    });
    assert.ok(status >= 400, 'empty query should be rejected');
  });
});

/* ================================================================== */
/*  8. Rankings invalidation after review write                        */
/* ================================================================== */
describe('Rankings invalidation after review', () => {
  setup();

  let studentToken;
  let adminToken;

  before(async () => {
    const { data: sLogin } = await req('/api/auth/login', {
      method: 'POST',
      body: { username: '演示学生', password: 'student123' },
    });
    studentToken = sLogin.token;

    const { data: aLogin } = await req('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin123' },
    });
    adminToken = aLogin.token;
  });

  it('ranking scores change after a new review is posted and approved', async () => {
    // Capture baseline rankings
    const { data: before } = await req('/api/rankings');
    assert.ok(Array.isArray(before.dishes), 'rankings has dishes');
    const dishId = before.dishes[0]?.id;
    assert.ok(dishId, 'at least one dish in rankings');

    const beforeDish = before.dishes.find((d) => d.id === dishId);
    const beforeScore = beforeDish.rankScore;

    // Post a review with a different rating to perturb the score (created as pending)
    const lowRating = beforeDish.rating >= 3 ? 1 : 5;
    const { status: reviewStatus } = await req('/api/reviews', {
      method: 'POST',
      token: studentToken,
      body: {
        targetId: dishId,
        rating: lowRating,
        content: '企业功能测试评论',
      },
    });
    assert.equal(reviewStatus, 201, 'review posted');

    // Retrieve the pending review via admin list and approve it
    const { data: pendingList } = await req('/api/admin/reviews?status=pending', { token: adminToken });
    const pending = pendingList.reviews.find((r) => r.targetId === dishId);
    assert.ok(pending, 'pending review found in admin list');
    const { status: approveStatus } = await req(`/api/admin/reviews/${pending.id}/status`, {
      method: 'PUT',
      token: adminToken,
      body: { status: 'approved' },
    });
    assert.equal(approveStatus, 200, 'review approved');

    // Re-fetch rankings — score should now reflect the approved review
    const { data: after } = await req('/api/rankings');
    const afterDish = after.dishes.find((d) => d.id === dishId);
    assert.ok(afterDish, 'dish still in rankings');
    assert.notEqual(
      afterDish.rankScore,
      beforeScore,
      'rankScore should change after approved review',
    );
  });

  it('admin writing a dish does not corrupt ranking data', async () => {
    const { data: before } = await req('/api/rankings');
    const dishCount = before.dishes.length;

    // Admin adds a new dish
    await req('/api/admin/dishes', {
      method: 'POST',
      token: adminToken,
      body: {
        id: 'rank-test-dish',
        stallId: 'n-protein',
        name: '排名测试菜',
        price: 25,
        taste: '咸香',
        cuisine: '中餐',
        ingredients: '测试肉',
        tags: '测试',
        nutrition: { calories: 300, protein: 30, fat: 8, carbs: 15 },
      },
    });

    const { data: after } = await req('/api/rankings');
    assert.ok(
      after.dishes.length === dishCount + 1,
      'new dish appears in rankings',
    );
    const added = after.dishes.find((d) => d.id === 'rank-test-dish');
    assert.ok(added, 'admin-added dish is in rankings');
    assert.ok(typeof added.rankScore === 'number', 'new dish has rankScore');
  });
});
