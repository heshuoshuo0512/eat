-- Versioned, review-only descriptions derived from the tenant catalog.

CREATE TABLE IF NOT EXISTS catalog_introduction_batches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  catalog_data_version TEXT NOT NULL DEFAULT '',
  catalog_snapshot_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'preparing'
    CHECK(status IN ('preparing','probing','generating','generated','approved','paused','failed','rolled_back')),
  entity_count INTEGER NOT NULL DEFAULT 0 CHECK(entity_count >= 0),
  completed_count INTEGER NOT NULL DEFAULT 0 CHECK(completed_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK(failed_count >= 0),
  concurrency_json TEXT NOT NULL DEFAULT '{}',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_by TEXT,
  reviewed_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, catalog_snapshot_hash, prompt_version, model)
);

CREATE TABLE IF NOT EXISTS catalog_entity_introductions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  batch_id TEXT NOT NULL REFERENCES catalog_introduction_batches(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('dish','stall','canteen')),
  hierarchy_level TEXT NOT NULL CHECK(hierarchy_level IN ('dish','stall','area','venue')),
  entity_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  factual_summary TEXT NOT NULL DEFAULT '',
  recommendation_copy TEXT NOT NULL DEFAULT '',
  claim_evidence_json TEXT NOT NULL DEFAULT '[]',
  semantic_labels_json TEXT NOT NULL DEFAULT '[]',
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  evidence_snapshot_json TEXT NOT NULL DEFAULT '{}',
  boundary_codes_json TEXT NOT NULL DEFAULT '[]',
  confidence_score REAL NOT NULL DEFAULT 0 CHECK(confidence_score BETWEEN 0 AND 1),
  confidence_level TEXT NOT NULL DEFAULT 'low' CHECK(confidence_level IN ('high','medium','low')),
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'generated'
    CHECK(status IN ('generated','schema_validated','approved','rejected','retired')),
  previous_introduction_id TEXT,
  error TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, entity_type, entity_id, version),
  UNIQUE(tenant_id, entity_type, entity_id, batch_id, input_hash)
);

CREATE INDEX IF NOT EXISTS idx_catalog_intro_batches_tenant_status
  ON catalog_introduction_batches(tenant_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_catalog_introductions_tenant_batch
  ON catalog_entity_introductions(tenant_id, batch_id, status, hierarchy_level);
CREATE INDEX IF NOT EXISTS idx_catalog_introductions_entity
  ON catalog_entity_introductions(tenant_id, entity_type, entity_id, version DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_introductions_one_approved
  ON catalog_entity_introductions(tenant_id, entity_type, entity_id)
  WHERE status = 'approved';

ALTER TABLE catalog_introduction_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_entity_introductions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_intro_batches_staff ON catalog_introduction_batches;
CREATE POLICY catalog_intro_batches_staff ON catalog_introduction_batches
  FOR ALL USING (
    app_tenant_matches(tenant_id)
    AND (app_current_role() = 'worker' OR app_can_manage_canteens())
  ) WITH CHECK (
    app_tenant_matches(tenant_id)
    AND (app_current_role() = 'worker' OR app_can_manage_canteens())
  );

DROP POLICY IF EXISTS catalog_introductions_read ON catalog_entity_introductions;
CREATE POLICY catalog_introductions_read ON catalog_entity_introductions
  FOR SELECT USING (
    app_tenant_matches(tenant_id)
    AND (
      status = 'approved'
      OR app_current_role() = 'worker'
      OR app_is_tenant_staff()
    )
  );

DROP POLICY IF EXISTS catalog_introductions_staff_write ON catalog_entity_introductions;
CREATE POLICY catalog_introductions_staff_write ON catalog_entity_introductions
  FOR ALL USING (
    app_tenant_matches(tenant_id)
    AND (app_current_role() = 'worker' OR app_can_manage_canteens())
  ) WITH CHECK (
    app_tenant_matches(tenant_id)
    AND (app_current_role() = 'worker' OR app_can_manage_canteens())
  );
