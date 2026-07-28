#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadCampusDiningCorpus } from '../server/campusDiningKnowledgeBase.js';
import { loadKnowledgeBundle } from '../server/knowledgeGovernance.js';
import { buildMultiSourceEvaluationQueries, validateMultiSourceEvaluationQueries } from './lib/multi-source-evaluation.mjs';

const root = resolve(import.meta.dirname, '..');
const outputPath = resolve(process.argv.find((item) => item.startsWith('--output='))?.slice(9)
  || 'data/health-knowledge-bases/multi-source-evaluation-queries.json');
const campus = loadCampusDiningCorpus();
const knowledge = loadKnowledgeBundle({ root: resolve(root, 'data/health-knowledge-bases') });
const inputs = {
  concepts: campus.concepts,
  documents: knowledge.documents,
  foodComposition: knowledge.foodComposition,
};
const queries = buildMultiSourceEvaluationQueries(inputs);
const validation = validateMultiSourceEvaluationQueries(queries, inputs);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(queries, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ outputPath, ...validation.report }, null, 2));
