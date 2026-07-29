import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import {
  auditCatalogIntroductionRecords,
  approveCatalogIntroductionBatch,
  createCatalogIntroductionBatch,
  generateValidatedCatalogIntroductionBatch,
  listCatalogIntroductionCandidates,
  loadCatalogIntroductionEvidence,
  loadCatalogIntroductionMap,
  previewCatalogIntroductionBatchApproval,
  rollbackCatalogIntroductionBatch,
  saveCatalogIntroductionCandidate,
  updateCatalogIntroductionCandidate,
  validateCatalogIntroductionBatch,
} from '../server/catalogIntroductions.js';
import { openDatabase } from '../server/database.js';
import {
  reindexRetrieval,
  syncCanteenRetrievalDocument,
} from '../server/retrievalIndex.js';

function candidateFor(evidence) {
  const ownId = `${evidence.entityType}:${evidence.entity.id}`;
  if (evidence.hierarchyLevel === 'dish') {
    const locationId = evidence.stall?.id
      ? `stall:${evidence.stall.id}`
      : evidence.allowedEvidenceIds.find((id) => id.startsWith('canteen:'));
    return {
      entityType: evidence.entityType,
      entityId: evidence.entity.id,
      factualClaims: [
        { text: `目录记录菜品${evidence.entity.name}，价格标示为${evidence.entity.priceDisplay}`, evidenceIds: [ownId] },
        { text: `该菜品归在${evidence.stall?.name || '当前'}档口目录下`, evidenceIds: [locationId] },
      ],
      recommendationClaims: [
        { text: '从同档口菜单结构看可能可供进一步了解，具体做法待核验', evidenceIds: [locationId] },
      ],
      semanticLabels: [],
      boundaryCodes: evidence.boundaryCodes,
    };
  }
  const menuMissing = evidence.boundaryCodes.includes('MENU_MISSING');
  const relatedId = evidence.allowedEvidenceIds.find((id) => id !== ownId) || ownId;
  return {
    entityType: evidence.entityType,
    entityId: evidence.entity.id,
    factualClaims: menuMissing
      ? [{ text: `目录记录了${evidence.entity.name}的名称与所在层级`, evidenceIds: [ownId] }]
      : [
        { text: `目录记录了${evidence.entity.name}的名称与所在层级`, evidenceIds: [ownId] },
        { text: '目录同时收录了下属菜单或关联实体', evidenceIds: [relatedId] },
      ],
    recommendationClaims: [{
      text: menuMissing ? '目录尚未收录菜品，经营内容与供应情况待核验' : '从菜单结构看可能可供按目录分类继续了解',
      evidenceIds: [relatedId],
    }],
    semanticLabels: [],
    boundaryCodes: evidence.boundaryCodes,
  };
}

function insertCatalogOnlyTenant(db, tenantId = 'intro-tenant') {
  const timestamp = new Date().toISOString();
  db.prepare('INSERT INTO tenants (id, name, status, plan, ai_quota, storage_quota_mb, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(tenantId, '介绍测试租户', 'active', 'starter', 0, 100, timestamp, timestamp);
  db.prepare(`INSERT INTO canteens (
    id, tenant_id, name, location, hours, crowd_level, tags_json, description,
    venue_kind, display_name, display_order, operating_status, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    `${tenantId}-venue`, tenantId, '目录测试食堂', '测试校区', '', 0, '[]', '',
    'dining_hall', '目录测试食堂', 1, 'open', timestamp, timestamp,
  );
}

describe('catalog introduction evidence and validation', () => {
  it('builds deterministic evidence and enforces dish evidence diversity', async () => {
    const db = openDatabase(':memory:');
    try {
      const first = await loadCatalogIntroductionEvidence(db, { tenantId: 'default' });
      const second = await loadCatalogIntroductionEvidence(db, { tenantId: 'default' });
      assert.ok(first.counts.dishes > 0);
      assert.equal(first.counts.total, first.evidence.length);
      assert.equal(first.snapshotHash, second.snapshotHash);
      assert.ok(first.evidence.every((item) => item.inputHash && item.allowedEvidenceIds.includes(`${item.entityType}:${item.entity.id}`)));

      const dishEvidence = first.evidence.find((item) => item.hierarchyLevel === 'dish');
      const valid = candidateFor(dishEvidence);
      const [record] = validateCatalogIntroductionBatch({ introductions: [valid] }, [dishEvidence]);
      assert.equal(record.entityId, dishEvidence.entity.id);
      assert.ok(record.evidenceIds.some((id) => id.startsWith('stall:') || id.startsWith('canteen:')));
      assert.equal(auditCatalogIntroductionRecords([{ ...record, id: 'record-one' }]).ok, true);

      const withoutGeneratedBoundaries = structuredClone(valid);
      delete withoutGeneratedBoundaries.boundaryCodes;
      const [serverBounded] = validateCatalogIntroductionBatch({ introductions: [withoutGeneratedBoundaries] }, [dishEvidence]);
      assert.deepEqual(serverBounded.boundaryCodes, dishEvidence.boundaryCodes);

      const shallow = structuredClone(valid);
      shallow.factualClaims[1].evidenceIds = [`dish:${dishEvidence.entity.id}`];
      assert.throws(
        () => validateCatalogIntroductionBatch({ introductions: [shallow] }, [dishEvidence]),
        (error) => error.code === 'CATALOG_INTRODUCTION_EVIDENCE_DIVERSITY_REQUIRED',
      );

      const illegalReference = structuredClone(valid);
      illegalReference.factualClaims[1].evidenceIds = ['stall:other-tenant'];
      assert.throws(
        () => validateCatalogIntroductionBatch({ introductions: [illegalReference] }, [dishEvidence]),
        (error) => error.code === 'INVALID_CATALOG_INTRODUCTION_REFERENCE',
      );

      const unsafe = structuredClone(valid);
      unsafe.recommendationClaims[0].text = '这道菜绝对安全，可以放心吃';
      assert.throws(
        () => validateCatalogIntroductionBatch({ introductions: [unsafe] }, [dishEvidence]),
        (error) => error.code === 'FORBIDDEN_CATALOG_CLAIM',
      );

      const unsupportedSupply = structuredClone(valid);
      unsupportedSupply.recommendationClaims[0].text = `目录显示该菜由${dishEvidence.stall.name}档口供应，可优先了解`;
      assert.throws(
        () => validateCatalogIntroductionBatch({ introductions: [unsupportedSupply] }, [dishEvidence]),
        (error) => error.code === 'UNSUPPORTED_CATALOG_SUPPLY_CLAIM',
      );

      const supplyUnconfirmed = structuredClone(valid);
      supplyUnconfirmed.recommendationClaims[0].text = '目录只记录菜品归属，今日供应尚未确认，具体信息待核验';
      assert.doesNotThrow(() => validateCatalogIntroductionBatch({ introductions: [supplyUnconfirmed] }, [dishEvidence]));

      const labeledEvidence = structuredClone(dishEvidence);
      labeledEvidence.semanticLabels = ['粉面主食'];
      const unsupportedSoftLabel = candidateFor(labeledEvidence);
      unsupportedSoftLabel.recommendationClaims[0].text = '目录显示该菜为粉面主食，可优先了解';
      assert.throws(
        () => validateCatalogIntroductionBatch({ introductions: [unsupportedSoftLabel] }, [labeledEvidence]),
        (error) => error.code === 'SOFT_SEMANTIC_BOUNDARY_REQUIRED',
      );
      unsupportedSoftLabel.recommendationClaims[0].text = '从目录标签看可能可按粉面主食继续了解';
      assert.doesNotThrow(() => validateCatalogIntroductionBatch({ introductions: [unsupportedSoftLabel] }, [labeledEvidence]));

      const namedAsSignature = structuredClone(dishEvidence);
      namedAsSignature.entity.name = `招牌${dishEvidence.entity.name}`;
      const validSignatureName = candidateFor(namedAsSignature);
      assert.doesNotThrow(() => validateCatalogIntroductionBatch({ introductions: [validSignatureName] }, [namedAsSignature]));
      const unsupportedSignatureClaim = structuredClone(validSignatureName);
      unsupportedSignatureClaim.factualClaims[0].text += '，这是本档口的招牌菜';
      assert.throws(
        () => validateCatalogIntroductionBatch({ introductions: [unsupportedSignatureClaim] }, [namedAsSignature]),
        (error) => error.code === 'FORBIDDEN_CATALOG_CLAIM',
      );

      const unsupportedNumber = structuredClone(valid);
      unsupportedNumber.factualClaims[0].text = '目录价格为99999元';
      assert.throws(
        () => validateCatalogIntroductionBatch({ introductions: [unsupportedNumber] }, [dishEvidence]),
        (error) => error.code === 'UNSUPPORTED_CATALOG_NUMBER',
      );

      const generic = structuredClone(valid);
      generic.factualClaims = [
        { text: `目录记录菜品${dishEvidence.entity.name}`, evidenceIds: [`dish:${dishEvidence.entity.id}`] },
        { text: '目录还记录了所属位置', evidenceIds: [valid.factualClaims[1].evidenceIds[0]] },
      ];
      assert.throws(
        () => validateCatalogIntroductionBatch({ introductions: [generic] }, [dishEvidence]),
        (error) => error.code === 'CATALOG_INTRODUCTION_DISH_CONTEXT_REQUIRED',
      );
    } finally {
      db.close();
    }
  });

  it('marks serving tiers as low-confidence names requiring review', async () => {
    const db = openDatabase(':memory:');
    try {
      const dish = db.prepare("SELECT id FROM dishes WHERE tenant_id = 'default' LIMIT 1").get();
      db.prepare('UPDATE dishes SET name = ? WHERE id = ?').run('3‐4人份', dish.id);
      const evidence = (await loadCatalogIntroductionEvidence(db)).evidence.find((item) => item.entity.id === dish.id);
      assert.equal(evidence.entityNameReviewReason, 'serving_tier_without_product');
      assert.ok(evidence.boundaryCodes.includes('ENTITY_NAME_REVIEW_REQUIRED'));
      assert.deepEqual(evidence.semanticLabels, []);
      assert.deepEqual(evidence.concepts, []);
      assert.deepEqual(evidence.siblingDishes, []);
      assert.equal(evidence.confidence.level, 'low');
      assert.ok(evidence.confidence.score <= 0.39);
    } finally {
      db.close();
    }
  });

  it('calls a directed repair at most once', async () => {
    const db = openDatabase(':memory:');
    try {
      const evidence = (await loadCatalogIntroductionEvidence(db)).evidence.find((item) => item.hierarchyLevel === 'dish');
      const valid = candidateFor(evidence);
      let repairs = 0;
      const repaired = await generateValidatedCatalogIntroductionBatch({
        evidenceBatch: [evidence],
        generate: async () => ({ introductions: [] }),
        repair: async () => { repairs += 1; return { introductions: [valid] }; },
      });
      assert.equal(repaired.repaired, true);
      assert.equal(repairs, 1);

      repairs = 0;
      const invalidJson = Object.assign(new Error('AI 未返回有效 JSON'), {
        code: 'AI_PROVIDER_INVALID_JSON',
        rawOutput: '{"introductions":',
      });
      const repairedInvalidJson = await generateValidatedCatalogIntroductionBatch({
        evidenceBatch: [evidence],
        generate: async () => { throw invalidJson; },
        repair: async ({ previousOutput, validationError }) => {
          repairs += 1;
          assert.equal(previousOutput.invalidJson, '{"introductions":');
          assert.equal(validationError.code, 'AI_PROVIDER_INVALID_JSON');
          return { introductions: [valid] };
        },
      });
      assert.equal(repairedInvalidJson.repaired, true);
      assert.equal(repairs, 1);

      repairs = 0;
      await assert.rejects(() => generateValidatedCatalogIntroductionBatch({
        evidenceBatch: [evidence],
        generate: async () => ({ introductions: [] }),
        repair: async () => { repairs += 1; return { introductions: [] }; },
      }));
      assert.equal(repairs, 1);
    } finally {
      db.close();
    }
  });

  it('keeps provider metadata outside the strict introduction payload', async () => {
    const db = openDatabase(':memory:');
    try {
      const evidence = (await loadCatalogIntroductionEvidence(db)).evidence.find((item) => item.hierarchyLevel === 'dish');
      const valid = candidateFor(evidence);
      let repairs = 0;
      const result = await generateValidatedCatalogIntroductionBatch({
        evidenceBatch: [evidence],
        generate: async () => ({
          introductions: [valid],
          model: 'deepseek-v4-flash',
          finishReason: 'stop',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        }),
        repair: async () => { repairs += 1; return { introductions: [valid] }; },
      });
      assert.equal(result.repaired, false);
      assert.equal(repairs, 0);
      assert.equal(result.generated.model, 'deepseek-v4-flash');
      assert.equal(result.generated.usage.totalTokens, 150);
      assert.equal(result.candidates.length, 1);
    } finally {
      db.close();
    }
  });

  const realCatalogPath = resolve('data/real-catalog-introductions-2026-07-28.sqlite');
  it('keeps all 42 real no-menu stalls inside the explicit MENU_MISSING boundary', { skip: !existsSync(realCatalogPath) }, async () => {
    const db = new DatabaseSync(realCatalogPath, { readOnly: true });
    try {
      const catalog = await loadCatalogIntroductionEvidence(db, { tenantId: 'default' });
      const emptyStalls = catalog.evidence.filter((item) => item.hierarchyLevel === 'stall' && item.boundaryCodes.includes('MENU_MISSING'));
      assert.equal(emptyStalls.length, 42);
      assert.ok(emptyStalls.every((item) => item.menu.dishCount === 0 && item.allowedEvidenceIds.every((id) => !id.startsWith('dish:'))));
    } finally {
      db.close();
    }
  });

  it('keeps real catalog evidence hashes stable across database restarts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'smart-canteen-catalog-intro-hash-'));
    const databasePath = join(directory, 'catalog.sqlite');
    try {
      const setup = openDatabase(databasePath);
      const timestamp = new Date().toISOString();
      setup.prepare(`INSERT INTO data_import_batches (
        id, tenant_id, entity_type, status, source_name, row_count, error_count, created_by, reviewed_by, created_at, updated_at
      ) VALUES (?, 'default', 'real_catalog', 'approved', 'hash-stability-test', 0, 0, NULL, NULL, ?, ?)`)
        .run('hash-stability-test', timestamp, timestamp);
      setup.close();

      const first = openDatabase(databasePath);
      const firstHash = (await loadCatalogIntroductionEvidence(first, { tenantId: 'default' })).snapshotHash;
      first.close();
      const second = openDatabase(databasePath);
      const secondHash = (await loadCatalogIntroductionEvidence(second, { tenantId: 'default' })).snapshotHash;
      second.close();
      assert.equal(secondHash, firstHash);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('catalog introduction approval and RAG boundaries', () => {
  it('approves complete current batches, rejects stale hashes, rolls back, and indexes approved copy only', async () => {
    const db = openDatabase(':memory:');
    try {
      const tenantId = 'intro-tenant';
      insertCatalogOnlyTenant(db, tenantId);
      const firstCatalog = await loadCatalogIntroductionEvidence(db, { tenantId });
      assert.deepEqual(firstCatalog.counts, { dishes: 0, stalls: 0, canteens: 1, total: 1 });
      const firstEvidence = firstCatalog.evidence[0];
      const firstBatch = await createCatalogIntroductionBatch(db, {
        id: 'intro-batch-one', tenantId, model: 'deepseek-v4-flash', promptVersion: 'catalog-introduction-v1',
        catalogDataVersion: firstCatalog.catalogDataVersion, snapshotHash: firstCatalog.snapshotHash, entityCount: 1,
      });
      const resumedBatch = await createCatalogIntroductionBatch(db, {
        id: 'intro-batch-one', tenantId, model: 'deepseek-v4-flash', promptVersion: 'catalog-introduction-v1',
        catalogDataVersion: firstCatalog.catalogDataVersion, snapshotHash: firstCatalog.snapshotHash, entityCount: 1,
      });
      assert.equal(resumedBatch.id, firstBatch.id);
      await assert.rejects(() => createCatalogIntroductionBatch(db, {
        id: 'intro-batch-one', tenantId, model: 'deepseek-v4-flash', promptVersion: 'catalog-introduction-v1',
        catalogDataVersion: firstCatalog.catalogDataVersion, snapshotHash: 'different-snapshot', entityCount: 1,
      }), (error) => error.code === 'CATALOG_INTRODUCTION_BATCH_ID_CONFLICT');
      const [firstCandidate] = validateCatalogIntroductionBatch({ introductions: [candidateFor(firstEvidence)] }, [firstEvidence]);
      const firstRecord = await saveCatalogIntroductionCandidate(db, {
        tenantId, batchId: firstBatch.id, version: 1, model: 'deepseek-v4-flash', candidate: firstCandidate,
      });
      assert.equal((await loadCatalogIntroductionMap(db, { tenantId, entityType: 'canteen' })).size, 0);
      const firstPreview = await previewCatalogIntroductionBatchApproval(db, { tenantId, batchId: firstBatch.id });
      assert.equal(firstPreview.approvable, true);
      await approveCatalogIntroductionBatch(db, {
        tenantId, batchId: firstBatch.id, confirmation: firstPreview.requiredConfirmation,
        expectedDigest: firstPreview.approvalDigest, reviewedBy: 'reviewer-one',
      });
      assert.equal((await loadCatalogIntroductionMap(db, { tenantId, entityType: 'canteen' })).get(`canteen:${firstEvidence.entity.id}`).status, 'approved');

      const changedAt = new Date(Date.now() + 1_000).toISOString();
      db.prepare('UPDATE canteens SET description = ?, updated_at = ? WHERE tenant_id = ? AND id = ?')
        .run('目录发生变化', changedAt, tenantId, firstEvidence.entity.id);
      const stalePreview = await previewCatalogIntroductionBatchApproval(db, { tenantId, batchId: firstBatch.id });
      assert.equal(stalePreview.approvable, false);
      assert.equal(stalePreview.staleCount, 1);
      await assert.rejects(() => approveCatalogIntroductionBatch(db, {
        tenantId, batchId: firstBatch.id, confirmation: stalePreview.requiredConfirmation,
        expectedDigest: stalePreview.approvalDigest, reviewedBy: 'reviewer-one',
      }), (error) => error.status === 409);

      const secondCatalog = await loadCatalogIntroductionEvidence(db, { tenantId });
      const secondEvidence = secondCatalog.evidence[0];
      const secondBatch = await createCatalogIntroductionBatch(db, {
        id: 'intro-batch-two', tenantId, model: 'deepseek-v4-flash', promptVersion: 'catalog-introduction-v1',
        catalogDataVersion: secondCatalog.catalogDataVersion, snapshotHash: secondCatalog.snapshotHash, entityCount: 1,
      });
      const [secondCandidate] = validateCatalogIntroductionBatch({ introductions: [candidateFor(secondEvidence)] }, [secondEvidence]);
      await saveCatalogIntroductionCandidate(db, {
        tenantId, batchId: secondBatch.id, version: 2, model: 'deepseek-v4-flash', candidate: secondCandidate,
      });

      await syncCanteenRetrievalDocument(db, { tenantId, canteenId: secondEvidence.entity.id, vectorMode: 'off' });
      let indexed = db.prepare("SELECT content, metadata_json FROM rag_documents WHERE tenant_id = ? AND source_type = 'canteen' AND source_id = ?").get(tenantId, secondEvidence.entity.id);
      assert.doesNotMatch(indexed.content, /目录事实摘要|目录推测建议/);
      assert.equal(JSON.parse(indexed.metadata_json).catalogIntroduction, undefined);

      await reindexRetrieval(db, {
        tenantId, sourceTypes: ['canteen'], vectorMode: 'off', prune: true,
        catalogIntroductionStatuses: ['schema_validated'], catalogIntroductionBatchId: secondBatch.id,
      });
      indexed = db.prepare("SELECT content, metadata_json FROM rag_documents WHERE tenant_id = ? AND source_type = 'canteen' AND source_id = ?").get(tenantId, secondEvidence.entity.id);
      const candidateMetadata = JSON.parse(indexed.metadata_json).catalogIntroduction;
      assert.equal(candidateMetadata.status, 'schema_validated');
      assert.equal(candidateMetadata.evidenceType, 'ai_estimated');

      const secondPreview = await previewCatalogIntroductionBatchApproval(db, { tenantId, batchId: secondBatch.id });
      await approveCatalogIntroductionBatch(db, {
        tenantId, batchId: secondBatch.id, confirmation: secondPreview.requiredConfirmation,
        expectedDigest: secondPreview.approvalDigest, reviewedBy: 'reviewer-two',
      });
      await rollbackCatalogIntroductionBatch(db, {
        tenantId, batchId: secondBatch.id, confirmation: `回滚介绍批次 ${secondBatch.id}`, reviewedBy: 'reviewer-two',
      });
      const rows = await listCatalogIntroductionCandidates(db, { tenantId, limit: 10 });
      assert.equal(rows.items.find((item) => item.id === firstRecord.id).status, 'approved');
      assert.equal(rows.items.find((item) => item.batchId === secondBatch.id).status, 'retired');
    } finally {
      db.close();
    }
  });

  it('revalidates human edits and keeps sentence evidence synchronized', async () => {
    const db = openDatabase(':memory:');
    try {
      const evidence = (await loadCatalogIntroductionEvidence(db)).evidence.find((item) => item.hierarchyLevel === 'dish');
      const catalog = await loadCatalogIntroductionEvidence(db);
      const batch = await createCatalogIntroductionBatch(db, {
        id: 'intro-edit-batch', tenantId: 'default', model: 'deepseek-v4-flash', promptVersion: 'catalog-introduction-v1',
        catalogDataVersion: catalog.catalogDataVersion, snapshotHash: catalog.snapshotHash, entityCount: catalog.counts.total,
      });
      const [candidate] = validateCatalogIntroductionBatch({ introductions: [candidateFor(evidence)] }, [evidence]);
      const record = await saveCatalogIntroductionCandidate(db, {
        tenantId: 'default', batchId: batch.id, version: 1, model: 'deepseek-v4-flash', candidate,
      });
      const editedFact = record.factualSummary.replace('目录记录菜品', '目录核对菜品');
      const updated = await updateCatalogIntroductionCandidate(db, {
        tenantId: 'default', id: record.id, factualSummary: editedFact,
        recommendationCopy: record.recommendationCopy, status: 'schema_validated',
        expectedUpdatedAt: record.updatedAt, reviewedBy: 'reviewer',
      });
      assert.equal(updated.factualSummary, editedFact);
      assert.equal(updated.claims.filter((claim) => claim.type === 'fact').map((claim) => claim.text).join(''), editedFact);
      assert.deepEqual(updated.evidenceIds, [...new Set(updated.claims.flatMap((claim) => claim.evidenceIds))]);

      await assert.rejects(() => updateCatalogIntroductionCandidate(db, {
        tenantId: 'default', id: record.id,
        factualSummary: updated.factualSummary.replace(evidence.entity.priceDisplay, '9999元'),
        recommendationCopy: updated.recommendationCopy, status: 'schema_validated',
        expectedUpdatedAt: updated.updatedAt, reviewedBy: 'reviewer',
      }), (error) => error.code === 'UNSUPPORTED_CATALOG_NUMBER');
    } finally {
      db.close();
    }
  });
});

describe('catalog introduction API permissions and compatibility', () => {
  let db;
  let server;
  let baseUrl;
  let adminToken;
  let studentToken;
  let reviewerToken;
  let record;
  let dishId;

  async function request(path, { method = 'GET', token, body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  }

  async function login(identifier, password) {
    const response = await request('/api/auth/login', { method: 'POST', body: { identifier, password } });
    assert.equal(response.status, 200);
    return response.data.accessToken;
  }

  before(async () => {
    db = openDatabase(':memory:');
    const app = createApp({ db });
    server = createServer(app.handler);
    await new Promise((resolveListen) => server.listen(0, resolveListen));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    adminToken = await login('admin', 'admin123');

    const student = await request('/api/auth/register', { method: 'POST', body: { username: 'intro-student', password: 'student123', nickname: '介绍学生' } });
    assert.equal(student.status, 201);
    studentToken = student.data.accessToken;
    const reviewer = await request('/api/auth/register', { method: 'POST', body: { username: 'intro-reviewer', password: 'student123', nickname: '介绍审核员' } });
    assert.equal(reviewer.status, 201);
    const promoted = await request(`/api/admin/users/${reviewer.data.user.id}`, { method: 'PUT', token: adminToken, body: { role: 'canteen_admin' } });
    assert.equal(promoted.status, 200);
    reviewerToken = await login('intro-reviewer', 'student123');

    const catalog = await loadCatalogIntroductionEvidence(db, { tenantId: 'default' });
    const evidence = catalog.evidence.find((item) => item.hierarchyLevel === 'dish');
    dishId = evidence.entity.id;
    const batch = await createCatalogIntroductionBatch(db, {
      id: 'intro-api-batch', tenantId: 'default', model: 'deepseek-v4-flash', promptVersion: 'catalog-introduction-v1',
      catalogDataVersion: catalog.catalogDataVersion, snapshotHash: catalog.snapshotHash, entityCount: catalog.counts.total,
    });
    const [candidate] = validateCatalogIntroductionBatch({ introductions: [candidateFor(evidence)] }, [evidence]);
    record = await saveCatalogIntroductionCandidate(db, { tenantId: 'default', batchId: batch.id, version: 1, model: 'deepseek-v4-flash', candidate });
  });

  after(async () => {
    await new Promise((resolveClose) => server.close(resolveClose));
    db.close();
  });

  it('separates review permission from whole-school approval', async () => {
    assert.equal((await request('/api/admin/catalog-introductions/batches', { token: studentToken })).status, 403);
    assert.equal((await request('/api/admin/catalog-introductions/batches', { token: reviewerToken })).status, 200);
    assert.equal((await request('/api/admin/catalog-introductions/batches/intro-api-batch/approval-preview', { method: 'POST', token: reviewerToken })).status, 403);
    assert.equal((await request('/api/admin/catalog-introductions/batches/intro-api-batch/approval-preview', { method: 'POST', token: adminToken })).status, 200);
  });

  it('publishes only an approved introduction without replacing legacy description', async () => {
    const legacyBefore = (await db.prepare('SELECT description FROM dishes WHERE tenant_id = ? AND id = ?').get('default', dishId)).description;
    const updated = await request(`/api/admin/catalog-introductions/${record.id}`, {
      method: 'PATCH', token: reviewerToken,
      body: { factualSummary: record.factualSummary, recommendationCopy: record.recommendationCopy, status: 'approved', expectedUpdatedAt: record.updatedAt },
    });
    assert.equal(updated.status, 200);
    const detail = await request(`/api/dishes/${encodeURIComponent(dishId)}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.description, legacyBefore);
    assert.equal(detail.data.displayDescription, record.factualSummary);
    assert.equal(detail.data.displayTagline, record.recommendationCopy);
    assert.equal(detail.data.introduction.provenanceLabel, '基于目录整理');
    assert.equal(detail.data.introduction.recommendationCopy, record.recommendationCopy);
    assert.equal(detail.data.introduction.positioningStatement, record.recommendationCopy);
    assert.equal(detail.data.introduction.hierarchyLevel, 'dish');
    assert.deepEqual(detail.data.introduction.evidenceIds, record.evidenceIds);
  });
});
