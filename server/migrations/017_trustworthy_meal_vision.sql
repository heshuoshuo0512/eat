CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS dish_reference_images (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  dish_id TEXT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT 'reference' CHECK(purpose IN ('reference','evaluation')),
  angle TEXT NOT NULL DEFAULT '',
  batch_key TEXT NOT NULL DEFAULT '',
  quality_status TEXT NOT NULL DEFAULT 'pending' CHECK(quality_status IN ('pending','approved','rejected')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, dish_id, upload_id)
);

CREATE TABLE IF NOT EXISTS dish_image_embeddings (
  reference_image_id TEXT PRIMARY KEY REFERENCES dish_reference_images(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  dish_id TEXT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dimension INTEGER NOT NULL DEFAULT 768 CHECK(dimension = 768),
  embedding vector(768),
  embedding_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','failed')),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dish_recipe_versions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  dish_id TEXT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  basis TEXT NOT NULL DEFAULT 'per_serving' CHECK(basis IN ('per_serving','per_100g')),
  serving_weight_grams DOUBLE PRECISION,
  yield_weight_grams DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','archived')),
  notes TEXT NOT NULL DEFAULT '',
  source_ids_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, dish_id, version)
);

CREATE TABLE IF NOT EXISTS dish_recipe_ingredients (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  recipe_version_id TEXT NOT NULL REFERENCES dish_recipe_versions(id) ON DELETE CASCADE,
  food_reference_id TEXT NOT NULL,
  ingredient_name TEXT NOT NULL,
  raw_weight_grams DOUBLE PRECISION NOT NULL CHECK(raw_weight_grams > 0),
  edible_ratio DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK(edible_ratio > 0 AND edible_ratio <= 1),
  retention_factor DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK(retention_factor > 0 AND retention_factor <= 1.5),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dish_nutrition_versions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  dish_id TEXT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  recipe_version_id TEXT REFERENCES dish_recipe_versions(id) ON DELETE SET NULL,
  version TEXT NOT NULL,
  basis TEXT NOT NULL DEFAULT 'per_serving' CHECK(basis IN ('per_serving','per_100g')),
  portion_grams DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('unknown','estimated','verified')),
  source_type TEXT NOT NULL DEFAULT 'recipe' CHECK(source_type IN ('recipe','manual','lab','vision')),
  nutrient_ranges_json TEXT NOT NULL DEFAULT '{}',
  source_ids_json TEXT NOT NULL DEFAULT '[]',
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, dish_id, version)
);

CREATE TABLE IF NOT EXISTS meal_vision_analyses (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'single_dish' CHECK(mode IN ('single_dish')),
  context_json TEXT NOT NULL DEFAULT '{}',
  portion_json TEXT NOT NULL DEFAULT '{}',
  observation_json TEXT NOT NULL DEFAULT '{}',
  candidates_json TEXT NOT NULL DEFAULT '[]',
  match_status TEXT NOT NULL DEFAULT 'unresolved' CHECK(match_status IN ('auto_matched','needs_confirmation','unresolved')),
  selected_dish_id TEXT REFERENCES dishes(id) ON DELETE SET NULL,
  nutrition_json TEXT NOT NULL DEFAULT '{}',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL DEFAULT '',
  image_hash TEXT NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meal_vision_feedback (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  analysis_id TEXT NOT NULL REFERENCES meal_vision_analyses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feedback_type TEXT NOT NULL CHECK(feedback_type IN ('confirmed','corrected','unresolved')),
  confirmed_dish_id TEXT REFERENCES dishes(id) ON DELETE SET NULL,
  rejected_candidate_ids_json TEXT NOT NULL DEFAULT '[]',
  portion_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id, analysis_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dish_reference_images_dish
  ON dish_reference_images(tenant_id, dish_id, purpose, quality_status);
CREATE INDEX IF NOT EXISTS idx_dish_image_embeddings_dish
  ON dish_image_embeddings(tenant_id, dish_id, status);
CREATE INDEX IF NOT EXISTS idx_dish_image_embeddings_vector
  ON dish_image_embeddings USING hnsw (embedding vector_cosine_ops)
  WHERE status = 'ready' AND embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dish_recipe_versions_dish
  ON dish_recipe_versions(tenant_id, dish_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_dish_nutrition_versions_dish
  ON dish_nutrition_versions(tenant_id, dish_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_meal_vision_analyses_user
  ON meal_vision_analyses(tenant_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_meal_vision_feedback_analysis
  ON meal_vision_feedback(tenant_id, analysis_id);

ALTER TABLE dish_reference_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_image_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_recipe_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_nutrition_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_vision_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_vision_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vision_reference_upload_read ON uploads;
CREATE POLICY vision_reference_upload_read ON uploads FOR SELECT
  USING (app_tenant_matches(tenant_id) AND EXISTS (
    SELECT 1 FROM dish_reference_images reference_image
    WHERE reference_image.upload_id = uploads.id
      AND reference_image.tenant_id = uploads.tenant_id
      AND reference_image.quality_status = 'approved'
      AND reference_image.purpose = 'reference'
  ));
DROP POLICY IF EXISTS vision_catalog_read ON dish_reference_images;
CREATE POLICY vision_catalog_read ON dish_reference_images FOR SELECT
  USING (app_tenant_matches(tenant_id) AND quality_status = 'approved' AND purpose = 'reference');
DROP POLICY IF EXISTS vision_catalog_staff ON dish_reference_images;
CREATE POLICY vision_catalog_staff ON dish_reference_images FOR ALL
  USING (app_tenant_matches(tenant_id) AND app_can_write_catalog())
  WITH CHECK (app_tenant_matches(tenant_id) AND app_can_write_catalog());
DROP POLICY IF EXISTS vision_embedding_read ON dish_image_embeddings;
CREATE POLICY vision_embedding_read ON dish_image_embeddings FOR SELECT
  USING (app_tenant_matches(tenant_id) AND status = 'ready' AND EXISTS (
    SELECT 1 FROM dish_reference_images reference_image
    WHERE reference_image.id = reference_image_id
      AND reference_image.tenant_id = dish_image_embeddings.tenant_id
      AND reference_image.quality_status = 'approved'
      AND reference_image.purpose = 'reference'
  ));
DROP POLICY IF EXISTS vision_embedding_staff ON dish_image_embeddings;
CREATE POLICY vision_embedding_staff ON dish_image_embeddings FOR ALL
  USING (app_tenant_matches(tenant_id) AND (app_can_write_catalog() OR app_current_role() = 'worker'))
  WITH CHECK (app_tenant_matches(tenant_id) AND (app_can_write_catalog() OR app_current_role() = 'worker'));
DROP POLICY IF EXISTS dish_recipe_read ON dish_recipe_versions;
CREATE POLICY dish_recipe_read ON dish_recipe_versions FOR SELECT
  USING (app_tenant_matches(tenant_id) AND status = 'approved');
DROP POLICY IF EXISTS dish_recipe_staff ON dish_recipe_versions;
CREATE POLICY dish_recipe_staff ON dish_recipe_versions FOR ALL
  USING (app_tenant_matches(tenant_id) AND app_can_write_catalog())
  WITH CHECK (app_tenant_matches(tenant_id) AND app_can_write_catalog());
DROP POLICY IF EXISTS dish_recipe_ingredient_read ON dish_recipe_ingredients;
CREATE POLICY dish_recipe_ingredient_read ON dish_recipe_ingredients FOR SELECT
  USING (app_tenant_matches(tenant_id) AND EXISTS (
    SELECT 1 FROM dish_recipe_versions recipe
    WHERE recipe.id = recipe_version_id
      AND recipe.tenant_id = dish_recipe_ingredients.tenant_id
      AND recipe.status = 'approved'
  ));
DROP POLICY IF EXISTS dish_recipe_ingredient_staff ON dish_recipe_ingredients;
CREATE POLICY dish_recipe_ingredient_staff ON dish_recipe_ingredients FOR ALL
  USING (app_tenant_matches(tenant_id) AND app_can_write_catalog())
  WITH CHECK (app_tenant_matches(tenant_id) AND app_can_write_catalog());
DROP POLICY IF EXISTS dish_nutrition_read ON dish_nutrition_versions;
CREATE POLICY dish_nutrition_read ON dish_nutrition_versions FOR SELECT
  USING (app_tenant_matches(tenant_id) AND status IN ('estimated','verified'));
DROP POLICY IF EXISTS dish_nutrition_staff ON dish_nutrition_versions;
CREATE POLICY dish_nutrition_staff ON dish_nutrition_versions FOR ALL
  USING (app_tenant_matches(tenant_id) AND app_can_write_catalog())
  WITH CHECK (app_tenant_matches(tenant_id) AND app_can_write_catalog());
DROP POLICY IF EXISTS meal_vision_analysis_owner ON meal_vision_analyses;
CREATE POLICY meal_vision_analysis_owner ON meal_vision_analyses FOR ALL
  USING (app_tenant_matches(tenant_id) AND (user_id = app_current_user_id() OR app_is_tenant_staff()))
  WITH CHECK (app_tenant_matches(tenant_id) AND (user_id = app_current_user_id() OR app_is_tenant_staff()));
DROP POLICY IF EXISTS meal_vision_feedback_owner ON meal_vision_feedback;
CREATE POLICY meal_vision_feedback_owner ON meal_vision_feedback FOR ALL
  USING (app_tenant_matches(tenant_id) AND (user_id = app_current_user_id() OR app_is_tenant_staff()))
  WITH CHECK (app_tenant_matches(tenant_id) AND (user_id = app_current_user_id() OR app_is_tenant_staff()));
