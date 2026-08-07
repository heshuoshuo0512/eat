#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import {
  auditCatalogIntroductionRecords,
  catalogIntroductionEvidenceHash,
  loadCatalogIntroductionEvidence,
  mapCatalogIntroductionRow,
  stableCatalogIntroductionHash,
  validateCatalogIntroductionCandidate,
} from '../server/catalogIntroductions.js';

const { Pool } = pg;
// The first exported DeepSeek copy has legacy hashes that include updatedAt.
// Keep the validated stable-hash artifact as the safe default; the target
// catalog snapshot is still checked before any PostgreSQL write.
const DEFAULT_SOURCE = 'data/real-catalog-introductions-v4-stable-hash-2026-07-29.sqlite';
const DEFAULT_EXPECTED_COUNT = 2715;
const JSON_COLUMNS = Object.freeze([
  ['claim_evidence_json', 'array'],
  ['semantic_labels_json', 'array'],
  ['evidence_ids_json', 'array'],
  ['evidence_snapshot_json', 'object'],
  ['boundary_codes_json', 'array'],
]);
const INTRODUCTION_COLUMNS = Object.freeze([
  'id', 'tenant_id', 'batch_id', 'entity_type', 'hierarchy_level', 'entity_id', 'version',
  'factual_summary', 'recommendation_copy', 'claim_evidence_json', 'semantic_labels_json',
  'evidence_ids_json', 'evidence_snapshot_json', 'boundary_codes_json', 'confidence_score',
  'confidence_level', 'model', 'prompt_version', 'input_hash', 'content_hash', 'status',
  'previous_introduction_id', 'error', 'reviewed_by', 'reviewed_at', 'created_at', 'updated_at',
]);

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

function assertSafeIdentifier(value, label) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(value || ''))) {
    throw new Error(`${label} contains unsupported characters`);
  }
}

function parseJson(value, expectedType, label) {
  let parsed;
  try { parsed = JSON.parse(String(value)); }
  catch { throw new Error(`${label} is not valid JSON`); }
  if (expectedType === 'array' && !Array.isArray(parsed)) throw new Error(`${label} must be a JSON array`);
  if (expectedType === 'object' && (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

function requireTable(db, table) {
  const found = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!found) throw new Error(`Source is missing table ${table}`);
}

function immutableIntroduction(row) {
  return Object.fromEntries(INTRODUCTION_COLUMNS
    .filter((column) => !['status', 'error', 'reviewed_by', 'reviewed_at', 'updated_at'].includes(column))
    .map((column) => [column, row[column] ?? null]));
}

function immutableBatch(row) {
  const columns = [
    'id', 'tenant_id', 'model', 'prompt_version', 'catalog_data_version', 'catalog_snapshot_hash',
    'entity_count', 'completed_count', 'failed_count', 'concurrency_json', 'metrics_json',
    'error', 'created_by', 'created_at',
  ];
  return Object.fromEntries(columns.map((column) => [column, row[column] ?? null]));
}

function validateIntroductionRow(row) {
  const record = mapCatalogIntroductionRow(row);
  const snapshotHash = catalogIntroductionEvidenceHash(record.evidenceSnapshot);
  if (record.evidenceSnapshot.inputHash !== record.inputHash || snapshotHash !== record.inputHash) {
    throw new Error(`Source row ${row.id} evidence snapshot hash is invalid`);
  }
  const candidate = {
    entityType: record.entityType,
    entityId: record.entityId,
    factualClaims: record.claims.filter((claim) => claim.type === 'fact').map(({ text, evidenceIds }) => ({ text, evidenceIds })),
    recommendationClaims: record.claims.filter((claim) => claim.type === 'recommendation').map(({ text, evidenceIds }) => ({ text, evidenceIds })),
    semanticLabels: record.semanticLabels,
    boundaryCodes: record.boundaryCodes,
  };
  const validated = validateCatalogIntroductionCandidate(candidate, record.evidenceSnapshot);
  if (validated.factualSummary !== record.factualSummary || validated.recommendationCopy !== record.recommendationCopy) {
    throw new Error(`Source row ${row.id} text does not match its claims`);
  }
  if (validated.hierarchyLevel !== record.hierarchyLevel) throw new Error(`Source row ${row.id} hierarchy level is invalid`);
  for (const [label, actual, expected] of [
    ['claims', validated.claims, record.claims],
    ['semantic labels', validated.semanticLabels, record.semanticLabels],
    ['evidence ids', validated.evidenceIds, record.evidenceIds],
    ['boundary codes', validated.boundaryCodes, record.boundaryCodes],
  ]) {
    if (stableCatalogIntroductionHash(actual) !== stableCatalogIntroductionHash(expected)) {
      throw new Error(`Source row ${row.id} ${label} do not match validated content`);
    }
  }
  if (validated.inputHash !== record.inputHash || validated.contentHash !== record.contentHash) {
    throw new Error(`Source row ${row.id} hash validation failed`);
  }
  if (validated.confidence.score !== record.confidence.score || validated.confidence.level !== record.confidence.level) {
    throw new Error(`Source row ${row.id} confidence does not match its evidence snapshot`);
  }
}

export function inspectIntroductionSource(path, { tenantId = 'default', batchId = '', expectedCount = DEFAULT_EXPECTED_COUNT } = {}) {
  if (!existsSync(path)) throw new Error(`Introduction source not found: ${path}`);
  assertSafeIdentifier(tenantId, 'tenant');
  if (batchId) assertSafeIdentifier(batchId, 'batch-id');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('PRAGMA query_only = ON; BEGIN;');
    const quickCheck = db.prepare('PRAGMA quick_check').all();
    if (quickCheck.length !== 1 || quickCheck[0].quick_check !== 'ok') throw new Error('Source SQLite quick_check failed');
    const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyErrors.length) throw new Error(`Source SQLite foreign_key_check failed: ${foreignKeyErrors.length} violation(s)`);
    requireTable(db, 'catalog_introduction_batches');
    requireTable(db, 'catalog_entity_introductions');
    const batches = batchId
      ? db.prepare('SELECT * FROM catalog_introduction_batches WHERE tenant_id = ? AND id = ?').all(tenantId, batchId)
      : db.prepare('SELECT * FROM catalog_introduction_batches WHERE tenant_id = ? ORDER BY updated_at DESC').all(tenantId);
    if (batches.length !== 1) throw new Error(`Expected exactly one source batch, found ${batches.length}`);
    const batch = batches[0];
    const count = Number(expectedCount);
    if (!Number.isInteger(count) || count <= 0) throw new Error('--expected-count must be a positive integer');
    if (batch.status !== 'generated') throw new Error(`Source batch is not generated: ${batch.status}`);
    if (batch.reviewed_by || batch.approved_at) throw new Error('Source batch contains review lifecycle data');
    if (Number(batch.entity_count) !== count || Number(batch.completed_count) !== count || Number(batch.failed_count) !== 0) {
      throw new Error(`Source batch is incomplete: entity=${batch.entity_count}, completed=${batch.completed_count}, failed=${batch.failed_count}, expected=${count}`);
    }
    if (!/^[a-f0-9]{64}$/i.test(String(batch.catalog_snapshot_hash || ''))) throw new Error('Source catalog snapshot hash is invalid');
    const rows = db.prepare('SELECT * FROM catalog_entity_introductions WHERE tenant_id = ? AND batch_id = ? ORDER BY hierarchy_level, entity_type, entity_id, version').all(tenantId, batch.id);
    if (rows.length !== count) throw new Error(`Source introduction count mismatch: ${rows.length}/${count}`);
    const entityKeys = new Set();
    const versionKeys = new Set();
    const levels = {};
    for (const row of rows) {
      if (row.status !== 'schema_validated') throw new Error(`Source row ${row.id} is not schema_validated`);
      if (!['dish', 'stall', 'canteen'].includes(row.entity_type)) throw new Error(`Source row ${row.id} has invalid entity type`);
      if (!['dish', 'stall', 'area', 'venue'].includes(row.hierarchy_level)) throw new Error(`Source row ${row.id} has invalid hierarchy level`);
      if (!String(row.factual_summary || '').trim() || !String(row.recommendation_copy || '').trim()) throw new Error(`Source row ${row.id} has empty copy`);
      if (!/^[a-f0-9]{64}$/i.test(String(row.input_hash || '')) || !/^[a-f0-9]{64}$/i.test(String(row.content_hash || ''))) {
        throw new Error(`Source row ${row.id} has an invalid hash`);
      }
      for (const [column, type] of JSON_COLUMNS) parseJson(row[column], type, `${row.id}.${column}`);
      if (row.previous_introduction_id || row.error || row.reviewed_by || row.reviewed_at) throw new Error(`Source row ${row.id} contains review lifecycle data`);
      validateIntroductionRow(row);
      const entityKey = `${row.entity_type}:${row.entity_id}`;
      const versionKey = `${entityKey}:${row.version}`;
      if (entityKeys.has(entityKey)) throw new Error(`Source contains duplicate entity ${entityKey}`);
      if (versionKeys.has(versionKey)) throw new Error(`Source contains duplicate version ${versionKey}`);
      entityKeys.add(entityKey);
      versionKeys.add(versionKey);
      levels[row.hierarchy_level] = Number(levels[row.hierarchy_level] || 0) + 1;
    }
    const quality = auditCatalogIntroductionRecords(rows.map(mapCatalogIntroductionRow));
    if (!quality.ok) throw new Error(`Source quality audit failed: ${JSON.stringify(quality)}`);
    const logicalDigest = stableCatalogIntroductionHash({
      batch: Object.fromEntries(Object.entries(batch).filter(([key]) => !['status', 'reviewed_by', 'approved_at', 'updated_at'].includes(key))),
      rows: rows.map(immutableIntroduction),
    });
    db.exec('COMMIT;');
    return {
      batch,
      rows,
      checksum: sourceChecksum(path),
      logicalDigest,
      counts: { total: rows.length, levels },
      quality,
    };
  } finally {
    db.close();
  }
}

function postgresAdapter(client) {
  const convert = (sql) => {
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`);
  };
  return {
    prepare(sql) {
      const text = convert(sql);
      return {
        all: async (...params) => (await client.query(text, params)).rows,
        get: async (...params) => (await client.query(text, params)).rows[0],
        run: async (...params) => {
          const result = await client.query(text, params);
          return { changes: result.rowCount, rowCount: result.rowCount };
        },
      };
    },
  };
}

function assertCatalogMatches(source, target) {
  if (target.snapshotHash !== source.batch.catalog_snapshot_hash) {
    throw new Error(`Catalog snapshot mismatch: source=${source.batch.catalog_snapshot_hash}, target=${target.snapshotHash}`);
  }
  if (String(source.batch.catalog_data_version || '') && source.batch.catalog_data_version !== target.catalogDataVersion) {
    throw new Error(`Catalog data version mismatch: source=${source.batch.catalog_data_version}, target=${target.catalogDataVersion}`);
  }
  const targetHashes = new Map(target.evidence.map((item) => [`${item.entityType}:${item.entity.id}`, item.inputHash]));
  if (targetHashes.size !== source.rows.length) throw new Error(`Target entity count mismatch: ${targetHashes.size}/${source.rows.length}`);
  for (const row of source.rows) {
    const key = `${row.entity_type}:${row.entity_id}`;
    if (targetHashes.get(key) !== row.input_hash) throw new Error(`Target input hash mismatch for ${key}`);
  }
}

async function assertTargetReady(client) {
  const version = Number((await client.query('SHOW server_version_num')).rows[0]?.server_version_num || 0);
  if (version < 160000 || version >= 170000) throw new Error(`PostgreSQL 16 is required, received server_version_num=${version}`);
  const result = await client.query("SELECT to_regclass('catalog_introduction_batches') AS batches, to_regclass('catalog_entity_introductions') AS introductions");
  if (!result.rows[0]?.batches || !result.rows[0]?.introductions) throw new Error('Migration 021 has not created the introduction tables');
  const migrations = await client.query("SELECT version FROM schema_migrations WHERE version IN ('020_campus_venue_catalog','021_catalog_entity_introductions')");
  if (migrations.rowCount !== 2) throw new Error('Migrations 020 and 021 must both be applied');
  const rls = await client.query("SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('catalog_introduction_batches','catalog_entity_introductions')");
  if (rls.rowCount !== 2 || rls.rows.some((row) => !row.relrowsecurity)) throw new Error('Introduction row-level security is not enabled');
  const policies = await client.query("SELECT COUNT(*)::integer AS count FROM pg_policies WHERE tablename IN ('catalog_introduction_batches','catalog_entity_introductions')");
  if (Number(policies.rows[0]?.count || 0) < 3) throw new Error('Introduction row-level security policies are incomplete');
  const roles = await client.query("SELECT rolname FROM pg_roles WHERE rolname IN ('smart_canteen_migrator','smart_canteen_api','smart_canteen_worker')");
  if (roles.rowCount !== 3) throw new Error('Production PostgreSQL roles are incomplete');
}

function rowValues(row) {
  return INTRODUCTION_COLUMNS.map((column) => {
    if (column === 'status') return 'schema_validated';
    if (['previous_introduction_id', 'error', 'reviewed_by', 'reviewed_at'].includes(column)) return null;
    return row[column] ?? null;
  });
}

async function assertIdempotentOrEmpty(client, source, tenantId) {
  const existingBatch = await client.query('SELECT * FROM catalog_introduction_batches WHERE id = $1', [source.batch.id]);
  const naturalBatch = await client.query(`SELECT id FROM catalog_introduction_batches
    WHERE tenant_id = $1 AND catalog_snapshot_hash = $2 AND prompt_version = $3 AND model = $4`, [
    tenantId, source.batch.catalog_snapshot_hash, source.batch.prompt_version, source.batch.model,
  ]);
  if (!existingBatch.rowCount) {
    if (naturalBatch.rowCount) throw new Error(`Target contains the same batch identity under a different id: ${naturalBatch.rows[0].id}`);
    const globalIds = await client.query('SELECT id FROM catalog_entity_introductions WHERE id = ANY($1::text[])', [source.rows.map((row) => row.id)]);
    if (globalIds.rowCount) throw new Error(`Target row id already exists: ${globalIds.rows[0].id}`);
    const targetRows = await client.query('SELECT * FROM catalog_entity_introductions WHERE tenant_id = $1', [tenantId]);
    const ids = new Set(targetRows.rows.map((row) => row.id));
    const versions = new Set(targetRows.rows.map((row) => `${row.entity_type}:${row.entity_id}:${row.version}`));
    for (const row of source.rows) {
      const version = `${row.entity_type}:${row.entity_id}:${row.version}`;
      if (versions.has(version)) throw new Error(`Target entity version already exists: ${version}`);
    }
    return { alreadyImported: false };
  }
  const batch = existingBatch.rows[0];
  if (batch.tenant_id !== tenantId) throw new Error(`Target batch id belongs to another tenant: ${batch.tenant_id}`);
  if (stableCatalogIntroductionHash(immutableBatch(batch)) !== stableCatalogIntroductionHash(immutableBatch(source.batch))) {
    throw new Error('Target batch immutable fields differ from the source');
  }
  const existingRows = await client.query('SELECT * FROM catalog_entity_introductions WHERE tenant_id = $1 AND batch_id = $2', [tenantId, source.batch.id]);
  if (existingRows.rowCount !== source.rows.length) throw new Error(`Target batch is partially imported: ${existingRows.rowCount}/${source.rows.length}`);
  const expected = new Map(source.rows.map((row) => [`${row.entity_type}:${row.entity_id}:${row.version}`, row]));
  for (const row of existingRows.rows) {
    const sourceRow = expected.get(`${row.entity_type}:${row.entity_id}:${row.version}`);
    if (!sourceRow || stableCatalogIntroductionHash(immutableIntroduction(row)) !== stableCatalogIntroductionHash(immutableIntroduction(sourceRow))) {
      throw new Error(`Target batch content differs for ${row.entity_type}:${row.entity_id}`);
    }
  }
  const statuses = {};
  for (const row of existingRows.rows) statuses[row.status] = Number(statuses[row.status] || 0) + 1;
  return { alreadyImported: true, statuses };
}

async function insertSource(client, source, tenantId) {
  await client.query(`INSERT INTO catalog_introduction_batches (
    id, tenant_id, model, prompt_version, catalog_data_version, catalog_snapshot_hash, status,
    entity_count, completed_count, failed_count, concurrency_json, metrics_json, error,
    created_by, reviewed_by, approved_at, created_at, updated_at
  ) VALUES ($1,$2,$3,$4,$5,$6,'generated',$7,$8,$9,$10,$11,$12,$13,NULL,NULL,$14,$15)`, [
    source.batch.id, tenantId, source.batch.model, source.batch.prompt_version,
    source.batch.catalog_data_version, source.batch.catalog_snapshot_hash,
    source.batch.entity_count, source.batch.completed_count, source.batch.failed_count,
    source.batch.concurrency_json || '{}', source.batch.metrics_json || '{}', source.batch.error || null,
    source.batch.created_by || null, source.batch.created_at, source.batch.updated_at,
  ]);
  const quoted = INTRODUCTION_COLUMNS.map((column) => `"${column}"`).join(', ');
  const placeholders = INTRODUCTION_COLUMNS.map((_, index) => `$${index + 1}`).join(', ');
  const sql = `INSERT INTO catalog_entity_introductions (${quoted}) VALUES (${placeholders})`;
  for (const row of source.rows) await client.query(sql, rowValues(row));
}

async function rollbackBatch(client, source, tenantId) {
  const batch = await client.query('SELECT * FROM catalog_introduction_batches WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [tenantId, source.batch.id]);
  if (!batch.rowCount) throw new Error(`Target batch not found: ${source.batch.id}`);
  if (stableCatalogIntroductionHash(immutableBatch(batch.rows[0])) !== stableCatalogIntroductionHash(immutableBatch(source.batch))) {
    throw new Error('Target batch immutable fields differ from the rollback source');
  }
  if (batch.rows[0].status !== 'generated') {
    throw new Error('Approved introduction batches must be rolled back through the application review workflow');
  }
  const targetRows = await client.query('SELECT * FROM catalog_entity_introductions WHERE tenant_id = $1 AND batch_id = $2', [tenantId, source.batch.id]);
  if (targetRows.rowCount !== source.rows.length) throw new Error('Target rollback batch is incomplete');
  const expected = new Map(source.rows.map((row) => [row.id, row]));
  for (const row of targetRows.rows) {
    const sourceRow = expected.get(row.id);
    if (row.status !== 'schema_validated' || row.reviewed_by || row.reviewed_at
      || !sourceRow
      || stableCatalogIntroductionHash(immutableIntroduction(row)) !== stableCatalogIntroductionHash(immutableIntroduction(sourceRow))) {
      throw new Error(`Target row is not safe to roll back: ${row.id}`);
    }
  }
  const deleted = await client.query('DELETE FROM catalog_introduction_batches WHERE tenant_id = $1 AND id = $2', [tenantId, source.batch.id]);
  return deleted.rowCount;
}

async function main() {
  const sourcePath = resolve(String(option('source', DEFAULT_SOURCE)));
  const tenantId = String(option('tenant', 'default'));
  const batchId = String(option('batch-id', ''));
  const expectedCount = Number(option('expected-count', DEFAULT_EXPECTED_COUNT));
  const apply = Boolean(option('apply', false));
  const rollback = String(option('rollback', ''));
  if (apply && rollback) throw new Error('--apply and --rollback are mutually exclusive');
  const source = inspectIntroductionSource(sourcePath, { tenantId, batchId, expectedCount });
  const expectedChecksum = String(option('checksum', ''));
  if (expectedChecksum && expectedChecksum !== source.checksum) throw new Error('Source checksum does not match --checksum');
  const expectedDigest = String(option('digest', ''));
  if ((apply || rollback) && !expectedDigest) throw new Error('--digest from a successful dry-run is required for apply or rollback');
  if (expectedDigest && expectedDigest !== source.logicalDigest) throw new Error('Source logical digest does not match --digest');
  const databaseUrl = process.env.DATABASE_MIGRATION_URL;
  if (!databaseUrl) throw new Error('Explicit DATABASE_MIGRATION_URL is required');
  const summary = {
    mode: apply ? 'apply' : (rollback ? 'rollback' : 'dry-run'),
    sourcePath,
    sourceChecksum: source.checksum,
    sourceDigest: source.logicalDigest,
    tenantId,
    batchId: source.batch.id,
    model: source.batch.model,
    promptVersion: source.batch.prompt_version,
    catalogSnapshotHash: source.batch.catalog_snapshot_hash,
    counts: source.counts,
    quality: source.quality,
  };
  const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: 'catalog-introduction-import' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`catalog-introduction:${tenantId}`]);
    await client.query("SELECT set_config('app.tenant_id',$1,true), set_config('app.user_id','catalog-introduction-import',true), set_config('app.role','super_admin',true)", [tenantId]);
    await assertTargetReady(client);
    if (rollback) {
      if (rollback !== source.batch.id) throw new Error('--rollback must match the inspected source batch');
      const deleted = await rollbackBatch(client, source, tenantId);
      await client.query('COMMIT');
      console.log(JSON.stringify({ ...summary, deleted }, null, 2));
      return;
    }
    await client.query('LOCK TABLE canteens, stalls, dishes IN SHARE MODE');
    const target = await loadCatalogIntroductionEvidence(postgresAdapter(client), { tenantId });
    assertCatalogMatches(source, target);
    const existing = await assertIdempotentOrEmpty(client, source, tenantId);
    if (!apply || existing.alreadyImported) {
      await client.query('ROLLBACK');
      console.log(JSON.stringify({ ...summary, alreadyImported: existing.alreadyImported }, null, 2));
      return;
    }
    await insertSource(client, source, tenantId);
    const audit = await client.query('SELECT status, COUNT(*)::integer AS count FROM catalog_entity_introductions WHERE tenant_id = $1 AND batch_id = $2 GROUP BY status', [tenantId, source.batch.id]);
    const imported = audit.rows.reduce((sum, row) => sum + Number(row.count), 0);
    if (imported !== source.rows.length || audit.rows.some((row) => row.status !== 'schema_validated')) throw new Error('Post-import audit failed');
    const postImport = await assertIdempotentOrEmpty(client, source, tenantId);
    if (!postImport.alreadyImported) throw new Error('Post-import immutable digest audit failed');
    await client.query('COMMIT');
    console.log(JSON.stringify({ ...summary, imported, statuses: Object.fromEntries(audit.rows.map((row) => [row.status, Number(row.count)])) }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
