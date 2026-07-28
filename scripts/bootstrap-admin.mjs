#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { hashPassword } from '../server/security.js';

const { Pool } = pg;
function option(name, fallback = '') {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

const databaseUrl = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_MIGRATION_URL is required');
const tenantId = option('tenant', process.env.ADMIN_BOOTSTRAP_TENANT || 'default');
const username = option('username', process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin');
const nickname = option('nickname', process.env.ADMIN_BOOTSTRAP_NICKNAME || '系统管理员');
let password = process.env.ADMIN_BOOTSTRAP_PASSWORD || '';
if (!password) {
  if (!input.isTTY) throw new Error('Set ADMIN_BOOTSTRAP_PASSWORD when stdin is not interactive');
  const prompt = createInterface({ input, output });
  try { password = await prompt.question('Administrator password: '); } finally { prompt.close(); }
}
if (password.length < 12) throw new Error('Administrator password must contain at least 12 characters');

const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: 'admin-bootstrap' });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const existingAdmin = await client.query("SELECT id FROM users WHERE tenant_id = $1 AND role IN ('admin','super_admin','tenant_admin') LIMIT 1", [tenantId]);
  if (existingAdmin.rowCount) throw new Error(`Tenant ${tenantId} already has an administrator; bootstrap refused`);
  const existingUsername = await client.query('SELECT id FROM users WHERE tenant_id = $1 AND username = $2', [tenantId, username]);
  if (existingUsername.rowCount) throw new Error('Username already exists');
  const timestamp = new Date().toISOString();
  const id = `u-admin-${randomUUID()}`;
  await client.query(`INSERT INTO users
    (id, tenant_id, username, password_hash, nickname, role, token_version, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, 'super_admin', 0, $6, $6)`,
  [id, tenantId, username, hashPassword(password), nickname, timestamp]);
  await client.query('COMMIT');
  console.log(JSON.stringify({ created: true, id, tenantId, username, role: 'super_admin' }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
  password = '';
}
