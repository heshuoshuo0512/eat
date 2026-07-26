import { randomUUID } from 'node:crypto';
import { identitySubjectHash, phoneLookupHash } from '../../security.js';
import { serializeJson } from '../../database.js';

function timestamp() {
  return new Date().toISOString();
}

export function identityHash(provider, subject) {
  if (provider === 'phone') return phoneLookupHash(subject);
  return identitySubjectHash(provider, provider === 'password' ? String(subject || '').toLowerCase() : subject);
}

export async function assertIdentityAvailable(db, { tenantId = 'default', provider, subjectHash, userId = '' }) {
  const existing = await db.prepare(
    'SELECT user_id FROM user_identities WHERE tenant_id = ? AND provider = ? AND subject_hash = ?'
  ).get(tenantId, provider, subjectHash);
  if (existing && existing.user_id !== userId) {
    throw Object.assign(new Error('该登录身份已绑定其他账号'), {
      status: 409,
      code: 'IDENTITY_BINDING_CONFLICT'
    });
  }
  return existing || null;
}

export async function upsertIdentity(db, {
  tenantId = 'default',
  userId,
  provider,
  subjectHash,
  subjectEncrypted = null,
  verifiedAt = null,
  metadata = {}
}) {
  if (!userId || !provider || !subjectHash) return null;
  await assertIdentityAvailable(db, { tenantId, provider, subjectHash, userId });
  const current = timestamp();
  const id = `identity-${randomUUID()}`;
  await db.prepare(`
    INSERT INTO user_identities (
      id, tenant_id, user_id, provider, subject_hash, subject_encrypted,
      verified_at, status, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    ON CONFLICT(tenant_id, provider, subject_hash) DO UPDATE SET
      subject_encrypted = excluded.subject_encrypted,
      verified_at = COALESCE(excluded.verified_at, user_identities.verified_at),
      status = 'active',
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run(
    id,
    tenantId,
    userId,
    provider,
    subjectHash,
    subjectEncrypted,
    verifiedAt,
    serializeJson(metadata),
    current,
    current
  );
  return db.prepare(
    'SELECT * FROM user_identities WHERE tenant_id = ? AND provider = ? AND subject_hash = ?'
  ).get(tenantId, provider, subjectHash);
}

export async function syncLegacyUserIdentities(db, user) {
  if (!user?.id) return;
  const tenantId = user.tenant_id || user.tenantId || 'default';
  await upsertIdentity(db, {
    tenantId,
    userId: user.id,
    provider: 'password',
    subjectHash: identityHash('password', user.username),
    verifiedAt: user.created_at || user.createdAt || timestamp(),
    metadata: { source: 'users.username' }
  });
  if (user.phone_hash) {
    await upsertIdentity(db, {
      tenantId,
      userId: user.id,
      provider: 'phone',
      subjectHash: user.phone_hash,
      subjectEncrypted: user.phone_encrypted || null,
      verifiedAt: user.phone_verified_at || null,
      metadata: { source: 'users.phone_hash' }
    });
  }
  if (user.wechat_openid) {
    await upsertIdentity(db, {
      tenantId,
      userId: user.id,
      provider: 'wechat_miniapp',
      subjectHash: identityHash('wechat_miniapp', user.wechat_openid),
      verifiedAt: user.created_at || user.createdAt || timestamp(),
      metadata: { source: 'users.wechat_openid' }
    });
  }
}
