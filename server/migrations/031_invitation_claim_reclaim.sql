ALTER TABLE pilot_invitation_claims
  ADD COLUMN IF NOT EXISTS reclaimed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_pilot_invitation_claims_reclaim
  ON pilot_invitation_claims(tenant_id, claim_expires_at, reclaimed_at);

INSERT INTO schema_migrations(version) VALUES ('031_invitation_claim_reclaim')
ON CONFLICT (version) DO NOTHING;
