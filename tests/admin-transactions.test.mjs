import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createApp } from '../server/app.js';
import { openDatabase, PgDatabase } from '../server/database.js';

describe('PostgreSQL transaction adapter', () => {
  it('keeps SQLite initialization and PostgreSQL migration contracts aligned', () => {
    const sqlite = openDatabase(':memory:');
    const stallColumns = sqlite.prepare('PRAGMA table_info(stalls)').all().map((column) => column.name);
    const auditColumns = sqlite.prepare('PRAGMA table_info(audit_logs)').all().map((column) => column.name);
    sqlite.close();
    assert.ok(stallColumns.includes('parent_id'));
    assert.ok(auditColumns.includes('metadata_json'));

    const hierarchyMigration = readFileSync('server/migrations/006_admin_stall_hierarchy.sql', 'utf8');
    const auditMigration = readFileSync('server/migrations/007_admin_audit_metadata.sql', 'utf8');
    const postgresBaseline = readFileSync('migrations/postgres/001_initial_schema.sql', 'utf8');
    assert.match(hierarchyMigration, /ADD COLUMN IF NOT EXISTS parent_id/i);
    assert.match(auditMigration, /ADD COLUMN IF NOT EXISTS metadata_json/i);
    assert.match(postgresBaseline, /parent_id\s+TEXT\s+REFERENCES\s+stalls/i);
    assert.match(postgresBaseline, /metadata_json\s+TEXT\s+NOT NULL\s+DEFAULT\s+'\{\}'/i);
  });

  it('binds statements, commit, and rollback to one acquired client', async () => {
    const calls = [];
    const client = {
      async query(sql, params = []) {
        calls.push({ sql, params });
        if (sql === 'SELECT fail') throw new Error('forced failure');
        return { rows: [{ id: 'row-1' }], rowCount: 1 };
      },
      release() { calls.push({ sql: 'RELEASE', params: [] }); }
    };
    const pool = {
      async connect() { calls.push({ sql: 'CONNECT', params: [] }); return client; },
      async query() { throw new Error('pool.query must not run inside a transaction'); }
    };
    const db = new PgDatabase(pool);

    const result = await db.transaction(async (tx) => {
      await tx.prepare('UPDATE stalls SET parent_id = ? WHERE id = ?').run('parent-1', 'child-1');
      return tx.prepare('SELECT * FROM stalls WHERE id = ?').get('child-1');
    });
    assert.equal(result.id, 'row-1');
    assert.deepEqual(calls.map((entry) => entry.sql), [
      'CONNECT',
      'BEGIN',
      'UPDATE stalls SET parent_id = $1 WHERE id = $2',
      'SELECT * FROM stalls WHERE id = $1',
      'COMMIT',
      'RELEASE'
    ]);

    calls.length = 0;
    await assert.rejects(() => db.transaction((tx) => tx.exec('SELECT fail')), /forced failure/);
    assert.deepEqual(calls.map((entry) => entry.sql), ['CONNECT', 'BEGIN', 'SELECT fail', 'ROLLBACK', 'RELEASE']);
  });
});

describe('campus post moderation transaction rollback', () => {
  let rawDb;
  let server;
  let baseUrl;
  let failAudit = false;

  const req = async (path, { method = 'GET', token, body } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json().catch(() => null) };
  };

  before(() => {
    rawDb = openDatabase(':memory:');
    const db = {
      prepare(sql) {
        if (failAudit && /INSERT INTO audit_logs/i.test(sql)) {
          return {
            run() { throw new Error('forced audit failure'); },
            get: (...params) => rawDb.prepare(sql).get(...params),
            all: (...params) => rawDb.prepare(sql).all(...params)
          };
        }
        return rawDb.prepare(sql);
      },
      exec(sql) { return rawDb.exec(sql); }
    };
    server = createServer(createApp({ db }).handler);
    server.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server.close();
    rawDb.close();
  });

  it('rolls back post, linked review, and audit state together', async () => {
    const adminLogin = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
    const studentLogin = await req('/api/auth/login', { method: 'POST', body: { username: '演示学生', password: 'student123' } });
    const bootstrap = await req('/api/bootstrap');
    const dishId = bootstrap.data.dishes[0].id;
    const created = await req('/api/posts', {
      method: 'POST',
      token: studentLogin.data.token,
      body: { targetType: 'dish', targetId: dishId, content: '事务失败时不得产生半完成评价', rating: 5 }
    });
    assert.equal(created.status, 201);

    failAudit = true;
    const failed = await req(`/api/admin/posts/${created.data.post.id}/status`, {
      method: 'PATCH', token: adminLogin.data.token, body: { status: 'approved' }
    });
    failAudit = false;
    assert.equal(failed.status, 500);

    const posts = await req('/api/admin/posts?status=pending', { token: adminLogin.data.token });
    const rolledBackPost = posts.data.posts.find((post) => post.id === created.data.post.id);
    assert.ok(rolledBackPost);
    assert.equal(rolledBackPost.status, 'pending');
    assert.equal(rolledBackPost.linkedReviewId, null);

    const reviews = await req(`/api/reviews?targetType=dish&dishId=${encodeURIComponent(dishId)}&limit=200`, { token: studentLogin.data.token });
    assert.ok(!reviews.data.reviews.some((review) => review.content === '事务失败时不得产生半完成评价'));
  });
});
