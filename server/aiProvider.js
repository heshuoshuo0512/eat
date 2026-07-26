import { AsyncLocalStorage } from 'node:async_hooks';

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
const DEFAULT_OPENAI_EMBEDDING_DIMENSION = 1536;
const DEFAULT_EMBEDDING_BATCH_SIZE = 24;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_ROUTING_TIMEOUT_MS = 3_000;
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

function openChatCircuit(error) {
  const circuit = activeChatCircuit();
  if (!circuit || circuit.open) return;
  circuit.open = true;
  circuit.reason = String(error?.code || error?.message || 'CHAT_PROVIDER_FAILED').slice(0, 240);
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
      calories: Math.round(clampNumber(nutrition.calories, 1, 3000, 500)),
      protein: Math.round(clampNumber(nutrition.protein, 0, 300, 20)),
      fat: Math.round(clampNumber(nutrition.fat, 0, 300, 12)),
      carbs: Math.round(clampNumber(nutrition.carbs, 0, 500, 60))
    },
    confidence: Number(clampNumber(value.confidence, 0, 1, 0.5).toFixed(2)),
    notes: String(value.notes || fallbackNotes).trim().slice(0, 240)
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
    if (config.providerType === 'chat') openChatCircuit(error);
    throw error;
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
    input: values
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

function compactGroundingCitation(item, index) {
  const id = String(item.id || item.sourceId || `citation-${index + 1}`);
  return {
    id,
    sourceType: String(item.sourceType || 'knowledge'),
    title: String(item.title || item.name || '').slice(0, 120),
    snippet: String(item.snippet || item.content || '').slice(0, 500),
    metadata: {
      tenantId: item.tenantId || item.metadata?.tenantId || null,
      evidenceType: item.evidenceType || item.metadata?.evidenceType || null,
      orderable: item.metadata?.orderable,
      price: item.metadata?.price,
      status: item.metadata?.status,
      safetyStatus: item.metadata?.safetyStatus || null,
      unknownAllergens: item.metadata?.unknownAllergens || [],
      confidenceLevel: item.metadata?.confidenceLevel || null,
      dataVersion: item.metadata?.dataVersion || null,
    },
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
  if (hasUnknownSafety && /(?:安全食用|放心吃|放心食用|确认不含|绝对不含|没有过敏风险)/.test(answer)) {
    return { valid: false, reason: 'UNSUPPORTED_SAFETY_CLAIM' };
  }
  if (hasUnknownSafety && !/(?:尚未确认|未确认|信息未知|现场核实|交叉接触)/.test(answer)) {
    return { valid: false, reason: 'MISSING_ALLERGEN_WARNING' };
  }

  const allowedNumbers = factNumbers([...citations, ...(options.allowedNumberSources || [])]);
  for (const match of answer.matchAll(/(?:[¥￥]\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:元|kcal|千卡|g|克|mg|毫克))/gi)) {
    const number = match[1] || match[2];
    if (!allowedNumbers.has(Number(number).toFixed(2))) return { valid: false, reason: 'UNSUPPORTED_PRICE_CLAIM' };
  }
  return { valid: true, answer, citationIds };
}

/** Generate prose only after tools have produced a tenant-safe evidence pack. */
export async function generateGroundedAgentAnswer({ query, intent, deterministicAnswer, citations = [], hardConstraints = {} } = {}) {
  const config = chatProviderConfig();
  if (!config.enabled || !citations.length) return { answer: null, citationIds: [], reason: 'CHAT_OR_EVIDENCE_UNAVAILABLE' };
  if (chatCircuitReason()) return { answer: null, citationIds: [], reason: 'CHAT_PROVIDER_CIRCUIT_OPEN' };
  const evidence = citations.slice(0, 12).map(compactGroundingCitation);
  const data = await postJson(`${config.baseUrl}/chat/completions`, {
    model: config.chatModel,
    temperature: 0.1,
    max_tokens: 1800,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          '你是校园食堂 Agent 的受约束回答生成器。',
          '只允许根据给定 evidence 组织中文回答，不得补充未提供的菜品、价格、营养、过敏原、库存、供应时段或档口事实。',
          'hardConstraints 是不可放宽的安全约束。通用知识只能解释，不能覆盖真实菜品数据。',
          'evidence 中 safetyStatus=unknown 时必须明确说明过敏信息尚未确认并建议现场核实，禁止声称安全或确认不含。',
          '只输出 JSON：{"answer":"...","citationIds":["..."]}。',
          'answer 必须是非空中文字符串，不能是布尔值、数组或对象。',
          'citationIds 必须来自 evidence.id；有证据时至少引用一项。',
          '示例：{"answer":"根据当前证据，可选择示例菜品。","citationIds":["dish:example"]}'
        ].join('\n')
      },
      {
        role: 'user',
        content: JSON.stringify({
          query: String(query || '').slice(0, 1000),
          intent: String(intent || ''),
          hardConstraints,
          evidence,
          deterministicAnswer: String(deterministicAnswer || '').slice(0, 1000),
        })
      }
    ]
  }, config);
  let parsed;
  try {
    parsed = parseJsonObject(data.choices?.[0]?.message?.content || '');
  } catch {
    return { answer: null, citationIds: [], reason: 'INVALID_MODEL_JSON' };
  }
  const validated = validateGroundedAgentAnswer(parsed, evidence, { allowedNumberSources: [query, hardConstraints] });
  if (!validated.valid) return { answer: null, citationIds: [], reason: validated.reason };
  return { answer: validated.answer, citationIds: validated.citationIds, reason: null, model: config.chatModel };
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
