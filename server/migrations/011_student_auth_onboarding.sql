ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_encrypted TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agreement_version TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS agreement_accepted_at TEXT;

ALTER TABLE health_profiles ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE health_profiles ADD COLUMN IF NOT EXISTS allergy_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS dietary_labels_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS auth_verification_codes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  phone_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('register','reset_password')),
  code_hash TEXT NOT NULL,
  requested_ip TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_phone_hash
  ON users(tenant_id, phone_hash)
  WHERE phone_hash IS NOT NULL AND phone_hash <> '';
CREATE INDEX IF NOT EXISTS idx_auth_codes_phone_created
  ON auth_verification_codes(tenant_id, phone_hash, purpose, created_at);
