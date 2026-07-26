import { mkdirSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { createHttpServer } from '../server/app.js';
import {
  CAMPUS_KNOWLEDGE_SOURCE_TYPE,
  GLOBAL_KNOWLEDGE_TENANT_ID,
} from '../server/campusDiningKnowledgeBase.js';
import { openDatabase } from '../server/database.js';
import { searchRetrievalIndex } from '../server/retrievalIndex.js';
import {
  mergeDiningConversationState,
  parseDishSearchRequest,
  runDishSearchWorkflow,
} from '../server/retrievalService.js';
import { hashPassword } from '../server/security.js';

const ROOT = resolve(import.meta.dirname, '..');
const DB_PATH = resolve(ROOT, '.rag-simulations', 'v1', 'simulation.sqlite');
const OUTPUT_DIR = resolve(ROOT, '.rag-evals');
const TENANT_ID = 'sim-north-comprehensive';
const CONTEXT = { date: '2026-09-02', time: '12:00', mealType: 'lunch' };

const cases = [
  {
    id: 'complex-safe-lunch',
    query: '午餐20元内，高蛋白、不太辣，我对花生过敏，不要售罄',
    expectedFilters: ['mealType', 'budgetMax', 'minProtein', 'maxSpiceLevel', 'allergens', 'orderableOnly'],
  },
  {
    id: 'allergen-unknown',
    query: '我对花生过敏，想吃低脂午餐，20元以内',
    expectedFilters: ['mealType', 'budgetMax', 'maxFat', 'allergens'],
  },
  {
    id: 'named-dish',
    query: '想吃黑椒牛肉意面，20元以内',
    expectedFilters: ['budgetMax'],
  },
  {
    id: 'conflicting-vegan-beef',
    query: '我是纯素，但想吃牛肉，预算15元',
    expectedFilters: ['budgetMax', 'dietaryPattern', 'includeIngredients'],
    expectConflict: true,
  },
];

const HTTP_SEARCH_QUERY = String(process.env.RAG_TRACE_SEARCH_QUERY || '').trim() || cases[0].query;
const HTTP_RECOMMEND_QUERY = String(process.env.RAG_TRACE_RECOMMEND_QUERY || '').trim()
  || '\u8bad\u7ec3\u540e\u5348\u991025\u5143\u5185\uff0c\u9ad8\u86cb\u767d\u4f4e\u8102\uff0c\u6211\u5bf9\u82b1\u751f\u8fc7\u654f';

function elapsed(startedAt) {
  return Number((performance.now() - startedAt).toFixed(2));
}

function compactRecall(result) {
  return {
    modes: result.meta?.retrievalModes || [],
    degraded: Boolean(result.meta?.degraded),
    degradationReasons: result.meta?.degradationReasons || [],
    embeddingModel: result.meta?.embeddingModel || null,
    vectorDocumentCount: result.meta?.vectorDocumentCount ?? null,
    items: (result.items || []).slice(0, 5).map((item) => ({
      id: item.sourceId,
      title: item.title,
      score: item.score,
      lexicalScore: item.lexicalScore,
      vectorScore: item.vectorScore,
      channels: item.channels,
    })),
  };
}

function compactItem(item) {
  return {
    id: item.id,
    name: item.name,
    tenantId: item.tenantId,
    price: item.availability?.price ?? item.price,
    orderable: item.availability?.orderable,
    availability: item.availability?.status,
    protein: item.nutrition?.protein,
    fat: item.nutrition?.fat,
    spiceLevel: item.spiceLevel,
    safety: item.safety,
    confidence: item.confidence,
    dataQuality: item.dataQuality,
    matchReasons: item.matchReasons,
    retrievalScore: item.retrievalScore,
    retrievalBreakdown: item.retrievalBreakdown,
  };
}

function inspectCase(testCase, interpreted, workflow) {
  const issues = [];
  for (const field of testCase.expectedFilters || []) {
    if (interpreted.filters[field] === undefined) issues.push({ severity: 'error', code: 'EXPECTED_FILTER_MISSING', field });
  }
  if (testCase.expectConflict && !(interpreted.conflicts || []).length) issues.push({ severity: 'error', code: 'EXPECTED_CONFLICT_MISSING' });
  if (interpreted.filters.orderableOnly && workflow.items.some((item) => !item.availability?.orderable)) {
    issues.push({ severity: 'error', code: 'NON_ORDERABLE_RESULT' });
  }
  if (workflow.items.some((item) => item.tenantId !== TENANT_ID)) issues.push({ severity: 'error', code: 'CROSS_TENANT_RESULT' });
  if (workflow.items.some((item) => item.safety?.blocked)) issues.push({ severity: 'error', code: 'BLOCKED_SAFETY_RESULT' });
  const unknownIds = workflow.items.filter((item) => item.safety?.status === 'unknown').map((item) => item.id);
  for (const dishId of unknownIds) {
    if (!workflow.warnings.some((warning) => warning.code === 'ALLERGEN_UNVERIFIED' && warning.dishId === dishId)) {
      issues.push({ severity: 'error', code: 'UNKNOWN_ALLERGEN_WITHOUT_WARNING', dishId });
    }
  }
  if (!testCase.expectConflict && !workflow.meta?.semanticUsed) issues.push({ severity: 'warning', code: 'SEMANTIC_CHANNEL_UNUSED' });
  if (!workflow.items.length) issues.push({ severity: testCase.expectConflict ? 'info' : 'warning', code: 'EMPTY_RESULT' });
  if (workflow.items.some((item) => item.confidence?.level === 'low')) {
    issues.push({ severity: 'info', code: 'LOW_CONFIDENCE_SYNTHETIC_FACTS' });
  }
  return issues;
}

async function traceSearchCase(db, testCase) {
  const steps = [];
  let startedAt = performance.now();
  const parsedRequest = parseDishSearchRequest(testCase.query);
  const interpreted = parsedRequest.interpreted;
  steps.push({
    step: 1,
    name: 'deterministic_query_parse',
    elapsedMs: elapsed(startedAt),
    output: {
      normalizedQuery: interpreted.normalizedQuery,
      filters: interpreted.filters,
      hardConstraints: interpreted.hardConstraints,
      constraints: interpreted.constraints,
      conflicts: interpreted.conflicts,
      pendingConfirmations: interpreted.pendingConfirmations,
    },
  });

  startedAt = performance.now();
  const [lexical, vector, hybrid, concepts] = await Promise.all([
    searchRetrievalIndex(db, testCase.query, { tenantId: TENANT_ID, sourceTypes: ['dish'], limit: 5, vectorMode: 'off', channels: ['lexical'] }),
    searchRetrievalIndex(db, testCase.query, { tenantId: TENANT_ID, sourceTypes: ['dish'], limit: 5, vectorMode: 'active', channels: ['vector'] }),
    searchRetrievalIndex(db, testCase.query, { tenantId: TENANT_ID, sourceTypes: ['dish'], limit: 5, vectorMode: 'active', channels: ['lexical', 'vector'] }),
    searchRetrievalIndex(db, testCase.query, { tenantId: GLOBAL_KNOWLEDGE_TENANT_ID, sourceTypes: [CAMPUS_KNOWLEDGE_SOURCE_TYPE], limit: 3, vectorMode: 'active', channels: ['lexical', 'vector'] }),
  ]);
  steps.push({
    step: 2,
    name: 'parallel_recall',
    elapsedMs: elapsed(startedAt),
    output: {
      lexical: compactRecall(lexical),
      vector: compactRecall(vector),
      hybrid: compactRecall(hybrid),
      globalConcepts: compactRecall(concepts),
    },
  });

  startedAt = performance.now();
  const workflow = await runDishSearchWorkflow({
    tenantId: TENANT_ID,
    query: testCase.query,
    limit: 5,
    context: CONTEXT,
  }, {
    db,
    semanticSearch: ({ query, tenantId, limit }) => searchRetrievalIndex(db, query, {
      tenantId,
      sourceTypes: ['dish'],
      limit,
      vectorMode: 'active',
      channels: ['lexical', 'vector'],
    }),
  });
  steps.push({
    step: 3,
    name: 'sql_hard_filter_and_structured_rerank',
    elapsedMs: elapsed(startedAt),
    output: {
      sourceCandidateCount: workflow.meta.sourceCandidateCount,
      filteredCandidateCount: workflow.meta.filteredCandidateCount,
      rerankedCandidateCount: workflow.meta.rerankedCandidateCount,
      hardConstraintRejections: workflow.meta.hardConstraintRejections,
      availability: workflow.availability,
      semanticUsed: workflow.meta.semanticUsed,
      retrieval: workflow.meta.retrieval,
      degradedReasons: workflow.meta.degradedReasons,
    },
  });
  steps.push({
    step: 4,
    name: 'safety_quality_and_grounding_payload',
    elapsedMs: 0,
    output: {
      warnings: workflow.warnings,
      confidence: workflow.confidence,
      evidenceIds: workflow.items.map((item) => `dish:${item.id}`),
      items: workflow.items.map(compactItem),
    },
  });

  return {
    id: testCase.id,
    tenantId: TENANT_ID,
    request: testCase.query,
    context: CONTEXT,
    steps,
    issues: inspectCase(testCase, interpreted, workflow),
  };
}

async function traceMultiTurn(db) {
  const turns = [
    '午餐20元内，我对花生过敏，想吃清淡的',
    '预算改成25元，可以辣一点，过敏不用管了',
    '那换到运动餐厅看看',
  ];
  let state = {};
  const states = [];
  for (const text of turns) {
    const startedAt = performance.now();
    state = mergeDiningConversationState(state, text);
    states.push({ text, elapsedMs: elapsed(startedAt), filters: state.filters, conflicts: state.conflicts, pendingConfirmations: state.pendingConfirmations });
  }
  const startedAt = performance.now();
  const workflow = await runDishSearchWorkflow({
    tenantId: TENANT_ID,
    query: turns.at(-1),
    filters: state.filters,
    limit: 5,
    context: CONTEXT,
  }, {
    db,
    semanticSearch: ({ query, tenantId, limit }) => searchRetrievalIndex(db, query, {
      tenantId, sourceTypes: ['dish'], limit, vectorMode: 'active', channels: ['lexical', 'vector'],
    }),
  });
  const retained = (state.filters.allergens || []).includes('花生');
  const locationCorrect = workflow.items.every((item) => item.canteenName?.includes('运动餐厅'));
  return {
    id: 'multi-turn-safety-retention',
    tenantId: TENANT_ID,
    turns: states,
    retrievalElapsedMs: elapsed(startedAt),
    finalFilters: workflow.interpreted.filters,
    retainedAllergen: retained,
    locationCorrect,
    results: workflow.items.map((item) => ({ id: item.id, name: item.name, canteenId: item.canteenId, canteenName: item.canteenName })),
    warnings: workflow.warnings,
    issues: [
      ...(!retained ? [{ severity: 'error', code: 'SAFETY_CONSTRAINT_REMOVED' }] : []),
      ...(!locationCorrect ? [{ severity: 'error', code: 'CANTEEN_FILTER_NOT_APPLIED' }] : []),
    ],
  };
}

async function traceTenantAttack(db) {
  const foreign = db.prepare("SELECT id FROM dishes WHERE tenant_id = 'sim-south-comprehensive' LIMIT 1").get();
  const workflow = await runDishSearchWorkflow({ tenantId: TENANT_ID, query: '推荐午餐', limit: 5, context: CONTEXT }, {
    db,
    semanticSearch: async () => ({
      items: [{ sourceId: foreign.id, sourceType: 'dish', score: 1, vectorScore: 1, channels: ['vector'] }],
      meta: { retrievalModes: ['vector'] },
    }),
  });
  const leaked = workflow.items.some((item) => item.id === foreign.id || item.tenantId !== TENANT_ID);
  return {
    id: 'cross-tenant-injected-candidate',
    injectedForeignDishId: foreign.id,
    returnedIds: workflow.items.map((item) => item.id),
    leaked,
    issues: leaked ? [{ severity: 'error', code: 'CROSS_TENANT_RESULT' }] : [],
  };
}

async function readHttpJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function traceHttpApi(db) {
  const userId = 'rag-trace-student';
  const username = 'rag_trace_student';
  const password = 'TraceRag123';
  const timestamp = new Date().toISOString();
  db.prepare('DELETE FROM health_profiles WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  db.prepare(`INSERT INTO users (id, username, password_hash, nickname, role, token_version, created_at, updated_at, tenant_id)
    VALUES (?, ?, ?, ?, 'student', 0, ?, ?, ?)`)
    .run(userId, username, hashPassword(password), 'RAG追踪学生', timestamp, timestamp, TENANT_ID);

  const server = createHttpServer({ db });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    let startedAt = performance.now();
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: username, password }),
    });
    const login = await readHttpJson(loginResponse);
    const loginStep = {
      endpoint: 'POST /api/auth/login', status: loginResponse.status,
      requestId: loginResponse.headers.get('x-request-id'), elapsedMs: elapsed(startedAt),
      authenticated: Boolean(login.token), role: login.user?.role, tenantId: login.user?.tenantId,
      error: login.error || null,
    };
    if (!login.token) {
      return {
        baseUrl: 'ephemeral-local-server', login: loginStep, search: null, recommend: null,
        issues: [{ severity: 'error', code: 'HTTP_LOGIN_FAILED' }],
      };
    }
    const authorization = { authorization: `Bearer ${login.token}`, 'content-type': 'application/json' };

    startedAt = performance.now();
    const searchResponse = await fetch(`${baseUrl}/api/dishes/search`, {
      method: 'POST', headers: authorization,
      body: JSON.stringify({ query: HTTP_SEARCH_QUERY, limit: 3, context: CONTEXT }),
    });
    const search = await readHttpJson(searchResponse);
    const searchStep = {
      endpoint: 'POST /api/dishes/search', status: searchResponse.status,
      query: HTTP_SEARCH_QUERY,
      requestId: searchResponse.headers.get('x-request-id'), elapsedMs: elapsed(startedAt),
      interpreted: search.interpreted,
      items: (search.items || []).map(compactItem), warnings: search.warnings,
      meta: search.meta,
    };

    startedAt = performance.now();
    const recommendResponse = await fetch(`${baseUrl}/api/recommend`, {
      method: 'POST', headers: authorization,
      body: JSON.stringify({ query: HTTP_RECOMMEND_QUERY, limit: 3, context: CONTEXT }),
    });
    const recommendation = await readHttpJson(recommendResponse);
    const recommendStep = {
      endpoint: 'POST /api/recommend', status: recommendResponse.status,
      query: HTTP_RECOMMEND_QUERY,
      requestId: recommendResponse.headers.get('x-request-id'), elapsedMs: elapsed(startedAt),
      error: recommendation.error || null,
      code: recommendation.code || null,
      interpreted: recommendation.meta?.interpreted,
      recommendations: (recommendation.recommendations || []).map(compactItem),
      evidence: recommendation.evidence,
      warnings: recommendation.warnings,
      meta: recommendation.meta,
    };
    const issues = [];
    if (loginResponse.status !== 200 || !login.token) issues.push({ severity: 'error', code: 'HTTP_LOGIN_FAILED' });
    if (searchResponse.status !== 200) issues.push({ severity: 'error', code: 'HTTP_SEARCH_FAILED' });
    if (recommendResponse.status !== 200) issues.push({ severity: 'error', code: 'HTTP_RECOMMEND_FAILED' });
    if ((search.items || []).some((item) => item.tenantId !== TENANT_ID)) issues.push({ severity: 'error', code: 'HTTP_CROSS_TENANT_RESULT' });
    return { baseUrl: 'ephemeral-local-server', login: loginStep, search: searchStep, recommend: recommendStep, issues };
  } finally {
    server.close();
    await once(server, 'close');
    db.prepare('DELETE FROM health_profiles WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }
}

const db = openDatabase(DB_PATH);
try {
  const startedAt = performance.now();
  const tracedCases = [];
  for (const testCase of cases) tracedCases.push(await traceSearchCase(db, testCase));
  const multiTurn = await traceMultiTurn(db);
  const tenantAttack = await traceTenantAttack(db);
  const httpApi = await traceHttpApi(db);
  const report = {
    generatedAt: new Date().toISOString(),
    database: DB_PATH,
    synthetic: true,
    embedding: {
      baseUrl: process.env.AI_EMBEDDING_BASE_URL || null,
      model: process.env.AI_EMBEDDING_MODEL || null,
      dimension: Number(process.env.AI_EMBEDDING_DIMENSION || 0) || null,
      vectorMode: process.env.RETRIEVAL_VECTOR_MODE || 'off',
    },
    cases: tracedCases,
    multiTurn,
    tenantAttack,
    httpApi,
    summary: {
      caseCount: tracedCases.length + 3,
      errorCount: [...tracedCases.flatMap((item) => item.issues), ...multiTurn.issues, ...tenantAttack.issues, ...httpApi.issues].filter((item) => item.severity === 'error').length,
      warningCount: tracedCases.flatMap((item) => item.issues).filter((item) => item.severity === 'warning').length,
      totalElapsedMs: elapsed(startedAt),
    },
  };
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const output = resolve(OUTPUT_DIR, `rag-request-trace-${report.generatedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output, summary: report.summary, cases: report.cases.map((item) => ({ id: item.id, issues: item.issues })), multiTurn: { retainedAllergen: multiTurn.retainedAllergen, locationCorrect: multiTurn.locationCorrect, issues: multiTurn.issues }, tenantAttack: { leaked: tenantAttack.leaked, issues: tenantAttack.issues }, httpApi: { login: httpApi.login?.status, search: httpApi.search?.status, recommend: httpApi.recommend?.status, issues: httpApi.issues } }, null, 2));
  if (report.summary.errorCount) process.exitCode = 1;
} finally {
  db.close();
}
