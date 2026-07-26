import { createDatabase, openPostgresDatabase } from './database.js';
import { createCache, rankingCacheKey } from './cache.js';
import { createHttpServer } from './app.js';
import { loadHealthKnowledgeBase } from './healthKnowledgeBase.js';
import {
  deleteRetrievalSource,
  ensureRetrievalIndex,
  listRetrievalTenantIds,
  syncDishRetrievalDocument
} from './retrievalIndex.js';
import { createOutboxWorker } from './outbox.js';

const db = await createDatabase();
await ensureRetrievalIndex(db);
const cache = createCache();
const outboxEnabled = process.env.OUTBOX_WORKER_ENABLED === '1' || process.env.OUTBOX_WORKER_ENABLED === 'true';
const healthKnowledgeAutoload = process.env.HEALTH_KB_AUTOLOAD === '1' || process.env.HEALTH_KB_AUTOLOAD === 'true';
let workerDb = db;
if ((outboxEnabled || healthKnowledgeAutoload) && process.env.DATABASE_WORKER_URL) {
  workerDb = await openPostgresDatabase(process.env.DATABASE_WORKER_URL, {
    migrate: false,
    applicationName: 'smart-canteen-worker'
  });
} else if ((outboxEnabled || healthKnowledgeAutoload) && db.isPostgres && process.env.NODE_ENV === 'production') {
  throw new Error('Outbox and health knowledge jobs require DATABASE_WORKER_URL in production');
}

if (healthKnowledgeAutoload) {
  const listTenants = () => listRetrievalTenantIds(workerDb);
  const tenantIds = typeof workerDb.runWithContext === 'function'
    ? await workerDb.runWithContext({ tenantId: '*', userId: '', role: 'worker', requestId: 'health-kb-tenants' }, listTenants)
    : await listTenants();
  for (const tenantId of tenantIds) {
    const load = () => loadHealthKnowledgeBase(workerDb, { tenantId });
    const imported = typeof workerDb.runWithContext === 'function'
      ? await workerDb.runWithContext({ tenantId, userId: '', role: 'worker', requestId: `health-kb-${tenantId}` }, load)
      : await load();
    console.log(`Health knowledge base loaded for ${tenantId}: ${imported.count} chunks`);
  }
}

const outboxWorker = createOutboxWorker({
  db: workerDb,
  handlers: {
    async 'cache.ranking.invalidate'(event) {
      await cache.del(rankingCacheKey({
        tenantId: event.tenantId,
        date: event.payload.date || 'current',
        mealType: event.payload.mealType || 'all'
      }));
    },
    async 'retrieval.dish.sync'(event) {
      await syncDishRetrievalDocument(workerDb, {
        tenantId: event.tenantId,
        dishId: event.payload.dishId || event.aggregateId
      });
    },
    async 'retrieval.source.delete'(event) {
      await deleteRetrievalSource(workerDb, {
        tenantId: event.tenantId,
        sourceType: event.payload.sourceType,
        sourceId: event.payload.sourceId || event.aggregateId
      });
    }
  }
});
if (outboxEnabled) outboxWorker.start();

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
const server = createHttpServer({ db, cache });
server.listen(port, host, () => {
  const driver = db.isPostgres ? 'PostgreSQL' : 'SQLite';
  console.log(`Smart Canteen API listening on http://${host}:${port} (db=${driver}, outbox=${outboxEnabled ? 'worker' : 'disabled'})`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, draining Smart Canteen API`);

  const closePromise = new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await outboxWorker.stop();
  const drained = await server.smartCanteen.metrics.waitForIdle(Number(process.env.SHUTDOWN_TIMEOUT_MS || 15_000));
  if (!drained) server.closeAllConnections?.();
  await closePromise;
  server.smartCanteen.metrics.close();
  await cache.close?.();
  if (workerDb !== db) await workerDb.close?.();
  await db.close?.();
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('Graceful shutdown failed', error);
        process.exit(1);
      });
  });
}
