import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openCollectorDatabase } from '../collector-server/database.js';

function value(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function has(name) { return process.argv.includes(`--${name}`); }

function run(command, args) {
  const result = spawnSync(command, args, { cwd: resolve('.'), stdio: 'inherit', env: process.env, shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

const datasetVersion = value('version', `collector-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
let datasetDir = value('dataset');
if (!datasetDir) {
  run(process.execPath, ['scripts/export-collector-dataset.mjs', '--version', datasetVersion]);
  datasetDir = resolve('collector-datasets', datasetVersion);
} else {
  datasetDir = resolve(datasetDir);
}
const modelVersion = value('model-version', `${datasetVersion}-siglip`);
const modelDir = resolve(value('output', resolve('collector-models', modelVersion)));
const python = process.env.COLLECTOR_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const trainArgs = ['training/train_siglip.py', '--dataset', datasetDir, '--output', modelDir];
if (has('smoke')) trainArgs.push('--smoke');
if (has('skip-baseline')) trainArgs.push('--skip-baseline');
for (const option of ['epochs', 'batch-size', 'effective-batch-size', 'workers']) {
  const optionValue = value(option);
  if (optionValue) trainArgs.push(`--${option}`, optionValue);
}
run(python, trainArgs);

const deployment = JSON.parse(await readFile(resolve(modelDir, 'deployment.json'), 'utf8'));
if (deployment.dimension !== 768) throw new Error(`模型输出维度必须为 768，实际为 ${deployment.dimension}`);
const db = await openCollectorDatabase();
try {
  const timestamp = new Date().toISOString();
  const status = deployment.deployable ? 'ready' : 'rejected';
  await db.run(`INSERT INTO collector_model_versions
    (id, model_version, dataset_version, base_model, checkpoint_path, status, metrics_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(model_version) DO UPDATE SET dataset_version=excluded.dataset_version,
      base_model=excluded.base_model, checkpoint_path=excluded.checkpoint_path,
      status=excluded.status, metrics_json=excluded.metrics_json`, [
    `collector-model-${randomUUID()}`, modelVersion, datasetVersion, deployment.baseModel,
    deployment.checkpoint, status, JSON.stringify(deployment.metrics), timestamp,
  ]);
  await db.run(`UPDATE collector_dataset_versions SET status = ?, metrics_json = ?, finalized_at = ? WHERE name = ?`, [
    status === 'ready' ? 'ready' : 'rejected', JSON.stringify(deployment.metrics), timestamp, datasetVersion,
  ]);
  if (deployment.deployable) {
    const prototypes = JSON.parse(await readFile(resolve(modelDir, 'prototypes.json'), 'utf8'));
    await db.transaction(async (tx) => {
      await tx.run('DELETE FROM collector_dish_prototypes WHERE model_version = ?', [modelVersion]);
      for (const prototype of prototypes) {
        await tx.run(`INSERT INTO collector_dish_prototypes
          (model_version, dish_id, canonical_name, venue_name, stall_name, dimension, embedding_json, image_count, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          modelVersion, prototype.dish_id, prototype.canonical_name, prototype.venue,
          prototype.stall, prototype.dimension, JSON.stringify(prototype.embedding), prototype.image_count, timestamp,
        ]);
        if (tx.kind === 'postgres') {
          await tx.run('UPDATE collector_dish_prototypes SET embedding = CAST(? AS vector) WHERE model_version = ? AND dish_id = ?', [
            `[${prototype.embedding.join(',')}]`, modelVersion, prototype.dish_id,
          ]);
        }
      }
    });
  }
  console.log(JSON.stringify({ modelVersion, datasetVersion, status, deployable: deployment.deployable, checks: deployment.checks }, null, 2));
  if (!deployment.deployable) process.exitCode = 2;
} finally {
  await db.close();
}
