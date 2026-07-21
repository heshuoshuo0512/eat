ALTER TABLE stalls
  ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES stalls(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_stalls_tenant_parent
  ON stalls(tenant_id, parent_id);
