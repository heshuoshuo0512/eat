import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openPostgresDatabase } from '../server/database.js';

const urls = {
  migration: process.env.TEST_POSTGRES_MIGRATION_URL || '',
  api: process.env.TEST_POSTGRES_API_URL || '',
  worker: process.env.TEST_POSTGRES_WORKER_URL || ''
};
const enabled = Object.values(urls).every(Boolean);

describe('PostgreSQL row-level security integration', { skip: enabled ? false : 'TEST_POSTGRES_* URLs are not configured' }, () => {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const id = (name) => `rls-${name}-${suffix}`;
  const tenantA = id('tenant-a');
  const tenantB = id('tenant-b');
  const userA = id('user-a');
  const userB = id('user-b');
  const userOther = id('user-other');
  let migrationDb;
  let apiDb;
  let workerDb;

  before(async () => {
    migrationDb = await openPostgresDatabase(urls.migration, { migrate: false, applicationName: 'smart-canteen-rls-fixture' });
    apiDb = await openPostgresDatabase(urls.api, { migrate: false, applicationName: 'smart-canteen-rls-api-test' });
    workerDb = await openPostgresDatabase(urls.worker, { migrate: false, applicationName: 'smart-canteen-rls-worker-test' });

    const migration = await migrationDb.prepare('SELECT version FROM schema_migrations WHERE version = ?').get('014_row_level_security');
    assert.ok(migration, 'run migrations and the post-migration role grant before this integration test');

    const timestamp = new Date().toISOString();
    for (const [tenantId, name] of [[tenantA, 'RLS A'], [tenantB, 'RLS B']]) {
      await migrationDb.prepare(`
        INSERT INTO tenants (id, name, status, plan, ai_quota, storage_quota_mb, created_at, updated_at)
        VALUES (?, ?, 'active', 'test', 0, 128, ?, ?)
      `).run(tenantId, name, timestamp, timestamp);
    }
    for (const [userId, tenantId, username] of [
      [userA, tenantA, id('student-a')],
      [userB, tenantA, id('student-b')],
      [userOther, tenantB, id('student-other')]
    ]) {
      await migrationDb.prepare(`
        INSERT INTO users (id, tenant_id, username, password_hash, nickname, role, created_at, updated_at)
        VALUES (?, ?, ?, 'fixture', ?, 'student', ?, ?)
      `).run(userId, tenantId, username, username, timestamp, timestamp);
      await migrationDb.prepare(`
        INSERT INTO health_profiles (user_id, tenant_id, onboarding_status, allergy_status, updated_at)
        VALUES (?, ?, 'completed', 'none', ?)
      `).run(userId, tenantId, timestamp);
    }
    for (const [canteenId, tenantId] of [[id('canteen-a'), tenantA], [id('canteen-b'), tenantB]]) {
      await migrationDb.prepare(`
        INSERT INTO canteens (id, tenant_id, name, location, hours, description, created_at, updated_at)
        VALUES (?, ?, ?, 'fixture', '07:00-22:00', 'RLS fixture', ?, ?)
      `).run(canteenId, tenantId, canteenId, timestamp, timestamp);
    }
    for (const [postId, tenantId, authorId, status] of [
      [id('post-own-pending'), tenantA, userA, 'pending'],
      [id('post-other-pending'), tenantA, userB, 'pending'],
      [id('post-other-approved'), tenantA, userB, 'approved'],
      [id('post-cross-approved'), tenantB, userOther, 'approved']
    ]) {
      await migrationDb.prepare(`
        INSERT INTO campus_posts (
          id, tenant_id, user_id, target_type, target_id, content,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, 'canteen', ?, 'RLS fixture', ?, ?, ?)
      `).run(postId, tenantId, authorId, id('target'), status, timestamp, timestamp);
    }
    for (const [documentId, tenantId] of [
      [id('rag-global'), '__global__'],
      [id('rag-a'), tenantA],
      [id('rag-b'), tenantB]
    ]) {
      await migrationDb.prepare(`
        INSERT INTO rag_documents (
          id, tenant_id, source_type, source_id, title, content,
          content_hash, search_text, indexed_at, updated_at
        ) VALUES (?, ?, 'rls_fixture', ?, 'fixture', 'fixture', ?, 'fixture', CURRENT_TIMESTAMP, ?)
      `).run(documentId, tenantId, documentId, documentId, timestamp);
    }
    for (const [eventId, tenantId] of [[id('event-a'), tenantA], [id('event-b'), tenantB]]) {
      await migrationDb.prepare(`
        INSERT INTO outbox_events (
          id, tenant_id, aggregate_type, event_type, idempotency_key,
          status, available_at, created_at
        ) VALUES (?, ?, 'rls_fixture', 'rls.fixture', ?, 'pending', ?, ?)
      `).run(eventId, tenantId, eventId, timestamp, timestamp);
    }
  });

  after(async () => {
    if (migrationDb) {
      for (const table of ['outbox_events', 'rag_documents', 'campus_posts', 'health_profiles', 'canteens', 'users']) {
        await migrationDb.prepare(`DELETE FROM ${table} WHERE tenant_id IN (?, ?)`).run(tenantA, tenantB);
      }
      await migrationDb.prepare('DELETE FROM rag_documents WHERE id = ?').run(id('rag-global'));
      await migrationDb.prepare('DELETE FROM tenants WHERE id IN (?, ?)').run(tenantA, tenantB);
    }
    await Promise.allSettled([apiDb?.close(), workerDb?.close(), migrationDb?.close()]);
  });

  it('uses non-owner, non-bypass runtime roles', async () => {
    for (const [db, expectedRole] of [[apiDb, 'smart_canteen_api'], [workerDb, 'smart_canteen_worker']]) {
      const role = await db.query(`
        SELECT current_user AS role, roles.rolbypassrls, tables.tableowner
        FROM pg_roles roles
        CROSS JOIN pg_tables tables
        WHERE roles.rolname = current_user
          AND tables.schemaname = current_schema()
          AND tables.tablename = 'users'
      `);
      assert.equal(role.rows[0]?.role, expectedRole);
      assert.equal(role.rows[0]?.rolbypassrls, false);
      assert.notEqual(role.rows[0]?.tableowner, expectedRole);
    }
  });

  it('isolates tenant catalog rows and owner-only profile rows', async () => {
    await apiDb.runWithContext({ tenantId: tenantA, userId: userA, role: 'student', requestId: id('request-a') }, async () => {
      const canteens = await apiDb.prepare('SELECT id FROM canteens ORDER BY id').all();
      assert.deepEqual(canteens.map((row) => row.id), [id('canteen-a')]);
      const profiles = await apiDb.prepare('SELECT user_id FROM health_profiles ORDER BY user_id').all();
      assert.deepEqual(profiles.map((row) => row.user_id), [userA]);
      await assert.rejects(
        () => apiDb.prepare(`
          INSERT INTO canteens (id, tenant_id, name, location, hours, description, created_at, updated_at)
          VALUES (?, ?, 'forbidden', 'fixture', 'always', 'fixture', ?, ?)
        `).run(id('student-write'), tenantA, new Date().toISOString(), new Date().toISOString()),
        /row-level security|policy/i
      );
    });
  });

  it('shows approved community content plus the current author pending state', async () => {
    await apiDb.runWithContext({ tenantId: tenantA, userId: userA, role: 'student', requestId: id('request-posts') }, async () => {
      const posts = await apiDb.prepare('SELECT id FROM campus_posts ORDER BY id').all();
      assert.deepEqual(posts.map((row) => row.id), [id('post-other-approved'), id('post-own-pending')].sort());
      await assert.rejects(
        () => apiDb.prepare(`
          INSERT INTO campus_posts (
            id, tenant_id, user_id, target_type, target_id, content, status, created_at, updated_at
          ) VALUES (?, ?, ?, 'canteen', ?, 'forbidden', 'approved', ?, ?)
        `).run(id('student-approved'), tenantA, userA, id('target'), new Date().toISOString(), new Date().toISOString()),
        /row-level security|policy/i
      );
    });
  });

  it('allows Worker access to global/current knowledge and global Outbox claims without cross-tenant writes', async () => {
    await workerDb.runWithContext({ tenantId: tenantA, userId: '', role: 'worker', requestId: id('worker-a') }, async () => {
      const documents = await workerDb.prepare("SELECT id FROM rag_documents WHERE source_type = 'rls_fixture' ORDER BY id").all();
      assert.deepEqual(documents.map((row) => row.id), [id('rag-a'), id('rag-global')].sort());
      await assert.rejects(
        () => workerDb.prepare(`
          INSERT INTO rag_documents (
            id, tenant_id, source_type, source_id, title, content,
            content_hash, search_text, indexed_at, updated_at
          ) VALUES (?, ?, 'rls_fixture', ?, 'forbidden', 'forbidden', ?, 'forbidden', CURRENT_TIMESTAMP, ?)
        `).run(id('rag-cross-write'), tenantB, id('rag-cross-write'), id('rag-cross-write'), new Date().toISOString()),
        /row-level security|policy/i
      );
    });

    await workerDb.runWithContext({ tenantId: '*', userId: '', role: 'worker', requestId: id('worker-global') }, async () => {
      const events = await workerDb.prepare("SELECT id FROM outbox_events WHERE event_type = 'rls.fixture' ORDER BY id").all();
      assert.deepEqual(events.map((row) => row.id), [id('event-a'), id('event-b')].sort());
    });
  });
});
