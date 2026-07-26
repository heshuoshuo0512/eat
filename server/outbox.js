import { randomUUID } from 'node:crypto';
import { parseJson, serializeJson } from './database.js';

function now() {
  return new Date().toISOString();
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

async function inTransaction(db, operation) {
  if (typeof db.transaction === 'function') return db.transaction(operation);
  await db.exec('BEGIN IMMEDIATE');
  try {
    const result = await operation(db);
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    try { await db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export async function enqueueOutboxEvent(db, {
  tenantId = 'default',
  aggregateType,
  aggregateId = null,
  eventType,
  payload = {},
  idempotencyKey = '',
  availableAt = now()
}) {
  if (!aggregateType || !eventType) throw new Error('Outbox event requires aggregateType and eventType');
  const id = `outbox-${randomUUID()}`;
  const stableKey = idempotencyKey || `${eventType}:${tenantId}:${aggregateId || id}`;
  await db.prepare(`
    INSERT INTO outbox_events (
      id, tenant_id, aggregate_type, aggregate_id, event_type, payload_json,
      idempotency_key, status, attempts, available_at, locked_at, locked_by,
      last_error, created_at, processed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL, ?, NULL)
    ON CONFLICT(idempotency_key) DO NOTHING
  `).run(
    id,
    tenantId,
    aggregateType,
    aggregateId,
    eventType,
    serializeJson(payload),
    stableKey,
    availableAt,
    now()
  );
  return db.prepare('SELECT * FROM outbox_events WHERE idempotency_key = ?').get(stableKey);
}

function mapEvent(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    payload: parseJson(row.payload_json, {}),
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attempts: Number(row.attempts || 0),
    availableAt: row.available_at,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    createdAt: row.created_at
  };
}

export async function claimOutboxEvents(db, {
  workerId,
  limit = 20,
  lockTimeoutMs = 60_000
}) {
  const batchLimit = boundedInteger(limit, 20, 1, 100);
  const current = now();
  const staleBefore = new Date(Date.now() - lockTimeoutMs).toISOString();
  if (db.isPostgres) {
    return inTransaction(db, async (transactionDb) => {
      const rows = await transactionDb.prepare(`
        WITH candidates AS (
          SELECT id
          FROM outbox_events
          WHERE (
            status = 'pending'
            OR (status = 'processing' AND locked_at IS NOT NULL AND locked_at <= ?)
          )
            AND available_at <= ?
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ?
        )
        UPDATE outbox_events event
        SET status = 'processing', locked_at = ?, locked_by = ?, attempts = event.attempts + 1
        FROM candidates
        WHERE event.id = candidates.id
        RETURNING event.*
      `).all(staleBefore, current, batchLimit, current, workerId);
      return rows.map(mapEvent);
    });
  }

  return inTransaction(db, async (transactionDb) => {
    const candidates = await transactionDb.prepare(`
      SELECT * FROM outbox_events
      WHERE (
        status = 'pending'
        OR (status = 'processing' AND locked_at IS NOT NULL AND locked_at <= ?)
      )
        AND available_at <= ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(staleBefore, current, batchLimit);
    const claimed = [];
    for (const candidate of candidates) {
      const result = await transactionDb.prepare(`
        UPDATE outbox_events
        SET status = 'processing', locked_at = ?, locked_by = ?, attempts = attempts + 1
        WHERE id = ?
          AND (
            status = 'pending'
            OR (status = 'processing' AND locked_at IS NOT NULL AND locked_at <= ?)
          )
      `).run(current, workerId, candidate.id, staleBefore);
      if (Number(result.changes || 0) !== 1) continue;
      claimed.push(mapEvent({ ...candidate, status: 'processing', locked_at: current, locked_by: workerId, attempts: Number(candidate.attempts || 0) + 1 }));
    }
    return claimed;
  });
}

export async function completeOutboxEvent(db, eventId) {
  const current = now();
  await db.prepare(`
    UPDATE outbox_events
    SET status = 'succeeded', processed_at = ?, locked_at = NULL, locked_by = NULL, last_error = NULL
    WHERE id = ? AND status = 'processing'
  `).run(current, eventId);
}

export async function failOutboxEvent(db, event, error, {
  maxAttempts = 8,
  baseDelayMs = 1_000,
  maxDelayMs = 15 * 60_000
} = {}) {
  const attempts = Number(event.attempts || 1);
  const dead = attempts >= maxAttempts;
  const delay = Math.min(baseDelayMs * (2 ** Math.max(attempts - 1, 0)), maxDelayMs);
  await db.prepare(`
    UPDATE outbox_events
    SET status = ?, available_at = ?, locked_at = NULL, locked_by = NULL,
        last_error = ?, processed_at = ?
    WHERE id = ? AND status = 'processing'
  `).run(
    dead ? 'dead' : 'pending',
    dead ? now() : new Date(Date.now() + delay).toISOString(),
    String(error?.message || error || 'OUTBOX_HANDLER_FAILED').slice(0, 1000),
    dead ? now() : null,
    event.id
  );
}

export async function outboxBacklog(db) {
  const row = await db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END) AS dead
    FROM outbox_events
  `).get();
  return {
    pending: Number(row?.pending || 0),
    processing: Number(row?.processing || 0),
    dead: Number(row?.dead || 0)
  };
}

export function createOutboxWorker({
  db,
  handlers = {},
  workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`,
  pollIntervalMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS || 1000),
  batchSize = Number(process.env.OUTBOX_BATCH_SIZE || 20),
  lockTimeoutMs = Number(process.env.OUTBOX_LOCK_TIMEOUT_MS || 60_000),
  maxAttempts = Number(process.env.OUTBOX_MAX_ATTEMPTS || 8)
}) {
  let timer = null;
  let running = false;
  let stopping = false;
  let activePoll = null;

  async function inEventContext(event, operation) {
    if (typeof db.runWithContext === 'function') {
      return db.runWithContext({
        tenantId: event.tenantId,
        userId: '',
        role: 'worker',
        requestId: event.id
      }, operation);
    }
    return operation();
  }

  async function poll() {
    if (running || stopping) return;
    running = true;
    try {
      const claim = async () => claimOutboxEvents(db, { workerId, limit: batchSize, lockTimeoutMs });
      const events = typeof db.runWithContext === 'function'
        ? await db.runWithContext({ tenantId: '*', userId: '', role: 'worker', requestId: `poll-${workerId}` }, claim)
        : await claim();
      for (const event of events) {
        try {
          await inEventContext(event, async () => {
            const handler = handlers[event.eventType];
            if (!handler) throw new Error(`No Outbox handler registered for ${event.eventType}`);
            await handler(event);
            await completeOutboxEvent(db, event.id);
          });
        } catch (error) {
          await inEventContext(event, () => failOutboxEvent(db, event, error, { maxAttempts }));
        }
      }
    } finally {
      running = false;
    }
  }

  function schedule() {
    if (timer || stopping) return;
    timer = setInterval(() => {
      activePoll = poll().finally(() => { activePoll = null; });
    }, Math.max(100, pollIntervalMs));
    timer.unref?.();
    activePoll = poll().finally(() => { activePoll = null; });
  }

  return {
    workerId,
    start() {
      stopping = false;
      schedule();
    },
    async stop() {
      stopping = true;
      if (timer) clearInterval(timer);
      timer = null;
      if (activePoll) await activePoll;
    },
    poll,
    get running() { return running; }
  };
}
