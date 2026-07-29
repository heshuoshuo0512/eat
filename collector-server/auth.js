import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from '../server/security.js';

const CONTRIBUTOR_COOKIE = 'collector_session';
const STAFF_COOKIE = 'collector_staff_session';

function isoNow() {
  return new Date().toISOString();
}

function tokenHash(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

export function parseCookies(req) {
  const result = {};
  for (const entry of String(req.headers.cookie || '').split(';')) {
    const index = entry.indexOf('=');
    if (index < 1) continue;
    result[entry.slice(0, index).trim()] = decodeURIComponent(entry.slice(index + 1).trim());
  }
  return result;
}

function cookie(name, value, { maxAge = 365 * 24 * 60 * 60, clear = false } = {}) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${clear ? 0 : maxAge}`;
}

export async function contributorFromRequest(db, req, { create = true } = {}) {
  const existingToken = parseCookies(req)[CONTRIBUTOR_COOKIE] || '';
  if (existingToken) {
    const contributor = await db.get('SELECT * FROM collector_contributors WHERE token_hash = ?', [tokenHash(existingToken)]);
    if (contributor) {
      await db.run('UPDATE collector_contributors SET last_seen_at = ? WHERE id = ?', [isoNow(), contributor.id]);
      return { contributor, setCookie: null };
    }
  }
  if (!create) return { contributor: null, setCookie: null };
  const token = randomBytes(32).toString('base64url');
  const contributor = { id: `contributor-${randomUUID()}`, created_at: isoNow(), last_seen_at: isoNow() };
  await db.run(`INSERT INTO collector_contributors(id, token_hash, created_at, last_seen_at)
    VALUES (?, ?, ?, ?)`, [contributor.id, tokenHash(token), contributor.created_at, contributor.last_seen_at]);
  return { contributor, setCookie: cookie(CONTRIBUTOR_COOKIE, token) };
}

export async function staffFromRequest(db, req) {
  const token = parseCookies(req)[STAFF_COOKIE] || '';
  if (!token) return null;
  const row = await db.get(`SELECT staff.id, staff.username, staff.role, session.expires_at
    FROM collector_staff_sessions session JOIN collector_staff staff ON staff.id = session.staff_id
    WHERE session.token_hash = ?`, [tokenHash(token)]);
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) return null;
  return { id: row.id, username: row.username, role: row.role };
}

export async function requireStaff(db, req, { admin = false } = {}) {
  const staff = await staffFromRequest(db, req);
  if (!staff) throw Object.assign(new Error('请先登录审核后台'), { status: 401, code: 'COLLECTOR_STAFF_LOGIN_REQUIRED' });
  if (admin && staff.role !== 'collector_admin') throw Object.assign(new Error('需要采集管理员权限'), { status: 403, code: 'COLLECTOR_ADMIN_REQUIRED' });
  return staff;
}

export async function loginStaff(db, username, password) {
  const staff = await db.get('SELECT * FROM collector_staff WHERE username = ?', [String(username || '').trim()]);
  if (!staff || !verifyPassword(password, staff.password_hash)) {
    throw Object.assign(new Error('用户名或密码错误'), { status: 401, code: 'INVALID_COLLECTOR_STAFF_CREDENTIALS' });
  }
  const token = randomBytes(32).toString('base64url');
  const createdAt = isoNow();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  await db.run('INSERT INTO collector_staff_sessions(token_hash, staff_id, expires_at, created_at) VALUES (?, ?, ?, ?)', [tokenHash(token), staff.id, expiresAt, createdAt]);
  return { staff: { id: staff.id, username: staff.username, role: staff.role }, setCookie: cookie(STAFF_COOKIE, token, { maxAge: 12 * 60 * 60 }) };
}

export async function logoutStaff(db, req) {
  const token = parseCookies(req)[STAFF_COOKIE] || '';
  if (token) await db.run('DELETE FROM collector_staff_sessions WHERE token_hash = ?', [tokenHash(token)]);
  return cookie(STAFF_COOKIE, '', { clear: true });
}

export async function bootstrapCollectorStaff(db, { username, password, role = 'collector_admin' }) {
  if (!String(username || '').trim() || String(password || '').length < 8) throw new Error('审核账号需要用户名和至少 8 位密码');
  const timestamp = isoNow();
  const id = `collector-staff-${randomUUID()}`;
  await db.run(`INSERT INTO collector_staff(id, username, password_hash, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, role=excluded.role, updated_at=excluded.updated_at`, [
    id, String(username).trim(), hashPassword(password), role, timestamp, timestamp,
  ]);
  return { username: String(username).trim(), role };
}
