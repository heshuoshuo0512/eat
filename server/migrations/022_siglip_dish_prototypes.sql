CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS dish_class_prototypes (
  tenant_id TEXT NOT NULL DEFAULT 'default',
  dish_id TEXT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  model_version TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  venue_name TEXT NOT NULL,
  stall_name TEXT NOT NULL,
  dimension INTEGER NOT NULL DEFAULT 768 CHECK(dimension = 768),
  embedding vector(768) NOT NULL,
  embedding_json TEXT NOT NULL,
  image_count INTEGER NOT NULL CHECK(image_count > 0),
  status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','deployed','retired')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id, dish_id, model_version)
);

CREATE INDEX IF NOT EXISTS idx_dish_class_prototypes_dish
  ON dish_class_prototypes(tenant_id, dish_id, status);
CREATE INDEX IF NOT EXISTS idx_dish_class_prototypes_vector
  ON dish_class_prototypes USING hnsw (embedding vector_cosine_ops)
  WHERE status = 'deployed';

ALTER TABLE dish_class_prototypes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dish_class_prototypes_read ON dish_class_prototypes;
CREATE POLICY dish_class_prototypes_read ON dish_class_prototypes FOR SELECT
  USING (app_tenant_matches(tenant_id) AND status = 'deployed');
DROP POLICY IF EXISTS dish_class_prototypes_worker ON dish_class_prototypes;
CREATE POLICY dish_class_prototypes_worker ON dish_class_prototypes FOR ALL
  USING (app_tenant_matches(tenant_id) AND app_current_role() = 'worker')
  WITH CHECK (app_tenant_matches(tenant_id) AND app_current_role() = 'worker');
