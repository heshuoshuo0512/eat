#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadFoodCompositionReferences } from '../server/healthKnowledgeBase.js';
import {
  matchFoodCompositionReferencesForQuery,
  retrieveRoutedKnowledge,
} from '../server/retrievalService.js';

const ROOT = resolve(import.meta.dirname, '..');

function parseArguments(argv) {
  const options = {
    databasePath: resolve(ROOT, 'data/real-catalog-campus-2026-07-27-v2.sqlite'),
    queryPath: resolve(ROOT, 'data/health-knowledge-bases/multi-source-evaluation-queries.json'),
    outputPath: resolve(ROOT, '.rag-evals/multi-source/qwen-0.6b-2026-07-28.json'),
    model: process.env.AI_EMBEDDING_MODEL || 'qwen3-embedding:0.6b',
    dimension: Number(process.env.AI_EMBEDDING_DIMENSION || 1024),
    vectorMode: process.env.RETRIEVAL_VECTOR_MODE || 'active',
    limit: 5,
    checkpointEvery: 10,
    embeddingBatchSize: 1,
    resume: false,
  };
  for (const argument of argv) {
    if (argument.startsWith('--database=')) options.databasePath = resolve(argument.slice(11));
    else if (argument.startsWith('--queries=')) options.queryPath = resolve(argument.slice(10));
    else if (argument.startsWith('--output=')) options.outputPath = resolve(argument.slice(9));
    else if (argument.startsWith('--model=')) options.model = argument.slice(8).trim();
    else if (argument.startsWith('--dimension=')) options.dimension = Number(argument.slice(12));
    else if (argument.startsWith('--vector-mode=')) options.vectorMode = argument.slice(14).trim();
    else if (argument.startsWith('--limit=')) options.limit = Math.max(3, Math.min(10, Number(argument.slice(8)) || 5));
    else if (argument.startsWith('--checkpoint-every=')) options.checkpointEvery = Math.max(1, Number(argument.slice(19)) || 10);
    else if (argument.startsWith('--embedding-batch-size=')) options.embeddingBatchSize = Math.max(1, Math.min(32, Number(argument.slice(23)) || 1));
    else if (argument === '--resume') options.resume = true;
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return Number((sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] || 0).toFixed(2));
}

function rankOf(items, expectedIds) {
  const expected = new Set(expectedIds);
  const index = items.findIndex((item) => expected.has(item.sourceId));
  return index < 0 ? 0 : index + 1;
}

function mean(values) {
  return Number((values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)).toFixed(4));
}

function chunksOf(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function embeddingKey(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  console.log('Usage: node scripts/evaluate-multi-source-retrieval.mjs --database=<sqlite> --model=<id> --dimension=<n> [--vector-mode=active|off] [--embedding-batch-size=1] [--resume]');
  process.exit(0);
}

process.env.ENABLE_DEMO_SEED = '0';
process.env.DB_DRIVER = 'sqlite';
process.env.SMART_CANTEEN_DB = options.databasePath;
process.env.AI_EMBEDDING_BASE_URL ||= 'http://127.0.0.1:11434/v1';
process.env.AI_EMBEDDING_MODEL = options.model;
process.env.AI_EMBEDDING_DIMENSION = String(options.dimension);
process.env.AI_EMBEDDING_TIMEOUT_MS ||= '120000';
process.env.RETRIEVAL_VECTOR_MODE = options.vectorMode;

const [{ createDatabase }, { createEmbedding, createEmbeddings, getAiProviderStatus }, { searchRetrievalIndex }] = await Promise.all([
  import('../server/database.js'),
  import('../server/aiProvider.js'),
  import('../server/retrievalIndex.js'),
]);
const queries = JSON.parse(readFileSync(options.queryPath, 'utf8'));
if (queries.length !== 300) throw new Error(`Expected 300 multi-source queries, received ${queries.length}`);
const references = loadFoodCompositionReferences();
const db = await createDatabase();

function writeCheckpoint(rows, status = 'partial') {
  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    status,
    databasePath: options.databasePath,
    provider: { model: options.model, dimension: options.dimension, vectorMode: options.vectorMode, embeddingBatchSize: options.embeddingBatchSize },
    processedCount: rows.length,
    queryCount: queries.length,
    rows,
  }, null, 2)}\n`, 'utf8');
}

try {
  let rows = [];
  if (options.resume) {
    try {
      const existing = JSON.parse(readFileSync(options.outputPath, 'utf8'));
      const compatible = existing.provider?.model === options.model
        && Number(existing.provider?.dimension) === options.dimension
        && Number(existing.provider?.embeddingBatchSize || 1) === options.embeddingBatchSize
        && existing.databasePath === options.databasePath;
      if (compatible && Array.isArray(existing.rows)) rows = existing.rows;
    } catch {}
  }
  const completedIds = new Set(rows.map((item) => item.id));
  const pending = queries.filter((evaluation) => !completedIds.has(evaluation.id));
  for (const batch of chunksOf(pending, options.embeddingBatchSize)) {
    let embeddingMap = null;
    let embeddingBatchMs = 0;
    if (options.vectorMode !== 'off' && options.embeddingBatchSize > 1) {
      const embeddingStartedAt = performance.now();
      const vectors = await createEmbeddings(batch.map((evaluation) => evaluation.query));
      embeddingBatchMs = performance.now() - embeddingStartedAt;
      embeddingMap = new Map(batch.map((evaluation, index) => [embeddingKey(evaluation.query), vectors[index]]));
    }
    for (const evaluation of batch) {
      const startedAt = performance.now();
      const routed = await retrieveRoutedKnowledge({
        query: evaluation.query,
        tenantId: evaluation.tenantId,
        limit: options.limit,
      }, {
        knowledgeSearch: ({ query, tenantId, limit, sourceTypes }) => {
          const globalOnly = sourceTypes.every((sourceType) => ['health_knowledge', 'campus_dining_knowledge'].includes(sourceType));
          return searchRetrievalIndex(db, query, {
            tenantId: globalOnly ? '__global__' : tenantId,
            sourceTypes,
            limit,
            vectorMode: options.vectorMode,
            ...(embeddingMap ? {
              embeddingProvider: (value) => embeddingMap.get(embeddingKey(value)) || createEmbedding(value),
              embeddingModel: options.model,
              embeddingDimension: options.dimension,
            } : {}),
          });
        },
        foodCompositionLookup: ({ query, limit }) => matchFoodCompositionReferencesForQuery(query, references, limit),
      });
      const retrievalLatencyMs = performance.now() - startedAt;
      const embeddingBatchShareMs = embeddingBatchMs / batch.length;
      const returnedTypes = new Set(routed.results.map((item) => item.sourceType));
      const evidenceTypes = new Set(routed.results.map((item) => item.evidenceType));
      const rank = rankOf(routed.results, evaluation.expectedSourceIds);
      const checks = {
        route: routed.trace.routing.intent === evaluation.expectedRouteIntent,
        requiredSources: evaluation.allowEmpty || evaluation.requiredSourceTypes.every((sourceType) => returnedTypes.has(sourceType)),
        forbiddenSources: evaluation.forbiddenSourceTypes.every((sourceType) => !returnedTypes.has(sourceType)),
        expectedEvidence: evaluation.allowEmpty || evaluation.expectedEvidenceTypes.every((evidenceType) => evidenceTypes.has(evidenceType)),
        expectedSource: !evaluation.expectedSourceIds.length || rank > 0,
        scope: routed.results.every((item) => item.sourceType === 'campus_policy'
          ? item.tenantId === evaluation.tenantId
          : item.tenantId === '__global__'),
      };
      rows.push({
        id: evaluation.id,
        category: evaluation.category,
        query: evaluation.query,
        expectedSourceIds: evaluation.expectedSourceIds,
        returned: routed.results.map((item) => ({ id: item.id, sourceId: item.sourceId, sourceType: item.sourceType, evidenceType: item.evidenceType, tenantId: item.tenantId, score: item.score })),
        rank,
        checks,
        passed: Object.values(checks).every(Boolean),
        degradedReasons: routed.degradedReasons,
        trace: routed.trace,
        embeddingBatchShareMs: Number(embeddingBatchShareMs.toFixed(2)),
        retrievalLatencyMs: Number(retrievalLatencyMs.toFixed(2)),
        latencyMs: Number((retrievalLatencyMs + embeddingBatchShareMs).toFixed(2)),
      });
      if (rows.length % options.checkpointEvery === 0 && rows.length < queries.length) writeCheckpoint(rows);
    }
  }
  const order = new Map(queries.map((item, index) => [item.id, index]));
  rows.sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER));
  const judged = rows.filter((item) => item.expectedSourceIds.length);
  const summary = {
    queryCount: rows.length,
    passed: rows.filter((item) => item.passed).length,
    passRate: Number((rows.filter((item) => item.passed).length / rows.length).toFixed(4)),
    routeAccuracy: Number((rows.filter((item) => item.checks.route).length / rows.length).toFixed(4)),
    sourceIsolationAccuracy: Number((rows.filter((item) => item.checks.forbiddenSources && item.checks.scope).length / rows.length).toFixed(4)),
    expectedSourceHitAt3: Number((judged.filter((item) => item.rank > 0 && item.rank <= 3).length / Math.max(1, judged.length)).toFixed(4)),
    expectedSourceHitAt5: Number((judged.filter((item) => item.rank > 0 && item.rank <= 5).length / Math.max(1, judged.length)).toFixed(4)),
    ndcgAt5: mean(judged.map((item) => item.rank > 0 && item.rank <= 5 ? 1 / Math.log2(item.rank + 1) : 0)),
    latencyP50Ms: percentile(rows.map((item) => item.latencyMs), 0.5),
    latencyP95Ms: percentile(rows.map((item) => item.latencyMs), 0.95),
    degradedCount: rows.filter((item) => item.degradedReasons.length).length,
  };
  const provider = getAiProviderStatus().embedding;
  const report = {
    generatedAt: new Date().toISOString(),
    status: 'completed',
    databasePath: options.databasePath,
    provider: { model: provider.model, dimension: provider.dimension, vectorMode: options.vectorMode, embeddingBatchSize: options.embeddingBatchSize },
    measurement: {
      latencyMs: options.embeddingBatchSize > 1
        ? 'retrieval latency plus an equal share of the query embedding batch latency'
        : 'end-to-end sequential query latency',
    },
    summary,
    categories: Object.fromEntries([...new Set(rows.map((item) => item.category))].map((category) => {
      const categoryRows = rows.filter((item) => item.category === category);
      return [category, {
        count: categoryRows.length,
        passed: categoryRows.filter((item) => item.passed).length,
        passRate: Number((categoryRows.filter((item) => item.passed).length / categoryRows.length).toFixed(4)),
      }];
    })),
    rows,
  };
  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputPath: options.outputPath, ...summary }, null, 2));
} finally {
  await db.close();
}
