import { AsyncLocalStorage } from 'node:async_hooks';
import { DISH_AI_ANNOTATION_BATCH_JSON_SCHEMA } from './dishAiAnnotations.js';

const runtimeConfig = {
  apiKey: '',
  baseUrl: '',
  chatApiKey: '',
  chatBaseUrl: '',
  chatTimeoutMs: 0,
  embeddingApiKey: '',
  embeddingBaseUrl: '',
  embeddingDimension: 0,
  embeddingTimeoutMs: 0,
  embeddingBatchSize: 0,
  vectorMode: '',
  embeddingModel: '',
  chatModel: '',
  visionModel: '',
  timeoutMs: 0
};
const aiRuntimeContext = new AsyncLocalStorage();

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_OPENAI_CHAT_MODEL = 'gpt-4o-mini';
const DEFAULT_OPENAI_VISION_MODEL = 'gpt-4o-mini';
const DEFAULT_OPENAI_EMBEDDING_DIMENSION = 1024;
const DEFAULT_EMBEDDING_BATCH_SIZE = 24;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_ROUTING_TIMEOUT_MS = 3_000;
const GROUNDED_ANSWER_PROMPT_VERSION = 'grounded-answer-v2';
const VECTOR_MODES = new Set(['off', 'shadow', 'active']);
const VISION_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_VISION_IMAGE_BYTES = 5 * 1024 * 1024;

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

function normalizedBaseUrl(value, fallback = '') {
  return String(value || fallback || '').trim().replace(/\/$/, '');
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizedVectorMode(value, fallback = 'off') {
  const mode = String(value || '').trim().toLowerCase();
  return VECTOR_MODES.has(mode) ? mode : fallback;
}

function isLoopbackUrl(value) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  } catch {
    return false;
  }
}

function normalizedRuntimeConfig(settings = {}) {
  return {
    apiKey: String(settings.apiKey || '').trim(),
    baseUrl: String(settings.baseUrl || '').trim(),
    chatApiKey: String(settings.chatApiKey || '').trim(),
    chatBaseUrl: String(settings.chatBaseUrl || '').trim(),
    chatTimeoutMs: Number(settings.chatTimeoutMs || 0) || 0,
    embeddingApiKey: String(settings.embeddingApiKey || '').trim(),
    embeddingBaseUrl: String(settings.embeddingBaseUrl || '').trim(),
    embeddingDimension: Number(settings.embeddingDimension || 0) || 0,
    embeddingTimeoutMs: Number(settings.embeddingTimeoutMs || 0) || 0,
    embeddingBatchSize: Number(settings.embeddingBatchSize || 0) || 0,
    vectorMode: String(settings.vectorMode || '').trim(),
    embeddingModel: String(settings.embeddingModel || '').trim(),
    chatModel: String(settings.chatModel || '').trim(),
    visionModel: String(settings.visionModel || '').trim(),
    timeoutMs: Number(settings.timeoutMs || 0) || 0,
  };
}

function activeRuntimeConfig(settings) {
  return settings === undefined
    ? (aiRuntimeContext.getStore() || runtimeConfig)
    : normalizedRuntimeConfig(settings);
}

function activeChatCircuit() {
  return aiRuntimeContext.getStore()?.chatCircuit || null;
}

function providerFailureCode(error) {
  if (error?.name === 'AbortError' || error?.code === 20) return 'AI_PROVIDER_TIMEOUT';
  if (typeof error?.code === 'string' && error.code.trim()) return error.code.trim();
  return String(error?.message || 'CHAT_PROVIDER_FAILED').slice(0, 240);
}

function openChatCircuit(error) {
  const circuit = activeChatCircuit();
  if (!circuit || circuit.open) return;
  circuit.open = true;
  circuit.reason = providerFailureCode(error);
  circuit.openedAt = Date.now();
}

function chatCircuitReason() {
  const circuit = activeChatCircuit();
  return circuit?.open ? circuit.reason || 'CHAT_PROVIDER_CIRCUIT_OPEN' : null;
}

function chatProviderConfig(settings) {
  const activeConfig = settings === undefined
    ? (aiRuntimeContext.getStore() || runtimeConfig)
    : normalizedRuntimeConfig(settings);
  const apiKey = activeConfig.chatApiKey
    || activeConfig.apiKey
    || env('AI_CHAT_API_KEY')
    || env('AI_API_KEY')
    || env('OPENAI_API_KEY');
  const adminConfigured = Boolean(activeConfig.chatApiKey || activeConfig.apiKey);
  return {
    providerType: 'chat',
    enabled: Boolean(apiKey),
    source: adminConfigured ? 'admin' : (apiKey ? 'env' : 'none'),
    apiKey,
    baseUrl: normalizedBaseUrl(
      activeConfig.chatBaseUrl
        || activeConfig.baseUrl
        || env('AI_CHAT_BASE_URL')
        || env('AI_BASE_URL')
        || env('OPENAI_BASE_URL'),
      DEFAULT_OPENAI_BASE_URL,
    ),
    chatModel: activeConfig.chatModel || env('AI_CHAT_MODEL', env('OPENAI_CHAT_MODEL', DEFAULT_OPENAI_CHAT_MODEL)),
    visionModel: activeConfig.visionModel || env('AI_VISION_MODEL', env('OPENAI_VISION_MODEL', activeConfig.chatModel || env('AI_CHAT_MODEL', env('OPENAI_CHAT_MODEL', DEFAULT_OPENAI_VISION_MODEL)))),
    timeoutMs: Number(activeConfig.chatTimeoutMs || activeConfig.timeoutMs || env('AI_CHAT_TIMEOUT_MS') || env('AI_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)) || DEFAULT_TIMEOUT_MS
  };
}

function embeddingProviderConfig(settings) {
  const activeConfig = activeRuntimeConfig(settings);
  const hasRuntimeEmbeddingProvider = Boolean(activeConfig.embeddingBaseUrl || activeConfig.embeddingApiKey || activeConfig.embeddingDimension || activeConfig.vectorMode);
  const hasEnvEmbeddingProvider = Boolean(env('AI_EMBEDDING_BASE_URL') || env('AI_EMBEDDING_API_KEY') || env('AI_EMBEDDING_DIMENSION') || env('RETRIEVAL_VECTOR_MODE'));
  const useDedicatedProvider = hasRuntimeEmbeddingProvider || hasEnvEmbeddingProvider;
  const apiKey = hasRuntimeEmbeddingProvider
    ? activeConfig.embeddingApiKey
    : hasEnvEmbeddingProvider
      ? env('AI_EMBEDDING_API_KEY')
      : activeConfig.apiKey || env('AI_API_KEY') || env('OPENAI_API_KEY');
  const baseUrl = normalizedBaseUrl(
    hasRuntimeEmbeddingProvider
      ? activeConfig.embeddingBaseUrl
      : hasEnvEmbeddingProvider
        ? env('AI_EMBEDDING_BASE_URL')
        : activeConfig.baseUrl || env('AI_BASE_URL') || env('OPENAI_BASE_URL'),
    useDedicatedProvider ? '' : DEFAULT_OPENAI_BASE_URL,
  );
  const model = hasRuntimeEmbeddingProvider
    ? activeConfig.embeddingModel
    : hasEnvEmbeddingProvider
      ? env('AI_EMBEDDING_MODEL', DEFAULT_OPENAI_EMBEDDING_MODEL)
      : activeConfig.embeddingModel || env('AI_EMBEDDING_MODEL', env('OPENAI_EMBEDDING_MODEL', DEFAULT_OPENAI_EMBEDDING_MODEL));
  const defaultMode = process.env.NODE_ENV === 'production' ? 'off' : (hasRuntimeEmbeddingProvider || hasEnvEmbeddingProvider ? 'shadow' : 'off');
  const vectorMode = normalizedVectorMode(
    activeConfig.vectorMode || env('RETRIEVAL_VECTOR_MODE'),
    defaultMode,
  );
  const source = hasRuntimeEmbeddingProvider ? 'runtime' : hasEnvEmbeddingProvider ? 'env' : (apiKey ? (activeConfig.apiKey ? 'admin' : 'env') : 'none');
  const authOptional = isLoopbackUrl(baseUrl);
  return {
    providerType: 'embedding',
    enabled: vectorMode !== 'off' && Boolean(baseUrl && model && (apiKey || authOptional)),
    source,
    apiKey,
    baseUrl,
    model,
    dimension: positiveInteger(activeConfig.embeddingDimension || env('AI_EMBEDDING_DIMENSION'), DEFAULT_OPENAI_EMBEDDING_DIMENSION),
    timeoutMs: Number(activeConfig.embeddingTimeoutMs || env('AI_EMBEDDING_TIMEOUT_MS') || activeConfig.timeoutMs || env('AI_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)) || DEFAULT_TIMEOUT_MS,
    batchSize: positiveInteger(activeConfig.embeddingBatchSize || env('AI_EMBEDDING_BATCH_SIZE'), DEFAULT_EMBEDDING_BATCH_SIZE),
    vectorMode,
    hasApiKey: Boolean(apiKey),
  };
}

function providerConfig(settings) {
  const chat = chatProviderConfig(settings);
  const embedding = embeddingProviderConfig(settings);
  return {
    ...chat,
    embeddingModel: embedding.model,
    embeddingDimension: embedding.dimension,
    vectorMode: embedding.vectorMode,
  };
}

export function setAiRuntimeConfig(settings = {}) {
  Object.assign(runtimeConfig, normalizedRuntimeConfig(settings));
}

export function withAiRuntimeConfig(settings, operation) {
  return aiRuntimeContext.run({
    ...normalizedRuntimeConfig(settings),
    chatCircuit: { open: false, reason: null, openedAt: null },
  }, operation);
}

export function getAiProviderStatus(settings) {
  const chat = chatProviderConfig(settings);
  const embedding = embeddingProviderConfig(settings);
  return {
    enabled: chat.enabled,
    source: chat.source,
    baseUrl: chat.baseUrl,
    embeddingModel: embedding.model,
    embeddingDimension: embedding.dimension,
    vectorMode: embedding.vectorMode,
    chatModel: chat.chatModel,
    visionModel: chat.visionModel,
    timeoutMs: chat.timeoutMs,
    hasApiKey: Boolean(chat.apiKey),
    chat: {
      enabled: chat.enabled,
      source: chat.source,
      baseUrl: chat.baseUrl,
      model: chat.chatModel,
      visionModel: chat.visionModel,
      timeoutMs: chat.timeoutMs,
      hasApiKey: Boolean(chat.apiKey),
      circuitOpen: Boolean(chatCircuitReason()),
    },
    embedding: {
      enabled: embedding.enabled,
      source: embedding.source,
      baseUrl: embedding.baseUrl,
      model: embedding.model,
      dimension: embedding.dimension,
      timeoutMs: embedding.timeoutMs,
      batchSize: embedding.batchSize,
      vectorMode: embedding.vectorMode,
      hasApiKey: embedding.hasApiKey,
    },
  };
}

function configFromSettings(settings = {}) {
  const fallback = providerConfig();
  const apiKey = String(settings.apiKey || '').trim() || fallback.apiKey;
  return {
    enabled: Boolean(apiKey),
    source: settings.apiKey ? 'test' : fallback.source,
    apiKey,
    baseUrl: String(settings.baseUrl || fallback.baseUrl || DEFAULT_OPENAI_BASE_URL).trim().replace(/\/$/, ''),
    embeddingModel: String(settings.embeddingModel || fallback.embeddingModel || DEFAULT_OPENAI_EMBEDDING_MODEL).trim(),
    chatModel: String(settings.chatModel || fallback.chatModel || DEFAULT_OPENAI_CHAT_MODEL).trim(),
    visionModel: String(settings.visionModel || fallback.visionModel || settings.chatModel || fallback.chatModel || DEFAULT_OPENAI_VISION_MODEL).trim(),
    timeoutMs: Number(settings.timeoutMs || fallback.timeoutMs || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
  };
}

export async function testAiProviderConnection(settings = {}) {
  const config = configFromSettings(settings);
  if (!config.apiKey) throw Object.assign(new Error('请先填写 API Key'), { status: 400 });
  const startedAt = Date.now();
  await postJson(`${config.baseUrl}/chat/completions`, {
    model: config.chatModel,
    temperature: 0,
    max_tokens: 8,
    messages: [
      { role: 'system', content: '只回答 OK。' },
      { role: 'user', content: '连接测试' }
    ]
  }, config);
  return {
    ok: true,
    status: 'success',
    model: config.chatModel,
    durationMs: Date.now() - startedAt
  };
}

function parseJsonObject(text) {
  const raw = String(text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(raw); } catch {}
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('AI 未返回有效 JSON');
  return JSON.parse(raw.slice(start, end + 1));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function nullableNumber(value, min, max, digits = 0) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const bounded = Math.min(max, Math.max(min, number));
  return digits ? Number(bounded.toFixed(digits)) : Math.round(bounded);
}

function listOfText(value, fallback = []) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[，,、\s]+/);
  const normalized = list.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8);
  return normalized.length ? normalized : fallback;
}

export function normalizeVisionDishSuggestion(value = {}, options = {}) {
  const nutrition = value.nutrition || {};
  const purpose = options.purpose === 'student' ? 'student' : 'admin';
  const fallbackNotes = purpose === 'student'
    ? 'AI 根据图片估算，请结合窗口菜名、实际份量和个人情况判断。'
    : 'AI 根据图片估算，请管理员确认菜名、价格、档口和营养值后再保存。';
  return {
    name: String(value.name || '').trim().slice(0, 40),
    taste: String(value.taste || '清爽').trim().slice(0, 20),
    cuisine: String(value.cuisine || '家常菜').trim().slice(0, 30),
    ingredients: listOfText(value.ingredients),
    tags: listOfText(value.tags, ['AI识别', '待确认']),
    nutrition: {
      calories: nullableNumber(nutrition.calories, 1, 3000),
      protein: nullableNumber(nutrition.protein, 0, 300),
      fat: nullableNumber(nutrition.fat, 0, 300),
      carbs: nullableNumber(nutrition.carbs, 0, 500)
    },
    confidence: Number(clampNumber(value.confidence, 0, 1, 0.5).toFixed(2)),
    notes: String(value.notes || fallbackNotes).trim().slice(0, 240)
  };
}

function normalizeNutritionRange(value, max, unit) {
  const min = nullableNumber(value?.min, 0, max, 1);
  const upper = nullableNumber(value?.max, 0, max, 1);
  if (min === null || upper === null) return null;
  return { min: Math.min(min, upper), max: Math.max(min, upper), unit };
}

export function normalizeMealObservation(value = {}) {
  const estimate = value.estimatedNutrition || value.nutritionEstimate || {};
  const ranges = {
    calories: normalizeNutritionRange(estimate.calories, 3000, 'kcal'),
    protein: normalizeNutritionRange(estimate.protein, 300, 'g'),
    fat: normalizeNutritionRange(estimate.fat, 300, 'g'),
    carbs: normalizeNutritionRange(estimate.carbs, 500, 'g'),
  };
  const hasRanges = Object.values(ranges).every(Boolean);
  const issueCodes = listOfText(value.quality?.issueCodes || value.issueCodes)
    .map((item) => item.toUpperCase().replace(/[^A-Z0-9_]/g, '_'));
  return {
    genericNames: listOfText(value.genericNames || value.names || value.name).slice(0, 5),
    visibleIngredients: listOfText(value.visibleIngredients || value.ingredients).slice(0, 12),
    cookingMethods: listOfText(value.cookingMethods || value.methods).slice(0, 6),
    presentation: String(value.presentation || '').trim().slice(0, 160),
    multipleItems: Boolean(value.multipleItems),
    dishCountEstimate: nullableNumber(value.dishCountEstimate, 1, 12) || 1,
    quality: { usable: value.quality?.usable !== false, issueCodes },
    estimatedNutrition: hasRanges ? {
      status: 'estimated',
      basis: 'per_serving',
      portionGrams: nullableNumber(estimate.portionGrams || estimate.assumedPortionGrams, 10, 3000),
      ranges,
      sourceType: 'vision',
      sourceIds: [],
      reason: '仅根据可见食物和假设份量给出的宽区间，不能替代食堂配方。',
    } : null,
    confidence: Number(clampNumber(value.confidence, 0, 1, 0).toFixed(2)),
    notes: String(value.notes || '').trim().slice(0, 240),
  };
}

function validateVisionImage({ dataBase64, contentType } = {}) {
  const mime = String(contentType || '').trim().toLowerCase();
  const image = String(dataBase64 || '').trim();
  if (!VISION_IMAGE_TYPES.has(mime) || !image) throw Object.assign(new Error('请上传有效菜品图片'), { status: 400 });
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image)) throw Object.assign(new Error('图片数据格式错误'), { status: 400 });
  const size = Buffer.byteLength(image, 'base64');
  if (!size) throw Object.assign(new Error('请上传有效菜品图片'), { status: 400 });
  if (size > MAX_VISION_IMAGE_BYTES) throw Object.assign(new Error('图片不能超过 5MB'), { status: 413 });
  return { mime, image };
}

export async function identifyDishFromImage({ dataBase64, contentType, filename, purpose = 'admin' } = {}) {
  const config = providerConfig();
  if (!config.enabled) throw Object.assign(new Error('请先在 AI 配置中启用支持视觉的模型'), { status: 400 });
  const { mime, image } = validateVisionImage({ dataBase64, contentType });
  const isStudent = purpose === 'student';
  const data = await postJson(`${config.baseUrl}/chat/completions`, {
    model: config.visionModel || config.chatModel,
    temperature: 0.1,
    max_tokens: 700,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          isStudent ? '你是面向学生的拍照识餐助手。' : '你是智慧食堂后台的菜品图片识别助手。',
          '只输出 JSON 对象，不要 Markdown。',
          '只识别餐食本身，不识别人脸、身份、位置或隐私信息。',
          '根据图片估算菜名、口味、菜系、主要食材、标签和单份营养。',
          isStudent ? '营养值是拍照估算，只能作为点餐参考，必须提醒学生结合实际份量确认。' : '营养值是单份估算，必须提醒管理员确认后再入库。',
          '字段：name,taste,cuisine,ingredients,tags,nutrition{calories,protein,fat,carbs},confidence,notes。'
        ].join('\n')
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `请识别这张食堂餐食图片并返回 JSON。使用场景：${isStudent ? '学生健康点餐参考' : '管理员预填新增菜品表单'}。文件名：${filename || 'dish-image'}` },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${image}` } }
        ]
      }
    ]
  }, config);
  return normalizeVisionDishSuggestion(parseJsonObject(data.choices?.[0]?.message?.content), { purpose });
}

export async function observeMealFromImage({ dataBase64, contentType, filename } = {}) {
  const config = providerConfig();
  if (!config.enabled) throw Object.assign(new Error('请先在 AI 配置中启用支持视觉的模型'), { status: 400 });
  const { mime, image } = validateVisionImage({ dataBase64, contentType });
  const data = await postJson(`${config.baseUrl}/chat/completions`, {
    model: config.visionModel || config.chatModel,
    temperature: 0.1,
    max_tokens: 900,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          '你是校园食堂单道菜视觉观察器，只描述照片中可见事实。',
          '不得猜测食堂、餐厅、档口、价格、库存或具体校内菜品ID。',
          '如果画面含多道独立菜品，multipleItems=true；不要强行合并成一道菜。',
          '营养只能给宽区间，并明确基于假设份量；看不清时 estimatedNutrition 设为 null。',
          '只输出 JSON：genericNames[],visibleIngredients[],cookingMethods[],presentation,multipleItems,dishCountEstimate,quality{usable,issueCodes[]},estimatedNutrition{portionGrams,calories{min,max},protein{min,max},fat{min,max},carbs{min,max}}或null,confidence,notes。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `观察这张单道餐食照片。文件名：${filename || 'meal-image'}` },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${image}` } },
        ],
      },
    ],
  }, config);
  return normalizeMealObservation(parseJsonObject(data.choices?.[0]?.message?.content));
}

export function normalizeVisionRerank(value = {}, allowedDishIds = []) {
  const allowed = new Set(allowedDishIds.map(String));
  const seen = new Set();
  const rankings = (Array.isArray(value.rankings) ? value.rankings : [])
    .map((item) => ({
      dishId: String(item.dishId || ''),
      score: Number(clampNumber(item.score, 0, 1, 0).toFixed(3)),
      reasons: listOfText(item.reasons).slice(0, 4),
    }))
    .filter((item) => allowed.has(item.dishId) && !seen.has(item.dishId) && seen.add(item.dishId))
    .sort((left, right) => right.score - left.score);
  return {
    rankings,
    multipleItems: Boolean(value.multipleItems),
    notes: String(value.notes || '').trim().slice(0, 240),
  };
}

export async function rerankMealCandidates({ dataBase64, contentType, observation, candidates = [] } = {}) {
  const config = providerConfig();
  if (!config.enabled || !candidates.length) return { rankings: [], multipleItems: false, notes: '' };
  const { mime, image } = validateVisionImage({ dataBase64, contentType });
  const boundedCandidates = candidates.slice(0, 5);
  const content = [
    {
      type: 'text',
      text: [
        '第一张图片是用户待识别照片。后续图片是候选菜品的已审核参考图。',
        '只在给定候选中按视觉相似度排序；不得创建新候选或根据食堂名称反推结果。',
        `视觉观察：${JSON.stringify(observation)}`,
        `候选元数据：${JSON.stringify(boundedCandidates.map((item) => ({ dishId: item.dishId, name: item.name, aliases: item.aliases, semanticLabels: item.semanticLabels })))}`,
        '只输出 JSON：{"rankings":[{"dishId":"...","score":0到1,"reasons":["..."]}],"multipleItems":false,"notes":"..."}。',
      ].join('\n'),
    },
    { type: 'image_url', image_url: { url: `data:${mime};base64,${image}` } },
  ];
  for (const candidate of boundedCandidates) {
    for (const reference of (candidate.referenceImages || []).slice(0, 2)) {
      content.push({ type: 'text', text: `候选 ${candidate.dishId}｜${candidate.name}` });
      content.push({ type: 'image_url', image_url: { url: `data:${reference.contentType};base64,${reference.dataBase64}` } });
    }
  }
  const data = await postJson(`${config.baseUrl}/chat/completions`, {
    model: config.visionModel || config.chatModel,
    temperature: 0,
    max_tokens: 700,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: '你是封闭候选集菜品视觉复核器，只能返回给定 dishId。' },
      { role: 'user', content },
    ],
  }, config);
  return normalizeVisionRerank(parseJsonObject(data.choices?.[0]?.message?.content), boundedCandidates.map((item) => item.dishId));
}

async function postJson(url, payload, config = providerConfig()) {
  if (config.providerType === 'chat' && chatCircuitReason()) {
    throw Object.assign(new Error('Chat provider circuit is open for this request'), { code: 'CHAT_PROVIDER_CIRCUIT_OPEN' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || data.error || `AI provider error: ${response.status}`);
    return data;
  } catch (error) {
    const normalizedError = error?.name === 'AbortError' || error?.code === 20
      ? Object.assign(new Error(`AI provider timed out after ${config.timeoutMs}ms`), {
        code: 'AI_PROVIDER_TIMEOUT',
        cause: error,
      })
      : error;
    if (config.providerType === 'chat') openChatCircuit(normalizedError);
    throw normalizedError;
  } finally {
    clearTimeout(timer);
  }
}

export function isAiProviderEnabled() {
  return chatProviderConfig().enabled;
}

export function isChatProviderEnabled() {
  return chatProviderConfig().enabled;
}

export function isEmbeddingProviderEnabled() {
  return embeddingProviderConfig().enabled;
}

export async function createEmbeddings(inputs) {
  const config = embeddingProviderConfig();
  if (!config.enabled) return null;
  const values = (Array.isArray(inputs) ? inputs : [inputs]).map((value) => String(value || ''));
  if (!values.length) return [];
  const data = await postJson(`${config.baseUrl}/embeddings`, {
    model: config.model,
    input: values,
    dimensions: config.dimension
  }, config);
  const rows = Array.isArray(data.data) ? [...data.data].sort((left, right) => Number(left.index || 0) - Number(right.index || 0)) : [];
  const embeddings = rows.map((row) => row.embedding).filter((embedding) => Array.isArray(embedding) && embedding.length);
  if (embeddings.length !== values.length) {
    throw Object.assign(new Error(`Embedding provider returned ${embeddings.length} vector(s) for ${values.length} input(s)`), {
      code: 'EMBEDDING_BATCH_SIZE_MISMATCH',
      expectedCount: values.length,
      actualCount: embeddings.length,
    });
  }
  return embeddings;
}

export async function createEmbedding(text) {
  const embeddings = await createEmbeddings([text]);
  return embeddings?.[0] || null;
}

createEmbedding.embeddingModel = DEFAULT_OPENAI_EMBEDDING_MODEL;
createEmbedding.embeddingDimension = DEFAULT_OPENAI_EMBEDDING_DIMENSION;
createEmbeddings.embeddingModel = DEFAULT_OPENAI_EMBEDDING_MODEL;
createEmbeddings.embeddingDimension = DEFAULT_OPENAI_EMBEDDING_DIMENSION;

function citationBlock(citations) {
  return citations.map((item, index) => `${index + 1}. ${item.name || item.title}｜${item.snippet}`).join('\n');
}

function pickBlock(plan) {
  return (plan.picks || plan.dishes || []).map((dish, index) => {
    const nutrition = dish.nutrition || {};
    return `${index + 1}. ${dish.name}｜¥${dish.price}｜${dish.taste}｜${nutrition.calories}kcal｜蛋白${nutrition.protein}g｜脂肪${nutrition.fat}g｜碳水${nutrition.carbs}g｜标签${(dish.tags || []).join('/')}`;
  }).join('\n');
}

export async function generateGroundedMealAnswer({ query, profile, citations, plan }) {
  const config = providerConfig();
  if (!config.enabled) return null;
  const messages = [
    {
      role: 'system',
      content: [
        '你是智慧食堂的用餐顾问。',
        '只能基于给定 citations 和推荐 picks 回答，禁止编造不存在的菜品、价格、营养或档口。',
        '回答必须中文、简洁、可执行。',
        '如果数据不足，明确说明只能根据当前菜品库给出建议。',
        '不要输出 JSON。'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `用户问题：${query}`,
        `用户档案：${JSON.stringify(profile)}`,
        `推荐目标：${plan.goalLabel}`,
        `推荐原因：${plan.reason}`,
        `检索引用：\n${citationBlock(citations) || '无'}`,
        `规则推荐 picks：\n${pickBlock(plan) || '无'}`,
        '请给出 2-4 句建议，必须点名推荐菜品，并说明原因。'
      ].join('\n\n')
    }
  ];
  const data = await postJson(`${config.baseUrl}/chat/completions`, {
    model: config.chatModel,
    temperature: 0.2,
    max_tokens: 420,
    messages
  }, config);
  const answer = data.choices?.[0]?.message?.content?.trim();
  return answer || null;
}

export function groundingEvidenceClasses(item = {}) {
  const metadata = item.metadata || {};
  const sourceType = String(item.sourceType || 'knowledge');
  const evidenceType = String(item.evidenceType || metadata.evidenceType || '');
  const classes = [];
  if (['dish', 'stall', 'campus_policy'].includes(sourceType)) classes.push('tenant_fact');
  if (['health_knowledge', 'campus_dining_knowledge'].includes(sourceType)) classes.push('verified_knowledge');
  if (sourceType === 'food_composition_reference' || evidenceType === 'reference_only') classes.push('reference_only');
  if (evidenceType === 'ai_estimated' || metadata.aiEstimated || metadata.semanticEvidenceTypes?.includes?.('ai_estimated')) {
    classes.push('ai_estimated');
  }
  return [...new Set(classes.length ? classes : ['verified_knowledge'])];
}

function normalizedClaimText(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase();
}

function estimatedTermsFromMetadata(metadata = {}) {
  const estimated = metadata.aiEstimated || {};
  const ingredientNames = (estimated.ingredientHypotheses || []).map((item) => item?.name);
  const seasoningNames = (estimated.seasoningHypotheses || []).map((item) => item?.name);
  return [...new Set([
    ...(estimated.aliases || []),
    ...(estimated.cuisineCandidates || []),
    ...(estimated.cookingMethods || []),
    ...(estimated.tasteProfiles || []),
    ...ingredientNames,
    ...seasoningNames,
    ...(estimated.mealTypes || []),
    ...(estimated.scenarioTags || []),
    ...(estimated.nutritionGoalTags || []),
  ].map(normalizedClaimText).filter((item) => item.length >= 2))];
}

function evidenceGroup(item = {}) {
  if (item.sourceType === 'dish') return 'primary_dish_fact';
  if (item.sourceType === 'stall') return 'supporting_stall_fact';
  if (item.sourceType === 'campus_policy') return 'tenant_policy';
  if (item.sourceType === 'food_composition_reference' || item.evidenceType === 'reference_only') return 'reference_only';
  return 'reviewed_knowledge';
}

function selectGroundingCitations(citations = [], query = '', intent = '', limit = 6) {
  const normalizedQuery = normalizedClaimText(query);
  const knowledgeIntent = intent === 'knowledge_qa';
  const sourceWeights = knowledgeIntent
    ? { campus_policy: 80, health_knowledge: 70, food_composition_reference: 60, campus_dining_knowledge: 45, dish: 40, stall: 25 }
    : { dish: 80, stall: 65, campus_policy: 55, health_knowledge: 50, food_composition_reference: 45, campus_dining_knowledge: 35 };
  const ranked = citations.slice(0, 12).map((item, index) => {
    const title = normalizedClaimText(item.title || item.name);
    const exactTitleMatch = title.length >= 2 && normalizedQuery.includes(title);
    return {
      item,
      index,
      group: evidenceGroup(item),
      exactTitleMatch,
      score: (exactTitleMatch ? 200 : 0) + (sourceWeights[item.sourceType] || 20) - index,
    };
  }).sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = [];
  const selectedIds = new Set();
  const add = (entry) => {
    if (!entry || selected.length >= limit) return;
    const id = String(entry.item.id || entry.item.sourceId || entry.index);
    if (selectedIds.has(id)) return;
    selectedIds.add(id);
    selected.push(entry);
  };
  ranked.filter((entry) => entry.exactTitleMatch).slice(0, 2).forEach(add);
  for (const group of [...new Set(ranked.map((entry) => entry.group))]) {
    add(ranked.find((entry) => entry.group === group));
  }
  ranked.forEach(add);
  return selected.sort((left, right) => left.index - right.index).map((entry) => entry.item);
}

function hasUnsupportedSafetyClaim(answer) {
  const withoutNegatedSafety = String(answer || '').replace(
    /(?:不能|无法|不可|不应|不建议|不要|未能|不可以)\s*(?:(?:确认|判断|确定)\s*)?(?:(?:能否|是否)\s*)?(?:安全食用|放心吃|放心食用|不含|绝对不含|没有过敏风险)/g,
    '',
  );
  return /(?:安全食用|放心吃|放心食用|确认不含|绝对不含|没有过敏风险)/.test(withoutNegatedSafety);
}

function answerUsesEstimatedClaim(answer, item = {}) {
  const metadata = item.metadata || {};
  const evidenceType = String(item.evidenceType || metadata.evidenceType || '');
  if (evidenceType === 'ai_estimated' || item.sourceType === 'dish_ai_annotation') return true;
  const normalizedAnswer = normalizedClaimText(answer);
  const stableFactText = normalizedClaimText([
    item.title || item.name,
    metadata.stallName,
    metadata.canteenName,
    metadata.parentCanteenName,
    metadata.priceDisplay,
    ...(metadata.aliases || []),
  ].filter(Boolean).join(' '));
  const terms = (metadata.estimatedTerms || estimatedTermsFromMetadata(metadata))
    .filter((term) => !stableFactText.includes(normalizedClaimText(term)));
  return terms.some((term) => normalizedAnswer.includes(normalizedClaimText(term)));
}

export function buildGroundedAnswerRequirements(citations = []) {
  const evidenceRules = citations.map((item) => {
    const metadata = item.metadata || {};
    const evidenceClasses = item.evidenceClasses || groundingEvidenceClasses(item);
    const estimatedTerms = metadata.estimatedTerms || estimatedTermsFromMetadata(metadata);
    return {
      id: String(item.id),
      group: item.group || evidenceGroup(item),
      evidenceClasses,
      requiresAllergenUnknownWarning: metadata.safetyStatus === 'unknown',
      requiresSupplyUnconfirmedWarning: metadata.supplyConfirmed === false || metadata.availabilityStatus === 'catalog_only',
      nutritionUnverified: item.sourceType === 'dish' && metadata.nutritionFactStatus === 'unknown',
      referenceOnly: evidenceClasses.includes('reference_only'),
      estimatedTerms,
    };
  });
  return {
    promptVersion: GROUNDED_ANSWER_PROMPT_VERSION,
    allowedCitationIds: evidenceRules.map((item) => item.id),
    exactStatements: {
      allergenUnknown: '过敏原信息尚未确认，不能判断是否安全，请向档口现场核实配料和交叉接触风险。',
      supplyUnconfirmed: '该菜品为目录记录，今日供应尚未确认。',
      nutritionUnverified: '该校内菜品营养数据尚未确认，无法判断高蛋白、低脂或精确热量。',
      aiEstimated: '相关内容来自AI预标注估算，可能不准确，仍待核验。',
      referenceBoundary: '参考食材数据仅为每100克参考值，不能代表校内具体菜品。',
    },
    forbiddenClaims: [
      '未知过敏信息下声称可以安全食用、放心吃或确认不含过敏原',
      '目录状态下声称今日有售、正在供应、可购买或可下单',
      '将参考食材或AI估算写成校内菜品已核验事实',
      '输出allowedCitationIds以外的引用ID',
    ],
    evidenceRules,
  };
}

function compactGroundingCitation(item, index) {
  const id = String(item.id || item.sourceId || `citation-${index + 1}`);
  const metadata = item.metadata || {};
  const declarations = Array.isArray(metadata.safetyDeclarations) ? metadata.safetyDeclarations : [];
  const safetyStatus = metadata.safetyStatus
    || (declarations.some((entry) => entry?.status === 'unknown') ? 'unknown' : null);
  return {
    id,
    sourceType: String(item.sourceType || 'knowledge'),
    group: evidenceGroup(item),
    evidenceClasses: groundingEvidenceClasses(item),
    title: String(item.title || item.name || '').slice(0, 120),
    snippet: String(item.snippet || item.content || '').slice(0, 280),
    metadata: Object.fromEntries(Object.entries({
      tenantId: item.tenantId || metadata.tenantId || null,
      evidenceType: item.evidenceType || metadata.evidenceType || null,
      orderable: metadata.orderable,
      price: metadata.price,
      priceDisplay: metadata.priceDisplay || null,
      stallName: metadata.stallName || null,
      canteenName: metadata.canteenName || null,
      parentCanteenName: metadata.parentCanteenName || null,
      aliases: metadata.aliases || [],
      status: metadata.status,
      availabilityStatus: metadata.availabilityStatus || null,
      supplyConfirmed: metadata.supplyConfirmed,
      safetyStatus,
      unknownAllergens: metadata.unknownAllergens || [],
      nutritionFactStatus: metadata.nutritionFactStatus || metadata.factStatus?.nutrition || null,
      confidenceLevel: metadata.confidenceLevel || null,
      dataVersion: metadata.dataVersion || null,
      basisGrams: metadata.basisGrams || null,
      campusDishFactPolicy: metadata.campusDishFactPolicy || null,
      estimatedTerms: estimatedTermsFromMetadata(metadata),
    }).filter(([, value]) => value !== null && value !== undefined && (!Array.isArray(value) || value.length))),
  };
}

function factNumbers(sources) {
  const values = new Set();
  for (const value of sources) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    for (const match of text.matchAll(/\d+(?:\.\d+)?/g)) values.add(Number(match[0]).toFixed(2));
  }
  return values;
}

/** Validate the model's bounded JSON before any generated prose reaches a client. */
export function validateGroundedAgentAnswer(value, citations = [], options = {}) {
  const answer = String(value?.answer || '').trim();
  const citationIds = [...new Set((Array.isArray(value?.citationIds) ? value.citationIds : []).map(String).filter(Boolean))];
  const allowedIds = new Set(citations.map((item) => String(item.id)));
  if (!answer || answer.length > 1200) return { valid: false, reason: 'INVALID_ANSWER_TEXT' };
  if (citations.length && !citationIds.length) return { valid: false, reason: 'CITATION_REQUIRED' };
  if (citationIds.some((id) => !allowedIds.has(id))) return { valid: false, reason: 'UNKNOWN_CITATION' };

  const cited = citations.filter((item) => citationIds.includes(String(item.id)));
  const hasUnknownSafety = cited.some((item) => item.metadata?.safetyStatus === 'unknown');
  if (hasUnknownSafety && hasUnsupportedSafetyClaim(answer)) {
    return { valid: false, reason: 'UNSUPPORTED_SAFETY_CLAIM' };
  }
  if (hasUnknownSafety && !/(?:尚未确认|未确认|信息未知|现场核实|交叉接触)/.test(answer)) {
    return { valid: false, reason: 'MISSING_ALLERGEN_WARNING' };
  }

  const evidenceClasses = new Set(cited.flatMap((item) => item.evidenceClasses || groundingEvidenceClasses(item)));
  const hasUnconfirmedSupply = cited.some((item) => item.metadata?.supplyConfirmed === false || item.metadata?.availabilityStatus === 'catalog_only');
  if (hasUnconfirmedSupply && /(?:今日|当前|现在)(?:有售|供应中|正在供应|可以买|可购买|可下单|可点)/.test(answer)) {
    return { valid: false, reason: 'UNSUPPORTED_SUPPLY_CLAIM' };
  }
  const usesEstimatedClaim = cited.some((item) => answerUsesEstimatedClaim(answer, item));
  if (usesEstimatedClaim && !/(?:AI\s*)?(?:估算|推测|可能|待核验|预标注)/i.test(answer)) {
    return { valid: false, reason: 'MISSING_ESTIMATION_LABEL' };
  }
  const hasReferenceNutritionNumber = evidenceClasses.has('reference_only')
    && /\d+(?:\.\d+)?\s*(?:kcal|千卡|g|克|mg|毫克)/i.test(answer);
  const hasReferenceLabel = /(?:参考食材|参考值)/.test(answer);
  const hasReferenceBoundary = /(?:不代表|不能代表|不得覆盖).{0,10}(?:菜品|配方|营养|事实)/.test(answer);
  if (hasReferenceNutritionNumber && !(hasReferenceLabel && hasReferenceBoundary)) {
    return { valid: false, reason: 'MISSING_REFERENCE_BOUNDARY' };
  }
  const hasUnknownDishNutrition = cited.some((item) => item.sourceType === 'dish' && item.metadata?.nutritionFactStatus === 'unknown');
  if (hasUnknownDishNutrition
    && /(?:\d+(?:\.\d+)?\s*(?:kcal|千卡|g|克|mg|毫克)|高蛋白|低脂|低卡|低热量)/i.test(answer)
    && !/(?:营养(?:数据|信息)?(?:尚未确认|未确认|未知|待核验)|无法判断|不能判断|估算|参考值|不代表(?:该|校内)?菜品)/.test(answer)) {
    return { valid: false, reason: 'UNSUPPORTED_NUTRITION_CLAIM' };
  }

  const allowedNumbers = factNumbers([...citations, ...(options.allowedNumberSources || [])]);
  for (const match of answer.matchAll(/(?:[¥￥]\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:元|kcal|千卡|g|克|mg|毫克))/gi)) {
    const number = match[1] || match[2];
    if (!allowedNumbers.has(Number(number).toFixed(2))) return { valid: false, reason: 'UNSUPPORTED_PRICE_CLAIM' };
  }
  return { valid: true, answer, citationIds };
}

function groundedAnswerSystemPrompt({ repair = false } = {}) {
  return [
    '你是校园食堂 Agent 的受约束回答生成器。',
    repair ? '这是一次且仅一次的格式与证据边界修复，不得增加新事实。' : '先选择最少且直接相关的证据，再组织回答。',
    '只能复述 evidence 中的事实；不得补充菜品、价格、营养、过敏原、库存、供应或位置。',
    'hardConstraints 不可放宽。requirements.allowedCitationIds 是唯一引用白名单。',
    '优先只引用1至3条直接证据。引用后必须逐字包含该 evidenceRule.requiredStatements 中的每句话。',
    '若回答涉及校内菜品营养且 evidenceRule.nutritionStatement 非空，必须逐字包含该句。',
    '只有实际使用 evidenceRule.estimatedTerms 中的AI字段时才加入其 estimationStatement。',
    '不得声称未知过敏信息是安全、放心吃或确认不含；“不能放心吃”“无法确认安全”是允许的风险提示。',
    '只输出JSON，不要Markdown或额外字段：{"answer":"非空中文回答","citationIds":["完整白名单ID"]}。',
  ].join('\n');
}

function compactGroundedRequirements(requirements) {
  return {
    allowedCitationIds: requirements.allowedCitationIds,
    evidenceRules: requirements.evidenceRules.map((rule) => {
      const requiredStatements = [];
      if (rule.requiresAllergenUnknownWarning) requiredStatements.push(requirements.exactStatements.allergenUnknown);
      if (rule.requiresSupplyUnconfirmedWarning) requiredStatements.push(requirements.exactStatements.supplyUnconfirmed);
      if (rule.referenceOnly) requiredStatements.push(requirements.exactStatements.referenceBoundary);
      return {
        id: rule.id,
        group: rule.group,
        requiredStatements,
        nutritionStatement: rule.nutritionUnverified ? requirements.exactStatements.nutritionUnverified : null,
        estimatedTerms: rule.estimatedTerms.slice(0, 16),
        estimationStatement: rule.estimatedTerms.length ? requirements.exactStatements.aiEstimated : null,
      };
    }),
  };
}

function groundedAttemptResult(data, evidence, query, hardConstraints) {
  const rawOutput = String(data.choices?.[0]?.message?.content || '');
  const finishReason = data.choices?.[0]?.finish_reason || null;
  let parsed;
  try {
    parsed = parseJsonObject(rawOutput);
  } catch {
    return { valid: false, reason: 'INVALID_MODEL_JSON', rawOutput, finishReason };
  }
  const validated = validateGroundedAgentAnswer(parsed, evidence, { allowedNumberSources: [query, hardConstraints] });
  return validated.valid
    ? { valid: true, ...validated, rawOutput, finishReason }
    : { valid: false, reason: validated.reason, rawOutput, finishReason };
}

function groundedGenerationMetadata(overrides = {}) {
  return {
    firstPassAccepted: false,
    repairAttempted: false,
    repairAccepted: false,
    initialFailureReason: null,
    finalFailureReason: null,
    promptVersion: GROUNDED_ANSWER_PROMPT_VERSION,
    firstPassLatencyMs: 0,
    repairLatencyMs: 0,
    firstPassFinishReason: null,
    repairFinishReason: null,
    ...overrides,
  };
}

/** Generate prose only after tools have produced a tenant-safe evidence pack. */
export async function generateGroundedAgentAnswer({
  query,
  intent,
  deterministicAnswer,
  citations = [],
  hardConstraints = {},
  allowRepair = true,
  includeRejectedOutput = false,
} = {}) {
  const config = chatProviderConfig();
  if (!config.enabled || !citations.length) {
    return {
      answer: null,
      citationIds: [],
      reason: 'CHAT_OR_EVIDENCE_UNAVAILABLE',
      ...groundedGenerationMetadata({ finalFailureReason: 'CHAT_OR_EVIDENCE_UNAVAILABLE' }),
    };
  }
  if (chatCircuitReason()) {
    return {
      answer: null,
      citationIds: [],
      reason: 'CHAT_PROVIDER_CIRCUIT_OPEN',
      ...groundedGenerationMetadata({ finalFailureReason: 'CHAT_PROVIDER_CIRCUIT_OPEN' }),
    };
  }
  const evidence = selectGroundingCitations(citations, query, intent).map(compactGroundingCitation);
  const requirements = buildGroundedAnswerRequirements(evidence);
  const promptRequirements = compactGroundedRequirements(requirements);
  const request = {
    model: config.chatModel,
    temperature: 0,
    max_tokens: 4000,
    reasoning_effort: 'low',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: groundedAnswerSystemPrompt() },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'compose_grounded_answer',
          query: String(query || '').slice(0, 1000),
          intent: String(intent || ''),
          hardConstraints,
          requirements: promptRequirements,
          evidence,
          deterministicAnswer: String(deterministicAnswer || '').slice(0, 600),
        })
      }
    ]
  };
  const firstPassStartedAt = performance.now();
  const firstData = await postJson(`${config.baseUrl}/chat/completions`, request, config);
  const firstPassLatencyMs = Number((performance.now() - firstPassStartedAt).toFixed(2));
  const first = groundedAttemptResult(firstData, evidence, query, hardConstraints);
  if (first.valid) {
    const citedEvidence = evidence.filter((item) => first.citationIds.includes(item.id));
    return {
      answer: first.answer,
      citationIds: first.citationIds,
      evidenceClasses: [...new Set(citedEvidence.flatMap((item) => item.evidenceClasses || []))],
      reason: null,
      model: config.chatModel,
      ...groundedGenerationMetadata({
        firstPassAccepted: true,
        firstPassLatencyMs,
        firstPassFinishReason: first.finishReason,
      }),
    };
  }

  if (!allowRepair) {
    return {
      answer: null,
      citationIds: [],
      reason: first.reason,
      model: config.chatModel,
      ...groundedGenerationMetadata({
        initialFailureReason: first.reason,
        finalFailureReason: first.reason,
        firstPassLatencyMs,
        firstPassFinishReason: first.finishReason,
      }),
      ...(includeRejectedOutput ? { rejectedOutput: first.rawOutput.slice(0, 4000) } : {}),
      ...(includeRejectedOutput ? { rejectedFinishReason: first.finishReason } : {}),
    };
  }

  const repairStartedAt = performance.now();
  const repairData = await postJson(`${config.baseUrl}/chat/completions`, {
    ...request,
    messages: [
      { role: 'system', content: groundedAnswerSystemPrompt({ repair: true }) },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'repair_grounded_answer_once',
          failureReason: first.reason,
          rejectedOutput: first.rawOutput.slice(0, 2000),
          query: String(query || '').slice(0, 1000),
          intent: String(intent || ''),
          hardConstraints,
          requirements: promptRequirements,
          evidence,
          deterministicAnswer: String(deterministicAnswer || '').slice(0, 600),
        }),
      },
    ],
  }, config);
  const repairLatencyMs = Number((performance.now() - repairStartedAt).toFixed(2));
  const repaired = groundedAttemptResult(repairData, evidence, query, hardConstraints);
  if (!repaired.valid) {
    return {
      answer: null,
      citationIds: [],
      reason: repaired.reason,
      model: config.chatModel,
      ...groundedGenerationMetadata({
        repairAttempted: true,
        initialFailureReason: first.reason,
        finalFailureReason: repaired.reason,
        firstPassLatencyMs,
        repairLatencyMs,
        firstPassFinishReason: first.finishReason,
        repairFinishReason: repaired.finishReason,
      }),
      ...(includeRejectedOutput ? {
        rejectedOutput: first.rawOutput.slice(0, 4000),
        repairRejectedOutput: repaired.rawOutput.slice(0, 4000),
        rejectedFinishReason: first.finishReason,
        repairRejectedFinishReason: repaired.finishReason,
      } : {}),
    };
  }
  const citedEvidence = evidence.filter((item) => repaired.citationIds.includes(item.id));
  return {
    answer: repaired.answer,
    citationIds: repaired.citationIds,
    evidenceClasses: [...new Set(citedEvidence.flatMap((item) => item.evidenceClasses || []))],
    reason: null,
    model: config.chatModel,
    ...groundedGenerationMetadata({
      repairAttempted: true,
      repairAccepted: true,
      initialFailureReason: first.reason,
      firstPassLatencyMs,
      repairLatencyMs,
      firstPassFinishReason: first.finishReason,
      repairFinishReason: repaired.finishReason,
    }),
  };
}

function compactDishAnnotationRequest(dishes, knowledge) {
  const healthById = new Map();
  const compactDishes = dishes.map(({ healthKnowledge = [], ...dish }) => {
    const healthKnowledgeIds = [];
    for (const document of Array.isArray(healthKnowledge) ? healthKnowledge : []) {
      const id = String(document?.id || '').trim();
      if (!id) continue;
      if (!healthById.has(id)) healthById.set(id, document);
      healthKnowledgeIds.push(id);
    }
    return { ...dish, healthKnowledgeIds };
  });
  return {
    dishes: compactDishes,
    knowledge: { ...knowledge, healthKnowledge: [...healthById.values()] },
  };
}

/** Generate review-only dish annotations. Local validation remains authoritative. */
export async function generateDishAnnotationCandidates({ dishes = [], knowledge = {}, promptVersion } = {}) {
  const config = chatProviderConfig();
  if (!config.enabled) throw Object.assign(new Error('AI Chat provider is not configured'), { code: 'CHAT_PROVIDER_NOT_CONFIGURED' });
  if (!Array.isArray(dishes) || !dishes.length || dishes.length > 10) {
    throw Object.assign(new Error('Dish annotation batches must contain 1-10 dishes'), { code: 'INVALID_ANNOTATION_BATCH' });
  }
  const modelInput = compactDishAnnotationRequest(dishes, knowledge);
  const maxTokens = Math.min(32_000, 8_000 + (dishes.length * 4_000));
  const data = await postJson(`${config.baseUrl}/chat/completions`, {
    model: config.chatModel,
    temperature: 0.1,
    max_tokens: maxTokens,
    reasoning_effort: 'low',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          '你是校园食堂菜品数据预标注器，只输出待人工核验的估算候选。',
          '只输出 JSON：{"annotations":[...]}，每道输入菜品恰好一条。',
          '不得输出 verified、confirmed_absent、confirmed_present、cross_contact_possible 或清真认证。',
          'factStatus 必须为 estimated，safetyStatus 必须为 unknown。',
          '过敏原只能写入 allergenHints，表示可能涉及，不能声明安全。',
          '营养必须是宽区间；称重菜使用 per_100g，其他菜使用 per_serving 并写明假设分量。',
          '引用ID只能来自对应输入提供的概念、健康知识和食物成分参考。',
          '所有引用值只能逐字复制输入对象的 id 字段；不得把哈希、文件名、URL、菜品ID或自行编造的值写入引用数组。',
          '每道菜的 healthKnowledgeIds 只能引用 knowledge.healthKnowledge 中同 ID 的共享正文。',
          '没有参考食材时 nutritionEstimate.referenceIds 留空并降低 confidence。',
          '不要补充价格、供应、库存、营业时间或真实配方。',
          '严格遵守 outputSchema；所有 required 字段都必须存在，不适用列表用 []，未知辣度用 null，无法合理估算营养时用 null。',
          'fieldConfidence 必须完整填写 outputSchema 中列出的12个字段，值为0到1；uncertaintyNotes 至少写一条待核验边界。',
          'sourceIds 必须包含 linkedConceptIds 及所有 ingredient、seasoning、allergen、nutrition 的 referenceIds。',
          '不得增加 outputSchema 未声明的字段。',
          'mealTypes 只能使用 breakfast、lunch、dinner、late_snack，不得输出中文枚举。',
          `提示词版本：${String(promptVersion || 'unknown')}`,
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify({ outputSchema: DISH_AI_ANNOTATION_BATCH_JSON_SCHEMA, ...modelInput }),
      },
    ],
  }, { ...config, timeoutMs: Math.max(config.timeoutMs, 60_000) });
  const choice = data.choices?.[0] || {};
  const content = choice.message?.content || '';
  let parsed;
  try {
    parsed = parseJsonObject(content);
  } catch (error) {
    const completionTokens = Number(data.usage?.completion_tokens ?? data.usage?.output_tokens ?? 0) || 0;
    throw Object.assign(new Error(
      `AI annotation JSON is invalid (finish=${choice.finish_reason || 'unknown'}, chars=${String(content).length}, completionTokens=${completionTokens}): ${error.message}`,
    ), { code: 'INVALID_ANNOTATION_JSON' });
  }
  const usage = data.usage || {};
  return {
    ...parsed,
    model: data.model || config.chatModel,
    finishReason: choice.finish_reason || null,
    usage: {
      promptTokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0,
      completionTokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0,
      totalTokens: Number(usage.total_tokens ?? 0) || 0,
    },
  };
}

export async function generateAgentToolCalls({ query, tools = [] } = {}) {
  const config = providerConfig();
  if (!config.enabled || !tools.length) return null;
  const openAiTools = tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name.replace(/\./g, '__'),
      description: tool.title,
      parameters: tool.parameters || { type: 'object', properties: {} }
    }
  }));
  try {
    const routingTimeoutMs = positiveInteger(env('AI_ROUTING_TIMEOUT_MS'), DEFAULT_ROUTING_TIMEOUT_MS);
    const data = await postJson(`${config.baseUrl}/chat/completions`, {
      model: config.chatModel,
      temperature: 0,
      max_tokens: 160,
      tools: openAiTools,
      tool_choice: 'auto',
      messages: [
        { role: 'system', content: '你是智慧食堂 Agent 的工具选择器。只能选择给定工具；高风险业务变更只能选择 propose 工具，不要直接执行。' },
        { role: 'user', content: String(query || '').slice(0, 1000) }
      ]
    }, { ...config, timeoutMs: Math.min(config.timeoutMs, routingTimeoutMs) });
    const calls = data.choices?.[0]?.message?.tool_calls || [];
    return calls.map((call) => ({
      id: call.id,
      name: String(call.function?.name || '').replace(/__/g, '.'),
      arguments: parseJsonObject(call.function?.arguments || '{}')
    })).filter((call) => call.name);
  } catch (error) {
    openChatCircuit(error);
    throw error;
  }
}

/** Ask the model for optional, bounded search filters only after deterministic retrieval misses. */
export async function generateDishSearchFilterSupplement({ query } = {}) {
  const config = providerConfig();
  if (!config.enabled || chatCircuitReason() || !String(query || '').trim()) return null;
  const data = await postJson(`${config.baseUrl}/chat/completions`, {
    model: config.chatModel,
    temperature: 0,
    max_tokens: 180,
    tools: [{
      type: 'function',
      function: {
        name: 'supplement_dish_search_filters',
        description: '从模糊菜品查询中提取可验证的检索过滤条件，不要猜测菜名或返回菜品。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            mealType: { type: 'string', enum: ['breakfast', 'lunch', 'dinner'] },
            budgetMin: { type: 'number', minimum: 0, maximum: 10000 },
            budgetMax: { type: 'number', minimum: 0, maximum: 10000 },
            canteenName: { type: 'string', maxLength: 80 },
            stallName: { type: 'string', maxLength: 80 },
            taste: { type: 'string', maxLength: 80 },
            halalOnly: { type: 'boolean' },
            dietaryPattern: { type: 'string', enum: ['balanced', 'vegetarian', 'vegan'] },
            tags: { type: 'array', items: { type: 'string', maxLength: 30 }, maxItems: 10 },
            includeIngredients: { type: 'array', items: { type: 'string', maxLength: 30 }, maxItems: 10 },
            avoidIngredients: { type: 'array', items: { type: 'string', maxLength: 30 }, maxItems: 10 },
            allergens: { type: 'array', items: { type: 'string', maxLength: 30 }, maxItems: 10 },
            minProtein: { type: 'number', minimum: 0, maximum: 1000 },
            minFiber: { type: 'number', minimum: 0, maximum: 1000 },
            maxCalories: { type: 'number', minimum: 0, maximum: 10000 },
            maxFat: { type: 'number', minimum: 0, maximum: 1000 },
            maxCarbs: { type: 'number', minimum: 0, maximum: 2000 },
            maxSodium: { type: 'number', minimum: 0, maximum: 100000 },
            maxSugar: { type: 'number', minimum: 0, maximum: 1000 }
          }
        }
      }
    }],
    tool_choice: { type: 'function', function: { name: 'supplement_dish_search_filters' } },
    messages: [
      { role: 'system', content: '只提取用户明确表达或可直接判断的过滤条件；无法确定就留空。不要输出菜品、价格、库存或推荐。' },
      { role: 'user', content: String(query).slice(0, 1000) }
    ]
  }, config);
  const call = data.choices?.[0]?.message?.tool_calls?.find((item) => item.function?.name === 'supplement_dish_search_filters');
  return call ? parseJsonObject(call.function.arguments || '{}') : {};
}
