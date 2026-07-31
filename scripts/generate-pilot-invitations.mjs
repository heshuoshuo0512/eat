import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { openDatabase, openPostgresDatabase } from '../server/database.js';
import { generateInvitationCode, invitationCodeHash } from '../server/invitationCodes.js';

function option(name, fallback = '') {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

const count = Number(option('count', '200'));
const tenantId = option('tenant', 'default');
const outputPath = resolve(option('output', `artifacts/pilot-invitations-${new Date().toISOString().slice(0, 10)}.json`));
const force = process.argv.includes('--force');
if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error('--count must be an integer between 1 and 500');
if (existsSync(outputPath) && !force) throw new Error(`Output already exists: ${outputPath}. Use --force only to replace it.`);

const databaseUrl = process.env.DATABASE_MIGRATION_URL || '';
if ((String(process.env.DB_DRIVER || '').toLowerCase() === 'postgres' || process.env.DATABASE_URL) && !databaseUrl) {
  throw new Error('PostgreSQL generation requires DATABASE_MIGRATION_URL; refusing to write through the API role.');
}

const expiresAtInput = option('expires-at', '');
const expiresAt = expiresAtInput
  ? new Date(expiresAtInput)
  : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) throw new Error('--expires-at must be a future ISO date');

const db = databaseUrl
  ? await openPostgresDatabase(databaseUrl, { migrate: false, applicationName: 'pilot-invitation-generator' })
  : openDatabase();

async function transaction(operation) {
  if (typeof db.transaction === 'function') return db.transaction(operation);
  await db.exec('BEGIN');
  try {
    const result = await operation(db);
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => {});
    throw error;
  }
}

try {
  const tenant = await db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) throw new Error(`Tenant does not exist: ${tenantId}`);
  const expiry = expiresAt.toISOString();
  const invitations = await transaction(async (tx) => {
    const rows = [];
    const generatedHashes = new Set();
    for (let index = 0; index < count; index += 1) {
      let code = '';
      let hash = '';
      do {
        code = generateInvitationCode();
        hash = invitationCodeHash(code);
      } while (generatedHashes.has(hash));
      generatedHashes.add(hash);
      const id = `invite-${createHash('sha256').update(`${tenantId}:${hash}:${index}`).digest('hex').slice(0, 24)}`;
      const timestamp = new Date().toISOString();
      await tx.prepare(`INSERT INTO pilot_invitations
        (id, tenant_id, code_hash, code_hint, status, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`)
        .run(id, tenantId, hash, code.slice(-4), expiry, timestamp, timestamp);
      rows.push({ id, code, codeHint: code.slice(-4), status: 'active', expiresAt: expiry });
    }
    return rows;
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), tenantId, expiresAt: expiry, invitations }, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ generated: invitations.length, tenantId, expiresAt: expiry, outputPath }, null, 2));
} finally {
  await db.close?.();
}
