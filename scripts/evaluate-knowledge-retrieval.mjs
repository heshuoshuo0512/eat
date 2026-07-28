import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openDatabase } from '../server/database.js';
import {
  loadCampusPolicyKnowledgeDocuments,
  loadHealthKnowledgeDocuments,
} from '../server/healthKnowledgeBase.js';
import { GLOBAL_KNOWLEDGE_TENANT_ID } from '../server/knowledgeGovernance.js';
import { buildHealthIndexDocuments, searchRetrievalIndex, upsertRetrievalDocuments } from '../server/retrievalIndex.js';

const ROOT = resolve(import.meta.dirname, '..');
const bundleRoot = resolve(ROOT, 'data/health-knowledge-bases');
const groups = JSON.parse(readFileSync(resolve(bundleRoot, 'evaluation-queries.json'), 'utf8'));
const queries = groups.flatMap((group) => group.queries.map((query, index) => ({
  id: `${group.id}-${String(index + 1).padStart(2, '0')}`,
  query,
  expectedDocumentId: group.expectedDocumentId,
  sourceType: group.sourceType,
  safetyCritical: Boolean(group.safetyCritical),
})));

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

const db = openDatabase(':memory:');
try {
  const health = buildHealthIndexDocuments(loadHealthKnowledgeDocuments({ root: bundleRoot }), GLOBAL_KNOWLEDGE_TENANT_ID);
  const campus = buildHealthIndexDocuments(loadCampusPolicyKnowledgeDocuments({ root: bundleRoot, tenantId: 'default' }), 'default');
  await upsertRetrievalDocuments(db, health, { tenantId: GLOBAL_KNOWLEDGE_TENANT_ID, embeddingProvider: null, vectorMode: 'off' });
  await upsertRetrievalDocuments(db, campus, { tenantId: 'default', embeddingProvider: null, vectorMode: 'off' });

  const rows = [];
  for (const item of queries) {
    const startedAt = performance.now();
    const tenantId = item.sourceType === 'campus_policy' ? 'default' : GLOBAL_KNOWLEDGE_TENANT_ID;
    const result = await searchRetrievalIndex(db, item.query, {
      tenantId,
      sourceTypes: [item.sourceType],
      limit: 3,
      embeddingProvider: null,
      vectorMode: 'off',
    });
    const expectedSourceId = `knowledge:${item.expectedDocumentId}`;
    rows.push({
      ...item,
      retrievedSourceIds: result.items.map((entry) => entry.sourceId),
      hitAt3: result.items.some((entry) => entry.sourceId === expectedSourceId),
      citationsComplete: result.items.length > 0 && result.items.every((entry) => Boolean(entry.metadata?.citation)),
      latencyMs: Number((performance.now() - startedAt).toFixed(2)),
    });
  }

  const count = Math.max(1, rows.length);
  const safety = rows.filter((row) => row.safetyCritical);
  const summary = {
    queryCount: rows.length,
    hitAt3: Number((rows.filter((row) => row.hitAt3).length / count).toFixed(4)),
    citationCoverage: Number((rows.filter((row) => row.citationsComplete).length / count).toFixed(4)),
    safetyAccuracy: Number((safety.filter((row) => row.hitAt3).length / Math.max(1, safety.length)).toFixed(4)),
    latencyP95Ms: percentile(rows.map((row) => row.latencyMs), 0.95),
  };
  const thresholds = { hitAt3: 0.9, citationCoverage: 1, safetyAccuracy: 1, latencyP95Ms: 500 };
  const passed = summary.queryCount >= 120
    && summary.hitAt3 >= thresholds.hitAt3
    && summary.citationCoverage >= thresholds.citationCoverage
    && summary.safetyAccuracy >= thresholds.safetyAccuracy
    && summary.latencyP95Ms <= thresholds.latencyP95Ms;
  const generatedAt = new Date().toISOString();
  const outputPath = resolve(ROOT, '.rag-evals', `knowledge-eval-${generatedAt.replace(/[:.]/g, '-')}.json`);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify({ generatedAt, passed, summary, thresholds, rows }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputPath, passed, summary, thresholds }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  db.close();
}
