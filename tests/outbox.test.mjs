import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/database.js';
import {
  claimOutboxEvents,
  completeOutboxEvent,
  createOutboxWorker,
  enqueueOutboxEvent,
  failOutboxEvent,
  outboxBacklog
} from '../server/outbox.js';

describe('transactional Outbox', () => {
  it('deduplicates events and claims each pending row once', async () => {
    const db = openDatabase(':memory:');
    const first = await enqueueOutboxEvent(db, {
      tenantId: 'default',
      aggregateType: 'dish',
      aggregateId: 'dish-1',
      eventType: 'retrieval.dish.sync',
      payload: { dishId: 'dish-1' },
      idempotencyKey: 'dish-1:v1'
    });
    const duplicate = await enqueueOutboxEvent(db, {
      tenantId: 'default',
      aggregateType: 'dish',
      aggregateId: 'dish-1',
      eventType: 'retrieval.dish.sync',
      payload: { dishId: 'dish-1' },
      idempotencyKey: 'dish-1:v1'
    });
    assert.equal(first.id, duplicate.id);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM outbox_events').get()).count, 1);

    const claimed = await claimOutboxEvents(db, { workerId: 'worker-a', limit: 10 });
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].attempts, 1);
    assert.equal((await claimOutboxEvents(db, { workerId: 'worker-b', limit: 10 })).length, 0);
    await completeOutboxEvent(db, claimed[0].id);
    assert.deepEqual(await outboxBacklog(db), { pending: 0, processing: 0, dead: 0 });
  });

  it('retries with backoff and moves exhausted events to dead state', async () => {
    const db = openDatabase(':memory:');
    await enqueueOutboxEvent(db, {
      aggregateType: 'cache',
      eventType: 'cache.ranking.invalidate',
      idempotencyKey: 'retry-event'
    });
    let [event] = await claimOutboxEvents(db, { workerId: 'worker-a' });
    await failOutboxEvent(db, event, new Error('temporary'), { maxAttempts: 2, baseDelayMs: 1 });
    let row = await db.prepare('SELECT * FROM outbox_events WHERE id = ?').get(event.id);
    assert.equal(row.status, 'pending');
    assert.match(row.last_error, /temporary/);

    await db.prepare('UPDATE outbox_events SET available_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', event.id);
    [event] = await claimOutboxEvents(db, { workerId: 'worker-a' });
    await failOutboxEvent(db, event, new Error('permanent'), { maxAttempts: 2 });
    row = await db.prepare('SELECT * FROM outbox_events WHERE id = ?').get(event.id);
    assert.equal(row.status, 'dead');
    assert.ok(row.processed_at);
    assert.deepEqual(await outboxBacklog(db), { pending: 0, processing: 0, dead: 1 });
  });

  it('runs registered handlers and records success', async () => {
    const db = openDatabase(':memory:');
    const handled = [];
    await enqueueOutboxEvent(db, {
      tenantId: 'tenant-a',
      aggregateType: 'ranking',
      aggregateId: 'today',
      eventType: 'cache.ranking.invalidate',
      payload: { date: '2026-07-26' }
    });
    const worker = createOutboxWorker({
      db,
      handlers: {
        'cache.ranking.invalidate': async (event) => handled.push(event)
      }
    });
    await worker.poll();
    assert.equal(handled.length, 1);
    assert.equal(handled[0].tenantId, 'tenant-a');
    assert.equal((await db.prepare("SELECT status FROM outbox_events").get()).status, 'succeeded');
    await worker.stop();
  });
});
