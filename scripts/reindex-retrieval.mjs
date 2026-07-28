import {
  getRetrievalIndexStatus,
  listRetrievalTenantIds,
  pruneInvalidKnowledgeScopes,
  reindexRetrieval,
} from '../server/retrievalIndex.js';
import { CAMPUS_POLICY_SOURCE_TYPE, GLOBAL_KNOWLEDGE_TENANT_ID } from '../server/knowledgeGovernance.js';

function parseArguments(argv) {
  const options = { prune: true };
  for (const argument of argv) {
    if (argument === '--lexical-only') { options.embeddingProvider = null; options.vectorMode = 'off'; }
    else if (argument === '--no-prune') options.prune = false;
    else if (argument === '--with-demo-seed') options.withDemoSeed = true;
    else if (argument.startsWith('--sqlite=')) options.sqlitePath = argument.slice('--sqlite='.length).trim();
    else if (argument.startsWith('--tenant=')) options.tenantId = argument.slice('--tenant='.length).trim();
    else if (argument.startsWith('--source=')) options.sourceTypes = argument.slice('--source='.length).split(',').map((value) => value.trim()).filter(Boolean);
    else if (argument.startsWith('--health-root=')) options.healthRoot = argument.slice('--health-root='.length).trim();
    else if (argument.startsWith('--campus-root=')) options.campusKnowledgeRoot = argument.slice('--campus-root='.length).trim();
    else if (argument.startsWith('--vector-mode=')) options.vectorMode = argument.slice('--vector-mode='.length).trim();
    else if (argument.startsWith('--embedding-dimension=')) options.embeddingDimension = Number(argument.slice('--embedding-dimension='.length));
    else if (argument.startsWith('--batch-size=')) options.embeddingBatchSize = Number(argument.slice('--batch-size='.length));
    else if (argument.startsWith('--embedding-concurrency=')) options.embeddingConcurrency = Number(argument.slice('--embedding-concurrency='.length));
    else if (argument.startsWith('--dish-annotation-batch=')) options.dishAnnotationBatchId = argument.slice('--dish-annotation-batch='.length).trim();
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
  --source=dish,stall,campus_policy,health_knowledge,campus_dining_knowledge
                            Limit source types; health and campus dining knowledge use global scope
  --health-root=<path>      Override the approved health knowledge directory
  --campus-root=<path>      Override the approved campus dining knowledge directory
  --vector-mode=<mode>      off, shadow, or active (production default: off)
  --embedding-dimension=N   Expected vector dimension; Qwen3 0.6B uses 1024
  --batch-size=N            Embedding request batch size (default: 24)
  --embedding-concurrency=N Number of concurrent embedding batches (default: 2)
  --dish-annotation-batch=ID
                            Add validated AI estimates to dish search text only
  --lexical-only            Skip remote embeddings and build searchable text only
  --no-prune                Keep documents missing from the current source snapshot
  --with-demo-seed          Explicitly allow demo dishes in a new isolated SQLite database
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
  process.env.ENABLE_DEMO_SEED = options.withDemoSeed ? '1' : '0';
}
if (options.vectorMode) process.env.RETRIEVAL_VECTOR_MODE = options.vectorMode;

const { createDatabase } = await import('../server/database.js');
const db = await createDatabase();
try {
  const scopeCleanup = await pruneInvalidKnowledgeScopes(db);
  const requestedSourceTypes = options.sourceTypes || null;
  const globalTypes = new Set(['health_knowledge', 'campus_dining_knowledge']);
  const tenantSourceTypes = (requestedSourceTypes || ['dish', 'stall', CAMPUS_POLICY_SOURCE_TYPE])
    .filter((sourceType) => !globalTypes.has(sourceType));
  const globalSourceTypes = (requestedSourceTypes || ['health_knowledge', 'campus_dining_knowledge'])
    .filter((sourceType) => globalTypes.has(sourceType));
  const tenantIds = options.tenantId && options.tenantId !== GLOBAL_KNOWLEDGE_TENANT_ID
    ? [options.tenantId]
    : (options.tenantId === GLOBAL_KNOWLEDGE_TENANT_ID ? [] : await listRetrievalTenantIds(db));
  const results = [];
  for (const tenantId of tenantIds) {
    if (!tenantSourceTypes.length) continue;
    const rebuilt = await reindexRetrieval(db, { ...options, tenantId, sourceTypes: tenantSourceTypes });
    const status = await getRetrievalIndexStatus(db, { tenantId });
    const { documents, ...summary } = rebuilt;
    results.push({ rebuilt: summary, status });
  }
  if (globalSourceTypes.length) {
    const rebuilt = await reindexRetrieval(db, {
      ...options,
      tenantId: GLOBAL_KNOWLEDGE_TENANT_ID,
      sourceTypes: globalSourceTypes,
    });
    const status = await getRetrievalIndexStatus(db, { tenantId: GLOBAL_KNOWLEDGE_TENANT_ID });
    const { documents, ...summary } = rebuilt;
    results.push({ rebuilt: summary, status });
  }
  console.log(JSON.stringify({ ok: true, tenantCount: tenantIds.length, globalIncluded: globalSourceTypes.length > 0, scopeCleanup, results }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, code: error.code || null, details: error.details || null }, null, 2));
  process.exitCode = 1;
} finally {
  await db.close();
}
