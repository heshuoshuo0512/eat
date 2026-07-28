#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadCampusDiningCorpus } from '../server/campusDiningKnowledgeBase.js';
import {
  DISH_AI_ANNOTATION_PROMPT_VERSION,
  annotationRecord,
  buildDishAnnotationInput,
  dishAiAnnotationBatchSchema,
  findDishAiAnnotation,
  saveDishAiAnnotation,
  selectDishAnnotationPilot,
  validateDishAiAnnotation,
} from '../server/dishAiAnnotations.js';
import {
  loadFoodCompositionReferences,
  loadHealthKnowledgeDocuments,
} from '../server/healthKnowledgeBase.js';

const ROOT = resolve(import.meta.dirname, '..');

function parseArguments(argv) {
  const options = {
    databasePath: resolve(ROOT, 'data/real-catalog-campus-2026-07-27-v2.sqlite'),
    catalogPath: resolve(ROOT, 'data/imports/real/campus-2026-07-27/catalog.json'),
    outputPath: resolve(ROOT, '.rag-evals/dish-annotations/pilot-2026-07-28.json'),
    tenantId: 'default',
    batchId: 'dish-ai-pilot-2026-07-28',
    model: process.env.AI_CHAT_MODEL || 'deepseek-v4-flash',
    count: 200,
    batchSize: 5,
    concurrency: 2,
    retries: 2,
    seed: '20260728',
    prepareOnly: false,
  };
  for (const argument of argv) {
    if (argument.startsWith('--database=')) options.databasePath = resolve(argument.slice(11));
    else if (argument.startsWith('--catalog=')) options.catalogPath = resolve(argument.slice(10));
    else if (argument.startsWith('--output=')) options.outputPath = resolve(argument.slice(9));
    else if (argument.startsWith('--tenant=')) options.tenantId = argument.slice(9).trim();
    else if (argument.startsWith('--batch-id=')) options.batchId = argument.slice(11).trim();
    else if (argument.startsWith('--model=')) options.model = argument.slice(8).trim();
    else if (argument.startsWith('--count=')) options.count = Number(argument.slice(8));
    else if (argument.startsWith('--batch-size=')) options.batchSize = Number(argument.slice(13));
    else if (argument.startsWith('--concurrency=')) options.concurrency = Number(argument.slice(14));
    else if (argument.startsWith('--retries=')) options.retries = Number(argument.slice(10));
    else if (argument.startsWith('--seed=')) options.seed = argument.slice(7).trim();
    else if (argument === '--prepare-only') options.prepareOnly = true;
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  options.count = Math.max(1, Math.min(200, Math.trunc(options.count) || 200));
  options.batchSize = Math.max(1, Math.min(10, Math.trunc(options.batchSize) || 5));
  options.concurrency = Math.max(1, Math.min(4, Math.trunc(options.concurrency) || 2));
  options.retries = Math.max(0, Math.min(4, Math.trunc(options.retries) || 0));
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/generate-dish-ai-annotations.mjs [options]

Options:
  --database=<path>  Isolated real-catalog SQLite database
  --catalog=<path>   Normalized real-catalog JSON
  --output=<path>    Ignored local preparation/generation report
  --tenant=<id>      Tenant scope (default: default)
  --batch-id=<id>    Stable annotation batch ID
  --model=<id>       Chat model recorded in annotation provenance
  --count=N          Pilot size, up to 200 (default: 200)
  --batch-size=N     Dishes per model request, 1-10 (default: 5)
  --concurrency=N    Concurrent model requests, 1-4 (default: 2)
  --retries=N        Retries per failed batch, 0-4 (default: 2)
  --seed=<value>     Deterministic sampling seed
  --prepare-only     Build the selection/evidence report without calling Chat
  --help             Show this message`);
}

function refuseUnsafeDatabase(path) {
  const normalized = resolve(path).toLowerCase();
  const protectedPaths = [
    resolve(ROOT, 'data/smart-canteen.sqlite').toLowerCase(),
    resolve(ROOT, 'data/rag-experiment.sqlite').toLowerCase(),
  ];
  if (protectedPaths.includes(normalized)) {
    throw Object.assign(new Error('Dish AI annotations require an isolated real-catalog SQLite database'), {
      code: 'ISOLATED_DATABASE_REQUIRED',
    });
  }
  if (!normalized.endsWith('.sqlite')) throw new Error('Annotation database must be a SQLite file');
}

function countBy(items, valueFor) {
  const counts = {};
  for (const item of items) {
    const key = String(valueFor(item) || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function runConcurrent(items, concurrency, operation) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await operation(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function withRetries(operation, retries) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * (2 ** attempt)));
    }
  }
  throw lastError;
}

function reportItem(input) {
  return {
    sampleIndex: input.dish.annotationSampleIndex,
    dishId: input.dish.id,
    dishName: input.dish.name,
    canteenId: input.dish.canteenId,
    canteenName: input.dish.canteenName,
    stallId: input.dish.stallId,
    stallName: input.dish.stallName,
    pricingMode: input.dish.pricingMode,
    inputHash: input.inputHash,
    conceptIds: input.payload.concepts.map((item) => item.id),
    foodReferenceIds: input.payload.foodCompositionReferences.map((item) => item.id),
    healthKnowledgeIds: input.payload.healthKnowledge.map((item) => item.id),
  };
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}
refuseUnsafeDatabase(options.databasePath);

const catalog = JSON.parse(readFileSync(options.catalogPath, 'utf8'));
if (String(catalog.manifest?.tenantId || '') !== options.tenantId) {
  throw new Error(`Catalog tenant ${catalog.manifest?.tenantId || 'missing'} does not match ${options.tenantId}`);
}
const pilot = selectDishAnnotationPilot(catalog, { count: options.count, seed: options.seed });
const concepts = loadCampusDiningCorpus().concepts;
const references = loadFoodCompositionReferences();
const healthDocuments = loadHealthKnowledgeDocuments();
const prepared = pilot.map((dish) => ({
  dish,
  ...buildDishAnnotationInput(dish, {
    concepts,
    references,
    healthDocuments,
    model: options.model,
  }),
}));

const report = {
  generatedAt: new Date().toISOString(),
  mode: options.prepareOnly ? 'prepare_only' : 'generate',
  tenantId: options.tenantId,
  batchId: options.batchId,
  model: options.model,
  promptVersion: DISH_AI_ANNOTATION_PROMPT_VERSION,
  catalog: {
    path: options.catalogPath,
    batchId: catalog.manifest?.batchId,
    dataVersion: catalog.manifest?.dataVersion,
    dishCount: catalog.dishes.length,
    stallCount: catalog.stalls.length,
    canteenCount: catalog.canteens.length,
    synthetic: false,
  },
  pilot: {
    count: prepared.length,
    pricingModes: countBy(pilot, (item) => item.pricingMode),
    canteens: countBy(pilot, (item) => item.canteenName),
    dishesWithConceptMatches: prepared.filter((item) => item.payload.concepts.length).length,
    dishesWithFoodReferenceMatches: prepared.filter((item) => item.payload.foodCompositionReferences.length).length,
    healthDocumentsPerDish: countBy(prepared, (item) => item.payload.healthKnowledge.length),
  },
  items: prepared.map(reportItem),
  generation: null,
};

if (!options.prepareOnly) {
  process.env.ENABLE_DEMO_SEED = '0';
  process.env.DB_DRIVER = 'sqlite';
  process.env.SMART_CANTEEN_DB = options.databasePath;
  const [{ createDatabase }, { generateDishAnnotationCandidates, getAiProviderStatus }] = await Promise.all([
    import('../server/database.js'),
    import('../server/aiProvider.js'),
  ]);
  const provider = getAiProviderStatus().chat;
  if (!provider.enabled || !provider.hasApiKey) {
    throw Object.assign(new Error('AI_CHAT_API_KEY is required unless --prepare-only is used'), {
      code: 'CHAT_PROVIDER_NOT_CONFIGURED',
    });
  }
  const db = await createDatabase();
  try {
    const databaseDishCount = Number((await db.prepare('SELECT COUNT(*) AS count FROM dishes WHERE tenant_id = ?').get(options.tenantId)).count || 0);
    if (databaseDishCount !== catalog.dishes.length) {
      throw new Error(`Isolated database has ${databaseDishCount} dishes but catalog has ${catalog.dishes.length}`);
    }
    const pending = [];
    let skippedCount = 0;
    for (const item of prepared) {
      const existing = await findDishAiAnnotation(db, {
        tenantId: options.tenantId,
        dishId: item.dish.id,
        batchId: options.batchId,
        inputHash: item.inputHash,
      });
      if (existing?.status === 'schema_validated' || existing?.status === 'approved') skippedCount += 1;
      else pending.push(item);
    }
    const batchResults = await runConcurrent(chunks(pending, options.batchSize), options.concurrency, async (batch, index) => {
      const startedAt = performance.now();
      try {
        const { generated, records } = await withRetries(async () => {
          const generatedResult = await generateDishAnnotationCandidates({
            dishes: batch.map((item) => item.payload),
            knowledge: {
              evidenceIsolation: 'Each dish object contains its complete allowed evidence set.',
              authority: 'All outputs remain ai_estimated and must_not_overwrite tenant facts.',
            },
            promptVersion: DISH_AI_ANNOTATION_PROMPT_VERSION,
          });
          const parsedBatch = dishAiAnnotationBatchSchema.parse({ annotations: generatedResult.annotations });
          const byDishId = new Map(parsedBatch.annotations.map((annotation) => [annotation?.dishId, annotation]));
          if (byDishId.size !== batch.length || batch.some((item) => !byDishId.has(item.dish.id))) {
            throw new Error('Model response must contain exactly one annotation for each requested dish');
          }
          const validatedRecords = batch.map((item) => {
            const annotation = validateDishAiAnnotation(byDishId.get(item.dish.id), {
              dishId: item.dish.id,
              allowedConceptIds: item.allowedConceptIds,
              allowedReferenceIds: item.allowedReferenceIds,
              allowedSourceIds: item.allowedSourceIds,
            });
            return annotationRecord({
              tenantId: options.tenantId,
              batchId: options.batchId,
              model: generatedResult.model || options.model,
              inputHash: item.inputHash,
              annotation,
              status: 'schema_validated',
            });
          });
          return { generated: generatedResult, records: validatedRecords };
        }, options.retries);
        for (const record of records) await saveDishAiAnnotation(db, record);
        return {
          index,
          dishIds: batch.map((item) => item.dish.id),
          status: 'completed',
          savedCount: records.length,
          model: generated.model || options.model,
          latencyMs: Number((performance.now() - startedAt).toFixed(2)),
          finishReason: generated.finishReason,
          usage: generated.usage,
        };
      } catch (error) {
        return {
          index,
          dishIds: batch.map((item) => item.dish.id),
          status: 'failed',
          savedCount: 0,
          latencyMs: Number((performance.now() - startedAt).toFixed(2)),
          error: { code: error.code || null, message: error.message },
        };
      }
    });
    const savedCount = batchResults.reduce((sum, item) => sum + item.savedCount, 0);
    const failed = batchResults.filter((item) => item.status === 'failed');
    const usage = batchResults.reduce((total, item) => ({
      promptTokens: total.promptTokens + Number(item.usage?.promptTokens || 0),
      completionTokens: total.completionTokens + Number(item.usage?.completionTokens || 0),
      totalTokens: total.totalTokens + Number(item.usage?.totalTokens || 0),
    }), { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    report.generation = {
      provider: { model: provider.model, baseUrl: provider.baseUrl },
      requestedCount: prepared.length,
      skippedCount,
      attemptedCount: pending.length,
      savedCount,
      failedCount: failed.reduce((sum, item) => sum + item.dishIds.length, 0),
      usage,
      batches: batchResults,
    };
    if (failed.length) process.exitCode = 1;
  } finally {
    await db.close();
  }
}

mkdirSync(dirname(options.outputPath), { recursive: true });
writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  outputPath: options.outputPath,
  mode: report.mode,
  pilot: report.pilot,
  generation: report.generation && {
    requestedCount: report.generation.requestedCount,
    skippedCount: report.generation.skippedCount,
      savedCount: report.generation.savedCount,
      failedCount: report.generation.failedCount,
      usage: report.generation.usage,
    },
}, null, 2));
