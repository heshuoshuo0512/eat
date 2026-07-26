import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createDatabase } from '../server/database.js';
import { getAiProviderStatus } from '../server/aiProvider.js';
import { GLOBAL_KNOWLEDGE_TENANT_ID, loadCampusDiningChallengeQueries } from '../server/campusDiningKnowledgeBase.js';
import { reindexRetrieval, searchRetrievalIndex } from '../server/retrievalIndex.js';
import { parseDishSearchRequest } from '../server/retrievalService.js';

const ROOT = resolve(import.meta.dirname, '..');

function parseArguments(argv) {
  const options = {
    dbPath: resolve(ROOT, 'data/rag-experiment.sqlite'),
    includeChallenges: true,
    reindex: true,
    limit: 5,
    output: '',
  };
  for (const argument of argv) {
    if (argument.startsWith('--db=')) options.dbPath = resolve(argument.slice('--db='.length));
    else if (argument.startsWith('--output=')) options.output = resolve(argument.slice('--output='.length));
    else if (argument.startsWith('--limit=')) options.limit = Math.max(1, Math.min(20, Number(argument.slice('--limit='.length)) || 5));
    else if (argument === '--no-challenges') options.includeChallenges = false;
    else if (argument === '--skip-reindex') options.reindex = false;
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function help() {
  console.log(`Usage: node scripts/evaluate-local-retrieval.mjs [options]

Options:
  --db=<path>          Isolated SQLite index (default: data/rag-experiment.sqlite)
  --output=<path>      Report path (default: .rag-evals/rag-eval-<time>.json)
  --limit=N            Retrieval cutoff (default: 5)
  --skip-reindex       Reuse the existing local experiment index
  --no-challenges      Evaluate only the frozen 300-query set
  --help               Show this message`);
}

function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)];
}

function objectContains(actual, expected) {
  return Object.entries(expected || {}).every(([key, value]) => {
    if (Array.isArray(value)) return value.every((item) => (actual[key] || []).includes(item));
    return actual[key] === value;
  });
}

async function evaluateStrategy(db, queries, strategy, limit) {
  const rows = [];
  for (const query of queries) {
    const startedAt = performance.now();
    const result = await searchRetrievalIndex(db, query.query, {
      tenantId: GLOBAL_KNOWLEDGE_TENANT_ID,
      sourceTypes: ['campus_dining_knowledge'],
      limit,
      vectorMode: strategy === 'lexical' ? 'off' : 'active',
      channels: strategy === 'hybrid' ? ['lexical', 'vector'] : [strategy],
    });
    const ids = result.items.map((item) => item.sourceId);
    const expected = query.expectedConceptIds || [];
    rows.push({
      id: query.id,
      challengeType: query.challengeType || null,
      expected,
      ids,
      hitAt1: expected.some((id) => ids.slice(0, 1).includes(id)),
      hitAt3: expected.some((id) => ids.slice(0, 3).includes(id)),
      hitAt5: expected.some((id) => ids.slice(0, 5).includes(id)),
      latencyMs: Number((performance.now() - startedAt).toFixed(2)),
      trace: result.meta.trace,
      warnings: result.warnings.map((warning) => warning.code),
    });
  }
  const count = rows.length || 1;
  return {
    strategy,
    queryCount: rows.length,
    hitAt1: Number((rows.filter((row) => row.hitAt1).length / count).toFixed(4)),
    hitAt3: Number((rows.filter((row) => row.hitAt3).length / count).toFixed(4)),
    hitAt5: Number((rows.filter((row) => row.hitAt5).length / count).toFixed(4)),
    latencyP50Ms: percentile(rows.map((row) => row.latencyMs), 0.5),
    latencyP95Ms: percentile(rows.map((row) => row.latencyMs), 0.95),
    rows,
  };
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  help();
  process.exit(0);
}

process.env.DB_DRIVER = 'sqlite';
process.env.SMART_CANTEEN_DB = options.dbPath;
process.env.AI_EMBEDDING_BASE_URL ||= 'http://127.0.0.1:11434/v1';
process.env.AI_EMBEDDING_MODEL ||= 'qwen3-embedding:0.6b';
process.env.AI_EMBEDDING_DIMENSION ||= '1024';
process.env.AI_EMBEDDING_BATCH_SIZE ||= '24';
process.env.RETRIEVAL_VECTOR_MODE = 'active';

const provider = getAiProviderStatus().embedding;
if (!provider.enabled) throw new Error('Local embedding provider is not enabled; check AI_EMBEDDING_BASE_URL and RETRIEVAL_VECTOR_MODE');

const frozen = JSON.parse(readFileSync(resolve(ROOT, 'data/campus-dining-knowledge/evaluation-queries.json'), 'utf8'))
  .filter((query) => query.expectedConceptIds?.length);
const challenges = options.includeChallenges
  ? loadCampusDiningChallengeQueries().filter((query) => query.expectedConceptIds?.length)
  : [];
const queries = [...frozen, ...challenges];
const db = await createDatabase();

try {
  const indexing = [];
  if (options.reindex) {
    indexing.push(await reindexRetrieval(db, {
      tenantId: GLOBAL_KNOWLEDGE_TENANT_ID,
      sourceTypes: ['campus_dining_knowledge'],
      vectorMode: 'active',
      embeddingDimension: provider.dimension,
      embeddingBatchSize: provider.batchSize,
    }));
    indexing.push(await reindexRetrieval(db, {
      tenantId: 'default',
      sourceTypes: ['dish', 'health_knowledge'],
      vectorMode: 'active',
      embeddingDimension: provider.dimension,
      embeddingBatchSize: provider.batchSize,
    }));
  }

  const lexical = await evaluateStrategy(db, queries, 'lexical', options.limit);
  const vector = await evaluateStrategy(db, queries, 'vector', options.limit);
  const hybrid = await evaluateStrategy(db, queries, 'hybrid', options.limit);
  const safetyQueries = queries.filter((query) => query.stratum === 'dietary_safety');
  const safetyPassCount = safetyQueries.filter((query) => objectContains(parseDishSearchRequest(query.query).filters, query.expectedHardFilters)).length;
  const report = {
    generatedAt: new Date().toISOString(),
    provider: {
      source: provider.source,
      baseUrl: provider.baseUrl,
      model: provider.model,
      dimension: provider.dimension,
      batchSize: provider.batchSize,
      vectorMode: provider.vectorMode,
    },
    corpus: { frozenQueryCount: frozen.length, challengeQueryCount: challenges.length, evaluatedQueryCount: queries.length },
    indexing: indexing.map((item) => ({
      tenantId: item.tenantId,
      sourceTypes: item.sourceTypes,
      documentCount: item.documentCount,
      embeddedCount: item.embeddedCount,
      skippedCount: item.skippedCount,
      failureCount: item.failureCount,
      batchCount: item.batchCount,
      embeddingLatencyMs: item.embeddingLatencyMs,
    })),
    summary: {
      lexical: { hitAt1: lexical.hitAt1, hitAt3: lexical.hitAt3, hitAt5: lexical.hitAt5, latencyP95Ms: lexical.latencyP95Ms },
      vector: { hitAt1: vector.hitAt1, hitAt3: vector.hitAt3, hitAt5: vector.hitAt5, latencyP95Ms: vector.latencyP95Ms },
      hybrid: { hitAt1: hybrid.hitAt1, hitAt3: hybrid.hitAt3, hitAt5: hybrid.hitAt5, latencyP95Ms: hybrid.latencyP95Ms },
      safety: { passed: safetyPassCount, total: safetyQueries.length, accuracy: Number((safetyPassCount / Math.max(1, safetyQueries.length)).toFixed(4)) },
    },
    strategies: { lexical, vector, hybrid },
  };
  const timestamp = report.generatedAt.replace(/[:.]/g, '-');
  const outputPath = options.output || resolve(ROOT, '.rag-evals', `rag-eval-${timestamp}.json`);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputPath, ...report.summary }, null, 2));
} finally {
  await db.close();
}
