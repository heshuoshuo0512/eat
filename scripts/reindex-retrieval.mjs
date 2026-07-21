import { createDatabase } from '../server/database.js';
import {
  getRetrievalIndexStatus,
  listRetrievalTenantIds,
  reindexRetrieval,
} from '../server/retrievalIndex.js';

function parseArguments(argv) {
  const options = { prune: true };
  for (const argument of argv) {
    if (argument === '--lexical-only') options.embeddingProvider = null;
    else if (argument === '--no-prune') options.prune = false;
    else if (argument.startsWith('--tenant=')) options.tenantId = argument.slice('--tenant='.length).trim();
    else if (argument.startsWith('--source=')) options.sourceTypes = argument.slice('--source='.length).split(',').map((value) => value.trim()).filter(Boolean);
    else if (argument.startsWith('--health-root=')) options.healthRoot = argument.slice('--health-root='.length).trim();
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/reindex-retrieval.mjs [options]

Options:
  --tenant=<id>             Rebuild one tenant; default rebuilds all active tenants
  --source=dish,health_knowledge
                            Limit source types
  --health-root=<path>      Override the approved health knowledge directory
  --lexical-only            Skip remote embeddings and build searchable text only
  --no-prune                Keep documents missing from the current source snapshot
  --help                    Show this message`);
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const db = await createDatabase();
try {
  const tenantIds = options.tenantId ? [options.tenantId] : await listRetrievalTenantIds(db);
  const results = [];
  for (const tenantId of tenantIds) {
    const rebuilt = await reindexRetrieval(db, { ...options, tenantId });
    const status = await getRetrievalIndexStatus(db, { tenantId });
    results.push({ rebuilt, status });
  }
  console.log(JSON.stringify({ ok: true, tenantCount: tenantIds.length, results }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, code: error.code || null, details: error.details || null }, null, 2));
  process.exitCode = 1;
} finally {
  await db.close();
}
