import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('server/migrations/020_campus_venue_catalog.sql', 'utf8');
const database = readFileSync('server/database.js', 'utf8');
const server = readFileSync('server/app.js', 'utf8');
const promotion = readFileSync('scripts/promote-real-catalog-postgres.mjs', 'utf8');
const normalizer = readFileSync('scripts/normalize-real-catalog.py', 'utf8');
const adminView = readFileSync('src/views/AdminCatalogView.vue', 'utf8');
const webView = readFileSync('src/views/CanteensView.vue', 'utf8');
const miniappList = readFileSync('miniapp/src/pages/canteens/canteens.vue', 'utf8');
const miniappDetail = readFileSync('miniapp/src/pages/canteen-detail/canteen-detail.vue', 'utf8');

describe('campus venue catalog hierarchy', () => {
  it('ships the six ordered root venues and canonical child names', () => {
    for (const field of ['display_name', 'display_order', 'operating_status']) {
      assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${field}`));
      assert.match(database, new RegExp(field));
    }
    const orderedRoots = [
      ['campus-main', '大食堂', 1],
      ['east-zone', '燕鸣湖', 2],
      ['west-yanyuan', '燕园', 3],
      ['east-shanshuiyuan', '山水园', 4],
      ['east-guangyuan', '广源超市', 5],
      ['east-dongdahuo', '东大活', 6],
    ];
    for (const [id, displayName, order] of orderedRoots) {
      assert.match(migration, new RegExp(id));
      assert.match(migration, new RegExp(displayName));
      assert.match(normalizer, new RegExp(`\"${id}\"`));
      assert.match(promotion, new RegExp(`'${id}'`));
      assert.match(migration, new RegExp(`WHEN id = '${id}' THEN ${order}|'${displayName}', ${order}`));
    }
    for (const name of ['民族餐厅', '心怡餐厅', '禧进甲餐厅', '二楼东厅', '大榕树餐厅', '三楼东厅']) assert.match(migration, new RegExp(name));
    assert.match(migration, /三楼西/);
    assert.match(migration, /east-yanminghu-1f'[\s\S]*'一楼'/);
    assert.match(migration, /east-yanminghu-2f'[\s\S]*'二楼'/);
    assert.match(promotion, /TARGET_CANTEEN_COUNT = 14/);
    assert.match(promotion, /\[12, TARGET_CANTEEN_COUNT\]\.includes\(counts\.canteens\)/);
    assert.match(promotion, /inspection\.counts\.canteens === TARGET_CANTEEN_COUNT/);
    assert.match(promotion, /preparedSource && Object\.hasOwn\(row, column\)/);
    assert.match(promotion, /Production catalog import changed runtime table/);
  });

  it('loads dishes only after a stall opens and paginates by thirty', () => {
    assert.match(server, /listAdminStallDishes/);
    assert.match(server, /pageSize'\), 30, 100/);
    assert.match(server, /admin[\s\S]*catalog[\s\S]*stalls[\s\S]*dishes/);
    assert.match(adminView, /expandedStallByScope/);
    assert.match(adminView, /isStallExpanded/);
    assert.match(adminView, /loadAdminStallDishes/);
    assert.match(adminView, /pageSize:\s*30/);
    assert.match(adminView, /加载更多/);
    assert.doesNotMatch(adminView, /store\.loadAdminCatalogArea\(/);
  });

  it('keeps renovating venues visible but blocks student entry and reservations', () => {
    assert.match(migration, /operating_status IN \('open', 'renovating', 'closed'\)/);
    assert.match(server, /VENUE_NOT_OPEN/);
    assert.match(server, /c\.operating_status = 'open'/);
    assert.match(webView, /operatingStatus !== 'open'/);
    assert.match(miniappList, /operatingStatus!=='open'/);
    assert.match(miniappDetail, /场所装修中/);
    assert.match(adminView, /装修中/);
  });
});
