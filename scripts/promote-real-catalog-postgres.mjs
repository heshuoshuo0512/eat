#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const { Pool } = pg;
const SOURCE_EXPECTED = Object.freeze({
  stalls: 138,
  dishes: 2563,
  catalog_import_rows: 3146,
  accepted: 2713,
  review_required: 170,
  excluded: 263,
  rag_documents: 3213,
  dish_ai_annotations: 200,
});
const TARGET_CANTEEN_COUNT = 14;
const DEFAULT_SOURCE = 'data/real-catalog-campus-2026-07-27-v2.sqlite';

function option(name, fallback = '') {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  const match = process.argv.find((value) => value === exact || value.startsWith(prefix));
  if (!match) return fallback;
  return match === exact ? true : match.slice(prefix.length);
}

function sourceChecksum(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function tableRows(db, table) {
  return db.prepare(`SELECT * FROM ${table}`).all();
}

function scalar(db, sql, ...params) {
  return Number(db.prepare(sql).get(...params)?.count || 0);
}

function inspectSource(path) {
  if (!existsSync(path)) throw new Error(`Catalog source not found: ${path}`);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const counts = {
      canteens: scalar(db, 'SELECT COUNT(*) AS count FROM canteens'),
      stalls: scalar(db, 'SELECT COUNT(*) AS count FROM stalls'),
      dishes: scalar(db, 'SELECT COUNT(*) AS count FROM dishes'),
      catalog_import_rows: scalar(db, 'SELECT COUNT(*) AS count FROM catalog_import_rows'),
      accepted: scalar(db, "SELECT COUNT(*) AS count FROM catalog_import_rows WHERE status = 'accepted'"),
      review_required: scalar(db, "SELECT COUNT(*) AS count FROM catalog_import_rows WHERE status = 'review_required'"),
      excluded: scalar(db, "SELECT COUNT(*) AS count FROM catalog_import_rows WHERE status = 'excluded'"),
      rag_documents: scalar(db, 'SELECT COUNT(*) AS count FROM rag_documents'),
      dish_ai_annotations: scalar(db, 'SELECT COUNT(*) AS count FROM dish_ai_annotations'),
    };
    if (![12, TARGET_CANTEEN_COUNT].includes(counts.canteens)) {
      throw new Error(`Source count mismatch for canteens: expected 12 or ${TARGET_CANTEEN_COUNT}, received ${counts.canteens}`);
    }
    for (const [key, expected] of Object.entries(SOURCE_EXPECTED)) {
      if (counts[key] !== expected) throw new Error(`Source count mismatch for ${key}: expected ${expected}, received ${counts[key]}`);
    }
    const annotationStatuses = db.prepare('SELECT status, COUNT(*) AS count FROM dish_ai_annotations GROUP BY status').all();
    if (annotationStatuses.length !== 1 || annotationStatuses[0].status !== 'schema_validated' || Number(annotationStatuses[0].count) !== 200) {
      throw new Error('The 200 AI annotations must remain schema_validated');
    }
    const batch = db.prepare('SELECT * FROM data_import_batches LIMIT 1').get();
    if (!batch) throw new Error('Catalog source has no import batch');
    return { counts, batch, checksum: sourceChecksum(path) };
  } finally {
    db.close();
  }
}

function cleanText(value) {
  return String(value || '')
    .replaceAll('今日供应待确认', '目录信息待核验')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanDishName(value) {
  return cleanText(value).replace(/^\s*\d+\s*[.、]\s*/u, '').replace(/^\s*[.、]\s*/u, '').trim();
}

function isServingTierName(value) {
  return /^(?:\d+\s*[-~至‐‑–—]\s*\d+|\d+|单|双|多)\s*人份$/u.test(cleanDishName(value));
}

function cleanJsonText(value) {
  try {
    const parsed = JSON.parse(value || 'null');
    return JSON.stringify(walk(parsed));
  } catch {
    return cleanText(value);
  }
}

function walk(value) {
  if (Array.isArray(value)) return value.map(walk);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
  return typeof value === 'string' ? cleanText(value) : value;
}

function venueKind(row) {
  if (row.id === 'east-dongdahuo') return 'service_building';
  if (row.id === 'east-guangyuan') return 'supermarket';
  return 'dining_hall';
}

function valueForColumn(table, column, row, checksum, { preparedSource = false } = {}) {
  if (preparedSource && Object.hasOwn(row, column)) return row[column];
  if (preparedSource && table === 'rag_documents' && column === 'metadata') return JSON.parse(row.metadata_json || '{}');
  if (preparedSource && table === 'rag_documents' && column === 'embedding') return null;
  if (preparedSource && (table === 'stalls' || table === 'dishes') && column === 'reservation_enabled') return true;
  if (table === 'canteens' && column === 'venue_kind') return venueKind(row);
  if (table === 'canteens' && column === 'name' && row.id === 'east-zone') return '东区燕鸣湖';
  if (table === 'canteens' && column === 'name' && row.id === 'east-dongdahuo') return '东区东大活';
  if (table === 'canteens' && column === 'name' && row.id === 'east-guangyuan') return '西区广源超市';
  if (table === 'canteens' && column === 'location' && row.id === 'east-guangyuan') return '西区';
  if (table === 'canteens' && column === 'display_name') return ({
    'campus-main': '大食堂', 'east-zone': '燕鸣湖', 'east-guangyuan': '广源超市', 'east-dongdahuo': '东大活',
    'west-minzu': '民族餐厅', 'west-xinyi': '心怡餐厅', 'west-xijinjia': '禧进甲餐厅', 'west-floor2-east': '二楼东厅',
    'west-darongshu': '大榕树餐厅', 'west-floor3-east': '三楼东厅', 'east-yanminghu-1f': '一楼', 'east-yanminghu-2f': '二楼',
  })[row.id] || row.name;
  if (table === 'canteens' && column === 'display_order') return ({
    'campus-main': 1, 'east-zone': 2, 'east-guangyuan': 5, 'east-dongdahuo': 6,
    'west-minzu': 1, 'west-xinyi': 2, 'west-xijinjia': 3, 'west-floor2-east': 4,
    'west-darongshu': 5, 'west-floor3-east': 6, 'east-yanminghu-1f': 1, 'east-yanminghu-2f': 2,
  })[row.id] || 999;
  if (table === 'canteens' && column === 'operating_status') return 'open';
  if (table === 'canteens' && column === 'parent_id' && ['east-dongdahuo', 'east-guangyuan'].includes(row.id)) return null;
  if ((table === 'stalls' || table === 'dishes') && column === 'reservation_enabled') return true;
  if (table === 'stalls' && column === 'open') return 1;
  if (table === 'dishes' && column === 'name') return cleanDishName(row.name);
  if (table === 'dishes' && column === 'status' && isServingTierName(row.name)) return 'inactive';
  if (column === 'description' || column.endsWith('_json')) return column.endsWith('_json') ? cleanJsonText(row[column]) : cleanText(row[column]);
  if (table === 'data_import_batches' && column === 'status') return 'approved';
  if (table === 'data_import_batches' && column === 'reviewed_by') return 'catalog-promotion';
  if (table === 'data_import_batches' && column === 'source_name') return `${row.source_name} | sha256:${checksum}`;
  if (table === 'rag_documents' && column === 'metadata') return JSON.parse(cleanJsonText(row.metadata_json) || '{}');
  if (table === 'rag_documents' && column === 'embedding') return null;
  return row[column] ?? null;
}

async function insertRenovatingVenues(client, tenantId) {
  const rows = [
    ['west-yanyuan', '西区燕园', '燕园', 3, '西区', '西区燕园正在装修，开放后将提供正式校园餐饮目录。'],
    ['east-shanshuiyuan', '东区山水园', '山水园', 4, '东区', '东区山水园正在装修，开放后将提供正式校园餐饮目录。'],
  ];
  for (const [id, name, displayName, displayOrder, location, description] of rows) {
    await client.query(`INSERT INTO canteens
      (id, tenant_id, name, display_name, display_order, operating_status, location, hours, crowd_level, tags_json, description, parent_id, canteen_type, image, venue_kind, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'renovating', $6, '装修中', 0, '["装修中"]', $7, NULL, 'primary', '', 'dining_hall', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, display_name = EXCLUDED.display_name,
        display_order = EXCLUDED.display_order, operating_status = 'renovating', location = EXCLUDED.location,
        hours = '装修中', description = EXCLUDED.description, parent_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE canteens.tenant_id = EXCLUDED.tenant_id`,
      [id, tenantId, name, displayName, displayOrder, location, description]);
  }
  return rows.length;
}

async function applyCatalogItemCorrections(client, tenantId) {
  if (tenantId !== 'default') {
    const ragDocuments = await client.query(`SELECT COUNT(*)::integer AS count FROM rag_documents
      WHERE tenant_id IN ($1, '__global__')`, [tenantId]);
    return { itemTypes: {}, ragDocuments: Number(ragDocuments.rows[0]?.count || 0) };
  }
  await client.query(readFileSync(resolve('server/migrations/025_catalog_item_types.sql'), 'utf8'));
  await client.query(readFileSync(resolve('server/migrations/026_catalog_classification.sql'), 'utf8'));
  const counts = await client.query(`SELECT catalog_item_type, COUNT(*)::integer AS count FROM dishes
    WHERE tenant_id = $1 GROUP BY catalog_item_type ORDER BY catalog_item_type`, [tenantId]);
  const ragDocuments = await client.query(`SELECT COUNT(*)::integer AS count FROM rag_documents
    WHERE tenant_id IN ($1, '__global__')`, [tenantId]);
  return {
    itemTypes: Object.fromEntries(counts.rows.map((row) => [row.catalog_item_type, Number(row.count)])),
    ragDocuments: Number(ragDocuments.rows[0]?.count || 0),
  };
}

async function targetColumns(client, table) {
  const result = await client.query(`SELECT column_name, is_generated FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`, [table]);
  return result.rows.filter((row) => row.is_generated === 'NEVER').map((row) => row.column_name);
}

async function insertRows(client, sourceDb, table, checksum, extraColumns = [], options = {}) {
  const sourceColumns = sourceDb.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  const target = await targetColumns(client, table);
  const columns = target.filter((column) => sourceColumns.includes(column) || extraColumns.includes(column));
  const rows = tableRows(sourceDb, table);
  if (!rows.length) return 0;
  const existingById = new Map();
  if (options.preserveMatchingRows) {
    const existing = await client.query(`SELECT id, tenant_id, source_type, source_id, content_hash
      FROM ${table} WHERE id = ANY($1::text[])`, [rows.map((row) => row.id)]);
    for (const row of existing.rows) existingById.set(row.id, row);
  }
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  const quoted = columns.map((column) => `"${column}"`).join(', ');
  const sql = `INSERT INTO ${table} (${quoted}) VALUES (${placeholders})`;
  let inserted = 0;
  let preserved = 0;
  for (const row of rows) {
    const existing = existingById.get(row.id);
    if (existing) {
      for (const field of ['tenant_id', 'source_type', 'source_id', 'content_hash']) {
        if (String(existing[field] || '') !== String(row[field] || '')) {
          throw new Error(`Existing ${table} row conflicts with the source: ${row.id} (${field})`);
        }
      }
      preserved += 1;
      continue;
    }
    await client.query(sql, columns.map((column) => valueForColumn(table, column, row, checksum, options)));
    inserted += 1;
  }
  return options.preserveMatchingRows ? { total: rows.length, inserted, preserved } : rows.length;
}

async function targetCounts(client, tenantId) {
  const tables = ['canteens', 'stalls', 'dishes', 'catalog_import_rows', 'rag_documents', 'dish_ai_annotations', 'users', 'reviews', 'menus', 'menu_items'];
  const result = {};
  for (const table of tables) {
    const tenantClause = table === 'rag_documents' ? "tenant_id IN ($1, '__global__')" : 'tenant_id = $1';
    const count = await client.query(`SELECT COUNT(*)::integer AS count FROM ${table} WHERE ${tenantClause}`, [tenantId]);
    result[table] = Number(count.rows[0]?.count || 0);
  }
  return result;
}

async function assertEmptyTarget(client, tenantId) {
  const counts = await targetCounts(client, tenantId);
  const seededVenues = await client.query(`SELECT id FROM canteens WHERE tenant_id = $1
    AND id IN ('west-yanyuan','east-shanshuiyuan') AND operating_status = 'renovating'`, [tenantId]);
  const unexpectedCanteens = counts.canteens - seededVenues.rowCount;
  const catalogTables = ['stalls', 'dishes', 'catalog_import_rows', 'dish_ai_annotations'];
  const populated = catalogTables.map((name) => [name, counts[name]]).filter(([, count]) => count > 0);
  if (unexpectedCanteens > 0) populated.unshift(['canteens', unexpectedCanteens]);
  if (populated.length) throw new Error(`Tenant ${tenantId} is not empty: ${populated.map(([name, count]) => `${name}=${count}`).join(', ')}`);
  return counts;
}

async function removeSeededRenovatingVenues(client, tenantId) {
  const result = await client.query(`DELETE FROM canteens WHERE tenant_id = $1
    AND id IN ('west-yanyuan','east-shanshuiyuan') AND operating_status = 'renovating'`, [tenantId]);
  return result.rowCount;
}

async function rollback(client, sourceDb, batchId, tenantId) {
  const actual = await client.query('SELECT id FROM data_import_batches WHERE tenant_id = $1 AND id = $2', [tenantId, batchId]);
  if (!actual.rowCount) throw new Error(`Import batch not found: ${batchId}`);
  const dishIds = tableRows(sourceDb, 'dishes').map((row) => row.id);
  const stallIds = tableRows(sourceDb, 'stalls').map((row) => row.id);
  const canteenIds = tableRows(sourceDb, 'canteens').map((row) => row.id);
  await client.query('DELETE FROM dish_ai_annotations WHERE tenant_id = $1 AND dish_id = ANY($2::text[])', [tenantId, dishIds]);
  await client.query('DELETE FROM rag_documents WHERE tenant_id = $1 AND (source_id = ANY($2::text[]) OR source_id = ANY($3::text[]) OR id = ANY($4::text[]))', [tenantId, dishIds, stallIds, tableRows(sourceDb, 'rag_documents').map((row) => row.id)]);
  await client.query('DELETE FROM dishes WHERE tenant_id = $1 AND id = ANY($2::text[])', [tenantId, dishIds]);
  await client.query('DELETE FROM stalls WHERE tenant_id = $1 AND id = ANY($2::text[])', [tenantId, stallIds]);
  for (const row of tableRows(sourceDb, 'canteens').sort((a, b) => Number(Boolean(b.parent_id)) - Number(Boolean(a.parent_id)))) {
    await client.query('DELETE FROM canteens WHERE tenant_id = $1 AND id = $2', [tenantId, row.id]);
  }
  await client.query('DELETE FROM data_import_batches WHERE tenant_id = $1 AND id = $2', [tenantId, batchId]);
  return { dishes: dishIds.length, stalls: stallIds.length, canteens: canteenIds.length };
}

const sourcePath = resolve(String(option('source', DEFAULT_SOURCE)));
const tenantId = String(option('tenant', 'default'));
const inspection = inspectSource(sourcePath);
const expectedChecksum = String(option('checksum', '') || '');
if (expectedChecksum && expectedChecksum !== inspection.checksum) throw new Error('Source checksum does not match --checksum');

const summary = { mode: 'dry-run', sourcePath, tenantId, ...inspection };
if (!option('approve') && !option('rollback')) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_MIGRATION_URL is required for catalog promotion');
const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: 'catalog-promotion' });
const client = await pool.connect();
const sourceDb = new DatabaseSync(sourcePath, { readOnly: true });
try {
  await client.query('BEGIN');
  await client.query(`SELECT
    set_config('app.tenant_id', $1, true),
    set_config('app.user_id', 'catalog-promotion', true),
    set_config('app.role', 'super_admin', true),
    set_config('app.request_id', $2, true)`, [tenantId, `catalog:${inspection.batch.id}`]);
  const rollbackBatch = option('rollback');
  if (rollbackBatch) {
    const deleted = await rollback(client, sourceDb, String(rollbackBatch), tenantId);
    await client.query('COMMIT');
    console.log(JSON.stringify({ ...summary, mode: 'rollback', batchId: rollbackBatch, deleted }, null, 2));
  } else {
    const beforeCounts = option('empty-only', true)
      ? await assertEmptyTarget(client, tenantId)
      : await targetCounts(client, tenantId);
    const preparedSource = inspection.counts.canteens === TARGET_CANTEEN_COUNT;
    const removedSeedPlaceholders = preparedSource ? await removeSeededRenovatingVenues(client, tenantId) : 0;
    await client.query(`INSERT INTO tenants (id, name, status, plan, ai_quota, storage_quota_mb, created_at, updated_at)
      VALUES ($1, $2, 'active', 'enterprise', 1000, 10240, $3, $3) ON CONFLICT (id) DO NOTHING`, [tenantId, '燕山大学校园', new Date().toISOString()]);
    const inserted = { removed_seed_placeholders: removedSeedPlaceholders };
    inserted.data_import_batches = await insertRows(client, sourceDb, 'data_import_batches', inspection.checksum, [], { preparedSource });
    inserted.canteens = await insertRows(client, sourceDb, 'canteens', inspection.checksum, ['venue_kind', 'display_name', 'display_order', 'operating_status'], { preparedSource });
    inserted.renovating_venues = inspection.counts.canteens === TARGET_CANTEEN_COUNT
      ? 0
      : await insertRenovatingVenues(client, tenantId);
    inserted.stalls = await insertRows(client, sourceDb, 'stalls', inspection.checksum, ['reservation_enabled'], { preparedSource });
    inserted.dishes = await insertRows(client, sourceDb, 'dishes', inspection.checksum, ['reservation_enabled'], { preparedSource });
    inserted.catalog_import_rows = await insertRows(client, sourceDb, 'catalog_import_rows', inspection.checksum, [], { preparedSource });
    inserted.rag_documents = await insertRows(client, sourceDb, 'rag_documents', inspection.checksum, ['metadata', 'embedding'], {
      preparedSource,
      preserveMatchingRows: true,
    });
    inserted.dish_ai_annotations = await insertRows(client, sourceDb, 'dish_ai_annotations', inspection.checksum, [], { preparedSource });
    inserted.catalog_item_types = await applyCatalogItemCorrections(client, tenantId);
    const counts = await targetCounts(client, tenantId);
    for (const key of ['canteens', 'stalls', 'dishes', 'catalog_import_rows', 'rag_documents', 'dish_ai_annotations']) {
      const expected = key === 'canteens'
        ? TARGET_CANTEEN_COUNT
        : key === 'rag_documents'
          ? inserted.catalog_item_types.ragDocuments
          : SOURCE_EXPECTED[key];
      if (counts[key] !== expected) throw new Error(`Post-import count mismatch for ${key}: ${counts[key]}`);
    }
    for (const key of ['users', 'reviews', 'menus', 'menu_items']) {
      if (counts[key] !== beforeCounts[key]) throw new Error(`Production catalog import changed runtime table ${key}`);
    }
    const audit = await client.query('SELECT status, COUNT(*)::integer AS count FROM catalog_import_rows WHERE tenant_id = $1 GROUP BY status', [tenantId]);
    const auditCounts = Object.fromEntries(audit.rows.map((row) => [row.status, Number(row.count)]));
    for (const key of ['accepted', 'review_required', 'excluded']) {
      if (auditCounts[key] !== SOURCE_EXPECTED[key]) throw new Error(`Audit count mismatch for ${key}`);
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ ...summary, mode: 'approved', inserted, counts, auditCounts }, null, 2));
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  sourceDb.close();
  client.release();
  await pool.end();
}
