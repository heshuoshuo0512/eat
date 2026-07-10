-- Migration 003: contextual recommendation schema for PostgreSQL
-- Idempotent: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS patterns

-- Canteen hierarchy: parent/type/image
ALTER TABLE canteens ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES canteens(id) ON DELETE SET NULL;
ALTER TABLE canteens ADD COLUMN IF NOT EXISTS canteen_type TEXT NOT NULL DEFAULT 'primary';
DO $$ BEGIN
  ALTER TABLE canteens ADD CONSTRAINT canteens_canteen_type_check CHECK(canteen_type IN ('primary','sub'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE canteens ADD COLUMN IF NOT EXISTS image TEXT NOT NULL DEFAULT '';

-- Expanded nutrition on dishes
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS fiber REAL NOT NULL DEFAULT 0;
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS sodium REAL NOT NULL DEFAULT 0;
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS sugar REAL NOT NULL DEFAULT 0;
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS calcium REAL NOT NULL DEFAULT 0;
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS iron REAL NOT NULL DEFAULT 0;

-- Expanded health profile
ALTER TABLE health_profiles ADD COLUMN IF NOT EXISTS dietary_pattern TEXT NOT NULL DEFAULT 'balanced';
ALTER TABLE health_profiles ADD COLUMN IF NOT EXISTS spice_level INTEGER NOT NULL DEFAULT 3;
DO $$ BEGIN
  ALTER TABLE health_profiles ADD CONSTRAINT health_profiles_spice_level_check CHECK(spice_level BETWEEN 0 AND 5);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE health_profiles ADD COLUMN IF NOT EXISTS nutrition_focus_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE health_profiles ADD COLUMN IF NOT EXISTS prefer_low_crowd INTEGER NOT NULL DEFAULT 0;
ALTER TABLE health_profiles ADD COLUMN IF NOT EXISTS favorite_tags_json TEXT NOT NULL DEFAULT '[]';

-- User dish preferences (DB-backed)
CREATE TABLE IF NOT EXISTS user_dish_preferences (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dish_id TEXT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  favorite INTEGER NOT NULL DEFAULT 0,
  eaten_count INTEGER NOT NULL DEFAULT 0,
  drawn_count INTEGER NOT NULL DEFAULT 0,
  last_eaten_at TEXT,
  last_drawn_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, user_id, dish_id)
);

-- Campus environment (DB-backed)
CREATE TABLE IF NOT EXISTS campus_environment (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  temperature REAL NOT NULL DEFAULT 25,
  weather_label TEXT NOT NULL DEFAULT '晴',
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_user_dish_prefs_user ON user_dish_preferences(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_dish_prefs_dish ON user_dish_preferences(tenant_id, dish_id);
CREATE INDEX IF NOT EXISTS idx_canteens_parent ON canteens(tenant_id, parent_id);
