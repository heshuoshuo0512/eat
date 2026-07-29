#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { classifyCatalogItem } from '../server/catalogClassification.js';

const { Pool } = pg;

function option(name, fallback = '') {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

const correctionIds = new Set([
  'dish-ba91190defb150', 'dish-b43ac7746192af',
  'dish-5ecbe4de67fb30', 'dish-4638b8e96ea9ee', 'dish-046c8ea6442415',
  'dish-01afb12a5e7142', 'dish-ffb63a7f6fe979', 'dish-39289497c6ad66',
  'dish-073fc872e79d15', 'dish-582691e425982f', 'dish-b575b67cf0e600', 'dish-f3121b9a50cc1f',
  'dish-d6f246046bba03', 'dish-414406b0c9d094', 'dish-83242f9587bf85',
  'dish-876fb4fad966c5', 'dish-5183df9c183acc', 'dish-9a5d024dc6cb1f',
  'dish-7f2557b0691a71', 'dish-844df2f52c2e7e', 'dish-de6f056c55d012',
  'dish-b102fcbd65fe1e', 'dish-818f41795f5b1f', 'dish-44dfe8262552cc',
  'dish-5b2b23caa605a3', 'dish-03c56260d1f721', 'dish-4020b18b0682c3',
  'dish-227006a11272f3',
  'dish-2a3b8d894013ac', 'dish-58240b793c681e', 'dish-004f9a66d69ddb',
]);

const sourcePath = resolve(option('source', 'data/imports/real/campus-2026-07-27/catalog.json'));
const tenantId = option('tenant', 'default');
const databaseUrl = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_MIGRATION_URL or DATABASE_URL is required');

const catalog = JSON.parse(readFileSync(sourcePath, 'utf8'));
const stalls = new Map(catalog.stalls.map((stall) => [stall.id, stall]));
const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: 'catalog-classification-verifier' });

try {
  const actual = (await pool.query(`SELECT id, name, price_display, pricing_mode, catalog_item_type,
      catalog_category, status, parent_dish_id, reservation_enabled
    FROM dishes WHERE tenant_id = $1 ORDER BY id`, [tenantId])).rows;
  const actualById = new Map(actual.map((row) => [row.id, row]));
  const differences = [];
  for (const dish of catalog.dishes) {
    const row = actualById.get(dish.id);
    const expected = classifyCatalogItem({ ...dish, stallName: stalls.get(dish.stallId)?.name || '' });
    if (!row) {
      differences.push({ id: dish.id, name: dish.name, expected: expected.itemType, actual: 'missing' });
    } else if ((row.catalog_item_type !== expected.itemType || row.catalog_category !== expected.category) && !correctionIds.has(dish.id)) {
      differences.push({
        id: dish.id,
        name: dish.name,
        stall: stalls.get(dish.stallId)?.name || '',
        expected: { itemType: expected.itemType, category: expected.category },
        actual: { itemType: row.catalog_item_type, category: row.catalog_category },
      });
    }
  }

  const searchableActual = actual.filter((row) => row.status === 'active' && ['meal', 'beverage', 'snack'].includes(row.catalog_item_type));
  const malformedNames = searchableActual.filter((row) => {
    const opening = (row.name.match(/[（(]/gu) || []).length;
    const closing = (row.name.match(/[）)]/gu) || []).length;
    return opening !== closing
      || /^\s*(?:[0-9０-９]+\s*[.、]|[.、])/u.test(row.name)
      || /低消$/u.test(row.name)
      || /款$/u.test(row.name);
  }).map((row) => ({
    id: row.id,
    name: row.name,
    itemType: row.catalog_item_type,
    category: row.catalog_category,
  }));

  const invalid = (await pool.query(`SELECT id, name, catalog_item_type, status, parent_dish_id, reservation_enabled
    FROM dishes WHERE tenant_id = $1 AND (
      (catalog_item_type IN ('addon','fee','variant','section') AND reservation_enabled)
      OR (catalog_item_type IN ('variant','section') AND status = 'active')
      OR (catalog_item_type = 'variant' AND parent_dish_id IS NULL)
    ) ORDER BY id`, [tenantId])).rows;
  const duplicates = (await pool.query(`SELECT stall_id,
      regexp_replace(name, '[[:space:][:punct:]]', '', 'g') AS normalized_name,
      COUNT(*)::integer AS count, array_agg(id ORDER BY id) AS ids
    FROM dishes
    WHERE tenant_id = $1 AND status = 'active' AND catalog_item_type IN ('meal','beverage','snack')
    GROUP BY stall_id, regexp_replace(name, '[[:space:][:punct:]]', '', 'g')
    HAVING COUNT(*) > 1 ORDER BY count DESC, stall_id`, [tenantId])).rows;
  const ragTypes = (await pool.query(`SELECT d.catalog_item_type, COUNT(*)::integer AS count
    FROM rag_documents r
    JOIN dishes d ON d.id = r.source_id AND d.tenant_id = r.tenant_id
    WHERE r.tenant_id = $1 AND r.source_type = 'dish'
    GROUP BY d.catalog_item_type ORDER BY d.catalog_item_type`, [tenantId])).rows;
  const ragCoverageIssues = (await pool.query(`SELECT d.id, d.name, d.catalog_item_type,
      COUNT(r.id)::integer AS document_count, MAX(r.title) AS rag_title
    FROM dishes d
    LEFT JOIN rag_documents r
      ON r.tenant_id = d.tenant_id AND r.source_type = 'dish' AND r.source_id = d.id
    WHERE d.tenant_id = $1 AND d.status = 'active'
      AND d.catalog_item_type IN ('meal','beverage','snack')
    GROUP BY d.id, d.name, d.catalog_item_type
    HAVING COUNT(r.id) <> 1 OR MAX(r.title) <> d.name
    ORDER BY d.catalog_item_type, d.name`, [tenantId])).rows;
  const invalidRagDocuments = (await pool.query(`SELECT r.id, r.source_id, r.title,
      d.name, d.catalog_item_type, d.status
    FROM rag_documents r
    LEFT JOIN dishes d ON d.id = r.source_id AND d.tenant_id = r.tenant_id
    WHERE r.tenant_id = $1 AND r.source_type = 'dish'
      AND (d.id IS NULL OR d.status <> 'active' OR d.catalog_item_type NOT IN ('meal','beverage','snack'))
    ORDER BY r.source_id`, [tenantId])).rows;
  const typeCounts = (await pool.query(`SELECT catalog_item_type, COUNT(*)::integer AS count
    FROM dishes WHERE tenant_id = $1 GROUP BY catalog_item_type ORDER BY catalog_item_type`, [tenantId])).rows;

  const report = {
    sourcePath,
    tenantId,
    sourceCount: catalog.dishes.length,
    databaseCount: actual.length,
    typeCounts: Object.fromEntries(typeCounts.map((row) => [row.catalog_item_type, row.count])),
    ruleDifferenceCount: differences.length,
    differences,
    malformedNameCount: malformedNames.length,
    malformedNames,
    invalidBoundaryCount: invalid.length,
    invalid,
    activeDuplicateCount: duplicates.length,
    duplicates,
    ragTypes: Object.fromEntries(ragTypes.map((row) => [row.catalog_item_type, row.count])),
    ragCoverageIssueCount: ragCoverageIssues.length,
    ragCoverageIssues,
    invalidRagDocumentCount: invalidRagDocuments.length,
    invalidRagDocuments,
  };
  console.log(JSON.stringify(report, null, 2));
  if (catalog.dishes.length !== actual.length || differences.length || malformedNames.length || invalid.length || duplicates.length
      || ragCoverageIssues.length || invalidRagDocuments.length) process.exitCode = 1;
  if (ragTypes.some((row) => !['meal', 'beverage', 'snack'].includes(row.catalog_item_type))) process.exitCode = 1;
} finally {
  await pool.end();
}
