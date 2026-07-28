#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  CATALOG_INTRODUCTION_PROMPT_VERSION,
  auditCatalogIntroductionRecords,
  createCatalogIntroductionBatch,
  generateValidatedCatalogIntroductionBatch,
  listCatalogIntroductionCandidates,
  loadCatalogIntroductionEvidence,
  nextCatalogIntroductionVersions,
  saveCatalogIntroductionCandidate,
  updateCatalogIntroductionBatch,
} from '../server/catalogIntroductions.js';

const ROOT = resolve(import.meta.dirname, '..');

function parseArguments(argv) {
  const options = {
    sourceDatabase: resolve(ROOT, 'data/real-catalog-campus-2026-07-27-v2.sqlite'),
    databasePath: resolve(ROOT, 'data/real-catalog-introductions-2026-07-28.sqlite'),
    outputPath: resolve(ROOT, '.rag-evals/catalog-introductions/catalog-introduction-v1.json'),
    tenantId: 'default',
    batchId: 'catalog-introduction-v1-2026-07-28',
    model: process.env.AI_CHAT_MODEL || 'deepseek-v4-flash',
    prepareOnly: false,
    probeOnly: false,
    skipProbe: false,
    startConcurrency: 0,
    reset: false,
    probeBatches: 6,
    maxConcurrency: 6,
    startDelayMs: 250,
  };
  for (const argument of argv) {
    if (argument.startsWith('--source-database=')) options.sourceDatabase = resolve(argument.slice(18));
    else if (argument.startsWith('--database=')) options.databasePath = resolve(argument.slice(11));
    else if (argument.startsWith('--output=')) options.outputPath = resolve(argument.slice(9));
    else if (argument.startsWith('--tenant=')) options.tenantId = argument.slice(9).trim();
    else if (argument.startsWith('--batch-id=')) options.batchId = argument.slice(11).trim();
    else if (argument.startsWith('--model=')) options.model = argument.slice(8).trim();
    else if (argument.startsWith('--probe-batches=')) options.probeBatches = Number(argument.slice(16));
    else if (argument.startsWith('--max-concurrency=')) options.maxConcurrency = Number(argument.slice(18));
    else if (argument.startsWith('--start-delay-ms=')) options.startDelayMs = Number(argument.slice(17));
    else if (argument.startsWith('--start-concurrency=')) options.startConcurrency = Number(argument.slice(20));
    else if (argument === '--prepare-only') options.prepareOnly = true;
    else if (argument === '--probe-only') options.probeOnly = true;
    else if (argument === '--skip-probe') options.skipProbe = true;
    else if (argument === '--reset') options.reset = true;
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  options.probeBatches = Math.max(2, Math.min(10, Math.trunc(options.probeBatches) || 6));
  options.maxConcurrency = Math.max(1, Math.min(6, Math.trunc(options.maxConcurrency) || 6));
  options.startDelayMs = Math.max(250, Math.min(2_000, Math.trunc(options.startDelayMs) || 250));
  options.startConcurrency = options.startConcurrency
    ? Math.max(1, Math.min(options.maxConcurrency, Math.trunc(options.startConcurrency)))
    : 0;
  if (options.probeOnly && options.skipProbe) throw new Error('--probe-only and --skip-probe cannot be used together');
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/generate-catalog-introductions.mjs [options]

Options:
  --source-database=<path>  Immutable real catalog SQLite source
  --database=<path>         Isolated resumable generation database
  --output=<path>           Ignored local generation report
  --tenant=<id>             Tenant scope (default: default)
  --batch-id=<id>           Stable generation batch id
  --model=<id>              Chat model recorded in provenance
  --probe-batches=N         Batches per concurrency probe level (2-10)
  --max-concurrency=N       Hard concurrency cap (1-6)
  --start-delay-ms=N        Minimum delay between request starts (>=250)
  --prepare-only            Build evidence and report without Chat calls
  --probe-only              Run the 1/2/4/6 staircase, persist results, then pause
  --skip-probe              Resume generation using the persisted safe concurrency
  --start-concurrency=N     Override resumed concurrency (1 to --max-concurrency)
  --reset                   Recopy the source database before generation
  --help                    Show this message`);
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function wait(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function errorDetails(error) {
  return {
    code: error?.code || null,
    status: Number(error?.status || 0) || null,
    message: String(error?.message || error || 'UNKNOWN_ERROR').slice(0, 1_000),
    retryAfterMs: Number(error?.retryAfterMs || 0) || null,
    requestId: error?.requestId || null,
    rateLimit: error?.rateLimit || null,
  };
}

function parseObject(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '{}')); } catch { return {}; }
}

function isAuthError(error) {
  return error?.code === 'AI_PROVIDER_AUTH_FAILED' || [401, 403].includes(Number(error?.status));
}

function isRateLimit(error) {
  return error?.code === 'AI_PROVIDER_RATE_LIMITED' || Number(error?.status) === 429;
}

function retryableProviderError(error) {
  return isRateLimit(error)
    || error?.code === 'AI_PROVIDER_TIMEOUT'
    || error?.code === 'AI_PROVIDER_NETWORK_ERROR'
    || error?.code === 'AI_PROVIDER_UNAVAILABLE'
    || Number(error?.status) >= 500;
}

function sumUsage(results) {
  return results.reduce((total, item) => ({
    promptTokens: total.promptTokens + Number(item.usage?.promptTokens || 0),
    completionTokens: total.completionTokens + Number(item.usage?.completionTokens || 0),
    totalTokens: total.totalTokens + Number(item.usage?.totalTokens || 0),
  }), { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
}

function summarizeFailures(results) {
  const failures = new Map();
  const pending = [...results];
  while (pending.length) {
    const result = pending.shift();
    if (Array.isArray(result?.splitResults)) {
      pending.push(...result.splitResults);
      continue;
    }
    if (result?.status === 'completed') continue;
    const details = result?.error || {};
    const code = String(details.code || (details.status ? `HTTP_${details.status}` : 'UNKNOWN_FAILURE'));
    const current = failures.get(code) || {
      code,
      status: details.status || null,
      count: 0,
      sampleMessage: String(details.message || 'Unknown generation failure').slice(0, 500),
    };
    current.count += 1;
    failures.set(code, current);
  }
  return [...failures.values()].sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
}

function stageJobs(evidence) {
  const configuration = [
    { stage: 'dish', level: 'dish', batchSize: 10, concurrencyCap: 6 },
    { stage: 'stall', level: 'stall', batchSize: 5, concurrencyCap: 4 },
    { stage: 'area', level: 'area', batchSize: 4, concurrencyCap: 4 },
    { stage: 'venue', level: 'venue', batchSize: 4, concurrencyCap: 4 },
  ];
  return configuration.map((item) => ({
    ...item,
    jobs: chunks(evidence.filter((entry) => entry.hierarchyLevel === item.level), item.batchSize)
      .map((items, index) => ({ id: `${item.stage}-${String(index + 1).padStart(4, '0')}`, stage: item.stage, items })),
  }));
}

function reviewSample(records, limit = 200) {
  const confidenceRank = { low: 0, medium: 1, high: 2 };
  const ranked = (rows) => [...rows].sort((left, right) => (
    (confidenceRank[left.confidence.level] ?? 3) - (confidenceRank[right.confidence.level] ?? 3)
      || left.entityId.localeCompare(right.entityId, 'zh-CN')
  ));
  const canteens = ranked(records.filter((item) => item.entityType === 'canteen'));
  const stalls = ranked(records.filter((item) => item.entityType === 'stall'))
    .slice(0, Math.min(60, limit - canteens.length));
  const dishes = ranked(records.filter((item) => item.entityType === 'dish'))
    .slice(0, Math.max(0, limit - canteens.length - stalls.length));
  return [...canteens, ...stalls, ...dishes].slice(0, limit).map((item) => ({
    id: item.id,
    entityType: item.entityType,
    hierarchyLevel: item.hierarchyLevel,
    entityId: item.entityId,
    factualSummary: item.factualSummary,
    recommendationCopy: item.recommendationCopy,
    confidence: item.confidence,
    boundaryCodes: item.boundaryCodes,
    evidenceIds: item.evidenceIds,
  }));
}

function createRequestGate(startDelayMs) {
  let nextStartAt = 0;
  let pausedUntil = 0;
  let chain = Promise.resolve();
  const enter = () => {
    const scheduled = chain.then(async () => {
      const delay = Math.max(0, nextStartAt - Date.now(), pausedUntil - Date.now());
      if (delay) await wait(delay);
      nextStartAt = Date.now() + startDelayMs;
    });
    chain = scheduled.catch(() => {});
    return scheduled;
  };
  enter.pause = (milliseconds) => {
    pausedUntil = Math.max(pausedUntil, Date.now() + Math.max(0, Number(milliseconds) || 0));
  };
  return enter;
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}
if (!existsSync(options.sourceDatabase)) throw new Error(`Source database does not exist: ${options.sourceDatabase}`);
if (resolve(options.sourceDatabase) === resolve(options.databasePath)) throw new Error('Generation database must be separate from the source database');
if (options.reset || !existsSync(options.databasePath)) {
  mkdirSync(dirname(options.databasePath), { recursive: true });
  copyFileSync(options.sourceDatabase, options.databasePath);
}

process.env.ENABLE_DEMO_SEED = '0';
process.env.DB_DRIVER = 'sqlite';
process.env.SMART_CANTEEN_DB = options.databasePath;
const [{ openDatabase }, aiProvider] = await Promise.all([
  import('../server/database.js'),
  import('../server/aiProvider.js'),
]);
const db = openDatabase(options.databasePath);
const report = {
  generatedAt: new Date().toISOString(),
  mode: options.prepareOnly ? 'prepare_only' : 'generate',
  tenantId: options.tenantId,
  sourceDatabase: options.sourceDatabase,
  databasePath: options.databasePath,
  batchId: options.batchId,
  model: options.model,
  promptVersion: CATALOG_INTRODUCTION_PROMPT_VERSION,
  catalog: null,
  probe: [],
  stages: [],
  summary: null,
};

function persistReport() {
  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function loadWholeBatch(batchId) {
  const records = [];
  let offset = 0;
  while (true) {
    const page = await listCatalogIntroductionCandidates(db, {
      tenantId: options.tenantId,
      batchId,
      limit: 200,
      offset,
    });
    records.push(...page.items);
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) return records;
  }
}

try {
  const catalog = await loadCatalogIntroductionEvidence(db, { tenantId: options.tenantId });
  report.catalog = {
    dataVersion: catalog.catalogDataVersion,
    snapshotHash: catalog.snapshotHash,
    counts: catalog.counts,
    lowConfidenceCount: catalog.evidence.filter((item) => item.confidence.level === 'low').length,
    menuMissingCount: catalog.evidence.filter((item) => item.boundaryCodes.includes('MENU_MISSING')).length,
  };
  const batchRow = await createCatalogIntroductionBatch(db, {
    id: options.batchId,
    tenantId: options.tenantId,
    model: options.model,
    promptVersion: CATALOG_INTRODUCTION_PROMPT_VERSION,
    catalogDataVersion: catalog.catalogDataVersion,
    snapshotHash: catalog.snapshotHash,
    entityCount: catalog.counts.total,
  });
  options.batchId = batchRow.id;
  report.batchId = batchRow.id;
  if (options.prepareOnly) {
    report.summary = { preparedCount: catalog.evidence.length, generatedCount: 0 };
    persistReport();
    console.log(JSON.stringify(report.summary));
    process.exit(0);
  }

  process.env.AI_CHAT_MODEL = options.model;
  const provider = aiProvider.getAiProviderStatus().chat;
  if (!provider.enabled || !provider.hasApiKey) throw Object.assign(new Error('AI_CHAT_API_KEY is required'), { code: 'CHAT_PROVIDER_NOT_CONFIGURED' });
  await aiProvider.testAiProviderConnection({
    apiKey: process.env.AI_CHAT_API_KEY,
    baseUrl: process.env.AI_CHAT_BASE_URL,
    chatModel: options.model,
    timeoutMs: Math.max(30_000, Number(process.env.AI_CHAT_TIMEOUT_MS || 0)),
  });

  const existing = await listCatalogIntroductionCandidates(db, { tenantId: options.tenantId, batchId: options.batchId, limit: 200, offset: 0 });
  const existingKeys = new Set();
  let pageOffset = 0;
  while (pageOffset < existing.total) {
    const page = await listCatalogIntroductionCandidates(db, { tenantId: options.tenantId, batchId: options.batchId, limit: 200, offset: pageOffset });
    for (const item of page.items) if (['schema_validated', 'approved'].includes(item.status)) existingKeys.add(`${item.entityType}:${item.entityId}:${item.inputHash}`);
    pageOffset += page.items.length;
    if (!page.items.length) break;
  }
  const pendingEvidence = catalog.evidence.filter((item) => !existingKeys.has(`${item.entityType}:${item.entity.id}:${item.inputHash}`));
  const versions = await nextCatalogIntroductionVersions(db, options.tenantId);
  const requestGate = createRequestGate(options.startDelayMs);

  async function callProvider(items, repair = null) {
    await requestGate();
    return repair
      ? aiProvider.repairCatalogIntroductionCandidates({ items, previousOutput: repair.output, validationError: repair.error, promptVersion: CATALOG_INTRODUCTION_PROMPT_VERSION })
      : aiProvider.generateCatalogIntroductionCandidates({ items, promptVersion: CATALOG_INTRODUCTION_PROMPT_VERSION });
  }

  async function generateAndValidate(items) {
    const result = await generateValidatedCatalogIntroductionBatch({
      evidenceBatch: items,
      generate: () => callProvider(items),
      repair: ({ previousOutput, validationError }) => callProvider(items, { output: previousOutput, error: validationError }),
    });
    return {
      ...result,
      ...(result.initialValidationError ? { initialValidationError: errorDetails(result.initialValidationError) } : {}),
    };
  }

  async function saveCandidates(items, result) {
    const records = [];
    for (const candidate of result.candidates) {
      const key = `${candidate.entityType}:${candidate.entityId}`;
      const version = versions.get(key) || 1;
      records.push(await saveCatalogIntroductionCandidate(db, {
        tenantId: options.tenantId,
        batchId: options.batchId,
        version,
        model: result.generated.model || options.model,
        promptVersion: CATALOG_INTRODUCTION_PROMPT_VERSION,
        candidate,
      }));
      versions.set(key, version + 1);
    }
    return records;
  }

  async function executeJob(job) {
    const startedAt = performance.now();
    let rateLimitedCount = 0;
    let providerRetries = 0;
    let lastError;
    for (let attempt = 0; attempt <= 4; attempt += 1) {
      try {
        const result = await generateAndValidate(job.items);
        const records = await saveCandidates(job.items, result);
        return {
          id: job.id, stage: job.stage, status: 'completed', savedCount: records.length,
          latencyMs: Number((performance.now() - startedAt).toFixed(2)), repaired: result.repaired,
          rateLimitedCount, providerRetries, usage: result.generated.usage,
        };
      } catch (error) {
        lastError = error;
        if (isAuthError(error)) throw error;
        if (isRateLimit(error)) rateLimitedCount += 1;
        const maxRetries = isRateLimit(error) ? 4 : 2;
        if (!retryableProviderError(error) || attempt >= maxRetries) break;
        providerRetries += 1;
        const delay = Number(error.retryAfterMs || 0) || Math.min(16_000, 2_000 * (2 ** attempt)) + Math.floor(Math.random() * 500);
        if (isRateLimit(error)) requestGate.pause(delay);
        await wait(delay);
      }
    }

    if (isRateLimit(lastError)) {
      throw Object.assign(new Error('Rate limit persisted after four retries; generation paused for a resumable rerun'), {
        code: 'CATALOG_INTRODUCTION_GENERATION_PAUSED',
        status: 429,
        retryAfterMs: lastError?.retryAfterMs || null,
        requestId: lastError?.requestId || null,
        rateLimit: lastError?.rateLimit || null,
        cause: lastError,
      });
    }

    if (job.items.length > 1 && !retryableProviderError(lastError)) {
      const splitResults = [];
      for (const item of job.items) splitResults.push(await executeJob({ ...job, id: `${job.id}:${item.entity.id}`, items: [item] }));
      return {
        id: job.id, stage: job.stage,
        status: splitResults.every((item) => item.status === 'completed') ? 'completed' : 'partial',
        savedCount: splitResults.reduce((sum, item) => sum + item.savedCount, 0),
        latencyMs: Number((performance.now() - startedAt).toFixed(2)),
        repaired: splitResults.some((item) => item.repaired),
        rateLimitedCount: splitResults.reduce((sum, item) => sum + item.rateLimitedCount, rateLimitedCount),
        providerRetries: splitResults.reduce((sum, item) => sum + item.providerRetries, providerRetries),
        usage: sumUsage(splitResults),
        splitResults,
      };
    }
    return {
      id: job.id, stage: job.stage, status: 'failed', savedCount: 0,
      latencyMs: Number((performance.now() - startedAt).toFixed(2)), repaired: false,
      rateLimitedCount, providerRetries, usage: {}, error: errorDetails(lastError),
    };
  }

  async function runWave(jobs, concurrency) {
    const startedAt = performance.now();
    const results = [];
    let cursor = 0;
    let fatalError = null;
    const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (!fatalError) {
        const index = cursor++;
        if (index >= jobs.length) return;
        try {
          results[index] = await executeJob(jobs[index]);
        } catch (error) {
          fatalError ||= error;
        }
      }
    });
    await Promise.all(workers);
    if (fatalError) throw fatalError;
    const completedResults = results.filter(Boolean);
    const durationMs = performance.now() - startedAt;
    const completed = completedResults.filter((item) => item.status === 'completed').length;
    return {
      results: completedResults,
      metrics: {
        concurrency,
        batchCount: completedResults.length,
        completed,
        failed: completedResults.length - completed,
        successRate: Number((completed / Math.max(1, completedResults.length)).toFixed(4)),
        savedCount: completedResults.reduce((sum, item) => sum + item.savedCount, 0),
        rateLimitedCount: completedResults.reduce((sum, item) => sum + item.rateLimitedCount, 0),
        durationMs: Number(durationMs.toFixed(2)),
        requestsPerSecond: Number((completedResults.length / Math.max(durationMs / 1000, 0.001)).toFixed(3)),
        tokensPerSecond: Number((sumUsage(completedResults).totalTokens / Math.max(durationMs / 1000, 0.001)).toFixed(2)),
        p50Ms: percentile(completedResults.map((item) => item.latencyMs), 0.5),
        p95Ms: percentile(completedResults.map((item) => item.latencyMs), 0.95),
        usage: sumUsage(completedResults),
        failureReasons: summarizeFailures(completedResults),
      },
    };
  }

  const stages = stageJobs(pendingEvidence);
  const previousConcurrency = parseObject(batchRow.concurrency_json ?? batchRow.concurrency);
  let selectedConcurrency = options.startConcurrency
    || Math.min(Number(previousConcurrency.selected || 2), options.maxConcurrency);
  const dishStage = stages.find((stage) => stage.stage === 'dish');
  const probeLevels = [1, 2, 4, 6].filter((level) => level <= options.maxConcurrency);
  const currentProbeMetrics = [];
  let previousThroughput = 0;
  if (options.skipProbe) {
    report.probe = Array.isArray(previousConcurrency.probe) ? previousConcurrency.probe : [];
    previousThroughput = Number(report.probe.at(-1)?.requestsPerSecond || 0);
  } else {
    await updateCatalogIntroductionBatch(db, options.batchId, options.tenantId, { status: 'probing' });
    for (const level of probeLevels) {
      const jobs = dishStage.jobs.splice(0, Math.min(options.probeBatches, dishStage.jobs.length));
      if (!jobs.length) break;
      const probe = await runWave(jobs, level);
      report.probe.push(probe.metrics);
      currentProbeMetrics.push(probe.metrics);
      const errorRate = probe.metrics.failed / Math.max(1, probe.metrics.batchCount);
      const improvement = previousThroughput ? (probe.metrics.requestsPerSecond - previousThroughput) / previousThroughput : 1;
      if (probe.metrics.rateLimitedCount || errorRate >= 0.02 || (previousThroughput && improvement < 0.15)) {
        selectedConcurrency = Math.max(1, probeLevels[Math.max(0, probeLevels.indexOf(level) - 1)] || 1);
        break;
      }
      selectedConcurrency = level;
      previousThroughput = probe.metrics.requestsPerSecond;
    }
  }
  await updateCatalogIntroductionBatch(db, options.batchId, options.tenantId, {
    status: options.probeOnly ? 'paused' : 'generating',
    concurrency: { selected: selectedConcurrency, maximum: options.maxConcurrency, probe: report.probe },
  });
  const remainingBatches = stages.reduce((sum, stage) => sum + stage.jobs.length, 0);
  const estimatedRemainingSeconds = previousThroughput > 0 ? Math.ceil(remainingBatches / previousThroughput) : null;
  report.concurrencyDecision = {
    selectedConcurrency,
    remainingBatches,
    estimatedRemainingSeconds,
    observedRateLimitCount: report.probe.reduce((sum, item) => sum + item.rateLimitedCount, 0),
  };
  console.log(JSON.stringify({ event: 'catalog_introduction_concurrency_selected', ...report.concurrencyDecision }));
  if (options.probeOnly) {
    throw Object.assign(new Error('Concurrency probe completed; rerun with --skip-probe to continue'), {
      code: 'CATALOG_INTRODUCTION_PROBE_COMPLETE',
      completedCount: existingKeys.size + currentProbeMetrics.reduce((sum, item) => sum + item.savedCount, 0),
    });
  }

  let completedCount = existingKeys.size + currentProbeMetrics.reduce((sum, item) => sum + item.savedCount, 0);
  let attemptFailureCount = currentProbeMetrics.reduce((sum, item) => sum + item.failed, 0);
  for (const stage of stages) {
    const stageReport = { stage: stage.stage, initialConcurrency: Math.min(selectedConcurrency, stage.concurrencyCap), waves: [] };
    let concurrency = stageReport.initialConcurrency;
    let successSinceRateLimit = 0;
    while (stage.jobs.length) {
      const waveJobs = stage.jobs.splice(0, Math.min(stage.jobs.length, Math.max(concurrency * 5, concurrency)));
      const wave = await runWave(waveJobs, concurrency);
      stageReport.waves.push(wave.metrics);
      completedCount += wave.metrics.savedCount;
      attemptFailureCount += wave.metrics.failed;
      if (wave.metrics.rateLimitedCount) {
        concurrency = Math.max(1, Math.floor(concurrency / 2));
        successSinceRateLimit = 0;
      } else {
        successSinceRateLimit += wave.metrics.completed;
        if (successSinceRateLimit >= 20 && concurrency < Math.min(selectedConcurrency, stage.concurrencyCap)) {
          concurrency += 1;
          successSinceRateLimit = 0;
        }
      }
      await updateCatalogIntroductionBatch(db, options.batchId, options.tenantId, { completedCount, failedCount: attemptFailureCount });
      persistReport();
    }
    stageReport.finalConcurrency = concurrency;
    stageReport.savedCount = stageReport.waves.reduce((sum, item) => sum + item.savedCount, 0);
    stageReport.failedCount = stageReport.waves.reduce((sum, item) => sum + item.failed, 0);
    report.stages.push(stageReport);
  }

  const finalRecords = await loadWholeBatch(options.batchId);
  const quality = auditCatalogIntroductionRecords(finalRecords);
  const unresolvedCount = Math.max(0, catalog.counts.total - finalRecords.length);
  const status = unresolvedCount === 0 && quality.ok ? 'generated' : 'failed';
  const allMetrics = [...report.probe, ...report.stages.flatMap((stage) => stage.waves)];
  report.quality = quality;
  report.reviewSample = reviewSample(finalRecords);
  report.summary = {
    status,
    candidateCount: finalRecords.length,
    expectedCount: catalog.counts.total,
    resumedCount: existingKeys.size,
    failedCount: unresolvedCount,
    attemptFailureCount,
    selectedConcurrency,
    rateLimitedCount: allMetrics.reduce((sum, item) => sum + item.rateLimitedCount, 0),
    usage: sumUsage(allMetrics.map((item) => ({ usage: item.usage }))),
  };
  await updateCatalogIntroductionBatch(db, options.batchId, options.tenantId, {
    status,
    completedCount: finalRecords.length,
    failedCount: unresolvedCount,
    metrics: { ...report.summary, quality },
    error: status === 'failed' ? 'Generation incomplete or quality audit failed; inspect the report and rerun the same batch' : null,
  });
  persistReport();
  console.log(JSON.stringify(report.summary));
} catch (error) {
  const probeComplete = error?.code === 'CATALOG_INTRODUCTION_PROBE_COMPLETE';
  const paused = error?.code === 'CATALOG_INTRODUCTION_GENERATION_PAUSED';
  report.summary = {
    status: probeComplete ? 'probe_complete' : paused ? 'paused' : 'failed',
    ...(probeComplete ? {
      completedCount: Number(error.completedCount || 0),
      concurrencyDecision: report.concurrencyDecision,
    } : { error: errorDetails(error) }),
  };
  try {
    await updateCatalogIntroductionBatch(db, options.batchId, options.tenantId, {
      status: probeComplete || paused ? 'paused' : 'failed',
      ...(probeComplete ? {
        completedCount: Number(error.completedCount || 0),
        metrics: report.summary,
        error: 'Probe complete; resume with --skip-probe',
      } : { error: report.summary.error.message }),
    });
  } catch {}
  persistReport();
  if (probeComplete) console.log(JSON.stringify(report.summary));
  else throw error;
} finally {
  db.close();
}
