import { createHash, randomUUID } from 'node:crypto';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  createAccessToken,
  createRefreshToken,
  opaqueTokenHash
} from '../../security.js';

function now() {
  return new Date().toISOString();
}

function expiresAt(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function summarizeDevice(value) {
  return String(value || 'unknown').replace(/[\r\n]/g, ' ').trim().slice(0, 160) || 'unknown';
}

export function deviceFingerprint({ userAgent = '', clientIp = '' } = {}) {
  return createHash('sha256')
    .update(`${String(userAgent).slice(0, 512)}\n${String(clientIp).slice(0, 128)}`)
    .digest('hex');
}

async function inTransaction(db, operation) {
  if (typeof db.transaction === 'function') return db.transaction(operation);
  await db.exec('BEGIN IMMEDIATE');
  try {
    const result = await operation(db);
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    try { await db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function authPayload(user, sessionId, refreshToken) {
  const accessToken = createAccessToken(user, sessionId);
  return {
    token: accessToken,
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshExpiresIn: REFRESH_TOKEN_TTL_SECONDS
  };
}

export async function createAuthSession(db, user, { userAgent = '', clientIp = '' } = {}) {
  const tenantId = user.tenant_id || user.tenantId || 'default';
  const sessionId = `session-${randomUUID()}`;
  const familyId = `family-${randomUUID()}`;
  const refreshToken = createRefreshToken(tenantId);
  const current = now();
  const sessionExpiresAt = expiresAt(REFRESH_TOKEN_TTL_SECONDS);
  await inTransaction(db, async (transactionDb) => {
    await transactionDb.prepare(`
      INSERT INTO auth_sessions (
        id, tenant_id, user_id, refresh_family_id, device_hash, device_summary,
        status, last_used_at, expires_at, revoked_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, ?, ?)
    `).run(
      sessionId,
      tenantId,
      user.id,
      familyId,
      deviceFingerprint({ userAgent, clientIp }),
      summarizeDevice(userAgent),
      current,
      sessionExpiresAt,
      current,
      current
    );
    await transactionDb.prepare(`
      INSERT INTO auth_refresh_tokens (
        token_hash, tenant_id, session_id, family_id, status, expires_at, used_at, created_at
      ) VALUES (?, ?, ?, ?, 'active', ?, NULL, ?)
    `).run(opaqueTokenHash(refreshToken), tenantId, sessionId, familyId, sessionExpiresAt, current);
  });
  return authPayload(user, sessionId, refreshToken);
}

async function revokeFamily(db, familyId, revokedAt = now()) {
  await db.prepare(`
    UPDATE auth_sessions
    SET status = 'revoked', revoked_at = COALESCE(revoked_at, ?), updated_at = ?
    WHERE refresh_family_id = ? AND status <> 'revoked'
  `).run(revokedAt, revokedAt, familyId);
  await db.prepare(`
    UPDATE auth_refresh_tokens
    SET status = 'revoked', used_at = COALESCE(used_at, ?)
    WHERE family_id = ? AND status <> 'revoked'
  `).run(revokedAt, familyId);
}

export async function rotateAuthSession(db, refreshToken) {
  const tokenHash = opaqueTokenHash(refreshToken);
  if (!tokenHash) {
    throw Object.assign(new Error('Refresh Token 无效'), { status: 401, code: 'INVALID_REFRESH_TOKEN' });
  }

  const result = await inTransaction(db, async (transactionDb) => {
    const selectSql = `
      SELECT
        refresh.token_hash, refresh.tenant_id, refresh.session_id, refresh.family_id,
        refresh.status AS refresh_status, refresh.expires_at AS refresh_expires_at,
        session.status AS session_status, session.expires_at AS session_expires_at,
        session.user_id
      FROM auth_refresh_tokens refresh
      JOIN auth_sessions session ON session.id = refresh.session_id
      WHERE refresh.token_hash = ?${transactionDb.isPostgres ? ' FOR UPDATE' : ''}
    `;
    const record = await transactionDb.prepare(selectSql).get(tokenHash);
    if (!record) {
      throw Object.assign(new Error('Refresh Token 无效'), { status: 401, code: 'INVALID_REFRESH_TOKEN' });
    }

    if (record.refresh_status !== 'active') {
      await revokeFamily(transactionDb, record.family_id);
      return { sessionError: { message: '检测到 Refresh Token 重放，会话族已撤销', code: 'REFRESH_TOKEN_REUSED' } };
    }

    const current = now();
    if (
      record.session_status !== 'active'
      || Date.parse(record.refresh_expires_at) <= Date.now()
      || Date.parse(record.session_expires_at) <= Date.now()
    ) {
      await revokeFamily(transactionDb, record.family_id, current);
      return { sessionError: { message: 'Refresh Token 已过期', code: 'REFRESH_TOKEN_EXPIRED' } };
    }

    const consumed = await transactionDb.prepare(`
      UPDATE auth_refresh_tokens
      SET status = 'rotated', used_at = ?
      WHERE token_hash = ? AND status = 'active'
    `).run(current, tokenHash);
    if (Number(consumed.changes || 0) !== 1) {
      await revokeFamily(transactionDb, record.family_id, current);
      return { sessionError: { message: '检测到 Refresh Token 重放，会话族已撤销', code: 'REFRESH_TOKEN_REUSED' } };
    }

    const user = await transactionDb.prepare('SELECT * FROM users WHERE id = ?').get(record.user_id);
    if (!user) {
      await revokeFamily(transactionDb, record.family_id, current);
      return { sessionError: { message: '会话用户不存在', code: 'SESSION_USER_NOT_FOUND' } };
    }

    const nextRefreshToken = createRefreshToken(record.tenant_id);
    await transactionDb.prepare(`
      INSERT INTO auth_refresh_tokens (
        token_hash, tenant_id, session_id, family_id, status, expires_at, used_at, created_at
      ) VALUES (?, ?, ?, ?, 'active', ?, NULL, ?)
    `).run(
      opaqueTokenHash(nextRefreshToken),
      record.tenant_id,
      record.session_id,
      record.family_id,
      record.session_expires_at,
      current
    );
    await transactionDb.prepare(`
      UPDATE auth_sessions SET last_used_at = ?, updated_at = ? WHERE id = ?
    `).run(current, current, record.session_id);
    return { user, ...authPayload(user, record.session_id, nextRefreshToken) };
  });
  if (result?.sessionError) {
    throw Object.assign(new Error(result.sessionError.message), {
      status: 401,
      code: result.sessionError.code
    });
  }
  return result;
}

export async function validateAccessSession(db, payload) {
  if (!payload?.sid) {
    const allowLegacy = process.env.ALLOW_LEGACY_STATELESS_TOKENS === '1'
      || process.env.ALLOW_LEGACY_STATELESS_TOKENS === 'true'
      || process.env.NODE_ENV !== 'production';
    return allowLegacy;
  }
  const session = await db.prepare(`
    SELECT id, user_id, tenant_id, status, expires_at
    FROM auth_sessions WHERE id = ? AND user_id = ?
  `).get(payload.sid, payload.sub);
  return Boolean(
    session
    && session.status === 'active'
    && Date.parse(session.expires_at) > Date.now()
    && (!payload.tenant || payload.tenant === session.tenant_id)
  );
}

export async function revokeSession(db, { sessionId = '', refreshToken = '' } = {}) {
  let session = null;
  if (sessionId) {
    session = await db.prepare('SELECT id, refresh_family_id FROM auth_sessions WHERE id = ?').get(sessionId);
  } else if (refreshToken) {
    session = await db.prepare(`
      SELECT session.id, session.refresh_family_id
      FROM auth_refresh_tokens refresh
      JOIN auth_sessions session ON session.id = refresh.session_id
      WHERE refresh.token_hash = ?
    `).get(opaqueTokenHash(refreshToken));
  }
  if (!session) return false;
  await revokeFamily(db, session.refresh_family_id);
  return true;
}

export async function revokeAllUserSessions(db, userId) {
  const current = now();
  await db.prepare(`
    UPDATE auth_sessions
    SET status = 'revoked', revoked_at = COALESCE(revoked_at, ?), updated_at = ?
    WHERE user_id = ? AND status = 'active'
  `).run(current, current, userId);
  await db.prepare(`
    UPDATE auth_refresh_tokens
    SET status = 'revoked', used_at = COALESCE(used_at, ?)
    WHERE session_id IN (SELECT id FROM auth_sessions WHERE user_id = ?)
      AND status <> 'revoked'
  `).run(current, userId);
}
