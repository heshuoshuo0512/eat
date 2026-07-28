import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { checkKnowledgeSources, loadKnowledgeBundle } from '../server/knowledgeGovernance.js';

const ROOT = resolve(import.meta.dirname, '..');

function parseArguments(argv) {
  const options = {
    root: resolve(ROOT, 'data/health-knowledge-bases'),
    output: '',
    timeoutMs: 20_000,
    strict: false,
  };
  for (const argument of argv) {
    if (argument.startsWith('--root=')) options.root = resolve(argument.slice('--root='.length));
    else if (argument.startsWith('--output=')) options.output = resolve(argument.slice('--output='.length));
    else if (argument.startsWith('--timeout-ms=')) options.timeoutMs = Math.max(1_000, Number(argument.slice('--timeout-ms='.length)) || 20_000);
    else if (argument === '--strict') options.strict = true;
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/check-knowledge-sources.mjs [options]

Options:
  --root=<path>        Knowledge bundle directory
  --output=<path>      JSON report path
  --timeout-ms=N       Per-source request timeout (default: 20000)
  --strict             Exit non-zero when a source changed and requires review
  --help               Show this message`);
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const bundle = loadKnowledgeBundle({ root: options.root });
const monitored = bundle.sources.filter((source) => source.reviewStatus === 'approved');
const report = await checkKnowledgeSources(monitored, { timeoutMs: options.timeoutMs });
const timestamp = report.checkedAt.replace(/[:.]/g, '-');
const outputPath = options.output || resolve(ROOT, '.rag-evals', `knowledge-source-check-${timestamp}.json`);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify({ ...report, bundle: bundle.report }, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  outputPath,
  checked: report.results.length,
  unchanged: report.results.filter((result) => result.status === 'unchanged').length,
  baselineRequired: report.results.filter((result) => result.status === 'baseline_required').length,
  reviewRequired: report.reviewRequired,
  unavailable: report.unavailable,
}, null, 2));

if (options.strict && report.reviewRequired > 0) process.exitCode = 2;
