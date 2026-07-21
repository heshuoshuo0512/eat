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
const runtimeColumnsUpgrade = readFileSync(join(root, 'server', 'migrations', '009_dish_menu_runtime_columns.sql'), 'utf8');
const runtimeColumnsVersion = '009_dish_menu_runtime_columns';

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
      '006_admin_stall_hierarchy',
      '007_admin_audit_metadata'
    ]) {
      assert.match(historyInsert, new RegExp(`'${version}'`));
    }
    for (const version of ['004_database_workbench', '005_campus_posts', '008_retrieval_pgvector', runtimeColumnsVersion]) {
      assert.doesNotMatch(historyInsert, new RegExp(`'${version}'`));
    }
    assert.match(postgresBaseline, /idx_reviews_target ON reviews\(target_type, target_id\)/i);
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

    assert.deepEqual(applied, ['004_database_workbench', '005_campus_posts', runtimeColumnsVersion]);
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

    assert.deepEqual(applied, [runtimeColumnsVersion]);
    assert.deepEqual(db.executed, [runtimeColumnsVersion]);
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
