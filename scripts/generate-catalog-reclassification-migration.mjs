#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function sqlString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? null))}::jsonb`;
}

const source = resolve(option('source', 'data/imports/real/campus-2026-07-27/catalog-classification-audit-v4.json'));
const migrationPath = resolve(option('migration', 'server/migrations/030_catalog_category_reclassification.sql'));
const rollbackPath = resolve(option('rollback', 'server/rollbacks/030_catalog_category_reclassification.rollback.sql'));
const audit = JSON.parse(readFileSync(source, 'utf8'));
const records = Array.isArray(audit.records) ? audit.records : [];
if (!records.length) throw new Error(`分类审计没有记录: ${source}`);
if (new Set(records.map((record) => record.id)).size !== records.length) throw new Error('分类审计包含重复菜品 ID');
if (records.some((record) => record.auditStatus === 'needs_review')) throw new Error('分类审计仍有 needs_review 记录');

const batchId = option('batch', 'catalog-reclassification-030-v1');
const values = records.map((record) => [
  sqlString(record.id),
  sqlString(record.itemType),
  sqlString(record.category),
  sqlString(record.reason),
  sqlString(record.stall),
  Number.isFinite(Number(record.price)) ? String(Number(record.price)) : 'NULL',
  sqlJson({ evidence: record.evidence || [], sourceRef: record.sourceRef || null }),
].join(', ')).map((row) => `(${row})`);

const migration = `-- Generated from ${source.replace(/\\/g, '/')}
-- Batch: ${batchId}
-- This is a logical business-partition migration. It does not import, delete or rename dishes.

CREATE TABLE IF NOT EXISTS catalog_classification_audits (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  dish_id TEXT NOT NULL,
  before_item_type TEXT NOT NULL,
  before_category TEXT NOT NULL,
  after_item_type TEXT NOT NULL,
  after_category TEXT NOT NULL,
  rule TEXT NOT NULL,
  stall_name TEXT NOT NULL DEFAULT '',
  price NUMERIC,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, batch_id, dish_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_classification_audits_batch
  ON catalog_classification_audits(tenant_id, batch_id, dish_id);

CREATE TEMP TABLE catalog_classification_030_proposed (
  dish_id TEXT PRIMARY KEY,
  after_item_type TEXT NOT NULL,
  after_category TEXT NOT NULL,
  rule TEXT NOT NULL,
  stall_name TEXT NOT NULL,
  price NUMERIC,
  evidence_json JSONB NOT NULL
) ON COMMIT DROP;

INSERT INTO catalog_classification_030_proposed
  (dish_id, after_item_type, after_category, rule, stall_name, price, evidence_json)
VALUES
  ${values.join(',\n  ')};

DO $$
DECLARE
  expected_count INTEGER := ${records.length};
  missing_count INTEGER;
  extra_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM catalog_classification_030_proposed p
  LEFT JOIN dishes d ON d.tenant_id = 'default' AND d.id = p.dish_id
  WHERE d.id IS NULL;

  SELECT COUNT(*) INTO extra_count
  FROM dishes d
  LEFT JOIN catalog_classification_030_proposed p ON p.dish_id = d.id
  WHERE d.tenant_id = 'default' AND p.dish_id IS NULL;

  IF (SELECT COUNT(*) FROM catalog_classification_030_proposed) <> expected_count
     OR (SELECT COUNT(*) FROM dishes WHERE tenant_id = 'default') <> expected_count
     OR missing_count <> 0 OR extra_count <> 0 THEN
    RAISE EXCEPTION '030 catalog classification source mismatch: expected %, missing %, extra %', expected_count, missing_count, extra_count;
  END IF;
END $$;

INSERT INTO catalog_classification_audits
  (tenant_id, batch_id, dish_id, before_item_type, before_category,
   after_item_type, after_category, rule, stall_name, price, evidence_json)
SELECT 'default', ${sqlString(batchId)}, d.id, d.catalog_item_type, d.catalog_category,
       p.after_item_type, p.after_category, p.rule, p.stall_name, p.price, p.evidence_json
FROM dishes d
JOIN catalog_classification_030_proposed p ON p.dish_id = d.id
WHERE d.tenant_id = 'default'
ON CONFLICT (tenant_id, batch_id, dish_id) DO NOTHING;

UPDATE dishes d
SET catalog_item_type = p.after_item_type,
    catalog_category = p.after_category,
    updated_at = CURRENT_TIMESTAMP
FROM catalog_classification_030_proposed p
WHERE d.tenant_id = 'default' AND d.id = p.dish_id;

-- RAG documents are derived data. Remove the old partition metadata atomically;
-- the deployment procedure must run the catalog reindex before reopening the API.
DELETE FROM rag_documents
WHERE tenant_id = 'default' AND source_type = 'dish';

-- Rollback is generated separately in server/rollbacks.
`;

const rollback = `-- Rollback for ${batchId}
-- Run only after stopping the API, then rebuild the RAG index.

DO $$
DECLARE
  mismatch_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO mismatch_count
  FROM catalog_classification_audits a
  JOIN dishes d ON d.tenant_id = a.tenant_id AND d.id = a.dish_id
  WHERE a.tenant_id = 'default' AND a.batch_id = ${sqlString(batchId)}
    AND (d.catalog_item_type <> a.after_item_type OR d.catalog_category <> a.after_category);
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION '030 rollback refused: % dish classification(s) changed after migration', mismatch_count;
  END IF;
END $$;

UPDATE dishes d
SET catalog_item_type = a.before_item_type,
    catalog_category = a.before_category,
    updated_at = CURRENT_TIMESTAMP
FROM catalog_classification_audits a
WHERE a.tenant_id = 'default'
  AND a.batch_id = ${sqlString(batchId)}
  AND d.tenant_id = a.tenant_id
  AND d.id = a.dish_id;

DELETE FROM rag_documents
WHERE tenant_id = 'default' AND source_type = 'dish';
`;

mkdirSync(dirname(migrationPath), { recursive: true });
mkdirSync(dirname(rollbackPath), { recursive: true });
writeFileSync(migrationPath, migration, 'utf8');
writeFileSync(rollbackPath, rollback, 'utf8');
console.log(JSON.stringify({ source, batchId, recordCount: records.length, migrationPath, rollbackPath }, null, 2));
