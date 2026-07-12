import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canteens as seedCanteens, dishes as seedDishes, reviews as seedReviews, stalls as seedStalls, userDishPreferences as seedUserDishPreferences, campusEnvironment as seedCampusEnvironment } from '../src/domain/seedData.js';
import { hashPassword } from './security.js';
import { runMigrations } from './migrations.js';

const DEFAULT_DB_PATH = resolve('data/smart-canteen.sqlite');

/* ── optional pg driver (loaded once at module level) ────────────── */
let PgPool;
try {
  const pg = await import('pg');
  PgPool = pg.Pool || pg.default?.Pool;
} catch {
  PgPool = null;
}

/* ── helpers ─────────────────────────────────────────────────────── */

function json(value) {
  return JSON.stringify(value ?? null);
}

export function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;       // already parsed (PG JSONB)
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/* ── SQLite adapter (existing, unchanged) ────────────────────────── */

export function openDatabase(path = process.env.SMART_CANTEEN_DB || DEFAULT_DB_PATH) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  seed(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      nickname TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student', 'operator', 'stall_admin', 'canteen_admin', 'auditor', 'finance', 'tenant_admin', 'admin', 'super_admin')),
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK(target_type IN ('dish','canteen')),
      target_id TEXT NOT NULL,
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
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      menu_id TEXT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
      dish_id TEXT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
      price REAL NOT NULL CHECK(price >= 0),
      supply_limit INTEGER NOT NULL DEFAULT 0,
      sold_out INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','preparing','ready','completed','cancelled')),
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      paid_at TEXT,
      total_amount REAL NOT NULL CHECK(total_amount >= 0),
      pickup_code TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '智能体会话',
      summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS agent_memories (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      summary TEXT NOT NULL DEFAULT '',
      preferences_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      UNIQUE(tenant_id, user_id)
    );

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

    CREATE INDEX IF NOT EXISTS idx_dishes_stall ON dishes(stall_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_target ON reviews(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_stalls_canteen ON stalls(canteen_id);
    CREATE INDEX IF NOT EXISTS idx_rag_documents_source ON rag_documents(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_uploads_owner ON uploads(owner_id);
  `);

  // Add embedding_json column for RAG embedding storage (idempotent)
  try { db.exec('ALTER TABLE rag_documents ADD COLUMN embedding_json TEXT'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN wechat_openid TEXT'); } catch {}

  try { db.exec("ALTER TABLE agent_actions ADD COLUMN expires_at TEXT"); } catch {}
  try { db.exec("ALTER TABLE agent_actions ADD COLUMN payload_hash TEXT NOT NULL DEFAULT ''"); } catch {}
  for (const [table, column] of [
    ['users', "tenant_id TEXT NOT NULL DEFAULT 'default'"],
    ['canteens', "tenant_id TEXT NOT NULL DEFAULT 'default'"],
    ['stalls', "tenant_id TEXT NOT NULL DEFAULT 'default'"],
    ['dishes', "tenant_id TEXT NOT NULL DEFAULT 'default'"],
    ['reviews', "tenant_id TEXT NOT NULL DEFAULT 'default'"],
    ['health_profiles', "tenant_id TEXT NOT NULL DEFAULT 'default'"],
    ['uploads', "tenant_id TEXT NOT NULL DEFAULT 'default'"],
    ['rag_documents', "tenant_id TEXT NOT NULL DEFAULT 'default'"],
    ['app_settings', "tenant_id TEXT NOT NULL DEFAULT 'default'"],
    ['audit_logs', "tenant_id TEXT NOT NULL DEFAULT 'default'"]
  ]) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`); } catch {}
  }
  // Supply tracking & serving window on menu items
  try { db.exec('ALTER TABLE menu_items ADD COLUMN supply_count INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec("ALTER TABLE menu_items ADD COLUMN serving_start TEXT NOT NULL DEFAULT '11:00'"); } catch {}
  try { db.exec("ALTER TABLE menu_items ADD COLUMN serving_end TEXT NOT NULL DEFAULT '13:30'"); } catch {}
  // Dish allergen info
  try { db.exec("ALTER TABLE dishes ADD COLUMN allergens_json TEXT NOT NULL DEFAULT '[]'"); } catch {}
  // Review moderation status
  try { db.exec("ALTER TABLE reviews ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'"); } catch {}
  const reviewSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reviews'").get()?.sql || '';
  if (!reviewSchema.includes("'canteen'")) {
    db.exec(`
      DROP INDEX IF EXISTS idx_reviews_target;
      DROP INDEX IF EXISTS idx_reviews_tenant_target;
      ALTER TABLE reviews RENAME TO reviews_dish_only;
      CREATE TABLE reviews (
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
      INSERT INTO reviews (id, tenant_id, user_id, target_type, target_id, rating, content, status, created_at)
      SELECT id, tenant_id, user_id, target_type, target_id, rating, content, status, created_at FROM reviews_dish_only;
      DROP TABLE reviews_dish_only;
      CREATE INDEX idx_reviews_target ON reviews(target_type, target_id);
      CREATE INDEX idx_reviews_tenant_target ON reviews(tenant_id, target_type, target_id);
    `);
  }
  // Order payment tracking
  try { db.exec("ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'"); } catch {}
  try { db.exec("ALTER TABLE orders ADD COLUMN paid_at TEXT"); } catch {}

  // ── Migration 003: contextual recommendation schema ──────────────
  // Canteen hierarchy
  try { db.exec("ALTER TABLE canteens ADD COLUMN parent_id TEXT REFERENCES canteens(id) ON DELETE SET NULL"); } catch {}
  try { db.exec("ALTER TABLE canteens ADD COLUMN canteen_type TEXT NOT NULL DEFAULT 'primary'"); } catch {}
  try { db.exec("ALTER TABLE canteens ADD COLUMN image TEXT NOT NULL DEFAULT ''"); } catch {}
  // Expanded nutrition
  try { db.exec("ALTER TABLE dishes ADD COLUMN fiber REAL NOT NULL DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN sodium REAL NOT NULL DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN sugar REAL NOT NULL DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN calcium REAL NOT NULL DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN iron REAL NOT NULL DEFAULT 0"); } catch {}
  // Expanded health profile
  try { db.exec("ALTER TABLE health_profiles ADD COLUMN dietary_pattern TEXT NOT NULL DEFAULT 'balanced'"); } catch {}
  try { db.exec("ALTER TABLE health_profiles ADD COLUMN spice_level INTEGER NOT NULL DEFAULT 3"); } catch {}
  try { db.exec("ALTER TABLE health_profiles ADD COLUMN nutrition_focus_json TEXT NOT NULL DEFAULT '[]'"); } catch {}
  try { db.exec("ALTER TABLE health_profiles ADD COLUMN prefer_low_crowd INTEGER NOT NULL DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE health_profiles ADD COLUMN favorite_tags_json TEXT NOT NULL DEFAULT '[]'"); } catch {}
  // User dish preferences (DB-backed)
  db.exec(`
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
  `);
  // Campus environment (DB-backed)
  db.exec(`
    CREATE TABLE IF NOT EXISTS campus_environment (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      temperature REAL NOT NULL DEFAULT 25,
      weather_label TEXT NOT NULL DEFAULT '晴',
      updated_at TEXT NOT NULL,
      UNIQUE(tenant_id)
    );
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wechat_openid ON users(wechat_openid) WHERE wechat_openid IS NOT NULL AND wechat_openid != '';
    CREATE INDEX IF NOT EXISTS idx_users_tenant_username ON users(tenant_id, username);
    CREATE INDEX IF NOT EXISTS idx_canteens_tenant ON canteens(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_stalls_tenant_canteen ON stalls(tenant_id, canteen_id);
    CREATE INDEX IF NOT EXISTS idx_dishes_tenant_status ON dishes(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_reviews_tenant_target ON reviews(tenant_id, target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_uploads_tenant_owner ON uploads(tenant_id, owner_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created ON audit_logs(tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_app_settings_tenant_key ON app_settings(tenant_id, key);
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
    CREATE INDEX IF NOT EXISTS idx_canteens_parent ON canteens(tenant_id, parent_id);
  `);
}

function seed(db) {
  const now = new Date().toISOString();
  if (db.prepare('SELECT COUNT(*) AS count FROM tenants').get().count === 0) {
    db.prepare('INSERT INTO tenants (id, name, status, plan, ai_quota, storage_quota_mb, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('default', '默认校园', 'active', 'enterprise', 1000, 10240, now, now);
  }
  const users = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (users === 0) {
    const insertUser = db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    insertUser.run('u-demo-student', '演示学生', hashPassword('student123'), '演示学生', 'student', now, now);
    insertUser.run('u-admin', 'admin', hashPassword('admin123'), '管理员', 'admin', now, now);
    db.prepare('INSERT INTO health_profiles (user_id, goal, budget_max, meal_type, taste, halal_only, avoid_json, dietary_pattern, spice_level, nutrition_focus_json, prefer_low_crowd, favorite_tags_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('u-demo-student', 'fatLoss', 18, 'lunch', '不限', 0, '[]', 'balanced', 3, '[]', 0, '[]', now);
  }

  if (db.prepare("SELECT COUNT(*) AS count FROM canteens WHERE tenant_id = 'default'").get().count === 0) {
    const insert = db.prepare('INSERT INTO canteens (id, tenant_id, name, location, hours, crowd_level, tags_json, description, parent_id, canteen_type, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const item of seedCanteens) insert.run(item.id, 'default', item.name, item.location, item.hours, item.crowdLevel, json(item.tags), item.description, item.parentId || null, item.canteenType || 'primary', item.imageUrl || item.image || '', now, now);
  } else {
    // Backfill hierarchy and newly introduced seed canteens for existing databases.
    const insertMissingCanteen = db.prepare('INSERT INTO canteens (id, tenant_id, name, location, hours, crowd_level, tags_json, description, parent_id, canteen_type, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const item of seedCanteens) {
      const existing = db.prepare('SELECT id FROM canteens WHERE id = ? AND tenant_id = ?').get(item.id, 'default');
      if (!existing) {
        insertMissingCanteen.run(item.id, 'default', item.name, item.location, item.hours, item.crowdLevel, json(item.tags), item.description, item.parentId || null, item.canteenType || 'primary', item.imageUrl || item.image || '', now, now);
      }
    }
    const updateSeedCanteenImage = db.prepare('UPDATE canteens SET image = ?, updated_at = ? WHERE id = ? AND (image IS NULL OR image = ? OR image IN (?, ?, ?, ?))');
    for (const item of seedCanteens) {
      if (item.imageUrl) updateSeedCanteenImage.run(item.imageUrl, now, item.id, '', '🏫', '🏢', '🏛️', '🏠');
    }
  }

  if (db.prepare("SELECT COUNT(*) AS count FROM stalls WHERE tenant_id = 'default'").get().count === 0) {
    const insert = db.prepare('INSERT INTO stalls (id, tenant_id, canteen_id, floor, name, category, rating, avg_price, open, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const item of seedStalls) insert.run(item.id, 'default', item.canteenId, item.floor, item.name, item.category, item.rating, item.avgPrice, item.open ? 1 : 0, item.description, now, now);
  } else {
    // Backfill new stalls for existing databases
    for (const item of seedStalls) {
      const exists = db.prepare('SELECT id FROM stalls WHERE id = ?').get(item.id);
      if (!exists) {
        db.prepare('INSERT INTO stalls (id, tenant_id, canteen_id, floor, name, category, rating, avg_price, open, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(item.id, 'default', item.canteenId, item.floor, item.name, item.category, item.rating, item.avgPrice, item.open ? 1 : 0, item.description, now, now);
      }
    }
  }

  if (db.prepare("SELECT COUNT(*) AS count FROM dishes WHERE tenant_id = 'default'").get().count === 0) {
    const insert = db.prepare(`INSERT INTO dishes (id, tenant_id, stall_id, name, price, taste, cuisine, ingredients_json, tags_json, halal, meal_types_json, calories, protein, fat, carbs, fiber, sodium, sugar, calcium, iron, rating, review_count, sales, image, image_url, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of seedDishes) {
      const en = item.expandedNutrition || {};
      insert.run(item.id, 'default', item.stallId, item.name, item.price, item.taste, item.cuisine, json(item.ingredients), json(item.tags), item.halal ? 1 : 0, json(item.mealTypes), item.nutrition.calories, item.nutrition.protein, item.nutrition.fat, item.nutrition.carbs, en.fiber || 0, en.sodium || 0, en.sugar || 0, en.calcium || 0, en.iron || 0, item.rating, item.reviewCount, item.sales, item.image, item.imageUrl || null, item.description, now, now);
    }
  } else {
    // Backfill new dishes and expanded nutrition for existing databases
    for (const item of seedDishes) {
      const exists = db.prepare('SELECT id FROM dishes WHERE id = ?').get(item.id);
      if (!exists) {
        const en = item.expandedNutrition || {};
        db.prepare(`INSERT INTO dishes (id, tenant_id, stall_id, name, price, taste, cuisine, ingredients_json, tags_json, halal, meal_types_json, calories, protein, fat, carbs, fiber, sodium, sugar, calcium, iron, rating, review_count, sales, image, image_url, description, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(item.id, 'default', item.stallId, item.name, item.price, item.taste, item.cuisine, json(item.ingredients), json(item.tags), item.halal ? 1 : 0, json(item.mealTypes), item.nutrition.calories, item.nutrition.protein, item.nutrition.fat, item.nutrition.carbs, en.fiber || 0, en.sodium || 0, en.sugar || 0, en.calcium || 0, en.iron || 0, item.rating, item.reviewCount, item.sales, item.image, item.imageUrl || null, item.description, now, now);
      }
    }
  }
  const updateSeedImage = db.prepare('UPDATE dishes SET image_url = ? WHERE id = ? AND (image_url IS NULL OR image_url = ?)');
  for (const item of seedDishes) {
    if (item.imageUrl) updateSeedImage.run(item.imageUrl, item.id, '');
  }

  // Backfill expanded nutrition columns on existing dishes
  for (const item of seedDishes) {
    const en = item.expandedNutrition;
    if (en) {
      const row = db.prepare('SELECT fiber FROM dishes WHERE id = ?').get(item.id);
      if (row && row.fiber === 0 && en.fiber > 0) {
        db.prepare('UPDATE dishes SET fiber = ?, sodium = ?, sugar = ?, calcium = ?, iron = ?, updated_at = ? WHERE id = ?')
          .run(en.fiber, en.sodium, en.sugar, en.calcium, en.iron, now, item.id);
      }
    }
  }

  if (db.prepare("SELECT COUNT(*) AS count FROM reviews WHERE tenant_id = 'default'").get().count === 0) {
    const insert = db.prepare('INSERT INTO reviews (id, tenant_id, user_id, target_type, target_id, rating, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const item of seedReviews) insert.run(item.id, 'default', 'u-demo-student', item.targetType, item.targetId, item.rating, item.content, item.createdAt);
  }

  // Seed campus environment
  if (db.prepare("SELECT COUNT(*) AS count FROM campus_environment WHERE tenant_id = 'default'").get().count === 0) {
    const env = seedCampusEnvironment;
    db.prepare('INSERT INTO campus_environment (id, tenant_id, temperature, weather_label, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(`env-${env.tenantId}`, env.tenantId, env.temperature, env.weatherLabel, now);
  }

  // Seed user dish preferences
  if (db.prepare("SELECT COUNT(*) AS count FROM user_dish_preferences WHERE tenant_id = 'default'").get().count === 0) {
    const insert = db.prepare('INSERT INTO user_dish_preferences (id, tenant_id, user_id, dish_id, favorite, eaten_count, drawn_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const pref of seedUserDishPreferences) {
      insert.run(`udp-${pref.userId}-${pref.dishId}`, 'default', pref.userId, pref.dishId, pref.favorite, pref.eatenCount, pref.drawnCount, now, now);
    }
  }

  // ── Seed today's default lunch menu (idempotent) ───────────────
  const today = now.slice(0, 10);
  const defaultMenuId = `menu-default-${today}-lunch`;
  const existingMenu = db.prepare('SELECT id FROM menus WHERE id = ?').get(defaultMenuId);
  if (!existingMenu) {
    db.prepare('INSERT INTO menus (id, tenant_id, canteen_id, date, meal_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(defaultMenuId, 'default', 'north', today, 'lunch', 'published', now, now);
    const lunchDishes = seedDishes.filter((d) => (d.mealTypes || []).includes('lunch'));
    const insertItem = db.prepare('INSERT INTO menu_items (id, tenant_id, menu_id, dish_id, price, supply_limit, supply_count, sold_out, serving_start, serving_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const dish of lunchDishes) {
      insertItem.run(
        `menu-item-${defaultMenuId}-${dish.id}`,
        'default',
        defaultMenuId,
        dish.id,
        dish.price,
        50,
        0,
        0,
        '11:00',
        '13:30',
        now,
        now
      );
    }
  }
}

/* ── row mappers ─────────────────────────────────────────────────── */

export function rowToCanteen(row) {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    hours: row.hours,
    crowdLevel: row.crowd_level,
    tags: parseJson(row.tags_json, []),
    description: row.description,
    parentId: row.parent_id || null,
    canteenType: row.canteen_type || 'primary',
    image: row.image && !String(row.image).startsWith('http') ? row.image : '',
    imageUrl: row.image && String(row.image).startsWith('http') ? row.image : ''
  };
}

export function rowToStall(row) {
  return {
    id: row.id,
    canteenId: row.canteen_id,
    floor: row.floor,
    name: row.name,
    category: row.category,
    rating: row.rating,
    avgPrice: row.avg_price,
    open: Boolean(row.open),
    description: row.description
  };
}

export function rowToDish(row) {
  return {
    id: row.id,
    stallId: row.stall_id,
    name: row.name,
    price: row.price,
    taste: row.taste,
    cuisine: row.cuisine,
    ingredients: parseJson(row.ingredients_json, []),
    tags: parseJson(row.tags_json, []).filter((tag) => tag !== '不辣'),
    halal: Boolean(row.halal),
    mealTypes: parseJson(row.meal_types_json, ['lunch', 'dinner']),
    nutrition: { calories: row.calories, protein: row.protein, fat: row.fat, carbs: row.carbs },
    fiber: row.fiber || 0,
    sodium: row.sodium || 0,
    sugar: row.sugar || 0,
    calcium: row.calcium || 0,
    iron: row.iron || 0,
    allergens: parseJson(row.allergens_json, []),
    rating: row.rating,
    reviewCount: row.review_count,
    sales: row.sales,
    image: row.image,
    imageUrl: row.image_url,
    description: row.description,
    status: row.status
  };
}


export function rowToReview(row) {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    userId: row.user_id,
    user: row.nickname || row.username || '匿名用户',
    rating: row.rating,
    content: row.content,
    status: row.status || 'approved',
    createdAt: row.created_at
  };
}

export function rowToProfile(row) {
  return row ? {
    goal: row.goal,
    budgetMax: row.budget_max,
    mealType: row.meal_type,
    taste: row.taste,
    halalOnly: Boolean(row.halal_only),
    avoid: parseJson(row.avoid_json, []),
    dietaryPattern: row.dietary_pattern || 'balanced',
    spiceLevel: row.spice_level ?? 3,
    nutritionFocus: parseJson(row.nutrition_focus_json, []),
    preferLowCrowd: Boolean(row.prefer_low_crowd),
    favoriteTags: parseJson(row.favorite_tags_json, [])
  } : { goal: 'healthy', budgetMax: 20, mealType: 'lunch', taste: '不限', halalOnly: false, avoid: [], dietaryPattern: 'balanced', spiceLevel: 3, nutritionFocus: [], preferLowCrowd: false, favoriteTags: [] };
}

export function rowToUser(row) {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    role: row.role,
    tenantId: row.tenant_id || 'default',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function rowToTenant(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    plan: row.plan,
    aiQuota: row.ai_quota,
    storageQuotaMb: row.storage_quota_mb,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function rowToMenu(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id || 'default',
    canteenId: row.canteen_id,
    canteenName: row.canteen_name || null,
    date: row.date,
    mealType: row.meal_type,
    status: row.status,
    items: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function rowToMenuItem(row) {
  const limit = Number(row.supply_limit || 0);
  const served = Number(row.supply_count || 0);
  const soldOut = Boolean(row.sold_out);
  let supplyStatus = 'available';
  if (soldOut) supplyStatus = 'sold_out';
  else if (limit > 0 && served >= limit) supplyStatus = 'sold_out';
  else if (limit > 0 && served >= limit * 0.8) supplyStatus = 'limited';
  return {
    id: row.id,
    tenantId: row.tenant_id || 'default',
    menuId: row.menu_id,
    dishId: row.dish_id,
    dishName: row.dish_name || null,
    price: row.price,
    supplyLimit: limit,
    supplyCount: served,
    soldOut: soldOut || (limit > 0 && served >= limit),
    supplyStatus,
    servingStart: row.serving_start || '11:00',
    servingEnd: row.serving_end || '13:30',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}


export function rowToAiUsageLog(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id || 'default',
    userId: row.user_id || null,
    feature: row.feature,
    provider: row.provider,
    model: row.model,
    status: row.status,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    imageCount: row.image_count,
    estimatedCost: row.estimated_cost,
    latencyMs: row.latency_ms,
    error: row.error || null,
    createdAt: row.created_at
  };
}

export function rowToAuditLog(row) {
  return {
    id: row.id,
    userId: row.user_id,
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id,
    createdAt: row.created_at
  };
}

export function rowToPreference(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id || 'default',
    userId: row.user_id,
    dishId: row.dish_id,
    favorite: Boolean(row.favorite),
    eatenCount: row.eaten_count || 0,
    drawnCount: row.drawn_count || 0,
    lastEatenAt: row.last_eaten_at || null,
    lastDrawnAt: row.last_drawn_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function rowToEnvironment(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id || 'default',
    temperature: row.temperature,
    weatherLabel: row.weather_label,
    updatedAt: row.updated_at
  };
}


export function serializeJson(value) {
  return json(value);
}

/* ── PostgreSQL adapter ──────────────────────────────────────────── */

/**
 * Convert SQLite positional '?' placeholders to PostgreSQL '$1, $2, …' form.
 */
function sqliteToPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * Thin adapter that makes a `pg.Pool` look like `DatabaseSync` for the
 * subset of the interface used by app.js: `prepare(sql).all/get/run()`.
 *
 * Every method returns a **Promise** — the caller must `await` it.
 * When the caller is SQLite's `StatementSync`, the return value is a plain
 * JS value; `await plainValue` is a no-op, so both backends are transparent.
 */
class PgDatabase {
  constructor(pool) {
    this.pool = pool;
  }

  prepare(sql) {
    const pgSql = sqliteToPg(sql);
    const pool = this.pool;
    return {
      all:  (...params) => pool.query(pgSql, params).then(r => r.rows),
      get:  (...params) => pool.query(pgSql, params).then(r => r.rows[0] ?? undefined),
      run:  (...params) => pool.query(pgSql, params).then(r => ({ changes: r.rowCount })),
    };
  }

  exec(sql) {
    return this.pool.query(sql);
  }

  close() {
    return this.pool.end();
  }
}

/**
 * Open a PostgreSQL connection pool.
 * Migrations are expected to have been applied externally
 * (e.g. via docker-entrypoint-initdb.d or manual psql).
 *
 * @param {string} [url]  — defaults to DATABASE_URL env
 * @returns {Promise<PgDatabase>}
 */
export async function openPostgresDatabase(url = process.env.DATABASE_URL) {
  if (!PgPool) {
    throw new Error('PostgreSQL driver (pg) is not installed. Run: npm install pg');
  }
  const pool = new PgPool({ connectionString: url });
  // Verify connectivity before returning the adapter.
  const client = await pool.connect();
  client.release();
  const db = new PgDatabase(pool);
  if (process.env.DB_MIGRATE === '1' || process.env.DB_MIGRATE === 'true') {
    await runMigrations(db);
  }
  return db;
}

/**
 * Factory: returns a SQLite db (sync) or a PG adapter (Promise).
 * Callers should `await` the result for portable code.
 */
export function createDatabase() {
  const driver = (process.env.DB_DRIVER || '').toLowerCase();
  if (driver === 'postgres' || (process.env.DATABASE_URL && driver !== 'sqlite')) {
    return openPostgresDatabase(process.env.DATABASE_URL);
  }
  return openDatabase();
}
