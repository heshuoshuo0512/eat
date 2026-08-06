#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import {
  auditCatalogIntroductionRecords,
  createCatalogIntroductionBatch,
  loadCatalogIntroductionEvidence,
  mapCatalogIntroductionRow,
  nextCatalogIntroductionVersions,
  saveCatalogIntroductionCandidate,
  stableCatalogIntroductionHash,
  updateCatalogIntroductionBatch,
  validateCatalogIntroductionCandidate,
} from '../server/catalogIntroductions.js';
import { PgDatabase } from '../server/database.js';
import { inspectIntroductionSource } from './import-catalog-introductions-postgres.mjs';

const { Pool } = pg;
const DEFAULT_SOURCE = 'data/real-catalog-introductions-v4-stable-hash-2026-07-29.sqlite';
const DEFAULT_REPORT = 'artifacts/catalog-introduction-revalidation-report.json';

function option(name, fallback = '') {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  const match = process.argv.find((value) => value === exact || value.startsWith(prefix));
  if (!match) return fallback;
  return match === exact ? true : match.slice(prefix.length);
}

function assertSafeIdentifier(value, label) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(value || ''))) {
    throw new Error(`${label} contains unsupported characters`);
  }
}

function errorDetails(error) {
  return {
    code: error?.code || 'CATALOG_INTRODUCTION_REVALIDATION_FAILED',
    message: String(error?.message || error).slice(0, 500),
  };
}

function keyOf(record) {
  return `${record.entityType}:${record.entityId}`;
}

function candidateFromRecord(record) {
  return {
    entityType: record.entityType,
    entityId: record.entityId,
    factualClaims: record.claims.filter((claim) => claim.type === 'fact')
      .map(({ text, evidenceIds }) => ({ text, evidenceIds })),
    recommendationClaims: record.claims.filter((claim) => claim.type === 'recommendation')
      .map(({ text, evidenceIds }) => ({ text, evidenceIds })),
    semanticLabels: record.semanticLabels,
    boundaryCodes: record.boundaryCodes,
  };
}

export function revalidateRecords(sourceRecords, evidence) {
  const evidenceByKey = new Map(evidence.map((item) => [keyOf({
    entityType: item.entityType,
    entityId: item.entity.id,
  }), item]));
  const valid = [];
  const missing = [];
  const failed = [];

  for (const sourceRecord of sourceRecords) {
    const key = keyOf(sourceRecord);
    const current = evidenceByKey.get(key);
    if (!current) {
      missing.push({
        id: sourceRecord.id,
        entityType: sourceRecord.entityType,
        entityId: sourceRecord.entityId,
        reason: 'ENTITY_NOT_IN_CURRENT_CATALOG',
      });
      continue;
    }
    try {
      const candidate = validateCatalogIntroductionCandidate(candidateFromRecord(sourceRecord), current);
      valid.push({ sourceRecord, candidate });
    } catch (error) {
      failed.push({
        id: sourceRecord.id,
        entityType: sourceRecord.entityType,
        entityId: sourceRecord.entityId,
        ...errorDetails(error),
      });
    }
  }

  const qualityRecords = valid.map(({ sourceRecord, candidate }) => ({
    id: sourceRecord.id,
    ...candidate,
  }));
  const quality = auditCatalogIntroductionRecords(qualityRecords);
  return { valid, missing, failed, quality };
}

function summarizeFailures(failures) {
  return failures.reduce((summary, item) => {
    const reason = item.reason || item.code || 'UNKNOWN';
    summary[reason] = Number(summary[reason] || 0) + 1;
    return summary;
  }, {});
}

function buildBatchId(snapshotHash) {
  return `catalog-introduction-v4-revalidated-${String(snapshotHash).slice(0, 24)}`;
}

function makeReport({ source, current, result, batchId, mode, approvedCount = 0, existingBatch = null }) {
  return {
    generatedAt: new Date().toISOString(),
    mode,
    source: {
      path: source.path,
      checksum: source.checksum,
      digest: source.logicalDigest,
      batchId: source.batch.id,
      entityCount: source.rows.length,
    },
    target: {
      tenantId: source.batch.tenant_id,
      catalogDataVersion: current.catalogDataVersion,
      snapshotHash: current.snapshotHash,
      counts: current.counts,
    },
    batch: {
      id: batchId,
      status: existingBatch?.status || (approvedCount ? 'approved' : 'generated'),
      entityCount: result.valid.length,
      approvedCount,
      existing: Boolean(existingBatch),
    },
    revalidation: {
      sourceCount: source.rows.length,
      validCount: result.valid.length,
      missingCount: result.missing.length,
      failedCount: result.failed.length,
      failureReasons: summarizeFailures([...result.missing, ...result.failed]),
      quality: result.quality,
    },
    missing: result.missing,
    failed: result.failed,
  };
}

function writeReport(path, report) {
  if (!path) return;
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function targetReady(tx) {
  const version = Number((await tx.prepare('SHOW server_version_num').get())?.server_version_num || 0);
  if (version < 160000 || version >= 170000) throw new Error(`PostgreSQL 16 is required, received ${version}`);
  const tables = await tx.prepare("SELECT to_regclass('catalog_introduction_batches') AS batches, to_regclass('catalog_entity_introductions') AS introductions").get();
  if (!tables?.batches || !tables?.introductions) throw new Error('Catalog introduction tables are not available');
}

async function insertAndApprove(tx, { source, current, result, tenantId, batchId, approve }) {
  const existing = await tx.prepare('SELECT * FROM catalog_introduction_batches WHERE tenant_id = ? AND id = ?').get(tenantId, batchId);
  if (existing) {
    const rows = await tx.prepare('SELECT * FROM catalog_entity_introductions WHERE tenant_id = ? AND batch_id = ?').all(tenantId, batchId);
    if (Number(existing.entity_count) !== result.valid.length || rows.length !== result.valid.length) {
      throw new Error(`Existing revalidation batch is incomplete: ${rows.length}/${result.valid.length}`);
    }
    if (approve && existing.status !== 'approved') {
      await approveExistingBatch(tx, { tenantId, batchId, rows, reviewedBy: 'catalog-introduction-revalidation' });
      return { existing, approvedCount: rows.length };
    }
    return { existing, approvedCount: existing.status === 'approved' ? rows.length : 0 };
  }

  const batch = await createCatalogIntroductionBatch(tx, {
    id: batchId,
    tenantId,
    model: source.batch.model,
    promptVersion: source.batch.prompt_version,
    catalogDataVersion: current.catalogDataVersion,
    snapshotHash: current.snapshotHash,
    entityCount: result.valid.length,
    createdBy: 'catalog-introduction-revalidation',
  });
  const versions = await nextCatalogIntroductionVersions(tx, tenantId);
  for (const item of result.valid) {
    const key = keyOf(item.candidate);
    const version = versions.get(key) || 1;
    await saveCatalogIntroductionCandidate(tx, {
      tenantId,
      batchId: batch.id,
      version,
      model: source.batch.model,
      promptVersion: source.batch.prompt_version,
      candidate: item.candidate,
    });
    versions.set(key, version + 1);
  }
  await updateCatalogIntroductionBatch(tx, batch.id, tenantId, {
    status: approve ? 'approved' : 'generated',
    completedCount: result.valid.length,
    failedCount: result.missing.length + result.failed.length,
    metrics: {
      revalidatedFromBatch: source.batch.id,
      currentCatalogSnapshotHash: current.snapshotHash,
      sourceCount: source.rows.length,
      validCount: result.valid.length,
      missingCount: result.missing.length,
      failedCount: result.failed.length,
      quality: result.quality,
    },
    ...(approve ? { reviewedBy: 'catalog-introduction-revalidation', approvedAt: new Date().toISOString() } : {}),
  });

  const rows = await tx.prepare('SELECT * FROM catalog_entity_introductions WHERE tenant_id = ? AND batch_id = ?').all(tenantId, batch.id);
  if (approve) await approveExistingBatch(tx, { tenantId, batchId: batch.id, rows, reviewedBy: 'catalog-introduction-revalidation' });
  return { existing: null, approvedCount: approve ? rows.length : 0 };
}

async function approveExistingBatch(tx, { tenantId, batchId, rows, reviewedBy }) {
  const timestamp = new Date().toISOString();
  for (const row of rows) {
    const previous = await tx.prepare("SELECT id FROM catalog_entity_introductions WHERE tenant_id = ? AND entity_type = ? AND entity_id = ? AND status = 'approved' AND id <> ? FOR UPDATE").get(tenantId, row.entity_type, row.entity_id, row.id);
    if (previous) {
      await tx.prepare("UPDATE catalog_entity_introductions SET status = 'retired', updated_at = ? WHERE tenant_id = ? AND id = ?").run(timestamp, tenantId, previous.id);
    }
    await tx.prepare("UPDATE catalog_entity_introductions SET status = 'approved', previous_introduction_id = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?").run(previous?.id || null, reviewedBy, timestamp, timestamp, tenantId, row.id);
  }
  await updateCatalogIntroductionBatch(tx, batchId, tenantId, {
    status: 'approved', reviewedBy, approvedAt: timestamp,
  });
  await tx.prepare('INSERT INTO audit_logs (id, tenant_id, user_id, action, entity, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    randomUUID(), tenantId, reviewedBy, 'APPROVE_BATCH', 'catalog_introduction_batch', batchId,
    JSON.stringify({ source: 'catalog_revalidation', approvedCount: rows.length }), timestamp,
  );
}

async function main() {
  const sourcePath = resolve(String(option('source', DEFAULT_SOURCE)));
  const tenantId = String(option('tenant', 'default'));
  const apply = Boolean(option('apply', false));
  const approve = Boolean(option('approve', false));
  const reportPath = String(option('report', DEFAULT_REPORT));
  const databaseUrl = process.env.DATABASE_MIGRATION_URL;
  if (!existsSync(sourcePath)) throw new Error(`Introduction source not found: ${sourcePath}`);
  assertSafeIdentifier(tenantId, 'tenant');
  if (!databaseUrl) throw new Error('Explicit DATABASE_MIGRATION_URL is required');
  if (approve && !apply) throw new Error('--approve requires --apply');

  const sourceInspection = inspectIntroductionSource(sourcePath, { tenantId });
  const source = { ...sourceInspection, path: sourcePath };
  const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: 'catalog-introduction-revalidation' });
  const db = new PgDatabase(pool);
  let report;
  try {
    await db.runWithContext({ tenantId, userId: 'catalog-introduction-revalidation', role: 'super_admin' }, async () => {
      const execution = await db.transaction(async (tx) => {
        await targetReady(tx);
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`catalog-introduction-revalidation:${tenantId}`]);
        await tx.exec('LOCK TABLE canteens, stalls, dishes IN SHARE MODE');
        const current = await loadCatalogIntroductionEvidence(tx, { tenantId });
        const result = revalidateRecords(source.rows.map(mapCatalogIntroductionRow), current.evidence);
        if (!result.quality.ok) throw new Error(`Revalidated introduction quality audit failed: ${JSON.stringify(result.quality)}`);
        const batchId = String(option('batch-id', buildBatchId(current.snapshotHash)));
        assertSafeIdentifier(batchId, 'batch-id');
        if (!apply) return { current, result, batchId, existing: null, approvedCount: 0 };
        const applied = await insertAndApprove(tx, { source, current, result, tenantId, batchId, approve });
        return { current, result, batchId, ...applied };
      });
      report = makeReport({
        source, current: execution.current, result: execution.result, batchId: execution.batchId,
        mode: apply ? (approve ? 'apply-and-approve' : 'apply') : 'dry-run',
        approvedCount: execution.approvedCount, existingBatch: execution.existing,
      });
    });
  } finally {
    await pool.end();
  }
  writeReport(reportPath, report);
  console.log(JSON.stringify(report, null, 2));
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1]).replaceAll('\\', '/')}`).href;
if (isMain) main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
