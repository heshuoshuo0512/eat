import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadKnowledgeBundle } from '../server/knowledgeGovernance.js';
import { loadCampusDiningCorpus } from '../server/campusDiningKnowledgeBase.js';
import { validateMultiSourceEvaluationQueries } from './lib/multi-source-evaluation.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const bundleRoot = resolve(process.argv.find((argument) => argument.startsWith('--root='))?.slice('--root='.length)
  || resolve(ROOT, 'data/health-knowledge-bases'));
const bundle = loadKnowledgeBundle({ root: bundleRoot });
const groups = JSON.parse(readFileSync(resolve(bundleRoot, 'evaluation-queries.json'), 'utf8'));
const queryCount = groups.reduce((sum, group) => sum + (Array.isArray(group.queries) ? group.queries.length : 0), 0);
const multiSourceQueries = JSON.parse(readFileSync(resolve(bundleRoot, 'multi-source-evaluation-queries.json'), 'utf8'));
const multiSource = validateMultiSourceEvaluationQueries(multiSourceQueries, {
  concepts: loadCampusDiningCorpus().concepts,
  documents: bundle.documents,
  foodComposition: bundle.foodComposition,
});

if (queryCount < 120) throw new Error(`知识评测查询不得少于 120 条，实际为 ${queryCount}`);
const ids = new Set(bundle.documents.map((document) => document.id));
for (const group of groups) {
  if (!ids.has(group.expectedDocumentId)) throw new Error(`${group.id} 引用了不存在的文档 ${group.expectedDocumentId}`);
  if (!group.queries?.length) throw new Error(`${group.id} 没有评测查询`);
}

console.log(JSON.stringify({
  ok: true,
  ...bundle.report,
  evaluationGroupCount: groups.length,
  evaluationQueryCount: queryCount,
  multiSourceEvaluationQueryCount: multiSource.report.queryCount,
  multiSourceHandReviewedCount: multiSource.report.handReviewedCount,
}, null, 2));
