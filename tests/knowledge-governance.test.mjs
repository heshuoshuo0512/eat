import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  checkKnowledgeSources,
  knowledgeChecksum,
  loadKnowledgeBundle,
  validateKnowledgeBundle,
} from '../server/knowledgeGovernance.js';
import {
  loadCampusPolicyKnowledgeDocuments,
  loadFoodCompositionReferences,
  loadHealthKnowledgeDocuments,
} from '../server/healthKnowledgeBase.js';
import { loadCampusDiningCorpus } from '../server/campusDiningKnowledgeBase.js';
import { validateMultiSourceEvaluationQueries } from '../scripts/lib/multi-source-evaluation.mjs';

const BUNDLE_ROOT = resolve('data/health-knowledge-bases');

function readJson(name) {
  return JSON.parse(readFileSync(resolve(BUNDLE_ROOT, name), 'utf8'));
}

function fakeResponse({ status = 200, body = '', etag = null, lastModified = null } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        if (name.toLowerCase() === 'etag') return etag;
        if (name.toLowerCase() === 'last-modified') return lastModified;
        return null;
      },
    },
    async text() { return body; },
  };
}

describe('knowledge governance', () => {
  it('validates the approved bundle and rejects tampered document content', () => {
    const bundle = loadKnowledgeBundle({ root: BUNDLE_ROOT });
    assert.equal(bundle.report.sourceCount, 16);
    assert.equal(bundle.report.approvedDocumentCount, 12);
    assert.equal(bundle.report.foodCompositionReferenceCount, 60);

    const raw = {
      sources: readJson('sources.json'),
      documents: readJson('documents.json'),
      foodComposition: readJson('food-composition-references.json'),
    };
    raw.documents[0].content += ' 未经审核的篡改';
    assert.throws(() => validateKnowledgeBundle(raw), /内容哈希不匹配/);

    const invalidScope = {
      sources: readJson('sources.json'),
      documents: readJson('documents.json'),
      foodComposition: readJson('food-composition-references.json'),
    };
    invalidScope.sources.find((source) => source.id === 'cns-dg-2022').scope = 'tenant';
    assert.throws(() => validateKnowledgeBundle(invalidScope), /健康知识来源必须使用 global 作用域/);
  });

  it('fails closed when only part of a governed bundle is present', () => {
    const root = mkdtempSync(join(tmpdir(), 'smart-canteen-incomplete-kb-'));
    try {
      writeFileSync(join(root, 'sources.json'), '[]\n', 'utf8');
      writeFileSync(join(root, 'legacy.md'), '# 旧正文\n这段文字不能绕过不完整的治理文件进入索引。', 'utf8');
      assert.throws(() => loadHealthKnowledgeDocuments({ root }), /知识治理文件不完整/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('excludes audit markdown from the legacy loader', () => {
    const root = mkdtempSync(join(tmpdir(), 'smart-canteen-kb-'));
    try {
      const contentRoot = join(root, '01_health');
      const auditRoot = join(root, '08_index_and_audit');
      mkdirSync(contentRoot, { recursive: true });
      mkdirSync(auditRoot, { recursive: true });
      writeFileSync(join(contentRoot, 'approved.md'), '# 可用健康摘录\n来源：https://example.test/health\n状态：verified_page\n这是一段仅用于测试检索加载范围的健康知识正文，长度足以形成一个可检索切片。', 'utf8');
      writeFileSync(join(auditRoot, 'audit.md'), '# 审计记录\n这段审计文字绝不能进入学生检索。', 'utf8');

      const documents = loadHealthKnowledgeDocuments({ root, chunkSize: 200 });
      assert.ok(documents.length > 0);
      assert.ok(documents.every((document) => !document.metadata.sourceFile.includes('08_index_and_audit')));
      assert.ok(documents.every((document) => !document.content.includes('绝不能进入学生检索')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('isolates campus policy by tenant and removes expired snapshots', () => {
    const active = loadCampusPolicyKnowledgeDocuments({
      root: BUNDLE_ROOT,
      tenantId: 'default',
      now: new Date('2026-07-28T00:00:00+08:00'),
    });
    assert.ok(active.length > 0);
    assert.ok(active.every((document) => document.tenantId === 'default'));

    const otherTenant = loadCampusPolicyKnowledgeDocuments({
      root: BUNDLE_ROOT,
      tenantId: 'other-campus',
      now: new Date('2026-07-28T00:00:00+08:00'),
    });
    assert.equal(otherTenant.length, 0);

    const expired = loadCampusPolicyKnowledgeDocuments({
      root: BUNDLE_ROOT,
      tenantId: 'default',
      now: new Date('2026-08-28T00:00:01+08:00'),
    });
    assert.equal(expired.length, 0);
  });

  it('marks changed monitored sources for review without changing approved snapshots', async () => {
    const stableBody = 'stable source snapshot';
    const sources = [
      {
        id: 'stable',
        url: 'https://example.test/stable',
        retrievalMethod: 'web_extract',
        monitor: { etag: '"v1"', contentHash: knowledgeChecksum(stableBody) },
      },
      {
        id: 'changed',
        url: 'https://example.test/changed',
        retrievalMethod: 'web_extract',
        monitor: { etag: '"v1"', contentHash: knowledgeChecksum('old body') },
      },
    ];
    const report = await checkKnowledgeSources(sources, {
      now: new Date('2026-07-28T00:00:00Z'),
      fetchImpl: async (url) => url.endsWith('/stable')
        ? fakeResponse({ body: stableBody, etag: '"v1"' })
        : fakeResponse({ body: 'new body', etag: '"v2"' }),
    });

    assert.equal(report.results.find((item) => item.sourceId === 'stable').status, 'unchanged');
    assert.equal(report.results.find((item) => item.sourceId === 'changed').status, 'review_required');
    assert.equal(report.reviewRequired, 1);
    assert.equal(sources[1].monitor.etag, '"v1"');
  });

  it('keeps food composition values reference-only and non-overwriting', () => {
    const references = loadFoodCompositionReferences({ root: BUNDLE_ROOT });
    assert.equal(references.length, 60);
    assert.ok(references.every((item) => item.factStatus === 'reference_only'));
    assert.ok(references.every((item) => item.campusDishFactPolicy === 'must_not_overwrite'));
    assert.ok(references.every((item) => item.foodOnId && item.fdcId));
    assert.ok(references.every((item) => item.provenance.fdc.externalId === `FDC:${item.fdcId}`));
    assert.ok(references.every((item) => item.provenance.foodOn.externalId === item.foodOnId));
  });

  it('records that international guidance cannot override Chinese rules', () => {
    const documents = loadHealthKnowledgeDocuments({ root: BUNDLE_ROOT });
    const who = documents.find((item) => item.sourceId === 'knowledge:nutrition-who-healthy-diet');
    const china = documents.find((item) => item.sourceId === 'knowledge:nutrition-cn-balanced-diet');
    assert.ok(who && china);
    assert.match(who.content, /不覆盖中国现行指南/);
    assert.equal(china.metadata.publisher, '中国营养学会');
  });

  it('freezes 300 multi-source queries with 60 independently reviewed cases', () => {
    const knowledge = loadKnowledgeBundle({ root: BUNDLE_ROOT });
    const validation = validateMultiSourceEvaluationQueries(readJson('multi-source-evaluation-queries.json'), {
      concepts: loadCampusDiningCorpus().concepts,
      documents: knowledge.documents,
      foodComposition: knowledge.foodComposition,
    });
    assert.equal(validation.report.queryCount, 300);
    assert.equal(validation.report.handReviewedCount, 60);
    assert.equal(Object.values(validation.report.quotas).reduce((sum, value) => sum + value, 0), 300);
    assert.ok(validation.queries.every((item) => item.forbiddenOutcomes.length > 0));
  });
});
