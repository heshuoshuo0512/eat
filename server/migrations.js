import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

const migrationAliases = new Map([
  ['001_enterprise_foundation', ['001_initial_schema']],
  ['008_retrieval_pgvector', ['002_retrieval_pgvector']]
]);

const legacyMigrationStates = [
  {
    version: '002_generic_review_targets',
    checkSql: `
      /* migration-state:002_generic_review_targets */
      SELECT (
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = ANY (current_schemas(false))
            AND table_name = 'reviews' AND column_name = 'status'
        )
        AND EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = to_regclass('reviews') AND contype = 'c'
            AND pg_get_constraintdef(oid) ILIKE '%target_type%'
            AND pg_get_constraintdef(oid) ILIKE '%canteen%'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_constraint migration_constraint
          JOIN pg_attribute migration_attribute
            ON migration_attribute.attrelid = migration_constraint.conrelid
           AND migration_attribute.attnum = ANY (migration_constraint.conkey)
          WHERE migration_constraint.conrelid = to_regclass('reviews')
            AND migration_constraint.contype = 'f'
            AND migration_attribute.attname = 'target_id'
        )
      ) AS applied
    `,
    repairSql: `
      /* migration-repair:002_generic_review_targets */
      CREATE INDEX IF NOT EXISTS idx_reviews_target ON reviews(target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_reviews_tenant_target ON reviews(tenant_id, target_type, target_id);
    `
  },
  {
    version: '003_contextual_recommendation',
    checkSql: `
      /* migration-state:003_contextual_recommendation */
      SELECT (
        (SELECT COUNT(*) = 3 FROM information_schema.columns
          WHERE table_schema = ANY (current_schemas(false)) AND table_name = 'canteens'
            AND column_name IN ('parent_id', 'canteen_type', 'image'))
        AND (SELECT COUNT(*) = 5 FROM information_schema.columns
          WHERE table_schema = ANY (current_schemas(false)) AND table_name = 'dishes'
            AND column_name IN ('fiber', 'sodium', 'sugar', 'calcium', 'iron'))
        AND (SELECT COUNT(*) = 5 FROM information_schema.columns
          WHERE table_schema = ANY (current_schemas(false)) AND table_name = 'health_profiles'
            AND column_name IN ('dietary_pattern', 'spice_level', 'nutrition_focus_json', 'prefer_low_crowd', 'favorite_tags_json'))
        AND to_regclass('user_dish_preferences') IS NOT NULL
        AND to_regclass('campus_environment') IS NOT NULL
      ) AS applied
    `,
    repairSql: `
      /* migration-repair:003_contextual_recommendation */
      CREATE INDEX IF NOT EXISTS idx_user_dish_prefs_user ON user_dish_preferences(tenant_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_user_dish_prefs_dish ON user_dish_preferences(tenant_id, dish_id);
      CREATE INDEX IF NOT EXISTS idx_canteens_parent ON canteens(tenant_id, parent_id);
    `
  },
  {
    version: '004_database_workbench',
    checkSql: `
      /* migration-state:004_database_workbench */
      SELECT (
        SELECT COUNT(*) = 11 FROM information_schema.columns
        WHERE table_schema = ANY (current_schemas(false)) AND table_name = 'data_import_batches'
          AND column_name IN (
            'id', 'tenant_id', 'entity_type', 'status', 'source_name', 'row_count',
            'error_count', 'created_by', 'reviewed_by', 'created_at', 'updated_at'
          )
      ) AS applied
    `,
    repairSql: `
      /* migration-repair:004_database_workbench */
      CREATE INDEX IF NOT EXISTS idx_import_batches_tenant_status ON data_import_batches(tenant_id, status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at ON schema_migrations(applied_at);
    `
  },
  {
    version: '005_campus_posts',
    checkSql: `
      /* migration-state:005_campus_posts */
      SELECT (
        SELECT COUNT(*) = 12 FROM information_schema.columns
        WHERE table_schema = ANY (current_schemas(false)) AND table_name = 'campus_posts'
          AND column_name IN (
            'id', 'tenant_id', 'user_id', 'target_type', 'target_id', 'content',
            'image_url', 'rating', 'status', 'linked_review_id', 'created_at', 'updated_at'
          )
      ) AS applied
    `,
    repairSql: `
      /* migration-repair:005_campus_posts */
      CREATE INDEX IF NOT EXISTS idx_campus_posts_tenant_status ON campus_posts(tenant_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_campus_posts_user ON campus_posts(tenant_id, user_id, created_at);
    `
  },
  {
    version: '006_admin_stall_hierarchy',
    checkSql: `
      /* migration-state:006_admin_stall_hierarchy */
      SELECT (
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = ANY (current_schemas(false))
            AND table_name = 'stalls' AND column_name = 'parent_id'
        )
        AND EXISTS (
          SELECT 1
          FROM pg_constraint migration_constraint
          JOIN pg_attribute migration_attribute
            ON migration_attribute.attrelid = migration_constraint.conrelid
           AND migration_attribute.attnum = ANY (migration_constraint.conkey)
          WHERE migration_constraint.conrelid = to_regclass('stalls')
            AND migration_constraint.confrelid = to_regclass('stalls')
            AND migration_constraint.contype = 'f'
            AND migration_constraint.confdeltype = 'r'
            AND migration_attribute.attname = 'parent_id'
        )
      ) AS applied
    `,
    repairSql: `
      /* migration-repair:006_admin_stall_hierarchy */
      CREATE INDEX IF NOT EXISTS idx_stalls_tenant_parent ON stalls(tenant_id, parent_id);
    `
  },
  {
    version: '007_admin_audit_metadata',
    checkSql: `
      /* migration-state:007_admin_audit_metadata */
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = ANY (current_schemas(false))
          AND table_name = 'audit_logs' AND column_name = 'metadata_json'
          AND is_nullable = 'NO'
      ) AS applied
    `
  }
];

export function listMigrationFiles() {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
}

export async function ensureMigrationTable(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function appliedMigrations(db) {
  await ensureMigrationTable(db);
  const rows = await db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  return new Set(rows.map((row) => row.version));
}

async function recordMigration(db, version) {
  await db.prepare(`
    INSERT INTO schema_migrations(version)
    VALUES (?)
    ON CONFLICT (version) DO NOTHING
  `).run(version);
}

async function inTransaction(db, operation) {
  if (typeof db.transaction === 'function') return db.transaction(operation);
  return operation(db);
}

function isAppliedState(value) {
  return value === true || value === 1 || value === '1' || value === 't';
}

async function reconciledMigrations(db) {
  const applied = await appliedMigrations(db);

  for (const [version, aliases] of migrationAliases) {
    if (applied.has(version) || !aliases.some((alias) => applied.has(alias))) continue;
    await recordMigration(db, version);
    applied.add(version);
  }

  for (const migration of legacyMigrationStates) {
    if (applied.has(migration.version)) continue;
    const state = await db.prepare(migration.checkSql).get();
    if (!isAppliedState(state?.applied)) continue;
    await inTransaction(db, async (migrationDb) => {
      if (migration.repairSql) await migrationDb.exec(migration.repairSql);
      await recordMigration(migrationDb, migration.version);
    });
    applied.add(migration.version);
  }

  return applied;
}

async function applyMigration(db, file, version) {
  const sql = readFileSync(join(migrationsDir, file), 'utf8');
  const operation = async (migrationDb) => {
    await migrationDb.exec(sql);
    await recordMigration(migrationDb, version);
  };

  await inTransaction(db, operation);
}

export async function runMigrations(db) {
  const applied = await reconciledMigrations(db);
  const pending = [];
  for (const file of listMigrationFiles()) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    await applyMigration(db, file, version);
    applied.add(version);
    pending.push(version);
  }
  return pending;
}
