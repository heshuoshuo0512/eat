-- Structured food-safety and data-provenance facts for retrieval confidence.
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS seasonings_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS additives_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS safety_declarations_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS nutrition_fact_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS recipe_fact_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS halal_fact_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS dietary_fact_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS spice_level INTEGER;
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS spice_fact_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS fact_source TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS fact_verified_at TEXT;
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS fact_expires_at TEXT;
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS data_version TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS synthetic INTEGER NOT NULL DEFAULT 0;

UPDATE dishes
SET safety_declarations_json = CASE
  WHEN allergens_json::jsonb = '[]'::jsonb THEN
    '[{"allergenCode":"*","status":"unknown","source":"legacy_empty_allergens","dataVersion":"legacy"}]'
  ELSE (
    SELECT jsonb_agg(jsonb_build_object(
      'allergenCode', value,
      'status', 'confirmed_present',
      'source', 'legacy_allergens_json',
      'dataVersion', 'legacy'
    ))::text
    FROM jsonb_array_elements_text(allergens_json::jsonb)
  )
END
WHERE safety_declarations_json IS NULL OR safety_declarations_json = '[]';

ALTER TABLE dishes DROP CONSTRAINT IF EXISTS dishes_spice_level_check;
ALTER TABLE dishes ADD CONSTRAINT dishes_spice_level_check CHECK (spice_level IS NULL OR spice_level BETWEEN 0 AND 5);
ALTER TABLE dishes DROP CONSTRAINT IF EXISTS dishes_nutrition_fact_status_check;
ALTER TABLE dishes ADD CONSTRAINT dishes_nutrition_fact_status_check CHECK (nutrition_fact_status IN ('unknown','estimated','verified'));
ALTER TABLE dishes DROP CONSTRAINT IF EXISTS dishes_recipe_fact_status_check;
ALTER TABLE dishes ADD CONSTRAINT dishes_recipe_fact_status_check CHECK (recipe_fact_status IN ('unknown','estimated','verified'));
ALTER TABLE dishes DROP CONSTRAINT IF EXISTS dishes_halal_fact_status_check;
ALTER TABLE dishes ADD CONSTRAINT dishes_halal_fact_status_check CHECK (halal_fact_status IN ('unknown','estimated','verified'));
ALTER TABLE dishes DROP CONSTRAINT IF EXISTS dishes_dietary_fact_status_check;
ALTER TABLE dishes ADD CONSTRAINT dishes_dietary_fact_status_check CHECK (dietary_fact_status IN ('unknown','estimated','verified'));
ALTER TABLE dishes DROP CONSTRAINT IF EXISTS dishes_spice_fact_status_check;
ALTER TABLE dishes ADD CONSTRAINT dishes_spice_fact_status_check CHECK (spice_fact_status IN ('unknown','estimated','verified'));
