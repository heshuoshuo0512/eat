import { openCollectorDatabase } from './database.js';
import { syncCollectorCatalog, cleanupCollectorData } from './service.js';
import { createCollectorServer } from './app.js';

const db = await openCollectorDatabase();
const catalogCount = Number((await db.get('SELECT COUNT(*) AS count FROM collector_catalog_dishes'))?.count || 0);
if (!catalogCount) {
  const result = await syncCollectorCatalog(db);
  console.log(`Collector catalog initialized: ${result.dishes} dishes (${result.version})`);
}

const port = Number(process.env.COLLECTOR_PORT || 8790);
const host = process.env.COLLECTOR_HOST || '0.0.0.0';
const server = createCollectorServer({ db });
server.listen(port, host, () => console.log(`Collector API listening on http://${host}:${port} (db=${db.kind})`));

const embeddedWorker = !['0', 'false', 'off'].includes(String(process.env.COLLECTOR_EMBEDDED_WORKER || '1').toLowerCase());
const cleanupTimer = embeddedWorker
  ? setInterval(() => cleanupCollectorData(db).catch((error) => console.error('Collector cleanup failed', error)), 60 * 60 * 1000)
  : null;
cleanupTimer?.unref();

async function shutdown() {
  if (cleanupTimer) clearInterval(cleanupTimer);
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}

process.once('SIGINT', () => shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => shutdown().finally(() => process.exit(0)));
