import { createDatabase } from '../server/database.js';
import {
  getRetrievalIndexStatus,
  listRetrievalTenantIds,
  reindexRetrieval,
} from '../server/retrievalIndex.js';

function parseArguments(argv) {
  const options = { prune: true };
  for (const argument of argv) {
    if (argument === '--lexical-only') { options.embeddingProvider = null; options.vectorMode = 'off'; }
    else if (argument === '--no-prune') options.prune = false;
    else if (argument.startsWith('--sqlite=')) options.sqlitePath = argument.slice('--sqlite='.length).trim();
    else if (argument.startsWith('--tenant=')) options.tenantId = argument.slice('--tenant='.length).trim();
    else if (argument.startsWith('--source=')) options.sourceTypes = argument.slice('--source='.length).split(',').map((value) => value.trim()).filter(Boolean);
    else if (argument.startsWith('--health-root=')) options.healthRoot = argument.slice('--health-root='.length).trim();
    else if (argument.startsWith('--campus-root=')) options.campusKnowledgeRoot = argument.slice('--campus-root='.length).trim();
    else if (argument.startsWith('--vector-mode=')) options.vectorMode = argument.slice('--vector-mode='.length).trim();
    else if (argument.startsWith('--embedding-dimension=')) options.embeddingDimension = Number(argument.slice('--embedding-dimension='.length));
    else if (argument.startsWith('--batch-size=')) options.embeddingBatchSize = Number(argument.slice('--batch-size='.length));
    else if (argument.startsWith('--embedding-concurrency=')) options.embeddingConcurrency = Number(argument.slice('--embedding-concurrency='.length));
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/reindex-retrieval.mjs [options]

Options:
  --sqlite=<path>           Force an isolated SQLite experiment database
  --tenant=<id>             Rebuild one tenant; default rebuilds all active tenants
  --source=dish,health_knowledge,campus_dining_knowledge
                            Limit source types; campus knowledge is global-only
  --health-root=<path>      Override the approved health knowledge directory
  --campus-root=<path>      Override the approved campus dining knowledge directory
  --vector-mode=<mode>      off, shadow, or active (production default: off)
  --embedding-dimension=N   Expected vector dimension; Qwen3 0.6B uses 1024
  --batch-size=N            Embedding request batch size (default: 24)
  --embedding-concurrency=N Number of concurrent embedding batches (default: 2)
  --lexical-only            Skip remote embeddings and build searchable text only
  --no-prune                Keep documents missing from the current source snapshot
  --help                    Show this message`);
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

if (options.sqlitePath) {
  process.env.DB_DRIVER = 'sqlite';
  process.env.SMART_CANTEEN_DB = options.sqlitePath;
}
if (options.vectorMode) process.env.RETRIEVAL_VECTOR_MODE = options.vectorMode;

const db = await createDatabase();
try {
  const tenantIds = options.tenantId ? [options.tenantId] : await listRetrievalTenantIds(db);
  const results = [];
  for (const tenantId of tenantIds) {
    const rebuilt = await reindexRetrieval(db, { ...options, tenantId });
    const status = await getRetrievalIndexStatus(db, { tenantId });
    const { documents, ...summary } = rebuilt;
    results.push({ rebuilt: summary, status });
  }
  console.log(JSON.stringify({ ok: true, tenantCount: tenantIds.length, results }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, code: error.code || null, details: error.details || null }, null, 2));
  process.exitCode = 1;
} finally {
  await db.close();
}
