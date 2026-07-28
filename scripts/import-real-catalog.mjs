#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from '../server/database.js';
import { importRealCatalog, rollbackRealCatalogBatch } from '../server/realCatalogImport.js';

function arg(name, fallback = '') {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

const databasePath = resolve(arg('database', 'data/real-catalog-staging.sqlite'));
const protectedPath = resolve('data/smart-canteen.sqlite');
if (databasePath === protectedPath) {
  throw new Error('The real catalog importer refuses to use data/smart-canteen.sqlite');
}
if (!databasePath.toLowerCase().endsWith('.sqlite')) throw new Error('The staging database must be a SQLite file');

process.env.ENABLE_DEMO_SEED = '0';
const db = openDatabase(databasePath);
try {
  const rollbackBatch = arg('rollback');
  if (rollbackBatch) {
    console.log(JSON.stringify({ batchId: rollbackBatch, deleted: rollbackRealCatalogBatch(db, rollbackBatch) }, null, 2));
  } else {
    const inputPath = resolve(arg('input', 'data/imports/real/west-main-2026-07-27/catalog.json'));
    const bundle = JSON.parse(readFileSync(inputPath, 'utf8'));
    const result = importRealCatalog(db, bundle, {
      tenantId: arg('tenant', 'default'),
      status: process.argv.includes('--approve') ? 'approved' : 'validated',
    });
    const counts = Object.fromEntries(['canteens', 'stalls', 'dishes', 'menus', 'menu_items', 'catalog_import_rows']
      .map((table) => [table, Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)]));
    console.log(JSON.stringify({ databasePath, ...result, counts }, null, 2));
  }
} finally {
  db.close();
}
