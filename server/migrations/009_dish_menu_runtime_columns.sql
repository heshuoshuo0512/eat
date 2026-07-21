-- Complete the PostgreSQL runtime contract used by dish search, menus and orders.
-- This remains safe to run after either the legacy runtime migrations or the
-- explicit PostgreSQL baseline.

ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS allergens_json TEXT NOT NULL DEFAULT '[]';

UPDATE dishes
SET allergens_json = '[]'
WHERE allergens_json IS NULL OR btrim(allergens_json) = '';

ALTER TABLE dishes ALTER COLUMN allergens_json SET DEFAULT '[]';
ALTER TABLE dishes ALTER COLUMN allergens_json SET NOT NULL;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS supply_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS serving_start TEXT NOT NULL DEFAULT '11:00';
ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS serving_end TEXT NOT NULL DEFAULT '13:30';

UPDATE menu_items
SET supply_count = 0
WHERE supply_count IS NULL;

UPDATE menu_items
SET serving_start = '11:00'
WHERE serving_start IS NULL OR btrim(serving_start) = '';

UPDATE menu_items
SET serving_end = '13:30'
WHERE serving_end IS NULL OR btrim(serving_end) = '';

ALTER TABLE menu_items ALTER COLUMN supply_count SET DEFAULT 0;
ALTER TABLE menu_items ALTER COLUMN supply_count SET NOT NULL;
ALTER TABLE menu_items ALTER COLUMN serving_start SET DEFAULT '11:00';
ALTER TABLE menu_items ALTER COLUMN serving_start SET NOT NULL;
ALTER TABLE menu_items ALTER COLUMN serving_end SET DEFAULT '13:30';
ALTER TABLE menu_items ALTER COLUMN serving_end SET NOT NULL;
