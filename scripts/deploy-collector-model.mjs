import { createDatabase } from '../server/database.js';
import { pgVectorLiteral } from '../server/visionEmbedding.js';
import { openCollectorDatabase } from '../collector-server/database.js';

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const modelVersion = argument('model-version');
const tenantId = argument('tenant', 'default');
if (!modelVersion) {
  console.error('Usage: npm run collector:deploy -- --model-version <version> [--tenant default]');
  process.exit(1);
}

const collectorDb = await openCollectorDatabase();
const appDb = await createDatabase();
try {
  const model = await collectorDb.get('SELECT * FROM collector_model_versions WHERE model_version = ?', [modelVersion]);
  if (!model || !['ready', 'deployed', 'retired'].includes(model.status)) throw new Error('模型不存在或尚未通过部署门槛');
  const prototypes = await collectorDb.all('SELECT * FROM collector_dish_prototypes WHERE model_version = ?', [modelVersion]);
  if (!prototypes.length) throw new Error('模型没有可发布的训练集原型');
  const missing = [];
  for (const prototype of prototypes) {
    const dish = appDb.isPostgres
      ? (await appDb.query('SELECT id FROM dishes WHERE tenant_id = $1 AND id = $2', [tenantId, prototype.dish_id])).rows[0]
      : appDb.prepare('SELECT id FROM dishes WHERE tenant_id = ? AND id = ?').get(tenantId, prototype.dish_id);
    if (!dish) missing.push(prototype.dish_id);
  }
  if (missing.length) throw new Error(`主目录缺少 ${missing.length} 个 dish_id：${missing.slice(0, 8).join(', ')}`);
  const timestamp = new Date().toISOString();
  if (appDb.isPostgres) {
    await appDb.transaction(async (tx) => {
      await tx.query("UPDATE dish_class_prototypes SET status = 'retired', updated_at = $1 WHERE tenant_id = $2 AND status = 'deployed'", [timestamp, tenantId]);
      for (const prototype of prototypes) {
        const embedding = JSON.parse(prototype.embedding_json);
        await tx.query(`INSERT INTO dish_class_prototypes
          (tenant_id, dish_id, model_version, canonical_name, venue_name, stall_name, dimension,
           embedding, embedding_json, image_count, status, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,768,$7::vector,$8,$9,'deployed',$10,$10)
          ON CONFLICT(tenant_id, dish_id, model_version) DO UPDATE SET
            embedding=EXCLUDED.embedding, embedding_json=EXCLUDED.embedding_json,
            image_count=EXCLUDED.image_count, status='deployed', updated_at=EXCLUDED.updated_at`, [
          tenantId, prototype.dish_id, modelVersion, prototype.canonical_name, prototype.venue_name,
          prototype.stall_name, pgVectorLiteral(embedding), prototype.embedding_json, prototype.image_count, timestamp,
        ]);
      }
    });
  } else {
    appDb.exec('BEGIN IMMEDIATE');
    try {
      appDb.prepare("UPDATE dish_class_prototypes SET status = 'retired', updated_at = ? WHERE tenant_id = ? AND status = 'deployed'").run(timestamp, tenantId);
      for (const prototype of prototypes) {
        appDb.prepare(`INSERT INTO dish_class_prototypes
          (tenant_id, dish_id, model_version, canonical_name, venue_name, stall_name, dimension,
           embedding_json, image_count, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 768, ?, ?, 'deployed', ?, ?)
          ON CONFLICT(tenant_id, dish_id, model_version) DO UPDATE SET
            embedding_json=excluded.embedding_json, image_count=excluded.image_count,
            status='deployed', updated_at=excluded.updated_at`).run(
          tenantId, prototype.dish_id, modelVersion, prototype.canonical_name, prototype.venue_name,
          prototype.stall_name, prototype.embedding_json, prototype.image_count, timestamp, timestamp,
        );
      }
      appDb.exec('COMMIT');
    } catch (error) {
      appDb.exec('ROLLBACK');
      throw error;
    }
  }
  await collectorDb.transaction(async (tx) => {
    await tx.run("UPDATE collector_model_versions SET status = 'retired' WHERE status = 'deployed' AND model_version <> ?", [modelVersion]);
    await tx.run("UPDATE collector_model_versions SET status = 'deployed', deployed_at = ? WHERE model_version = ?", [timestamp, modelVersion]);
  });
  console.log(JSON.stringify({ deployed: true, modelVersion, tenantId, prototypes: prototypes.length }, null, 2));
} finally {
  await collectorDb.close();
  await appDb.close?.();
}
