import { openCollectorDatabase } from './database.js';
import { cleanupCollectorData } from './service.js';

const db = await openCollectorDatabase();
const intervalMs = Math.max(60_000, Number(process.env.COLLECTOR_CLEANUP_INTERVAL_MS || 60 * 60 * 1000));

async function run() {
  const result = await cleanupCollectorData(db);
  console.log(JSON.stringify({ worker: 'collector-retention', at: new Date().toISOString(), ...result }));
}

await run();
const timer = setInterval(() => run().catch((error) => console.error('Collector cleanup failed', error)), intervalMs);

async function shutdown() {
  clearInterval(timer);
  await db.close();
}

process.once('SIGINT', () => shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => shutdown().finally(() => process.exit(0)));
