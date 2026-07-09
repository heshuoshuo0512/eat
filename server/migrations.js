import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

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

export async function runMigrations(db) {
  await ensureMigrationTable(db);
  const applied = await appliedMigrations(db);
  const pending = [];
  for (const file of listMigrationFiles()) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    await db.exec(sql);
    pending.push(version);
  }
  return pending;
}
