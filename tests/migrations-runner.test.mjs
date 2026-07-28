import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listMigrationFiles, runMigrations } from '../server/migrations.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationFiles = listMigrationFiles();
const migrationVersions = migrationFiles.map((file) => file.replace(/\.sql$/, ''));
const migrationBySql = new Map(migrationFiles.map((file) => [
  readFileSync(join(root, 'server', 'migrations', file), 'utf8'),
  file.replace(/\.sql$/, '')
]));
const postgresBaseline = readFileSync(join(root, 'migrations', 'postgres', '001_initial_schema.sql'), 'utf8');
const runtimeFoundation = readFileSync(join(root, 'server', 'migrations', '001_enterprise_foundation.sql'), 'utf8');
const genericReviewUpgrade = readFileSync(join(root, 'server', 'migrations', '002_generic_review_targets.sql'), 'utf8');
const runtimeColumnsUpgrade = readFileSync(join(root, 'server', 'migrations', '009_dish_menu_runtime_columns.sql'), 'utf8');
const runtimeColumnsVersion = '009_dish_menu_runtime_columns';
const regionAllergenUpgrade = readFileSync(join(root, 'server', 'migrations', '010_region_allergen_contract.sql'), 'utf8');
const regionAllergenVersion = '010_region_allergen_contract';
const studentAuthUpgrade = readFileSync(join(root, 'server', 'migrations', '011_student_auth_onboarding.sql'), 'utf8');
const studentAuthVersion = '011_student_auth_onboarding';
const postgresStudentAuthUpgrade = readFileSync(join(root, 'migrations', 'postgres', '004_student_auth_onboarding.sql'), 'utf8');
const ragSafetyUpgrade = readFileSync(join(root, 'server', 'migrations', '012_rag_safety_facts.sql'), 'utf8');
const ragSafetyVersion = '012_rag_safety_facts';
const postgresRagSafetyUpgrade = readFileSync(join(root, 'migrations', 'postgres', '005_rag_safety_facts.sql'), 'utf8');
const supabaseFoundationUpgrade = readFileSync(join(root, 'server', 'migrations', '013_supabase_foundation.sql'), 'utf8');
const supabaseFoundationVersion = '013_supabase_foundation';
const rowLevelSecurityUpgrade = readFileSync(join(root, 'server', 'migrations', '014_row_level_security.sql'), 'utf8');
const rowLevelSecurityVersion = '014_row_level_security';
const realCatalogPricingUpgrade = readFileSync(join(root, 'server', 'migrations', '015_real_catalog_pricing.sql'), 'utf8');
const realCatalogPricingVersion = '015_real_catalog_pricing';
const dishAiAnnotationsUpgrade = readFileSync(join(root, 'server', 'migrations', '016_dish_ai_annotations.sql'), 'utf8');
const dishAiAnnotationsVersion = '016_dish_ai_annotations';
const trustworthyMealVisionUpgrade = readFileSync(join(root, 'server', 'migrations', '017_trustworthy_meal_vision.sql'), 'utf8');
const trustworthyMealVisionVersion = '017_trustworthy_meal_vision';
const stableCatalogReservationVersion = '018_stable_catalog_reservations';
const realCatalogVenueHierarchyVersion = '019_real_catalog_venue_hierarchy';
const roleBootstrap = readFileSync(join(root, 'scripts', 'create-postgres-roles.sql'), 'utf8');
const roleProvisioning = readFileSync(join(root, 'scripts', 'provision-postgres-roles.sql'), 'utf8');
const ownerReassignment = readFileSync(join(root, 'scripts', 'reassign-postgres-owner.sql'), 'utf8');

function createTableColumnNames(sql, tableName) {
  const table = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'));
  assert.ok(table, `missing CREATE TABLE for ${tableName}`);
  const constraints = new Set(['check', 'constraint', 'foreign', 'primary', 'unique']);
  return table[1]
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*([a-z_][a-z0-9_]*)\s+/i)?.[1]?.toLowerCase())
    .filter((name) => name && !constraints.has(name));
}

class FakeMigrationDatabase {
  constructor() {
    this.versions = new Set();
    this.executed = [];
    this.recordAttempts = [];
    this.repairs = [];
    this.transactionCount = 0;
    this.failVersion = null;
    this.appliedStates = new Set();
  }

  prepare(sql) {
    const stateMatch = sql.match(/migration-state:([\w-]+)/i);
    if (stateMatch) {
      return {
        get: async () => ({ applied: this.appliedStates.has(stateMatch[1]) })
      };
    }
    if (/SELECT version FROM schema_migrations/i.test(sql)) {
      return {
        all: async () => [...this.versions].sort().map((version) => ({ version }))
      };
    }
    if (/INSERT INTO schema_migrations\s*\(version\)/i.test(sql)) {
      const ignoresDuplicate = /ON CONFLICT\s*\(version\)\s*DO NOTHING/i.test(sql);
      return {
        run: async (version) => {
          this.recordAttempts.push(version);
          if (this.versions.has(version) && !ignoresDuplicate) {
            throw new Error(`duplicate migration version: ${version}`);
          }
          this.versions.add(version);
          return { changes: 1 };
        }
      };
    }
    throw new Error(`Unexpected prepared statement: ${sql}`);
  }

  async exec(sql) {
    const repairMatch = sql.match(/migration-repair:([\w-]+)/i);
    if (repairMatch) {
      this.repairs.push(repairMatch[1]);
      return;
    }
    const version = migrationBySql.get(sql);
    if (!version) return;

    this.executed.push(version);
    if (version === this.failVersion) throw new Error(`forced failure: ${version}`);

    for (const match of sql.matchAll(/INSERT INTO schema_migrations\s*\(version\)\s*VALUES\s*\('([^']+)'\)/gi)) {
      this.versions.add(match[1]);
    }
  }

  async transaction(operation) {
    this.transactionCount += 1;
    const versionSnapshot = new Set(this.versions);
    const repairCount = this.repairs.length;
    try {
      return await operation(this);
    } catch (error) {
      this.versions = versionSnapshot;
      this.repairs.length = repairCount;
      throw error;
    }
  }
}

describe('PostgreSQL migration runner', () => {
  it('requires an explicit legacy owner before existing database migrations', () => {
    assert.match(ownerReassignment, /legacy_owner is required/i);
    assert.match(ownerReassignment, /REASSIGN OWNED BY :"legacy_owner" TO smart_canteen_migrator/i);
    assert.match(ownerReassignment, /current_database\(\)/i);
  });

  it('records every successful migration and skips 002-007 on a second startup', async () => {
    const db = new FakeMigrationDatabase();

    const firstRun = await runMigrations(db);
    const executedAfterFirstRun = [...db.executed];
    const secondRun = await runMigrations(db);

    assert.deepEqual(firstRun, migrationVersions);
    assert.deepEqual(secondRun, []);
    assert.deepEqual(db.executed, executedAfterFirstRun);
    assert.deepEqual([...db.versions].sort(), [...migrationVersions].sort());
    assert.deepEqual(db.recordAttempts, migrationVersions);

    for (const version of migrationVersions.filter((item) => /^00[2-7]_/.test(item))) {
      assert.equal(db.executed.filter((item) => item === version).length, 1, `${version} should execute once`);
    }
  });

  it('keeps self-registering migrations compatible with centralized recording', async () => {
    const db = new FakeMigrationDatabase();
    const selfRegistering = migrationVersions.filter((version) => {
      const file = `${version}.sql`;
      return /INSERT INTO schema_migrations\s*\(version\)/i.test(
        readFileSync(join(root, 'server', 'migrations', file), 'utf8')
      );
    });

    await runMigrations(db);

    assert.ok(selfRegistering.length > 0);
    for (const version of selfRegistering) {
      assert.ok(db.recordAttempts.includes(version), `${version} should also pass centralized recording`);
      assert.ok(db.versions.has(version));
    }
  });

  it('declares runtime-equivalent versions in the fresh PostgreSQL baseline', () => {
    const historyInsert = postgresBaseline.slice(postgresBaseline.lastIndexOf('INSERT INTO schema_migrations'));

    for (const version of [
      '001_initial_schema',
      '001_enterprise_foundation',
      '002_generic_review_targets',
      '003_contextual_recommendation',
      '004_database_workbench',
      '005_campus_posts',
      '006_admin_stall_hierarchy',
      '007_admin_audit_metadata',
      '008_retrieval_pgvector',
      runtimeColumnsVersion,
      regionAllergenVersion,
      studentAuthVersion,
      ragSafetyVersion,
      supabaseFoundationVersion
    ]) {
      assert.match(historyInsert, new RegExp(`'${version}'`));
    }
    assert.doesNotMatch(historyInsert, new RegExp(`'${rowLevelSecurityVersion}'`));
    assert.doesNotMatch(historyInsert, new RegExp(`'${realCatalogPricingVersion}'`));
    assert.doesNotMatch(historyInsert, new RegExp(`'${dishAiAnnotationsVersion}'`));
    assert.match(postgresBaseline, /idx_reviews_target ON reviews\(target_type, target_id\)/i);
  });

  it('keeps fresh dish table column declarations unique', () => {
    for (const sql of [runtimeFoundation, postgresBaseline]) {
      const columns = createTableColumnNames(sql, 'dishes');
      assert.equal(new Set(columns).size, columns.length);
    }
  });

  it('backfills the missing legacy review status while rebuilding review targets', () => {
    assert.match(genericReviewUpgrade, /content,\s*'approved',\s*created_at\s+FROM reviews_dish_only/i);
  });

  it('defines required dish and menu runtime columns for fresh and existing databases', () => {
    for (const pattern of [
      /allergens_json TEXT NOT NULL DEFAULT '\[\]'/i,
      /supply_count INTEGER NOT NULL DEFAULT 0/i,
      /serving_start TEXT NOT NULL DEFAULT '11:00'/i,
      /serving_end TEXT NOT NULL DEFAULT '13:30'/i
    ]) {
      assert.match(runtimeFoundation, pattern);
      assert.match(postgresBaseline, pattern);
    }

    for (const column of ['allergens_json', 'supply_count', 'serving_start', 'serving_end']) {
      assert.match(runtimeColumnsUpgrade, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`, 'i'));
      assert.match(runtimeColumnsUpgrade, new RegExp(`ALTER COLUMN ${column} SET NOT NULL`, 'i'));
    }
    assert.match(regionAllergenUpgrade, /ADD COLUMN IF NOT EXISTS regional_taste/i);
    assert.match(regionAllergenUpgrade, /ADD COLUMN IF NOT EXISTS allergies_json/i);
    assert.match(regionAllergenUpgrade, /ALTER COLUMN allergies_json SET NOT NULL/i);
  });

  it('defines phone authentication and onboarding fields for fresh and existing databases', () => {
    for (const sql of [postgresBaseline, studentAuthUpgrade, postgresStudentAuthUpgrade]) {
      for (const pattern of [
        /phone_hash TEXT/i,
        /phone_encrypted TEXT/i,
        /token_version INTEGER NOT NULL DEFAULT 0/i,
        /agreement_version TEXT NOT NULL DEFAULT ''/i,
        /onboarding_status TEXT NOT NULL DEFAULT 'completed'/i,
        /allergy_status TEXT NOT NULL DEFAULT 'none'/i,
        /dietary_labels_json TEXT NOT NULL DEFAULT '\[\]'/i,
        /CREATE TABLE IF NOT EXISTS auth_verification_codes/i,
        /idx_users_tenant_phone_hash/i,
        /idx_auth_codes_phone_created/i
      ]) {
        assert.match(sql, pattern);
      }
    }
  });

  it('defines structured food safety and provenance facts for fresh and existing databases', () => {
    for (const sql of [postgresBaseline, ragSafetyUpgrade, postgresRagSafetyUpgrade]) {
      for (const pattern of [
        /seasonings_json TEXT NOT NULL DEFAULT '\[\]'/i,
        /additives_json TEXT NOT NULL DEFAULT '\[\]'/i,
        /safety_declarations_json TEXT NOT NULL DEFAULT '\[\]'/i,
        /nutrition_fact_status TEXT NOT NULL DEFAULT 'unknown'/i,
        /recipe_fact_status TEXT NOT NULL DEFAULT 'unknown'/i,
        /halal_fact_status TEXT NOT NULL DEFAULT 'unknown'/i,
        /dietary_fact_status TEXT NOT NULL DEFAULT 'unknown'/i,
        /spice_level INTEGER/i,
        /spice_fact_status TEXT NOT NULL DEFAULT 'unknown'/i,
        /fact_source TEXT NOT NULL DEFAULT 'legacy'/i,
        /fact_verified_at TEXT/i,
        /fact_expires_at TEXT/i,
        /data_version TEXT NOT NULL DEFAULT 'legacy'/i,
        /synthetic INTEGER NOT NULL DEFAULT 0/i,
      ]) assert.match(sql, pattern);
    }

    for (const sql of [ragSafetyUpgrade, postgresRagSafetyUpgrade]) {
      assert.match(sql, /legacy_empty_allergens/i);
      assert.match(sql, /"status":"unknown"/i);
      assert.match(sql, /legacy_allergens_json/i);
      assert.match(sql, /'confirmed_present'/i);
      assert.doesNotMatch(sql, /"status":"confirmed_absent"/i);
      assert.match(sql, /spice_level BETWEEN 0 AND 5/i);
      assert.match(sql, /IN \('unknown','estimated','verified'\)/i);
    }
  });

  it('defines structured catalog pricing and import provenance for fresh and existing databases', () => {
    for (const pattern of [
      /pricing_mode TEXT NOT NULL DEFAULT 'fixed'/i,
      /price_display TEXT NOT NULL DEFAULT ''/i,
      /pricing_json TEXT NOT NULL DEFAULT '\{\}'/i,
      /aliases_json TEXT NOT NULL DEFAULT '\[\]'/i,
      /semantic_labels_json TEXT NOT NULL DEFAULT '\[\]'/i,
      /source_ref_json TEXT NOT NULL DEFAULT '\{\}'/i,
      /CREATE TABLE IF NOT EXISTS catalog_import_rows/i,
      /idx_catalog_import_rows_batch/i,
      /idx_catalog_import_rows_source/i,
    ]) {
      assert.match(postgresBaseline, pattern);
      assert.match(realCatalogPricingUpgrade, pattern);
    }
    assert.equal((postgresBaseline.match(/rating REAL NOT NULL DEFAULT 0 CHECK\(rating BETWEEN 0 AND 5\)/gi) || []).length, 2);
    assert.match(realCatalogPricingUpgrade, /ALTER TABLE dishes ALTER COLUMN rating SET DEFAULT 0/i);
    assert.match(realCatalogPricingUpgrade, /ALTER TABLE stalls ALTER COLUMN rating SET DEFAULT 0/i);
  });

  it('keeps AI dish annotations isolated, tenant-scoped and reviewable', () => {
    for (const sql of [postgresBaseline, dishAiAnnotationsUpgrade]) {
      for (const pattern of [
        /CREATE TABLE IF NOT EXISTS dish_ai_annotations/i,
        /dish_id TEXT NOT NULL REFERENCES dishes\(id\) ON DELETE CASCADE/i,
        /annotation_json TEXT NOT NULL DEFAULT '\{\}'/i,
        /field_confidence_json TEXT NOT NULL DEFAULT '\{\}'/i,
        /linked_concept_ids_json TEXT NOT NULL DEFAULT '\[\]'/i,
        /status IN \('generated','schema_validated','approved','rejected'\)/i,
        /UNIQUE\(tenant_id, dish_id, batch_id, input_hash\)/i,
      ]) assert.match(sql, pattern);
    }
    assert.match(dishAiAnnotationsUpgrade, /ENABLE ROW LEVEL SECURITY/i);
    assert.match(dishAiAnnotationsUpgrade, /app_current_role\(\) = 'worker' OR app_can_write_catalog\(\)/i);
  });

  it('defines tenant-scoped meal vision data with approved read boundaries', () => {
    for (const pattern of [
      /CREATE TABLE IF NOT EXISTS dish_reference_images/i,
      /purpose IN \('reference','evaluation'\)/i,
      /CREATE TABLE IF NOT EXISTS dish_image_embeddings/i,
      /embedding vector\(768\)/i,
      /USING hnsw \(embedding vector_cosine_ops\)/i,
      /CREATE TABLE IF NOT EXISTS dish_recipe_versions/i,
      /CREATE TABLE IF NOT EXISTS dish_recipe_ingredients/i,
      /CREATE TABLE IF NOT EXISTS dish_nutrition_versions/i,
      /status IN \('unknown','estimated','verified'\)/i,
      /CREATE TABLE IF NOT EXISTS meal_vision_analyses/i,
      /CREATE TABLE IF NOT EXISTS meal_vision_feedback/i,
      /image_hash TEXT NOT NULL/i,
    ]) assert.match(trustworthyMealVisionUpgrade, pattern);

    assert.match(trustworthyMealVisionUpgrade, /quality_status = 'approved' AND purpose = 'reference'/i);
    assert.match(trustworthyMealVisionUpgrade, /vision_reference_upload_read ON uploads FOR SELECT/i);
    assert.match(trustworthyMealVisionUpgrade, /status = 'approved'/i);
    assert.match(trustworthyMealVisionUpgrade, /status IN \('estimated','verified'\)/i);
    assert.match(trustworthyMealVisionUpgrade, /user_id = app_current_user_id\(\) OR app_is_tenant_staff\(\)/i);
    assert.doesNotMatch(trustworthyMealVisionUpgrade, /raw_image|image_base64|image_data/i);
  });

  it('defines normalized identities, rotating sessions, private uploads and Outbox', () => {
    const sharedPatterns = [
      /CREATE TABLE IF NOT EXISTS user_identities/i,
      /CREATE TABLE IF NOT EXISTS auth_sessions/i,
      /CREATE TABLE IF NOT EXISTS auth_refresh_tokens/i,
      /refresh_family_id TEXT NOT NULL/i,
      /CREATE TABLE IF NOT EXISTS outbox_events/i,
      /idempotency_key TEXT NOT NULL UNIQUE/i,
      /visibility TEXT NOT NULL DEFAULT 'private'/i,
      /storage_provider TEXT NOT NULL DEFAULT 'local'/i
    ];
    for (const sql of [postgresBaseline, supabaseFoundationUpgrade]) {
      for (const pattern of sharedPatterns) assert.match(sql, pattern);
    }
    assert.match(supabaseFoundationUpgrade, /ADD COLUMN IF NOT EXISTS wechat_openid/i);
    assert.match(postgresBaseline, /wechat_openid TEXT/i);
  });

  it('enables tenant and owner RLS under non-bypass API and Worker roles', () => {
    for (const pattern of [
      /ENABLE ROW LEVEL SECURITY/i,
      /app\.tenant_id/i,
      /app\.user_id/i,
      /app\.role/i,
      /status = 'approved' OR user_id = app_current_user_id\(\)/i,
      /tenant_id = '__global__'/i,
      /uploads_signed_read/i,
      /outbox_worker_access/i,
      /outbox_metrics_read/i,
      /app_can_write_catalog/i,
      /app_can_moderate_community/i,
      /app_current_role\(\) = 'authenticator' AND app_tenant_matches\(tenant_id\)/i
    ]) assert.match(rowLevelSecurityUpgrade, pattern);
    assert.match(rowLevelSecurityUpgrade, /DO \$\$\s*DECLARE\s+table_name TEXT;\s+write_guard TEXT;\s*BEGIN\s+FOREACH table_name IN ARRAY ARRAY\[\s*'canteens'/i);
    assert.match(roleBootstrap, /CREATE EXTENSION IF NOT EXISTS vector/i);
    assert.match(roleBootstrap, /smart_canteen_migrator/i);
    assert.match(roleProvisioning, /smart_canteen_migrator/i);
    assert.match(roleProvisioning, /smart_canteen_api[\s\S]+NOBYPASSRLS/i);
    assert.match(roleProvisioning, /smart_canteen_worker[\s\S]+NOBYPASSRLS/i);
    assert.doesNotMatch(roleProvisioning, /PASSWORD\s+'[^']+'/i);
  });

  it('normalizes old explicit migration names before running missing migrations', async () => {
    const db = new FakeMigrationDatabase();
    db.versions.add('001_initial_schema');
    db.versions.add('002_retrieval_pgvector');
    for (const version of [
      '002_generic_review_targets',
      '003_contextual_recommendation',
      '006_admin_stall_hierarchy',
      '007_admin_audit_metadata'
    ]) {
      db.appliedStates.add(version);
    }

    const applied = await runMigrations(db);

    assert.deepEqual(applied, ['004_database_workbench', '005_campus_posts', runtimeColumnsVersion, regionAllergenVersion, studentAuthVersion, ragSafetyVersion, supabaseFoundationVersion, rowLevelSecurityVersion, realCatalogPricingVersion, dishAiAnnotationsVersion, trustworthyMealVisionVersion, stableCatalogReservationVersion, realCatalogVenueHierarchyVersion]);
    assert.ok(db.versions.has('001_enterprise_foundation'));
    assert.ok(db.versions.has('008_retrieval_pgvector'));
    assert.ok(!db.executed.includes('002_generic_review_targets'));
    assert.ok(!db.executed.includes('003_contextual_recommendation'));
  });

  it('backfills 002-007 for an old runner database without rebuilding reviews', async () => {
    const db = new FakeMigrationDatabase();
    db.versions.add('001_enterprise_foundation');
    db.versions.add('008_retrieval_pgvector');
    for (const version of migrationVersions.filter((item) => /^00[2-7]_/.test(item))) {
      db.appliedStates.add(version);
    }

    const applied = await runMigrations(db);

    assert.deepEqual(applied, [runtimeColumnsVersion, regionAllergenVersion, studentAuthVersion, ragSafetyVersion, supabaseFoundationVersion, rowLevelSecurityVersion, realCatalogPricingVersion, dishAiAnnotationsVersion, trustworthyMealVisionVersion, stableCatalogReservationVersion, realCatalogVenueHierarchyVersion]);
    assert.deepEqual(db.executed, [runtimeColumnsVersion, regionAllergenVersion, studentAuthVersion, ragSafetyVersion, supabaseFoundationVersion, rowLevelSecurityVersion, realCatalogPricingVersion, dishAiAnnotationsVersion, trustworthyMealVisionVersion, stableCatalogReservationVersion, realCatalogVenueHierarchyVersion]);
    for (const version of migrationVersions.filter((item) => /^00[2-7]_/.test(item))) {
      assert.ok(db.versions.has(version), `${version} should be backfilled`);
    }
    for (const version of [
      '002_generic_review_targets',
      '003_contextual_recommendation',
      '004_database_workbench',
      '005_campus_posts',
      '006_admin_stall_hierarchy'
    ]) {
      assert.ok(db.repairs.includes(version), `${version} should repair idempotent indexes`);
    }
  });

  it('does not register a failed migration and resumes from it later', async () => {
    const db = new FakeMigrationDatabase();
    const failedVersion = migrationVersions.find((version) => version.startsWith('005_'));
    assert.ok(failedVersion, 'expected migration 005 to exist');
    db.failVersion = failedVersion;

    await assert.rejects(() => runMigrations(db), new RegExp(`forced failure: ${failedVersion}`));
    assert.equal(db.versions.has(failedVersion), false);
    assert.deepEqual([...db.versions].sort(), migrationVersions.slice(0, migrationVersions.indexOf(failedVersion)).sort());

    db.failVersion = null;
    const resumed = await runMigrations(db);
    assert.deepEqual(resumed, migrationVersions.slice(migrationVersions.indexOf(failedVersion)));
    assert.equal(db.executed.filter((version) => version === failedVersion).length, 2);
    assert.deepEqual([...db.versions].sort(), [...migrationVersions].sort());
  });
});
