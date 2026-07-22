-- Merge the feature/sql data contract without replacing the existing campus and Agent model.
-- Safe for PostgreSQL databases that already ran the enterprise baseline.

ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS regional_taste TEXT NOT NULL DEFAULT '';
ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS allergens_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE health_profiles
  ADD COLUMN IF NOT EXISTS allergies_json TEXT NOT NULL DEFAULT '[]';

UPDATE dishes
SET regional_taste = ''
WHERE regional_taste IS NULL;

UPDATE dishes
SET allergens_json = '[]'
WHERE allergens_json IS NULL OR btrim(allergens_json) = '';

UPDATE health_profiles
SET allergies_json = '[]'
WHERE allergies_json IS NULL OR btrim(allergies_json) = '';

ALTER TABLE dishes ALTER COLUMN regional_taste SET DEFAULT '';
ALTER TABLE dishes ALTER COLUMN regional_taste SET NOT NULL;
ALTER TABLE dishes ALTER COLUMN allergens_json SET DEFAULT '[]';
ALTER TABLE dishes ALTER COLUMN allergens_json SET NOT NULL;
ALTER TABLE health_profiles ALTER COLUMN allergies_json SET DEFAULT '[]';
ALTER TABLE health_profiles ALTER COLUMN allergies_json SET NOT NULL;
