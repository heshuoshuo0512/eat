import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.replace(/^--/, '').split('=');
  return [key, rest.join('=') || '1'];
}));

const scenario = options.scenario || 'catalog';
const allowedScenarios = new Set(['catalog', 'session', 'community', 'agent']);
if (!allowedScenarios.has(scenario)) {
  throw new Error(`Unsupported scenario: ${scenario}`);
}

const vus = String(Math.max(1, Number(options.vus || 100)));
const duration = options.duration || '5m';
const baseUrl = options['base-url'] || 'http://host.docker.internal:18080/api';
const outputDirectory = resolve(options.output || '.performance-results');
const scriptDirectory = resolve('tests/performance');
mkdirSync(outputDirectory, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const summaryName = `${scenario}-${vus}vu-${timestamp}.json`;
const dockerArguments = [
  'run', '--rm',
  '--add-host', 'host.docker.internal:host-gateway',
  '-e', `SCENARIO=${scenario}`,
  '-e', `VUS=${vus}`,
  '-e', `DURATION=${duration}`,
  '-e', `BASE_URL=${baseUrl}`,
  '-v', `${scriptDirectory}:/scripts:ro`,
  '-v', `${outputDirectory}:/results`,
  'grafana/k6:0.54.0',
  'run', '--summary-export', `/results/${summaryName}`,
  '/scripts/smart-canteen.js'
];

for (const name of ['ACCESS_TOKEN', 'IDENTIFIER', 'PASSWORD', 'TARGET_TYPE', 'TARGET_ID', 'AGENT_QUERY', 'THINK_TIME_SECONDS']) {
  if (process.env[name]) dockerArguments.splice(4, 0, '-e', `${name}=${process.env[name]}`);
}

console.log(`Running k6 scenario=${scenario} vus=${vus} duration=${duration}`);
const result = spawnSync('docker', dockerArguments, { stdio: 'inherit', shell: false });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log(`k6 summary: ${resolve(outputDirectory, summaryName)}`);
