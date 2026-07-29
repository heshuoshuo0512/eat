const DEFAULT_MODEL = 'siglip-base-patch16-224';
const DEFAULT_DIMENSION = 768;
const DEFAULT_TIMEOUT_MS = 8_000;

function normalizedBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function config(overrides = {}) {
  const baseUrl = normalizedBaseUrl(overrides.baseUrl || process.env.VISION_EMBEDDING_BASE_URL);
  return {
    enabled: Boolean(baseUrl),
    baseUrl,
    apiKey: String(overrides.apiKey || process.env.VISION_EMBEDDING_API_KEY || '').trim(),
    model: String(overrides.model || process.env.VISION_EMBEDDING_MODEL || DEFAULT_MODEL).trim(),
    modelVersion: String(overrides.modelVersion || process.env.VISION_EMBEDDING_MODEL_VERSION || '').trim(),
    dimension: Number(overrides.dimension || process.env.VISION_EMBEDDING_DIMENSION || DEFAULT_DIMENSION),
    timeoutMs: Number(overrides.timeoutMs || process.env.VISION_EMBEDDING_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  };
}

function validateImage({ dataBase64, contentType } = {}) {
  const mime = String(contentType || '').toLowerCase();
  const image = String(dataBase64 || '').trim();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) || !image) {
    throw Object.assign(new Error('视觉向量仅支持 JPEG、PNG 或 WebP 图片'), { status: 400, code: 'INVALID_VISION_EMBEDDING_IMAGE' });
  }
  return { image, mime };
}

function normalizedEmbedding(value, dimension) {
  const embedding = Array.isArray(value) ? value.map(Number) : [];
  if (embedding.length !== dimension || embedding.some((item) => !Number.isFinite(item))) {
    throw Object.assign(new Error(`视觉向量维度必须为 ${dimension}`), {
      code: 'VISION_EMBEDDING_DIMENSION_MISMATCH',
      expectedDimension: dimension,
      actualDimension: embedding.length,
    });
  }
  const norm = Math.sqrt(embedding.reduce((sum, item) => sum + item * item, 0));
  if (!norm) throw Object.assign(new Error('视觉向量不能是零向量'), { code: 'VISION_EMBEDDING_ZERO_VECTOR' });
  return embedding.map((item) => item / norm);
}

export function getVisionEmbeddingStatus(overrides) {
  const active = config(overrides);
  return {
    enabled: active.enabled,
    baseUrl: active.baseUrl,
    model: active.model,
    modelVersion: active.modelVersion || active.model,
    dimension: active.dimension,
    timeoutMs: active.timeoutMs,
  };
}

export async function createVisionImageEmbedding(imageInput, overrides) {
  const active = config(overrides);
  if (!active.enabled) return null;
  const { image, mime } = validateImage(imageInput);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), active.timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (active.apiKey) headers.Authorization = `Bearer ${active.apiKey}`;
    const response = await fetch(`${active.baseUrl}/embed`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({ model: active.model, image: { contentType: mime, dataBase64: image } }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || payload.error || `Vision embedding provider error: ${response.status}`);
    return {
      model: String(payload.modelVersion || payload.model || active.modelVersion || active.model),
      modelVersion: String(payload.modelVersion || payload.model || active.modelVersion || active.model),
      embedding: normalizedEmbedding(payload.embedding || payload.data?.[0]?.embedding, active.dimension),
      dimension: active.dimension,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) return null;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export function pgVectorLiteral(embedding) {
  return `[${(embedding || []).map((item) => Number(item).toFixed(8)).join(',')}]`;
}
