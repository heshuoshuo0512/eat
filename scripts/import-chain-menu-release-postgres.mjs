#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const sourcePath = resolve(process.argv.find((value) => value.startsWith('--source='))?.slice(9) || 'data/chain-menu-release-2026-08-08.json');
const apply = process.argv.includes('--apply');
const rollback = process.argv.includes('--rollback');
const expectedDigest = process.argv.find((value) => value.startsWith('--digest='))?.slice(9) || '';
const databaseUrl = process.env.DATABASE_MIGRATION_URL;
if (!databaseUrl) throw new Error('DATABASE_MIGRATION_URL is required');
if (apply && rollback) throw new Error('--apply and --rollback are mutually exclusive');
if (!existsSync(sourcePath)) throw new Error(`Release manifest not found: ${sourcePath}`);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertRelease(release) {
  if (release.batchId !== 'chain-menu-release-2026-08-08-v1') throw new Error('Unexpected release batch id');
  if (release.status !== 'approved_for_production' && release.status !== 'imported') throw new Error('Release is not approved');
  if (release.sourceAudit?.excludedSourceFiles?.includes('华莱士.md')) {
    // This is an explicit exclusion marker, not a source to import.
  }
  if (release.items?.some((item) => item.sourceName === '华莱士.md')) throw new Error('Release contains excluded Wallace rows');
  if (Number(release.summary?.acceptedCount) !== 824 || release.items?.length !== 824) throw new Error('Release must contain exactly 824 items');
  const ids = new Set();
  const itemTypes = new Set(['meal', 'snack', 'beverage']);
  const categories = new Set(['汉堡套餐', '饮品', '小吃单品']);
  for (const item of release.items) {
    if (!/^chain-[a-f0-9]{14}$/.test(item.id)) throw new Error(`Invalid stable item id: ${item.id}`);
    if (ids.has(item.id)) throw new Error(`Duplicate stable item id: ${item.id}`);
    ids.add(item.id);
    if (!itemTypes.has(item.itemType) || !categories.has(item.category)) throw new Error(`Unsupported item classification: ${item.id}`);
    if (!Number.isFinite(Number(item.price)) || Number(item.price) < 0) throw new Error(`Invalid item price: ${item.id}`);
    if (!item.stallId || !item.canteenId || !item.location || !item.sourceName || !Number.isInteger(Number(item.sourceLine))) {
      throw new Error(`Incomplete source binding: ${item.id}`);
    }
  }
  if (release.newStalls?.length !== 4) throw new Error('Release must declare exactly four new stalls');
  const digest = sha256(canonical({ batchId: release.batchId, items: release.items, newStalls: release.newStalls }));
  if (digest !== release.releaseDigest) throw new Error('Release digest mismatch');
  return { digest, itemIds: ids };
}

function mappingKey(item) {
  return `${item.stallId}|${item.name}|${Number(item.price).toFixed(2)}`;
}

async function setContext(client) {
  await client.query(
    "SELECT set_config('app.tenant_id','default',true), set_config('app.user_id','chain-menu-release-import',true), set_config('app.role','super_admin',true), set_config('app.request_id',$1,true)",
    [`chain-menu-release-${Date.now()}`],
  );
}

async function validateTarget(client, release) {
  const canteenIds = [...new Set(release.items.map((item) => item.canteenId))];
  const stallIds = [...new Set(release.items.map((item) => item.stallId))];
  const canteens = await client.query('SELECT id, name, review_status, retrieval_eligible FROM canteens WHERE tenant_id = $1 AND id = ANY($2::text[])', ['default', canteenIds]);
  const canteenById = new Map(canteens.rows.map((row) => [row.id, row]));
  for (const id of canteenIds) {
    const row = canteenById.get(id);
    if (!row) throw new Error(`Target canteen does not exist: ${id}`);
    if (row.review_status !== 'approved' || Number(row.retrieval_eligible) !== 1) throw new Error(`Target canteen is not publishable: ${id}`);
  }
  const stalls = await client.query('SELECT id, canteen_id, name, review_status, retrieval_eligible FROM stalls WHERE tenant_id = $1 AND id = ANY($2::text[])', ['default', stallIds]);
  const stallById = new Map(stalls.rows.map((row) => [row.id, row]));
  for (const item of release.items) {
    const row = stallById.get(item.stallId);
    const declaredNew = release.newStalls.some((stall) => stall.stallId === item.stallId);
    if (!row && !declaredNew) throw new Error(`Target stall does not exist: ${item.stallId}`);
    if (row && (row.canteen_id !== item.canteenId || row.review_status !== 'approved' || Number(row.retrieval_eligible) !== 1)) {
      throw new Error(`Target stall binding is invalid: ${item.stallId}`);
    }
  }
  const existingDishRows = await client.query(
    `SELECT d.id, d.stall_id, d.name, d.price
       FROM dishes d
      WHERE d.tenant_id = $1
        AND d.stall_id = ANY($2::text[])
        AND d.status NOT IN ('archived', 'inactive')`,
    ['default', stallIds],
  );
  const existingByKey = new Map(existingDishRows.rows.map((row) => [`${row.stall_id}|${row.name}|${Number(row.price).toFixed(2)}`, row]));
  const duplicateRows = release.items.filter((item) => existingByKey.has(mappingKey(item)));
  if (duplicateRows.length) throw new Error(`Release would duplicate existing dishes: ${duplicateRows.slice(0, 5).map((item) => item.name).join('、')}`);
  return { canteenCount: canteens.rowCount, stallById, existingDishCount: existingDishRows.rowCount };
}

async function ensureStalls(client, release, existingById) {
  const created = [];
  for (const stall of release.newStalls) {
    const existing = existingById.get(stall.stallId);
    if (existing) {
      if (existing.canteen_id !== stall.canteenId || existing.name !== stall.name) throw new Error(`New stall id conflicts with existing record: ${stall.stallId}`);
      created.push({ ...stall, createdByBatch: 0 });
      continue;
    }
    await client.query(
      `INSERT INTO stalls (
        id, tenant_id, canteen_id, parent_id, floor, name, aliases_json, category,
        rating, avg_price, open, reservation_enabled, description,
        review_status, retrieval_eligible, created_at, updated_at
      ) VALUES ($1, 'default', $2, NULL, $3, $4, '[]', $5, 0, 0, 1, FALSE,
        $6, 'approved', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [stall.stallId, stall.canteenId, stall.floor, stall.name, stall.category, '连锁菜单来源已绑定到该档口；现场供应、营业状态和商品事实待核验。'],
    );
    created.push({ ...stall, createdByBatch: 1 });
  }
  return created;
}

async function insertBatch(client, release, stallRecords) {
  await client.query(
    `INSERT INTO chain_menu_release_batches (
      id, tenant_id, status, source_audit_sha256, release_digest, accepted_count,
      approved_by, approved_at, created_at, updated_at
    ) VALUES ($1, 'default', 'approved_for_production', $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [release.batchId, release.sourceAudit.sha256, release.releaseDigest, release.items.length, release.approvedBy, release.approvedAt],
  );
  for (const stall of stallRecords) {
    await client.query(
      `INSERT INTO chain_menu_release_stalls
        (batch_id, tenant_id, stall_id, canteen_id, created_by_batch, name)
       VALUES ($1, 'default', $2, $3, $4, $5)`,
      [release.batchId, stall.stallId, stall.canteenId, stall.createdByBatch, stall.name],
    );
  }
}

async function insertDishes(client, release) {
  const dishSql = `INSERT INTO dishes (
    id, tenant_id, stall_id, name, price, taste, cuisine, ingredients_json, seasonings_json,
    additives_json, tags_json, catalog_item_type, catalog_category, parent_dish_id, halal,
    meal_types_json, calories, protein, fat, carbs, rating, review_count, sales, image, image_url,
    description, status, reservation_enabled, regional_taste, allergens_json,
    safety_declarations_json, dietary_labels_json, nutrition_fact_status, recipe_fact_status,
    halal_fact_status, dietary_fact_status, spice_level, spice_fact_status, fact_source,
    fact_verified_at, fact_expires_at, data_version, synthetic, review_status, retrieval_eligible,
    pricing_mode, price_display, pricing_json, aliases_json, semantic_labels_json, source_ref_json,
    created_at, updated_at
  ) VALUES (
    $1, 'default', $2, $3, $4, '', '', '[]', '[]', '[]', '[]', $5, $6, NULL, 0,
    CASE WHEN $5 = 'beverage' THEN '["breakfast","snack"]' ELSE '["lunch","dinner"]' END,
    0, 0, 0, 0, 0, 0, 0, '🍽️', NULL, $7, 'active', FALSE, '', '[]', '[]', '[]',
    'unknown', 'unknown', 'unknown', 'unknown', NULL, 'unknown', 'chain_menu_document', NULL,
    NULL, $8, 0, 'approved', 1, $9, $10, $11, '[]', '[]', $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )`;
  for (const item of release.items) {
    const description = `商品名称与价格来自${item.sourceName}第${item.sourceLine}行菜单文档；配料、营养、过敏原、供应状态和现场核验状态待确认。`;
    const pricingMode = item.priceMode === 'from' ? 'tiered' : 'fixed';
    const sourceRef = JSON.stringify({
      batchId: release.batchId,
      sourceName: item.sourceName,
      sourceHash: item.sourceHash,
      sourceLine: item.sourceLine,
      sourceScope: item.sourceScope,
      location: item.location,
      aggregateDuplicateReference: item.aggregateDuplicateReference,
    });
    await client.query(dishSql, [
      item.id, item.stallId, item.name, Number(item.price), item.itemType, item.category,
      description, release.batchId, pricingMode, item.priceDisplay,
      JSON.stringify({ mode: item.priceMode, display: item.priceDisplay, baseAmount: Number(item.price), source: 'chain_menu_document' }),
      sourceRef,
    ]);
  }
}

async function insertItems(client, release) {
  const sql = `INSERT INTO chain_menu_release_items (
    id, batch_id, tenant_id, source_name, source_hash, source_line, source_scope, merchant,
    location, stall_id, canteen_id, name, price, price_display, price_mode, catalog_item_type,
    catalog_category, classification_rule, source_raw_text, aggregate_duplicate_reference, dish_id, status
  ) VALUES ($1, $2, 'default', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
    $16, $17, $18, $19, $1, 'imported')`;
  for (const item of release.items) {
    await client.query(sql, [
      item.id, release.batchId, item.sourceName, item.sourceHash, item.sourceLine, item.sourceScope,
      item.merchant, item.location, item.stallId, item.canteenId, item.name, Number(item.price),
      item.priceDisplay, item.priceMode, item.itemType, item.category, item.classificationRule,
      item.sourceRawText, item.aggregateDuplicateReference ? 1 : 0,
    ]);
  }
}

async function main() {
  const release = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const { digest } = assertRelease(release);
  if (expectedDigest && expectedDigest !== digest) throw new Error('Release digest does not match --digest');
  if ((apply || rollback) && !expectedDigest) throw new Error('--digest from a successful dry-run is required for write operations');
  const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: 'chain-menu-release-import' });
  const client = await pool.connect();
  const summary = { mode: rollback ? 'rollback' : apply ? 'apply' : 'dry-run', sourcePath, batchId: release.batchId, releaseDigest: digest, counts: { items: release.items.length, newStalls: release.newStalls.length } };
  try {
    await client.query('BEGIN');
    await setContext(client);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`chain-menu-release:${release.batchId}`]);
    const existingBatch = await client.query('SELECT * FROM chain_menu_release_batches WHERE tenant_id = $1 AND id = $2 FOR UPDATE', ['default', release.batchId]);
    if (rollback) {
      if (!existingBatch.rowCount) throw new Error(`Release batch not found: ${release.batchId}`);
      if (existingBatch.rows[0].release_digest !== digest) throw new Error('Existing release batch digest differs');
      if (existingBatch.rows[0].status === 'rolled_back') {
        await client.query('ROLLBACK');
        console.log(JSON.stringify({ ...summary, alreadyRolledBack: true }, null, 2));
        return;
      }
      const dishes = await client.query('SELECT dish_id FROM chain_menu_release_items WHERE batch_id = $1 AND dish_id IS NOT NULL', [release.batchId]);
      const dishIds = dishes.rows.map((row) => row.dish_id);
      if (dishIds.length) await client.query('DELETE FROM rag_documents WHERE tenant_id = $1 AND source_type = \'dish\' AND source_id = ANY($2::text[])', ['default', dishIds]);
      if (dishIds.length) await client.query('DELETE FROM dishes WHERE tenant_id = $1 AND id = ANY($2::text[])', ['default', dishIds]);
      const newStalls = await client.query('SELECT stall_id FROM chain_menu_release_stalls WHERE batch_id = $1 AND created_by_batch = 1', [release.batchId]);
      const stallIds = newStalls.rows.map((row) => row.stall_id);
      if (stallIds.length) {
        const inUse = await client.query('SELECT DISTINCT stall_id FROM dishes WHERE tenant_id = $1 AND stall_id = ANY($2::text[])', ['default', stallIds]);
        const inUseIds = new Set(inUse.rows.map((row) => row.stall_id));
        const deletable = stallIds.filter((id) => !inUseIds.has(id));
        if (deletable.length) await client.query('DELETE FROM stalls WHERE tenant_id = $1 AND id = ANY($2::text[])', ['default', deletable]);
      }
      await client.query("UPDATE chain_menu_release_batches SET status = 'rolled_back', rolled_back_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [release.batchId]);
      await client.query("UPDATE chain_menu_release_items SET status = 'rolled_back', dish_id = NULL WHERE batch_id = $1", [release.batchId]);
      await client.query('COMMIT');
      console.log(JSON.stringify({ ...summary, rolledBackDishCount: dishIds.length }, null, 2));
      return;
    }
    const target = await validateTarget(client, release);
    if (!apply || existingBatch.rowCount) {
      await client.query('ROLLBACK');
      console.log(JSON.stringify({ ...summary, target, alreadyImported: existingBatch.rowCount > 0, existingStatus: existingBatch.rows[0]?.status || null }, null, 2));
      return;
    }
    const stallRecords = await ensureStalls(client, release, target.stallById);
    await insertBatch(client, release, stallRecords);
    await insertDishes(client, release);
    await insertItems(client, release);
    const validation = await client.query(`SELECT
      COUNT(*)::integer AS item_count,
      COUNT(*) FILTER (WHERE dish_id IS NOT NULL)::integer AS linked_count,
      COUNT(DISTINCT id)::integer AS distinct_ids
      FROM chain_menu_release_items WHERE batch_id = $1`, [release.batchId]);
    const row = validation.rows[0];
    if (Number(row.item_count) !== 824 || Number(row.linked_count) !== 824 || Number(row.distinct_ids) !== 824) throw new Error('Imported release item validation failed');
    await client.query("UPDATE chain_menu_release_batches SET status = 'imported', imported_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [release.batchId]);
    await client.query('COMMIT');
    console.log(JSON.stringify({ ...summary, imported: true, insertedItems: 824, createdStalls: stallRecords.filter((stall) => stall.createdByBatch === 1).length }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, code: error.code || null }, null, 2));
  process.exitCode = 1;
});
