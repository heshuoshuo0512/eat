-- Smart Canteen PostgreSQL initial schema
-- Uses same column names/types as SQLite for query compatibility.
-- PG-specific extras (tsvector, pgvector) are additive columns.
-- Apply with: psql "$DATABASE_URL" -f migrations/postgres/001_initial_schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- pgvector extension (optional — silently skipped if not installed)
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student', 'admin')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canteens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  hours TEXT NOT NULL,
  crowd_level INTEGER NOT NULL DEFAULT 30 CHECK(crowd_level BETWEEN 0 AND 100),
  tags_json TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stalls (
  id TEXT PRIMARY KEY,
  canteen_id TEXT NOT NULL REFERENCES canteens(id) ON DELETE CASCADE,
  floor TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  rating REAL NOT NULL DEFAULT 4.5 CHECK(rating BETWEEN 0 AND 5),
  avg_price REAL NOT NULL DEFAULT 0,
  open INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dishes (
  id TEXT PRIMARY KEY,
  stall_id TEXT NOT NULL REFERENCES stalls(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price REAL NOT NULL CHECK(price >= 0),
  taste TEXT NOT NULL,
  cuisine TEXT NOT NULL,
  ingredients_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  halal INTEGER NOT NULL DEFAULT 0,
  meal_types_json TEXT NOT NULL DEFAULT '["lunch","dinner"]',
  calories REAL NOT NULL DEFAULT 0,
  protein REAL NOT NULL DEFAULT 0,
  fat REAL NOT NULL DEFAULT 0,
  carbs REAL NOT NULL DEFAULT 0,
  rating REAL NOT NULL DEFAULT 4.5 CHECK(rating BETWEEN 0 AND 5),
  review_count INTEGER NOT NULL DEFAULT 0,
  sales INTEGER NOT NULL DEFAULT 0,
  image TEXT NOT NULL DEFAULT '🍽️',
  image_url TEXT,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','hidden')),
  -- PG-specific: full-text search vector (not referenced by app queries)
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(cuisine, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(taste, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'C')
  ) STORED,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('dish')),
  target_id TEXT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS health_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  goal TEXT NOT NULL DEFAULT 'healthy',
  budget_max REAL NOT NULL DEFAULT 20,
  meal_type TEXT NOT NULL DEFAULT 'lunch',
  taste TEXT NOT NULL DEFAULT '不限',
  halal_only INTEGER NOT NULL DEFAULT 0,
  avoid_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  storage_key TEXT NOT NULL UNIQUE,
  public_url TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rag_documents (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  embedding_json TEXT,
  -- PG-specific: full-text search vector
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(content, '')), 'B')
  ) STORED,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  created_at TEXT NOT NULL
);

-- Standard indexes (match SQLite)
CREATE INDEX IF NOT EXISTS idx_stalls_canteen ON stalls(canteen_id);
CREATE INDEX IF NOT EXISTS idx_dishes_stall ON dishes(stall_id);
CREATE INDEX IF NOT EXISTS idx_reviews_target ON reviews(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_rag_documents_source ON rag_documents(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_uploads_owner ON uploads(owner_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_time ON audit_logs(user_id, created_at DESC);

-- PG-specific: GIN indexes on tsvector columns
CREATE INDEX IF NOT EXISTS idx_dishes_search ON dishes USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_rag_search ON rag_documents USING gin(search_vector);

-- pgvector embedding column (optional — silently skipped if vector extension missing)
DO $$ BEGIN
  ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS embedding vector(128);
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
