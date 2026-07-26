import { openPostgresDatabase } from '../server/database.js';

const migrationUrl = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!migrationUrl) throw new Error('DATABASE_MIGRATION_URL is required');

const db = await openPostgresDatabase(migrationUrl, {
  migrate: true,
  applicationName: 'smart-canteen-migrator'
});

try {
  await db.ping();
  console.log('Smart Canteen PostgreSQL migrations completed');
} finally {
  await db.close();
}
