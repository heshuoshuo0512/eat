CREATE TABLE IF NOT EXISTS pilot_invitation_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  daily_quota INTEGER NOT NULL DEFAULT 0 CHECK(daily_quota BETWEEN 0 AND 5000),
  auto_issue INTEGER NOT NULL DEFAULT 1 CHECK(auto_issue IN (0, 1)),
  expires_after_days INTEGER NOT NULL DEFAULT 30 CHECK(expires_after_days BETWEEN 1 AND 365),
  claim_ttl_hours INTEGER NOT NULL DEFAULT 24 CHECK(claim_ttl_hours BETWEEN 1 AND 168),
  time_zone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pilot_invitation_batches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,
  daily_quota INTEGER NOT NULL CHECK(daily_quota BETWEEN 0 AND 5000),
  issued_count INTEGER NOT NULL DEFAULT 0 CHECK(issued_count >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'closed')),
  expires_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  auto_issued INTEGER NOT NULL DEFAULT 0 CHECK(auto_issued IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, business_date)
);

CREATE TABLE IF NOT EXISTS pilot_invitation_batch_items (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES pilot_invitation_batches(id) ON DELETE CASCADE,
  invitation_id TEXT NOT NULL REFERENCES pilot_invitations(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(batch_id, invitation_id),
  UNIQUE(invitation_id)
);

CREATE TABLE IF NOT EXISTS pilot_invitation_claims (
  invitation_id TEXT PRIMARY KEY REFERENCES pilot_invitations(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claimed_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claimed_at TEXT NOT NULL,
  claim_expires_at TEXT NOT NULL,
  revealed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pilot_invitation_settings_updated
  ON pilot_invitation_settings(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_pilot_invitation_batches_tenant_date
  ON pilot_invitation_batches(tenant_id, business_date, status);
CREATE INDEX IF NOT EXISTS idx_pilot_invitation_batch_items_invitation
  ON pilot_invitation_batch_items(tenant_id, invitation_id);
CREATE INDEX IF NOT EXISTS idx_pilot_invitation_claims_tenant_status
  ON pilot_invitation_claims(tenant_id, claimed_at, claim_expires_at);

ALTER TABLE pilot_invitation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pilot_invitation_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE pilot_invitation_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pilot_invitation_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pilot_invitation_settings_manage ON pilot_invitation_settings;
CREATE POLICY pilot_invitation_settings_manage ON pilot_invitation_settings
  FOR ALL USING (app_tenant_matches(tenant_id) AND (app_current_role() = 'authenticator' OR app_can_manage_users()))
  WITH CHECK (app_tenant_matches(tenant_id) AND (app_current_role() = 'authenticator' OR app_can_manage_users()));

DROP POLICY IF EXISTS pilot_invitation_batches_manage ON pilot_invitation_batches;
CREATE POLICY pilot_invitation_batches_manage ON pilot_invitation_batches
  FOR ALL USING (app_tenant_matches(tenant_id) AND (app_current_role() = 'authenticator' OR app_can_manage_users()))
  WITH CHECK (app_tenant_matches(tenant_id) AND (app_current_role() = 'authenticator' OR app_can_manage_users()));

DROP POLICY IF EXISTS pilot_invitation_batch_items_manage ON pilot_invitation_batch_items;
CREATE POLICY pilot_invitation_batch_items_manage ON pilot_invitation_batch_items
  FOR ALL USING (app_tenant_matches(tenant_id) AND (app_current_role() = 'authenticator' OR app_can_manage_users()))
  WITH CHECK (app_tenant_matches(tenant_id) AND (app_current_role() = 'authenticator' OR app_can_manage_users()));

DROP POLICY IF EXISTS pilot_invitation_claims_manage ON pilot_invitation_claims;
CREATE POLICY pilot_invitation_claims_manage ON pilot_invitation_claims
  FOR ALL USING (app_tenant_matches(tenant_id) AND (app_current_role() = 'authenticator' OR app_can_manage_users()))
  WITH CHECK (app_tenant_matches(tenant_id) AND (app_current_role() = 'authenticator' OR app_can_manage_users()));

INSERT INTO schema_migrations(version) VALUES ('030_invitation_batches')
ON CONFLICT (version) DO NOTHING;
