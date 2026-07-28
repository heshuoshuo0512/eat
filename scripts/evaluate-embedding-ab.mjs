#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { dirname, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DATA_ROOT = resolve(ROOT, 'data');

function parseArguments(argv) {
  const options = {
    catalogPath: resolve(ROOT, 'data/imports/real/campus-2026-07-27/catalog.json'),
    annotationSource: resolve(ROOT, 'data/real-catalog-campus-2026-07-27-v2.sqlite'),
    annotationBatchId: 'dish-ai-pilot-2026-07-28',
    outputPath: resolve(ROOT, '.rag-evals/embedding-ab/summary-2026-07-28.json'),
    prepareOnly: false,
    skipReindex: false,
    refreshEnhanced: false,
    reuseReports: false,
    selected: null,
  };
  for (const argument of argv) {
    if (argument.startsWith('--catalog=')) options.catalogPath = resolve(argument.slice(10));
    else if (argument.startsWith('--annotation-source=')) options.annotationSource = resolve(argument.slice(20));
    else if (argument.startsWith('--annotation-batch=')) options.annotationBatchId = argument.slice(19).trim();
    else if (argument.startsWith('--output=')) options.outputPath = resolve(argument.slice(9));
    else if (argument.startsWith('--groups=')) options.selected = new Set(argument.slice(9).split(',').map((item) => item.trim()).filter(Boolean));
    else if (argument === '--prepare-only') options.prepareOnly = true;
    else if (argument === '--skip-reindex') options.skipReindex = true;
    else if (argument === '--refresh-enhanced') options.refreshEnhanced = true;
    else if (argument === '--reuse-reports') options.reuseReports = true;
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function safeExperimentPath(path) {
  const absolute = resolve(path);
  const child = relative(DATA_ROOT, absolute);
  if (!child || child.startsWith('..') || child.includes(':') || !absolute.toLowerCase().endsWith('.sqlite')) {
    throw new Error(`Experiment database must stay under ${DATA_ROOT}: ${absolute}`);
  }
  if (absolute.toLowerCase() === resolve(DATA_ROOT, 'smart-canteen.sqlite').toLowerCase()) {
    throw new Error('Runtime database cannot be used for embedding experiments');
  }
  return absolute;
}

function annotationCount(path, batchId) {
  if (!existsSync(path)) return 0;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return Number(db.prepare("SELECT COUNT(*) AS count FROM dish_ai_annotations WHERE batch_id = ? AND status IN ('schema_validated','approved')").get(batchId)?.count || 0);
  } catch {
    return 0;
  } finally {
    db.close();
  }
}

const ANNOTATION_COLUMNS = [
  'id', 'tenant_id', 'dish_id', 'batch_id', 'model', 'prompt_version', 'input_hash',
  'annotation_json', 'field_confidence_json', 'linked_concept_ids_json', 'source_ids_json',
  'status', 'error', 'reviewed_by', 'reviewed_at', 'created_at', 'updated_at',
];

function replaceAnnotationBatch(sourcePath, targetPath, batchId) {
  if (resolve(sourcePath) === resolve(targetPath)) return;
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const target = new DatabaseSync(targetPath);
  try {
    const rows = source.prepare(
      `SELECT ${ANNOTATION_COLUMNS.join(', ')} FROM dish_ai_annotations WHERE batch_id = ? ORDER BY id`,
    ).all(batchId);
    target.exec('BEGIN IMMEDIATE');
    try {
      target.prepare('DELETE FROM dish_ai_annotations WHERE batch_id = ?').run(batchId);
      const insert = target.prepare(
        `INSERT INTO dish_ai_annotations (${ANNOTATION_COLUMNS.join(', ')})
         VALUES (${ANNOTATION_COLUMNS.map(() => '?').join(', ')})`,
      );
      for (const row of rows) insert.run(...ANNOTATION_COLUMNS.map((column) => row[column]));
      target.exec('COMMIT');
    } catch (error) {
      target.exec('ROLLBACK');
      throw error;
    }
  } finally {
    source.close();
    target.close();
  }
}

async function createDatabaseSnapshot(sourcePath, targetPath) {
  for (const path of [targetPath, `${targetPath}-wal`, `${targetPath}-shm`]) rmSync(path, { force: true });
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const sourceCheck = source.prepare('PRAGMA quick_check').get()?.quick_check;
    if (sourceCheck !== 'ok') throw new Error(`Enhanced-index base database failed quick_check: ${sourceCheck || 'unknown'}`);
    const escapedTarget = resolve(targetPath).replaceAll('\\', '/').replaceAll("'", "''");
    source.exec(`VACUUM INTO '${escapedTarget}'`);
  } finally {
    source.close();
  }
  const target = new DatabaseSync(targetPath, { readOnly: true });
  try {
    const targetCheck = target.prepare('PRAGMA quick_check').get()?.quick_check;
    if (targetCheck !== 'ok') throw new Error(`Enhanced-index snapshot failed quick_check: ${targetCheck || 'unknown'}`);
  } finally {
    target.close();
  }
}

function runNode(script, args, env) {
  const result = spawnSync(process.execPath, [resolve(ROOT, script), ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const error = new Error(`${script} failed with exit ${result.status}: ${(result.stderr || result.stdout || '').slice(-2000)}`);
    error.code = 'EXPERIMENT_COMMAND_FAILED';
    throw error;
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

function reportPath(groupId, kind) {
  return resolve(ROOT, `.rag-evals/embedding-ab/${groupId}-${kind}.json`);
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  console.log(`Usage: node scripts/evaluate-embedding-ab.mjs [options]

  --annotation-source=<sqlite> Source catalog containing validated annotations
  --annotation-batch=<id>      Annotation batch used by enhanced groups
  --groups=<id,id>             Run a subset of raw-qwen06, enhanced-qwen06, raw-qwen8b, enhanced-qwen8b
  --prepare-only               Report readiness without indexing or evaluating
  --skip-reindex               Evaluate existing indexes only
  --refresh-enhanced           Re-copy the isolated annotation source into enhanced databases
  --reuse-reports              Aggregate existing reports without rerunning retrieval
  --output=<path>              Aggregate ignored report`);
  process.exit(0);
}

const sourcePath = safeExperimentPath(options.annotationSource);
const groups = [
  {
    id: 'raw-qwen06', enhanced: false, model: 'qwen3-embedding:0.6b', dimension: 1024,
    databasePath: safeExperimentPath(resolve(DATA_ROOT, 'real-catalog-campus-2026-07-27-v2.sqlite')),
  },
  {
    id: 'enhanced-qwen06', enhanced: true, model: 'qwen3-embedding:0.6b', dimension: 1024,
    databasePath: safeExperimentPath(resolve(DATA_ROOT, 'real-catalog-campus-ai-qwen06-2026-07-28.sqlite')),
    baseDatabasePath: sourcePath,
  },
  {
    id: 'raw-qwen8b', enhanced: false, model: 'qwen3-embedding:8b-fp16', dimension: 1024,
    databasePath: safeExperimentPath(resolve(DATA_ROOT, 'real-catalog-campus-qwen8b-2026-07-27-v2.sqlite')),
  },
  {
    id: 'enhanced-qwen8b', enhanced: true, model: 'qwen3-embedding:8b-fp16', dimension: 1024,
    databasePath: safeExperimentPath(resolve(DATA_ROOT, 'real-catalog-campus-ai-qwen8b-2026-07-28-v2.sqlite')),
    baseDatabasePath: safeExperimentPath(resolve(DATA_ROOT, 'real-catalog-campus-qwen8b-2026-07-27-v2.sqlite')),
  },
].filter((group) => !options.selected || options.selected.has(group.id));
if (options.selected && groups.length !== options.selected.size) throw new Error('Unknown A/B group requested');

const validatedAnnotationCount = annotationCount(sourcePath, options.annotationBatchId);
const report = {
  generatedAt: new Date().toISOString(),
  mode: options.prepareOnly ? 'prepare_only' : 'evaluation',
  annotation: {
    sourcePath,
    batchId: options.annotationBatchId,
    validatedCount: validatedAnnotationCount,
    requiredCount: 200,
  },
  groups: [],
  rawModelComparison: null,
  recommendation: null,
};

for (const group of groups) {
  const isLargeModel = group.model.includes(':8b');
  const state = {
    ...group,
    status: 'ready',
    blocker: null,
    catalogReportPath: reportPath(group.id, 'catalog'),
    knowledgeReportPath: reportPath(group.id, 'multi-source'),
    metrics: null,
  };
  if (group.enhanced && validatedAnnotationCount !== 200) {
    state.status = 'blocked';
    state.blocker = `Expected 200 validated annotations in ${options.annotationBatchId}, received ${validatedAnnotationCount}`;
    report.groups.push(state);
    continue;
  }
  if (!group.enhanced && !existsSync(group.databasePath)) {
    state.status = 'blocked';
    state.blocker = `Missing isolated raw catalog database: ${group.databasePath}`;
    report.groups.push(state);
    continue;
  }
  if (group.enhanced && (!existsSync(group.databasePath) || options.refreshEnhanced)) {
    if (!existsSync(group.baseDatabasePath)) {
      state.status = 'blocked';
      state.blocker = `Missing enhanced-index base database: ${group.baseDatabasePath}`;
      report.groups.push(state);
      continue;
    }
    await createDatabaseSnapshot(group.baseDatabasePath, group.databasePath);
    replaceAnnotationBatch(sourcePath, group.databasePath, options.annotationBatchId);
  }
  if (options.prepareOnly) {
    report.groups.push(state);
    continue;
  }

  if (options.reuseReports) {
    const hasCatalog = existsSync(state.catalogReportPath);
    const hasKnowledge = existsSync(state.knowledgeReportPath);
    if (!hasCatalog) {
      state.status = 'blocked';
      state.blocker = `Missing catalog report: ${state.catalogReportPath}`;
    } else {
      const catalog = JSON.parse(readFileSync(state.catalogReportPath, 'utf8'));
      const knowledge = hasKnowledge ? JSON.parse(readFileSync(state.knowledgeReportPath, 'utf8')) : null;
      state.metrics = {
        catalogHybrid: catalog.strategies.hybrid.summary,
        catalogVector: catalog.strategies.vector.summary,
        catalogWorkflow: catalog.workflow.summary,
        multiSource: knowledge?.summary || null,
      };
      state.status = hasKnowledge ? 'completed' : 'partial';
      state.blocker = hasKnowledge ? null : `Missing multi-source report: ${state.knowledgeReportPath}`;
    }
    report.groups.push(state);
    continue;
  }

  const env = {
    ENABLE_DEMO_SEED: '0',
    DB_DRIVER: 'sqlite',
    SMART_CANTEEN_DB: group.databasePath,
    AI_EMBEDDING_BASE_URL: process.env.AI_EMBEDDING_BASE_URL || 'http://127.0.0.1:11434/v1',
    AI_EMBEDDING_MODEL: group.model,
    AI_EMBEDDING_DIMENSION: String(group.dimension),
    AI_EMBEDDING_TIMEOUT_MS: process.env.AI_EMBEDDING_TIMEOUT_MS || '180000',
    AI_EMBEDDING_BATCH_SIZE: process.env.AI_EMBEDDING_BATCH_SIZE || '24',
    RETRIEVAL_VECTOR_MODE: 'active',
    RETRIEVAL_QUERY_CACHE_TTL_MS: '3600000',
    RETRIEVAL_QUERY_CACHE_MAX: '512',
    RETRIEVAL_SQLITE_VECTOR_CACHE_TTL_MS: '3600000',
  };
  try {
    if (!options.skipReindex) {
      runNode('scripts/reindex-retrieval.mjs', [
        `--sqlite=${group.databasePath}`,
        '--tenant=default',
        '--source=dish,stall,campus_policy',
        '--vector-mode=active',
        `--embedding-dimension=${group.dimension}`,
        `--batch-size=${isLargeModel ? 1 : 24}`,
        `--embedding-concurrency=${isLargeModel ? 1 : 2}`,
        ...(group.enhanced ? [`--dish-annotation-batch=${options.annotationBatchId}`] : []),
      ], env);
      runNode('scripts/reindex-retrieval.mjs', [
        `--sqlite=${group.databasePath}`,
        '--tenant=__global__',
        '--source=campus_dining_knowledge',
        '--vector-mode=active',
        `--embedding-dimension=${group.dimension}`,
        '--batch-size=24',
        `--embedding-concurrency=${isLargeModel ? 1 : 2}`,
      ], env);
      runNode('scripts/reindex-retrieval.mjs', [
        `--sqlite=${group.databasePath}`,
        '--tenant=__global__',
        '--source=health_knowledge',
        '--vector-mode=active',
        `--embedding-dimension=${group.dimension}`,
        `--batch-size=${isLargeModel ? 1 : 10}`,
        `--embedding-concurrency=${isLargeModel ? 1 : 2}`,
      ], env);
    }
    runNode('scripts/evaluate-real-catalog-retrieval.mjs', [
      `--db=${group.databasePath}`,
      `--catalog=${options.catalogPath}`,
      `--output=${state.catalogReportPath}`,
      '--resume',
    ], env);
    runNode('scripts/evaluate-multi-source-retrieval.mjs', [
      `--database=${group.databasePath}`,
      `--model=${group.model}`,
      `--dimension=${group.dimension}`,
      '--vector-mode=active',
      `--output=${state.knowledgeReportPath}`,
      `--embedding-batch-size=${isLargeModel ? 8 : 1}`,
      '--resume',
    ], env);
    const catalog = JSON.parse(readFileSync(state.catalogReportPath, 'utf8'));
    const knowledge = JSON.parse(readFileSync(state.knowledgeReportPath, 'utf8'));
    state.metrics = {
      catalogHybrid: catalog.strategies.hybrid.summary,
      catalogVector: catalog.strategies.vector.summary,
      catalogWorkflow: catalog.workflow.summary,
      multiSource: knowledge.summary,
    };
    state.status = 'completed';
  } catch (error) {
    state.status = 'failed';
    state.blocker = error.message;
  }
  report.groups.push(state);
}

const byId = new Map(report.groups.map((group) => [group.id, group]));
const enhanced06 = byId.get('enhanced-qwen06');
const enhanced8b = byId.get('enhanced-qwen8b');
const raw06 = byId.get('raw-qwen06');
const raw8b = byId.get('raw-qwen8b');
if (raw06?.metrics?.catalogHybrid && raw8b?.metrics?.catalogHybrid) {
  const gain = Number((raw8b.metrics.catalogHybrid.ndcgAt10 - raw06.metrics.catalogHybrid.ndcgAt10).toFixed(4));
  const multiSourceGain = raw06.metrics.multiSource && raw8b.metrics.multiSource
    ? Number((raw8b.metrics.multiSource.ndcgAt5 - raw06.metrics.multiSource.ndcgAt5).toFixed(4))
    : null;
  const multiSourceLatencyRatio = raw06.metrics.multiSource && raw8b.metrics.multiSource
    ? Number((raw8b.metrics.multiSource.latencyP95Ms / Math.max(0.01, raw06.metrics.multiSource.latencyP95Ms)).toFixed(2))
    : null;
  const p95 = Math.max(
    raw8b.metrics.catalogVector?.latencyP95Ms || 0,
    raw8b.metrics.catalogWorkflow?.latencyP95Ms || 0,
    raw8b.metrics.multiSource?.latencyP95Ms || 0,
  );
  const accepted8b = gain >= 0.01 && p95 <= 2500;
  report.rawModelComparison = {
    qwen8bNdcgGain: gain,
    catalogNdcgAt10Gain: gain,
    multiSourceNdcgAt5Gain: multiSourceGain,
    multiSourceLatencyP95Ratio: multiSourceLatencyRatio,
    qwen8bColdLatencyP95Ms: p95,
    accepted8b,
    recommendedModel: accepted8b ? raw8b.model : raw06.model,
    rejectionReasons: [
      ...(gain < 0.01 ? [`Catalog nDCG@10 gain ${gain} is below 0.01`] : []),
      ...(p95 > 2500 ? [`8B retrieval P95 ${p95}ms exceeds 2500ms`] : []),
    ],
    acceptanceRule: '8B requires >= 0.01 nDCG@10 gain and cold retrieval P95 <= 2500ms',
    multiSourceComparisonComplete: Boolean(raw06.metrics.multiSource && raw8b.metrics.multiSource),
  };
}
if (enhanced06?.status === 'completed' && enhanced8b?.status === 'completed') {
  const gain = Number((enhanced8b.metrics.catalogHybrid.ndcgAt10 - enhanced06.metrics.catalogHybrid.ndcgAt10).toFixed(4));
  const p95 = Math.max(
    enhanced8b.metrics.catalogVector?.latencyP95Ms || 0,
    enhanced8b.metrics.multiSource.latencyP95Ms || 0,
  );
  report.recommendation = {
    recommendedModel: gain >= 0.01 && p95 <= 2500 ? enhanced8b.model : enhanced06.model,
    qwen8bNdcgGain: gain,
    qwen8bColdLatencyP95Ms: p95,
    acceptanceRule: '8B requires >= 0.01 nDCG@10 gain and cold retrieval P95 <= 2500ms',
    accepted8b: gain >= 0.01 && p95 <= 2500,
  };
}

mkdirSync(dirname(options.outputPath), { recursive: true });
writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  outputPath: options.outputPath,
  annotation: report.annotation,
  groups: report.groups.map(({ id, model, dimension, enhanced, status, blocker }) => ({ id, model, dimension, enhanced, status, blocker })),
  recommendation: report.recommendation,
}, null, 2));
