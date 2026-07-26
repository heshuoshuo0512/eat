-- Smart Canteen PostgreSQL complete enterprise schema.
-- Replaces the stale 001_initial_schema.sql that had only student/admin roles
-- and was missing enterprise tables. This is the single source of truth for
-- fresh PostgreSQL deployments. DB_MIGRATE=1 applies incremental migrations
-- (002, 003) on top of this baseline.
-- Apply with: psql "$DATABASE_URL" -f migrations/postgres/001_initial_schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Schema migrations tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tenants
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  plan TEXT NOT NULL DEFAULT 'starter',
  ai_quota INTEGER NOT NULL DEFAULT 1000,
  storage_quota_mb INTEGER NOT NULL DEFAULT 10240,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Users (enterprise roles)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student', 'operator', 'stall_admin', 'canteen_admin', 'auditor', 'finance', 'tenant_admin', 'admin', 'super_admin')),
  wechat_openid TEXT,
  phone_hash TEXT,
  phone_encrypted TEXT,
  phone_verified_at TEXT,
  token_version INTEGER NOT NULL DEFAULT 0,
  agreement_version TEXT NOT NULL DEFAULT '',
  agreement_accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, username)
);

-- Canteens with hierarchy
CREATE TABLE IF NOT EXISTS canteens (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  hours TEXT NOT NULL,
  crowd_level INTEGER NOT NULL DEFAULT 30 CHECK(crowd_level BETWEEN 0 AND 100),
  tags_json TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL,
  parent_id TEXT REFERENCES canteens(id) ON DELETE SET NULL,
  canteen_type TEXT NOT NULL DEFAULT 'primary' CHECK(canteen_type IN ('primary','sub')),
  image TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Stalls
CREATE TABLE IF NOT EXISTS stalls (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  canteen_id TEXT NOT NULL REFERENCES canteens(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES stalls(id) ON DELETE RESTRICT,
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

-- Dishes with expanded nutrition
CREATE TABLE IF NOT EXISTS dishes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  stall_id TEXT NOT NULL REFERENCES stalls(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price REAL NOT NULL CHECK(price >= 0),
  taste TEXT NOT NULL,
  cuisine TEXT NOT NULL,
  ingredients_json TEXT NOT NULL DEFAULT '[]',
  seasonings_json TEXT NOT NULL DEFAULT '[]',
  additives_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  halal INTEGER NOT NULL DEFAULT 0,
  meal_types_json TEXT NOT NULL DEFAULT '["lunch","dinner"]',
  calories REAL NOT NULL DEFAULT 0,
  protein REAL NOT NULL DEFAULT 0,
  fat REAL NOT NULL DEFAULT 0,
  carbs REAL NOT NULL DEFAULT 0,
  fiber REAL NOT NULL DEFAULT 0,
  sodium REAL NOT NULL DEFAULT 0,
  sugar REAL NOT NULL DEFAULT 0,
  calcium REAL NOT NULL DEFAULT 0,
  iron REAL NOT NULL DEFAULT 0,
  rating REAL NOT NULL DEFAULT 4.5 CHECK(rating BETWEEN 0 AND 5),
  review_count INTEGER NOT NULL DEFAULT 0,
  sales INTEGER NOT NULL DEFAULT 0,
  image TEXT NOT NULL DEFAULT '🍽️',
  image_url TEXT,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','hidden')),
  regional_taste TEXT NOT NULL DEFAULT '',
  allergens_json TEXT NOT NULL DEFAULT '[]',
  safety_declarations_json TEXT NOT NULL DEFAULT '[]',
  dietary_labels_json TEXT NOT NULL DEFAULT '[]',
  nutrition_fact_status TEXT NOT NULL DEFAULT 'unknown',
  recipe_fact_status TEXT NOT NULL DEFAULT 'unknown',
  halal_fact_status TEXT NOT NULL DEFAULT 'unknown',
  dietary_fact_status TEXT NOT NULL DEFAULT 'unknown',
  spice_level INTEGER,
  spice_fact_status TEXT NOT NULL DEFAULT 'unknown',
  fact_source TEXT NOT NULL DEFAULT 'legacy',
  fact_verified_at TEXT,
  fact_expires_at TEXT,
  data_version TEXT NOT NULL DEFAULT 'legacy',
  synthetic INTEGER NOT NULL DEFAULT 0,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(cuisine, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(taste, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'C')
  ) STORED,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Reviews (generic targets)
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('dish','canteen')),
  target_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved',
  created_at TEXT NOT NULL
);

-- Health profiles (expanded)
CREATE TABLE IF NOT EXISTS health_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  goal TEXT NOT NULL DEFAULT 'healthy',
  budget_max REAL NOT NULL DEFAULT 20,
  meal_type TEXT NOT NULL DEFAULT 'lunch',
  taste TEXT NOT NULL DEFAULT '不限',
  halal_only INTEGER NOT NULL DEFAULT 0,
  avoid_json TEXT NOT NULL DEFAULT '[]',
  allergies_json TEXT NOT NULL DEFAULT '[]',
  dietary_pattern TEXT NOT NULL DEFAULT 'unrestricted',
  spice_level INTEGER NOT NULL DEFAULT 0 CHECK(spice_level BETWEEN 0 AND 5),
  nutrition_focus_json TEXT NOT NULL DEFAULT '[]',
  prefer_low_crowd INTEGER NOT NULL DEFAULT 0,
  favorite_tags_json TEXT NOT NULL DEFAULT '[]',
  onboarding_status TEXT NOT NULL DEFAULT 'completed',
  allergy_status TEXT NOT NULL DEFAULT 'none',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_verification_codes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  phone_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('register','reset_password')),
  code_hash TEXT NOT NULL,
  requested_ip TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

-- Uploads
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  storage_key TEXT NOT NULL UNIQUE,
  public_url TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')),
  storage_provider TEXT NOT NULL DEFAULT 'local',
  object_version TEXT NOT NULL DEFAULT 'v1',
  created_at TEXT NOT NULL
);

-- RAG documents
CREATE TABLE IF NOT EXISTS rag_documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding_json TEXT,
  embedding vector(1536),
  embedding_model TEXT,
  content_hash TEXT NOT NULL DEFAULT '',
  chunk_index INTEGER NOT NULL DEFAULT 0,
  search_text TEXT NOT NULL DEFAULT '',
  indexed_at TIMESTAMPTZ,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(content, '')), 'B')
  ) STORED,
  updated_at TEXT NOT NULL
);

-- App settings
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

-- Menus
CREATE TABLE IF NOT EXISTS menus (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  canteen_id TEXT NOT NULL REFERENCES canteens(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  meal_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Menu items
CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  menu_id TEXT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  dish_id TEXT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  price REAL NOT NULL CHECK(price >= 0),
  supply_limit INTEGER NOT NULL DEFAULT 0,
  supply_count INTEGER NOT NULL DEFAULT 0,
  sold_out INTEGER NOT NULL DEFAULT 0,
  serving_start TEXT NOT NULL DEFAULT '11:00',
  serving_end TEXT NOT NULL DEFAULT '13:30',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','preparing','ready','completed','cancelled')),
  total_amount REAL NOT NULL CHECK(total_amount >= 0),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','paid','refunded')),
  paid_at TEXT,
  pickup_code TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Order items
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  dish_id TEXT NOT NULL REFERENCES dishes(id),
  menu_item_id TEXT REFERENCES menu_items(id),
  dish_name TEXT NOT NULL,
  unit_price REAL NOT NULL CHECK(unit_price >= 0),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  line_total REAL NOT NULL CHECK(line_total >= 0),
  created_at TEXT NOT NULL
);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK(amount >= 0),
  channel TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('paid','refunded')),
  transaction_no TEXT NOT NULL UNIQUE,
  paid_at TEXT,
  created_at TEXT NOT NULL
);

-- Agent sessions
CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '智能体会话',
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Agent messages
CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','tool')),
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

-- Agent actions (with human confirmation)
CREATE TABLE IF NOT EXISTS agent_actions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','confirmed','rejected','expired')),
  payload_json TEXT NOT NULL,
  result_json TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT,
  payload_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Agent memories
CREATE TABLE IF NOT EXISTS agent_memories (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  preferences_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, user_id)
);

-- Agent eval runs
CREATE TABLE IF NOT EXISTS agent_eval_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  intent TEXT NOT NULL,
  tool_count INTEGER NOT NULL DEFAULT 0,
  action_count INTEGER NOT NULL DEFAULT 0,
  risk_level TEXT NOT NULL DEFAULT 'low',
  groundedness_score REAL NOT NULL DEFAULT 0,
  tool_success_rate REAL NOT NULL DEFAULT 0,
  safety_score REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Agent eval cases
CREATE TABLE IF NOT EXISTS agent_eval_cases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  expected_intent TEXT NOT NULL DEFAULT '',
  required_tools_json TEXT NOT NULL DEFAULT '[]',
  forbidden_tools_json TEXT NOT NULL DEFAULT '[]',
  expect_action INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Agent eval case runs
CREATE TABLE IF NOT EXISTS agent_eval_case_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  case_id TEXT NOT NULL REFERENCES agent_eval_cases(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  passed INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

-- AI usage logs
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT,
  feature TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success','failure')),
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  image_count INTEGER NOT NULL DEFAULT 0,
  estimated_cost REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL
);

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

-- Normalized authentication identities and rotating sessions
CREATE TABLE IF NOT EXISTS user_identities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('password','phone','wechat_miniapp')),
  subject_hash TEXT NOT NULL,
  subject_encrypted TEXT,
  verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, provider, subject_hash)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_family_id TEXT NOT NULL,
  device_hash TEXT NOT NULL DEFAULT '',
  device_summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
  last_used_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  session_id TEXT NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','rotated','revoked')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

-- Durable asynchronous work queue
CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','succeeded','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  locked_at TEXT,
  locked_by TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS data_import_batches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  entity_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','validated','approved','published','archived','rejected')),
  source_name TEXT NOT NULL DEFAULT '',
  row_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campus_posts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('dish','canteen')),
  target_id TEXT NOT NULL,
  content TEXT NOT NULL,
  image_url TEXT,
  rating INTEGER CHECK(rating BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  linked_review_id TEXT REFERENCES reviews(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retrieval_index_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  document_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  embedding_model TEXT,
  embedding_dimension INTEGER,
  index_version TEXT,
  metrics_json TEXT,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wechat_openid ON users(wechat_openid) WHERE wechat_openid IS NOT NULL AND wechat_openid != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_phone_hash ON users(tenant_id, phone_hash) WHERE phone_hash IS NOT NULL AND phone_hash <> '';
CREATE INDEX IF NOT EXISTS idx_users_tenant_username ON users(tenant_id, username);
CREATE INDEX IF NOT EXISTS idx_auth_codes_phone_created ON auth_verification_codes(tenant_id, phone_hash, purpose, created_at);
CREATE INDEX IF NOT EXISTS idx_canteens_tenant ON canteens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_canteens_parent ON canteens(tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_stalls_tenant_canteen ON stalls(tenant_id, canteen_id);
CREATE INDEX IF NOT EXISTS idx_stalls_tenant_parent ON stalls(tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_dishes_tenant_status ON dishes(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_dishes_search ON dishes USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_reviews_target ON reviews(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_reviews_tenant_target ON reviews(tenant_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_uploads_tenant_owner ON uploads(tenant_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created ON audit_logs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_app_settings_tenant_key ON app_settings(tenant_id, key);
CREATE INDEX IF NOT EXISTS idx_rag_documents_tenant_source ON rag_documents(tenant_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_rag_search ON rag_documents USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_menus_tenant_date ON menus(tenant_id, date, meal_type);
CREATE INDEX IF NOT EXISTS idx_menu_items_tenant_menu ON menu_items(tenant_id, menu_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant_created ON ai_usage_logs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant_feature ON ai_usage_logs(tenant_id, feature, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_user_created ON orders(tenant_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_status_created ON orders(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_tenant_order ON order_items(tenant_id, order_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_order ON payments(tenant_id, order_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_created ON payments(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_updated ON agent_sessions(tenant_id, user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_agent_messages_session_created ON agent_messages(tenant_id, session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_actions_user_status ON agent_actions(tenant_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_memories_user ON agent_memories(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_agent_eval_runs_user_created ON agent_eval_runs(tenant_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_eval_cases_tenant_enabled ON agent_eval_cases(tenant_id, enabled);
CREATE INDEX IF NOT EXISTS idx_agent_eval_case_runs_case_created ON agent_eval_case_runs(tenant_id, case_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_dish_prefs_user ON user_dish_preferences(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_dish_prefs_dish ON user_dish_preferences(tenant_id, dish_id);
CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_status ON auth_sessions(tenant_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_family ON auth_sessions(refresh_family_id, status);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_session ON auth_refresh_tokens(session_id, status);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_tenant_family ON auth_refresh_tokens(tenant_id, family_id, status);
CREATE INDEX IF NOT EXISTS idx_outbox_claim ON outbox_events(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_tenant_created ON outbox_events(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_import_batches_tenant_status ON data_import_batches(tenant_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_campus_posts_tenant_status ON campus_posts(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_campus_posts_user ON campus_posts(tenant_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_retrieval_index_runs_tenant_started ON retrieval_index_runs(tenant_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rag_documents_tenant_source_chunk ON rag_documents(tenant_id, source_type, source_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_rag_documents_tenant_type ON rag_documents(tenant_id, source_type, indexed_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_documents_search_trgm ON rag_documents USING gin(search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_rag_documents_metadata ON rag_documents USING gin(metadata);
CREATE INDEX IF NOT EXISTS idx_rag_documents_embedding_hnsw
  ON rag_documents USING hnsw(embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at ON schema_migrations(applied_at);

-- Fresh databases already contain the complete structural contract. RLS remains
-- migration 014 so deployment can switch to the restricted API role in order.
INSERT INTO schema_migrations(version) VALUES
  ('001_initial_schema'),
  ('001_enterprise_foundation'),
  ('002_generic_review_targets'),
  ('003_contextual_recommendation'),
  ('004_database_workbench'),
  ('005_campus_posts'),
  ('006_admin_stall_hierarchy'),
  ('007_admin_audit_metadata'),
  ('008_retrieval_pgvector'),
  ('009_dish_menu_runtime_columns'),
  ('010_region_allergen_contract'),
  ('011_student_auth_onboarding'),
  ('012_rag_safety_facts'),
  ('013_supabase_foundation')
ON CONFLICT (version) DO NOTHING;
