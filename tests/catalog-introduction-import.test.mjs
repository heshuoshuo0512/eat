import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inspectIntroductionSource } from '../scripts/import-catalog-introductions-postgres.mjs';
import { stableCatalogIntroductionHash, validateCatalogIntroductionCandidate } from '../server/catalogIntroductions.js';

const temporaryDirectories = [];

function fixture({ status = 'generated', completed = 2, failed = 0 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'catalog-intro-import-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'source.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE catalog_introduction_batches (
      id TEXT PRIMARY KEY, tenant_id TEXT, model TEXT, prompt_version TEXT,
      catalog_data_version TEXT, catalog_snapshot_hash TEXT, status TEXT,
      entity_count INTEGER, completed_count INTEGER, failed_count INTEGER,
      concurrency_json TEXT, metrics_json TEXT, error TEXT, created_by TEXT,
      reviewed_by TEXT, approved_at TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE catalog_entity_introductions (
      id TEXT PRIMARY KEY, tenant_id TEXT, batch_id TEXT, entity_type TEXT,
      hierarchy_level TEXT, entity_id TEXT, version INTEGER, factual_summary TEXT,
      recommendation_copy TEXT, claim_evidence_json TEXT, semantic_labels_json TEXT,
      evidence_ids_json TEXT, evidence_snapshot_json TEXT, boundary_codes_json TEXT,
      confidence_score REAL, confidence_level TEXT, model TEXT, prompt_version TEXT,
      input_hash TEXT, content_hash TEXT, status TEXT, previous_introduction_id TEXT,
      error TEXT, reviewed_by TEXT, reviewed_at TEXT, created_at TEXT, updated_at TEXT
    );
  `);
  const hash = 'a'.repeat(64);
  db.prepare(`INSERT INTO catalog_introduction_batches VALUES (
    'batch-1','default','model-1','prompt-1','catalog-1',? ,?,2,?,?, '{}','{}',NULL,NULL,NULL,NULL,'now','now'
  )`).run(hash, status, completed, failed);
  const insert = db.prepare(`INSERT INTO catalog_entity_introductions (
    id,tenant_id,batch_id,entity_type,hierarchy_level,entity_id,version,
    factual_summary,recommendation_copy,claim_evidence_json,semantic_labels_json,
    evidence_ids_json,evidence_snapshot_json,boundary_codes_json,confidence_score,
    confidence_level,model,prompt_version,input_hash,content_hash,status,
    previous_introduction_id,error,reviewed_by,reviewed_at,created_at,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,'now','now')`);
  const makeRow = (entityType, hierarchyLevel, entityId, name) => {
    const evidenceBase = {
      entityType,
      hierarchyLevel,
      entity: { id: entityId, name },
      hierarchy: [],
      semanticLabels: [],
      concepts: [],
      boundaryCodes: ['CATALOG_DERIVED', 'SUPPLY_UNCONFIRMED', 'MENU_MISSING'],
      allowedEvidenceIds: [`${entityType}:${entityId}`],
    };
    const evidence = {
      ...evidenceBase,
      confidence: { score: 0.3, level: 'low', factors: {} },
      inputHash: stableCatalogIntroductionHash(evidenceBase),
    };
    const candidate = validateCatalogIntroductionCandidate({
      entityType,
      entityId,
      factualClaims: [{ text: `目录记录了${name}名称`, evidenceIds: evidence.allowedEvidenceIds }],
      recommendationClaims: [{ text: '目录尚未记录菜单，具体供应待核验', evidenceIds: evidence.allowedEvidenceIds }],
      semanticLabels: [],
      boundaryCodes: evidence.boundaryCodes,
    }, evidence);
    return { evidence, candidate };
  };
  for (const [id, type, level, entityId, name] of [
    ['intro-stall', 'stall', 'stall', 'stall-1', '测试档口'],
    ['intro-canteen', 'canteen', 'venue', 'canteen-1', '测试食堂'],
  ]) {
    const { evidence, candidate } = makeRow(type, level, entityId, name);
    insert.run(
      id, 'default', 'batch-1', type, level, entityId, 1,
      candidate.factualSummary, candidate.recommendationCopy, JSON.stringify(candidate.claims),
      JSON.stringify(candidate.semanticLabels), JSON.stringify(candidate.evidenceIds), JSON.stringify(evidence),
      JSON.stringify(candidate.boundaryCodes), candidate.confidence.score, candidate.confidence.level,
      'model-1', 'prompt-1', candidate.inputHash, candidate.contentHash, 'schema_validated',
    );
  }
  db.close();
  return path;
}

afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

describe('Catalog introduction PostgreSQL import preflight', () => {
  it('accepts one complete generated batch and reports its level counts', () => {
    const result = inspectIntroductionSource(fixture(), { tenantId: 'default', batchId: 'batch-1', expectedCount: 2 });
    assert.equal(result.batch.status, 'generated');
    assert.equal(result.rows.length, 2);
    assert.deepEqual(result.counts.levels, { stall: 1, venue: 1 });
    assert.equal(result.quality.ok, true);
    assert.match(result.checksum, /^[a-f0-9]{64}$/);
  });

  it('rejects a preparing or incomplete batch before connecting to production', () => {
    assert.throws(
      () => inspectIntroductionSource(fixture({ status: 'preparing', completed: 0 }), { expectedCount: 2 }),
      /not generated: preparing/,
    );
    assert.throws(
      () => inspectIntroductionSource(fixture({ completed: 1, failed: 1 }), { expectedCount: 2 }),
      /Source batch is incomplete/,
    );
  });

  it('rejects rows that bypass review or carry invalid hashes', () => {
    const path = fixture();
    const db = new DatabaseSync(path);
    db.prepare("UPDATE catalog_entity_introductions SET status = 'approved' WHERE id = 'intro-stall'").run();
    db.close();
    assert.throws(() => inspectIntroductionSource(path, { expectedCount: 2 }), /not schema_validated/);
  });
});
