import { createCipheriv, createDecipheriv, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

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
const TOKEN_TTL_SECONDS = 60 * 60 * 8;
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

export function createToken(user) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ sub: user.id, username: user.username, role: user.role, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }));
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
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
  return { id: row.id, username: row.username, nickname: row.nickname, role: row.role, tenantId: row.tenant_id || row.tenantId || 'default' };
}
