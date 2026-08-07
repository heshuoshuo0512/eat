import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../server/migrations/033_targeted_catalog_category_corrections.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../server/rollbacks/033_targeted_catalog_category_corrections.rollback.sql', import.meta.url), 'utf8');

test('033 targeted catalog correction is stable-ID scoped and reversible', () => {
  const ids = [
    'dish-ac282f05b7c41f',
    'dish-b1095ed4fb698a',
    'dish-ace8c088a34851',
    'dish-ff85aeb1e23ed9',
    'dish-48661b438aa112',
    'dish-f2be14fefddff6',
  ];
  for (const id of ids) assert.equal(migration.includes(id), true, `migration missing ${id}`);
  assert.match(migration, /catalog-targeted-corrections-2026-08-08-v1/);
  assert.match(migration, /CREATE TEMP TABLE catalog_category_033_proposed/);
  assert.match(migration, /ON CONFLICT \(tenant_id, batch_id, dish_id\) DO NOTHING/);
  assert.match(migration, /RAISE EXCEPTION '033 target validation failed/);
  assert.match(rollback, /033 rollback refused/);
  assert.match(rollback, /before_item_type/);
  assert.match(rollback, /before_category/);
});
