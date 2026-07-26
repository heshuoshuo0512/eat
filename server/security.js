import { createCipheriv, createDecipheriv, createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

const INSECURE_SECRET_VALUES = new Set(['replace-with-at-least-32-random-bytes', 'change-me', 'secret', 'smart-canteen-secret']);

export function resolveRuntimeSecret(env = process.env) {
  const configured = String(env.SMART_CANTEEN_SECRET || '').trim();
  if (env.NODE_ENV === 'production') {
    if (!configured || configured.length < 32 || INSECURE_SECRET_VALUES.has(configured)) {
      throw new Error('生产环境必须配置至少 32 字符的 SMART_CANTEEN_SECRET');
    }
    return configured;
  }
  return configured || randomBytes(32).toString('hex');
}

const SECRET = resolveRuntimeSecret();
const LEGACY_TOKEN_TTL_SECONDS = 60 * 60 * 8;
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const SECRET_KEY = createHmac('sha256', SECRET).update('smart-canteen-secret-encryption').digest();

export function encryptSecret(value) {
  const plain = String(value || '');
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', SECRET_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptSecret(value) {
  const encoded = String(value || '');
  if (!encoded) return '';
  if (!encoded.startsWith('enc:v1:')) return encoded;
  const [, , ivRaw, tagRaw, dataRaw] = encoded.split(':');
  if (!ivRaw || !tagRaw || !dataRaw) return '';
  try {
    const decipher = createDecipheriv('aes-256-gcm', SECRET_KEY, Buffer.from(ivRaw, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}


function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload) {
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

export function createSignedUploadUrl(uploadId, ttlSeconds = Number(process.env.UPLOAD_URL_TTL_SECONDS || 900)) {
  const id = String(uploadId || '').trim();
  if (!id) return '';
  const expires = Math.floor(Date.now() / 1000) + Math.max(30, Number(ttlSeconds) || 900);
  const signature = sign(`upload:${id}:${expires}`);
  return `/api/uploads/${encodeURIComponent(id)}/content?expires=${expires}&signature=${encodeURIComponent(signature)}`;
}

export function verifySignedUploadUrl(uploadId, expires, signature) {
  const id = String(uploadId || '').trim();
  const expiry = Number(expires);
  const provided = String(signature || '');
  if (!id || !Number.isInteger(expiry) || expiry < Math.floor(Date.now() / 1000) || !provided) return false;
  const expected = sign(`upload:${id}:${expiry}`);
  const actualBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function resolveUploadReference(value) {
  const reference = String(value || '');
  return reference.startsWith('upload://') ? createSignedUploadUrl(reference.slice('upload://'.length)) : reference;
}

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = pbkdf2Sync(String(password), salt, 120_000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, encoded) {
  const [salt, expected] = String(encoded || '').split(':');
  if (!salt || !expected) return false;
  const actual = hashPassword(password, salt).split(':')[1];
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function normalizePhone(value) {
  const phone = String(value || '').replace(/[\s-]+/g, '');
  return /^1[3-9]\d{9}$/.test(phone) ? phone : '';
}

export function phoneLookupHash(value) {
  const phone = normalizePhone(value);
  return phone ? createHmac('sha256', SECRET_KEY).update(`phone:${phone}`).digest('hex') : '';
}

export function encryptPhone(value) {
  const phone = normalizePhone(value);
  return phone ? encryptSecret(phone) : '';
}

export function maskedPhone(value) {
  const phone = normalizePhone(value);
  return phone ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '';
}

export function identitySubjectHash(provider, value) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const normalizedValue = String(value || '').trim();
  if (!normalizedProvider || !normalizedValue) return '';
  return createHash('sha256').update(`${normalizedProvider}:${normalizedValue}`).digest('hex');
}

export function opaqueTokenHash(value) {
  const token = String(value || '');
  return token ? createHmac('sha256', SECRET_KEY).update(`opaque:${token}`).digest('hex') : '';
}

export function createRefreshToken(tenantId = 'default') {
  const tenant = Buffer.from(String(tenantId || 'default')).toString('base64url');
  return `sc_rt_${tenant}_${randomBytes(48).toString('base64url')}`;
}

export function refreshTokenTenant(value) {
  const match = String(value || '').match(/^sc_rt_([A-Za-z0-9_-]+)_[A-Za-z0-9_-]+$/);
  if (!match) return '';
  try {
    return Buffer.from(match[1], 'base64url').toString('utf8').slice(0, 80);
  } catch {
    return '';
  }
}

function createSignedToken(user, { ttlSeconds, sessionId = '', tokenType = 'access' } = {}) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    sub: user.id,
    username: user.username,
    role: user.role,
    tenant: user.tenant_id || user.tenantId || 'default',
    ver: Number(user.token_version || user.tokenVersion || 0),
    typ: tokenType,
    jti: randomBytes(12).toString('base64url'),
    ...(sessionId ? { sid: sessionId } : {}),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
  }));
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
}

export function createToken(user) {
  return createSignedToken(user, { ttlSeconds: LEGACY_TOKEN_TTL_SECONDS, tokenType: 'legacy_access' });
}

export function createAccessToken(user, sessionId) {
  return createSignedToken(user, {
    ttlSeconds: ACCESS_TOKEN_TTL_SECONDS,
    sessionId,
    tokenType: 'access'
  });
}

export function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = sign(`${header}.${payload}`);
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export function publicUser(row) {
  if (!row) return null;
  const phone = decryptSecret(row.phone_encrypted || row.phoneEncrypted || '');
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    role: row.role,
    tenantId: row.tenant_id || row.tenantId || 'default',
    maskedPhone: maskedPhone(phone),
    phoneVerified: Boolean(row.phone_verified_at || row.phoneVerifiedAt)
  };
}
