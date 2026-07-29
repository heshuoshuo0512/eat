import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { hashPassword, resolveUploadReference } from './security.js';
import { runMigrations } from './migrations.js';
import { businessDate } from './time.js';
import { normalizeDishPricing } from './dishPricing.js';

const DEFAULT_DB_PATH = resolve('data/smart-canteen.sqlite');
const pgRequestContext = new AsyncLocalStorage();
const DEMO_SEED_ENABLED = ['1', 'true', 'on'].includes(String(process.env.ENABLE_DEMO_SEED || '0').toLowerCase());
let seedCanteens = [];
let seedDishes = [];
let seedReviews = [];
let seedStalls = [];
let seedUserDishPreferences = [];
let seedCampusEnvironment = {};
if (DEMO_SEED_ENABLED) {
  ({
    canteens: seedCanteens,
    dishes: seedDishes,
    reviews: seedReviews,
    stalls: seedStalls,
    userDishPreferences: seedUserDishPreferences,
    campusEnvironment: seedCampusEnvironment
  } = await import('../tests/fixtures/seedData.js'));
}

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
  alignRealCampusVenueCatalog(db);
  return db;
}

export function cleanDishCatalogName(value) {
  return String(value || '')
    .replace(/^\s*\d+\s*[.、]\s*/u, '')
    .replace(/^\s*[.、]\s*/u, '')
    .trim();
}

export function isServingTierCatalogName(value) {
  return /^(?:\d+\s*[-~至‐‑–—]\s*\d+|\d+|单|双|多)\s*人份$/u.test(cleanDishCatalogName(value));
}

export function inferDishCatalogCategory({ name = '', cuisine = '', tags = [], semanticLabels = [], catalogItemType = 'meal' } = {}) {
  const text = [name, cuisine, ...tags, ...semanticLabels].join(' ');
  if (catalogItemType === 'beverage') return '饮品';
  if (catalogItemType === 'snack') return /汉堡|堡/u.test(text) ? '汉堡小吃' : '小吃单品';
  if (catalogItemType === 'addon') return /丸|鱼豆腐|蟹棒|蟹排/u.test(text) ? '火锅配菜' : '加购项';
  if (catalogItemType === 'fee') return '费用';
  if (catalogItemType === 'variant') return '规格选项';
  if (catalogItemType === 'section') return '目录分组';
  if (/奶茶|咖啡|果汁|豆浆|酸奶|牛奶|饮料|饮品|茶|水吧|可乐|雪碧/u.test(text)) return '饮品';
  if (/面条|拌面|汤面|炒面|拉面|粉|米线|河粉|板面|刀削面|馄饨|饺子/u.test(text)) return '面食粉类';
  if (/饭|套餐|便当/u.test(text)) return '米饭套餐';
  if (/包子|馒头|烧麦|粥|饼|油条|早餐|豆腐脑|锅贴|盒子|粽子|夹馍|汤圆/u.test(text)) return '早餐面点';
  if (/麻辣烫|麻辣香锅|火锅|冒菜|串串/u.test(text)) return '火锅麻辣烫';
  if (/汤|羹/u.test(text)) return '汤羹';
  if (/干锅/u.test(text)) return '干锅菜';
  if (/砂锅|煲/u.test(text)) return '砂锅煲类';
  if (/水煮/u.test(text)) return '水煮菜';
  if (/蒸/u.test(text)) return '蒸菜';
  if (/沙拉|三明治|谷物/u.test(text)) return '轻食简餐';
  if (/烤鱼/u.test(text)) return '烤鱼';
  if (/汉堡|炸鸡|鸡排|烤肠|丸子|小吃|甜品|蛋挞|薯条|加蛋|加面|加饭/u.test(text)) return '小吃加料';
  if (/蔬菜|素菜|青菜|土豆丝|豆腐|豆芽|茄子|菜花/u.test(text)) return '素菜';
  if (/鸡|鸭|鹅|猪|牛|羊|鱼|虾|肉|排骨|肘|蛋/u.test(text)) return '荤菜';
  return '家常热菜';
}

function alignRealCampusVenueCatalog(db) {
  const approved = Number(db.prepare("SELECT COUNT(*) AS count FROM data_import_batches WHERE tenant_id = 'default' AND entity_type = 'real_catalog' AND status IN ('validated', 'approved')").get()?.count || 0);
  if (!approved) return;
  const now = new Date().toISOString();
  const metadata = [
    ['campus-main', '西区大食堂', '大食堂', 1, 'open', '西区'],
    ['east-zone', '东区燕鸣湖', '燕鸣湖', 2, 'open', '东区'],
    ['east-guangyuan', '西区广源超市', '广源超市', 5, 'open', '西区'],
    ['east-dongdahuo', '东区东大活', '东大活', 6, 'open', '东区'],
    ['west-minzu', '民族餐厅', '民族餐厅', 1, 'open', null],
    ['west-xinyi', '心怡餐厅', '心怡餐厅', 2, 'open', null],
    ['west-xijinjia', '禧进甲餐厅', '禧进甲餐厅', 3, 'open', null],
    ['west-floor2-east', '二楼东厅', '二楼东厅', 4, 'open', null],
    ['west-darongshu', '大榕树餐厅', '大榕树餐厅', 5, 'open', '西区大食堂 · 三楼西'],
    ['west-floor3-east', '三楼东厅', '三楼东厅', 6, 'open', null],
    ['east-yanminghu-1f', null, '一楼', 1, 'open', null],
    ['east-yanminghu-2f', null, '二楼', 2, 'open', null],
  ];
  const selectCanteen = db.prepare(`SELECT name, display_name, display_order, operating_status, location,
    parent_id, canteen_type, venue_kind, hours, description FROM canteens WHERE tenant_id = 'default' AND id = ?`);
  const update = db.prepare(`UPDATE canteens SET name = ?, display_name = ?, display_order = ?, operating_status = ?,
    location = ?, updated_at = ? WHERE tenant_id = 'default' AND id = ?`);
  for (const [id, name, displayName, displayOrder, operatingStatus, location] of metadata) {
    const current = selectCanteen.get(id);
    if (!current) continue;
    const next = {
      name: name ?? current.name,
      displayName,
      displayOrder,
      operatingStatus,
      location: location ?? current.location,
    };
    if (current.name !== next.name
      || current.display_name !== next.displayName
      || Number(current.display_order) !== next.displayOrder
      || current.operating_status !== next.operatingStatus
      || current.location !== next.location) {
      update.run(next.name, next.displayName, next.displayOrder, next.operatingStatus, next.location, now, id);
    }
  }
  db.prepare("UPDATE canteens SET parent_id = NULL, canteen_type = 'primary', venue_kind = 'supermarket', updated_at = ? WHERE tenant_id = 'default' AND id = 'east-guangyuan' AND (parent_id IS NOT NULL OR canteen_type <> 'primary' OR venue_kind <> 'supermarket')").run(now);
  db.prepare("UPDATE canteens SET parent_id = NULL, canteen_type = 'primary', venue_kind = 'service_building', updated_at = ? WHERE tenant_id = 'default' AND id = 'east-dongdahuo' AND (parent_id IS NOT NULL OR canteen_type <> 'primary' OR venue_kind <> 'service_building')").run(now);
  const insertPlaceholder = db.prepare(`INSERT INTO canteens
    (id, tenant_id, name, display_name, display_order, operating_status, location, hours, crowd_level, tags_json, description, parent_id, canteen_type, image, venue_kind, created_at, updated_at)
    VALUES (?, 'default', ?, ?, ?, 'renovating', ?, '装修中', 0, '["装修中"]', ?, NULL, 'primary', '', 'dining_hall', ?, ?)`);
  const updatePlaceholder = db.prepare(`UPDATE canteens SET name = ?, display_name = ?, display_order = ?,
    operating_status = 'renovating', location = ?, hours = '装修中', description = ?, parent_id = NULL,
    canteen_type = 'primary', venue_kind = 'dining_hall', updated_at = ?
    WHERE tenant_id = 'default' AND id = ?`);
  for (const [id, name, displayName, displayOrder, location, description] of [
    ['west-yanyuan', '西区燕园', '燕园', 3, '西区', '西区燕园正在装修，开放后将提供正式校园餐饮目录。'],
    ['east-shanshuiyuan', '东区山水园', '山水园', 4, '东区', '东区山水园正在装修，开放后将提供正式校园餐饮目录。'],
  ]) {
    const current = selectCanteen.get(id);
    if (!current) {
      insertPlaceholder.run(id, name, displayName, displayOrder, location, description, now, now);
      continue;
    }
    if (current.name !== name
      || current.display_name !== displayName
      || Number(current.display_order) !== displayOrder
      || current.operating_status !== 'renovating'
      || current.location !== location
      || current.hours !== '装修中'
      || current.description !== description
      || current.parent_id !== null
      || current.canteen_type !== 'primary'
      || current.venue_kind !== 'dining_hall') {
      updatePlaceholder.run(name, displayName, displayOrder, location, description, now, id);
    }
  }
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      nickname TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student', 'operator', 'stall_admin', 'canteen_admin', 'auditor', 'finance', 'tenant_admin', 'admin', 'super_admin')),
      phone_hash TEXT,
      phone_encrypted TEXT,
      phone_verified_at TEXT,
      token_version INTEGER NOT NULL DEFAULT 0,
      agreement_version TEXT NOT NULL DEFAULT '',
      agreement_accepted_at TEXT,
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
      venue_kind TEXT NOT NULL DEFAULT 'dining_hall',
      display_name TEXT NOT NULL DEFAULT '',
      display_order INTEGER NOT NULL DEFAULT 999,
      operating_status TEXT NOT NULL DEFAULT 'open' CHECK(operating_status IN ('open','renovating','closed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stalls (
      id TEXT PRIMARY KEY,
      canteen_id TEXT NOT NULL REFERENCES canteens(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES stalls(id) ON DELETE RESTRICT,
      floor TEXT NOT NULL,
      name TEXT NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      category TEXT NOT NULL,
      rating REAL NOT NULL DEFAULT 0 CHECK(rating BETWEEN 0 AND 5),
      avg_price REAL NOT NULL DEFAULT 0,
      open INTEGER NOT NULL DEFAULT 1,
      reservation_enabled INTEGER NOT NULL DEFAULT 0,
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
      seasonings_json TEXT NOT NULL DEFAULT '[]',
      additives_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      catalog_item_type TEXT NOT NULL DEFAULT 'meal' CHECK(catalog_item_type IN ('meal','beverage','snack','addon','fee','variant','section')),
      catalog_category TEXT NOT NULL DEFAULT '其他餐食',
      parent_dish_id TEXT REFERENCES dishes(id) ON DELETE SET NULL,
      halal INTEGER NOT NULL DEFAULT 0,
      meal_types_json TEXT NOT NULL DEFAULT '["lunch","dinner"]',
      calories REAL NOT NULL DEFAULT 0,
      protein REAL NOT NULL DEFAULT 0,
      fat REAL NOT NULL DEFAULT 0,
      carbs REAL NOT NULL DEFAULT 0,
      rating REAL NOT NULL DEFAULT 0 CHECK(rating BETWEEN 0 AND 5),
      review_count INTEGER NOT NULL DEFAULT 0,
      sales INTEGER NOT NULL DEFAULT 0,
      image TEXT NOT NULL DEFAULT '🍽️',
      image_url TEXT,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','hidden','inactive','archived')),
      reservation_enabled INTEGER NOT NULL DEFAULT 0,
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS catalog_import_rows (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      batch_id TEXT NOT NULL REFERENCES data_import_batches(id) ON DELETE CASCADE,
      source_hash TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_locator TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('accepted','review_required','excluded')),
      raw_text TEXT NOT NULL DEFAULT '',
      normalized_json TEXT NOT NULL DEFAULT '{}',
      issues_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dish_ai_annotations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      dish_id TEXT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
      batch_id TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      annotation_json TEXT NOT NULL DEFAULT '{}',
      field_confidence_json TEXT NOT NULL DEFAULT '{}',
      linked_concept_ids_json TEXT NOT NULL DEFAULT '[]',
      source_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'generated' CHECK(status IN ('generated','schema_validated','approved','rejected')),
      error TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(tenant_id, dish_id, batch_id, input_hash)
    );

    CREATE TABLE IF NOT EXISTS catalog_introduction_batches (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      catalog_data_version TEXT NOT NULL DEFAULT '',
      catalog_snapshot_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'preparing' CHECK(status IN ('preparing','probing','generating','generated','approved','paused','failed','rolled_back')),
      entity_count INTEGER NOT NULL DEFAULT 0 CHECK(entity_count >= 0),
      completed_count INTEGER NOT NULL DEFAULT 0 CHECK(completed_count >= 0),
      failed_count INTEGER NOT NULL DEFAULT 0 CHECK(failed_count >= 0),
      concurrency_json TEXT NOT NULL DEFAULT '{}',
      metrics_json TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      created_by TEXT,
      reviewed_by TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(tenant_id, catalog_snapshot_hash, prompt_version, model)
    );

    CREATE TABLE IF NOT EXISTS catalog_entity_introductions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      batch_id TEXT NOT NULL REFERENCES catalog_introduction_batches(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('dish','stall','canteen')),
      hierarchy_level TEXT NOT NULL CHECK(hierarchy_level IN ('dish','stall','area','venue')),
      entity_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version > 0),
      factual_summary TEXT NOT NULL DEFAULT '',
      recommendation_copy TEXT NOT NULL DEFAULT '',
      claim_evidence_json TEXT NOT NULL DEFAULT '[]',
      semantic_labels_json TEXT NOT NULL DEFAULT '[]',
      evidence_ids_json TEXT NOT NULL DEFAULT '[]',
      evidence_snapshot_json TEXT NOT NULL DEFAULT '{}',
      boundary_codes_json TEXT NOT NULL DEFAULT '[]',
      confidence_score REAL NOT NULL DEFAULT 0 CHECK(confidence_score BETWEEN 0 AND 1),
      confidence_level TEXT NOT NULL DEFAULT 'low' CHECK(confidence_level IN ('high','medium','low')),
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'generated' CHECK(status IN ('generated','schema_validated','approved','rejected','retired')),
      previous_introduction_id TEXT,
      error TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(tenant_id, entity_type, entity_id, version),
      UNIQUE(tenant_id, entity_type, entity_id, batch_id, input_hash)
    );

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
      dimension INTEGER NOT NULL DEFAULT 768,
      embedding_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','failed')),
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dish_class_prototypes (
      tenant_id TEXT NOT NULL DEFAULT 'default',
      dish_id TEXT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
      model_version TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      venue_name TEXT NOT NULL,
      stall_name TEXT NOT NULL,
      dimension INTEGER NOT NULL DEFAULT 768 CHECK(dimension = 768),
      embedding_json TEXT NOT NULL,
      image_count INTEGER NOT NULL CHECK(image_count > 0),
      status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','deployed','retired')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(tenant_id, dish_id, model_version)
    );

    CREATE TABLE IF NOT EXISTS dish_recipe_versions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      dish_id TEXT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      basis TEXT NOT NULL DEFAULT 'per_serving' CHECK(basis IN ('per_serving','per_100g')),
      serving_weight_grams REAL,
      yield_weight_grams REAL,
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
      raw_weight_grams REAL NOT NULL CHECK(raw_weight_grams > 0),
      edible_ratio REAL NOT NULL DEFAULT 1 CHECK(edible_ratio > 0 AND edible_ratio <= 1),
      retention_factor REAL NOT NULL DEFAULT 1 CHECK(retention_factor > 0 AND retention_factor <= 1.5),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dish_nutrition_versions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      dish_id TEXT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
      recipe_version_id TEXT REFERENCES dish_recipe_versions(id) ON DELETE SET NULL,
      version TEXT NOT NULL,
      basis TEXT NOT NULL DEFAULT 'per_serving' CHECK(basis IN ('per_serving','per_100g')),
      portion_grams REAL,
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

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK(target_type IN ('dish','canteen')),
      target_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS content_reactions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      target_type TEXT NOT NULL CHECK(target_type IN ('post','review')),
      target_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reaction TEXT NOT NULL CHECK(reaction IN ('like','dislike')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(tenant_id, target_type, target_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS post_comments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      post_id TEXT NOT NULL REFERENCES campus_posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','hidden')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_reports (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK(target_type IN ('post','review','comment')),
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','dismissed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS health_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      goal TEXT NOT NULL DEFAULT 'healthy',
      budget_max REAL NOT NULL DEFAULT 20,
      meal_type TEXT NOT NULL DEFAULT 'lunch',
      taste TEXT NOT NULL DEFAULT '不限',
      halal_only INTEGER NOT NULL DEFAULT 0,
      avoid_json TEXT NOT NULL DEFAULT '[]',
      allergies_json TEXT NOT NULL DEFAULT '[]',
      onboarding_status TEXT NOT NULL DEFAULT 'completed',
      allergy_status TEXT NOT NULL DEFAULT 'none',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_verification_codes (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      phone_hash TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK(purpose IN ('register','reset_password','delete_account')),
      code_hash TEXT NOT NULL,
      requested_ip TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
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
      metadata_json TEXT NOT NULL DEFAULT '{}',
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
      stall_id TEXT REFERENCES stalls(id) ON DELETE RESTRICT,
      order_type TEXT NOT NULL DEFAULT 'reservation',
      payment_method TEXT NOT NULL DEFAULT 'at_stall',
      pricing_status TEXT NOT NULL DEFAULT 'exact',
      estimated_amount REAL NOT NULL DEFAULT 0,
      final_amount REAL,
      idempotency_key TEXT,
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
      pricing_mode TEXT NOT NULL DEFAULT 'fixed',
      price_display TEXT NOT NULL DEFAULT '',
      pricing_snapshot_json TEXT NOT NULL DEFAULT '{}',
      pricing_status TEXT NOT NULL DEFAULT 'exact',
      estimated_unit_price REAL NOT NULL DEFAULT 0,
      confirmed_unit_price REAL,
      item_note TEXT NOT NULL DEFAULT '',
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
    CREATE INDEX IF NOT EXISTS idx_campus_posts_tenant_status ON campus_posts(tenant_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_campus_posts_user ON campus_posts(tenant_id, user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_stalls_canteen ON stalls(canteen_id);
    CREATE INDEX IF NOT EXISTS idx_rag_documents_source ON rag_documents(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_uploads_owner ON uploads(owner_id);
    CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(tenant_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_status ON auth_sessions(tenant_id, user_id, status);
    CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_session ON auth_refresh_tokens(session_id, status);
    CREATE INDEX IF NOT EXISTS idx_outbox_claim ON outbox_events(status, available_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_outbox_tenant_created ON outbox_events(tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_dish_reference_images_dish ON dish_reference_images(tenant_id, dish_id, purpose, quality_status);
    CREATE INDEX IF NOT EXISTS idx_dish_image_embeddings_dish ON dish_image_embeddings(tenant_id, dish_id, status);
    CREATE INDEX IF NOT EXISTS idx_dish_class_prototypes_dish ON dish_class_prototypes(tenant_id, dish_id, status);
    CREATE INDEX IF NOT EXISTS idx_dish_recipe_versions_dish ON dish_recipe_versions(tenant_id, dish_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_dish_nutrition_versions_dish ON dish_nutrition_versions(tenant_id, dish_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_meal_vision_analyses_user ON meal_vision_analyses(tenant_id, user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_meal_vision_feedback_analysis ON meal_vision_feedback(tenant_id, analysis_id);
  `);

  // Add embedding_json column for RAG embedding storage (idempotent)
  try { db.exec('ALTER TABLE rag_documents ADD COLUMN embedding_json TEXT'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN wechat_openid TEXT'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN phone_hash TEXT'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN phone_encrypted TEXT'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN phone_verified_at TEXT'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN agreement_version TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN agreement_accepted_at TEXT'); } catch {}
  try { db.exec("ALTER TABLE uploads ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'"); } catch {}
  try { db.exec("ALTER TABLE uploads ADD COLUMN storage_provider TEXT NOT NULL DEFAULT 'local'"); } catch {}
  try { db.exec("ALTER TABLE uploads ADD COLUMN object_version TEXT NOT NULL DEFAULT 'v1'"); } catch {}

  try { db.exec("ALTER TABLE agent_actions ADD COLUMN expires_at TEXT"); } catch {}
  try { db.exec("ALTER TABLE agent_actions ADD COLUMN payload_hash TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec('ALTER TABLE stalls ADD COLUMN parent_id TEXT REFERENCES stalls(id) ON DELETE RESTRICT'); } catch {}
  try { db.exec("ALTER TABLE stalls ADD COLUMN aliases_json TEXT NOT NULL DEFAULT '[]'"); } catch {}
  try { db.exec("ALTER TABLE canteens ADD COLUMN venue_kind TEXT NOT NULL DEFAULT 'dining_hall'"); } catch {}
  try { db.exec("ALTER TABLE canteens ADD COLUMN display_name TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec('ALTER TABLE canteens ADD COLUMN display_order INTEGER NOT NULL DEFAULT 999'); } catch {}
  try { db.exec("ALTER TABLE canteens ADD COLUMN operating_status TEXT NOT NULL DEFAULT 'open'"); } catch {}
  try { db.exec('ALTER TABLE stalls ADD COLUMN reservation_enabled INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE dishes ADD COLUMN reservation_enabled INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec("ALTER TABLE audit_logs ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'"); } catch {}
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
  try { db.exec('ALTER TABLE orders ADD COLUMN stall_id TEXT REFERENCES stalls(id) ON DELETE RESTRICT'); } catch {}
  try { db.exec("ALTER TABLE orders ADD COLUMN order_type TEXT NOT NULL DEFAULT 'reservation'"); } catch {}
  try { db.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'at_stall'"); } catch {}
  try { db.exec("ALTER TABLE orders ADD COLUMN pricing_status TEXT NOT NULL DEFAULT 'exact'"); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN estimated_amount REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN final_amount REAL'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN idempotency_key TEXT'); } catch {}
  try { db.exec("ALTER TABLE order_items ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'fixed'"); } catch {}
  try { db.exec("ALTER TABLE order_items ADD COLUMN price_display TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE order_items ADD COLUMN pricing_snapshot_json TEXT NOT NULL DEFAULT '{}'"); } catch {}
  try { db.exec("ALTER TABLE order_items ADD COLUMN pricing_status TEXT NOT NULL DEFAULT 'exact'"); } catch {}
  try { db.exec('ALTER TABLE order_items ADD COLUMN estimated_unit_price REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE order_items ADD COLUMN confirmed_unit_price REAL'); } catch {}
  try { db.exec("ALTER TABLE order_items ADD COLUMN item_note TEXT NOT NULL DEFAULT ''"); } catch {}
  // Dish allergen info
  try { db.exec("ALTER TABLE dishes ADD COLUMN allergens_json TEXT NOT NULL DEFAULT '[]'"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN seasonings_json TEXT NOT NULL DEFAULT '[]'"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN additives_json TEXT NOT NULL DEFAULT '[]'"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN safety_declarations_json TEXT NOT NULL DEFAULT '[]'"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN nutrition_fact_status TEXT NOT NULL DEFAULT 'unknown'"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN recipe_fact_status TEXT NOT NULL DEFAULT 'unknown'"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN halal_fact_status TEXT NOT NULL DEFAULT 'unknown'"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN dietary_fact_status TEXT NOT NULL DEFAULT 'unknown'"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN spice_level INTEGER"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN spice_fact_status TEXT NOT NULL DEFAULT 'unknown'"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN fact_source TEXT NOT NULL DEFAULT 'legacy'"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN fact_verified_at TEXT"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN fact_expires_at TEXT"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN data_version TEXT NOT NULL DEFAULT 'legacy'"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'fixed'"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN price_display TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN pricing_json TEXT NOT NULL DEFAULT '{}'"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN aliases_json TEXT NOT NULL DEFAULT '[]'"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN semantic_labels_json TEXT NOT NULL DEFAULT '[]'"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN source_ref_json TEXT NOT NULL DEFAULT '{}'"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN catalog_item_type TEXT NOT NULL DEFAULT 'meal'"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN catalog_category TEXT NOT NULL DEFAULT '其他餐食'"); } catch {}
  try { db.exec('ALTER TABLE dishes ADD COLUMN parent_dish_id TEXT REFERENCES dishes(id) ON DELETE SET NULL'); } catch {}
  db.exec("UPDATE dishes SET price_display = CAST(price AS TEXT) || '元' WHERE price_display IS NULL OR price_display = ''");
  const legacySafetyRows = db.prepare("SELECT id, allergens_json, safety_declarations_json FROM dishes WHERE safety_declarations_json IS NULL OR safety_declarations_json = '[]'").all();
  const updateLegacySafety = db.prepare('UPDATE dishes SET safety_declarations_json = ? WHERE id = ?');
  for (const row of legacySafetyRows) {
    const allergens = parseJson(row.allergens_json, []);
    const declarations = allergens.length
      ? allergens.map((allergenCode) => ({ allergenCode, status: 'confirmed_present', source: 'legacy_allergens_json', dataVersion: 'legacy' }))
      : [{ allergenCode: '*', status: 'unknown', source: 'legacy_empty_allergens', dataVersion: 'legacy' }];
    updateLegacySafety.run(json(declarations), row.id);
  }
  // Regional display label and health-profile allergen constraints
  try { db.exec("ALTER TABLE dishes ADD COLUMN regional_taste TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE health_profiles ADD COLUMN allergies_json TEXT NOT NULL DEFAULT '[]'"); } catch {}
  try { db.exec("ALTER TABLE dishes ADD COLUMN dietary_labels_json TEXT NOT NULL DEFAULT '[]'"); } catch {}
  try { db.exec("ALTER TABLE health_profiles ADD COLUMN onboarding_status TEXT NOT NULL DEFAULT 'completed'"); } catch {}
  try { db.exec("ALTER TABLE health_profiles ADD COLUMN allergy_status TEXT NOT NULL DEFAULT 'none'"); } catch {}
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
  try { db.exec("ALTER TABLE health_profiles ADD COLUMN dietary_pattern TEXT NOT NULL DEFAULT 'unrestricted'"); } catch {}
  try { db.exec("ALTER TABLE health_profiles ADD COLUMN spice_level INTEGER NOT NULL DEFAULT 0"); } catch {}
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_phone_hash ON users(tenant_id, phone_hash) WHERE phone_hash IS NOT NULL AND phone_hash != '';
      CREATE INDEX IF NOT EXISTS idx_users_tenant_username ON users(tenant_id, username);
      CREATE INDEX IF NOT EXISTS idx_content_reactions_target ON content_reactions(tenant_id, target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments(tenant_id, post_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_content_reports_target ON content_reports(tenant_id, target_type, target_id, status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_content_reports_pending_unique ON content_reports(tenant_id, reporter_id, target_type, target_id) WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_auth_codes_phone_created ON auth_verification_codes(tenant_id, phone_hash, purpose, created_at);
    CREATE INDEX IF NOT EXISTS idx_canteens_tenant ON canteens(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_stalls_tenant_canteen ON stalls(tenant_id, canteen_id);
    CREATE INDEX IF NOT EXISTS idx_stalls_tenant_parent ON stalls(tenant_id, parent_id);
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
    CREATE INDEX IF NOT EXISTS idx_canteens_tenant_kind ON canteens(tenant_id, venue_kind, parent_id);
    CREATE INDEX IF NOT EXISTS idx_canteens_tenant_catalog_order ON canteens(tenant_id, parent_id, display_order, name, id);
    CREATE INDEX IF NOT EXISTS idx_canteens_tenant_operating_status ON canteens(tenant_id, operating_status, id);
    CREATE INDEX IF NOT EXISTS idx_stalls_catalog_reservations ON stalls(tenant_id, canteen_id, reservation_enabled, id);
    CREATE INDEX IF NOT EXISTS idx_dishes_catalog_reservations ON dishes(tenant_id, stall_id, status, reservation_enabled, id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_tenant_user_idempotency ON orders(tenant_id, user_id, idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
    CREATE INDEX IF NOT EXISTS idx_orders_tenant_stall_created ON orders(tenant_id, stall_id, created_at);
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
    CREATE INDEX IF NOT EXISTS idx_import_batches_tenant_status ON data_import_batches(tenant_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_catalog_import_rows_batch ON catalog_import_rows(tenant_id, batch_id, status);
    CREATE INDEX IF NOT EXISTS idx_dish_ai_annotations_tenant_status ON dish_ai_annotations(tenant_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_dish_ai_annotations_dish ON dish_ai_annotations(tenant_id, dish_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_catalog_intro_batches_tenant_status ON catalog_introduction_batches(tenant_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_catalog_introductions_tenant_batch ON catalog_entity_introductions(tenant_id, batch_id, status, hierarchy_level);
    CREATE INDEX IF NOT EXISTS idx_catalog_introductions_entity ON catalog_entity_introductions(tenant_id, entity_type, entity_id, version DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_introductions_one_approved ON catalog_entity_introductions(tenant_id, entity_type, entity_id) WHERE status = 'approved';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_import_rows_source
      ON catalog_import_rows(batch_id, source_hash, source_locator, entity_type, COALESCE(entity_id, ''));
  `);
}

function seed(db) {
  const now = new Date().toISOString();
  if (db.prepare('SELECT COUNT(*) AS count FROM tenants').get().count === 0) {
    db.prepare('INSERT INTO tenants (id, name, status, plan, ai_quota, storage_quota_mb, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('default', '默认校园', 'active', 'enterprise', 1000, 10240, now, now);
  }
  if (!DEMO_SEED_ENABLED) return;
  const users = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (users === 0) {
    const insertUser = db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    insertUser.run('u-demo-student', '演示学生', hashPassword('student123'), '演示学生', 'student', now, now);
    insertUser.run('u-admin', 'admin', hashPassword('admin123'), '管理员', 'admin', now, now);
    db.prepare('INSERT INTO health_profiles (user_id, goal, budget_max, meal_type, taste, halal_only, avoid_json, dietary_pattern, spice_level, nutrition_focus_json, prefer_low_crowd, favorite_tags_json, onboarding_status, allergy_status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('u-demo-student', 'fatLoss', 18, 'lunch', '不限', 0, '[]', 'unrestricted', 0, '[]', 0, '[]', 'completed', 'none', now);
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
    const insert = db.prepare(`INSERT INTO dishes (id, tenant_id, stall_id, name, price, taste, cuisine, ingredients_json, tags_json, halal, meal_types_json, calories, protein, fat, carbs, fiber, sodium, sugar, calcium, iron, rating, review_count, sales, image, image_url, description, dietary_labels_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of seedDishes) {
      const en = item.expandedNutrition || {};
      insert.run(item.id, 'default', item.stallId, item.name, item.price, item.taste, item.cuisine, json(item.ingredients), json(item.tags), item.halal ? 1 : 0, json(item.mealTypes), item.nutrition.calories, item.nutrition.protein, item.nutrition.fat, item.nutrition.carbs, en.fiber || 0, en.sodium || 0, en.sugar || 0, en.calcium || 0, en.iron || 0, item.rating, item.reviewCount, item.sales, item.image, item.imageUrl || null, item.description, json(item.dietaryLabels || []), now, now);
    }
  } else {
    // Backfill new dishes and expanded nutrition for existing databases
    for (const item of seedDishes) {
      const exists = db.prepare('SELECT id FROM dishes WHERE id = ?').get(item.id);
      if (!exists) {
        const en = item.expandedNutrition || {};
        db.prepare(`INSERT INTO dishes (id, tenant_id, stall_id, name, price, taste, cuisine, ingredients_json, tags_json, halal, meal_types_json, calories, protein, fat, carbs, fiber, sodium, sugar, calcium, iron, rating, review_count, sales, image, image_url, description, dietary_labels_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(item.id, 'default', item.stallId, item.name, item.price, item.taste, item.cuisine, json(item.ingredients), json(item.tags), item.halal ? 1 : 0, json(item.mealTypes), item.nutrition.calories, item.nutrition.protein, item.nutrition.fat, item.nutrition.carbs, en.fiber || 0, en.sodium || 0, en.sugar || 0, en.calcium || 0, en.iron || 0, item.rating, item.reviewCount, item.sales, item.image, item.imageUrl || null, item.description, json(item.dietaryLabels || []), now, now);
      }
    }
  }
  const updateSeedImage = db.prepare('UPDATE dishes SET image_url = ? WHERE id = ? AND (image_url IS NULL OR image_url = ?)');
  for (const item of seedDishes) {
    if (item.imageUrl) updateSeedImage.run(item.imageUrl, item.id, '');
  }

  // Demo nutrition values are authored fixture estimates, not unknown zero placeholders.
  const markSeedNutritionEstimated = db.prepare(`UPDATE dishes
    SET nutrition_fact_status = 'estimated',
        fact_source = CASE WHEN fact_source = 'legacy' THEN 'demo_seed' ELSE fact_source END,
        data_version = CASE WHEN data_version = 'legacy' THEN 'demo-seed-v1' ELSE data_version END
    WHERE id = ? AND nutrition_fact_status = 'unknown'`);
  for (const item of seedDishes) markSeedNutritionEstimated.run(item.id);
  // Test fixtures opt into reservation behavior explicitly; production never executes this seed block.
  db.prepare("UPDATE stalls SET reservation_enabled = 1 WHERE tenant_id = 'default'").run();
  db.prepare("UPDATE dishes SET reservation_enabled = 1 WHERE tenant_id = 'default'").run();

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
  const today = businessDate(now);
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
    venueKind: row.venue_kind || 'dining_hall',
    displayName: row.display_name || row.name,
    displayOrder: Number(row.display_order ?? 999),
    operatingStatus: row.operating_status || 'open',
    image: row.image && !String(row.image).startsWith('http') && !String(row.image).startsWith('upload://') ? row.image : '',
    imageUrl: resolveUploadReference(row.image && (String(row.image).startsWith('http') || String(row.image).startsWith('upload://')) ? row.image : '')
  };
}

export function rowToStall(row) {
  return {
    id: row.id,
    canteenId: row.canteen_id,
    parentId: row.parent_id || null,
    floor: row.floor,
    name: row.name,
    aliases: parseJson(row.aliases_json, []),
    category: row.category,
    rating: row.rating,
    avgPrice: row.avg_price,
    open: Boolean(row.open),
    reservationEnabled: Boolean(row.reservation_enabled),
    description: row.description
  };
}

export function rowToDish(row) {
  const pricing = normalizeDishPricing({
    pricingMode: row.pricing_mode,
    priceDisplay: row.price_display,
    pricing: parseJson(row.pricing_json, {}),
  }, row.price);
  const sourceName = String(row.name || '').trim();
  const name = cleanDishCatalogName(sourceName);
  const tags = parseJson(row.tags_json, []).filter((tag) => tag !== '不辣');
  const semanticLabels = parseJson(row.semantic_labels_json, []);
  return {
    id: row.id,
    stallId: row.stall_id,
    name,
    sourceName: sourceName !== name ? sourceName : null,
    price: row.price,
    pricingMode: pricing.mode,
    priceDisplay: pricing.display,
    pricing,
    taste: row.taste,
    cuisine: row.cuisine,
    ingredients: parseJson(row.ingredients_json, []),
    seasonings: parseJson(row.seasonings_json, []),
    additives: parseJson(row.additives_json, []),
    tags,
    halal: Boolean(row.halal),
    mealTypes: parseJson(row.meal_types_json, ['lunch', 'dinner']),
    nutrition: { calories: row.calories, protein: row.protein, fat: row.fat, carbs: row.carbs },
    fiber: row.fiber || 0,
    sodium: row.sodium || 0,
    sugar: row.sugar || 0,
    calcium: row.calcium || 0,
    iron: row.iron || 0,
    allergens: parseJson(row.allergens_json, []),
    safetyDeclarations: parseJson(row.safety_declarations_json, []),
    dietaryLabels: parseJson(row.dietary_labels_json, []),
    factStatus: {
      nutrition: row.nutrition_fact_status || 'unknown',
      recipe: row.recipe_fact_status || 'unknown',
      halal: row.halal_fact_status || 'unknown',
      dietary: row.dietary_fact_status || 'unknown',
      spice: row.spice_fact_status || 'unknown'
    },
    spiceLevel: row.spice_level == null ? null : Number(row.spice_level),
    factSource: row.fact_source || 'legacy',
    factVerifiedAt: row.fact_verified_at || null,
    factExpiresAt: row.fact_expires_at || null,
    dataVersion: row.data_version || 'legacy',
    synthetic: Boolean(row.synthetic),
    aliases: parseJson(row.aliases_json, []),
    semanticLabels,
    catalogItemType: row.catalog_item_type || 'meal',
    parentDishId: row.parent_dish_id || null,
    catalogCategory: row.catalog_category || inferDishCatalogCategory({ name, cuisine: row.cuisine, tags, semanticLabels, catalogItemType: row.catalog_item_type || 'meal' }),
    sourceRef: parseJson(row.source_ref_json, {}),
    regionalTaste: row.regional_taste || '',
    rating: row.rating,
    reviewCount: row.review_count,
    sales: row.sales,
    image: row.image,
    imageUrl: resolveUploadReference(row.image_url),
    description: row.description,
    status: row.status,
    reservationEnabled: Boolean(row.reservation_enabled)
  };
}


export function rowToReview(row) {
  const user = row.nickname || row.username || '匿名用户';
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    userId: row.user_id,
    user,
    author: { id: row.user_id, name: user, username: row.username || null, nickname: row.nickname || null },
    rating: row.rating,
    content: row.content,
    status: row.status || 'approved',
    linkedPostId: row.linked_post_id || null,
    createdAt: row.created_at
  };
}

export function rowToPost(row) {
  const user = row.nickname || row.username || '匿名用户';
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    userId: row.user_id,
    user,
    author: { id: row.user_id, name: user, username: row.username || null, nickname: row.nickname || null },
    content: row.content,
    imageUrl: resolveUploadReference(row.image_url),
    rating: row.rating == null ? null : Number(row.rating),
    status: row.status || 'pending',
    linkedReviewId: row.linked_review_id || null,
    linkedReviewStatus: row.linked_review_status || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
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
    allergies: parseJson(row.allergies_json, []),
    dietaryPattern: row.dietary_pattern === 'balanced' ? 'unrestricted' : (row.dietary_pattern || 'unrestricted'),
    spiceLevel: row.spice_level ?? 0,
    nutritionFocus: parseJson(row.nutrition_focus_json, []),
    preferLowCrowd: Boolean(row.prefer_low_crowd),
    favoriteTags: parseJson(row.favorite_tags_json, []),
    onboardingStatus: row.onboarding_status || 'completed',
    allergyStatus: row.allergy_status || (parseJson(row.allergies_json, []).length ? 'declared' : 'none')
  } : { goal: 'healthy', budgetMax: 20, mealType: 'lunch', taste: '不限', halalOnly: false, avoid: [], allergies: [], dietaryPattern: 'unrestricted', spiceLevel: 0, nutritionFocus: [], preferLowCrowd: false, favoriteTags: [], onboardingStatus: 'pending', allergyStatus: 'unknown' };
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
    metadata: parseJson(row.metadata_json, {}),
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
export class PgDatabase {
  constructor(pool, queryable = pool) {
    this.pool = pool;
    this.queryable = queryable;
    this.isPostgres = true;
  }

  runWithContext(context, operation) {
    const normalized = {
      tenantId: String(context?.tenantId || 'default').slice(0, 80),
      userId: String(context?.userId || '').slice(0, 120),
      role: String(context?.role || 'anonymous').slice(0, 80),
      requestId: String(context?.requestId || '').slice(0, 120)
    };
    return pgRequestContext.run(normalized, operation);
  }

  updateContext(context = {}) {
    const current = pgRequestContext.getStore();
    if (!current) return;
    if (context.tenantId !== undefined) current.tenantId = String(context.tenantId || 'default').slice(0, 80);
    if (context.userId !== undefined) current.userId = String(context.userId || '').slice(0, 120);
    if (context.role !== undefined) current.role = String(context.role || 'anonymous').slice(0, 80);
    if (context.requestId !== undefined) current.requestId = String(context.requestId || '').slice(0, 120);
  }

  currentContext() {
    return pgRequestContext.getStore() || null;
  }

  async applyContext(client, local = true) {
    const context = this.currentContext();
    if (!context) return;
    await client.query(
      `SELECT
        set_config('app.tenant_id', $1, $5),
        set_config('app.user_id', $2, $5),
        set_config('app.role', $3, $5),
        set_config('app.request_id', $4, $5)`,
      [context.tenantId, context.userId, context.role, context.requestId, local]
    );
  }

  async query(sql, params = []) {
    if (this.queryable !== this.pool || !this.currentContext()) {
      return this.queryable.query(sql, params);
    }

    const client = await this.pool.connect();
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;
      await this.applyContext(client, true);
      const result = await client.query(sql, params);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (began) await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  prepare(sql) {
    const pgSql = sqliteToPg(sql);
    return {
      all:  (...params) => this.query(pgSql, params).then(r => r.rows),
      get:  (...params) => this.query(pgSql, params).then(r => r.rows[0] ?? undefined),
      run:  (...params) => this.query(pgSql, params).then(r => ({ changes: r.rowCount })),
    };
  }

  exec(sql) {
    return this.query(sql);
  }

  async transaction(operation) {
    const client = await this.pool.connect();
    const transactionDb = new PgDatabase(this.pool, client);
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;
      await transactionDb.applyContext(client, true);
      const result = await operation(transactionDb);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (began) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  close() {
    return this.pool.end();
  }

  async ping() {
    const row = await this.prepare('SELECT 1 AS ok').get();
    return Number(row?.ok || 0) === 1;
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
function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function postgresPoolOptions(connectionString, { applicationName = process.env.PG_APPLICATION_NAME || 'smart-canteen-api' } = {}) {
  return {
    connectionString,
    max: positiveInteger(process.env.PG_POOL_MAX, 10, { max: 100 }),
    min: positiveInteger(process.env.PG_POOL_MIN, 0, { min: 0, max: 20 }),
    connectionTimeoutMillis: positiveInteger(process.env.PG_POOL_ACQUIRE_TIMEOUT_MS, 5000, { max: 120000 }),
    idleTimeoutMillis: positiveInteger(process.env.PG_POOL_IDLE_TIMEOUT_MS, 30000, { max: 600000 }),
    maxLifetimeSeconds: positiveInteger(process.env.PG_POOL_MAX_LIFETIME_SECONDS, 1800, { max: 86400 }),
    statement_timeout: positiveInteger(process.env.PG_STATEMENT_TIMEOUT_MS, 10000, { max: 300000 }),
    query_timeout: positiveInteger(process.env.PG_QUERY_TIMEOUT_MS, 12000, { max: 300000 }),
    idle_in_transaction_session_timeout: positiveInteger(process.env.PG_IDLE_TRANSACTION_TIMEOUT_MS, 15000, { max: 300000 }),
    application_name: String(applicationName).slice(0, 63)
  };
}

export async function openPostgresDatabase(url = process.env.DATABASE_URL, {
  migrate = process.env.DB_MIGRATE === '1' || process.env.DB_MIGRATE === 'true',
  applicationName = process.env.PG_APPLICATION_NAME || 'smart-canteen-api'
} = {}) {
  if (!PgPool) {
    throw new Error('PostgreSQL driver (pg) is not installed. Run: npm install pg');
  }
  if (!url) throw new Error('DATABASE_URL is required for PostgreSQL');

  if (migrate) {
    const migrationUrl = process.env.DATABASE_MIGRATION_URL || url;
    const migrationPool = new PgPool({
      ...postgresPoolOptions(migrationUrl),
      max: 1,
      application_name: 'smart-canteen-migrator'
    });
    try {
      await runMigrations(new PgDatabase(migrationPool));
    } finally {
      await migrationPool.end();
    }
  }

  const pool = new PgPool(postgresPoolOptions(url, { applicationName }));
  // Verify connectivity before returning the adapter.
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
  const db = new PgDatabase(pool);
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
