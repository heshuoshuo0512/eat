const runtimeConfig = {
  apiKey: '',
  baseUrl: '',
  embeddingModel: '',
  chatModel: '',
  visionModel: '',
  timeoutMs: 0
};

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_OPENAI_CHAT_MODEL = 'gpt-4o-mini';
const DEFAULT_OPENAI_VISION_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 12_000;
const VISION_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_VISION_IMAGE_BYTES = 5 * 1024 * 1024;

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

function providerConfig() {
  const apiKey = runtimeConfig.apiKey || env('AI_API_KEY') || env('OPENAI_API_KEY');
  return {
    enabled: Boolean(apiKey),
    source: runtimeConfig.apiKey ? 'admin' : (apiKey ? 'env' : 'none'),
    apiKey,
    baseUrl: (runtimeConfig.baseUrl || env('AI_BASE_URL', env('OPENAI_BASE_URL', DEFAULT_OPENAI_BASE_URL))).replace(/\/$/, ''),
    embeddingModel: runtimeConfig.embeddingModel || env('AI_EMBEDDING_MODEL', env('OPENAI_EMBEDDING_MODEL', DEFAULT_OPENAI_EMBEDDING_MODEL)),
    chatModel: runtimeConfig.chatModel || env('AI_CHAT_MODEL', env('OPENAI_CHAT_MODEL', DEFAULT_OPENAI_CHAT_MODEL)),
    visionModel: runtimeConfig.visionModel || env('AI_VISION_MODEL', env('OPENAI_VISION_MODEL', runtimeConfig.chatModel || env('AI_CHAT_MODEL', env('OPENAI_CHAT_MODEL', DEFAULT_OPENAI_VISION_MODEL)))),
    timeoutMs: Number(runtimeConfig.timeoutMs || env('AI_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)) || DEFAULT_TIMEOUT_MS
  };
}

export function setAiRuntimeConfig(settings = {}) {
  runtimeConfig.apiKey = String(settings.apiKey || '').trim();
  runtimeConfig.baseUrl = String(settings.baseUrl || '').trim();
  runtimeConfig.embeddingModel = String(settings.embeddingModel || '').trim();
  runtimeConfig.chatModel = String(settings.chatModel || '').trim();
  runtimeConfig.visionModel = String(settings.visionModel || '').trim();
  runtimeConfig.timeoutMs = Number(settings.timeoutMs || 0) || 0;
}

export function getAiProviderStatus() {
  const config = providerConfig();
  return {
    enabled: config.enabled,
    source: config.source,
    baseUrl: config.baseUrl,
    embeddingModel: config.embeddingModel,
    chatModel: config.chatModel,
    visionModel: config.visionModel,
    timeoutMs: config.timeoutMs,
    hasApiKey: Boolean(config.apiKey)
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
  const data = await postJson(`${config.baseUrl}/chat/completions`, {
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
    model: config.chatModel,
    baseUrl: config.baseUrl,
    sample: data.choices?.[0]?.message?.content?.trim() || 'OK'
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || data.error || `AI provider error: ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export function isAiProviderEnabled() {
  return providerConfig().enabled;
}

export async function createEmbedding(text) {
  const config = providerConfig();
  if (!config.enabled) return null;
  const data = await postJson(`${config.baseUrl}/embeddings`, {
    model: config.embeddingModel,
    input: String(text || '')
  }, config);
  const embedding = data.data?.[0]?.embedding;
  return Array.isArray(embedding) && embedding.length ? embedding : null;
}

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
  }, config);
  const calls = data.choices?.[0]?.message?.tool_calls || [];
  return calls.map((call) => ({
    id: call.id,
    name: String(call.function?.name || '').replace(/__/g, '.'),
    arguments: parseJsonObject(call.function?.arguments || '{}')
  })).filter((call) => call.name);
}
