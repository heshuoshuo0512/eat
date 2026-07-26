CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users ADD COLUMN IF NOT EXISTS wechat_openid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wechat_openid
  ON users(wechat_openid)
  WHERE wechat_openid IS NOT NULL AND wechat_openid <> '';

CREATE TABLE IF NOT EXISTS user_identities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('password','phone','wechat_miniapp')),
  subject_hash TEXT NOT NULL,
  subject_encrypted TEXT,
  verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, provider, subject_hash)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_family_id TEXT NOT NULL,
  device_hash TEXT NOT NULL DEFAULT '',
  device_summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
  last_used_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  session_id TEXT NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','rotated','revoked')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE uploads ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS storage_provider TEXT NOT NULL DEFAULT 'local';
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS object_version TEXT NOT NULL DEFAULT 'v1';

ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_visibility_check;
ALTER TABLE uploads ADD CONSTRAINT uploads_visibility_check CHECK (visibility IN ('private','public'));

CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','succeeded','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  locked_at TEXT,
  locked_by TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user
  ON user_identities(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_status
  ON auth_sessions(tenant_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_family
  ON auth_sessions(refresh_family_id, status);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_session
  ON auth_refresh_tokens(session_id, status);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_tenant_family
  ON auth_refresh_tokens(tenant_id, family_id, status);
CREATE INDEX IF NOT EXISTS idx_outbox_claim
  ON outbox_events(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_tenant_created
  ON outbox_events(tenant_id, created_at);

INSERT INTO user_identities (
  id, tenant_id, user_id, provider, subject_hash, subject_encrypted,
  verified_at, status, metadata_json, created_at, updated_at
)
SELECT
  'identity-password-' || id,
  tenant_id,
  id,
  'password',
  encode(digest('password:' || lower(username), 'sha256'), 'hex'),
  NULL,
  created_at,
  'active',
  '{"source":"legacy_users"}',
  created_at,
  updated_at
FROM users
ON CONFLICT (tenant_id, provider, subject_hash) DO NOTHING;

INSERT INTO user_identities (
  id, tenant_id, user_id, provider, subject_hash, subject_encrypted,
  verified_at, status, metadata_json, created_at, updated_at
)
SELECT
  'identity-phone-' || id,
  tenant_id,
  id,
  'phone',
  phone_hash,
  phone_encrypted,
  phone_verified_at,
  'active',
  '{"source":"legacy_users"}',
  created_at,
  updated_at
FROM users
WHERE phone_hash IS NOT NULL AND phone_hash <> ''
ON CONFLICT (tenant_id, provider, subject_hash) DO NOTHING;

INSERT INTO user_identities (
  id, tenant_id, user_id, provider, subject_hash, subject_encrypted,
  verified_at, status, metadata_json, created_at, updated_at
)
SELECT
  'identity-wechat-' || id,
  tenant_id,
  id,
  'wechat_miniapp',
  encode(digest('wechat_miniapp:' || wechat_openid, 'sha256'), 'hex'),
  NULL,
  created_at,
  'active',
  '{"source":"legacy_users"}',
  created_at,
  updated_at
FROM users
WHERE wechat_openid IS NOT NULL AND wechat_openid <> ''
ON CONFLICT (tenant_id, provider, subject_hash) DO NOTHING;
