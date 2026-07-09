import { createDatabase } from './database.js';
import { createCache } from './cache.js';
import { createHttpServer } from './app.js';

const db = await createDatabase();
const cache = createCache();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
const server = createHttpServer({ db, cache });

server.listen(port, host, () => {
  const driver = process.env.DB_DRIVER === 'postgres' || process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite';
  console.log(`Smart Canteen API listening on http://${host}:${port} (db=${driver})`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
