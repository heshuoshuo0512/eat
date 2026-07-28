-- AI-generated dish annotations are an isolated review layer. They must never
-- overwrite tenant facts until a human explicitly promotes them.
CREATE TABLE IF NOT EXISTS dish_ai_annotations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  dish_id TEXT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  annotation_json TEXT NOT NULL DEFAULT '{}',
  field_confidence_json TEXT NOT NULL DEFAULT '{}',
  linked_concept_ids_json TEXT NOT NULL DEFAULT '[]',
  source_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'generated'
    CHECK(status IN ('generated','schema_validated','approved','rejected')),
  error TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, dish_id, batch_id, input_hash)
);

CREATE INDEX IF NOT EXISTS idx_dish_ai_annotations_tenant_status
  ON dish_ai_annotations(tenant_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_dish_ai_annotations_dish
  ON dish_ai_annotations(tenant_id, dish_id, created_at DESC);

ALTER TABLE dish_ai_annotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dish_ai_annotations_staff ON dish_ai_annotations;
CREATE POLICY dish_ai_annotations_staff ON dish_ai_annotations
  FOR ALL USING (
    app_tenant_matches(tenant_id)
    AND (app_current_role() = 'worker' OR app_can_write_catalog())
  ) WITH CHECK (
    app_tenant_matches(tenant_id)
    AND (app_current_role() = 'worker' OR app_can_write_catalog())
  );
