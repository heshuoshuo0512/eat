import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { createToken } from '../server/security.js';

let server;
let baseUrl;
let db;
let adminToken;
let studentToken;
let operatorToken;
let stallAdminToken;
let tenantAdminToken;

async function request(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function login(username, password) {
  const result = await request('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.equal(result.status, 200);
  return result.data.token;
}

function findFirstDish(tree) {
  for (const region of tree.regions || []) {
    for (const canteen of region.canteens || []) {
      for (const stall of canteen.stalls || []) {
        if (stall.directDishes?.length) return stall.directDishes[0];
        for (const child of stall.children || []) {
          if (child.directDishes?.length) return child.directDishes[0];
        }
      }
    }
  }
  return null;
}

describe('admin catalog tree', () => {
  before(async () => {
    db = openDatabase(':memory:');
    const app = createApp({ db });
    server = createServer(app.handler);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    adminToken = await login('admin', 'admin123');
    const registered = await request('/api/auth/register', {
      method: 'POST',
      body: { username: 'catalog-student', password: 'student123', nickname: 'Catalog Student' }
    });
    assert.equal(registered.status, 201);
    studentToken = registered.data.token;

    for (const [username, role] of [['catalog-operator', 'operator'], ['catalog-stall-admin', 'stall_admin']]) {
      const account = await request('/api/auth/register', {
        method: 'POST',
        body: { username, password: 'catalog123', nickname: username }
      });
      assert.equal(account.status, 201);
      const promoted = await request(`/api/admin/users/${encodeURIComponent(account.data.user.id)}`, {
        method: 'PUT',
        token: adminToken,
        body: { role }
      });
      assert.equal(promoted.status, 200);
      const token = await login(username, 'catalog123');
      if (role === 'operator') operatorToken = token;
      else stallAdminToken = token;
    }

    const timestamp = new Date().toISOString();
    const seededAdmin = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get('u-admin');
    await db.prepare('INSERT INTO tenants (id, name, status, plan, ai_quota, storage_quota_mb, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('catalog-tenant-b', '目录隔离租户', 'active', 'starter', 1000, 10240, timestamp, timestamp);
    await db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('u-catalog-tenant-b', 'catalog-tenant-admin', seededAdmin.password_hash, '租户 B 管理员', 'tenant_admin', 'catalog-tenant-b', timestamp, timestamp);
    tenantAdminToken = createToken(await db.prepare('SELECT * FROM users WHERE id = ?').get('u-catalog-tenant-b'));
  });

  after(() => server.close());

  it('exposes the fixed four regions in stable order with summary counts', async () => {
    const result = await request('/api/admin/catalog/tree?include=summary&limit=20&offset=0', { token: adminToken });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.regions.map((region) => region.id), ['campus-main', 'north-zone', 'south-zone', 'east-zone']);
    assert.equal(result.data.total, 4);
    assert.ok(result.data.regions.every((region) => region.counts && typeof region.missing === 'boolean'));
    const [complex, ...multiFloorCanteens] = result.data.regions;
    assert.equal(complex.venueType, 'dining_complex');
    assert.equal(complex.areaType, 'restaurant');
    assert.equal(complex.areaLabel, '餐厅');
    assert.equal(complex.labels.area, '餐厅');
    assert.ok(complex.canteens.every((area) => area.areaType === 'restaurant' && area.areaLabel === '餐厅' && area.displayName === area.canteen.name));
    assert.ok(multiFloorCanteens.every((region) => region.venueType === 'multi_floor_canteen'));
    assert.ok(multiFloorCanteens.every((region) => region.areaType === 'floor_area' && region.labels.area === '楼层餐区'));
    assert.ok(multiFloorCanteens.every((region) => region.canteens.every((area) => area.areaType === 'floor_area' && area.areaLabel === '楼层餐区')));
    assert.ok(result.data.regions.every((region) => typeof region.counts.openStalls === 'number'));
    const serialized = JSON.stringify(result.data);
    assert.doesNotMatch(serialized, /allDirectDishes/);
  });

  it('uses the tenant database name while retaining the fixed venue default', async () => {
    const existing = await db.prepare('SELECT name FROM canteens WHERE tenant_id = ? AND id = ?').get('default', 'campus-main');
    assert.ok(existing);
    const databaseName = '学校正式综合餐饮楼';
    try {
      await db.prepare('UPDATE canteens SET name = ? WHERE tenant_id = ? AND id = ?').run(databaseName, 'default', 'campus-main');
      const result = await request('/api/admin/catalog/tree?venueId=campus-main', { token: adminToken });
      assert.equal(result.status, 200);
      assert.equal(result.data.regions[0].name, databaseName);
      assert.equal(result.data.regions[0].displayName, databaseName);
      assert.equal(result.data.regions[0].region.name, databaseName);
      assert.equal(result.data.regions[0].defaultName, '综合餐饮楼');
    } finally {
      await db.prepare('UPDATE canteens SET name = ? WHERE tenant_id = ? AND id = ?').run(existing.name, 'default', 'campus-main');
    }
  });

  it('can restore a missing fixed venue without changing its fixed id', async () => {
    const id = 'east-zone';
    const original = await db.prepare('SELECT * FROM canteens WHERE tenant_id = ? AND id = ?').get('default', id);
    assert.ok(original);
    await db.prepare('DELETE FROM canteens WHERE tenant_id = ? AND id = ?').run('default', id);

    const missing = await request(`/api/admin/catalog/tree?venueId=${id}`, { token: adminToken });
    assert.equal(missing.status, 200);
    assert.equal(missing.data.regions[0].missing, true);

    const restored = await request(`/api/admin/canteens/${id}`, {
      method: 'PUT',
      token: adminToken,
      body: {
        id,
        name: original.name,
        location: original.location,
        hours: original.hours,
        crowdLevel: original.crowd_level,
        tags: JSON.parse(original.tags_json || '[]'),
        description: original.description,
        parentId: null,
        canteenType: 'primary',
        imageUrl: original.image || undefined
      }
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.data.savedId, id);
    assert.ok(restored.data.canteens.some((canteen) => canteen.id === id));
  });

  it('never overwrites another tenant when a fixed venue id is already reserved', async () => {
    const before = await db.prepare('SELECT tenant_id, name FROM canteens WHERE id = ?').get('campus-main');
    assert.equal(before.tenant_id, 'default');
    const result = await request('/api/admin/canteens/campus-main', {
      method: 'PUT',
      token: tenantAdminToken,
      body: {
        id: 'campus-main',
        name: '租户 B 综合餐饮楼',
        location: '租户 B 校园',
        hours: '07:00 - 21:00',
        description: '不得覆盖默认租户记录',
        parentId: null,
        canteenType: 'primary'
      }
    });
    assert.equal(result.status, 409);
    assert.equal(result.data.code, 'CANTEEN_ID_TENANT_CONFLICT');
    const after = await db.prepare('SELECT tenant_id, name FROM canteens WHERE id = ?').get('campus-main');
    assert.deepEqual(after, before);
    const tenantRecord = await db.prepare('SELECT id FROM canteens WHERE tenant_id = ? AND id = ?').get('catalog-tenant-b', 'campus-main');
    assert.equal(tenantRecord, undefined);
  });

  it('enforces fixed venue and dining-area parent boundaries', async () => {
    const fixedVenue = await db.prepare('SELECT * FROM canteens WHERE tenant_id = ? AND id = ?').get('default', 'campus-main');
    const area = await db.prepare('SELECT * FROM canteens WHERE tenant_id = ? AND parent_id = ? ORDER BY id LIMIT 1').get('default', 'campus-main');
    assert.ok(fixedVenue);
    assert.ok(area);
    const bodyFor = (row, parentId) => ({
      id: row.id,
      name: row.name,
      location: row.location,
      hours: row.hours,
      crowdLevel: row.crowd_level,
      tags: JSON.parse(row.tags_json || '[]'),
      description: row.description,
      parentId,
      canteenType: row.canteen_type,
      imageUrl: row.image || undefined
    });

    const fixedParent = await request('/api/admin/canteens/campus-main', {
      method: 'PUT',
      token: adminToken,
      body: bodyFor(fixedVenue, 'east-zone')
    });
    assert.equal(fixedParent.status, 400);
    assert.equal(fixedParent.data.code, 'CANTEEN_FIXED_PARENT_FORBIDDEN');

    const normalizedFixedBody = bodyFor(fixedVenue, null);
    normalizedFixedBody.canteenType = 'sub';
    const normalizedFixed = await request('/api/admin/canteens/campus-main', {
      method: 'PUT',
      token: adminToken,
      body: normalizedFixedBody
    });
    assert.equal(normalizedFixed.status, 200);
    assert.equal(normalizedFixed.data.canteens.find((canteen) => canteen.id === fixedVenue.id)?.canteenType, 'primary');

    const inheritedParentBody = bodyFor(area, area.parent_id);
    delete inheritedParentBody.parentId;
    inheritedParentBody.canteenType = 'primary';
    const inheritedParent = await request(`/api/admin/canteens/${encodeURIComponent(area.id)}`, {
      method: 'PUT',
      token: adminToken,
      body: inheritedParentBody
    });
    assert.equal(inheritedParent.status, 200);
    assert.equal(inheritedParent.data.canteens.find((canteen) => canteen.id === area.id)?.parentId, area.parent_id);
    assert.equal(inheritedParent.data.canteens.find((canteen) => canteen.id === area.id)?.canteenType, 'sub');

    const clearedArea = await request(`/api/admin/canteens/${encodeURIComponent(area.id)}`, {
      method: 'PUT',
      token: adminToken,
      body: bodyFor(area, null)
    });
    assert.equal(clearedArea.status, 400);
    assert.equal(clearedArea.data.code, 'CANTEEN_AREA_PARENT_REQUIRED');

    const invalidAreaParent = await request(`/api/admin/canteens/${encodeURIComponent(area.id)}`, {
      method: 'PUT',
      token: adminToken,
      body: bodyFor(area, 'missing-venue')
    });
    assert.equal(invalidAreaParent.status, 400);
    assert.equal(invalidAreaParent.data.code, 'CANTEEN_PARENT_NOT_FOUND');

    const blockedDelete = await request('/api/admin/canteens/campus-main', { method: 'DELETE', token: adminToken });
    assert.equal(blockedDelete.status, 409);
    assert.equal(blockedDelete.data.code, 'CANTEEN_HAS_AREAS');
  });

  it('never overwrites another tenant when a dish id is reused', async () => {
    const timestamp = new Date().toISOString();
    await db.prepare('INSERT INTO canteens (id, tenant_id, name, location, hours, crowd_level, tags_json, description, parent_id, canteen_type, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('catalog-tenant-b-area', 'catalog-tenant-b', '租户 B 餐区', '租户 B 校园', '07:00 - 21:00', 30, '[]', '租户隔离测试', null, 'primary', '', timestamp, timestamp);
    await db.prepare('INSERT INTO stalls (id, tenant_id, canteen_id, parent_id, floor, name, category, rating, avg_price, open, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('catalog-tenant-b-stall', 'catalog-tenant-b', 'catalog-tenant-b-area', null, '1F', '租户 B 档口', '测试', 4.5, 15, 1, '租户隔离测试', timestamp, timestamp);
    const existingDish = await db.prepare('SELECT id, name, tenant_id FROM dishes WHERE tenant_id = ? ORDER BY id LIMIT 1').get('default');
    const result = await request('/api/admin/dishes', {
      method: 'POST',
      token: tenantAdminToken,
      body: {
        id: existingDish.id,
        stallId: 'catalog-tenant-b-stall',
        name: '不得覆盖的租户 B 菜品',
        price: 12,
        taste: '清淡',
        cuisine: '测试',
        ingredients: ['测试食材'],
        tags: ['测试标签'],
        nutrition: { calories: 100, protein: 10, fat: 2, carbs: 12 }
      }
    });
    assert.equal(result.status, 409);
    assert.equal(result.data.code, 'DISH_ID_TENANT_CONFLICT');
    const after = await db.prepare('SELECT id, name, tenant_id FROM dishes WHERE id = ?').get(existingDish.id);
    assert.deepEqual(after, existingDish);
  });

  it('supports context filters and returns parent paths for dish search', async () => {
    const full = await request('/api/admin/catalog/tree?include=dishes&regionId=campus-main&limit=20&offset=0', { token: adminToken });
    assert.equal(full.status, 200);
    const dish = findFirstDish(full.data);
    assert.ok(dish, 'seed data should contain a dish in a fixed region');

    const searched = await request(`/api/admin/catalog/tree?include=summary&q=${encodeURIComponent(dish.name)}&regionId=campus-main`, { token: adminToken });
    assert.equal(searched.status, 200);
    assert.ok(searched.data.regions[0].canteens.length, 'dish search keeps the matching canteen path');
    assert.ok(searched.data.regions[0].canteens[0].stalls.length, 'dish search keeps the matching stall path');

    const filtered = await request(`/api/admin/catalog/tree?include=dishes&venueId=campus-main&areaId=${encodeURIComponent(searched.data.regions[0].canteens[0].canteen.id)}&limit=1&offset=0`, { token: adminToken });
    assert.equal(filtered.status, 200);
    assert.equal(filtered.data.regions.length, 1);
    assert.equal(filtered.data.regions[0].id, 'campus-main');
    assert.equal(filtered.data.regions[0].canteens.length, 1);
  });

  it('allows catalog operators, rejects students and exposes parentId in nested nodes', async () => {
    const forbidden = await request('/api/admin/catalog/tree', { token: studentToken });
    assert.equal(forbidden.status, 403);

    for (const token of [operatorToken, stallAdminToken]) {
      const allowed = await request('/api/admin/catalog/tree?include=summary', { token });
      assert.equal(allowed.status, 200);
      assert.equal(allowed.data.total, 4);
    }

    const result = await request('/api/admin/catalog/tree?include=dishes', { token: adminToken });
    assert.equal(result.status, 200);
    const primary = result.data.regions.flatMap((region) => region.canteens.flatMap((canteen) => canteen.stalls))[0];
    assert.ok(primary, 'seed data should contain at least one stall');
    assert.equal(primary.stall.parentId, null);
    assert.equal(Object.prototype.hasOwnProperty.call(primary.stall, 'parent_id'), false);
  });

  it('rejects new direct venue stalls while preserving and migrating historical stalls', async () => {
    const tree = await request('/api/admin/catalog/tree?venueId=campus-main', { token: adminToken });
    const areaId = tree.data.regions[0].canteens[0].canteen.id;
    const parentId = 'catalog-legacy-parent';
    const childId = 'catalog-legacy-child';
    const directId = 'catalog-unassigned-stall';
    const legacyDishId = 'catalog-legacy-dish';
    const stallBody = (id, canteenId, name, parentIdValue = null) => ({
      id,
      canteenId,
      parentId: parentIdValue,
      name,
      floor: '1F',
      category: '测试档口',
      avgPrice: 12,
      open: true,
      description: '目录契约测试数据'
    });
    const dishBody = (id, stallId, name = '历史层级菜品') => ({
      id,
      stallId,
      name,
      price: 12,
      taste: '清淡',
      cuisine: '测试菜系',
      ingredients: ['测试食材'],
      tags: ['测试标签'],
      nutrition: { calories: 120, protein: 10, fat: 3, carbs: 15 }
    });

    try {
      const parent = await request('/api/admin/stalls', { method: 'POST', token: adminToken, body: stallBody(parentId, areaId, '历史父档口') });
      const rejectedDirect = await request('/api/admin/stalls', { method: 'POST', token: adminToken, body: stallBody(directId, 'campus-main', '待归类档口') });
      const rejectedChild = await request('/api/admin/stalls', { method: 'POST', token: adminToken, body: stallBody(childId, areaId, '历史子档口', parentId) });
      assert.equal(parent.status, 201);
      assert.equal(rejectedDirect.status, 400);
      assert.equal(rejectedDirect.data.code, 'STALL_AREA_REQUIRED');
      assert.equal(rejectedChild.status, 400);
      assert.equal(rejectedChild.data.code, 'STALL_PARENT_LEGACY_ONLY');
      assert.equal(parent.data.savedId, parentId);
      const timestamp = new Date().toISOString();
      await db.prepare('INSERT INTO stalls (id, tenant_id, canteen_id, parent_id, floor, name, category, rating, avg_price, open, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(directId, 'default', 'campus-main', null, '1F', '待归类档口', '测试档口', 4.5, 12, 1, '历史直属数据', timestamp, timestamp);
      await db.prepare('INSERT INTO stalls (id, tenant_id, canteen_id, parent_id, floor, name, category, rating, avg_price, open, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(childId, 'default', areaId, parentId, '1F', '历史子档口', '测试档口', 4.5, 12, 1, '历史兼容数据', timestamp, timestamp);

      const catalog = await request('/api/admin/catalog/tree?include=dishes&venueId=campus-main', { token: adminToken });
      const venue = catalog.data.regions[0];
      assert.ok(venue.unassignedStalls.some((node) => node.stall.id === directId));
      const parentNode = venue.canteens.flatMap((area) => area.stalls).find((node) => node.stall.id === parentId);
      const legacyChild = parentNode.children.find((node) => node.stall.id === childId);
      assert.equal(legacyChild.legacyHierarchy, true);
      assert.equal(legacyChild.stall.parentId, parentId);

      const rejectedDirectDish = await request('/api/admin/dishes', {
        method: 'POST',
        token: adminToken,
        body: dishBody('catalog-rejected-direct-dish', directId)
      });
      assert.equal(rejectedDirectDish.status, 400);
      assert.equal(rejectedDirectDish.data.code, 'DISH_STALL_AREA_REQUIRED');

      const rejectedChildDish = await request('/api/admin/dishes', {
        method: 'POST',
        token: adminToken,
        body: dishBody('catalog-rejected-child-dish', childId)
      });
      assert.equal(rejectedChildDish.status, 400);
      assert.equal(rejectedChildDish.data.code, 'DISH_STALL_AREA_REQUIRED');

      const createdLegacyDish = await request('/api/admin/dishes', {
        method: 'POST',
        token: adminToken,
        body: dishBody(legacyDishId, parentId)
      });
      assert.equal(createdLegacyDish.status, 201);
      await db.prepare('UPDATE dishes SET stall_id = ? WHERE tenant_id = ? AND id = ?').run(directId, 'default', legacyDishId);

      const editedLegacyDish = await request(`/api/admin/dishes/${legacyDishId}`, {
        method: 'PUT',
        token: adminToken,
        body: dishBody(legacyDishId, directId, '已编辑历史层级菜品')
      });
      assert.equal(editedLegacyDish.status, 200);
      assert.equal(editedLegacyDish.data.savedEntity.stallId, directId);

      const rejectedLegacyMove = await request(`/api/admin/dishes/${legacyDishId}`, {
        method: 'PUT',
        token: adminToken,
        body: dishBody(legacyDishId, childId, '不应迁移到历史子档口')
      });
      assert.equal(rejectedLegacyMove.status, 400);
      assert.equal(rejectedLegacyMove.data.code, 'DISH_STALL_AREA_REQUIRED');

      const migratedLegacyDish = await request(`/api/admin/dishes/${legacyDishId}`, {
        method: 'PUT',
        token: adminToken,
        body: dishBody(legacyDishId, parentId, '已迁移菜品')
      });
      assert.equal(migratedLegacyDish.status, 200);
      assert.equal(migratedLegacyDish.data.savedEntity.stallId, parentId);

      const editedDirect = await request(`/api/admin/stalls/${directId}`, {
        method: 'PUT',
        token: adminToken,
        body: { name: '已编辑待归类档口' }
      });
      assert.equal(editedDirect.status, 200);
      assert.equal(editedDirect.data.savedId, directId);

      const invalidDirectMove = await request(`/api/admin/stalls/${directId}`, {
        method: 'PUT',
        token: adminToken,
        body: { canteenId: 'north-zone' }
      });
      assert.equal(invalidDirectMove.status, 400);
      assert.equal(invalidDirectMove.data.code, 'STALL_AREA_REQUIRED');

      const migratedDirect = await request(`/api/admin/stalls/${directId}`, {
        method: 'PUT',
        token: adminToken,
        body: { canteenId: areaId }
      });
      assert.equal(migratedDirect.status, 200);
      assert.equal(migratedDirect.data.savedId, directId);

      const migrated = await request(`/api/admin/stalls/${childId}`, {
        method: 'PUT',
        token: adminToken,
        body: { canteenId: areaId, parentId: null }
      });
      assert.equal(migrated.status, 200);
      assert.equal(migrated.data.savedId, childId);

      const refreshed = await request(`/api/admin/catalog/tree?venueId=campus-main&areaId=${encodeURIComponent(areaId)}`, { token: adminToken });
      const migratedNode = refreshed.data.regions[0].canteens[0].stalls.find((node) => node.stall.id === childId);
      assert.ok(migratedNode);
      assert.equal(migratedNode.stall.parentId, null);
      assert.equal(migratedNode.legacyHierarchy, false);
      assert.ok(refreshed.data.regions[0].canteens[0].stalls.some((node) => node.stall.id === directId));
    } finally {
      await db.prepare('DELETE FROM rag_documents WHERE tenant_id = ? AND source_type = ? AND source_id = ?').run('default', 'dish', legacyDishId);
      await db.prepare('DELETE FROM dishes WHERE tenant_id = ? AND id = ?').run('default', legacyDishId);
      await db.prepare('DELETE FROM stalls WHERE tenant_id = ? AND id = ?').run('default', childId);
      await db.prepare('DELETE FROM stalls WHERE tenant_id = ? AND id = ?').run('default', directId);
      await db.prepare('DELETE FROM stalls WHERE tenant_id = ? AND id = ?').run('default', parentId);
    }
  });

  it('returns savedId for new dining areas, stalls and dishes', async () => {
    const areaId = 'catalog-saved-area';
    const stallId = 'catalog-saved-stall';
    const dishId = 'catalog-saved-dish';
    const areaBody = {
      id: areaId,
      parentId: 'east-zone',
      canteenType: 'sub',
      name: '保存契约餐区',
      location: '测试位置',
      hours: '07:00 - 20:00',
      description: '验证保存实体 ID'
    };
    const area = await request('/api/admin/canteens', {
      method: 'POST',
      token: adminToken,
      body: areaBody
    });
    assert.equal(area.status, 201);
    assert.equal(area.data.savedId, areaId);

    const nestedArea = await request('/api/admin/canteens', {
      method: 'POST',
      token: adminToken,
      body: { ...areaBody, id: 'catalog-nested-area', name: '非法三级餐区', parentId: areaId }
    });
    assert.equal(nestedArea.status, 400);
    assert.equal(nestedArea.data.code, 'CANTEEN_PARENT_NESTED');

    const stallBody = { id: stallId, canteenId: areaId, parentId: null, name: '保存契约档口', floor: '1F', category: '测试', avgPrice: 10, open: true };
    const stall = await request('/api/admin/stalls', {
      method: 'POST',
      token: adminToken,
      body: stallBody
    });
    assert.equal(stall.status, 201);
    assert.equal(stall.data.savedId, stallId);

    const dishBody = {
      id: dishId,
      stallId,
      name: '保存契约菜品',
      price: 10,
      taste: '清淡',
      cuisine: '测试菜系',
      ingredients: ['测试食材'],
      tags: ['测试标签'],
      nutrition: { calories: 100, protein: 10, fat: 2, carbs: 12 }
    };
    const dish = await request('/api/admin/dishes', {
      method: 'POST',
      token: adminToken,
      body: dishBody
    });
    assert.equal(dish.status, 201);
    assert.equal(dish.data.savedId, dishId);
    assert.equal(dish.data.savedEntity.id, dishId);
    assert.equal(dish.data.savedEntity.status, 'active');

    const updatedArea = await request(`/api/admin/canteens/${areaId}`, { method: 'PUT', token: adminToken, body: { ...areaBody, name: '更新后的餐区' } });
    const updatedStall = await request(`/api/admin/stalls/${stallId}`, { method: 'PUT', token: adminToken, body: { name: '更新后的档口' } });
    const updatedDish = await request(`/api/admin/dishes/${dishId}`, { method: 'PUT', token: adminToken, body: { ...dishBody, name: '更新后的菜品' } });
    assert.equal(updatedArea.status, 200);
    assert.equal(updatedArea.data.savedId, areaId);
    assert.equal(updatedStall.status, 200);
    assert.equal(updatedStall.data.savedId, stallId);
    assert.equal(updatedDish.status, 200);
    assert.equal(updatedDish.data.savedId, dishId);

    const hiddenDish = await request(`/api/admin/dishes/${dishId}`, {
      method: 'PUT',
      token: adminToken,
      body: { ...dishBody, status: 'hidden' }
    });
    assert.equal(hiddenDish.status, 200);
    assert.equal(hiddenDish.data.savedEntity.id, dishId);
    assert.equal(hiddenDish.data.savedEntity.status, 'hidden');

    const hiddenCatalog = await request(`/api/admin/catalog/tree?include=dishes&venueId=east-zone&areaId=${areaId}`, { token: adminToken });
    const catalogDish = findFirstDish(hiddenCatalog.data);
    assert.equal(catalogDish.id, dishId);
    assert.equal(catalogDish.status, 'hidden');

    const restoredDish = await request(`/api/admin/dishes/${dishId}`, {
      method: 'PUT',
      token: adminToken,
      body: { ...dishBody, status: 'active' }
    });
    assert.equal(restoredDish.status, 200);
    assert.equal(restoredDish.data.savedEntity.status, 'active');
  });

  it('registers the canonical route and documents the legacy redirect', () => {
    const router = readFileSync('src/router/index.js', 'utf8');
    const view = readFileSync('src/views/AdminCatalogView.vue', 'utf8');
    const client = readFileSync('src/services/apiClient.js', 'utf8');
    const openapi = readFileSync('openapi/smart-canteen.yaml', 'utf8');
    assert.match(router, /path:\s*['"]\/admin\/catalog['"]/);
    assert.match(router, /panel === ['"]data['"][\s\S]*\/admin\/catalog/);
    assert.match(client, /\/api\/admin\/catalog\/tree/);
    assert.match(view, /prefers-reduced-motion/);
    assert.match(openapi, /\/admin\/catalog\/tree:/);
    assert.match(openapi, /name: venueId/);
    assert.match(openapi, /name: areaId/);
    assert.match(openapi, /venueType:/);
    assert.match(openapi, /unassignedStalls:/);
    assert.match(openapi, /legacyHierarchy:/);
  });
});
