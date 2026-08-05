CREATE TABLE IF NOT EXISTS pilot_invitations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  code_hint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'consumed', 'revoked')),
  used_phone_hash TEXT,
  used_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, code_hash)
);

CREATE INDEX IF NOT EXISTS idx_pilot_invitations_tenant_status
  ON pilot_invitations(tenant_id, status, expires_at);

ALTER TABLE pilot_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pilot_invitations_read ON pilot_invitations;
CREATE POLICY pilot_invitations_read ON pilot_invitations
  FOR SELECT USING (app_tenant_matches(tenant_id) AND (app_current_role() = 'authenticator' OR app_can_manage_users()));

DROP POLICY IF EXISTS pilot_invitations_manage ON pilot_invitations;
CREATE POLICY pilot_invitations_manage ON pilot_invitations
  FOR ALL USING (app_tenant_matches(tenant_id) AND (app_current_role() = 'authenticator' OR app_can_manage_users()))
  WITH CHECK (app_tenant_matches(tenant_id) AND (app_current_role() = 'authenticator' OR app_can_manage_users()));
