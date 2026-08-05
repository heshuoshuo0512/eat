import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

describe('Production operations contract', () => {
  it('pins the existing PostgreSQL volume to major version 16', () => {
    const compose = read('docker-compose.yml');
    assert.match(compose, /postgres:16-alpine/);
    assert.match(compose, /pgvector\/pgvector:pg16/);
    assert.doesNotMatch(compose, /postgres:17|pgvector:pg17/);
  });

  it('backs up PostgreSQL, private uploads and MinIO with retention', () => {
    const script = read('ops/smart-canteen-backup.sh');
    for (const text of ['pg_dump', 'pg_restore -l', '/app/uploads', 'mc mirror', 'SHA256SUMS', 'RETENTION_DAYS']) {
      assert.match(script, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(script, /\/var\/backups\/smart-canteen/);
    assert.match(script, /flock -n 9 \|\| \{[^\n]+exit 1;/);
    assert.match(read('ops/systemd/smart-canteen-backup.timer'), /OnCalendar=.*03:15:00 Asia\/Shanghai/);
    const verifier = read('ops/smart-canteen-verify-backup.sh');
    assert.match(verifier, /sha256sum --check/);
    assert.match(verifier, /pg_restore.*--exit-on-error/);
    assert.match(verifier, /dropdb.*--if-exists/);
  });

  it('keeps releases manual, backed up and rollback-capable', () => {
    const script = read('ops/smart-canteen-release.sh');
    assert.match(script, /Usage: smart-canteen-release <git-commit>/);
    assert.match(script, /git merge-base --is-ancestor.*origin\/main/);
    assert.match(script, /SMART_CANTEEN_BACKUP_COMMAND/);
    assert.match(script, /pgvector\/pgvector:pg16/);
    assert.match(script, /rollback_image/);
    assert.match(script, /docker compose up -d --no-build --no-deps --force-recreate api/);
    assert.match(script, /docker compose up -d --no-build --no-deps --force-recreate nginx/);
    assert.ok(script.indexOf('dist_switched=1') > script.indexOf('mv -- "$APP_DIR/dist" "$previous_dist"'));
    assert.ok(script.indexOf('dist_switched=1') < script.indexOf('mv -- "$next_dist" "$APP_DIR/dist"'));
    assert.match(script, /\/api\/health\/ready/);
    assert.doesNotMatch(read('ops/systemd/smart-canteen-healthcheck.timer'), /OnCalendar=.*release/);
  });

  it('packages both controlled PostgreSQL import commands in the runtime image', () => {
    const dockerfile = read('Dockerfile');
    assert.match(dockerfile, /promote-real-catalog-postgres\.mjs/);
    assert.match(dockerfile, /import-catalog-introductions-postgres\.mjs/);
    const webDockerfile = read('Dockerfile.web');
    assert.match(webDockerfile, /COPY --from=build \/app\/dist \/usr\/share\/nginx\/html/);
    assert.match(read('docker-compose.yml'), /dockerfile: Dockerfile\.web/);
    assert.doesNotMatch(read('docker-compose.yml'), /\.\/dist:\/usr\/share\/nginx\/html/);
    const packageJson = JSON.parse(read('package.json'));
    assert.equal(packageJson.scripts['catalog:introductions:import:pg'], 'node scripts/import-catalog-introductions-postgres.mjs');
  });

  it('validates promoted catalog audit counts against the declared source contract', () => {
    const promoter = read('scripts/promote-real-catalog-postgres.mjs');
    assert.match(promoter, /auditCounts\[key\] !== SOURCE_EXPECTED\[key\]/);
    assert.doesNotMatch(promoter, /auditCounts\[key\] !== EXPECTED\[key\]/);
    assert.match(promoter, /Catalog classification schema is missing/);
    assert.match(promoter, /correctionMarker/);
    assert.match(promoter, /classificationMigration\.slice\(correctionStart \+ 1\)/);
    assert.match(promoter, /026_catalog_classification\.sql/);
    assert.doesNotMatch(promoter, /readFileSync\(resolve\('server\/migrations\/025_catalog_item_types\.sql'/);
  });

  it('preserves only content-identical knowledge documents during catalog promotion', () => {
    const promoter = read('scripts/promote-real-catalog-postgres.mjs');
    assert.match(promoter, /preserveMatchingRows: true/);
    assert.match(promoter, /\['tenant_id', 'source_type', 'source_id', 'content_hash'\]/);
    assert.match(promoter, /Existing \$\{table\} row conflicts with the source/);
  });
});
