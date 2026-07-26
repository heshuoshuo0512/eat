import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialDatabaseContext } from '../server/app.js';
import { PgDatabase } from '../server/database.js';

function fakePool() {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ target: 'client', sql, params });
      if (/SELECT \* FROM dishes/.test(sql)) return { rows: [{ id: 'dish-1' }], rowCount: 1 };
      if (/SELECT 1 AS ok/.test(sql)) return { rows: [{ ok: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() { calls.push({ target: 'client', sql: 'RELEASE', params: [] }); }
  };
  return {
    calls,
    client,
    async connect() {
      calls.push({ target: 'pool', sql: 'CONNECT', params: [] });
      return client;
    },
    async query(sql, params = []) {
      calls.push({ target: 'pool', sql, params });
      return { rows: [{ ok: 1 }], rowCount: 1 };
    },
    async end() {}
  };
}

describe('PostgreSQL request context adapter', () => {
  it('does not trust a JWT business role before session validation', () => {
    assert.deepEqual(initialDatabaseContext({
      claims: { tenant: 'tenant-a', sub: 'user-a', role: 'super_admin' },
      requestId: 'request-a'
    }), {
      tenantId: 'tenant-a',
      userId: 'user-a',
      role: 'authenticator',
      requestId: 'request-a'
    });
    assert.equal(initialDatabaseContext({ authRoute: false }).role, 'anonymous');
    assert.equal(initialDatabaseContext({ authRoute: true }).role, 'authenticator');
  });

  it('wraps standalone contextual queries in short transactions', async () => {
    const pool = fakePool();
    const db = new PgDatabase(pool);
    const rows = await db.runWithContext({
      tenantId: 'tenant-a',
      userId: 'user-a',
      role: 'student',
      requestId: 'request-a'
    }, () => db.prepare('SELECT * FROM dishes WHERE tenant_id = ?').all('tenant-a'));

    assert.deepEqual(rows, [{ id: 'dish-1' }]);
    assert.deepEqual(pool.calls.map((call) => call.sql), [
      'CONNECT',
      'BEGIN',
      assert.match,
      'SELECT * FROM dishes WHERE tenant_id = $1',
      'COMMIT',
      'RELEASE'
    ].map((item) => item === assert.match ? pool.calls[2].sql : item));
    assert.match(pool.calls[2].sql, /set_config\('app\.tenant_id'/);
    assert.deepEqual(pool.calls[2].params, ['tenant-a', 'user-a', 'student', 'request-a', true]);
  });

  it('sets context once for explicit transactions and releases the client', async () => {
    const pool = fakePool();
    const db = new PgDatabase(pool);
    await db.runWithContext({ tenantId: 'tenant-a', userId: 'user-a', role: 'student' }, () => (
      db.transaction(async (transactionDb) => {
        await transactionDb.prepare('SELECT 1 AS ok').get();
        await transactionDb.prepare('SELECT 1 AS ok').get();
      })
    ));
    assert.equal(pool.calls.filter((call) => /set_config/.test(call.sql)).length, 1);
    assert.equal(pool.calls.filter((call) => call.sql === 'BEGIN').length, 1);
    assert.equal(pool.calls.filter((call) => call.sql === 'COMMIT').length, 1);
    assert.equal(pool.calls.at(-1).sql, 'RELEASE');
  });

  it('keeps migration and readiness queries context-free', async () => {
    const pool = fakePool();
    const db = new PgDatabase(pool);
    const row = await db.prepare('SELECT 1 AS ok').get();
    assert.equal(row.ok, 1);
    assert.deepEqual(pool.calls.map((call) => call.target), ['pool']);
  });

  it('keeps PostgreSQL retrieval queries on the context-aware adapter', () => {
    for (const path of ['server/retrievalIndex.js', 'server/rag.js']) {
      const source = readFileSync(path, 'utf8');
      assert.doesNotMatch(source, /db\.pool\.query/);
    }
  });
});
