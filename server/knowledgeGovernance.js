import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

export const GLOBAL_KNOWLEDGE_TENANT_ID = '__global__';
export const CAMPUS_POLICY_SOURCE_TYPE = 'campus_policy';
export const HEALTH_KNOWLEDGE_SOURCE_TYPE = 'health_knowledge';

const KNOWLEDGE_SOURCE_TYPES = [HEALTH_KNOWLEDGE_SOURCE_TYPE, CAMPUS_POLICY_SOURCE_TYPE];
const SOURCE_REVIEW_STATUSES = ['approved', 'research_only', 'candidate', 'review_required', 'retired'];
const DOCUMENT_STATUSES = ['draft', 'review_required', 'approved', 'retired'];

const nullableDate = z.string().datetime({ offset: true }).nullable();
const checksumSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const knowledgeSourceSchema = z.object({
  id: z.string().trim().min(1),
  domain: z.enum(['campus_facts', 'nutrition_fitness', 'food_composition', 'food_safety', 'campus_policy', 'research_evidence', 'future_candidate']),
  publisher: z.string().trim().min(1),
  url: z.string().trim().min(1),
  license: z.string().trim().min(1),
  retrievalMethod: z.enum(['api', 'official_download', 'git_snapshot', 'web_extract', 'manual_reference', 'internal_admin']),
  scope: z.enum(['global', 'tenant', 'research_only']),
  sourceVersion: z.string().trim().min(1),
  fetchedAt: z.string().datetime({ offset: true }),
  checksum: checksumSchema,
  reviewStatus: z.enum(SOURCE_REVIEW_STATUSES),
  reviewedAt: nullableDate,
  nextCheckAt: nullableDate,
  attribution: z.string().trim().min(1),
  allowedUse: z.string().trim().min(1),
  monitor: z.object({
    url: z.string().trim().min(1).optional(),
    etag: z.string().nullable().optional(),
    lastModified: z.string().nullable().optional(),
    contentHash: checksumSchema.nullable().optional(),
  }).default({}),
});

export const knowledgeDocumentSchema = z.object({
  id: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  sourceType: z.enum(KNOWLEDGE_SOURCE_TYPES),
  tenantId: z.string().trim().min(1).optional(),
  version: z.string().trim().min(1),
  title: z.string().trim().min(1),
  content: z.string().trim().min(40),
  category: z.string().trim().min(1),
  knowledgeDomain: z.enum(['nutrition', 'fitness', 'food_composition', 'food_taxonomy', 'food_safety', 'allergy_safety', 'medical_boundary', 'campus_operations']),
  applicablePopulation: z.array(z.string().trim().min(1)).min(1),
  safetyBoundary: z.string().trim().min(10),
  citations: z.array(z.string().trim().min(1)).min(1),
  status: z.enum(DOCUMENT_STATUSES),
  factStatus: z.enum(['verified_reference', 'reference_only', 'partially_verified', 'unknown']),
  reviewedBy: z.string().trim().min(1).nullable(),
  reviewedAt: nullableDate,
  expiresAt: nullableDate.optional(),
  checksum: checksumSchema,
  searchTerms: z.array(z.string().trim().min(1)).default([]),
});

export const foodCompositionReferenceSchema = z.object({
  id: z.string().trim().min(1),
  canonicalName: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)).min(1),
  foodOnId: z.string().regex(/^FOODON:\d+$/),
  fdcId: z.number().int().positive(),
  fdcDescription: z.string().trim().min(1),
  dataType: z.string().trim().min(1),
  basisGrams: z.literal(100),
  nutrients: z.object({
    caloriesKcal: z.number().nonnegative(),
    proteinG: z.number().nonnegative(),
    fatG: z.number().nonnegative(),
    carbsG: z.number().nonnegative(),
    fiberG: z.number().nonnegative(),
    sodiumMg: z.number().nonnegative(),
  }),
  sourceIds: z.array(z.string().trim().min(1)).min(2),
  provenance: z.object({
    fdc: z.object({
      sourceId: z.literal('usda-fdc'),
      externalId: z.string().regex(/^FDC:\d+$/),
      sourceVersion: z.string().trim().min(1),
      license: z.string().trim().min(1),
      checksum: checksumSchema,
    }),
    foodOn: z.object({
      sourceId: z.literal('foodon'),
      externalId: z.string().regex(/^FOODON:\d+$/),
      label: z.string().trim().min(1),
      sourceVersion: z.string().trim().min(1),
      license: z.string().trim().min(1),
      checksum: checksumSchema,
    }),
  }),
  factStatus: z.literal('reference_only'),
  campusDishFactPolicy: z.literal('must_not_overwrite'),
  retrievedAt: z.string().datetime({ offset: true }),
});

function readJson(path) {
  if (!existsSync(path)) throw new Error(`知识治理文件不存在：${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function knowledgeChecksum(value) {
  return `sha256:${createHash('sha256').update(String(value || ''), 'utf8').digest('hex')}`;
}

export function knowledgeSourceSnapshot(source, documents = []) {
  const approved = documents
    .filter((document) => document.sourceId === source.id && document.status === 'approved')
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!approved.length) return `${source.id}|${source.url}|${source.sourceVersion}`;
  return approved.map((document) => `${document.id}\n${document.content}`).join('\n---\n');
}

export function validateKnowledgeBundle(raw) {
  const sources = z.array(knowledgeSourceSchema).min(1).parse(raw.sources);
  const documents = z.array(knowledgeDocumentSchema).min(1).parse(raw.documents);
  const foodComposition = z.array(foodCompositionReferenceSchema).parse(raw.foodComposition || []);
  const duplicateSourceIds = duplicateValues(sources.map((source) => source.id));
  const duplicateDocumentIds = duplicateValues(documents.map((document) => document.id));
  const duplicateFoodIds = duplicateValues(foodComposition.map((item) => item.id));
  const duplicateFdcIds = duplicateValues(foodComposition.map((item) => item.fdcId));
  const duplicateFoodOnIds = duplicateValues(foodComposition.map((item) => item.foodOnId));
  if (duplicateSourceIds.length) throw new Error(`知识来源 ID 重复：${duplicateSourceIds.join('、')}`);
  if (duplicateDocumentIds.length) throw new Error(`知识文档 ID 重复：${duplicateDocumentIds.join('、')}`);
  if (duplicateFoodIds.length) throw new Error(`食物成分参考 ID 重复：${duplicateFoodIds.join('、')}`);
  if (duplicateFdcIds.length) throw new Error(`食物成分参考 FDC ID 重复：${duplicateFdcIds.join('、')}`);
  if (duplicateFoodOnIds.length) throw new Error(`食物成分参考 FoodOn ID 重复：${duplicateFoodOnIds.join('、')}`);

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  for (const source of sources) {
    if (source.reviewStatus === 'approved' && !source.reviewedAt) {
      throw new Error(`${source.id} 缺少来源审核时间`);
    }
  }
  for (const document of documents) {
    const source = sourceById.get(document.sourceId);
    if (!source) throw new Error(`${document.id} 引用了不存在的知识来源 ${document.sourceId}`);
    if (document.checksum !== knowledgeChecksum(document.content)) throw new Error(`${document.id} 内容哈希不匹配`);
    if (document.status === 'approved') {
      if (source.reviewStatus !== 'approved') throw new Error(`${document.id} 的来源 ${source.id} 尚未批准`);
      if (!document.reviewedBy || !document.reviewedAt) throw new Error(`${document.id} 缺少审核记录`);
    }
    if (document.sourceType === HEALTH_KNOWLEDGE_SOURCE_TYPE && document.tenantId) {
      throw new Error(`${document.id} 的全局健康知识不得指定租户`);
    }
    if (document.sourceType === HEALTH_KNOWLEDGE_SOURCE_TYPE && source.scope !== 'global') {
      throw new Error(`${document.id} 的健康知识来源必须使用 global 作用域`);
    }
    if (document.sourceType === CAMPUS_POLICY_SOURCE_TYPE && !document.tenantId) {
      throw new Error(`${document.id} 的校园政策必须指定租户`);
    }
    if (document.sourceType === CAMPUS_POLICY_SOURCE_TYPE && source.scope !== 'tenant') {
      throw new Error(`${document.id} 的校园政策来源必须使用 tenant 作用域`);
    }
  }
  for (const source of sources) {
    const expected = knowledgeChecksum(knowledgeSourceSnapshot(source, documents));
    if (source.checksum !== expected) throw new Error(`${source.id} 来源快照哈希不匹配`);
  }
  for (const item of foodComposition) {
    for (const sourceId of item.sourceIds) {
      const source = sourceById.get(sourceId);
      if (!source) throw new Error(`${item.id} 引用了不存在的知识来源 ${sourceId}`);
      if (source.domain !== 'food_composition' || source.reviewStatus !== 'approved') {
        throw new Error(`${item.id} 只能引用已审核的食物成分来源`);
      }
    }
    if (item.provenance.fdc.externalId !== `FDC:${item.fdcId}`) {
      throw new Error(`${item.id} 的 FDC 溯源 ID 与 fdcId 不一致`);
    }
    if (item.provenance.foodOn.externalId !== item.foodOnId) {
      throw new Error(`${item.id} 的 FoodOn 溯源 ID 与 foodOnId 不一致`);
    }
    for (const provenance of Object.values(item.provenance)) {
      const source = sourceById.get(provenance.sourceId);
      if (source.sourceVersion !== provenance.sourceVersion || source.license !== provenance.license) {
        throw new Error(`${item.id} 的 ${provenance.sourceId} 版本或许可与来源登记不一致`);
      }
    }
  }

  const approvedDocuments = documents.filter((document) => document.status === 'approved');
  return {
    sources,
    documents,
    foodComposition,
    sourceById,
    report: {
      sourceCount: sources.length,
      approvedSourceCount: sources.filter((source) => source.reviewStatus === 'approved').length,
      documentCount: documents.length,
      approvedDocumentCount: approvedDocuments.length,
      healthDocumentCount: approvedDocuments.filter((document) => document.sourceType === HEALTH_KNOWLEDGE_SOURCE_TYPE).length,
      campusPolicyDocumentCount: approvedDocuments.filter((document) => document.sourceType === CAMPUS_POLICY_SOURCE_TYPE).length,
      foodCompositionReferenceCount: foodComposition.length,
    },
  };
}

export function loadKnowledgeBundle({ root } = {}) {
  const resolvedRoot = resolve(root);
  return validateKnowledgeBundle({
    sources: readJson(resolve(resolvedRoot, 'sources.json')),
    documents: readJson(resolve(resolvedRoot, 'documents.json')),
    foodComposition: readJson(resolve(resolvedRoot, 'food-composition-references.json')),
  });
}

export function approvedKnowledgeDocuments(bundle, { sourceType, tenantId, now = new Date() } = {}) {
  const timestamp = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return bundle.documents.filter((document) => {
    if (document.status !== 'approved') return false;
    if (sourceType && document.sourceType !== sourceType) return false;
    if (document.sourceType === CAMPUS_POLICY_SOURCE_TYPE && document.tenantId !== tenantId) return false;
    if (document.expiresAt && new Date(document.expiresAt).getTime() <= timestamp) return false;
    return true;
  });
}

export async function checkKnowledgeSources(sources, { fetchImpl = globalThis.fetch, now = new Date(), timeoutMs = 20_000 } = {}) {
  const checkedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const results = [];
  for (const source of sources) {
    const monitorUrl = source.monitor?.url || source.url;
    if (!['api', 'official_download', 'git_snapshot', 'web_extract'].includes(source.retrievalMethod)) {
      results.push({ sourceId: source.id, status: 'skipped', reason: source.retrievalMethod, checkedAt });
      continue;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        'User-Agent': 'smart-canteen-knowledge-monitor/1.0',
      };
      if (new URL(monitorUrl).hostname === 'api.github.com') {
        headers.Accept = 'application/vnd.github+json';
        if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      }
      if (source.monitor?.etag) headers['If-None-Match'] = source.monitor.etag;
      if (source.monitor?.lastModified) headers['If-Modified-Since'] = source.monitor.lastModified;
      const response = await fetchImpl(monitorUrl, { method: 'GET', redirect: 'follow', headers, signal: controller.signal });
      const etag = response.headers?.get?.('etag') || null;
      const lastModified = response.headers?.get?.('last-modified') || null;
      if (response.status === 304) {
        results.push({ sourceId: source.id, status: 'unchanged', httpStatus: 304, etag, lastModified, checkedAt });
        continue;
      }
      if (!response.ok) {
        results.push({ sourceId: source.id, status: 'unavailable', httpStatus: response.status, checkedAt });
        continue;
      }
      const body = await response.text();
      const contentHash = knowledgeChecksum(body);
      const baseline = source.monitor || {};
      const changed = Boolean(
        (baseline.etag && etag && baseline.etag !== etag)
        || (baseline.lastModified && lastModified && baseline.lastModified !== lastModified)
        || (baseline.contentHash && baseline.contentHash !== contentHash)
      );
      const hasBaseline = Boolean(baseline.etag || baseline.lastModified || baseline.contentHash);
      results.push({
        sourceId: source.id,
        status: changed ? 'review_required' : (hasBaseline ? 'unchanged' : 'baseline_required'),
        httpStatus: response.status,
        etag,
        lastModified,
        contentHash,
        checkedAt,
      });
    } catch (error) {
      results.push({ sourceId: source.id, status: 'unavailable', error: error?.name === 'AbortError' ? 'timeout' : error.message, checkedAt });
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    checkedAt,
    reviewRequired: results.filter((result) => result.status === 'review_required').length,
    unavailable: results.filter((result) => result.status === 'unavailable').length,
    results,
  };
}
