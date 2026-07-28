#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DATA_ROOT = resolve(ROOT, 'data');

function parseArguments(argv) {
  const options = {
    databasePath: resolve(DATA_ROOT, 'real-catalog-campus-2026-07-27-v2.sqlite'),
    outputPath: resolve(ROOT, '.rag-evals/grounded-answers/baseline-qwen06.json'),
    label: 'baseline-qwen06',
    model: process.env.AI_EMBEDDING_MODEL || 'qwen3-embedding:0.6b',
    dimension: Number(process.env.AI_EMBEDDING_DIMENSION || 1024),
    vectorMode: process.env.RETRIEVAL_VECTOR_MODE || 'active',
    runChat: false,
    checkpointEvery: 5,
    resume: false,
    retryBlockedChat: false,
    chatRepair: true,
    limit: null,
  };
  for (const argument of argv) {
    if (argument.startsWith('--database=')) options.databasePath = resolve(argument.slice(11));
    else if (argument.startsWith('--output=')) options.outputPath = resolve(argument.slice(9));
    else if (argument.startsWith('--label=')) options.label = argument.slice(8).trim();
    else if (argument.startsWith('--model=')) options.model = argument.slice(8).trim();
    else if (argument.startsWith('--dimension=')) options.dimension = Number(argument.slice(12));
    else if (argument.startsWith('--vector-mode=')) options.vectorMode = argument.slice(14).trim();
    else if (argument.startsWith('--checkpoint-every=')) options.checkpointEvery = Math.max(1, Number(argument.slice(19)) || 5);
    else if (argument.startsWith('--limit=')) options.limit = Math.max(1, Number(argument.slice(8)) || 1);
    else if (argument === '--run-chat') options.runChat = true;
    else if (argument === '--resume') options.resume = true;
    else if (argument === '--retry-blocked-chat') options.retryBlockedChat = true;
    else if (argument === '--no-chat-repair') options.chatRepair = false;
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function safeExperimentDatabase(path) {
  const absolute = resolve(path);
  const child = relative(DATA_ROOT, absolute);
  if (!child || child.startsWith('..') || child.includes(':') || !absolute.toLowerCase().endsWith('.sqlite')) {
    throw new Error(`Grounded answer evaluation database must stay under ${DATA_ROOT}: ${absolute}`);
  }
  if (absolute.toLowerCase() === resolve(DATA_ROOT, 'smart-canteen.sqlite').toLowerCase()) {
    throw new Error('Runtime database cannot be used for grounded answer evaluation');
  }
  if (!existsSync(absolute)) throw new Error(`Grounded answer evaluation database does not exist: ${absolute}`);
  return absolute;
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return Number((sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] || 0).toFixed(2));
}

function mean(values) {
  return Number((values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)).toFixed(4));
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function scopeAllowed(item, tenantId) {
  if (['dish', 'stall', 'campus_policy'].includes(item.sourceType)) return item.tenantId === tenantId;
  return item.tenantId === '__global__';
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  console.log(`Usage: node scripts/evaluate-grounded-agent-answers.mjs [options]

  --database=<sqlite>       Isolated catalog index (runtime DB is rejected)
  --model=<id>              Embedding model used by the index
  --dimension=<n>           Embedding dimension
  --vector-mode=active|off  Retrieval mode
  --label=<name>            Experiment label
  --output=<json>           Ignored detailed report path
  --run-chat                Call the configured AI_CHAT provider; otherwise only retrieval and fallback contracts run
  --checkpoint-every=N      Save partial progress every N questions (default: 5)
  --limit=N                 Run only the first N frozen questions for local diagnostics
  --resume                  Continue a compatible partial report
  --retry-blocked-chat      With --resume, retry provider_failed and evidence-backed blocked rows
  --no-chat-repair          Measure first-pass prompt output without the one allowed repair`);
  process.exit(0);
}

options.databasePath = safeExperimentDatabase(options.databasePath);
process.env.ENABLE_DEMO_SEED = '0';
process.env.DB_DRIVER = 'sqlite';
process.env.SMART_CANTEEN_DB = options.databasePath;
process.env.AI_EMBEDDING_BASE_URL ||= 'http://127.0.0.1:11434/v1';
process.env.AI_EMBEDDING_MODEL = options.model;
process.env.AI_EMBEDDING_DIMENSION = String(options.dimension);
process.env.AI_EMBEDDING_TIMEOUT_MS ||= '180000';
process.env.RETRIEVAL_VECTOR_MODE = options.vectorMode;

const [
  { createDatabase },
  { generateGroundedAgentAnswer, getAiProviderStatus, groundingEvidenceClasses, validateGroundedAgentAnswer },
  { loadFoodCompositionReferences },
  { searchRetrievalIndex },
  { matchFoodCompositionReferencesForQuery, retrieveRoutedKnowledge },
  { buildGroundedAnswerEvaluationCases, deterministicGroundedFallback },
] = await Promise.all([
  import('../server/database.js'),
  import('../server/aiProvider.js'),
  import('../server/healthKnowledgeBase.js'),
  import('../server/retrievalIndex.js'),
  import('../server/retrievalService.js'),
  import('./lib/grounded-answer-evaluation.mjs'),
]);

function toCitation(item) {
  const metadata = { ...(item.metadata || {}) };
  const declarations = Array.isArray(metadata.safetyDeclarations) ? metadata.safetyDeclarations : [];
  if (!metadata.safetyStatus && declarations.some((entry) => entry?.status === 'unknown')) metadata.safetyStatus = 'unknown';
  if (item.sourceType === 'dish') {
    metadata.nutritionFactStatus ||= metadata.factStatus?.nutrition || 'unknown';
    metadata.availabilityStatus ||= 'catalog_only';
    if (metadata.supplyConfirmed == null) metadata.supplyConfirmed = metadata.availabilityStatus !== 'catalog_only';
  }
  const citation = {
    id: String(item.id || `${item.sourceType}:${item.sourceId}`),
    sourceId: String(item.sourceId || item.id),
    sourceType: String(item.sourceType || 'knowledge'),
    tenantId: String(item.tenantId || metadata.tenantId || '__global__'),
    evidenceType: item.evidenceType || metadata.evidenceType || null,
    title: String(item.title || item.name || ''),
    snippet: String(item.snippet || item.content || '').slice(0, 500),
    metadata,
  };
  citation.evidenceClasses = groundingEvidenceClasses(citation);
  return citation;
}

async function catalogDishes(db) {
  return db.prepare(`SELECT d.id, d.name, d.pricing_mode AS pricingMode, d.price_display AS priceDisplay,
      d.stall_id AS stallId, s.name AS stallName, s.canteen_id AS canteenId,
      c.name AS canteenName, c.parent_id AS parentCanteenId, parent.name AS parentCanteenName
    FROM dishes d
    JOIN stalls s ON s.id = d.stall_id AND s.tenant_id = d.tenant_id
    JOIN canteens c ON c.id = s.canteen_id AND c.tenant_id = d.tenant_id
    LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = d.tenant_id
    WHERE d.tenant_id = 'default' AND d.status = 'active'
    ORDER BY c.id, d.pricing_mode, s.id, d.name, d.id`).all();
}

async function evidenceForCase(db, evaluation, references) {
  if (evaluation.forceEmptyEvidence) return { citations: [], traces: { catalog: null, knowledge: null } };
  let catalog = null;
  let knowledge = null;
  if (evaluation.includeCatalog) {
    catalog = await searchRetrievalIndex(db, evaluation.query, {
      tenantId: evaluation.tenantId,
      sourceTypes: ['dish', 'stall'],
      limit: 7,
      vectorMode: options.vectorMode,
    });
  }
  if (evaluation.includeKnowledge) {
    knowledge = await retrieveRoutedKnowledge({ query: evaluation.query, tenantId: evaluation.tenantId, limit: 5 }, {
      knowledgeSearch: ({ query, tenantId, limit, sourceTypes }) => {
        const globalOnly = sourceTypes.every((sourceType) => ['health_knowledge', 'campus_dining_knowledge'].includes(sourceType));
        return searchRetrievalIndex(db, query, {
          tenantId: globalOnly ? '__global__' : tenantId,
          sourceTypes,
          limit,
          vectorMode: options.vectorMode,
        });
      },
      foodCompositionLookup: ({ query, limit }) => matchFoodCompositionReferencesForQuery(query, references, limit),
    });
  }
  const citations = uniqueById([
    ...(catalog?.items || []).map(toCitation),
    ...(knowledge?.results || []).map(toCitation),
  ]).slice(0, 12);
  return {
    citations,
    traces: {
      catalog: catalog?.meta?.trace || null,
      catalogWarnings: catalog?.warnings || [],
      knowledge: knowledge?.trace || null,
      knowledgeDegradedReasons: knowledge?.degradedReasons || [],
    },
  };
}

const db = await createDatabase();
try {
  const references = loadFoodCompositionReferences();
  const frozenEvaluations = buildGroundedAnswerEvaluationCases({ dishes: await catalogDishes(db), references });
  const evaluations = options.limit ? frozenEvaluations.slice(0, options.limit) : frozenEvaluations;
  const provider = getAiProviderStatus();
  let chatOperational = Boolean(options.runChat && provider.chat.enabled);
  let chatBlocker = options.runChat
    ? (provider.chat.enabled ? null : 'AI_CHAT_PROVIDER_NOT_CONFIGURED')
    : 'CHAT_EVALUATION_NOT_REQUESTED';
  let rows = [];
  if (options.resume) {
    try {
      const existing = JSON.parse(readFileSync(options.outputPath, 'utf8'));
      const compatible = existing.databasePath === options.databasePath
        && existing.embedding?.model === options.model
        && Number(existing.embedding?.dimension) === options.dimension
        && existing.embedding?.vectorMode === options.vectorMode
        && Boolean(existing.chat?.requested) === options.runChat
        && Boolean(existing.chat?.repairEnabled ?? true) === options.chatRepair
        && (!options.runChat || existing.chat?.model === provider.chat.model);
      if (compatible && Array.isArray(existing.rows)) {
        rows = options.retryBlockedChat
          ? existing.rows.filter((item) => item.generation?.status !== 'provider_failed'
            && !(item.generation?.status === 'blocked' && item.citations?.length))
          : existing.rows;
      }
    } catch {}
  }
  const writeCheckpoint = () => {
    mkdirSync(dirname(options.outputPath), { recursive: true });
    writeFileSync(options.outputPath, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      status: 'partial',
      label: options.label,
      databasePath: options.databasePath,
      embedding: { model: options.model, dimension: options.dimension, vectorMode: options.vectorMode },
      chat: { requested: options.runChat, configured: provider.chat.enabled, model: provider.chat.model, repairEnabled: options.chatRepair, blocker: chatBlocker },
      processedCount: rows.length,
      queryCount: evaluations.length,
      rows,
    }, null, 2)}\n`, 'utf8');
  };
  const completedIds = new Set(rows.map((item) => item.id));

  for (const evaluation of evaluations) {
    if (completedIds.has(evaluation.id)) continue;
    const startedAt = performance.now();
    const evidenceStartedAt = performance.now();
    const { citations, traces } = await evidenceForCase(db, evaluation, references);
    const retrievalLatencyMs = Number((performance.now() - evidenceStartedAt).toFixed(2));
    const returnedSourceIds = new Set(citations.map((item) => item.sourceId));
    const returnedSourceTypes = new Set(citations.map((item) => item.sourceType));
    const evidenceClasses = new Set(citations.flatMap((item) => item.evidenceClasses));
    const deterministicAnswer = deterministicGroundedFallback(evaluation, citations);
    let generation = {
      status: citations.length ? 'blocked' : 'deterministic_empty',
      answer: deterministicAnswer,
      answerSource: 'deterministic',
      citationIds: citations.map((item) => item.id),
      evidenceClasses: [...evidenceClasses],
      model: null,
      reason: citations.length ? chatBlocker : 'NO_EVIDENCE',
      latencyMs: 0,
    };

    if (chatOperational && citations.length) {
      const generationStartedAt = performance.now();
      try {
        const generated = await generateGroundedAgentAnswer({
          query: evaluation.query,
          intent: evaluation.intent,
          deterministicAnswer,
          citations,
          hardConstraints: evaluation.hardConstraints,
          allowRepair: options.chatRepair,
          includeRejectedOutput: true,
        });
        generation = generated.answer ? {
          status: 'completed',
          answer: generated.answer,
          answerSource: generated.repairAccepted ? 'llm_grounded_repaired' : 'llm_grounded',
          citationIds: generated.citationIds,
          evidenceClasses: generated.evidenceClasses || [],
          model: generated.model || provider.chat.model,
          reason: null,
          firstPassAccepted: generated.firstPassAccepted,
          repairAttempted: generated.repairAttempted,
          repairAccepted: generated.repairAccepted,
          initialFailureReason: generated.initialFailureReason,
          finalFailureReason: generated.finalFailureReason,
          promptVersion: generated.promptVersion,
          firstPassLatencyMs: generated.firstPassLatencyMs,
          repairLatencyMs: generated.repairLatencyMs,
          rejectedOutput: generated.rejectedOutput,
          repairRejectedOutput: generated.repairRejectedOutput,
          rejectedFinishReason: generated.rejectedFinishReason,
          repairRejectedFinishReason: generated.repairRejectedFinishReason,
          latencyMs: Number((performance.now() - generationStartedAt).toFixed(2)),
        } : {
          ...generation,
          status: 'fallback',
          reason: generated.reason || 'MODEL_OUTPUT_REJECTED',
          firstPassAccepted: generated.firstPassAccepted,
          repairAttempted: generated.repairAttempted,
          repairAccepted: generated.repairAccepted,
          initialFailureReason: generated.initialFailureReason,
          finalFailureReason: generated.finalFailureReason,
          promptVersion: generated.promptVersion,
          firstPassLatencyMs: generated.firstPassLatencyMs,
          repairLatencyMs: generated.repairLatencyMs,
          rejectedOutput: generated.rejectedOutput,
          repairRejectedOutput: generated.repairRejectedOutput,
          rejectedFinishReason: generated.rejectedFinishReason,
          repairRejectedFinishReason: generated.repairRejectedFinishReason,
          latencyMs: Number((performance.now() - generationStartedAt).toFixed(2)),
        };
      } catch (error) {
        chatOperational = false;
        chatBlocker = error.code || error.message || 'CHAT_PROVIDER_FAILED';
        generation = {
          ...generation,
          status: 'provider_failed',
          reason: chatBlocker,
          latencyMs: Number((performance.now() - generationStartedAt).toFixed(2)),
        };
      }
    }

    const validation = validateGroundedAgentAnswer({
      answer: generation.answer,
      citationIds: generation.citationIds,
    }, citations, { allowedNumberSources: [evaluation.query, evaluation.hardConstraints] });
    const checks = {
      expectedSources: evaluation.expectedSourceIds.every((id) => returnedSourceIds.has(id)),
      evidenceClasses: evaluation.requiredEvidenceClasses.every((item) => evidenceClasses.has(item)),
      forbiddenSources: evaluation.forbiddenSourceTypes.every((item) => !returnedSourceTypes.has(item)),
      tenantScope: citations.every((item) => scopeAllowed(item, evaluation.tenantId)),
      emptyBehavior: !evaluation.forceEmptyEvidence || citations.length === 0,
      groundedOutput: validation.valid,
    };
    rows.push({
      id: evaluation.id,
      round: evaluation.round,
      category: evaluation.category,
      query: evaluation.query,
      expectedSourceIds: evaluation.expectedSourceIds,
      requiredEvidenceClasses: evaluation.requiredEvidenceClasses,
      citations: citations.map((item) => ({
        id: item.id,
        sourceId: item.sourceId,
        sourceType: item.sourceType,
        tenantId: item.tenantId,
        evidenceClasses: item.evidenceClasses,
        title: item.title,
      })),
      evidenceClasses: [...evidenceClasses],
      checks,
      passed: Object.values(checks).every(Boolean),
      validation,
      generation,
      traces,
      retrievalLatencyMs,
      totalLatencyMs: Number((performance.now() - startedAt).toFixed(2)),
    });
    if (rows.length % options.checkpointEvery === 0 && rows.length < evaluations.length) writeCheckpoint();
  }

  const attempted = rows.filter((item) => ['completed', 'fallback', 'provider_failed'].includes(item.generation.status));
  const completed = rows.filter((item) => item.generation.status === 'completed');
  const fallbacks = rows.filter((item) => item.generation.status === 'fallback');
  const providerFailures = rows.filter((item) => item.generation.status === 'provider_failed'
    || (item.generation.status === 'blocked' && item.citations.length));
  const chatResponses = rows.filter((item) => ['completed', 'fallback'].includes(item.generation.status));
  const firstPassAccepted = chatResponses.filter((item) => item.generation.firstPassAccepted);
  const repairAttempted = chatResponses.filter((item) => item.generation.repairAttempted);
  const repairAccepted = chatResponses.filter((item) => item.generation.repairAccepted);
  const summary = {
    queryCount: rows.length,
    rounds: Object.fromEntries([...new Set(rows.map((item) => item.round))].map((round) => {
      const selected = rows.filter((item) => item.round === round);
      return [round, { count: selected.length, passed: selected.filter((item) => item.passed).length }];
    })),
    retrievalContractPassed: rows.filter((item) => item.passed).length,
    retrievalContractPassRate: mean(rows.map((item) => item.passed ? 1 : 0)),
    sourceScopeAccuracy: mean(rows.map((item) => item.checks.tenantScope && item.checks.forbiddenSources ? 1 : 0)),
    groundedValidationRate: mean(rows.map((item) => item.checks.groundedOutput ? 1 : 0)),
    chatAttempted: attempted.length,
    chatCompleted: completed.length,
    chatFallbacks: fallbacks.length,
    chatProviderFailures: providerFailures.length,
    chatAcceptedRate: mean(attempted.map((item) => item.generation.status === 'completed' ? 1 : 0)),
    firstPassEligible: chatResponses.length,
    firstPassAccepted: firstPassAccepted.length,
    firstPassAcceptedRate: mean(chatResponses.map((item) => item.generation.firstPassAccepted ? 1 : 0)),
    repairAttempted: repairAttempted.length,
    repairAccepted: repairAccepted.length,
    repairAcceptedRate: mean(repairAttempted.map((item) => item.generation.repairAccepted ? 1 : 0)),
    finalModelAccepted: completed.length,
    finalModelAcceptedRate: mean(chatResponses.map((item) => item.generation.status === 'completed' ? 1 : 0)),
    deterministicFallbacks: fallbacks.length + rows.filter((item) => item.generation.status === 'deterministic_empty').length,
    retrievalLatencyP50Ms: percentile(rows.map((item) => item.retrievalLatencyMs), 0.5),
    retrievalLatencyP95Ms: percentile(rows.map((item) => item.retrievalLatencyMs), 0.95),
    chatLatencyP95Ms: percentile(completed.map((item) => item.generation.latencyMs), 0.95),
    firstPassLatencyP95Ms: percentile(chatResponses.map((item) => item.generation.firstPassLatencyMs || 0), 0.95),
    repairPathLatencyP95Ms: percentile(repairAttempted.map((item) => item.generation.latencyMs), 0.95),
  };
  const status = options.runChat
    ? (!provider.chat.enabled || providerFailures.length
      ? 'blocked_chat_provider'
      : (fallbacks.length ? 'completed_with_safety_fallbacks' : 'completed'))
    : 'retrieval_and_fallback_completed_chat_not_run';
  const report = {
    generatedAt: new Date().toISOString(),
    status,
    label: options.label,
    databasePath: options.databasePath,
    embedding: { model: options.model, dimension: options.dimension, vectorMode: options.vectorMode },
    chat: {
      requested: options.runChat,
      configured: provider.chat.enabled,
      model: provider.chat.model,
      source: provider.chat.source,
      repairEnabled: options.chatRepair,
      blocker: status === 'blocked_chat_provider' ? chatBlocker : null,
    },
    summary,
    rows,
  };
  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputPath: options.outputPath, status, chat: report.chat, summary }, null, 2));
} finally {
  await db.close();
}
