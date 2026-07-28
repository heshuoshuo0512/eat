#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildRealCatalogEvaluationQueries,
  summarizeRetrievalRows,
} from './lib/real-catalog-evaluation.mjs';

const ROOT = resolve(import.meta.dirname, '..');

function parseArguments(argv) {
  const options = {
    dbPath: resolve(ROOT, 'data/real-catalog-qwen-staging.sqlite'),
    catalogPath: resolve(ROOT, 'data/imports/real/west-main-2026-07-27/catalog.json'),
    queryPath: resolve(ROOT, 'data/imports/real/west-main-2026-07-27/evaluation-queries.json'),
    outputPath: resolve(ROOT, '.rag-evals/qwen-0.6b-real-catalog-dishes-2026-07-27.json'),
    limit: 10,
    checkpointEvery: 10,
    resume: false,
  };
  for (const argument of argv) {
    if (argument.startsWith('--db=')) options.dbPath = resolve(argument.slice(5));
    else if (argument.startsWith('--catalog=')) options.catalogPath = resolve(argument.slice(10));
    else if (argument.startsWith('--queries=')) options.queryPath = resolve(argument.slice(10));
    else if (argument.startsWith('--output=')) options.outputPath = resolve(argument.slice(9));
    else if (argument.startsWith('--limit=')) options.limit = Math.max(5, Math.min(20, Number(argument.slice(8)) || 10));
    else if (argument.startsWith('--checkpoint-every=')) options.checkpointEvery = Math.max(1, Number(argument.slice(19)) || 10);
    else if (argument === '--resume') options.resume = true;
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/evaluate-real-catalog-retrieval.mjs [options]

Options:
  --db=<path>       Clean isolated SQLite catalog with embeddings
  --catalog=<path>  Normalized real catalog JSON
  --queries=<path>  Generated 150-query local dataset
  --output=<path>   Full local evaluation report
  --limit=N         Retrieval cutoff, 5-20 (default: 10)
  --checkpoint-every=N  Save partial progress every N queries (default: 10)
  --resume          Continue a compatible partial report`);
}

function rankOf(ids, expectedIds = []) {
  const expected = new Set(expectedIds);
  const index = ids.findIndex((id) => expected.has(id));
  return index < 0 ? 0 : index + 1;
}

function objectContains(actual = {}, expected = {}) {
  return Object.entries(expected).every(([key, value]) => Array.isArray(value)
    ? value.every((item) => (actual[key] || []).includes(item))
    : actual[key] === value);
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

process.env.ENABLE_DEMO_SEED = '0';
process.env.DB_DRIVER = 'sqlite';
process.env.SMART_CANTEEN_DB = options.dbPath;
process.env.AI_EMBEDDING_BASE_URL ||= 'http://127.0.0.1:11434/v1';
process.env.AI_EMBEDDING_MODEL ||= 'qwen3-embedding:0.6b';
process.env.AI_EMBEDDING_DIMENSION ||= '1024';
process.env.AI_EMBEDDING_TIMEOUT_MS ||= '120000';
process.env.RETRIEVAL_VECTOR_MODE = 'active';

const [{ createDatabase }, { getAiProviderStatus }, { searchRetrievalIndex }, { runDishSearchWorkflow }] = await Promise.all([
  import('../server/database.js'),
  import('../server/aiProvider.js'),
  import('../server/retrievalIndex.js'),
  import('../server/retrievalService.js'),
]);

const catalog = JSON.parse(readFileSync(options.catalogPath, 'utf8'));
const queries = buildRealCatalogEvaluationQueries(catalog);
mkdirSync(dirname(options.queryPath), { recursive: true });
writeFileSync(options.queryPath, `${JSON.stringify(queries, null, 2)}\n`, 'utf8');

const provider = getAiProviderStatus().embedding;
const expectedDimension = Number(process.env.AI_EMBEDDING_DIMENSION || 1024);
if (!provider.enabled || provider.dimension !== expectedDimension) {
  throw new Error(`Qwen ${expectedDimension}-dimension embedding provider is not ready`);
}
const db = await createDatabase();

function summarizeWorkflowRows(rows) {
  const latency = rows.map((item) => item.latencyMs).sort((a, b) => a - b);
  return {
    queryCount: rows.length,
    passed: rows.filter((item) => item.passed).length,
    passRate: rows.length ? Number((rows.filter((item) => item.passed).length / rows.length).toFixed(4)) : 0,
    safetyPassed: rows.filter((item) => item.category === 'allergen_unknown' && item.passed).length,
    safetyTotal: rows.filter((item) => item.category === 'allergen_unknown').length,
    locationPassed: rows.filter((item) => ['canteen_location', 'stall_location', 'cross_location'].includes(item.category) && item.passed).length,
    locationTotal: rows.filter((item) => ['canteen_location', 'stall_location', 'cross_location'].includes(item.category)).length,
    latencyP95Ms: latency[Math.max(0, Math.ceil(latency.length * 0.95) - 1)] || 0,
  };
}

try {
  const indexedCases = queries.filter((item) => item.expectedDishIds?.length);
  let strategies = {};
  let workflowRows = [];
  if (options.resume) {
    try {
      const existing = JSON.parse(readFileSync(options.outputPath, 'utf8'));
      const compatible = existing.databasePath === options.dbPath
        && existing.provider?.model === provider.model
        && Number(existing.provider?.dimension) === provider.dimension;
      if (compatible) {
        strategies = existing.strategies || {};
        workflowRows = Array.isArray(existing.workflow?.rows) ? existing.workflow.rows : [];
      }
    } catch {}
  }
  const buildReport = (status) => ({
    generatedAt: new Date().toISOString(),
    status,
    databasePath: options.dbPath,
    provider: { model: provider.model, dimension: provider.dimension, baseUrl: provider.baseUrl },
    measurement: {
      lexical: 'no query embedding',
      vector: 'cold query embedding for each unique query',
      hybrid: 'prewarmed query embedding reused from vector strategy',
      workflow: 'prewarmed query embedding reused from retrieval strategies',
      queryCacheTtlMs: Number(process.env.RETRIEVAL_QUERY_CACHE_TTL_MS || 5 * 60 * 1000),
      sqliteVectorCacheTtlMs: Number(process.env.RETRIEVAL_SQLITE_VECTOR_CACHE_TTL_MS || 15_000),
    },
    corpus: { queryCount: queries.length, dishCount: catalog.dishes.length, synthetic: false },
    strategies,
    workflow: { summary: summarizeWorkflowRows(workflowRows), rows: workflowRows },
  });
  const writeCheckpoint = (status = 'partial') => {
    mkdirSync(dirname(options.outputPath), { recursive: true });
    writeFileSync(options.outputPath, `${JSON.stringify(buildReport(status), null, 2)}\n`, 'utf8');
  };
  for (const strategy of ['lexical', 'vector', 'hybrid']) {
    const rows = Array.isArray(strategies[strategy]?.rows) ? strategies[strategy].rows : [];
    const completedIds = new Set(rows.map((item) => item.id));
    for (const evaluation of indexedCases) {
      if (completedIds.has(evaluation.id)) continue;
      const startedAt = performance.now();
      const result = await searchRetrievalIndex(db, evaluation.query, {
        tenantId: evaluation.tenantId,
        sourceTypes: ['dish'],
        limit: options.limit,
        vectorMode: strategy === 'lexical' ? 'off' : 'active',
        channels: strategy === 'hybrid' ? ['lexical', 'vector'] : [strategy],
      });
      const ids = result.items.map((item) => item.sourceId);
      rows.push({
        id: evaluation.id,
        category: evaluation.category,
        query: evaluation.query,
        expectedCount: evaluation.expectedDishIds.length,
        expectedDishIds: evaluation.expectedDishIds,
        returnedDishIds: ids,
        rank: rankOf(ids, evaluation.expectedDishIds),
        latencyMs: Number((performance.now() - startedAt).toFixed(2)),
        warnings: result.warnings.map((warning) => warning.code),
        trace: result.meta.trace,
      });
      strategies[strategy] = { summary: summarizeRetrievalRows(rows), rows };
      if (rows.length % options.checkpointEvery === 0 && rows.length < indexedCases.length) writeCheckpoint();
    }
    strategies[strategy] = { summary: summarizeRetrievalRows(rows), rows };
    writeCheckpoint();
  }

  const knownDishes = new Map(catalog.dishes.map((item) => [item.id, item]));
  const semanticSearch = ({ query, tenantId, limit, candidateIds }) => searchRetrievalIndex(db, query, {
    tenantId,
    sourceTypes: ['dish'],
    limit,
    candidateIds,
    vectorMode: 'active',
  });
  const completedWorkflowIds = new Set(workflowRows.map((item) => item.id));
  for (const evaluation of queries) {
    if (completedWorkflowIds.has(evaluation.id)) continue;
    const startedAt = performance.now();
    const result = await runDishSearchWorkflow({ query: evaluation.query, tenantId: evaluation.tenantId, limit: 5 }, { db, semanticSearch });
    const ids = result.items.map((item) => item.id);
    const warningCodes = new Set(result.warnings.map((warning) => warning.code));
    const expectedWarningCodes = evaluation.expectedWarningCodes || [];
    const requiresUnconfirmedSupply = expectedWarningCodes.includes('SUPPLY_UNCONFIRMED');
    const checks = {
      expectedHit: !evaluation.expectedDishIds?.length || rankOf(ids, evaluation.expectedDishIds) > 0,
      forbiddenAbsent: !(evaluation.forbiddenDishIds || []).some((id) => ids.includes(id)),
      sourceIntegrity: result.items.every((item) => knownDishes.has(item.id) && item.tenantId === evaluation.tenantId),
      canteenScope: !evaluation.expectedCanteenId || result.items.every((item) => item.canteenId === evaluation.expectedCanteenId),
      stallScope: !evaluation.expectedStallId || result.items.every((item) => item.stallId === evaluation.expectedStallId),
      filters: objectContains(result.interpreted.filters, evaluation.expectedFilters),
      warnings: expectedWarningCodes.filter((code) => code !== 'SUPPLY_UNCONFIRMED').every((code) => warningCodes.has(code)),
      supplyUnconfirmed: !requiresUnconfirmedSupply || result.items.every((item) => item.availability?.supplyConfirmed === false),
      forbiddenNames: !(evaluation.forbiddenNameTerms || []).some((term) => result.items.some((item) => String(item.name).includes(term))),
      nonOrderableCatalog: result.items.every((item) => ['catalog_only', 'reservation_paused'].includes(item.availability?.status)
        && item.availability?.orderable === false),
      priceIntegrity: result.items.every((item) => item.priceDisplay === knownDishes.get(item.id)?.priceDisplay),
    };
    workflowRows.push({
      id: evaluation.id,
      category: evaluation.category,
      query: evaluation.query,
      expectedDishIds: evaluation.expectedDishIds || [],
      returnedDishIds: ids,
      rank: rankOf(ids, evaluation.expectedDishIds),
      checks,
      passed: Object.values(checks).every(Boolean),
      warningCodes: [...warningCodes],
      confidence: result.confidence,
      hardConstraintRejections: result.meta.hardConstraintRejections,
      latencyMs: Number((performance.now() - startedAt).toFixed(2)),
    });
    if (workflowRows.length % options.checkpointEvery === 0 && workflowRows.length < queries.length) writeCheckpoint();
  }

  const workflowSummary = summarizeWorkflowRows(workflowRows);
  writeCheckpoint('completed');
  console.log(JSON.stringify({
    outputPath: options.outputPath,
    queryPath: options.queryPath,
    lexical: strategies.lexical.summary,
    vector: strategies.vector.summary,
    hybrid: strategies.hybrid.summary,
    workflow: workflowSummary,
  }, null, 2));
} finally {
  await db.close();
}
