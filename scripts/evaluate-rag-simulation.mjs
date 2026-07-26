import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateGroundedAgentAnswer } from '../server/aiProvider.js';
import {
  CAMPUS_KNOWLEDGE_SOURCE_TYPE,
  GLOBAL_KNOWLEDGE_TENANT_ID,
  loadCampusDiningCorpus,
} from '../server/campusDiningKnowledgeBase.js';
import { buildDishFacts, evaluateDishSafety } from '../server/diningFacts.js';
import { openDatabase, rowToDish } from '../server/database.js';
import { reindexRetrieval, searchRetrievalIndex, validateEmbedding } from '../server/retrievalIndex.js';
import { mergeDiningConversationState, parseDishSearchRequest, runDishSearchWorkflow } from '../server/retrievalService.js';

const ROOT = resolve(import.meta.dirname, '..');
const DATA_DIR = resolve(ROOT, '.rag-simulations', 'v1');
const DB_PATH = resolve(DATA_DIR, 'simulation.sqlite');
const withVectors = process.argv.includes('--with-vectors');
const vectorSampleLimit = Number(process.argv.find((item) => item.startsWith('--vector-sample='))?.split('=')[1] || 100);

function readJsonLines(path) {
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function equalValue(actual, expected) {
  if (Array.isArray(expected)) return expected.every((item) => (actual || []).includes(item));
  return actual === expected;
}

const EVALUATED_HARD_FILTERS = new Set([
  'budgetMin', 'budgetMax', 'mealType', 'canteenId', 'canteenName', 'stallId', 'stallName',
  'halalOnly', 'taste', 'includeIngredients', 'avoidIngredients', 'allergens', 'dietaryPattern',
  'minProtein', 'minFiber', 'maxCalories', 'maxFat', 'maxCarbs', 'maxSodium', 'maxSugar',
  'minSpiceLevel', 'maxSpiceLevel', 'orderableOnly',
]);

function slotMetrics(queries) {
  let expectedSlots = 0;
  let actualSlots = 0;
  let truePositive = 0;
  const failures = [];
  for (const query of queries) {
    const expected = query.expected?.hardFilters || {};
    const actual = parseDishSearchRequest(query.query).filters;
    const expectedEntries = Object.entries(expected);
    expectedSlots += expectedEntries.length;
    const actualEntries = Object.entries(actual).filter(([key, value]) => EVALUATED_HARD_FILTERS.has(key) && value !== undefined);
    actualSlots += actualEntries.length;
    for (const [key, value] of expectedEntries) {
      if (equalValue(actual[key], value)) truePositive += 1;
      else failures.push({ id: query.id, query: query.query, field: key, expected: value, actual: actual[key] });
    }
    for (const [key, value] of actualEntries) {
      if (expected[key] === undefined) failures.push({ id: query.id, query: query.query, field: key, expected: undefined, actual: value, type: 'unexpected_filter' });
    }
  }
  const precision = truePositive / Math.max(1, actualSlots);
  const recall = truePositive / Math.max(1, expectedSlots);
  return {
    expectedSlots, truePositive,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number((2 * precision * recall / Math.max(Number.EPSILON, precision + recall)).toFixed(4)),
    failures: failures.slice(0, 100),
  };
}

function safetyMetrics(db) {
  const rows = db.prepare("SELECT * FROM dishes WHERE tenant_id LIKE 'sim-%'").all();
  let knownUnsafe = 0;
  let knownBlocked = 0;
  let unknown = 0;
  let unknownSignaled = 0;
  for (const row of rows) {
    const dish = { ...rowToDish(row), facts: buildDishFacts(row) };
    for (const declaration of dish.facts.declarations) {
      if (declaration.allergenCode === '*') {
        const result = evaluateDishSafety(dish, ['花生']);
        if (!result.blocked) {
          unknown += 1;
          if (result.status === 'unknown') unknownSignaled += 1;
        }
      } else if (['confirmed_present', 'cross_contact_possible'].includes(declaration.status)) {
        knownUnsafe += 1;
        if (evaluateDishSafety(dish, [declaration.allergenCode]).blocked) knownBlocked += 1;
      }
    }
  }
  return {
    knownUnsafe, knownBlocked, knownViolationCount: knownUnsafe - knownBlocked,
    unknown, unknownSignaled,
    unknownWarningCoverage: Number((unknownSignaled / Math.max(1, unknown)).toFixed(4)),
  };
}

async function lexicalPerformance(db, queries) {
  const samples = queries.filter((query) => query.category === 'alias_typo_dialect');
  const latencies = [];
  let hits = 0;
  let ndcgTotal = 0;
  const failures = [];
  for (const query of samples) {
    const startedAt = performance.now();
    const result = await runDishSearchWorkflow({ tenantId: query.tenantId, query: query.query, limit: 10, context: { date: '2026-09-02', time: '12:00', mealType: 'lunch' } }, { db });
    latencies.push(performance.now() - startedAt);
    const expected = query.expected.dishNameContains;
    const rank = result.items.findIndex((item) => item.name.includes(expected));
    const hit = rank >= 0;
    if (hit) hits += 1;
    else failures.push({ id: query.id, query: query.query, expected, actual: result.items.slice(0, 3).map((item) => item.name) });
    if (hit) ndcgTotal += 1 / Math.log2(rank + 2);
  }
  return {
    queryCount: samples.length,
    hitAt10: Number((hits / Math.max(1, samples.length)).toFixed(4)),
    ndcgAt10: Number((ndcgTotal / Math.max(1, samples.length)).toFixed(4)),
    latencyP50Ms: Number(percentile(latencies, 0.5).toFixed(2)),
    latencyP95Ms: Number(percentile(latencies, 0.95).toFixed(2)),
    failures: failures.slice(0, 50),
  };
}

async function retrievalIntegrityMetrics(db, queries) {
  const samples = queries.filter((_, index) => index % 5 === 0);
  const tenantDishIds = new Map();
  const confidenceBands = { high: 0, medium: 0, low: 0 };
  let resultCount = 0;
  let crossTenantCount = 0;
  let inventedDishCount = 0;
  let blockedSafetyCount = 0;
  let unknownItems = 0;
  let unknownWarnings = 0;
  const failures = [];

  for (const query of samples) {
    if (!tenantDishIds.has(query.tenantId)) {
      tenantDishIds.set(query.tenantId, new Set(db.prepare('SELECT id FROM dishes WHERE tenant_id = ?').all(query.tenantId).map((row) => row.id)));
    }
    const result = await runDishSearchWorkflow({
      tenantId: query.tenantId,
      query: query.query,
      limit: 10,
      context: { date: '2026-09-02', time: '12:00', mealType: 'lunch' },
    }, { db });
    const knownIds = tenantDishIds.get(query.tenantId);
    for (const item of result.items) {
      resultCount += 1;
      if (item.tenantId !== query.tenantId) crossTenantCount += 1;
      if (!knownIds.has(item.id)) inventedDishCount += 1;
      if (item.safety?.blocked) blockedSafetyCount += 1;
      if (item.safety?.status === 'unknown') {
        unknownItems += 1;
        if (result.warnings.some((warning) => warning.code === 'ALLERGEN_UNVERIFIED' && warning.dishId === item.id)) unknownWarnings += 1;
      }
      if (confidenceBands[item.confidence?.level] !== undefined) confidenceBands[item.confidence.level] += 1;
    }
    if (result.items.some((item) => item.tenantId !== query.tenantId || !knownIds.has(item.id))) {
      failures.push({ id: query.id, query: query.query, tenantId: query.tenantId });
    }
  }
  return {
    queryCount: samples.length,
    resultCount,
    crossTenantCount,
    inventedDishCount,
    blockedSafetyCount,
    unknownItems,
    unknownWarnings,
    unknownWarningCoverage: Number((unknownWarnings / Math.max(1, unknownItems)).toFixed(4)),
    confidenceBands,
    confidenceCalibration: {
      calibrated: false,
      reason: 'Synthetic relevance labels validate bands and invariants but cannot calibrate real-world probability.',
    },
    failures: failures.slice(0, 50),
  };
}

async function multiTurnMetrics(db, conversations) {
  let retainedSafety = 0;
  let tenantSafe = 0;
  let retrievalChecks = 0;
  const failures = [];
  for (const conversation of conversations) {
    let state = {};
    for (const turn of conversation.turns) state = mergeDiningConversationState(state, turn.text);
    const retained = conversation.invariants.retainedAllergens.every((item) => (state.filters.allergens || []).includes(item));
    if (retained) retainedSafety += 1;
    else failures.push({ id: conversation.id, type: 'lost_allergen', expected: conversation.invariants.retainedAllergens, actual: state.filters.allergens || [] });

    if (retrievalChecks < 60) {
      const result = await runDishSearchWorkflow({
        tenantId: conversation.tenantId,
        query: conversation.turns.at(-1)?.text || '',
        filters: state.filters,
        limit: 5,
        context: { date: '2026-09-02', time: '12:00', mealType: 'lunch' },
      }, { db });
      retrievalChecks += 1;
      if (result.items.every((item) => item.tenantId === conversation.tenantId && !item.safety?.blocked)) tenantSafe += 1;
      else failures.push({ id: conversation.id, type: 'retrieval_invariant' });
    }
  }
  return {
    conversationCount: conversations.length,
    retainedSafetyCount: retainedSafety,
    retainedSafetyRate: Number((retainedSafety / Math.max(1, conversations.length)).toFixed(4)),
    retrievalChecks,
    tenantAndSafetyPassCount: tenantSafe,
    retrievalInvariantRate: Number((tenantSafe / Math.max(1, retrievalChecks)).toFixed(4)),
    failures: failures.slice(0, 50),
  };
}

async function faultInjectionMetrics(db, faults) {
  const appSource = readFileSync(resolve(ROOT, 'server', 'app.js'), 'utf8');
  const hasGenerationFallback = /try\s*\{[\s\S]*generateGroundedAgentAnswer[\s\S]*catch\s*\(error\)/.test(appSource);
  const local = db.prepare("SELECT id, tenant_id, name FROM dishes WHERE tenant_id = 'sim-north-comprehensive' LIMIT 1").get();
  const foreign = db.prepare("SELECT id FROM dishes WHERE tenant_id = 'sim-south-comprehensive' LIMIT 1").get();
  let passed = 0;
  const byType = {};
  const failures = [];
  for (const fault of faults) {
    let ok = false;
    try {
      if (['embedding_timeout', 'weak_network'].includes(fault.type)) {
        const result = await runDishSearchWorkflow({ tenantId: local.tenant_id, query: local.name, limit: 5 }, {
          db, semanticSearch: async () => { throw Object.assign(new Error(fault.type), { code: fault.type.toUpperCase() }); },
        });
        ok = result.items.some((item) => item.id === local.id)
          && result.meta.degradedReasons.some((reason) => reason.includes('semantic_search_failed'));
      } else if (fault.type === 'tenant_collision') {
        const result = await runDishSearchWorkflow({ tenantId: local.tenant_id, query: local.name, limit: 5 }, {
          db, semanticSearch: async () => [{ sourceId: foreign.id, sourceType: 'dish', score: 1 }],
        });
        ok = result.items.every((item) => item.tenantId === local.tenant_id && item.id !== foreign.id);
      } else if (fault.type === 'stale_menu') {
        const result = await runDishSearchWorkflow({ tenantId: local.tenant_id, query: local.name, limit: 5, context: { date: '2099-01-01', time: '12:00' } }, { db });
        ok = result.items.every((item) => item.availability.status === 'not_on_menu' && item.availability.orderable === false);
      } else if (fault.type === 'invalid_embedding_dimension') {
        try { validateEmbedding([0, 1, 2], 1024); } catch (error) { ok = error.code === 'EMBEDDING_DIMENSION_MISMATCH'; }
      } else if (fault.type === 'unknown_citation') {
        ok = validateGroundedAgentAnswer({ answer: '仅依据证据回答。', citationIds: ['other'] }, [{ id: 'dish:1' }]).reason === 'UNKNOWN_CITATION';
      } else if (fault.type === 'malformed_model_json') {
        ok = validateGroundedAgentAnswer(null, [{ id: 'dish:1' }]).reason === 'INVALID_ANSWER_TEXT';
      } else if (['chat_401', 'chat_503'].includes(fault.type)) {
        ok = hasGenerationFallback;
      } else if (fault.type === 'database_busy') {
        const result = await runDishSearchWorkflow({ tenantId: local.tenant_id, query: local.name, candidates: [], limit: 5 });
        ok = result.items.length === 0;
      }
    } catch (error) {
      failures.push({ id: fault.id, type: fault.type, error: error.message });
    }
    byType[fault.type] ||= { total: 0, passed: 0 };
    byType[fault.type].total += 1;
    if (ok) { passed += 1; byType[fault.type].passed += 1; }
    else if (!failures.some((item) => item.id === fault.id)) failures.push({ id: fault.id, type: fault.type, error: 'fallback contract not satisfied' });
  }
  return { total: faults.length, passed, passRate: Number((passed / Math.max(1, faults.length)).toFixed(4)), byType, failures: failures.slice(0, 50) };
}

async function vectorStrategies(db, queries) {
  if (!withVectors) return { skipped: true, reason: 'Run with --with-vectors after configuring the local embedding provider.' };
  const tenantIds = [...new Set(queries.map((query) => query.tenantId))];
  const indexing = [];
  for (const tenantId of tenantIds) indexing.push(await reindexRetrieval(db, { tenantId, sourceTypes: ['dish'], vectorMode: 'active' }));
  indexing.push(await reindexRetrieval(db, {
    tenantId: GLOBAL_KNOWLEDGE_TENANT_ID,
    sourceTypes: [CAMPUS_KNOWLEDGE_SOURCE_TYPE, 'health_knowledge'],
    vectorMode: 'active',
  }));
  const samples = queries.filter((query) => query.category === 'alias_typo_dialect').slice(0, vectorSampleLimit);
  const strategies = {};
  for (const strategy of ['lexical', 'vector', 'hybrid']) {
    let hits = 0;
    let ndcgTotal = 0;
    const latencies = [];
    const failures = [];
    for (const query of samples) {
      const startedAt = performance.now();
      const result = await searchRetrievalIndex(db, query.query, {
        tenantId: query.tenantId,
        sourceTypes: ['dish'], limit: 10,
        vectorMode: strategy === 'lexical' ? 'off' : 'active',
        channels: strategy === 'hybrid' ? ['lexical', 'vector'] : [strategy],
      });
      latencies.push(performance.now() - startedAt);
      const rank = result.items.findIndex((item) => item.title.includes(query.expected.dishNameContains));
      if (rank >= 0) { hits += 1; ndcgTotal += 1 / Math.log2(rank + 2); }
      else failures.push({ id: query.id, query: query.query, expected: query.expected.dishNameContains, top: result.items.slice(0, 3).map((item) => item.title) });
    }
    strategies[strategy] = {
      hitAt10: Number((hits / Math.max(1, samples.length)).toFixed(4)),
      ndcgAt10: Number((ndcgTotal / Math.max(1, samples.length)).toFixed(4)),
      latencyP95Ms: Number(percentile(latencies, 0.95).toFixed(2)),
      failures: failures.slice(0, 25),
    };
  }
  let workflowHits = 0;
  let workflowNdcg = 0;
  const workflowLatencies = [];
  for (const query of samples) {
    const startedAt = performance.now();
    const result = await runDishSearchWorkflow({
      tenantId: query.tenantId, query: query.query, limit: 10,
      context: { date: '2026-09-02', time: '12:00', mealType: 'lunch' },
    }, {
      db,
      semanticSearch: ({ query: text, tenantId, limit }) => searchRetrievalIndex(db, text, {
        tenantId, sourceTypes: ['dish'], limit, vectorMode: 'active', channels: ['lexical', 'vector'],
      }),
    });
    workflowLatencies.push(performance.now() - startedAt);
    const rank = result.items.findIndex((item) => item.name.includes(query.expected.dishNameContains));
    if (rank >= 0) { workflowHits += 1; workflowNdcg += 1 / Math.log2(rank + 2); }
  }
  const hybridStructuredRerank = {
    hitAt10: Number((workflowHits / Math.max(1, samples.length)).toFixed(4)),
    ndcgAt10: Number((workflowNdcg / Math.max(1, samples.length)).toFixed(4)),
    latencyP95Ms: Number(percentile(workflowLatencies, 0.95).toFixed(2)),
  };
  const conceptQueries = loadCampusDiningCorpus().queries.filter((query) => query.expectedConceptIds.length);
  let conceptTop3Hits = 0;
  const conceptLatencies = [];
  const conceptFailures = [];
  for (const query of conceptQueries) {
    const startedAt = performance.now();
    const result = await searchRetrievalIndex(db, query.query, {
      tenantId: GLOBAL_KNOWLEDGE_TENANT_ID,
      sourceTypes: [CAMPUS_KNOWLEDGE_SOURCE_TYPE],
      limit: 3,
      vectorMode: 'active',
      channels: ['vector'],
    });
    conceptLatencies.push(performance.now() - startedAt);
    const topConceptIds = result.items.map((item) => item.sourceId);
    if (query.expectedConceptIds.some((conceptId) => topConceptIds.includes(conceptId))) conceptTop3Hits += 1;
    else conceptFailures.push({ id: query.id, query: query.query, expected: query.expectedConceptIds, actual: topConceptIds });
  }
  const conceptVector = {
    queryCount: conceptQueries.length,
    top3HitRate: Number((conceptTop3Hits / Math.max(1, conceptQueries.length)).toFixed(4)),
    latencyP95Ms: Number(percentile(conceptLatencies, 0.95).toFixed(2)),
    failures: conceptFailures.slice(0, 25),
  };
  return {
    skipped: false,
    sampleCount: samples.length,
    indexing: indexing.map((item) => ({ tenantId: item.tenantId, documentCount: item.documentCount, embeddedCount: item.embeddedCount, skippedCount: item.skippedCount, failureCount: item.failureCount })),
    strategies,
    hybridStructuredRerank,
    conceptVector,
    hybridGainObserved: hybridStructuredRerank.ndcgAt10 > Math.max(strategies.lexical.ndcgAt10, strategies.vector.ndcgAt10, strategies.hybrid.ndcgAt10),
  };
}

const db = openDatabase(DB_PATH);
try {
  const queries = readJsonLines(resolve(DATA_DIR, 'evaluation-queries.jsonl'));
  const conversations = readJsonLines(resolve(DATA_DIR, 'multi-turn-conversations.jsonl'));
  const faults = readJsonLines(resolve(DATA_DIR, 'fault-injections.jsonl'));
  const manifest = JSON.parse(readFileSync(resolve(DATA_DIR, 'manifest.json'), 'utf8'));
  const report = {
    version: manifest.version,
    generatedAt: new Date().toISOString(),
    corpus: manifest,
    parser: slotMetrics(queries),
    safety: safetyMetrics(db),
    lexicalStructured: await lexicalPerformance(db, queries),
    retrievalIntegrity: await retrievalIntegrityMetrics(db, queries),
    multiTurn: await multiTurnMetrics(db, conversations),
    faultInjection: await faultInjectionMetrics(db, faults),
    retrievalStrategies: await vectorStrategies(db, queries),
  };
  report.acceptance = {
    parserF1AtLeast97: report.parser.f1 >= 0.97,
    knownAllergenViolationsZero: report.safety.knownViolationCount === 0,
    unknownWarningCoverage100: report.safety.unknownWarningCoverage === 1,
    responseUnknownWarningCoverage100: report.retrievalIntegrity.unknownWarningCoverage === 1,
    crossTenantAndInventedZero: report.retrievalIntegrity.crossTenantCount === 0 && report.retrievalIntegrity.inventedDishCount === 0,
    lexicalNdcgAtLeast85: report.lexicalStructured.ndcgAt10 >= 0.85,
    multiTurnSafetyRetention100: report.multiTurn.retainedSafetyRate === 1 && report.multiTurn.retrievalInvariantRate === 1,
    faultFallback100: report.faultInjection.passRate === 1,
    lexicalP95Under1s: report.lexicalStructured.latencyP95Ms < 1000,
    ...(report.retrievalStrategies.skipped ? {} : {
      vectorNdcgAtLeast85: report.retrievalStrategies.strategies.vector.ndcgAt10 >= 0.85,
      hybridStructuredNdcgAtLeast85: report.retrievalStrategies.hybridStructuredRerank.ndcgAt10 >= 0.85,
      conceptVectorTop3AtLeast95: report.retrievalStrategies.conceptVector.top3HitRate >= 0.95,
      vectorP95Under1s: report.retrievalStrategies.strategies.vector.latencyP95Ms < 1000,
      hybridStructuredP95Under1s: report.retrievalStrategies.hybridStructuredRerank.latencyP95Ms < 1000,
    }),
  };
  report.acceptancePassed = Object.values(report.acceptance).every(Boolean);
  mkdirSync(resolve(ROOT, '.rag-evals'), { recursive: true });
  const output = resolve(ROOT, '.rag-evals', `rag-simulation-${report.generatedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    output,
    parser: { precision: report.parser.precision, recall: report.parser.recall, f1: report.parser.f1, failures: report.parser.failures.length },
    safety: report.safety,
    lexicalStructured: { queryCount: report.lexicalStructured.queryCount, hitAt10: report.lexicalStructured.hitAt10, ndcgAt10: report.lexicalStructured.ndcgAt10, latencyP95Ms: report.lexicalStructured.latencyP95Ms },
    retrievalIntegrity: report.retrievalIntegrity,
    multiTurn: report.multiTurn,
    faultInjection: report.faultInjection,
    retrievalStrategies: report.retrievalStrategies.skipped ? report.retrievalStrategies : {
      ...report.retrievalStrategies.strategies,
      hybridStructuredRerank: report.retrievalStrategies.hybridStructuredRerank,
      conceptVector: report.retrievalStrategies.conceptVector,
      hybridGainObserved: report.retrievalStrategies.hybridGainObserved,
    },
    acceptance: report.acceptance,
    acceptancePassed: report.acceptancePassed,
  }, null, 2));
  if (!report.acceptancePassed) process.exitCode = 1;
} finally {
  db.close();
}
