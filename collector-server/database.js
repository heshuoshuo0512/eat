import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const { Pool } = pg;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS collector_contributors (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collector_staff (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('collector_admin','collector_reviewer')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collector_staff_sessions (
  token_hash TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES collector_staff(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collector_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 999,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collector_catalog_venues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  parent_id TEXT,
  venue_kind TEXT NOT NULL DEFAULT 'dining_hall',
  source_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collector_catalog_stalls (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL,
  name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  source_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collector_catalog_dishes (
  id TEXT PRIMARY KEY,
  stall_id TEXT NOT NULL,
  name TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  source_version TEXT NOT NULL,
  popularity_score REAL NOT NULL DEFAULT 0,
  target_eligible INTEGER NOT NULL DEFAULT 1 CHECK(target_eligible IN (0,1)),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collector_catalog_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collector_group_venues (
  group_id TEXT NOT NULL REFERENCES collector_groups(id) ON DELETE CASCADE,
  venue_id TEXT NOT NULL,
  PRIMARY KEY(group_id, venue_id)
);
CREATE TABLE IF NOT EXISTS collector_targets (
  group_id TEXT NOT NULL REFERENCES collector_groups(id) ON DELETE CASCADE,
  dish_id TEXT NOT NULL,
  goal_images INTEGER NOT NULL DEFAULT 60 CHECK(goal_images > 0),
  priority INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  PRIMARY KEY(group_id, dish_id)
);
CREATE TABLE IF NOT EXISTS collector_objects (
  id TEXT PRIMARY KEY,
  contributor_id TEXT NOT NULL REFERENCES collector_contributors(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_provider TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  phash TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collector_submissions (
  id TEXT PRIMARY KEY,
  contributor_id TEXT NOT NULL REFERENCES collector_contributors(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES collector_groups(id),
  object_id TEXT NOT NULL REFERENCES collector_objects(id),
  claimed_name TEXT NOT NULL,
  ai_names_json TEXT NOT NULL DEFAULT '[]',
  candidate_ids_json TEXT NOT NULL DEFAULT '[]',
  selected_dish_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('draft','pending_review','needs_mapping','approved','rejected','withdrawn','expired')),
  duplicate_of TEXT,
  needs_second_review INTEGER NOT NULL DEFAULT 0 CHECK(needs_second_review IN (0,1)),
  review_stage INTEGER NOT NULL DEFAULT 0,
  rejection_reason TEXT NOT NULL DEFAULT '',
  consent_version TEXT NOT NULL DEFAULT '',
  consent_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collector_reviews (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES collector_submissions(id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL REFERENCES collector_staff(id),
  stage INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approve','relabel','reject','map')),
  dish_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(submission_id, reviewer_id, stage)
);
CREATE TABLE IF NOT EXISTS collector_points (
  id TEXT PRIMARY KEY,
  contributor_id TEXT NOT NULL REFERENCES collector_contributors(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES collector_submissions(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(submission_id, reason)
);
CREATE TABLE IF NOT EXISTS collector_dataset_versions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('draft','ready','rejected','deployed')),
  catalog_version TEXT NOT NULL,
  manifest_path TEXT NOT NULL DEFAULT '',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  finalized_at TEXT
);
CREATE TABLE IF NOT EXISTS collector_model_versions (
  id TEXT PRIMARY KEY,
  model_version TEXT NOT NULL UNIQUE,
  dataset_version TEXT NOT NULL,
  base_model TEXT NOT NULL,
  checkpoint_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('rejected','ready','deployed','retired')),
  metrics_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  deployed_at TEXT
);
CREATE TABLE IF NOT EXISTS collector_dish_prototypes (
  model_version TEXT NOT NULL,
  dish_id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  venue_name TEXT NOT NULL,
  stall_name TEXT NOT NULL,
  dimension INTEGER NOT NULL DEFAULT 768,
  embedding_json TEXT NOT NULL,
  image_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(model_version, dish_id)
);
CREATE INDEX IF NOT EXISTS idx_collector_dishes_name ON collector_catalog_dishes(canonical_name, name);
CREATE INDEX IF NOT EXISTS idx_collector_submissions_owner ON collector_submissions(contributor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_collector_submissions_review ON collector_submissions(status, review_stage, created_at);
CREATE INDEX IF NOT EXISTS idx_collector_objects_hash ON collector_objects(sha256, phash);
CREATE INDEX IF NOT EXISTS idx_collector_reviews_submission ON collector_reviews(submission_id, stage);
`;

function postgresSql(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function sqliteAdapter(path) {
  const resolved = resolve(path);
  mkdirSync(dirname(resolved), { recursive: true });
  const raw = new DatabaseSync(resolved);
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  return {
    kind: 'sqlite',
    async exec(sql) { raw.exec(sql); },
    async get(sql, params = []) { return raw.prepare(sql).get(...params) || null; },
    async all(sql, params = []) { return raw.prepare(sql).all(...params); },
    async run(sql, params = []) {
      const result = raw.prepare(sql).run(...params);
      return { changes: Number(result.changes || 0), lastInsertRowid: result.lastInsertRowid };
    },
    async transaction(operation) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const result = await operation(this);
        raw.exec('COMMIT');
        return result;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
    async close() { raw.close(); },
  };
}

function postgresAdapter(url) {
  const pool = new Pool({ connectionString: url, max: Number(process.env.COLLECTOR_PG_POOL_MAX || 10) });
  const adapterFor = (client) => ({
    kind: 'postgres',
    async exec(sql) { await client.query(sql); },
    async get(sql, params = []) { return (await client.query(postgresSql(sql), params)).rows[0] || null; },
    async all(sql, params = []) { return (await client.query(postgresSql(sql), params)).rows; },
    async run(sql, params = []) { return { changes: (await client.query(postgresSql(sql), params)).rowCount || 0 }; },
  });
  return {
    ...adapterFor(pool),
    async transaction(operation) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await operation(adapterFor(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); },
  };
}

export async function openCollectorDatabase() {
  const database = process.env.COLLECTOR_DATABASE_URL
    ? postgresAdapter(process.env.COLLECTOR_DATABASE_URL)
    : sqliteAdapter(process.env.COLLECTOR_DB || 'collector-data/collector.sqlite');
  await database.exec(SCHEMA);
  try { await database.exec('ALTER TABLE collector_catalog_dishes ADD COLUMN popularity_score REAL NOT NULL DEFAULT 0'); } catch (error) { if (!/duplicate column|already exists/i.test(error.message)) throw error; }
  try { await database.exec('ALTER TABLE collector_catalog_dishes ADD COLUMN target_eligible INTEGER NOT NULL DEFAULT 1'); } catch (error) { if (!/duplicate column|already exists/i.test(error.message)) throw error; }
  if (database.kind === 'postgres') {
    await database.exec('CREATE EXTENSION IF NOT EXISTS vector');
    await database.exec('ALTER TABLE collector_dish_prototypes ADD COLUMN IF NOT EXISTS embedding vector(768)');
    await database.exec('CREATE INDEX IF NOT EXISTS idx_collector_prototypes_vector ON collector_dish_prototypes USING hnsw (embedding vector_cosine_ops)');
  }
  return database;
}
