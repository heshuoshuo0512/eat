import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { buildHealthPlan, calculateRanking, normalizeProfile } from '../src/domain/recommendation.js';
import { openDatabase, rowToAiUsageLog, rowToAuditLog, rowToCanteen, rowToDish, rowToEnvironment, rowToMenu, rowToMenuItem, rowToPost, rowToPreference, rowToProfile, rowToReview, rowToStall, rowToTenant, rowToUser, serializeJson } from './database.js';
import { assignableRoles, hasPermission, requirePermission } from './rbac.js';
import { createToken, decryptSecret, encryptSecret, hashPassword, publicUser, verifyPassword, verifyToken } from './security.js';
import { storeUpload } from './storage.js';
import { generateAgentToolCalls, generateDishSearchFilterSupplement, getAiProviderStatus, identifyDishFromImage, testAiProviderConnection, withAiRuntimeConfig } from './aiProvider.js';
import { createCache, rankingCacheKey } from './cache.js';
import { buildStudentMealAnalysis } from './mealVision.js';
import { buildKnowledgeAnswer, runDishSearchWorkflow, runMealRecommendationWorkflow } from './retrievalService.js';
import {
  RETRIEVAL_INDEX_VERSION,
  deleteRetrievalSource,
  getRetrievalIndexStatus,
  reindexRetrieval,
  searchRetrievalIndex,
  syncDishRetrievalDocument
} from './retrievalIndex.js';

const MAX_BODY_BYTES = 128 * 1024;
const MAX_IMPORT_BODY_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_ROWS = 1_000;
const MAX_IMAGE_BODY_BYTES = 8 * 1024 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 180;
const rateBuckets = new Map();
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_LOCK_MS = 15 * 60_000;
const loginFailures = new Map();

function loginKey(username, req) {
  return `${getClientIp(req)}:${String(username || '').trim().toLowerCase()}`;
}

function assertLoginAllowed(username, req) {
  const record = loginFailures.get(loginKey(username, req));
  if (record?.lockedUntil && record.lockedUntil > Date.now()) {
    throw Object.assign(new Error('登录失败次数过多，请稍后再试'), { status: 429 });
  }
}

function recordLoginFailure(username, req) {
  const key = loginKey(username, req);
  const current = Date.now();
  const record = loginFailures.get(key) || { count: 0, firstAt: current, lockedUntil: 0 };
  if (current - record.firstAt > LOGIN_LOCK_MS) {
    record.count = 0;
    record.firstAt = current;
    record.lockedUntil = 0;
  }
  record.count += 1;
  if (record.count >= LOGIN_FAILURE_LIMIT) record.lockedUntil = current + LOGIN_LOCK_MS;
  loginFailures.set(key, record);
}

function clearLoginFailures(username, req) {
  loginFailures.delete(loginKey(username, req));
}

function tenantIdFor(user) {
  return user?.tenant_id || user?.tenantId || 'default';
}

const ADMIN_CATALOG_REGIONS = [
  { id: 'campus-main', name: '综合餐饮楼', position: 'top-left', venueType: 'dining_complex', areaType: 'restaurant', areaLabel: '餐厅' },
  { id: 'north-zone', name: '北苑食堂', position: 'top-right', venueType: 'multi_floor_canteen', areaType: 'floor_area', areaLabel: '楼层餐区' },
  { id: 'south-zone', name: '南湖食堂', position: 'bottom-left', venueType: 'multi_floor_canteen', areaType: 'floor_area', areaLabel: '楼层餐区' },
  { id: 'east-zone', name: '东苑食堂', position: 'bottom-right', venueType: 'multi_floor_canteen', areaType: 'floor_area', areaLabel: '楼层餐区' }
];

function isAdminCatalogVenueId(value) {
  return ADMIN_CATALOG_REGIONS.some((definition) => definition.id === value);
}

function catalogTextMatches(value, query) {
  return !query || String(value || '').toLocaleLowerCase().includes(query);
}

async function loadAdminCatalogTree(db, { tenantId, regionId = '', canteenId = '', stallId = '', query = '', includeDishes = false, limit = 20, offset = 0 }) {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
  const canteenRows = await db.prepare('SELECT * FROM canteens WHERE tenant_id = ? ORDER BY name ASC, id ASC').all(tenantId);
  const stallRows = await db.prepare('SELECT * FROM stalls WHERE tenant_id = ? ORDER BY name ASC, id ASC').all(tenantId);
  const dishRows = await db.prepare('SELECT * FROM dishes WHERE tenant_id = ? ORDER BY name ASC, id ASC').all(tenantId);
  const canteens = canteenRows.map(rowToCanteen);
  const stalls = stallRows.map(rowToStall);
  const dishes = dishRows.map(rowToDish);
  const canteenById = new Map(canteens.map((item) => [item.id, item]));
  const stallsByCanteen = new Map();
  const stallsByParent = new Map();
  const dishesByStall = new Map();
  for (const stall of stalls) {
    if (!stallsByCanteen.has(stall.canteenId)) stallsByCanteen.set(stall.canteenId, []);
    stallsByCanteen.get(stall.canteenId).push(stall);
    if (stall.parentId) {
      if (!stallsByParent.has(stall.parentId)) stallsByParent.set(stall.parentId, []);
      stallsByParent.get(stall.parentId).push(stall);
    }
  }
  for (const dish of dishes) {
    if (!dishesByStall.has(dish.stallId)) dishesByStall.set(dish.stallId, []);
    dishesByStall.get(dish.stallId).push(dish);
  }

  function buildStall(stall) {
    const children = (stallsByParent.get(stall.id) || []).map(buildStall);
    const allDirectDishes = dishesByStall.get(stall.id) || [];
    const dishCount = allDirectDishes.length + children.reduce((sum, child) => sum + child.dishCount, 0);
    const node = {
      stall,
      legacyHierarchy: Boolean(stall.parentId),
      childCount: children.length,
      dishCount,
      directDishes: includeDishes ? allDirectDishes : [],
      children
    };
    Object.defineProperty(node, 'allDirectDishes', { value: allDirectDishes, enumerable: false });
    return node;
  }

  function buildCanteen(canteen, areaType = 'floor_area', areaLabel = '楼层餐区') {
    const primaryStalls = (stallsByCanteen.get(canteen.id) || []).filter((stall) => !stall.parentId).map(buildStall);
    return {
      canteen,
      displayName: canteen.name,
      areaType,
      areaLabel,
      primaryStallCount: primaryStalls.length,
      stallCount: (stallsByCanteen.get(canteen.id) || []).length,
      openStallCount: (stallsByCanteen.get(canteen.id) || []).filter((stall) => stall.open).length,
      dishCount: primaryStalls.reduce((sum, stall) => sum + stall.dishCount, 0),
      stalls: primaryStalls
    };
  }

  function matchesStall(node) {
    return !normalizedQuery
      || catalogTextMatches(node.stall.name, normalizedQuery)
      || catalogTextMatches(node.stall.category, normalizedQuery)
      || node.allDirectDishes.some((dish) => catalogTextMatches(dish.name, normalizedQuery))
      || node.children.some((child) => matchesStall(child));
  }

  function matchesCanteen(node) {
    return !normalizedQuery
      || catalogTextMatches(node.canteen.name, normalizedQuery)
      || catalogTextMatches(node.canteen.location, normalizedQuery)
      || node.stalls.some((stall) => matchesStall(stall));
  }

  const regions = ADMIN_CATALOG_REGIONS
    .filter((definition) => !regionId || definition.id === regionId)
    .map((definition) => {
      const region = canteenById.get(definition.id) || null;
      const children = canteens.filter((canteen) => canteen.parentId === definition.id);
      const canteenNodes = children.map((canteen) => buildCanteen(canteen, definition.areaType, definition.areaLabel)).filter((node) => {
        if (canteenId && node.canteen.id !== canteenId) return false;
        if (stallId && !node.stalls.some((stall) => stall.stall.id === stallId || stall.children.some((child) => child.stall.id === stallId))) return false;
        return matchesCanteen(node);
      });
      const unassignedStalls = region
        ? (stallsByCanteen.get(region.id) || []).filter((stall) => !stall.parentId).map(buildStall).filter((node) => matchesStall(node))
        : [];
      const unassignedMatchesFilter = !canteenId || canteenId === definition.id;
      const visibleUnassignedStalls = unassignedMatchesFilter
        ? unassignedStalls.filter((node) => !stallId || node.stall.id === stallId || node.children.some((child) => child.stall.id === stallId))
        : [];
      const counts = canteenNodes.reduce((total, node) => ({
        canteens: total.canteens + 1,
        stalls: total.stalls + node.stallCount,
        dishes: total.dishes + node.dishCount,
        openStalls: total.openStalls + node.openStallCount
      }), {
        canteens: 0,
        stalls: visibleUnassignedStalls.reduce((sum, node) => sum + 1 + node.childCount, 0),
        dishes: visibleUnassignedStalls.reduce((sum, node) => sum + node.dishCount, 0),
        openStalls: visibleUnassignedStalls.reduce((sum, node) => sum + Number(node.stall.open) + node.children.filter((child) => child.stall.open).length, 0)
      });
      return {
        ...definition,
        name: region?.name || definition.name,
        defaultName: definition.name,
        displayName: region?.name || definition.name,
        missing: !region,
        region,
        labels: { venue: '餐饮场所', area: definition.areaLabel, stall: '档口', dish: '菜品' },
        counts,
        canteens: canteenNodes,
        unassignedStalls: visibleUnassignedStalls
      };
    });
  const safeOffset = Math.max(0, offset);
  const safeLimit = Math.max(1, Math.min(limit, 20));
  return { regions: regions.slice(safeOffset, safeOffset + safeLimit), total: regions.length, limit: safeLimit, offset: safeOffset, include: includeDishes ? 'dishes' : 'summary' };
}

const DATABASE_ENTITIES = {
  users: { label: '用户', table: 'users', capability: 'user:read', writeCapability: 'user:write', key: 'id', columns: ['id', 'username', 'nickname', 'role', 'created_at', 'updated_at'], writable: ['nickname', 'role'], search: ['username', 'nickname', 'role'] },
  canteens: { label: '食堂', table: 'canteens', capability: 'canteen:write', writeCapability: 'canteen:write', deleteCapability: 'canteen:delete', key: 'id', columns: ['id', 'name', 'location', 'hours', 'crowd_level', 'tags_json', 'description', 'created_at', 'updated_at'], writable: ['name', 'location', 'hours', 'crowd_level', 'tags_json', 'description'], search: ['name', 'location'] },
  stalls: { label: '档口', table: 'stalls', capability: 'stall:write', writeCapability: 'stall:write', deleteCapability: 'stall:delete', key: 'id', columns: ['id', 'canteen_id', 'parent_id', 'floor', 'name', 'category', 'rating', 'avg_price', 'open', 'description', 'created_at', 'updated_at'], writable: ['canteen_id', 'floor', 'name', 'category', 'rating', 'avg_price', 'open', 'description'], search: ['name', 'category'] },
  dishes: { label: '菜品与营养', table: 'dishes', capability: 'dish:write', writeCapability: 'dish:write', deleteCapability: 'dish:delete', key: 'id', columns: ['id', 'stall_id', 'name', 'price', 'taste', 'cuisine', 'ingredients_json', 'tags_json', 'halal', 'meal_types_json', 'calories', 'protein', 'fat', 'carbs', 'rating', 'review_count', 'sales', 'image', 'image_url', 'description', 'status', 'created_at', 'updated_at'], writable: ['stall_id', 'name', 'price', 'taste', 'cuisine', 'ingredients_json', 'tags_json', 'halal', 'meal_types_json', 'calories', 'protein', 'fat', 'carbs', 'rating', 'review_count', 'sales', 'image', 'image_url', 'description', 'status'], search: ['name', 'taste', 'cuisine'] },
  menus: { label: '菜单运营', table: 'menus', capability: 'dish:write', writeCapability: 'dish:write', deleteCapability: 'dish:write', key: 'id', columns: ['id', 'tenant_id', 'canteen_id', 'date', 'meal_type', 'status', 'created_at', 'updated_at'], writable: ['canteen_id', 'date', 'meal_type', 'status'], search: ['date', 'meal_type', 'status'] },
  menu_items: { label: '菜单明细', table: 'menu_items', capability: 'dish:write', writeCapability: 'dish:write', deleteCapability: 'dish:write', key: 'id', columns: ['id', 'tenant_id', 'menu_id', 'dish_id', 'price', 'supply_limit', 'supply_count', 'sold_out', 'serving_start', 'serving_end', 'created_at', 'updated_at'], writable: ['menu_id', 'dish_id', 'price', 'supply_limit', 'supply_count', 'sold_out', 'serving_start', 'serving_end'], search: ['menu_id', 'dish_id', 'sold_out'] },
  reviews: { label: '评价', table: 'reviews', capability: 'review:moderate', writeCapability: 'review:moderate', key: 'id', columns: ['id', 'tenant_id', 'user_id', 'target_type', 'target_id', 'rating', 'content', 'status', 'created_at'], writable: ['status'], search: ['content', 'status', 'target_id'] },
  audit_logs: { label: '审计日志', table: 'audit_logs', capability: 'audit:read', key: 'id', columns: ['id', 'tenant_id', 'user_id', 'action', 'entity', 'entity_id', 'metadata_json', 'created_at'], writable: [], search: ['action', 'entity', 'entity_id'] }
};

function databaseEntity(name) {
  const entity = DATABASE_ENTITIES[String(name || '').trim()];
  if (!entity) throw Object.assign(new Error('不支持的数据库实体'), { status: 404 });
  return entity;
}

function databasePayload(entity, body, { partial = false } = {}) {
  const payload = {};
  for (const field of entity.writable) {
    if (!partial || Object.prototype.hasOwnProperty.call(body, field)) payload[field] = body[field];
  }
  if (!Object.keys(payload).length) throw Object.assign(new Error('没有可修改的字段'), { status: 400 });
  return payload;
}

function isValidTenantId(id) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,62}$/.test(String(id || ''));
}

async function assertActiveTenant(db, tenantId) {
  const tenant = await db.prepare('SELECT status FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) throw Object.assign(new Error('租户不存在'), { status: 403 });
  if (tenant.status !== 'active') throw Object.assign(new Error('租户已停用，请联系管理员'), { status: 403 });
  return tenant;
}

function scopedSettingKey(user, key) {
  return `${tenantIdFor(user)}:${key}`;
}


function now() {
  return new Date().toISOString();
}

function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(Object.assign(new Error('JSON 格式错误'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function requestIdFrom(req) {
  const value = req.headers['x-request-id'];
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || `req-${randomUUID()}`).slice(0, 80);
}

function send(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'",
    ...extraHeaders
  });
  res.end(JSON.stringify(data));
}

function fail(res, error, requestId) {
  const status = error.status || 500;
  send(res, status, {
    error: status === 500 ? '服务器内部错误' : error.message,
    ...(error.code ? { code: error.code } : {}),
    requestId
  }, { 'X-Request-Id': requestId });
}

function requireFields(payload, fields) {
  for (const field of fields) {
    if (payload[field] == null || String(payload[field]).trim() === '') throw Object.assign(new Error(`缺少字段：${field}`), { status: 400 });
  }
}

function splitList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : String(value || '').split(/[，,]/).map((item) => item.trim()).filter(Boolean);
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'local';
}

function rateLimit(req) {
  const key = getClientIp(req);
  const current = Date.now();
  const bucket = rateBuckets.get(key) || { resetAt: current + RATE_WINDOW_MS, count: 0 };
  if (bucket.resetAt < current) {
    bucket.resetAt = current + RATE_WINDOW_MS;
    bucket.count = 0;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count > RATE_MAX) throw Object.assign(new Error('请求过于频繁，请稍后再试'), { status: 429 });
}

async function getUserFromRequest(db, req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload) return null;
  return await db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub) || null;
}

async function requireUser(db, req) {
  const user = await getUserFromRequest(db, req);
  if (!user) throw Object.assign(new Error('请先登录'), { status: 401 });
  await assertActiveTenant(db, tenantIdFor(user));
  return user;
}

async function requireCapability(db, req, permission) {
  return requirePermission(await requireUser(db, req), permission);
}

async function requireAnyCapability(db, req, permissions) {
  const user = await requireUser(db, req);
  if (!permissions.some((permission) => hasPermission(user, permission))) {
    throw Object.assign(new Error('权限不足'), { status: 403 });
  }
  return user;
}

async function audit(db, user, action, entity, entityId, metadata = {}) {
  await db.prepare('INSERT INTO audit_logs (id, tenant_id, user_id, action, entity, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), tenantIdFor(user), user?.id || null, action, entity, entityId || null, serializeJson(metadata), now());
}

function estimateTokens(value) {
  return Math.ceil(String(value || '').length / 4);
}

function currentMonthPrefix() {
  return now().slice(0, 7);
}

async function aiQuotaStatus(db, tenantId = 'default') {
  const tenant = await db.prepare('SELECT ai_quota FROM tenants WHERE id = ?').get(tenantId);
  const quota = Number(tenant?.ai_quota ?? 0);
  const row = await db.prepare("SELECT COUNT(*) AS used FROM ai_usage_logs WHERE tenant_id = ? AND status = 'success' AND created_at >= ?").get(tenantId, `${currentMonthPrefix()}-01`);
  const used = Number(row?.used || 0);
  return { quota, used, remaining: Math.max(quota - used, 0), period: currentMonthPrefix() };
}

async function assertAiQuota(db, user) {
  const quota = await aiQuotaStatus(db, tenantIdFor(user));
  if (quota.quota > 0 && quota.remaining <= 0) throw Object.assign(new Error('AI 月额度已用完，请联系管理员升级或调整额度。'), { status: 429 });
  return quota;
}
async function exchangeWechatCode(code) {
  const appid = process.env.WECHAT_MINIAPP_APPID;
  const secret = process.env.WECHAT_MINIAPP_SECRET;
  if (!appid || !secret) throw Object.assign(new Error('微信小程序登录未配置'), { status: 503 });
  const endpoint = new URL('https://api.weixin.qq.com/sns/jscode2session');
  endpoint.searchParams.set('appid', appid);
  endpoint.searchParams.set('secret', secret);
  endpoint.searchParams.set('js_code', code);
  endpoint.searchParams.set('grant_type', 'authorization_code');
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(Number(process.env.WECHAT_LOGIN_TIMEOUT_MS || 8000)) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.errcode || !data.openid) {
    throw Object.assign(new Error(data.errmsg || '微信登录失败'), { status: 401 });
  }
  return data;
}

async function findOrCreateWechatUser(db, session, profile = {}) {
  const openid = String(session.openid || '').trim();
  if (!openid) throw Object.assign(new Error('微信登录缺少 openid'), { status: 401 });
  const existing = await db.prepare('SELECT * FROM users WHERE wechat_openid = ?').get(openid);
  if (existing) return existing;
  const id = `u-${randomUUID()}`;
  const tenantId = 'default';
  const username = `wx_${openid.slice(0, 24)}`;
  const nickname = String(profile.nickname || profile.nickName || '微信用户').trim().slice(0, 32) || '微信用户';
  await db.prepare('INSERT INTO users (id, tenant_id, username, password_hash, nickname, role, wechat_openid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, tenantId, username, hashPassword(randomUUID()), nickname, 'student', openid, now(), now());
  await db.prepare('INSERT INTO health_profiles (user_id, tenant_id, goal, budget_max, meal_type, taste, halal_only, avoid_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, tenantId, 'healthy', 20, 'lunch', '不限', 0, '[]', now());
  return await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

async function recordAiUsage(db, user, details) {
  await db.prepare(`INSERT INTO ai_usage_logs (id, tenant_id, user_id, feature, provider, model, status, input_tokens, output_tokens, image_count, estimated_cost, latency_ms, error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    `ai-${randomUUID()}`,
    tenantIdFor(user),
    user?.id || null,
    details.feature,
    details.provider || getAiProviderStatus().source || 'none',
    details.model || '',
    details.status,
    Number(details.inputTokens || 0),
    Number(details.outputTokens || 0),
    Number(details.imageCount || 0),
    Number(details.estimatedCost || 0),
    Number(details.latencyMs || 0),
    details.error ? String(details.error).slice(0, 240) : null,
    now()
  );
}

async function listAiUsage(db, tenantId = 'default', limit = 50, offset = 0) {
  const rows = await db.prepare('SELECT * FROM ai_usage_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(tenantId, limit, offset);
  const totalRow = await db.prepare('SELECT COUNT(*) AS count FROM ai_usage_logs WHERE tenant_id = ?').get(tenantId);
  const period = currentMonthPrefix();
  const summaryRows = await db.prepare(`SELECT feature, status, COUNT(*) AS count, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(image_count) AS image_count, SUM(estimated_cost) AS estimated_cost, AVG(latency_ms) AS avg_latency_ms
    FROM ai_usage_logs WHERE tenant_id = ? AND created_at >= ? GROUP BY feature, status`).all(tenantId, `${period}-01`);
  const quota = await aiQuotaStatus(db, tenantId);
  return {
    logs: rows.map(rowToAiUsageLog),
    total: totalRow.count,
    period,
    quota,
    summary: summaryRows.map((row) => ({
      feature: row.feature,
      status: row.status,
      count: row.count,
      inputTokens: row.input_tokens || 0,
      outputTokens: row.output_tokens || 0,
      imageCount: row.image_count || 0,
      estimatedCost: Number(row.estimated_cost || 0),
      avgLatencyMs: Math.round(row.avg_latency_ms || 0)
    }))
  };
}

async function listCanteens(db, tenantId = 'default') {
  return (await db.prepare('SELECT * FROM canteens WHERE tenant_id = ? ORDER BY name').all(tenantId)).map(rowToCanteen);
}

async function listStalls(db, tenantId = 'default') {
  return (await db.prepare('SELECT * FROM stalls WHERE tenant_id = ? ORDER BY canteen_id, floor, name').all(tenantId)).map(rowToStall);
}

function normalizeStallParentId(value) {
  if (value == null) return null;
  return String(value).trim() || null;
}

async function requireCatalogDiningArea(db, { tenantId, canteenId }) {
  const area = await db.prepare('SELECT id, parent_id FROM canteens WHERE tenant_id = ? AND id = ?').get(tenantId, canteenId);
  if (!area) {
    throw Object.assign(new Error('所属食堂不存在，或餐饮分区不属于当前租户'), {
      status: 400,
      code: 'STALL_CANTEEN_NOT_FOUND'
    });
  }
  if (!area.parent_id || !isAdminCatalogVenueId(area.parent_id)) {
    throw Object.assign(new Error('新建或迁移档口必须直属餐厅或楼层餐区，不能直属顶层餐饮场所'), {
      status: 400,
      code: 'STALL_AREA_REQUIRED'
    });
  }
  const venue = await db.prepare('SELECT id, parent_id FROM canteens WHERE tenant_id = ? AND id = ?').get(tenantId, area.parent_id);
  if (!venue || venue.parent_id) {
    throw Object.assign(new Error('所属餐饮分区未关联当前租户的有效顶层餐饮场所'), {
      status: 400,
      code: 'STALL_AREA_REQUIRED'
    });
  }
  return area;
}

async function requireDishStallInDiningArea(db, { tenantId, stallId }) {
  const stall = await db.prepare('SELECT id, canteen_id, parent_id FROM stalls WHERE tenant_id = ? AND id = ?').get(tenantId, stallId);
  if (!stall) {
    throw Object.assign(new Error('所属档口不存在或不属于当前租户'), {
      status: 400,
      code: 'DISH_STALL_NOT_FOUND'
    });
  }
  if (stall.parent_id) {
    throw Object.assign(new Error('新建或迁移菜品必须选择餐饮分区直属档口，不能选择历史子档口'), {
      status: 400,
      code: 'DISH_STALL_AREA_REQUIRED'
    });
  }
  try {
    await requireCatalogDiningArea(db, { tenantId, canteenId: stall.canteen_id });
  } catch (error) {
    if (error.code === 'STALL_CANTEEN_NOT_FOUND' || error.code === 'STALL_AREA_REQUIRED') {
      throw Object.assign(new Error('新建或迁移菜品必须选择餐厅或楼层餐区下的直属档口'), {
        status: 400,
        code: 'DISH_STALL_AREA_REQUIRED'
      });
    }
    throw error;
  }
  return stall;
}

async function validateStallParent(db, { tenantId, stallId, canteenId, parentId, hasChildren = false }) {
  if (!parentId) return;
  if (parentId === stallId) throw Object.assign(new Error('档口不能将自身设置为父档口'), { status: 400, code: 'STALL_PARENT_SELF' });
  if (hasChildren) throw Object.assign(new Error('存在子档口的一级档口不能再设置父档口'), { status: 400, code: 'STALL_PARENT_HAS_CHILDREN' });
  const parent = await db.prepare('SELECT id, canteen_id, parent_id FROM stalls WHERE tenant_id = ? AND id = ?').get(tenantId, parentId);
  if (!parent) throw Object.assign(new Error('父档口不存在或不属于当前租户'), { status: 400, code: 'STALL_PARENT_NOT_FOUND' });
  if (parent.parent_id) throw Object.assign(new Error('档口层级最多支持两级，子档口不能继续挂载子档口'), { status: 400, code: 'STALL_PARENT_NESTED' });
  if (parent.canteen_id !== canteenId) throw Object.assign(new Error('子档口必须与父档口属于同一食堂'), { status: 400, code: 'STALL_PARENT_CROSS_CANTEEN' });
}

async function validateDatabaseStallWrite(db, { tenantId, stallId, payload, creating = false }) {
  const existing = creating
    ? null
    : await db.prepare('SELECT id, canteen_id, parent_id FROM stalls WHERE tenant_id = ? AND id = ?').get(tenantId, stallId);
  if (!creating && !existing) throw Object.assign(new Error('记录不存在'), { status: 404 });
  const canteenId = payload.canteen_id !== undefined ? String(payload.canteen_id || '').trim() : existing?.canteen_id;
  const parentId = payload.parent_id !== undefined ? normalizeStallParentId(payload.parent_id) : (existing?.parent_id || null);
  const isMoving = creating || canteenId !== existing?.canteen_id;
  if (isMoving) {
    await requireCatalogDiningArea(db, { tenantId, canteenId });
  } else {
    const canteen = await db.prepare('SELECT id FROM canteens WHERE tenant_id = ? AND id = ?').get(tenantId, canteenId);
    if (!canteen) throw Object.assign(new Error('所属食堂不存在，或餐饮分区不属于当前租户'), { status: 400, code: 'STALL_CANTEEN_NOT_FOUND' });
  }
  const childCount = creating ? 0 : Number((await db.prepare('SELECT COUNT(*) AS count FROM stalls WHERE tenant_id = ? AND parent_id = ?').get(tenantId, stallId))?.count || 0);
  if (childCount > 0 && canteenId !== existing.canteen_id) throw Object.assign(new Error('存在子档口的一级档口不能直接更换所属餐饮分区'), { status: 400, code: 'STALL_PARENT_HAS_CHILDREN' });
  await validateStallParent(db, { tenantId, stallId, canteenId, parentId, hasChildren: childCount > 0 });
  if (payload.canteen_id !== undefined) payload.canteen_id = canteenId;
  if (payload.parent_id !== undefined) payload.parent_id = parentId;
}

function rejectDatabaseStallParentWrite(entityName, body) {
  if (entityName !== 'stalls') return;
  if (Object.prototype.hasOwnProperty.call(body, 'parent_id') || Object.prototype.hasOwnProperty.call(body, 'parentId')) {
    throw Object.assign(new Error('档口父级请使用层级化档口接口维护'), { status: 400, code: 'STALL_PARENT_WORKBENCH_FORBIDDEN' });
  }
}

async function listDishes(db, params = new URLSearchParams(), tenantId = 'default') {
  const rows = (await db.prepare("SELECT * FROM dishes WHERE tenant_id = ? AND status = 'active' ORDER BY name").all(tenantId)).map(rowToDish);
  const keyword = String(params.get('keyword') || '').trim().toLowerCase();
  const maxPrice = Number(params.get('maxPrice') || 999);
  const taste = params.get('taste') || '不限';
  const halalOnly = params.get('halalOnly') === 'true';
  return rows.filter((dish) => {
    const haystack = [dish.name, dish.cuisine, dish.taste, ...dish.tags, ...dish.ingredients].join(' ').toLowerCase();
    if (keyword && !haystack.includes(keyword)) return false;
    if (dish.price > maxPrice) return false;
    if (taste !== '不限' && dish.taste !== taste && !dish.tags.includes(taste)) return false;
    if (halalOnly && !dish.halal) return false;
    return true;
  });
}

async function listReviews(db, targetId, tenantId = 'default', { includeAll = false } = {}) {
  const statusClause = includeAll ? '' : "AND reviews.status = 'approved'";
  return (await db.prepare(`SELECT reviews.*, users.nickname, users.username FROM reviews JOIN users ON users.id = reviews.user_id WHERE reviews.tenant_id = ? AND target_type = 'dish' AND target_id = ? ${statusClause} ORDER BY reviews.created_at DESC`).all(tenantId, targetId)).map(rowToReview);
}

async function reviewCatalog(db, tenantId) {
  const [dishRows, stallRows, canteenRows] = await Promise.all([
    db.prepare('SELECT * FROM dishes WHERE tenant_id = ? ORDER BY name').all(tenantId),
    db.prepare('SELECT * FROM stalls WHERE tenant_id = ? ORDER BY canteen_id, floor, name').all(tenantId),
    db.prepare('SELECT * FROM canteens WHERE tenant_id = ? ORDER BY name').all(tenantId)
  ]);
  const dishes = dishRows.map(rowToDish);
  const stalls = stallRows.map(rowToStall);
  const canteens = canteenRows.map(rowToCanteen);
  return {
    dishes: new Map(dishes.map((item) => [item.id, item])),
    stalls: new Map(stalls.map((item) => [item.id, item])),
    canteens: new Map(canteens.map((item) => [item.id, item]))
  };
}

function enrichReview(review, catalog) {
  const dish = review.targetType === 'dish' ? catalog.dishes.get(review.targetId) || null : null;
  const stall = dish ? catalog.stalls.get(dish.stallId) || null : null;
  const canteen = review.targetType === 'canteen'
    ? catalog.canteens.get(review.targetId) || null
    : (stall ? catalog.canteens.get(stall.canteenId) || null : null);
  return {
    ...review,
    dish: dish ? { id: dish.id, name: dish.name, image: dish.image, imageUrl: dish.imageUrl, price: dish.price } : null,
    stall: stall ? { id: stall.id, name: stall.name, floor: stall.floor } : null,
    canteen: canteen ? { id: canteen.id, name: canteen.name, location: canteen.location } : null
  };
}

function enrichPost(post, catalog, currentUserId = '') {
  const contextual = enrichReview({ targetType: post.targetType, targetId: post.targetId }, catalog);
  return {
    ...post,
    dish: contextual.dish,
    stall: contextual.stall,
    canteen: contextual.canteen,
    isOwn: post.userId === currentUserId
  };
}

async function dishDetail(db, id, tenantId = 'default') {
  const row = await db.prepare("SELECT * FROM dishes WHERE tenant_id = ? AND id = ? AND status = 'active'").get(tenantId, id);
  if (!row) return null;
  const dish = rowToDish(row);
  const stallRow = await db.prepare('SELECT * FROM stalls WHERE tenant_id = ? AND id = ?').get(tenantId, dish.stallId);
  const stall = stallRow ? rowToStall(stallRow) : null;
  const canteenRow = stall ? await db.prepare('SELECT * FROM canteens WHERE tenant_id = ? AND id = ?').get(tenantId, stall.canteenId) : null;
  return { ...dish, stall, canteen: canteenRow ? rowToCanteen(canteenRow) : null, reviews: await listReviews(db, id, tenantId) };
}

async function getProfile(db, userId, tenantId = 'default') {
  const row = await db.prepare('SELECT * FROM health_profiles WHERE tenant_id = ? AND user_id = ?').get(tenantId, userId);
  return rowToProfile(row);
}

async function snapshot(db, user = null) {
  const tenantId = tenantIdFor(user);
  const canteens = await listCanteens(db, tenantId);
  const stalls = await listStalls(db, tenantId);
  const dishes = await listDishes(db, new URLSearchParams(), tenantId);
  const reviews = (await db.prepare(`SELECT reviews.*, users.nickname, users.username FROM reviews JOIN users ON users.id = reviews.user_id WHERE reviews.tenant_id = ? AND reviews.status = 'approved' ORDER BY reviews.created_at DESC`).all(tenantId)).map(rowToReview);
  const dishPreferences = user ? (await db.prepare('SELECT * FROM user_dish_preferences WHERE tenant_id = ? AND user_id = ?').all(tenantId, user.id)).map(rowToPreference) : [];
  return {
    session: { user: publicUser(user) },
    canteens,
    stalls,
    dishes,
    reviews,
    dishPreferences,
    profile: user ? await getProfile(db, user.id, tenantId) : normalizeProfile({ goal: 'fatLoss', budgetMax: 18, mealType: 'lunch' })
  };
}

async function computeRankings(db, tenantId = 'default') {
  const dishes = await listDishes(db, new URLSearchParams(), tenantId);
  const reviewsByTarget = new Map();
  for (const review of (await db.prepare(`SELECT reviews.*, users.nickname, users.username FROM reviews JOIN users ON users.id = reviews.user_id WHERE reviews.tenant_id = ? AND reviews.status = 'approved'`).all(tenantId)).map(rowToReview)) {
    reviewsByTarget.set(review.targetId, [...(reviewsByTarget.get(review.targetId) || []), review]);
  }
  const rankedDishes = calculateRanking(dishes, reviewsByTarget);
  const stalls = (await listStalls(db, tenantId)).map((stall) => {
    const stallDishes = rankedDishes.filter((dish) => dish.stallId === stall.id);
    const rankScore = stallDishes.length ? stallDishes.reduce((sum, dish) => sum + dish.rankScore, 0) / stallDishes.length : stall.rating;
    return { ...stall, rankScore: Number(rankScore.toFixed(2)), dishCount: stallDishes.length };
  }).sort((left, right) => right.rankScore - left.rankScore);
  const canteens = (await listCanteens(db, tenantId)).map((canteen) => {
    const canteenStalls = stalls.filter((stall) => stall.canteenId === canteen.id);
    const rankScore = canteenStalls.length ? canteenStalls.reduce((sum, stall) => sum + stall.rankScore, 0) / canteenStalls.length : 0;
    return { ...canteen, rankScore: Number(rankScore.toFixed(2)), stallCount: canteenStalls.length };
  }).sort((left, right) => right.rankScore - left.rankScore);
  return { dishes: rankedDishes, stalls, canteens };
}

async function upsertDish(db, body, id = body.id || `dish-${randomUUID()}`, tenantId = 'default') {
  requireFields(body, ['stallId', 'name', 'price', 'taste', 'cuisine', 'ingredients', 'tags', 'nutrition']);
  const normalizedId = String(id || '').trim();
  const stallId = String(body.stallId || '').trim();
  const conflictingRecord = await db.prepare('SELECT tenant_id, stall_id FROM dishes WHERE id = ?').get(normalizedId);
  if (conflictingRecord && conflictingRecord.tenant_id !== tenantId) {
    throw Object.assign(new Error('该菜品 ID 已被其他租户使用，请更换 ID'), {
      status: 409,
      code: 'DISH_ID_TENANT_CONFLICT'
    });
  }
  const isNewOrMoving = !conflictingRecord || conflictingRecord.stall_id !== stallId;
  if (isNewOrMoving) await requireDishStallInDiningArea(db, { tenantId, stallId });
  const nutrition = body.nutrition || {};
  const fiber = Number(body.fiber ?? nutrition.fiber ?? 0);
  const sodium = Number(body.sodium ?? nutrition.sodium ?? 0);
  const sugar = Number(body.sugar ?? nutrition.sugar ?? 0);
  const calcium = Number(body.calcium ?? nutrition.calcium ?? 0);
  const iron = Number(body.iron ?? nutrition.iron ?? 0);
  const status = body.status == null ? 'active' : String(body.status).trim();
  if (!['active', 'hidden'].includes(status)) throw Object.assign(new Error('菜品状态必须为 active 或 hidden'), { status: 400 });
  await db.prepare(`INSERT INTO dishes (id, tenant_id, stall_id, name, price, taste, cuisine, ingredients_json, tags_json, halal, meal_types_json, calories, protein, fat, carbs, fiber, sodium, sugar, calcium, iron, rating, review_count, sales, image, image_url, description, status, allergens_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET stall_id=excluded.stall_id, name=excluded.name, price=excluded.price, taste=excluded.taste, cuisine=excluded.cuisine, ingredients_json=excluded.ingredients_json, tags_json=excluded.tags_json, halal=excluded.halal, meal_types_json=excluded.meal_types_json, calories=excluded.calories, protein=excluded.protein, fat=excluded.fat, carbs=excluded.carbs, fiber=excluded.fiber, sodium=excluded.sodium, sugar=excluded.sugar, calcium=excluded.calcium, iron=excluded.iron, rating=excluded.rating, review_count=excluded.review_count, sales=excluded.sales, image=excluded.image, image_url=excluded.image_url, description=excluded.description, status=excluded.status, allergens_json=excluded.allergens_json, updated_at=excluded.updated_at WHERE dishes.tenant_id=excluded.tenant_id`)
    .run(normalizedId, tenantId, stallId, body.name, Number(body.price), body.taste, body.cuisine, serializeJson(splitList(body.ingredients)), serializeJson(splitList(body.tags)), body.halal ? 1 : 0, serializeJson(body.mealTypes || ['lunch', 'dinner']), Number(nutrition.calories || 0), Number(nutrition.protein || 0), Number(nutrition.fat || 0), Number(nutrition.carbs || 0), fiber, sodium, sugar, calcium, iron, Number(body.rating || 4.5), Number(body.reviewCount || 0), Number(body.sales || 0), body.image || '🍽️', body.imageUrl || null, body.description || '管理员录入菜品。', status, serializeJson(splitList(body.allergens || [])), now(), now());
  const savedRecord = await db.prepare('SELECT tenant_id FROM dishes WHERE id = ?').get(normalizedId);
  if (!savedRecord || savedRecord.tenant_id !== tenantId) {
    throw Object.assign(new Error('该菜品 ID 已被其他租户使用，请更换 ID'), { status: 409, code: 'DISH_ID_TENANT_CONFLICT' });
  }
  await db.prepare('UPDATE dishes SET regional_taste = ? WHERE tenant_id = ? AND id = ?')
    .run(String(body.regionalTaste || '').trim(), tenantId, normalizedId);
  const quota = await aiQuotaStatus(db, tenantId);
  await syncDishRetrievalDocument(db, { tenantId, dishId: normalizedId, ...(quota.quota > 0 && quota.remaining <= 0 ? { embeddingProvider: null } : {}) });
  return normalizedId;
}

function parseBoolean(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', '是', '清真'].includes(text);
}

function parseMealTypes(value) {
  const items = splitList(value || 'lunch,dinner');
  return items.length ? items : ['lunch', 'dinner'];
}

function normalizeImportRow(row, index) {
  const get = (...keys) => keys.map((key) => row[key]).find((value) => value != null && String(value).trim() !== '');
  const venueId = String(get('venueId', 'venue_id', '食堂ID', '餐饮场所ID') || '').trim();
  const areaId = String(get('areaId', 'area_id', 'canteenId', 'canteen_id', '餐厅或楼层ID', '餐饮分区ID') || '').trim();
  const dish = {
    id: String(get('id', 'ID', '菜品ID') || '').trim() || undefined,
    stallId: String(get('stallId', 'stall_id', '档口ID') || '').trim(),
    name: String(get('name', '菜名', '菜品名称') || '').trim(),
    price: Number(get('price', '价格')),
    taste: String(get('taste', '口味') || '').trim(),
    cuisine: String(get('cuisine', '菜系') || '').trim(),
    ingredients: splitList(get('ingredients', '食材')),
    tags: splitList(get('tags', '标签')),
    halal: parseBoolean(get('halal', '清真')),
    mealTypes: parseMealTypes(get('mealTypes', 'meal_types', '餐别')),
    imageUrl: String(get('imageUrl', 'image_url', '图片地址') || '').trim(),
    description: String(get('description', '描述') || '').trim(),
    nutrition: {
      calories: Number(get('calories', '热量')),
      protein: Number(get('protein', '蛋白')),
      fat: Number(get('fat', '脂肪')),
      carbs: Number(get('carbs', '碳水')),
    },
  };
  const errors = [];
  for (const [field, label] of [['stallId', '档口ID'], ['name', '菜名'], ['taste', '口味'], ['cuisine', '菜系']]) {
    if (!dish[field]) errors.push(`缺少${label}`);
  }
  if (!Number.isFinite(dish.price) || dish.price <= 0) errors.push('价格必须大于 0');
  if (!dish.ingredients.length) errors.push('缺少食材');
  if (!dish.tags.length) errors.push('缺少标签');
  for (const [field, label] of [['calories', '热量'], ['protein', '蛋白'], ['fat', '脂肪'], ['carbs', '碳水']]) {
    if (!Number.isFinite(dish.nutrition[field]) || dish.nutrition[field] < 0) errors.push(`${label}必须是非负数字`);
  }
  return { row: index + 2, venueId, areaId, dish, valid: errors.length === 0, errors };
}

function parseCsvCells(line, rowNumber) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === ',') {
      cells.push(cell.trim());
      cell = '';
    } else if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === '"') {
      throw Object.assign(new Error(`CSV 第 ${rowNumber} 行引号格式错误`), { status: 400 });
    } else {
      cell += char;
    }
  }
  if (quoted) throw Object.assign(new Error(`CSV 第 ${rowNumber} 行引号未闭合`), { status: 400 });
  cells.push(cell.trim());
  return cells;
}

function parseCsvImport(csvText) {
  if (!csvText || !String(csvText).trim()) throw Object.assign(new Error('缺少 CSV 文件内容'), { status: 400 });
  const lines = String(csvText).replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length < 2) throw Object.assign(new Error('CSV 至少需要表头和 1 行数据'), { status: 400 });
  if (lines.length - 1 > MAX_IMPORT_ROWS) throw Object.assign(new Error(`CSV 单次最多导入 ${MAX_IMPORT_ROWS} 行`), { status: 400 });
  const headers = parseCsvCells(lines[0], 1);
  if (!headers.length) throw Object.assign(new Error('CSV 缺少表头'), { status: 400 });
  const rows = lines.slice(1).map((line, index) => {
    const values = parseCsvCells(line, index + 2);
    const row = {};
    headers.forEach((header, headerIndex) => { row[header] = values[headerIndex] ?? ''; });
    return row;
  });
  const preview = rows.map(normalizeImportRow);
  return { rows: preview, validCount: preview.filter((row) => row.valid).length, errorCount: preview.filter((row) => !row.valid).length };
}

async function validateImportHierarchy(db, preview, tenantId) {
  const seenDishIds = new Set();
  for (const row of preview.rows) {
    if (row.dish.id) {
      if (seenDishIds.has(row.dish.id)) row.errors.push(`菜品ID重复：${row.dish.id}`);
      seenDishIds.add(row.dish.id);
    }
    if (row.dish.stallId) {
      try {
        const stall = await requireDishStallInDiningArea(db, { tenantId, stallId: row.dish.stallId });
        const area = await db.prepare('SELECT id, parent_id FROM canteens WHERE tenant_id = ? AND id = ?').get(tenantId, stall.canteen_id);
        if (row.areaId && row.areaId !== area.id) row.errors.push('档口与餐厅或楼层ID不匹配');
        if (row.venueId && row.venueId !== area.parent_id) row.errors.push('餐厅或楼层与食堂ID不匹配');
        row.areaId ||= area.id;
        row.venueId ||= area.parent_id;
      } catch (error) {
        row.errors.push(error.message);
      }
    }
    row.errors = [...new Set(row.errors)];
    row.valid = row.errors.length === 0;
  }
  preview.validCount = preview.rows.filter((row) => row.valid).length;
  preview.errorCount = preview.rows.length - preview.validCount;
  return preview;
}

async function upsertCanteen(db, body, id = body.id || `canteen-${randomUUID()}`, tenantId = 'default') {
  requireFields(body, ['name', 'location', 'hours', 'description']);
  const normalizedId = String(id || '').trim();
  const image = body.imageUrl || body.image || '';
  const conflictingRecord = await db.prepare('SELECT tenant_id, parent_id FROM canteens WHERE id = ?').get(normalizedId);
  if (conflictingRecord && conflictingRecord.tenant_id !== tenantId) {
    throw Object.assign(new Error('该餐饮场所 ID 已被其他租户使用，请更换 ID'), {
      status: 409,
      code: 'CANTEEN_ID_TENANT_CONFLICT'
    });
  }
  const hasParentId = Object.prototype.hasOwnProperty.call(body, 'parentId');
  const parentId = hasParentId
    ? (body.parentId == null ? null : (String(body.parentId).trim() || null))
    : (conflictingRecord?.tenant_id === tenantId ? (conflictingRecord.parent_id || null) : null);
  const canteenType = parentId ? 'sub' : 'primary';
  const isFixedVenue = isAdminCatalogVenueId(normalizedId);
  if (isFixedVenue && parentId) {
    throw Object.assign(new Error('固定餐饮场所不能设置父级'), {
      status: 400,
      code: 'CANTEEN_FIXED_PARENT_FORBIDDEN'
    });
  }
  if (parentId) {
    if (parentId === normalizedId) {
      throw Object.assign(new Error('不能将餐饮分区设为自己的父级'), { status: 400, code: 'CANTEEN_PARENT_SELF' });
    }
    const parent = await db.prepare('SELECT id, parent_id FROM canteens WHERE tenant_id = ? AND id = ?').get(tenantId, parentId);
    if (!parent) {
      throw Object.assign(new Error('父级餐饮场所不存在或不属于当前租户'), { status: 400, code: 'CANTEEN_PARENT_NOT_FOUND' });
    }
    if (!isAdminCatalogVenueId(parent.id) || parent.parent_id) {
      throw Object.assign(new Error('餐饮分区只能直属四个顶层餐饮场所，不能创建三级餐区'), {
        status: 400,
        code: 'CANTEEN_PARENT_NESTED'
      });
    }
  } else if (!isFixedVenue && conflictingRecord?.tenant_id === tenantId && conflictingRecord.parent_id && hasParentId) {
    throw Object.assign(new Error('已有餐饮分区不能清空父级场所'), {
      status: 400,
      code: 'CANTEEN_AREA_PARENT_REQUIRED'
    });
  }
  await db.prepare('INSERT INTO canteens (id, tenant_id, name, location, hours, crowd_level, tags_json, description, parent_id, canteen_type, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, location=excluded.location, hours=excluded.hours, crowd_level=excluded.crowd_level, tags_json=excluded.tags_json, description=excluded.description, parent_id=excluded.parent_id, canteen_type=excluded.canteen_type, image=excluded.image, updated_at=excluded.updated_at WHERE canteens.tenant_id=excluded.tenant_id')
    .run(normalizedId, tenantId, body.name, body.location, body.hours, Number(body.crowdLevel || 30), serializeJson(splitList(body.tags)), body.description, parentId, canteenType, image, now(), now());
  const savedRecord = await db.prepare('SELECT tenant_id FROM canteens WHERE id = ?').get(normalizedId);
  if (!savedRecord || savedRecord.tenant_id !== tenantId) {
    throw Object.assign(new Error('该餐饮场所 ID 已被其他租户使用，请更换 ID'), { status: 409, code: 'CANTEEN_ID_TENANT_CONFLICT' });
  }
  return normalizedId;
}

async function listTenants(db) {
  return (await db.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all()).map(rowToTenant);
}

async function upsertTenant(db, body, id = body.id || `tenant-${randomUUID()}`) {
  requireFields(body, ['name']);
  if (!isValidTenantId(id)) throw Object.assign(new Error('租户 ID 只能包含字母、数字、下划线和短横线，长度 2-63 位'), { status: 400 });
  const status = body.status ?? 'active';
  if (!['active', 'disabled'].includes(status)) {
    throw Object.assign(new Error('租户状态必须为 active 或 disabled'), { status: 400 });
  }
  const plan = String(body.plan || 'starter').trim() || 'starter';
  await db.prepare(`INSERT INTO tenants (id, name, status, plan, ai_quota, storage_quota_mb, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, status=excluded.status, plan=excluded.plan, ai_quota=excluded.ai_quota, storage_quota_mb=excluded.storage_quota_mb, updated_at=excluded.updated_at`)
    .run(id, String(body.name).trim(), status, plan, Number(body.aiQuota ?? 1000), Number(body.storageQuotaMb ?? 10240), now(), now());
  return id;
}

async function withTransaction(db, operation) {
  if (typeof db.transaction === 'function') return db.transaction(operation);
  await db.exec('BEGIN');
  try {
    const result = await operation(db);
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

async function validateMenuOwnership(db, body, tenantId) {
  const canteen = await db.prepare('SELECT id FROM canteens WHERE tenant_id = ? AND id = ?').get(tenantId, body.canteenId);
  if (!canteen) throw Object.assign(new Error('菜单食堂不存在或不属于当前租户'), { status: 400 });
  const dishIds = [...new Set((Array.isArray(body.items) ? body.items : []).map((item) => item.dishId).filter(Boolean))];
  for (const dishId of dishIds) {
    const dish = await db.prepare("SELECT id FROM dishes WHERE tenant_id = ? AND id = ? AND status = 'active'").get(tenantId, dishId);
    if (!dish) throw Object.assign(new Error(`菜单菜品不存在或不属于当前租户：${dishId}`), { status: 400 });
  }
}

function menuFilters(searchParams) {
  return {
    date: searchParams.get('date') || '',
    mealType: searchParams.get('mealType') || '',
    status: searchParams.get('status') || '',
    limit: Math.min(Number(searchParams.get('limit')) || 100, 200),
    offset: Number(searchParams.get('offset')) || 0
  };
}

function appendFilter(clauses, params, column, value) {
  if (!value) return;
  clauses.push(`${column} = ?`);
  params.push(value);
}

async function listMenus(db, tenantId = 'default', filters = {}) {
  const clauses = ['menus.tenant_id = ?'];
  const params = [tenantId];
  appendFilter(clauses, params, 'menus.date', filters.date);
  appendFilter(clauses, params, 'menus.meal_type', filters.mealType);
  appendFilter(clauses, params, 'menus.status', filters.status);
  const where = clauses.join(' AND ');
  const limit = Math.min(Number(filters.limit || 100), 200);
  const offset = Number(filters.offset || 0);
  const menus = (await db.prepare(`SELECT menus.*, canteens.name AS canteen_name FROM menus LEFT JOIN canteens ON canteens.id = menus.canteen_id WHERE ${where} ORDER BY menus.date DESC, menus.meal_type LIMIT ? OFFSET ?`).all(...params, limit, offset)).map(rowToMenu);
  if (!menus.length) return { menus: [], total: 0 };
  const totalRow = await db.prepare(`SELECT COUNT(*) AS count FROM menus WHERE ${where.replaceAll('menus.', '')}`).get(...params);
  const menuIds = new Set(menus.map((menu) => menu.id));
  const items = (await db.prepare('SELECT menu_items.*, dishes.name AS dish_name FROM menu_items LEFT JOIN dishes ON dishes.id = menu_items.dish_id WHERE menu_items.tenant_id = ? ORDER BY menu_items.created_at').all(tenantId)).map(rowToMenuItem).filter((item) => menuIds.has(item.menuId));
  const byMenu = new Map();
  for (const item of items) byMenu.set(item.menuId, [...(byMenu.get(item.menuId) || []), item]);
  return { menus: menus.map((menu) => ({ ...menu, items: byMenu.get(menu.id) || [] })), total: totalRow.count };
}

async function todayMenuBundle(db, tenantId = 'default', mealType = 'lunch', date = now().slice(0, 10)) {
  const { menus } = await listMenus(db, tenantId, { date, mealType, status: 'published', limit: 200, offset: 0 });
  if (!menus.length) return { date, mealType, menus: [], dishes: [], source: 'fallback' };
  const dishIds = new Set();
  const itemByDish = new Map();
  for (const menu of menus) {
    for (const item of menu.items) {
      dishIds.add(item.dishId);
      itemByDish.set(item.dishId, item);
    }
  }
  if (!dishIds.size) return { date, mealType, menus, dishes: [], source: 'menu' };
  const dishes = (await listDishes(db, new URLSearchParams(), tenantId))
    .filter((dish) => dishIds.has(dish.id))
    .map((dish) => {
      const item = itemByDish.get(dish.id);
      return { ...dish, price: Number(item?.price || dish.price), menuItem: item, supplyStatus: item?.supplyStatus || 'available' };
    });
  return { date, mealType, menus, dishes, source: 'menu' };
}

function recommendationGoalLabel(goal) {
  return ({ fatLoss: '减脂控卡', muscleGain: '增肌高蛋白', maintain: '均衡维持', healthy: '健康均衡' })[goal] || '健康均衡';
}

async function retrievalIndexQuery(db, user, { query, tenantId, limit, candidateIds, sourceType, sourceTypes }) {
  await getAiSettings(db, user).catch(() => {});
  const quota = await aiQuotaStatus(db, tenantId);
  const quotaExhausted = quota.quota > 0 && quota.remaining <= 0;
  const requestedTypes = sourceTypes || (sourceType ? [sourceType] : undefined);
  const normalizedTypes = requestedTypes?.flatMap((type) => ['health', 'knowledge'].includes(type) ? ['health_knowledge'] : [type]);
  const result = await searchRetrievalIndex(db, query, {
    tenantId,
    sourceTypes: normalizedTypes,
    limit,
    ...(quotaExhausted ? { embeddingProvider: null } : {})
  });
  const allowed = candidateIds?.length ? new Set(candidateIds) : null;
  const items = allowed ? result.items.filter((item) => allowed.has(item.sourceId || item.metadata?.dishId || item.id)) : result.items;
  const warnings = quotaExhausted
    ? [{ code: 'AI_QUOTA_EXHAUSTED', message: 'AI 额度已用完，已降级为词法检索。', fallback: 'lexical' }, ...result.warnings]
    : result.warnings;
  return { ...result, items, warnings, meta: { ...result.meta, quotaExhausted } };
}

function retrievalWorkflowDependencies(db, user) {
  return {
    db,
    indexVersion: RETRIEVAL_INDEX_VERSION,
    semanticSearch: (request) => retrievalIndexQuery(db, user, request),
    knowledgeSearch: (request) => retrievalIndexQuery(db, user, request),
    interpretQuery: async ({ query, tenantId }) => {
      const quota = await aiQuotaStatus(db, tenantId);
      if (quota.quota > 0 && quota.remaining <= 0) return { filters: {}, warning: { code: 'AI_QUOTA_EXHAUSTED', message: 'AI 额度已用完，跳过语义补充。' } };
      if (!getAiProviderStatus().enabled) return null;
      const startedAt = Date.now();
      const status = getAiProviderStatus();
      try {
        const filters = await generateDishSearchFilterSupplement({ query });
        await recordAiUsage(db, user, {
          feature: 'dish-search-interpretation',
          provider: status.source,
          model: status.chatModel,
          status: 'success',
          inputTokens: estimateTokens(query),
          latencyMs: Date.now() - startedAt
        });
        return filters || {};
      } catch (error) {
        await recordAiUsage(db, user, {
          feature: 'dish-search-interpretation',
          provider: status.source,
          model: status.chatModel,
          status: 'failure',
          inputTokens: estimateTokens(query),
          latencyMs: Date.now() - startedAt,
          error: error.message
        });
        throw error;
      }
    }
  };
}

async function recommendationRuntimeInput(db, user, body = {}) {
  const tenantId = tenantIdFor(user);
  const [storedProfile, environmentRow, preferences, memory] = await Promise.all([
    user ? getProfile(db, user.id, tenantId) : Promise.resolve(normalizeProfile(body.profile || {})),
    db.prepare('SELECT * FROM campus_environment WHERE tenant_id = ?').get(tenantId),
    user ? db.prepare('SELECT * FROM user_dish_preferences WHERE tenant_id = ? AND user_id = ?').all(tenantId, user.id) : Promise.resolve([]),
    user ? loadAgentMemory(db, user) : Promise.resolve({ preferences: {} })
  ]);
  const hour = new Date().getHours();
  const timeOfDay = hour < 10 ? 'breakfast' : hour < 17 ? 'lunch' : 'dinner';
  return {
    tenantId,
    userId: user?.id,
    query: String(body.query || body.question || '').trim(),
    profile: { ...storedProfile, ...(memory.preferences || {}) },
    profileOverride: { ...(body.profile || {}), ...(body.profileOverride || {}) },
    context: {
      ...(body.context || {}),
      environment: environmentRow ? rowToEnvironment(environmentRow) : { temperature: 25, weatherLabel: '晴' },
      preferences: preferences.map(rowToPreference),
      timeOfDay
    },
    options: body.options || {}
  };
}

function legacyRecommendationDish(dish) {
  return {
    ...dish,
    price: Number(dish.availability?.price ?? dish.price ?? 0),
    contextualScore: Number(dish.contextualScore ?? dish.recommendationScore ?? 0)
  };
}

function compatibleRecommendationResponse(result) {
  const profile = result.meta?.profile || {};
  const picks = (result.recommendations || []).map(legacyRecommendationDish);
  const totals = picks.reduce((sum, dish) => ({
    calories: sum.calories + Number(dish.nutrition?.calories || 0),
    protein: sum.protein + Number(dish.nutrition?.protein || 0),
    fat: sum.fat + Number(dish.nutrition?.fat || 0),
    carbs: sum.carbs + Number(dish.nutrition?.carbs || 0),
    price: sum.price + Number(dish.availability?.price ?? dish.price ?? 0)
  }), { calories: 0, protein: 0, fat: 0, carbs: 0, price: 0 });
  const plan = {
    ...result.mealPlan,
    goal: profile.goal || 'healthy',
    goalLabel: recommendationGoalLabel(profile.goal),
    reason: picks.length ? '候选来自同一套硬约束与统一排序结果。' : '当前没有满足全部条件的候选。',
    dishes: picks,
    picks,
    totals: result.mealPlan?.totals || totals
  };
  return {
    ...result,
    ranked: picks,
    dishes: picks,
    totals: plan.totals,
    plan,
    context: {
      environment: result.meta?.environment,
      timeOfDay: result.meta?.timeOfDay,
      profile
    },
    source: result.meta?.menus?.length ? 'menu' : 'fallback',
    menu: { date: result.meta?.date, mealType: result.meta?.mealType, menus: result.meta?.menus || [] }
  };
}

function recommendationAnswer(result) {
  const names = (result.recommendations || []).map((dish) => dish.name).filter(Boolean);
  if (!names.length) {
    const suggestion = result.suggestedRelaxations?.[0]?.message;
    return suggestion ? `当前没有满足全部条件的菜品。${suggestion}` : '当前没有满足全部条件的菜品，系统不会编造可点结果。';
  }
  const orderable = result.meta?.orderable !== false;
  return `${orderable ? '根据当前已发布菜单' : '当前无可点菜单，以下仅作菜品库参考'}，为你筛选出：${names.join('、')}。价格、库存、供应时段和过敏原均以实时数据库结果为准。`;
}

function dishEvidenceFromSearch(result) {
  return (result.items || []).map((dish) => ({
    id: `dish:${dish.id}`,
    sourceId: dish.id,
    sourceType: 'dish',
    title: dish.name,
    name: dish.name,
    content: [
      dish.name,
      dish.description,
      ...(dish.ingredients || []),
      ...(dish.tags || []),
      dish.halal ? '清真' : '',
      [dish.canteenName, dish.stallName].filter(Boolean).join(' > '),
      `${dish.nutrition?.calories || 0} kcal，蛋白质 ${dish.nutrition?.protein || 0} g`
    ].filter(Boolean).join('；'),
    snippet: `${dish.canteenName || '食堂'} · ${dish.stallName || '档口'} · ¥${dish.availability?.price ?? dish.price}`,
    score: dish.retrievalScore,
    metadata: { orderable: dish.availability?.orderable, menuItemId: dish.availability?.menuItemId || null }
  }));
}

async function executeDishSearch(db, user, body = {}) {
  return runDishSearchWorkflow({ ...body, tenantId: tenantIdFor(user) }, retrievalWorkflowDependencies(db, user));
}

async function executeLegacyDishList(db, user, params = new URLSearchParams()) {
  const keyword = String(params.get('keyword') || '').trim();
  const filters = {};
  if (params.has('maxPrice')) filters.maxPrice = params.get('maxPrice');
  if (params.get('taste') && params.get('taste') !== '不限') filters.taste = params.get('taste');
  if (params.get('halalOnly') === 'true') filters.halalOnly = true;
  const result = await executeDishSearch(db, user, {
    query: keyword,
    filters,
    sort: 'relevance',
    limit: 50,
    offset: 0
  });
  return result.items;
}

async function executeMealRecommendation(db, user, body = {}) {
  const input = await recommendationRuntimeInput(db, user, body);
  const result = await runMealRecommendationWorkflow(input, retrievalWorkflowDependencies(db, user));
  result.meta.environment = input.context.environment;
  result.meta.timeOfDay = input.context.timeOfDay;
  result.meta.menus = (await listMenus(db, input.tenantId, { date: result.meta.date, mealType: result.meta.mealType, status: 'published', limit: 200, offset: 0 })).menus;
  return result;
}
function rowToOrder(row, items = [], payments = []) {
  return {
    id: row.id,
    tenantId: row.tenant_id || 'default',
    userId: row.user_id,
    status: row.status,
    paymentStatus: row.payment_status || 'unpaid',
    paidAt: row.paid_at || null,
    totalAmount: Number(row.total_amount || 0),
    pickupCode: row.pickup_code,
    note: row.note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
    payments
  };
}

function rowToOrderItem(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    dishId: row.dish_id,
    menuItemId: row.menu_item_id || null,
    dishName: row.dish_name,
    unitPrice: Number(row.unit_price || 0),
    price: Number(row.unit_price || 0),
    quantity: Number(row.quantity || 0),
    lineTotal: Number(row.line_total || 0),
    createdAt: row.created_at
  };
}

function rowToPayment(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    userId: row.user_id,
    amount: Number(row.amount || 0),
    channel: row.channel,
    status: row.status,
    transactionNo: row.transaction_no,
    paidAt: row.paid_at || null,
    createdAt: row.created_at
  };
}

async function hydrateOrders(db, rows, tenantId) {
  if (!rows.length) return [];
  const ids = new Set(rows.map((row) => row.id));
  const itemRows = await db.prepare('SELECT * FROM order_items WHERE tenant_id = ? ORDER BY created_at, id').all(tenantId);
  const paymentRows = await db.prepare('SELECT * FROM payments WHERE tenant_id = ? ORDER BY created_at, id').all(tenantId);
  const byOrder = new Map();
  const paymentsByOrder = new Map();
  for (const item of itemRows.map(rowToOrderItem).filter((item) => ids.has(item.orderId))) {
    byOrder.set(item.orderId, [...(byOrder.get(item.orderId) || []), item]);
  }
  for (const payment of paymentRows.map(rowToPayment).filter((payment) => ids.has(payment.orderId))) {
    paymentsByOrder.set(payment.orderId, [...(paymentsByOrder.get(payment.orderId) || []), payment]);
  }
  return rows.map((row) => rowToOrder(row, byOrder.get(row.id) || [], paymentsByOrder.get(row.id) || []));
}

async function listOrdersForUser(db, user, limit = 50, offset = 0) {
  const tenantId = tenantIdFor(user);
  const rows = await db.prepare('SELECT * FROM orders WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(tenantId, user.id, Math.min(Number(limit || 50), 100), Number(offset || 0));
  return hydrateOrders(db, rows, tenantId);
}

async function listTenantOrders(db, tenantId, { status = '', limit = 100, offset = 0 } = {}) {
  const clauses = ['tenant_id = ?'];
  const params = [tenantId];
  if (status) { clauses.push('status = ?'); params.push(status); }
  const rows = await db.prepare(`SELECT * FROM orders WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, Math.min(Number(limit || 100), 200), Number(offset || 0));
  return hydrateOrders(db, rows, tenantId);
}

function pickupCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function createOrder(db, user, body) {
  const tenantId = tenantIdFor(user);
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) throw Object.assign(new Error('订单至少包含 1 个菜品'), { status: 400 });
  const quantities = new Map();
  for (const item of rawItems) {
    const dishId = String(item.dishId || '').trim();
    const quantity = Number(item.quantity || 0);
    if (!dishId || !Number.isInteger(quantity) || quantity <= 0 || quantity > 20) throw Object.assign(new Error('订单菜品和数量不合法'), { status: 400 });
    quantities.set(dishId, (quantities.get(dishId) || 0) + quantity);
  }
  const bundle = await todayMenuBundle(db, tenantId, body.mealType || (await getProfile(db, user.id, tenantId)).mealType, now().slice(0, 10));
  const menuItemsByDish = new Map();
  for (const menu of bundle.menus) for (const item of menu.items) menuItemsByDish.set(item.dishId, item);
  const orderItems = [];
  let totalAmount = 0;
  for (const [dishId, quantity] of quantities.entries()) {
    const dish = bundle.dishes.find((candidate) => candidate.id === dishId);
    if (!dish) throw Object.assign(new Error(`今日菜单没有可购买菜品：${dishId}`), { status: 400 });
    const menuItem = menuItemsByDish.get(dishId);
    if (!menuItem || menuItem.soldOut || menuItem.supplyStatus === 'sold_out') throw Object.assign(new Error(`菜品已售罄：${dish.name}`), { status: 400 });
    if (menuItem.supplyLimit > 0 && menuItem.supplyCount + quantity > menuItem.supplyLimit) throw Object.assign(new Error(`菜品剩余份数不足：${dish.name}`), { status: 400 });
    const unitPrice = Number(menuItem.price || dish.price || 0);
    const lineTotal = Number((unitPrice * quantity).toFixed(2));
    totalAmount += lineTotal;
    orderItems.push({ dish, menuItem, quantity, unitPrice, lineTotal });
  }
  const id = `order-${randomUUID()}`;
  const createdAt = now();
  await withTransaction(db, async (tx) => {
    await tx.prepare('INSERT INTO orders (id, tenant_id, user_id, status, payment_status, total_amount, pickup_code, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, tenantId, user.id, 'pending', 'unpaid', Number(totalAmount.toFixed(2)), pickupCode(), String(body.note || '').trim().slice(0, 120), createdAt, createdAt);
    for (const item of orderItems) {
      await tx.prepare('INSERT INTO order_items (id, tenant_id, order_id, dish_id, menu_item_id, dish_name, unit_price, quantity, line_total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(`order-item-${randomUUID()}`, tenantId, id, item.dish.id, item.menuItem.id, item.dish.name, item.unitPrice, item.quantity, item.lineTotal, createdAt);
      await tx.prepare('UPDATE menu_items SET supply_count = supply_count + ?, sold_out = CASE WHEN supply_limit > 0 AND supply_count + ? >= supply_limit THEN 1 ELSE sold_out END, updated_at = ? WHERE tenant_id = ? AND id = ?')
        .run(item.quantity, item.quantity, createdAt, tenantId, item.menuItem.id);
      await tx.prepare('UPDATE dishes SET sales = sales + ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run(item.quantity, createdAt, tenantId, item.dish.id);
    }
  });
  const [order] = await hydrateOrders(db, [await db.prepare('SELECT * FROM orders WHERE tenant_id = ? AND id = ?').get(tenantId, id)], tenantId);
  return order;
}

async function rollbackOrderInventory(db, tenantId, orderId, timestamp) {
  const items = await db.prepare('SELECT * FROM order_items WHERE tenant_id = ? AND order_id = ?').all(tenantId, orderId);
  for (const item of items) {
    if (item.menu_item_id) {
      await db.prepare(`UPDATE menu_items
        SET supply_count = CASE WHEN supply_count - ? < 0 THEN 0 ELSE supply_count - ? END,
            sold_out = CASE WHEN supply_limit > 0 AND (CASE WHEN supply_count - ? < 0 THEN 0 ELSE supply_count - ? END) >= supply_limit THEN 1 ELSE 0 END,
            updated_at = ?
        WHERE tenant_id = ? AND id = ?`)
        .run(item.quantity, item.quantity, item.quantity, item.quantity, timestamp, tenantId, item.menu_item_id);
    }
    await db.prepare('UPDATE dishes SET sales = CASE WHEN sales - ? < 0 THEN 0 ELSE sales - ? END, updated_at = ? WHERE tenant_id = ? AND id = ?')
      .run(item.quantity, item.quantity, timestamp, tenantId, item.dish_id);
  }
}

async function cancelOrder(db, user, orderId) {
  const tenantId = tenantIdFor(user);
  const order = await db.prepare('SELECT * FROM orders WHERE tenant_id = ? AND id = ?').get(tenantId, orderId);
  if (!order) throw Object.assign(new Error('订单不存在'), { status: 404 });
  if (order.user_id !== user.id) throw Object.assign(new Error('不能取消他人订单'), { status: 403 });
  if (!['pending', 'preparing'].includes(order.status) || order.payment_status === 'paid') throw Object.assign(new Error('当前订单不能取消'), { status: 400 });
  const timestamp = now();
  await withTransaction(db, async (tx) => {
    await rollbackOrderInventory(tx, tenantId, orderId, timestamp);
    await tx.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run('cancelled', timestamp, tenantId, orderId);
  });
  const [updated] = await hydrateOrders(db, [await db.prepare('SELECT * FROM orders WHERE tenant_id = ? AND id = ?').get(tenantId, orderId)], tenantId);
  return updated;
}

async function payOrder(db, user, orderId, body = {}) {
  const tenantId = tenantIdFor(user);
  const order = await db.prepare('SELECT * FROM orders WHERE tenant_id = ? AND id = ?').get(tenantId, orderId);
  if (!order) throw Object.assign(new Error('订单不存在'), { status: 404 });
  if (order.user_id !== user.id) throw Object.assign(new Error('不能支付他人订单'), { status: 403 });
  if (order.status === 'cancelled') throw Object.assign(new Error('已取消订单不能支付'), { status: 400 });
  if (order.payment_status === 'paid') throw Object.assign(new Error('订单已支付'), { status: 400 });
  const timestamp = now();
  await withTransaction(db, async (tx) => {
    await tx.prepare('INSERT INTO payments (id, tenant_id, order_id, user_id, amount, channel, status, transaction_no, paid_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`payment-${randomUUID()}`, tenantId, orderId, user.id, Number(order.total_amount || 0), String(body.channel || 'mock').slice(0, 32), 'paid', `mock-${randomUUID()}`, timestamp, timestamp);
    await tx.prepare('UPDATE orders SET payment_status = ?, paid_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run('paid', timestamp, timestamp, tenantId, orderId);
  });
  const [updated] = await hydrateOrders(db, [await db.prepare('SELECT * FROM orders WHERE tenant_id = ? AND id = ?').get(tenantId, orderId)], tenantId);
  return updated;
}

async function orderAnalytics(db, tenantId, date = now().slice(0, 10)) {
  const start = `${date}T00:00:00.000Z`;
  const end = `${date}T23:59:59.999Z`;
  const orders = await db.prepare('SELECT * FROM orders WHERE tenant_id = ? AND created_at BETWEEN ? AND ?').all(tenantId, start, end);
  const paidRevenue = await db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE tenant_id = ? AND status = 'paid' AND created_at BETWEEN ? AND ?").get(tenantId, start, end);
  const statusRows = await db.prepare('SELECT status, COUNT(*) AS count FROM orders WHERE tenant_id = ? AND created_at BETWEEN ? AND ? GROUP BY status').all(tenantId, start, end);
  const topDishes = await db.prepare(`SELECT dish_id AS dishId, dish_name AS dishName, SUM(quantity) AS quantity, SUM(line_total) AS amount
    FROM order_items WHERE tenant_id = ? AND created_at BETWEEN ? AND ? GROUP BY dish_id, dish_name ORDER BY quantity DESC, amount DESC LIMIT 10`).all(tenantId, start, end);
  const soldOutItems = await db.prepare(`SELECT mi.id AS menuItemId, mi.dish_id AS dishId, d.name AS dishName, mi.supply_limit AS supplyLimit, mi.supply_count AS supplyCount
    FROM menu_items mi JOIN menus m ON m.id = mi.menu_id AND m.tenant_id = mi.tenant_id JOIN dishes d ON d.id = mi.dish_id AND d.tenant_id = mi.tenant_id
    WHERE mi.tenant_id = ? AND m.date = ? AND mi.sold_out = 1`).all(tenantId, date);
  return {
    date,
    todayOrders: orders.length,
    todayRevenue: Number(Number(paidRevenue?.total || 0).toFixed(2)),
    statusCounts: statusRows.reduce((acc, row) => ({ ...acc, [row.status]: Number(row.count || 0) }), {}),
    topDishes: topDishes.map((row) => ({ dishId: row.dishId, dishName: row.dishName, totalQuantity: Number(row.quantity || 0), totalRevenue: Number(Number(row.amount || 0).toFixed(2)), quantity: Number(row.quantity || 0), amount: Number(Number(row.amount || 0).toFixed(2)) })),
    soldOutItems: soldOutItems.map((row) => ({ menuItemId: row.menuItemId, dishId: row.dishId, dishName: row.dishName, supplyLimit: Number(row.supplyLimit || 0), supplyCount: Number(row.supplyCount || 0) }))
  };
}

async function updateOrderStatus(db, user, orderId, nextStatus) {
  const allowed = new Set(['pending', 'preparing', 'ready', 'completed', 'cancelled']);
  if (!allowed.has(nextStatus)) throw Object.assign(new Error('订单状态不合法'), { status: 400 });
  const tenantId = tenantIdFor(user);
  const order = await db.prepare('SELECT * FROM orders WHERE tenant_id = ? AND id = ?').get(tenantId, orderId);
  if (!order) throw Object.assign(new Error('订单不存在'), { status: 404 });
  const transitions = {
    pending: new Set(['preparing', 'cancelled']),
    preparing: new Set(['ready', 'cancelled']),
    ready: new Set(['completed']),
    completed: new Set(),
    cancelled: new Set()
  };
  if (!transitions[order.status]?.has(nextStatus)) throw Object.assign(new Error('订单状态流转不允许'), { status: 400 });
  await db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run(nextStatus, now(), tenantId, orderId);
  const [updated] = await hydrateOrders(db, [await db.prepare('SELECT * FROM orders WHERE tenant_id = ? AND id = ?').get(tenantId, orderId)], tenantId);
  return updated;
}

function inferAgentIntent(query) {
  const text = String(query || '');
  if (/下单|点一份|来一份|购买|要一份|帮我点/.test(text)) return 'dish_search';
  if (/订单|取餐|支付|取消|状态|取餐码/.test(text)) return 'order_status';
  if (/营业|收入|销售|热销|看板|售罄统计|售罄数量/.test(text)) return 'operations';
  if (/推荐|怎么吃|吃什么|帮我搭配|套餐|配餐|减脂|增肌|健康档案/.test(text)) return 'meal_recommendation';
  if (/为什么|是什么|怎么判断|营养知识|饮食原则|过敏原知识|摄入建议|健康知识/.test(text)) return 'knowledge_qa';
  if (/找|查|搜索|有没有|哪里|多少钱|价格|库存|可售|菜品|档口|食堂|早餐|午餐|晚餐/.test(text)) return 'dish_search';
  return 'general_canteen';
}

function compactOrder(order) {
  return {
    id: order.id,
    status: order.status,
    paymentStatus: order.paymentStatus,
    pickupCode: order.pickupCode,
    totalAmount: order.totalAmount,
    items: order.items.map((item) => ({ dishId: item.dishId, dishName: item.dishName, quantity: item.quantity }))
  };
}

async function ensureAgentSession(db, user, sessionId, query) {
  const tenantId = tenantIdFor(user);
  const existing = sessionId ? await db.prepare('SELECT * FROM agent_sessions WHERE tenant_id = ? AND user_id = ? AND id = ?').get(tenantId, user.id, sessionId) : null;
  if (existing) return existing;
  const id = sessionId && /^agent-session-[a-zA-Z0-9-]+$/.test(sessionId) ? sessionId : `agent-session-${randomUUID()}`;
  const timestamp = now();
  await db.prepare('INSERT INTO agent_sessions (id, tenant_id, user_id, title, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, tenantId, user.id, String(query || '智能体会话').slice(0, 40), '', timestamp, timestamp);
  return await db.prepare('SELECT * FROM agent_sessions WHERE tenant_id = ? AND id = ?').get(tenantId, id);
}

async function appendAgentMessage(db, user, sessionId, role, content, metadata = {}) {
  const timestamp = now();
  await db.prepare('INSERT INTO agent_messages (id, tenant_id, session_id, user_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(`agent-message-${randomUUID()}`, tenantIdFor(user), sessionId, user.id, role, String(content || '').slice(0, 4000), serializeJson(metadata), timestamp);
  await db.prepare('UPDATE agent_sessions SET summary = ?, updated_at = ? WHERE tenant_id = ? AND id = ?')
    .run(String(content || '').slice(0, 180), timestamp, tenantIdFor(user), sessionId);
}

async function recentAgentMessages(db, user, sessionId) {
  return await db.prepare('SELECT role, content, metadata_json, created_at FROM agent_messages WHERE tenant_id = ? AND user_id = ? AND session_id = ? ORDER BY created_at DESC LIMIT 6')
    .all(tenantIdFor(user), user.id, sessionId);
}

function inferCreateOrderItems(query, dishes) {
  if (!/下单|点一份|来一份|购买|要一份|帮我点/.test(String(query || ''))) return [];
  const text = String(query || '');
  const explicit = dishes.filter((dish) => dish.availability?.orderable === true && dish.name && text.includes(dish.name));
  return explicit.slice(0, 3).map((dish) => ({ dishId: dish.id, quantity: 1 }));
}

const AGENT_OPERATION_ROLES = ['admin', 'super_admin', 'tenant_admin', 'canteen_admin', 'stall_admin', 'operator', 'finance', 'auditor'];

function agentToolRegistry() {
  return {
    'session.load': { name: 'session.load', title: '加载会话记忆', category: 'memory', riskLevel: 'low', permission: 'agent:use', requiresConfirmation: false, parameters: { type: 'object', properties: { sessionId: { type: 'string' } } } },
    'memory.long_term': { name: 'memory.long_term', title: '读取长期偏好记忆', category: 'memory', riskLevel: 'low', permission: 'agent:use', requiresConfirmation: false, parameters: { type: 'object', properties: {} } },
    'profile.load': { name: 'profile.load', title: '读取用户营养档案', category: 'context', riskLevel: 'low', permission: 'agent:use', requiresConfirmation: false, parameters: { type: 'object', properties: {} } },
    'menu.today': { name: 'menu.today', title: '读取今日已发布菜单', category: 'canteen', riskLevel: 'low', permission: 'agent:use', requiresConfirmation: false, parameters: { type: 'object', properties: { mealType: { type: 'string' }, date: { type: 'string' } } } },
    'dish.search': { name: 'dish.search', title: '查询真实菜品与实时供应', category: 'retrieval', riskLevel: 'low', permission: 'agent:use', requiresConfirmation: false, parameters: { type: 'object', properties: { query: { type: 'string' }, filters: { type: 'object' }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['query'] } },
    'meal.recommend': { name: 'meal.recommend', title: '根据档案和实时菜单生成推荐', category: 'recommendation', riskLevel: 'low', permission: 'agent:use', requiresConfirmation: false, parameters: { type: 'object', properties: { query: { type: 'string' }, profileOverride: { type: 'object' }, options: { type: 'object' } }, required: ['query'] } },
    'knowledge.search': { name: 'knowledge.search', title: '检索健康与饮食知识', category: 'knowledge', riskLevel: 'low', permission: 'agent:use', requiresConfirmation: false, parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['query'] } },
    'rag.meal_advisor': { name: 'rag.meal_advisor', title: '兼容旧版膳食顾问工具', category: 'compatibility', riskLevel: 'low', permission: 'agent:use', requiresConfirmation: false, parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    'orders.mine': { name: 'orders.mine', title: '查询本人订单', category: 'order', riskLevel: 'medium', permission: 'agent:use', requiresConfirmation: false, parameters: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 20 } } } },
    'orders.analytics': { name: 'orders.analytics', title: '查询营业分析', category: 'analytics', riskLevel: 'medium', permission: 'agent:use', requiresConfirmation: false, roles: AGENT_OPERATION_ROLES, parameters: { type: 'object', properties: { date: { type: 'string' } } } },
    'order.create.propose': { name: 'order.create.propose', title: '生成待确认下单动作', category: 'action', riskLevel: 'high', permission: 'agent:use', requiresConfirmation: true, actionType: 'create_order', parameters: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { dishId: { type: 'string' }, quantity: { type: 'integer', minimum: 1 } }, required: ['dishId', 'quantity'] } } }, required: ['items'] } },
    'session.save': { name: 'session.save', title: '保存会话结果', category: 'memory', riskLevel: 'low', permission: 'agent:use', requiresConfirmation: false, parameters: { type: 'object', properties: {} } }
  };
}

function agentToolCatalog() {
  return Object.values(agentToolRegistry()).map(({ name, title, category, riskLevel, requiresConfirmation, actionType, parameters }) => ({ name, title, category, riskLevel, requiresConfirmation, actionType, parameters }));
}

function agentToolFunctions(user = null) {
  return Object.values(agentToolRegistry()).map((tool) => ({
    name: tool.name,
    title: tool.title,
    category: tool.category,
    riskLevel: tool.riskLevel,
    requiresConfirmation: tool.requiresConfirmation,
    actionType: tool.actionType,
    parameters: tool.parameters || { type: 'object', properties: {} },
    allowed: !tool.roles || Boolean(user && tool.roles.includes(user.role))
  }));
}

function assertAgentToolAllowed(tool, user) {
  if (tool.roles && !tool.roles.includes(user.role)) throw Object.assign(new Error('当前角色不能使用该智能体工具'), { status: 403 });
}

function sanitizeAgentPayload(value) {
  if (Array.isArray(value)) return value.map(sanitizeAgentPayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/api.?key|secret|token|password|credential/i.test(key)) return [key, '********'];
    return [key, sanitizeAgentPayload(item)];
  }));
}

function hashAgentPayloadJson(payloadJson) {
  return createHash('sha256').update(String(payloadJson || '{}')).digest('hex');
}

function defaultAgentActionExpiry() {
  return new Date(Date.now() + 30 * 60_000).toISOString();
}

function parseJsonList(value) {
  const parsed = Array.isArray(value) ? value : JSON.parse(value || '[]');
  return parsed.map((item) => String(item || '').trim()).filter(Boolean);
}

function rowToAgentEvalCase(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    query: row.query,
    expectedIntent: row.expected_intent,
    requiredTools: parseJsonList(row.required_tools_json),
    forbiddenTools: parseJsonList(row.forbidden_tools_json),
    expectAction: Boolean(row.expect_action),
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function scoreAgentEvalCase(testCase, result) {
  const tools = new Set((result.steps || []).map((step) => step.tool));
  const actions = (result.actions || []).filter((action) => action.requiresConfirmation || action.status === 'pending');
  const checks = [];
  if (testCase.expectedIntent) checks.push({ name: 'intent', passed: result.intent === testCase.expectedIntent, expected: testCase.expectedIntent, actual: result.intent });
  for (const tool of testCase.requiredTools) checks.push({ name: `required:${tool}`, passed: tools.has(tool), expected: true, actual: tools.has(tool) });
  for (const tool of testCase.forbiddenTools) checks.push({ name: `forbidden:${tool}`, passed: !tools.has(tool), expected: false, actual: tools.has(tool) });
  checks.push({ name: 'action', passed: testCase.expectAction ? actions.length > 0 : actions.length === 0, expected: testCase.expectAction, actual: actions.length > 0 });
  const passed = checks.every((check) => check.passed);
  const score = checks.length ? checks.filter((check) => check.passed).length / checks.length : 1;
  return { passed, score, checks };
}

async function selectAgentToolCalls({ query, registry, user }) {
  const tools = agentToolFunctions(user).filter((tool) => tool.allowed);
  try {
    const calls = await generateAgentToolCalls({ query, tools });
    if (!calls?.length) return { mode: 'deterministic', fallbackReason: 'native_tool_calls_unavailable', calls: [] };
    const allowed = [];
    const denied = [];
    for (const call of calls) {
      const tool = registry[call.name];
      if (!tool) denied.push({ ...call, reason: 'unknown_tool' });
      else if (tool.roles && !tool.roles.includes(user.role)) denied.push({ ...call, reason: 'role_denied' });
      else allowed.push(call);
    }
    return { mode: 'native', calls: allowed, denied };
  } catch (error) {
    return { mode: 'deterministic', fallbackReason: error.message, calls: [] };
  }
}

function normalizeAgentMemoryPayload(body = {}, existing = { preferences: {} }) {
  const summary = String(body.summary ?? existing.summary ?? '').trim().slice(0, 500);
  const rawPreferences = body.preferences && typeof body.preferences === 'object' && !Array.isArray(body.preferences) ? body.preferences : existing.preferences || {};
  const preferences = {};
  for (const [key, value] of Object.entries(rawPreferences).slice(0, 20)) {
    if (!/^[\w\u4e00-\u9fa5-]{1,40}$/.test(key)) continue;
    if (['string', 'number', 'boolean'].includes(typeof value)) preferences[key] = typeof value === 'string' ? value.slice(0, 80) : value;
  }
  return { summary, preferences };
}

function agentStep(registry, name, status = 'success', extra = {}) {
  const tool = registry[name];
  if (!tool) throw Object.assign(new Error('智能体工具未注册'), { status: 500 });
  return { tool: name, title: tool.title, category: tool.category, riskLevel: tool.riskLevel, status, ...extra };
}

function agentActionRisk(type) {
  if (type === 'create_order') return { level: 'high', reason: '此操作将创建订单并涉及扣款，需要用户确认' };
  return { level: 'medium', reason: '此操作会修改业务状态，需要用户确认' };
}

function rowToAgentAction(row) {
  const risk = agentActionRisk(row.type);
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    sessionId: row.session_id,
    requiresConfirmation: row.status === 'pending' && row.type === 'create_order',
    riskLevel: risk.level,
    risk,
    payloadHash: row.payload_hash || '',
    expiresAt: row.expires_at || null,
    payload: JSON.parse(row.payload_json || '{}'),
    result: JSON.parse(row.result_json || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function agentPersonasFor(intent, user) {
  const personas = [{ name: 'planner', title: '任务规划员', responsibility: '拆解目标并选择工具' }];
  if (intent === 'dish_search') personas.push({ name: 'dish_retriever', title: '菜品检索员', responsibility: '按数据库真值查询菜品、价格和供应状态' });
  if (intent === 'meal_recommendation') personas.push({ name: 'nutritionist', title: '营养顾问', responsibility: '结合档案、实时菜单和健康证据给出建议' });
  if (intent === 'knowledge_qa') personas.push({ name: 'knowledge_retriever', title: '知识检索员', responsibility: '只基于可引用健康知识回答问题' });
  if (intent === 'order_status') personas.push({ name: 'order_operator', title: '订单专员', responsibility: '只查询当前用户订单并解释状态' });
  if (intent === 'operations' && AGENT_OPERATION_ROLES.includes(user.role)) personas.push({ name: 'ops_analyst', title: '运营分析师', responsibility: '分析订单收入、热销和售罄数据' });
  personas.push({ name: 'safety_reviewer', title: '安全审查员', responsibility: '阻止越权和高风险自动执行' });
  return personas;
}

function inferPreferencePatch(query) {
  const text = String(query || '');
  const patch = {};
  if (/不吃辣|不要辣|少辣/.test(text)) patch.taste = '不辣';
  if (/清真/.test(text)) patch.halalOnly = true;
  if (/减脂|低脂/.test(text)) patch.goal = 'fatLoss';
  if (/增肌|高蛋白/.test(text)) patch.goal = 'muscleGain';
  return patch;
}

async function loadAgentMemory(db, user) {
  const tenantId = tenantIdFor(user);
  const row = await db.prepare('SELECT * FROM agent_memories WHERE tenant_id = ? AND user_id = ?').get(tenantId, user.id);
  if (!row) return { summary: '', preferences: {} };
  return { summary: row.summary, preferences: JSON.parse(row.preferences_json || '{}'), updatedAt: row.updated_at };
}

async function updateAgentMemory(db, user, query) {
  const tenantId = tenantIdFor(user);
  const existing = await loadAgentMemory(db, user);
  const preferences = { ...existing.preferences, ...inferPreferencePatch(query) };
  const summaryParts = [existing.summary, String(query || '').slice(0, 80)].filter(Boolean).slice(-3);
  const summary = summaryParts.join('；').slice(0, 500);
  const timestamp = now();
  const id = `agent-memory-${randomUUID()}`;
  await db.prepare('INSERT INTO agent_memories (id, tenant_id, user_id, summary, preferences_json, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(tenant_id, user_id) DO UPDATE SET summary = excluded.summary, preferences_json = excluded.preferences_json, updated_at = excluded.updated_at')
    .run(id, tenantId, user.id, summary, serializeJson(preferences), timestamp);
  return { summary, preferences, updatedAt: timestamp };
}

function evaluateAgentRun({ steps, actions, citations, plan }) {
  const toolCount = steps.length;
  const succeeded = steps.filter((step) => step.status === 'success').length;
  const unsafeHighRisk = actions.some((action) => action.riskLevel === 'high' && action.requiresConfirmation !== true && action.status === 'pending');
  return {
    groundednessScore: citations.length ? 1 : 0.7,
    toolSuccessRate: toolCount ? succeeded / toolCount : 1,
    safetyScore: unsafeHighRisk ? 0 : 1,
    riskLevel: plan.riskLevel
  };
}

async function recordAgentEvalRun(db, user, sessionId, result, latencyMs) {
  const metrics = evaluateAgentRun({ steps: result.steps, actions: result.actions, citations: result.citations || [], plan: result.plan });
  await db.prepare('INSERT INTO agent_eval_runs (id, tenant_id, user_id, session_id, intent, tool_count, action_count, risk_level, groundedness_score, tool_success_rate, safety_score, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(`agent-eval-${randomUUID()}`, tenantIdFor(user), user.id, sessionId, result.intent, result.steps.length, result.actions.filter((action) => action.requiresConfirmation).length, metrics.riskLevel, metrics.groundednessScore, metrics.toolSuccessRate, metrics.safetyScore, latencyMs, now());
  return metrics;
}

async function agentEvalMetrics(db, user) {
  const tenantId = tenantIdFor(user);
  const row = await db.prepare('SELECT COUNT(*) AS totalRuns, AVG(groundedness_score) AS avgGroundedness, AVG(tool_success_rate) AS avgToolSuccess, AVG(safety_score) AS avgSafety, AVG(latency_ms) AS avgLatencyMs FROM agent_eval_runs WHERE tenant_id = ?').get(tenantId);
  const risks = await db.prepare('SELECT risk_level AS riskLevel, COUNT(*) AS count FROM agent_eval_runs WHERE tenant_id = ? GROUP BY risk_level').all(tenantId);
  return { totalRuns: row.totalRuns || 0, avgGroundedness: Number(row.avgGroundedness || 0), avgToolSuccess: Number(row.avgToolSuccess || 0), avgSafety: Number(row.avgSafety || 0), avgLatencyMs: Number(row.avgLatencyMs || 0), risks };
}

async function createAgentAction(db, user, sessionId, type, payload) {
  const timestamp = now();
  const id = `agent-action-${randomUUID()}`;
  const payloadJson = serializeJson(sanitizeAgentPayload(payload));
  const payloadHash = hashAgentPayloadJson(payloadJson);
  const expiresAt = defaultAgentActionExpiry();
  await db.prepare('INSERT INTO agent_actions (id, tenant_id, session_id, user_id, type, status, payload_json, payload_hash, expires_at, result_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, tenantIdFor(user), sessionId, user.id, type, 'pending', payloadJson, payloadHash, expiresAt, '{}', timestamp, timestamp);
  const result = { id, type, status: 'pending', requiresConfirmation: true, payload: JSON.parse(payloadJson), payloadHash, expiresAt };
  if (type === 'create_order') {
    result.risk = { level: 'high', reason: '此操作将创建订单并涉及扣款，需要用户确认' };
    result.riskLevel = 'high';
  }
  return result;
}

async function runAgentTool(registry, name, user, steps, toolResults, fn) {
  const startedAt = Date.now();
  const tool = registry[name];
  if (!tool) throw Object.assign(new Error('智能体工具未注册'), { status: 500 });
  assertAgentToolAllowed(tool, user);
  try {
    const result = await fn();
    steps.push(agentStep(registry, name, 'success', { latencyMs: Date.now() - startedAt }));
    toolResults[name] = result;
    return result;
  } catch (error) {
    steps.push(agentStep(registry, name, 'error', { error: error.message, latencyMs: Date.now() - startedAt }));
    throw error;
  }
}

async function confirmAgentAction(db, user, actionId) {
  const tenantId = tenantIdFor(user);
  const action = await db.prepare('SELECT * FROM agent_actions WHERE tenant_id = ? AND user_id = ? AND id = ?').get(tenantId, user.id, actionId);
  if (!action) throw Object.assign(new Error('智能体动作不存在'), { status: 404 });
  if (action.status !== 'pending') throw Object.assign(new Error('智能体动作已处理'), { status: 400 });
  if (action.expires_at && Date.parse(action.expires_at) <= Date.now()) {
    const timestamp = now();
    await db.prepare('UPDATE agent_actions SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run('expired', timestamp, tenantId, actionId);
    throw Object.assign(new Error('智能体动作已过期'), { status: 400 });
  }
  const payload = JSON.parse(action.payload_json || '{}');
  const actualHash = hashAgentPayloadJson(serializeJson(payload));
  if (action.payload_hash && action.payload_hash !== actualHash) throw Object.assign(new Error('智能体动作载荷校验失败'), { status: 409 });
  let result;
  if (action.type === 'create_order') {
    const order = await createOrder(db, user, payload);
    result = { order };
  } else {
    throw Object.assign(new Error('不支持的智能体动作'), { status: 400 });
  }
  const timestamp = now();
  await db.prepare('UPDATE agent_actions SET status = ?, result_json = ?, updated_at = ? WHERE tenant_id = ? AND id = ?')
    .run('confirmed', serializeJson(result), timestamp, tenantId, actionId);
  await appendAgentMessage(db, user, action.session_id, 'tool', `confirmed:${action.type}`, { actionId, result });
  return { id: action.id, type: action.type, status: 'confirmed', requiresConfirmation: false, riskLevel: agentActionRisk(action.type).level, payload, payloadHash: action.payload_hash || actualHash, expiresAt: action.expires_at || null, result };
}

async function rejectAgentAction(db, user, actionId) {
  const tenantId = tenantIdFor(user);
  const action = await db.prepare('SELECT * FROM agent_actions WHERE tenant_id = ? AND user_id = ? AND id = ?').get(tenantId, user.id, actionId);
  if (!action) throw Object.assign(new Error('智能体动作不存在'), { status: 404 });
  if (action.status !== 'pending') throw Object.assign(new Error('智能体动作已处理'), { status: 400 });
  const timestamp = now();
  await db.prepare('UPDATE agent_actions SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?')
    .run('rejected', timestamp, tenantId, actionId);
  await appendAgentMessage(db, user, action.session_id, 'tool', `rejected:${action.type}`, { actionId });
  return { id: action.id, type: action.type, status: 'rejected', requiresConfirmation: false, riskLevel: agentActionRisk(action.type).level, payload: JSON.parse(action.payload_json || '{}'), payloadHash: action.payload_hash || '', expiresAt: action.expires_at || null, result: {} };
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function agentSessionEvents(db, user, sessionId) {
  const tenantId = tenantIdFor(user);
  const session = await db.prepare('SELECT * FROM agent_sessions WHERE tenant_id = ? AND user_id = ? AND id = ?').get(tenantId, user.id, sessionId);
  if (!session) throw Object.assign(new Error('智能体会话不存在'), { status: 404 });
  const messages = (await recentAgentMessages(db, user, sessionId)).reverse();
  const actions = await db.prepare('SELECT id, type, status, payload_json, payload_hash, expires_at, result_json, session_id, created_at, updated_at FROM agent_actions WHERE tenant_id = ? AND user_id = ? AND session_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(tenantId, user.id, sessionId);
  const events = [
    ...messages.map((message) => ({ type: `${message.role}_message`, role: message.role, content: message.content, metadata: JSON.parse(message.metadata_json || '{}'), createdAt: message.created_at })),
    ...actions.map((action) => ({ type: 'agent_action', actionType: action.type, status: action.status, actionId: action.id, payloadHash: action.payload_hash || '', expiresAt: action.expires_at || null, payload: JSON.parse(action.payload_json || '{}'), result: JSON.parse(action.result_json || '{}'), createdAt: action.created_at, updatedAt: action.updated_at }))
  ].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  return { session: { id: session.id, title: session.title, summary: session.summary, updatedAt: session.updated_at }, messages, actions: actions.map(rowToAgentAction), events };
}

const AGENT_TOOL_INTENTS = {
  'dish.search': 'dish_search',
  'meal.recommend': 'meal_recommendation',
  'rag.meal_advisor': 'meal_recommendation',
  'knowledge.search': 'knowledge_qa',
  'orders.mine': 'order_status',
  'orders.analytics': 'operations'
};

function routedToolArguments(toolRouting, names) {
  const accepted = Array.isArray(names) ? names : [names];
  return toolRouting.calls?.find((call) => accepted.includes(call.name))?.arguments || {};
}

function resolvedAgentIntent(deterministicIntent, toolRouting, user) {
  if (['order_status', 'operations'].includes(deterministicIntent)) return deterministicIntent;
  const call = toolRouting.calls?.find((item) => AGENT_TOOL_INTENTS[item.name]);
  if (!call) return deterministicIntent;
  const routed = AGENT_TOOL_INTENTS[call.name];
  if (routed === 'operations' && !AGENT_OPERATION_ROLES.includes(user.role)) return deterministicIntent;
  return routed;
}

function buildAgentAnswer({ intent, query, dishSearch, recommendation, knowledge, orders, analytics }) {
  if (intent === 'order_status') {
    if (!orders.length) return '你当前没有订单。可以先到“点餐取餐”页从今日菜单下单，提交后会生成取餐码。';
    const latest = orders[0];
    const dishes = latest.items.map((item) => `${item.dishName}×${item.quantity}`).join('、');
    return `你最近的订单取餐码是 ${latest.pickupCode}，状态为 ${latest.status}，支付状态为 ${latest.paymentStatus}，菜品：${dishes}。如果仍未支付，可在“点餐取餐”页点击模拟支付；未支付且未完成的订单可取消并回滚库存。`;
  }
  if (intent === 'operations' && analytics) {
    const top = analytics.topDishes?.[0];
    return `今日订单 ${analytics.todayOrders} 单，已支付收入 ¥${analytics.todayRevenue.toFixed(2)}。${top ? `当前热销菜品是 ${top.dishName}，销量 ${top.totalQuantity} 份。` : '暂无热销菜品数据。'}售罄菜品 ${analytics.soldOutItems.length} 个。`;
  }
  if (intent === 'operations') return '当前角色不能读取营业分析数据。';
  if (intent === 'dish_search') {
    const names = (dishSearch?.items || []).slice(0, 5).map((item) => `${item.name}${item.availability?.orderable ? '' : '（当前不可点）'}`);
    if (names.length) return `查到 ${dishSearch.page.total} 道匹配菜品：${names.join('、')}。价格和供应状态来自当前菜单与库存。`;
    const relaxation = dishSearch?.suggestedRelaxations?.[0]?.message;
    return relaxation ? `没有找到满足全部条件的菜品。${relaxation}` : '没有找到匹配菜品，系统不会编造结果。';
  }
  if (intent === 'meal_recommendation' && recommendation) return recommendationAnswer(recommendation);
  if (intent === 'knowledge_qa' && knowledge?.answer) return knowledge.answer;
  return `我已根据当前食堂数据处理你的问题：“${String(query).slice(0, 80)}”。你可以询问今日推荐、订单状态、支付、取餐码或营业数据。`;
}

function buildAgentPlan({ intent, steps, user, includeCreateOrder = false }) {
  const goals = { dish_search: '查询真实菜品与供应状态', meal_recommendation: '为用户推荐合适的餐品', knowledge_qa: '检索健康知识并回答', order_status: '查询用户订单状态', operations: '分析食堂运营数据', general_canteen: '回答用户咨询' };
  const riskLevel = includeCreateOrder ? 'high' : (intent === 'operations' || intent === 'order_status' ? 'medium' : 'low');
  const guardrails = ['仅使用当前用户权限内的数据', '高风险动作只生成待确认动作，不直接执行'];
  if (intent === 'operations' && !AGENT_OPERATION_ROLES.includes(user.role)) guardrails.push('当前角色不能读取营业分析工具');
  return {
    goal: goals[intent] || goals.general_canteen,
    intent,
    riskLevel,
    steps: steps.map((step) => ({ tool: step.tool, title: step.title, reason: step.title, required: true, status: step.status })),
    guardrails
  };
}

function summarizeAgentRun({ plan, steps, actions }) {
  const actionCount = actions.filter((action) => action.requiresConfirmation).length;
  return { text: '已完成：' + plan.goal + '；工具 ' + steps.length + ' 步；待确认动作 ' + actionCount + ' 个。', toolCount: steps.length, actionCount, riskLevel: plan.riskLevel };
}

async function runCanteenAgent(db, user, body) {
  const query = String(body.query || body.question || '').trim();
  if (!query) throw Object.assign(new Error('请输入咨询问题'), { status: 400 });
  const tenantId = tenantIdFor(user);
  const session = await ensureAgentSession(db, user, body.sessionId, query);
  const memory = await recentAgentMessages(db, user, session.id);
  const memoryText = memory.map((item) => item.content).join('\n');
  const effectiveQuery = /继续|刚才|这个|那个|一样|它|那/.test(query) && memoryText ? `${memoryText}\n${query}` : query;
  const deterministicIntent = inferAgentIntent(effectiveQuery);
  const steps = [];
  const toolResults = {};
  const registry = agentToolRegistry();
  const toolRouting = await selectAgentToolCalls({ query: effectiveQuery, registry, user });
  const intent = resolvedAgentIntent(deterministicIntent, toolRouting, user);
  steps.push(agentStep(registry, 'session.load', 'success', { latencyMs: 0 }));
  toolResults['session.load'] = { sessionId: session.id, memoryCount: memory.length };
  await appendAgentMessage(db, user, session.id, 'user', query, { intent });
  let longMemory = { summary: '', preferences: {} };
  let dishSearch = null;
  let recommendation = null;
  let knowledge = null;
  let orders = [];
  let analytics = null;

  if (intent === 'order_status') {
    const args = routedToolArguments(toolRouting, 'orders.mine');
    orders = await runAgentTool(registry, 'orders.mine', user, steps, toolResults, async () => (await listOrdersForUser(db, user, args.limit || 5, 0)).map(compactOrder));
  } else if (intent === 'operations' && AGENT_OPERATION_ROLES.includes(user.role)) {
    const args = routedToolArguments(toolRouting, 'orders.analytics');
    analytics = await runAgentTool(registry, 'orders.analytics', user, steps, toolResults, async () => await orderAnalytics(db, tenantId, args.date || now().slice(0, 10)));
  } else if (intent === 'dish_search') {
    const args = routedToolArguments(toolRouting, 'dish.search');
    dishSearch = await runAgentTool(registry, 'dish.search', user, steps, toolResults, async () => executeDishSearch(db, user, {
      query: args.query || effectiveQuery,
      filters: args.filters || {},
      limit: args.limit || 8
    }));
  } else if (intent === 'meal_recommendation') {
    longMemory = await runAgentTool(registry, 'memory.long_term', user, steps, toolResults, async () => await loadAgentMemory(db, user));
    const profile = await runAgentTool(registry, 'profile.load', user, steps, toolResults, async () => {
      const loaded = await getProfile(db, user.id, tenantId);
      return { goal: loaded.goal, mealType: loaded.mealType, taste: loaded.taste, halalOnly: loaded.halalOnly, raw: loaded };
    });
    await runAgentTool(registry, 'menu.today', user, steps, toolResults, async () => {
      const loaded = await todayMenuBundle(db, tenantId, profile.raw.mealType, now().slice(0, 10));
      return { ...loaded, dishCount: loaded.dishes.length };
    });
    const args = routedToolArguments(toolRouting, ['meal.recommend', 'rag.meal_advisor']);
    recommendation = await runAgentTool(registry, 'meal.recommend', user, steps, toolResults, async () => executeMealRecommendation(db, user, {
      query: args.query || effectiveQuery,
      profileOverride: args.profileOverride || {},
      options: args.options || {}
    }));
    toolResults['rag.meal_advisor'] = toolResults['meal.recommend'];
  } else if (intent === 'knowledge_qa') {
    const args = routedToolArguments(toolRouting, 'knowledge.search');
    const search = await runAgentTool(registry, 'knowledge.search', user, steps, toolResults, async () => retrievalIndexQuery(db, user, {
      query: args.query || effectiveQuery,
      tenantId,
      limit: args.limit || 5,
      sourceTypes: ['health_knowledge']
    }));
    knowledge = buildKnowledgeAnswer({ query: effectiveQuery, results: search.items });
    toolResults['knowledge.search'] = { ...search, answer: knowledge.answer };
  }

  const actions = [];
  const orderableCandidates = dishSearch?.items || recommendation?.recommendations || [];
  const orderItems = ['dish_search', 'meal_recommendation'].includes(intent) ? inferCreateOrderItems(effectiveQuery, orderableCandidates) : [];
  if (orderItems.length) {
    actions.push(await createAgentAction(db, user, session.id, 'create_order', { items: orderItems, note: '由智能体建议，用户确认后下单' }));
    steps.push(agentStep(registry, 'order.create.propose', 'success', { latencyMs: 0 }));
    toolResults['order.create.propose'] = { itemCount: orderItems.length };
  }
  if (intent === 'meal_recommendation' || intent === 'dish_search') actions.push({ type: 'navigate', label: '去点餐取餐', to: '/orders' });
  if (intent === 'order_status') actions.push({ type: 'navigate', label: '查看我的订单', to: '/orders' });
  if (intent === 'operations' && analytics) actions.push({ type: 'navigate', label: '查看营业看板', to: '/order-analytics' });

  const answer = buildAgentAnswer({ intent, query: effectiveQuery, dishSearch, recommendation, knowledge, orders, analytics });
  await runAgentTool(registry, 'session.save', user, steps, toolResults, async () => {
    await appendAgentMessage(db, user, session.id, 'assistant', answer, { intent });
    return { sessionId: session.id, saved: true };
  });
  const plan = buildAgentPlan({ intent, steps, user, includeCreateOrder: Boolean(orderItems.length) });
  plan.picks = recommendation?.recommendations || dishSearch?.items || [];
  const evidence = recommendation?.evidence || { dishes: dishSearch ? dishEvidenceFromSearch(dishSearch) : [], knowledge: knowledge?.citations || [] };
  const citations = [...(evidence.dishes || []), ...(evidence.knowledge || [])];
  plan.citations = citations;
  plan.indexVersion = recommendation?.meta?.indexVersion || dishSearch?.meta?.indexVersion || RETRIEVAL_INDEX_VERSION;
  plan.degradedReasons = recommendation?.meta?.degradedReasons || dishSearch?.meta?.degradedReasons || [];
  const summary = summarizeAgentRun({ plan, steps, actions });
  toolResults.profile = toolResults['profile.load'] ? { goal: toolResults['profile.load'].goal, mealType: toolResults['profile.load'].mealType, taste: toolResults['profile.load'].taste, halalOnly: toolResults['profile.load'].halalOnly } : undefined;
  toolResults.todayMenu = toolResults['menu.today'] ? { date: toolResults['menu.today'].date, mealType: toolResults['menu.today'].mealType, source: toolResults['menu.today'].source, dishCount: toolResults['menu.today'].dishCount } : undefined;
  toolResults.recommendation = recommendation ? { source: recommendation.meta.source, citationCount: citations.length, pickCount: recommendation.recommendations.length, orderable: recommendation.meta.orderable } : undefined;
  toolResults.orders = orders;
  toolResults.analytics = analytics;
  toolResults.registry = steps.map((step) => ({ tool: step.tool, title: step.title, category: step.category, riskLevel: step.riskLevel, status: step.status, latencyMs: step.latencyMs }));
  toolResults.catalog = agentToolCatalog();
  toolResults.personas = agentPersonasFor(intent, user);
  toolResults.toolRouting = { ...toolRouting, deterministicIntent, resolvedIntent: intent, executedCalls: steps.map((step) => step.tool) };
  toolResults.functions = agentToolFunctions(user);
  const result = { sessionId: session.id, answer, intent, steps, toolResults, citations, evidence, plan, mealPlan: recommendation?.mealPlan || null, recommendations: recommendation?.recommendations || [], search: dishSearch, summary, actions, memory: longMemory, personas: toolResults.personas };
  const evalMetrics = await recordAgentEvalRun(db, user, session.id, result, steps.reduce((total, step) => total + (step.latencyMs || 0), 0));
  result.eval = evalMetrics;
  if (intent === 'meal_recommendation') result.memory = await updateAgentMemory(db, user, query);
  return result;
}

async function recommendationDishPool(db, tenantId, profile) {
  const normalized = normalizeProfile(profile);
  const bundle = await todayMenuBundle(db, tenantId, normalized.mealType, now().slice(0, 10));
  if (bundle.source === 'menu') {
    const available = bundle.dishes.filter((dish) => dish.supplyStatus !== 'sold_out');
    if (available.length) return { ...bundle, dishes: available };
    return { ...bundle, dishes: await listDishes(db, new URLSearchParams(), tenantId), source: 'fallback' };
  }
  return { ...bundle, dishes: await listDishes(db, new URLSearchParams(), tenantId), source: 'fallback' };
}

async function upsertMenu(db, body, id = body.id || `menu-${randomUUID()}`, tenantId = 'default') {
  requireFields(body, ['canteenId', 'date', 'mealType']);
  await validateMenuOwnership(db, body, tenantId);
  const status = ['draft', 'published', 'archived'].includes(body.status) ? body.status : 'draft';
  return withTransaction(db, async (tx) => {
    await tx.prepare(`INSERT INTO menus (id, tenant_id, canteen_id, date, meal_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET canteen_id=excluded.canteen_id, date=excluded.date, meal_type=excluded.meal_type, status=excluded.status, updated_at=excluded.updated_at`)
      .run(id, tenantId, body.canteenId, String(body.date).trim(), String(body.mealType).trim(), status, now(), now());
    if (Array.isArray(body.items)) {
      await tx.prepare('DELETE FROM menu_items WHERE tenant_id = ? AND menu_id = ?').run(tenantId, id);
      for (const item of body.items) {
        if (!item.dishId) continue;
        const itemId = item.id || `menu-item-${randomUUID()}`;
        await tx.prepare('INSERT INTO menu_items (id, tenant_id, menu_id, dish_id, price, supply_limit, supply_count, sold_out, serving_start, serving_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(itemId, tenantId, id, item.dishId, Number(item.price || 0), Number(item.supplyLimit || 0), Number(item.supplyCount || 0), item.soldOut ? 1 : 0, item.servingStart || '11:00', item.servingEnd || '13:30', now(), now());
      }
    }
    return id;
  });
}

function safeAiSettings(settings = {}) {
  return {
    apiKey: settings.apiKey ? '********' : '',
    baseUrl: settings.baseUrl || 'https://api.openai.com/v1',
    embeddingModel: settings.embeddingModel || 'text-embedding-3-small',
    chatModel: settings.chatModel || 'gpt-4o-mini',
    visionModel: settings.visionModel || settings.chatModel || 'gpt-4o-mini',
    timeoutMs: Number(settings.timeoutMs || 12000)
  };
}

async function getAiSettings(db, user = null) {
  const row = await db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(scopedSettingKey(user, 'ai_provider'));
  const stored = row ? JSON.parse(row.value_json) : {};
  return { ...stored, apiKey: decryptSecret(stored.apiKey) };
}

async function saveAiSettings(db, settings, user = null) {
  const existing = await getAiSettings(db, user);
  const submittedKey = String(settings.apiKey || '').trim();
  const apiKey = submittedKey && submittedKey !== '********' ? submittedKey : existing.apiKey || '';
  const normalized = {
    apiKey,
    baseUrl: String(settings.baseUrl || 'https://api.openai.com/v1').trim().replace(/\/$/, ''),
    embeddingModel: String(settings.embeddingModel || 'text-embedding-3-small').trim(),
    chatModel: String(settings.chatModel || 'gpt-4o-mini').trim(),
    visionModel: String(settings.visionModel || settings.chatModel || 'gpt-4o-mini').trim(),
    timeoutMs: Number(settings.timeoutMs || 12000) || 12000
  };
  const stored = { ...normalized, apiKey: encryptSecret(normalized.apiKey) };
  await db.prepare(`INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`)
    .run(scopedSettingKey(user, 'ai_provider'), serializeJson(stored), now());
  return normalized;
}

async function clearAiSettings(db, user = null) {
  await db.prepare('DELETE FROM app_settings WHERE key = ?').run(scopedSettingKey(user, 'ai_provider'));
}
export function createApp({ db = openDatabase(), cache = createCache() } = {}) {
  async function rankings() {
    const cached = await cache.get(rankingCacheKey);
    if (cached) return cached;
    const value = await computeRankings(db);
    await cache.set(rankingCacheKey, value);
    return value;
  }

  async function invalidateRankings() {
    await cache.del(rankingCacheKey);
  }

  async function handler(req, res) {
    const requestId = requestIdFrom(req);
    try {
      rateLimit(req);
      const url = new URL(req.url, 'http://localhost');
      const method = req.method || 'GET';
      const user = await getUserFromRequest(db, req);
      const aiSettings = await getAiSettings(db, user).catch(() => ({}));
      return await withAiRuntimeConfig(aiSettings, async () => {
        const pathParts = url.pathname.split('/').filter(Boolean);

      if (method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true }, { 'X-Request-Id': requestId });
      if (method === 'GET' && url.pathname === '/api/bootstrap') return send(res, 200, await snapshot(db, user), { 'X-Request-Id': requestId });

      if (method === 'POST' && url.pathname === '/api/auth/register') {
        const body = await readBody(req);
        requireFields(body, ['username', 'password']);
        const username = String(body.username).trim();
        const existing = await db.prepare('SELECT id FROM users WHERE tenant_id = ? AND username = ?').get('default', username);
        if (existing) throw Object.assign(new Error('用户名已存在'), { status: 409 });
        const role = 'student';
        const id = `u-${randomUUID()}`;
        await db.prepare('INSERT INTO users (id, tenant_id, username, password_hash, nickname, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, 'default', username, hashPassword(body.password), body.nickname || username, role, now(), now());
        await db.prepare('INSERT INTO health_profiles (user_id, tenant_id, goal, budget_max, meal_type, taste, halal_only, avoid_json, dietary_pattern, spice_level, nutrition_focus_json, prefer_low_crowd, favorite_tags_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, 'default', 'healthy', 20, 'lunch', '不限', 0, '[]', 'balanced', 3, '[]', 0, '[]', now());
        const created = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        return send(res, 201, { user: publicUser(created), token: createToken(created), state: await snapshot(db, created) });
      }

      if (method === 'POST' && url.pathname === '/api/auth/login') {
        const body = await readBody(req);
        requireFields(body, ['username', 'password']);
        const username = String(body.username).trim();
        assertLoginAllowed(username, req);
        const found = await db.prepare('SELECT * FROM users WHERE tenant_id = ? AND username = ?').get('default', username);
        if (!found || !verifyPassword(body.password, found.password_hash)) {
          recordLoginFailure(username, req);
          throw Object.assign(new Error('用户名或密码错误'), { status: 401 });
        }
        clearLoginFailures(username, req);
        return send(res, 200, { user: publicUser(found), token: createToken(found), state: await snapshot(db, found) });
      }

      if (method === 'POST' && url.pathname === '/api/auth/wechat-login') {
        const body = await readBody(req);
        requireFields(body, ['code']);
        const session = await exchangeWechatCode(String(body.code).trim());
        const found = await findOrCreateWechatUser(db, session, body.profile || {});
        return send(res, 200, { user: publicUser(found), token: createToken(found), state: await snapshot(db, found) });
      }

      if (method === 'GET' && url.pathname === '/api/canteens') return send(res, 200, await listCanteens(db, tenantIdFor(user)));
      if (method === 'GET' && url.pathname === '/api/stalls') return send(res, 200, await listStalls(db, tenantIdFor(user)));
      if (method === 'POST' && url.pathname === '/api/dishes/search') {
        const result = await executeDishSearch(db, user, await readBody(req));
        return send(res, 200, result);
      }
      if (method === 'GET' && url.pathname === '/api/dishes') return send(res, 200, await executeLegacyDishList(db, user, url.searchParams));
      if (method === 'GET' && url.pathname.startsWith('/api/dishes/')) {
        const detail = await dishDetail(db, decodeURIComponent(url.pathname.split('/').pop()), tenantIdFor(user));
        if (!detail) throw Object.assign(new Error('菜品不存在'), { status: 404 });
        return send(res, 200, detail);
      }
      if (method === 'GET' && url.pathname === '/api/rankings') return send(res, 200, await rankings());
      if (method === 'GET' && url.pathname === '/api/menus/today') {
        const activeUser = user || null;
        const tenantId = tenantIdFor(activeUser);
        const mealType = String(url.searchParams.get('mealType') || (activeUser ? (await getProfile(db, activeUser.id, tenantId)).mealType : 'lunch'));
        const date = String(url.searchParams.get('date') || now().slice(0, 10));
        return send(res, 200, await todayMenuBundle(db, tenantId, mealType, date));
      }
      if (method === 'GET' && url.pathname === '/api/recommend') {
        const activeUser = user || null;
        const result = await executeMealRecommendation(db, activeUser, {
          query: '',
          profileOverride: url.searchParams.get('mealType') ? { mealType: url.searchParams.get('mealType') } : {},
          options: { mode: 'alternatives', limit: 10 }
        });
        return send(res, 200, compatibleRecommendationResponse(result));
      }
      if (method === 'POST' && url.pathname === '/api/recommend') {
        const result = await executeMealRecommendation(db, user || null, await readBody(req));
        return send(res, 200, result);
      }
      if (method === 'POST' && url.pathname === '/api/recommend/plan') {
        const activeUser = await requireUser(db, req);
        const tenantId = tenantIdFor(activeUser);
        const body = await readBody(req);
        const days = Number(body.days || 1);
        if (![1, 3, 7].includes(days)) throw Object.assign(new Error('规划天数仅支持 1、3 或 7 天'), { status: 400 });
        const profile = await getProfile(db, activeUser.id, tenantId);
        const dishes = await listDishes(db, new URLSearchParams(), tenantId);
        return send(res, 200, buildHealthPlan(dishes.filter((dish) => dish.status !== 'archived'), profile, days));
      }

      if (method === 'POST' && url.pathname === '/api/orders') {
        const activeUser = await requireUser(db, req);
        const order = await createOrder(db, activeUser, await readBody(req));
        await audit(db, activeUser, 'CREATE', 'order', order.id);
        return send(res, 201, { order });
      }

      if (method === 'GET' && url.pathname === '/api/orders') {
        const activeUser = await requireUser(db, req);
        return send(res, 200, { orders: await listOrdersForUser(db, activeUser, url.searchParams.get('limit'), url.searchParams.get('offset')) });
      }

      if (method === 'GET' && url.pathname === '/api/admin/orders') {
        const activeUser = await requireCapability(db, req, 'dish:write');
        return send(res, 200, { orders: await listTenantOrders(db, tenantIdFor(activeUser), { status: url.searchParams.get('status') || '', limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset') }) });
      }

      if (method === 'PATCH' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'orders' && pathParts[3] && pathParts[4] === 'status') {
        const activeUser = await requireCapability(db, req, 'dish:write');
        const order = await updateOrderStatus(db, activeUser, decodeURIComponent(pathParts[3]), String((await readBody(req)).status || '').trim());
        await audit(db, activeUser, 'UPDATE_STATUS', 'order', order.id);
        return send(res, 200, { order });
      }

      if (method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'orders' && pathParts[2] && pathParts[3] === 'pay') {
        const activeUser = await requireUser(db, req);
        const order = await payOrder(db, activeUser, decodeURIComponent(pathParts[2]), await readBody(req));
        await audit(db, activeUser, 'PAY', 'order', order.id);
        return send(res, 200, { order });
      }

      if (method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'orders' && pathParts[2] && pathParts[3] === 'cancel') {
        const activeUser = await requireUser(db, req);
        const order = await cancelOrder(db, activeUser, decodeURIComponent(pathParts[2]));
        await audit(db, activeUser, 'CANCEL', 'order', order.id);
        return send(res, 200, { order });
      }

      if (method === 'GET' && url.pathname === '/api/admin/order-analytics') {
        const activeUser = await requireCapability(db, req, 'dish:write');
        return send(res, 200, await orderAnalytics(db, tenantIdFor(activeUser), url.searchParams.get('date') || now().slice(0, 10)));
      }

      if (method === 'GET' && url.pathname === '/api/rag/search') {
        const query = String(url.searchParams.get('q') || '').trim();
        if (!query) throw Object.assign(new Error('请输入检索问题'), { status: 400 });
        const result = await executeDishSearch(db, user, { query, limit: Number(url.searchParams.get('limit') || 8) });
        return send(res, 200, { ...result, results: dishEvidenceFromSearch(result) });
      }

      if (method === 'POST' && url.pathname === '/api/agent/assistant') {
        const activeUser = await requireCapability(db, req, 'agent:use');
        const startedAt = Date.now();
        const status = getAiProviderStatus();
        const body = await readBody(req);
        await assertAiQuota(db, activeUser);
        try {
          const result = await runCanteenAgent(db, activeUser, body);
          await recordAiUsage(db, activeUser, { feature: 'canteen-agent', provider: status.source, model: status.chatModel, status: 'success', inputTokens: estimateTokens(body.query || body.question), outputTokens: estimateTokens(result.answer), latencyMs: Date.now() - startedAt });
          return send(res, 200, result);
        } catch (error) {
          await recordAiUsage(db, activeUser, { feature: 'canteen-agent', provider: status.source, model: status.chatModel, status: 'failure', inputTokens: estimateTokens(body.query || body.question), latencyMs: Date.now() - startedAt, error: error.message });
          throw error;
        }
      }

      if (method === 'POST' && url.pathname === '/api/agent/stream-run') {
        const activeUser = await requireCapability(db, req, 'agent:use');
        const startedAt = Date.now();
        const status = getAiProviderStatus();
        const body = await readBody(req);
        await assertAiQuota(db, activeUser);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Request-Id': requestId,
        });
        writeSse(res, 'agent.run.started', { query: body.query || body.question || '', at: now() });
        try {
          const result = await runCanteenAgent(db, activeUser, body);
          writeSse(res, 'agent.plan', result.plan);
          for (const step of result.steps) writeSse(res, step.status === 'error' ? 'agent.tool.error' : 'agent.tool.finished', step);
          for (const action of result.actions.filter((item) => item.requiresConfirmation)) writeSse(res, 'agent.action_required', action);
          writeSse(res, 'agent.summary', result.summary);
          writeSse(res, 'agent.eval', result.eval);
          writeSse(res, 'agent.done', { sessionId: result.sessionId, answer: result.answer });
          await recordAiUsage(db, activeUser, { feature: 'canteen-agent-stream', provider: status.source, model: status.chatModel, status: 'success', inputTokens: estimateTokens(body.query || body.question), outputTokens: estimateTokens(result.answer), latencyMs: Date.now() - startedAt });
        } catch (error) {
          writeSse(res, 'agent.error', { message: error.message });
          await recordAiUsage(db, activeUser, { feature: 'canteen-agent-stream', provider: status.source, model: status.chatModel, status: 'failure', inputTokens: estimateTokens(body.query || body.question), latencyMs: Date.now() - startedAt, error: error.message });
        }
        res.end();
        return;
      }

      if (method === 'GET' && url.pathname === '/api/agent/evals') {
        const activeUser = await requireCapability(db, req, 'agent:use');
        if (!AGENT_OPERATION_ROLES.includes(activeUser.role)) throw Object.assign(new Error('当前角色不能查看智能体评测'), { status: 403 });
        const tenantId = tenantIdFor(activeUser);
        const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);
        const rows = await db.prepare('SELECT id, session_id, intent, tool_count, action_count, risk_level, groundedness_score, tool_success_rate, safety_score, latency_ms, created_at FROM agent_eval_runs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?').all(tenantId, limit);
        return send(res, 200, { metrics: await agentEvalMetrics(db, activeUser), runs: rows.map((row) => ({ id: row.id, sessionId: row.session_id, intent: row.intent, toolCount: row.tool_count, actionCount: row.action_count, riskLevel: row.risk_level, groundednessScore: row.groundedness_score, toolSuccessRate: row.tool_success_rate, safetyScore: row.safety_score, latencyMs: row.latency_ms, createdAt: row.created_at })) });
      }

      if (method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'agent' && pathParts[2] === 'actions' && pathParts[3] && pathParts[4] === 'confirm') {
        const activeUser = await requireCapability(db, req, 'agent:use');
        const action = await confirmAgentAction(db, activeUser, decodeURIComponent(pathParts[3]));
        await audit(db, activeUser, 'CONFIRM_ACTION', 'agent_action', action.id);
        return send(res, 200, { action });
      }

      if (method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'agent' && pathParts[2] === 'actions' && pathParts[3] && pathParts[4] === 'reject') {
        const activeUser = await requireCapability(db, req, 'agent:use');
        const action = await rejectAgentAction(db, activeUser, decodeURIComponent(pathParts[3]));
        await audit(db, activeUser, 'REJECT_ACTION', 'agent_action', action.id);
        return send(res, 200, { action });
      }

      if (method === 'GET' && url.pathname === '/api/agent/events') {
        const activeUser = await requireCapability(db, req, 'agent:use');
        const sessionId = String(url.searchParams.get('sessionId') || '').trim();
        if (!sessionId) throw Object.assign(new Error('缺少 sessionId'), { status: 400 });
        return send(res, 200, await agentSessionEvents(db, activeUser, sessionId));
      }

      if (method === 'POST' && url.pathname === '/api/agent/meal-advisor') {
        const activeUser = user || null;
        const startedAt = Date.now();
        const body = await readBody(req);
        const query = body.query || body.question;
        if (!String(query || '').trim()) throw Object.assign(new Error('请输入咨询问题'), { status: 400 });
        const status = getAiProviderStatus();
        const quota = await aiQuotaStatus(db, tenantIdFor(activeUser));
        const quotaExhausted = quota.quota > 0 && quota.remaining <= 0;
        try {
          const result = await executeMealRecommendation(db, activeUser, body);
          const response = compatibleRecommendationResponse(result);
          response.answer = recommendationAnswer(result);
          response.answerSource = result.meta.semanticUsed ? 'hybrid_retrieval' : 'deterministic';
          response.citations = result.evidence.dishes.map((citation) => ({
            ...citation,
            id: citation.sourceId,
            name: citation.title,
            content: citation.snippet
          }));
          if (!quotaExhausted) {
            await recordAiUsage(db, activeUser, { feature: 'meal-advisor', provider: status.source, model: status.embeddingModel, status: 'success', inputTokens: estimateTokens(query), outputTokens: 0, latencyMs: Date.now() - startedAt });
          }
          return send(res, 200, response);
        } catch (error) {
          await recordAiUsage(db, activeUser, { feature: 'meal-advisor', provider: status.source, model: status.chatModel, status: 'failure', inputTokens: estimateTokens(query), latencyMs: Date.now() - startedAt, error: error.message });
          throw error;
        }
      }

      if (method === 'POST' && url.pathname === '/api/vision/meal-analyze') {
        const activeUser = await requireCapability(db, req, 'agent:use');
        await getAiSettings(db, activeUser);
        await assertAiQuota(db, activeUser);
        const startedAt = Date.now();
        const status = getAiProviderStatus();
        try {
          const tenantId = tenantIdFor(activeUser);
          const suggestion = await identifyDishFromImage({ ...(await readBody(req, MAX_IMAGE_BODY_BYTES)), purpose: 'student' });
          const profile = await getProfile(db, activeUser.id, tenantId);
          const pool = await recommendationDishPool(db, tenantId, profile);
          const analysis = buildStudentMealAnalysis({ suggestion, dishes: pool.dishes, stalls: await listStalls(db, tenantId), canteens: await listCanteens(db, tenantId), profile, menuSource: pool.source });
          await audit(db, activeUser, 'VISION_ANALYZE', 'meal', suggestion.name || 'pending');
          await recordAiUsage(db, activeUser, { feature: 'student-vision', provider: status.source, model: status.visionModel, status: 'success', imageCount: 1, outputTokens: estimateTokens(JSON.stringify(suggestion)), latencyMs: Date.now() - startedAt });
          return send(res, 200, analysis);
        } catch (error) {
          await recordAiUsage(db, activeUser, { feature: 'student-vision', provider: status.source, model: status.visionModel, status: 'failure', imageCount: 1, latencyMs: Date.now() - startedAt, error: error.message });
          throw error;
        }
      }

      if (method === 'POST' && url.pathname === '/api/uploads') {
        const activeUser = await requireCapability(db, req, 'upload:create');
        const upload = await storeUpload({ ...(await readBody(req)), tenantId: tenantIdFor(activeUser) });
        await db.prepare('INSERT INTO uploads (id, tenant_id, owner_id, filename, content_type, size_bytes, storage_key, public_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(upload.id, tenantIdFor(activeUser), activeUser.id, upload.filename, upload.contentType, upload.sizeBytes, upload.storageKey, upload.url, now());
        await audit(db, activeUser, 'CREATE', 'upload', upload.id);
        return send(res, 201, upload);
      }

      if (method === 'POST' && url.pathname === '/api/admin/dishes/import/preview') {
        const activeUser = await requireCapability(db, req, 'dish:bulk_import');
        const preview = parseCsvImport((await readBody(req, MAX_IMPORT_BODY_BYTES)).csvText);
        await validateImportHierarchy(db, preview, tenantIdFor(activeUser));
        return send(res, 200, preview);
      }

      if (method === 'POST' && url.pathname === '/api/admin/dishes/import/confirm') {
        const activeUser = await requireCapability(db, req, 'dish:bulk_import');
        const preview = parseCsvImport((await readBody(req, MAX_IMPORT_BODY_BYTES)).csvText);
        const tenantId = tenantIdFor(activeUser);
        await validateImportHierarchy(db, preview, tenantId);
        if (preview.errorCount) throw Object.assign(new Error('导入文件存在校验错误，请先修正后再确认导入'), { status: 400 });
        const imported = await withTransaction(db, async (tx) => {
          const ids = [];
          for (const row of preview.rows) ids.push(await upsertDish(tx, row.dish, row.dish.id, tenantId));
          await audit(tx, activeUser, 'CSV_IMPORT', 'dish', `${ids.length}`);
          return ids;
        });
        await invalidateRankings();
        return send(res, 200, { imported: imported.length, rows: preview.rows, state: await snapshot(db, activeUser) });
      }

      if (method === 'GET' && url.pathname === '/api/reviews') {
        const activeUser = await requireUser(db, req);
        const tenantId = tenantIdFor(activeUser);
        const rows = await db.prepare("SELECT reviews.*, users.nickname, users.username FROM reviews JOIN users ON users.id = reviews.user_id WHERE reviews.tenant_id = ? AND reviews.status = 'approved'").all(tenantId);
        const catalog = await reviewCatalog(db, tenantId);
        const targetType = String(url.searchParams.get('targetType') || '').trim();
        const canteenId = String(url.searchParams.get('canteenId') || '').trim();
        const stallId = String(url.searchParams.get('stallId') || '').trim();
        const dishId = String(url.searchParams.get('dishId') || '').trim();
        const sort = String(url.searchParams.get('sort') || 'rating_desc');
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 30, 1), 100);
        const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
        if (targetType && !['dish', 'canteen'].includes(targetType)) throw Object.assign(new Error('targetType 必须是 dish 或 canteen'), { status: 400 });
        if (!['rating_desc', 'rating_asc', 'latest'].includes(sort)) throw Object.assign(new Error('不支持的评价排序方式'), { status: 400 });
        const filtered = rows.map(rowToReview).map((review) => enrichReview(review, catalog)).filter((review) => {
          if (targetType && review.targetType !== targetType) return false;
          if (canteenId && review.canteen?.id !== canteenId) return false;
          if (stallId && review.stall?.id !== stallId) return false;
          if (dishId && review.dish?.id !== dishId) return false;
          return true;
        });
        filtered.sort((left, right) => {
          if (sort === 'latest') return String(right.createdAt).localeCompare(String(left.createdAt));
          const ratingOrder = sort === 'rating_asc' ? left.rating - right.rating : right.rating - left.rating;
          return ratingOrder || String(right.createdAt).localeCompare(String(left.createdAt));
        });
        const total = filtered.length;
        const averageRating = total ? filtered.reduce((sum, review) => sum + Number(review.rating || 0), 0) / total : 0;
        return send(res, 200, {
          reviews: filtered.slice(offset, offset + limit),
          total,
          summary: {
            averageRating: Number(averageRating.toFixed(1)),
            dishReviews: filtered.filter((review) => review.targetType === 'dish').length,
            canteenReviews: filtered.filter((review) => review.targetType === 'canteen').length
          }
        });
      }

      if (method === 'POST' && url.pathname === '/api/reviews') {
        const activeUser = await requireUser(db, req);
        const body = await readBody(req);
        requireFields(body, ['targetId', 'rating', 'content']);
        const targetType = body.targetType === 'canteen' ? 'canteen' : 'dish';
        const targetTable = targetType === 'canteen' ? 'canteens' : 'dishes';
        const target = await db.prepare(`SELECT id FROM ${targetTable} WHERE id = ? AND tenant_id = ?`).get(body.targetId, tenantIdFor(activeUser));
        if (!target) throw Object.assign(new Error(targetType === 'canteen' ? '食堂不存在。' : '菜品不存在。'), { status: 404 });
        const rating = Number(body.rating);
        const content = String(body.content).trim();
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw Object.assign(new Error('评分需要在 1-5 分之间。'), { status: 400 });
        if (content.length < 2 || content.length > 240) throw Object.assign(new Error('评价内容长度需要在 2-240 个字符之间。'), { status: 400 });
        const id = `r-${randomUUID()}`;
        await db.prepare('INSERT INTO reviews (id, tenant_id, user_id, target_type, target_id, rating, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, tenantIdFor(activeUser), activeUser.id, targetType, body.targetId, rating, content, 'pending', now().slice(0, 10));
        await audit(db, activeUser, 'CREATE', 'review', id);
        await invalidateRankings();
        if (targetType === 'dish') return send(res, 201, await dishDetail(db, body.targetId, tenantIdFor(activeUser)));
        return send(res, 201, { review: { id, targetType, targetId: body.targetId, user: activeUser.nickname, rating, content, createdAt: now().slice(0, 10) } });
      }

      if (method === 'GET' && url.pathname === '/api/posts') {
        const activeUser = await requireUser(db, req);
        const tenantId = tenantIdFor(activeUser);
        const rows = await db.prepare("SELECT campus_posts.*, users.nickname, users.username FROM campus_posts JOIN users ON users.id = campus_posts.user_id WHERE campus_posts.tenant_id = ? AND (campus_posts.status = 'approved' OR campus_posts.user_id = ?) ORDER BY campus_posts.created_at DESC").all(tenantId, activeUser.id);
        const catalog = await reviewCatalog(db, tenantId);
        const targetType = String(url.searchParams.get('targetType') || '').trim();
        const canteenId = String(url.searchParams.get('canteenId') || '').trim();
        const dishId = String(url.searchParams.get('dishId') || '').trim();
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 30, 1), 100);
        const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
        const posts = rows.map(rowToPost).map((post) => enrichPost(post, catalog, activeUser.id)).filter((post) => {
          if (targetType && post.targetType !== targetType) return false;
          if (canteenId && post.canteen?.id !== canteenId) return false;
          if (dishId && post.dish?.id !== dishId) return false;
          return true;
        });
        return send(res, 200, { posts: posts.slice(offset, offset + limit), total: posts.length });
      }

      if (method === 'POST' && url.pathname === '/api/posts') {
        const activeUser = await requireCapability(db, req, 'post:create');
        const tenantId = tenantIdFor(activeUser);
        const body = await readBody(req);
        const targetType = body.targetType === 'canteen' ? 'canteen' : body.targetType === 'dish' ? 'dish' : '';
        const targetId = String(body.targetId || '').trim();
        const content = String(body.content || '').trim();
        if (!targetType || !targetId) throw Object.assign(new Error('请选择帖子关联的食堂或菜品'), { status: 400 });
        if (content.length < 2 || content.length > 600) throw Object.assign(new Error('帖子内容长度需要在 2-600 个字符之间'), { status: 400 });
        const targetTable = targetType === 'dish' ? 'dishes' : 'canteens';
        const target = await db.prepare(`SELECT id FROM ${targetTable} WHERE tenant_id = ? AND id = ?`).get(tenantId, targetId);
        if (!target) throw Object.assign(new Error(targetType === 'dish' ? '关联菜品不存在' : '关联食堂不存在'), { status: 404 });
        let rating = null;
        if (body.rating != null && body.rating !== '') {
          rating = Number(body.rating);
          if (targetType !== 'dish') throw Object.assign(new Error('只有菜品帖子可以填写评分'), { status: 400 });
          if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw Object.assign(new Error('评分需要在 1-5 分之间'), { status: 400 });
        }
        const imageUrl = String(body.imageUrl || '').trim();
        if (imageUrl) {
          const upload = await db.prepare('SELECT id FROM uploads WHERE tenant_id = ? AND owner_id = ? AND public_url = ?').get(tenantId, activeUser.id, imageUrl);
          if (!upload) throw Object.assign(new Error('帖子图片必须使用当前账号上传的图片'), { status: 400 });
        }
        const timestamp = now();
        const id = `post-${randomUUID()}`;
        await db.prepare('INSERT INTO campus_posts (id, tenant_id, user_id, target_type, target_id, content, image_url, rating, status, linked_review_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, tenantId, activeUser.id, targetType, targetId, content, imageUrl || null, rating, 'pending', null, timestamp, timestamp);
        await audit(db, activeUser, 'CREATE', 'campus_post', id);
        const catalog = await reviewCatalog(db, tenantId);
        const created = rowToPost(await db.prepare('SELECT campus_posts.*, users.nickname, users.username FROM campus_posts JOIN users ON users.id = campus_posts.user_id WHERE campus_posts.tenant_id = ? AND campus_posts.id = ?').get(tenantId, id));
        return send(res, 201, { post: enrichPost(created, catalog, activeUser.id) });
      }

      if ((method === 'POST' || method === 'PUT') && url.pathname === '/api/health/profile') {
        const activeUser = await requireUser(db, req);
        const profile = normalizeProfile(await readBody(req));
        await db.prepare(`INSERT INTO health_profiles (user_id, tenant_id, goal, budget_max, meal_type, taste, halal_only, avoid_json, dietary_pattern, spice_level, nutrition_focus_json, prefer_low_crowd, favorite_tags_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET tenant_id=excluded.tenant_id, goal=excluded.goal, budget_max=excluded.budget_max, meal_type=excluded.meal_type, taste=excluded.taste, halal_only=excluded.halal_only, avoid_json=excluded.avoid_json, dietary_pattern=excluded.dietary_pattern, spice_level=excluded.spice_level, nutrition_focus_json=excluded.nutrition_focus_json, prefer_low_crowd=excluded.prefer_low_crowd, favorite_tags_json=excluded.favorite_tags_json, updated_at=excluded.updated_at`)
          .run(activeUser.id, tenantIdFor(activeUser), profile.goal, profile.budgetMax, profile.mealType, profile.taste, profile.halalOnly ? 1 : 0, serializeJson(profile.avoid), profile.dietaryPattern, profile.spiceLevel, serializeJson(profile.nutritionFocus), profile.preferLowCrowd ? 1 : 0, serializeJson(profile.favoriteTags), now());
        await db.prepare('UPDATE health_profiles SET allergies_json = ? WHERE tenant_id = ? AND user_id = ?')
          .run(serializeJson(profile.allergies), tenantIdFor(activeUser), activeUser.id);
        await audit(db, activeUser, 'UPSERT', 'health_profile', activeUser.id);
        const recommendation = compatibleRecommendationResponse(await executeMealRecommendation(db, activeUser, { query: '', options: { mode: 'alternatives', limit: 3 } }));
        return send(res, 200, { profile, recommendation, state: await snapshot(db, activeUser) });
      }

      if (method === 'POST' && url.pathname === '/api/admin/canteens') {
        const activeUser = await requireCapability(db, req, 'canteen:write');
        const id = await upsertCanteen(db, await readBody(req), undefined, tenantIdFor(activeUser));
        await audit(db, activeUser, 'UPSERT', 'canteen', id);
        return send(res, 201, { ...(await snapshot(db, activeUser)), savedId: id });
      }

      if ((method === 'PUT' || method === 'DELETE') && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'canteens' && pathParts[3]) {
        const permission = method === 'DELETE' ? 'canteen:delete' : 'canteen:write';
        const activeUser = await requireCapability(db, req, permission);
        const id = decodeURIComponent(pathParts[3]);
        const existing = await db.prepare('SELECT id FROM canteens WHERE tenant_id = ? AND id = ?').get(tenantIdFor(activeUser), id);
        const isFixedVenue = isAdminCatalogVenueId(id);
        if (!existing && (method === 'DELETE' || !isFixedVenue)) throw Object.assign(new Error('食堂不存在'), { status: 404 });
        if (method === 'DELETE') {
          if (isFixedVenue) {
            const areaCount = Number((await db.prepare('SELECT COUNT(*) AS count FROM canteens WHERE tenant_id = ? AND parent_id = ?').get(tenantIdFor(activeUser), id))?.count || 0);
            if (areaCount > 0) {
              throw Object.assign(new Error('该餐饮场所仍包含餐厅或楼层餐区，请先迁移或删除这些餐饮分区'), {
                status: 409,
                code: 'CANTEEN_HAS_AREAS'
              });
            }
          }
          await db.prepare('DELETE FROM canteens WHERE tenant_id = ? AND id = ?').run(tenantIdFor(activeUser), id);
          await audit(db, activeUser, 'DELETE', 'canteen', id);
          await invalidateRankings();
          return send(res, 200, await snapshot(db, activeUser));
        }
        await upsertCanteen(db, await readBody(req), id, tenantIdFor(activeUser));
        await audit(db, activeUser, 'UPDATE', 'canteen', id);
        await invalidateRankings();
        return send(res, 200, { ...(await snapshot(db, activeUser)), savedId: id });
      }

      if (method === 'POST' && url.pathname === '/api/admin/dishes') {
        const activeUser = await requireCapability(db, req, 'dish:write');
        const id = await upsertDish(db, await readBody(req), undefined, tenantIdFor(activeUser));
        await audit(db, activeUser, 'UPSERT', 'dish', id);
        await invalidateRankings();
        const savedEntity = rowToDish(await db.prepare('SELECT * FROM dishes WHERE tenant_id = ? AND id = ?').get(tenantIdFor(activeUser), id));
        return send(res, 201, { ...(await snapshot(db, activeUser)), savedId: id, savedEntity });
      }

      if (method === 'POST' && url.pathname === '/api/admin/dishes/import') {
        const activeUser = await requireCapability(db, req, 'dish:bulk_import');
        const body = await readBody(req);
        if (!Array.isArray(body.dishes)) throw Object.assign(new Error('dishes 必须是数组'), { status: 400 });
        const tenantId = tenantIdFor(activeUser);
        const imported = await withTransaction(db, async (tx) => {
          const ids = [];
          for (const dish of body.dishes) ids.push(await upsertDish(tx, dish, undefined, tenantId));
          await audit(tx, activeUser, 'BULK_IMPORT', 'dish', `${ids.length}`);
          return ids;
        });
        await invalidateRankings();
        return send(res, 200, { imported: imported.length, state: await snapshot(db, activeUser) });
      }

      if (method === 'POST' && url.pathname === '/api/admin/dishes/vision-import') {
        const activeUser = await requireCapability(db, req, 'dish:write');
        await getAiSettings(db, activeUser);
        await assertAiQuota(db, activeUser);
        const startedAt = Date.now();
        const status = getAiProviderStatus();
        try {
          const suggestion = await identifyDishFromImage(await readBody(req, MAX_IMAGE_BODY_BYTES));
          await audit(db, activeUser, 'VISION_IMPORT', 'dish', suggestion.name || 'pending');
          await recordAiUsage(db, activeUser, { feature: 'admin-vision-import', provider: status.source, model: status.visionModel, status: 'success', imageCount: 1, outputTokens: estimateTokens(JSON.stringify(suggestion)), latencyMs: Date.now() - startedAt });
          return send(res, 200, { suggestion });
        } catch (error) {
          await recordAiUsage(db, activeUser, { feature: 'admin-vision-import', provider: status.source, model: status.visionModel, status: 'failure', imageCount: 1, latencyMs: Date.now() - startedAt, error: error.message });
          throw error;
        }
      }

      if ((method === 'PUT' || method === 'DELETE') && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'dishes' && pathParts[3]) {
        const permission = method === 'DELETE' ? 'dish:delete' : 'dish:write';
        const activeUser = await requireCapability(db, req, permission);
        const id = decodeURIComponent(pathParts[3]);
        const existing = await db.prepare('SELECT id, status FROM dishes WHERE tenant_id = ? AND id = ?').get(tenantIdFor(activeUser), id);
        if (!existing) throw Object.assign(new Error('菜品不存在'), { status: 404 });
        if (method === 'DELETE') {
          if (existing.status !== 'active') throw Object.assign(new Error('菜品不存在'), { status: 404 });
          await db.prepare("UPDATE dishes SET status = 'hidden', updated_at = ? WHERE tenant_id = ? AND id = ?").run(now(), tenantIdFor(activeUser), id);
          await deleteRetrievalSource(db, { tenantId: tenantIdFor(activeUser), sourceType: 'dish', sourceId: id });
          await audit(db, activeUser, 'DELETE', 'dish', id);
          await invalidateRankings();
          return send(res, 200, await snapshot(db, activeUser));
        }
        await upsertDish(db, await readBody(req), id, tenantIdFor(activeUser));
        await audit(db, activeUser, 'UPDATE', 'dish', id);
        await invalidateRankings();
        const savedEntity = rowToDish(await db.prepare('SELECT * FROM dishes WHERE tenant_id = ? AND id = ?').get(tenantIdFor(activeUser), id));
        return send(res, 200, { ...(await snapshot(db, activeUser)), savedId: id, savedEntity });
      }


      if (method === 'GET' && url.pathname === '/api/admin/tenants') {
        const activeUser = await requireCapability(db, req, 'tenant:manage');
        await audit(db, activeUser, 'LIST', 'tenant', null);
        return send(res, 200, { tenants: await listTenants(db) });
      }

      if (method === 'POST' && url.pathname === '/api/admin/tenants') {
        const activeUser = await requireCapability(db, req, 'tenant:manage');
        const id = await upsertTenant(db, await readBody(req));
        await audit(db, activeUser, 'UPSERT', 'tenant', id);
        return send(res, 201, { tenants: await listTenants(db) });
      }

      if (method === 'PUT' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'tenants' && pathParts[3]) {
        const activeUser = await requireCapability(db, req, 'tenant:manage');
        const id = decodeURIComponent(pathParts[3]);
        const existing = await db.prepare('SELECT id FROM tenants WHERE id = ?').get(id);
        if (!existing) throw Object.assign(new Error('租户不存在'), { status: 404 });
        await upsertTenant(db, { ...(await readBody(req)), id }, id);
        await audit(db, activeUser, 'UPDATE', 'tenant', id);
        return send(res, 200, { tenants: await listTenants(db) });
      }

      if (method === 'GET' && url.pathname === '/api/admin/menus') {
        const activeUser = await requireCapability(db, req, 'dish:write');
        const result = await listMenus(db, tenantIdFor(activeUser), menuFilters(url.searchParams));
        return send(res, 200, result);
      }

      if (method === 'POST' && url.pathname === '/api/admin/menus') {
        const activeUser = await requireCapability(db, req, 'dish:write');
        const id = await upsertMenu(db, await readBody(req), undefined, tenantIdFor(activeUser));
        await audit(db, activeUser, 'UPSERT', 'menu', id);
        return send(res, 201, await listMenus(db, tenantIdFor(activeUser)));
      }

      if ((method === 'PUT' || method === 'DELETE') && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'menus' && pathParts[3]) {
        const activeUser = await requireCapability(db, req, 'dish:write');
        const id = decodeURIComponent(pathParts[3]);
        const existing = await db.prepare('SELECT id FROM menus WHERE tenant_id = ? AND id = ?').get(tenantIdFor(activeUser), id);
        if (!existing) throw Object.assign(new Error('菜单不存在'), { status: 404 });
        if (method === 'DELETE') {
          await db.prepare("UPDATE menus SET status = 'archived', updated_at = ? WHERE tenant_id = ? AND id = ?").run(now(), tenantIdFor(activeUser), id);
          await audit(db, activeUser, 'ARCHIVE', 'menu', id);
          return send(res, 200, await listMenus(db, tenantIdFor(activeUser)));
        }
        await upsertMenu(db, await readBody(req), id, tenantIdFor(activeUser));
        await audit(db, activeUser, 'UPDATE', 'menu', id);
        return send(res, 200, await listMenus(db, tenantIdFor(activeUser)));
      }

      if (method === 'POST' && url.pathname === '/api/admin/menus/batch') {
        const activeUser = await requireCapability(db, req, 'dish:write');
        const body = await readBody(req);
        const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
        const action = String(body.action || '');
        if (!ids.length) throw Object.assign(new Error('ids 必须是非空数组'), { status: 400 });
        if (!['publish', 'archive'].includes(action)) throw Object.assign(new Error('action 必须是 publish 或 archive'), { status: 400 });
        const status = action === 'publish' ? 'published' : 'archived';
        let updated = 0;
        await withTransaction(db, async (tx) => {
          for (const id of ids) {
            const result = await tx.prepare('UPDATE menus SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run(status, now(), tenantIdFor(activeUser), id);
            updated += Number(result.changes || 0);
          }
        });
        await audit(db, activeUser, action === 'publish' ? 'BATCH_PUBLISH' : 'BATCH_ARCHIVE', 'menu', `${updated}`);
        return send(res, 200, { updated, ...(await listMenus(db, tenantIdFor(activeUser))) });
      }

      // ── Admin review moderation ──────────────────────────────────
      if (method === 'GET' && url.pathname === '/api/admin/reviews') {
        const activeUser = await requireCapability(db, req, 'review:moderate');
        const tenantId = tenantIdFor(activeUser);
        const status = String(url.searchParams.get('status') || 'pending').trim() || 'pending';
        const targetType = String(url.searchParams.get('targetType') || '').trim();
        const canteenId = String(url.searchParams.get('canteenId') || '').trim();
        const stallId = String(url.searchParams.get('stallId') || '').trim();
        const dishId = String(url.searchParams.get('dishId') || '').trim();
        if (!['pending', 'approved', 'rejected', 'all'].includes(status)) throw Object.assign(new Error('不支持的评价状态'), { status: 400 });
        if (targetType && !['dish', 'canteen'].includes(targetType)) throw Object.assign(new Error('targetType 必须是 dish 或 canteen'), { status: 400 });
        const whereClauses = ['reviews.tenant_id = ?'];
        const whereParams = [tenantId];
        if (status !== 'all') {
          whereClauses.push('reviews.status = ?');
          whereParams.push(status);
        }
        if (targetType) {
          whereClauses.push('reviews.target_type = ?');
          whereParams.push(targetType);
        }
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
        const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
        const where = whereClauses.join(' AND ');
        const rows = await db.prepare(`SELECT reviews.*, users.nickname, users.username FROM reviews LEFT JOIN users ON users.id = reviews.user_id WHERE ${where} ORDER BY reviews.created_at DESC, reviews.id DESC`).all(...whereParams);
        const catalog = await reviewCatalog(db, tenantId);
        const reviews = rows.map(rowToReview).map((review) => enrichReview(review, catalog)).filter((review) => {
          if (canteenId && review.canteen?.id !== canteenId) return false;
          if (stallId && review.stall?.id !== stallId) return false;
          if (dishId && review.dish?.id !== dishId) return false;
          return true;
        });
        return send(res, 200, { reviews: reviews.slice(offset, offset + limit), total: reviews.length, limit, offset });
      }

      if ((method === 'PUT' || method === 'PATCH') && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'reviews' && pathParts[3] && pathParts[4] === 'status') {
        const activeUser = await requireCapability(db, req, 'review:moderate');
        const reviewId = decodeURIComponent(pathParts[3]);
        const body = await readBody(req);
        const newStatus = String(body.status || '');
        if (!['approved', 'pending', 'rejected'].includes(newStatus)) throw Object.assign(new Error('status 必须是 approved、pending 或 rejected'), { status: 400 });
        const tenantId = tenantIdFor(activeUser);
        await withTransaction(db, async (tx) => {
          const existing = await tx.prepare('SELECT id, status, target_type, target_id FROM reviews WHERE tenant_id = ? AND id = ?').get(tenantId, reviewId);
          if (!existing) throw Object.assign(new Error('评价不存在'), { status: 404 });
          await tx.prepare('UPDATE reviews SET status = ? WHERE tenant_id = ? AND id = ?').run(newStatus, tenantId, reviewId);
          await audit(tx, activeUser, 'MODERATE_REVIEW', 'review', reviewId, {
            fromStatus: existing.status,
            toStatus: newStatus,
            linkedReviewId: null,
            targetType: existing.target_type,
            targetId: existing.target_id
          });
          await invalidateRankings();
        });
        return send(res, 200, { id: reviewId, status: newStatus });
      }

      if (method === 'GET' && url.pathname === '/api/admin/posts') {
        const activeUser = await requireCapability(db, req, 'post:moderate');
        const tenantId = tenantIdFor(activeUser);
        const status = String(url.searchParams.get('status') || '').trim();
        const targetType = String(url.searchParams.get('targetType') || '').trim();
        const canteenId = String(url.searchParams.get('canteenId') || '').trim();
        const stallId = String(url.searchParams.get('stallId') || '').trim();
        const dishId = String(url.searchParams.get('dishId') || '').trim();
        if (status && !['pending', 'approved', 'rejected', 'all'].includes(status)) throw Object.assign(new Error('不支持的帖子状态'), { status: 400 });
        if (targetType && !['dish', 'canteen'].includes(targetType)) throw Object.assign(new Error('targetType 必须是 dish 或 canteen'), { status: 400 });
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
        const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
        const whereClauses = ['campus_posts.tenant_id = ?'];
        const params = [tenantId];
        if (status && status !== 'all') { whereClauses.push('campus_posts.status = ?'); params.push(status); }
        if (targetType) { whereClauses.push('campus_posts.target_type = ?'); params.push(targetType); }
        const rows = await db.prepare(`SELECT campus_posts.*, users.nickname, users.username, reviews.status AS linked_review_status FROM campus_posts LEFT JOIN users ON users.id = campus_posts.user_id LEFT JOIN reviews ON reviews.tenant_id = campus_posts.tenant_id AND reviews.id = campus_posts.linked_review_id WHERE ${whereClauses.join(' AND ')} ORDER BY campus_posts.created_at DESC, campus_posts.id DESC`).all(...params);
        const catalog = await reviewCatalog(db, tenantId);
        const posts = rows.map(rowToPost).map((post) => enrichPost(post, catalog)).filter((post) => {
          if (canteenId && post.canteen?.id !== canteenId) return false;
          if (stallId && post.stall?.id !== stallId) return false;
          if (dishId && post.dish?.id !== dishId) return false;
          return true;
        });
        return send(res, 200, { posts: posts.slice(offset, offset + limit), total: posts.length, limit, offset });
      }

      if (method === 'PATCH' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'posts' && pathParts[3] && pathParts[4] === 'status') {
        const activeUser = await requireCapability(db, req, 'post:moderate');
        const tenantId = tenantIdFor(activeUser);
        const postId = decodeURIComponent(pathParts[3]);
        const status = String((await readBody(req)).status || '').trim();
        if (!['pending', 'approved', 'rejected'].includes(status)) throw Object.assign(new Error('status 必须是 approved、pending 或 rejected'), { status: 400 });
        let updatedRow;
        await withTransaction(db, async (tx) => {
          const post = await tx.prepare('SELECT * FROM campus_posts WHERE tenant_id = ? AND id = ?').get(tenantId, postId);
          if (!post) throw Object.assign(new Error('帖子不存在'), { status: 404 });
          let linkedReviewId = post.linked_review_id || null;
          if (post.target_type === 'dish' && post.rating != null) {
            if (status === 'approved') {
              linkedReviewId ||= `post-review-${post.id}`;
              await tx.prepare(`INSERT INTO reviews (id, tenant_id, user_id, target_type, target_id, rating, content, status, created_at) VALUES (?, ?, ?, 'dish', ?, ?, ?, 'approved', ?)
                ON CONFLICT(id) DO UPDATE SET tenant_id=excluded.tenant_id, user_id=excluded.user_id, target_type=excluded.target_type, target_id=excluded.target_id, rating=excluded.rating, content=excluded.content, status='approved'`)
                .run(linkedReviewId, tenantId, post.user_id, post.target_id, Number(post.rating), post.content, post.created_at);
            } else if (linkedReviewId) {
              await tx.prepare('UPDATE reviews SET status = ? WHERE tenant_id = ? AND id = ?').run(status, tenantId, linkedReviewId);
            }
            await invalidateRankings();
          }
          await tx.prepare('UPDATE campus_posts SET status = ?, linked_review_id = ?, updated_at = ? WHERE tenant_id = ? AND id = ?')
            .run(status, linkedReviewId, now(), tenantId, postId);
          await audit(tx, activeUser, 'MODERATE_POST', 'campus_post', postId, {
            fromStatus: post.status,
            toStatus: status,
            linkedReviewId,
            targetType: post.target_type,
            targetId: post.target_id
          });
          updatedRow = await tx.prepare('SELECT campus_posts.*, users.nickname, users.username, reviews.status AS linked_review_status FROM campus_posts LEFT JOIN users ON users.id = campus_posts.user_id LEFT JOIN reviews ON reviews.tenant_id = campus_posts.tenant_id AND reviews.id = campus_posts.linked_review_id WHERE campus_posts.tenant_id = ? AND campus_posts.id = ?').get(tenantId, postId);
        });
        const catalog = await reviewCatalog(db, tenantId);
        const updated = rowToPost(updatedRow);
        return send(res, 200, { post: enrichPost(updated, catalog) });
      }

      if (method === 'GET' && url.pathname === '/api/admin/reviews/analytics') {
        const activeUser = await requireCapability(db, req, 'review:moderate');
        const tenantId = tenantIdFor(activeUser);
        const totalRow = await db.prepare('SELECT COUNT(*) AS count FROM reviews WHERE tenant_id = ?').get(tenantId);
        const statusRows = await db.prepare('SELECT status, COUNT(*) AS count FROM reviews WHERE tenant_id = ? GROUP BY status').all(tenantId);
        const ratingRows = await db.prepare('SELECT rating, COUNT(*) AS count FROM reviews WHERE tenant_id = ? GROUP BY rating ORDER BY rating').all(tenantId);
        const avgRow = await db.prepare('SELECT AVG(rating) AS avg_rating FROM reviews WHERE tenant_id = ?').get(tenantId);
        const statusDist = Object.fromEntries(statusRows.map((r) => [r.status, r.count]));
        const ratingDist = Object.fromEntries(ratingRows.map((r) => [r.rating, r.count]));
        return send(res, 200, {
          total: totalRow.count,
          averageRating: avgRow.avg_rating ? Number(avgRow.avg_rating.toFixed(1)) : 0,
          statusDistribution: { approved: statusDist.approved || 0, pending: statusDist.pending || 0, rejected: statusDist.rejected || 0 },
          ratingDistribution: ratingDist
        });
      }

      // ── Admin menu item supply management ────────────────────────
      if (method === 'PATCH' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'menu-items' && pathParts[3] && pathParts[4] === 'supply') {
        const activeUser = await requireCapability(db, req, 'dish:write');
        const itemId = decodeURIComponent(pathParts[3]);
        const body = await readBody(req);
        const existing = await db.prepare('SELECT * FROM menu_items WHERE tenant_id = ? AND id = ?').get(tenantIdFor(activeUser), itemId);
        if (!existing) throw Object.assign(new Error('菜单项不存在'), { status: 404 });
        const updates = [];
        const params = [];
        if (body.supplyCount !== undefined) { updates.push('supply_count = ?'); params.push(Number(body.supplyCount)); }
        if (body.soldOut !== undefined) { updates.push('sold_out = ?'); params.push(body.soldOut ? 1 : 0); }
        if (body.supplyLimit !== undefined) { updates.push('supply_limit = ?'); params.push(Number(body.supplyLimit)); }
        if (body.servingStart !== undefined) { updates.push('serving_start = ?'); params.push(String(body.servingStart)); }
        if (body.servingEnd !== undefined) { updates.push('serving_end = ?'); params.push(String(body.servingEnd)); }
        if (!updates.length) throw Object.assign(new Error('至少需要一个可更新字段'), { status: 400 });
        updates.push('updated_at = ?');
        params.push(now());
        params.push(tenantIdFor(activeUser));
        params.push(itemId);
        await db.prepare(`UPDATE menu_items SET ${updates.join(', ')} WHERE tenant_id = ? AND id = ?`).run(...params);
        await audit(db, activeUser, 'UPDATE_SUPPLY', 'menu_item', itemId);
        const updated = await db.prepare('SELECT menu_items.*, dishes.name AS dish_name FROM menu_items LEFT JOIN dishes ON dishes.id = menu_items.dish_id WHERE menu_items.tenant_id = ? AND menu_items.id = ?').get(tenantIdFor(activeUser), itemId);
        return send(res, 200, rowToMenuItem(updated));
      }


      if (method === 'GET' && url.pathname === '/api/admin/ai-settings') {
        const activeUser = await requireCapability(db, req, 'ai:configure');
        const settings = await getAiSettings(db, activeUser);
        return send(res, 200, { settings: safeAiSettings(settings), status: getAiProviderStatus(settings) });
      }

      if (method === 'PUT' && url.pathname === '/api/admin/ai-settings') {
        const activeUser = await requireCapability(db, req, 'ai:configure');
        const settings = await saveAiSettings(db, await readBody(req), activeUser);
        await audit(db, activeUser, 'UPSERT', 'ai_settings', 'ai_provider');
        return send(res, 200, { settings: safeAiSettings(settings), status: getAiProviderStatus(settings) });
      }

      if (method === 'DELETE' && url.pathname === '/api/admin/ai-settings') {
        const activeUser = await requireCapability(db, req, 'ai:configure');
        await clearAiSettings(db, activeUser);
        await audit(db, activeUser, 'DELETE', 'ai_settings', 'ai_provider');
        return send(res, 200, { settings: safeAiSettings({}), status: getAiProviderStatus({}) });
      }

      if (method === 'POST' && url.pathname === '/api/admin/ai-settings/test') {
        const activeUser = await requireCapability(db, req, 'ai:configure');
        const body = await readBody(req);
        const current = await getAiSettings(db, activeUser);
        const submittedKey = String(body.apiKey || '').trim();
        const apiKey = submittedKey && submittedKey !== '********' ? submittedKey : current.apiKey;
        const result = await testAiProviderConnection({ ...current, ...body, apiKey });
        return send(res, 200, result);
      }

      if (method === 'GET' && url.pathname === '/api/admin/ai-usage') {
        const activeUser = await requireCapability(db, req, 'ai:configure');
        const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
        const offset = Number(url.searchParams.get('offset')) || 0;
        return send(res, 200, await listAiUsage(db, tenantIdFor(activeUser), limit, offset));
      }

      if (method === 'GET' && url.pathname === '/api/admin/users') {
        const activeUser = await requireCapability(db, req, 'user:read');
        const users = (await db.prepare('SELECT * FROM users WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantIdFor(activeUser))).map(rowToUser);
        await audit(db, activeUser, 'LIST', 'user', null);
        return send(res, 200, { users });
      }

      if (method === 'PUT' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'users' && pathParts[3]) {
        const activeUser = await requireCapability(db, req, 'user:write');
        const id = decodeURIComponent(pathParts[3]);
        const existing = await db.prepare('SELECT * FROM users WHERE tenant_id = ? AND id = ?').get(tenantIdFor(activeUser), id);
        if (!existing) throw Object.assign(new Error('用户不存在'), { status: 404 });
        const body = await readBody(req);
        const role = String(body.role || '');
        if (!assignableRoles.has(role)) throw Object.assign(new Error(`角色必须是以下之一：${Array.from(assignableRoles).join('、')}`), { status: 400 });
        if (existing.role === role) return send(res, 200, { user: rowToUser(existing) });
        await db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run(role, now(), tenantIdFor(activeUser), id);
        const updated = await db.prepare('SELECT * FROM users WHERE tenant_id = ? AND id = ?').get(tenantIdFor(activeUser), id);
        await audit(db, activeUser, 'UPDATE_ROLE', 'user', id);
        return send(res, 200, { user: rowToUser(updated) });
      }

      if (method === 'GET' && url.pathname === '/api/admin/audit-logs') {
        const activeUser = await requireCapability(db, req, 'audit:read');
        const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
        const offset = Number(url.searchParams.get('offset')) || 0;
        const rows = await db.prepare('SELECT audit_logs.*, users.username, users.nickname FROM audit_logs LEFT JOIN users ON users.id = audit_logs.user_id WHERE audit_logs.tenant_id = ? ORDER BY audit_logs.created_at DESC LIMIT ? OFFSET ?').all(tenantIdFor(activeUser), limit, offset);
        const totalRow = await db.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE tenant_id = ?').get(tenantIdFor(activeUser));
        const total = totalRow.count;
        const logs = rows.map((row) => ({ ...rowToAuditLog(row), user: row.nickname || row.username || null }));
        return send(res, 200, { logs, total });
      }

      if (method === 'GET' && url.pathname === '/api/admin/database/overview') {
        const activeUser = await requireCapability(db, req, 'audit:read');
        const tenantId = tenantIdFor(activeUser);
        const tableNames = ['users', 'health_profiles', 'canteens', 'stalls', 'dishes', 'menus', 'menu_items', 'reviews', 'orders', 'order_items', 'payments', 'audit_logs'];
        const tables = [];
        for (const table of tableNames) {
          let row = null;
          try { row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ?`).get(tenantId); } catch { row = null; }
          tables.push({ name: table, count: Number(row?.count || 0) });
        }
        const quality = {
          dishesWithoutStall: Number((await db.prepare('SELECT COUNT(*) AS count FROM dishes d LEFT JOIN stalls s ON s.id = d.stall_id WHERE d.tenant_id = ? AND s.id IS NULL').get(tenantId)).count || 0),
          stallsWithoutCanteen: Number((await db.prepare('SELECT COUNT(*) AS count FROM stalls s LEFT JOIN canteens c ON c.id = s.canteen_id WHERE s.tenant_id = ? AND c.id IS NULL').get(tenantId)).count || 0),
          publishedMenusWithoutItems: Number((await db.prepare("SELECT COUNT(*) AS count FROM menus m LEFT JOIN menu_items mi ON mi.menu_id = m.id WHERE m.tenant_id = ? AND m.status = 'published' GROUP BY m.id HAVING COUNT(mi.id) = 0").all(tenantId)).length || 0),
          dishesWithoutNutrition: Number((await db.prepare('SELECT COUNT(*) AS count FROM dishes WHERE tenant_id = ? AND (calories IS NULL OR protein IS NULL)').get(tenantId)).count || 0)
        };
        await audit(db, activeUser, 'VIEW', 'database_overview', null);
        return send(res, 200, { driver: process.env.DB_DRIVER === 'postgres' || process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite', tables, quality, workflow: ['食堂', '档口', '菜品', '菜单', '菜单明细', '发布'] });

      }
      if (method === 'GET' && url.pathname === '/api/admin/catalog/tree') {
        const activeUser = await requireAnyCapability(db, req, ['audit:read', 'canteen:write', 'stall:write', 'dish:write']);
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 20);
        const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
        const include = String(url.searchParams.get('include') || 'summary');
        const result = await loadAdminCatalogTree(db, {
          tenantId: tenantIdFor(activeUser),
          regionId: String(url.searchParams.get('venueId') || url.searchParams.get('regionId') || '').trim(),
          canteenId: String(url.searchParams.get('areaId') || url.searchParams.get('canteenId') || '').trim(),
          stallId: String(url.searchParams.get('stallId') || '').trim(),
          query: url.searchParams.get('q') || '',
          includeDishes: include === 'dishes',
          limit,
          offset
        });
        await audit(db, activeUser, 'LIST', 'catalog_tree', null, { include, query: url.searchParams.get('q') || '' });
        return send(res, 200, result);
      }
      if (method === 'GET' && url.pathname === '/api/admin/retrieval/status') {
        const activeUser = await requireCapability(db, req, 'audit:read');
        return send(res, 200, await getRetrievalIndexStatus(db, { tenantId: tenantIdFor(activeUser) }));
      }
      if (method === 'POST' && url.pathname === '/api/admin/retrieval/reindex') {
        const activeUser = await requireCapability(db, req, 'dish:write');
        const tenantId = tenantIdFor(activeUser);
        const body = await readBody(req);
        await getAiSettings(db, activeUser).catch(() => {});
        const quota = await aiQuotaStatus(db, tenantId);
        const quotaExhausted = quota.quota > 0 && quota.remaining <= 0;
        const result = await reindexRetrieval(db, {
          tenantId,
          sourceTypes: body.sourceTypes,
          prune: body.prune !== false,
          ...(quotaExhausted ? { embeddingProvider: null } : {})
        });
        await audit(db, activeUser, 'REINDEX', 'retrieval_index', result.runId, { sourceTypes: result.sourceTypes, failureCount: result.failureCount, quotaExhausted });
        return send(res, 200, { ...result, quotaExhausted });
      }
      if (method === 'GET' && url.pathname === '/api/admin/database/entities') {
        const activeUser = await requireCapability(db, req, 'audit:read');
        const entities = Object.entries(DATABASE_ENTITIES)
          .filter(([, entity]) => hasPermission(activeUser, entity.capability))
          .map(([name, entity]) => ({ name, label: entity.label, columns: entity.columns, writable: hasPermission(activeUser, entity.writeCapability) ? entity.writable : [], capability: entity.capability, writeCapability: entity.writeCapability, deleteCapability: entity.deleteCapability || null, canWrite: hasPermission(activeUser, entity.writeCapability), canDelete: Boolean(entity.deleteCapability && hasPermission(activeUser, entity.deleteCapability)) }));
        return send(res, 200, { entities });
      }
      if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'database' && pathParts[3] === 'entities' && pathParts[4]) {
        const activeUser = await requireCapability(db, req, 'audit:read');
        const entityName = decodeURIComponent(pathParts[4]);
        const entity = databaseEntity(entityName);
        await requireCapability(db, req, entity.capability);
        const tenantId = tenantIdFor(activeUser);
        if (method === 'GET' && !pathParts[5]) {
          const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 25, 1), 100);
          const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
          const search = String(url.searchParams.get('search') || '').trim().slice(0, 100);
          const where = [`tenant_id = ?`];
          const params = [tenantId];
          if (search && entity.search.length) { where.push(`(${entity.search.map((field) => `CAST(${field} AS TEXT) LIKE ?`).join(' OR ')})`); params.push(...entity.search.map(() => `%${search}%`)); }
          const whereSql = where.join(' AND ');
          const orderColumn = entity.columns.includes('created_at') ? 'created_at' : entity.key;
          const rows = await db.prepare(`SELECT ${entity.columns.join(', ')} FROM ${entity.table} WHERE ${whereSql} ORDER BY ${orderColumn} DESC, ${entity.key} DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
          const total = (await db.prepare(`SELECT COUNT(*) AS count FROM ${entity.table} WHERE ${whereSql}`).get(...params)).count;
          await audit(db, activeUser, 'LIST', `database:${entityName}`, null);
          return send(res, 200, { entity: { name: entityName, label: entity.label, columns: entity.columns, writable: entity.writable }, rows, total, limit, offset });
        }
        if (pathParts[5]) {
          const id = decodeURIComponent(pathParts[5]);
          if (method === 'DELETE') {
            const deleter = await requireCapability(db, req, entity.deleteCapability || entity.writeCapability || 'audit:read');
            if (!entity.deleteCapability) throw Object.assign(new Error('该实体不允许删除'), { status: 403 });
            if (entityName === 'stalls') {
              const childCount = Number((await db.prepare('SELECT COUNT(*) AS count FROM stalls WHERE tenant_id = ? AND parent_id = ?').get(tenantId, id))?.count || 0);
              if (childCount > 0) throw Object.assign(new Error('请先删除或迁移该档口下的子档口'), { status: 409 });
            }
            const result = await db.prepare(`DELETE FROM ${entity.table} WHERE tenant_id = ? AND ${entity.key} = ?`).run(tenantId, id);
            if (!result.changes) throw Object.assign(new Error('记录不存在'), { status: 404 });
            if (entityName === 'dishes') await deleteRetrievalSource(db, { tenantId, sourceType: 'dish', sourceId: id });
            await audit(db, deleter, 'DELETE', `database:${entityName}`, id);
            return send(res, 200, { id, deleted: true });
          }
          if (method === 'PUT' || method === 'PATCH') {
            const writer = await requireCapability(db, req, entity.writeCapability || 'audit:read');
            const body = await readBody(req);
            rejectDatabaseStallParentWrite(entityName, body);
            const payload = databasePayload(entity, body, { partial: method === 'PATCH' });
            if (entityName === 'stalls') await validateDatabaseStallWrite(db, { tenantId, stallId: id, payload });
            const fields = Object.keys(payload);
            const values = fields.map((field) => payload[field]);
            const result = await db.prepare(`UPDATE ${entity.table} SET ${fields.map((field) => `${field} = ?`).join(', ')}, updated_at = ? WHERE tenant_id = ? AND ${entity.key} = ?`).run(...values, now(), tenantId, id);
            if (!result.changes) throw Object.assign(new Error('记录不存在'), { status: 404 });
            if (entityName === 'dishes') await syncDishRetrievalDocument(db, { tenantId, dishId: id });
            await audit(db, writer, 'UPDATE', `database:${entityName}`, id);
            return send(res, 200, { row: await db.prepare(`SELECT ${entity.columns.join(', ')} FROM ${entity.table} WHERE tenant_id = ? AND ${entity.key} = ?`).get(tenantId, id) });
          }
        }
        if (method === 'POST') {
          const writer = await requireCapability(db, req, entity.writeCapability || 'audit:read');
          const body = await readBody(req);
          rejectDatabaseStallParentWrite(entityName, body);
          const payload = databasePayload(entity, body);
          const id = String(body.id || randomUUID());
          if (entityName === 'stalls') await validateDatabaseStallWrite(db, { tenantId, stallId: id, payload, creating: true });
          const fields = ['id', 'tenant_id', ...Object.keys(payload), 'created_at', 'updated_at'];
          const values = [id, tenantId, ...Object.keys(payload).map((field) => payload[field]), now(), now()];
          await db.prepare(`INSERT INTO ${entity.table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`).run(...values);
          if (entityName === 'dishes') await syncDishRetrievalDocument(db, { tenantId, dishId: id });
          await audit(db, writer, 'CREATE', `database:${entityName}`, id);
          return send(res, 201, { row: await db.prepare(`SELECT ${entity.columns.join(', ')} FROM ${entity.table} WHERE tenant_id = ? AND ${entity.key} = ?`).get(tenantId, id) });
        }
      }


      if (method === 'GET' && url.pathname === '/api/admin/analytics') {
        const activeUser = await requireCapability(db, req, 'audit:read');
        const tenantId = tenantIdFor(activeUser);
        const [dishCount, reviewCount, userCount, menuCount, todayPublished] = await Promise.all([
          db.prepare("SELECT COUNT(*) AS c FROM dishes WHERE tenant_id = ? AND status = 'active'").get(tenantId),
          db.prepare('SELECT COUNT(*) AS c FROM reviews WHERE tenant_id = ?').get(tenantId),
          db.prepare('SELECT COUNT(*) AS c FROM users WHERE tenant_id = ?').get(tenantId),
          db.prepare('SELECT COUNT(*) AS c FROM menus WHERE tenant_id = ?').get(tenantId),
          db.prepare("SELECT COUNT(*) AS c FROM menus WHERE tenant_id = ? AND date = ? AND status = 'published'").get(tenantId, now().slice(0, 10))
        ]);
        const avgRating = await db.prepare('SELECT AVG(rating) AS avg FROM reviews WHERE tenant_id = ?').get(tenantId);
        const recentDishes = (await db.prepare("SELECT * FROM dishes WHERE tenant_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 5").all(tenantId)).map(rowToDish);
        return send(res, 200, {
          dishes: dishCount.c,
          reviews: reviewCount.c,
          users: userCount.c,
          menus: menuCount.c,
          todayPublished: todayPublished.c,
          avgRating: Number((avgRating.avg || 0).toFixed(2)),
          recentDishes
        });
      }

      if (method === 'DELETE' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'reviews' && pathParts[3]) {
        const activeUser = await requireCapability(db, req, 'review:moderate');
        const id = decodeURIComponent(pathParts[3]);
        const tenantId = tenantIdFor(activeUser);
        const existing = await db.prepare('SELECT id, target_id FROM reviews WHERE tenant_id = ? AND id = ?').get(tenantId, id);
        if (!existing) throw Object.assign(new Error('评价不存在'), { status: 404 });
        await db.prepare('DELETE FROM reviews WHERE tenant_id = ? AND id = ?').run(tenantId, id);
        const countRow = await db.prepare("SELECT COUNT(*) AS c FROM reviews WHERE tenant_id = ? AND target_type = 'dish' AND target_id = ?").get(tenantId, existing.target_id);
        await db.prepare('UPDATE dishes SET review_count = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run(countRow.c, now(), tenantId, existing.target_id);
        await audit(db, activeUser, 'DELETE', 'review', id);
        await invalidateRankings();
        return send(res, 200, { deleted: true, reviewId: id });
      }

      // ── Agent action center: list own actions ─────────────────────
      if (method === 'GET' && url.pathname === '/api/agent/actions') {
        const activeUser = await requireCapability(db, req, 'agent:use');
        const tenantId = tenantIdFor(activeUser);
        const status = String(url.searchParams.get('status') || 'pending').trim() || 'pending';
        if (!['pending', 'confirmed', 'rejected', 'expired', 'all'].includes(status)) throw Object.assign(new Error('智能体动作状态不支持'), { status: 400 });
        const rows = status === 'all'
          ? await db.prepare('SELECT id, type, status, payload_json, payload_hash, expires_at, result_json, session_id, created_at, updated_at FROM agent_actions WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 50').all(tenantId, activeUser.id)
          : await db.prepare('SELECT id, type, status, payload_json, payload_hash, expires_at, result_json, session_id, created_at, updated_at FROM agent_actions WHERE tenant_id = ? AND user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 50').all(tenantId, activeUser.id, status);
        return send(res, 200, { actions: rows.map(rowToAgentAction) });
      }

      // ── Agent memory governance ─────────────────────────────────
      if (method === 'GET' && url.pathname === '/api/agent/memory') {
        const activeUser = await requireCapability(db, req, 'agent:use');
        return send(res, 200, { memory: await loadAgentMemory(db, activeUser) });
      }

      if (method === 'PUT' && url.pathname === '/api/agent/memory') {
        const activeUser = await requireCapability(db, req, 'agent:use');
        const existing = await loadAgentMemory(db, activeUser);
        const payload = normalizeAgentMemoryPayload(await readBody(req), existing);
        const timestamp = now();
        await db.prepare('INSERT INTO agent_memories (id, tenant_id, user_id, summary, preferences_json, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(tenant_id, user_id) DO UPDATE SET summary = excluded.summary, preferences_json = excluded.preferences_json, updated_at = excluded.updated_at')
          .run(`agent-memory-${randomUUID()}`, tenantIdFor(activeUser), activeUser.id, payload.summary, serializeJson(payload.preferences), timestamp);
        await audit(db, activeUser, 'UPSERT', 'agent_memory', activeUser.id);
        return send(res, 200, { memory: { ...payload, updatedAt: timestamp } });
      }

      if (method === 'DELETE' && url.pathname === '/api/agent/memory') {
        const activeUser = await requireCapability(db, req, 'agent:use');
        const tenantId = tenantIdFor(activeUser);
        await db.prepare('DELETE FROM agent_memories WHERE tenant_id = ? AND user_id = ?').run(tenantId, activeUser.id);
        await audit(db, activeUser, 'DELETE', 'agent_memory', activeUser.id);
        return send(res, 200, { memory: { summary: '', preferences: {} } });
      }

      // ── Agent eval case management ───────────────────────────────
      if (method === 'GET' && url.pathname === '/api/agent/eval-cases') {
        const activeUser = await requireCapability(db, req, 'agent:use');
        if (!AGENT_OPERATION_ROLES.includes(activeUser.role)) throw Object.assign(new Error('当前角色不能管理评测用例'), { status: 403 });
        const tenantId = tenantIdFor(activeUser);
        const rows = await db.prepare('SELECT * FROM agent_eval_cases WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId);
        return send(res, 200, { cases: rows.map(rowToAgentEvalCase) });
      }

      if (method === 'POST' && url.pathname === '/api/agent/eval-cases') {
        const activeUser = await requireCapability(db, req, 'agent:use');
        if (!AGENT_OPERATION_ROLES.includes(activeUser.role)) throw Object.assign(new Error('当前角色不能管理评测用例'), { status: 403 });
        const body = await readBody(req);
        requireFields(body, ['name', 'query']);
        const id = `agent-eval-case-${randomUUID()}`;
        const timestamp = now();
        const requiredTools = parseJsonList(body.requiredTools || []);
        const forbiddenTools = parseJsonList(body.forbiddenTools || []);
        await db.prepare('INSERT INTO agent_eval_cases (id, tenant_id, name, query, expected_intent, required_tools_json, forbidden_tools_json, expect_action, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, tenantIdFor(activeUser), String(body.name).trim().slice(0, 120), String(body.query).trim().slice(0, 1000), String(body.expectedIntent || '').trim(), serializeJson(requiredTools), serializeJson(forbiddenTools), body.expectAction ? 1 : 0, body.enabled !== false ? 1 : 0, timestamp, timestamp);
        const created = await db.prepare('SELECT * FROM agent_eval_cases WHERE id = ?').get(id);
        await audit(db, activeUser, 'CREATE', 'agent_eval_case', id);
        return send(res, 201, { case: rowToAgentEvalCase(created) });
      }

      if (method === 'PUT' && pathParts[0] === 'api' && pathParts[1] === 'agent' && pathParts[2] === 'eval-cases' && pathParts[3]) {
        const activeUser = await requireCapability(db, req, 'agent:use');
        if (!AGENT_OPERATION_ROLES.includes(activeUser.role)) throw Object.assign(new Error('当前角色不能管理评测用例'), { status: 403 });
        const id = decodeURIComponent(pathParts[3]);
        const existing = await db.prepare('SELECT id FROM agent_eval_cases WHERE tenant_id = ? AND id = ?').get(tenantIdFor(activeUser), id);
        if (!existing) throw Object.assign(new Error('评测用例不存在'), { status: 404 });
        const body = await readBody(req);
        const sets = [];
        const params = [];
        if (body.name !== undefined) { sets.push('name = ?'); params.push(String(body.name).trim().slice(0, 120)); }
        if (body.query !== undefined) { sets.push('query = ?'); params.push(String(body.query).trim().slice(0, 1000)); }
        if (body.expectedIntent !== undefined) { sets.push('expected_intent = ?'); params.push(String(body.expectedIntent).trim()); }
        if (body.requiredTools !== undefined) { sets.push('required_tools_json = ?'); params.push(serializeJson(parseJsonList(body.requiredTools))); }
        if (body.forbiddenTools !== undefined) { sets.push('forbidden_tools_json = ?'); params.push(serializeJson(parseJsonList(body.forbiddenTools))); }
        if (body.expectAction !== undefined) { sets.push('expect_action = ?'); params.push(body.expectAction ? 1 : 0); }
        if (body.enabled !== undefined) { sets.push('enabled = ?'); params.push(body.enabled ? 1 : 0); }
        if (!sets.length) throw Object.assign(new Error('至少需要一个更新字段'), { status: 400 });
        sets.push('updated_at = ?');
        params.push(now(), tenantIdFor(activeUser), id);
        await db.prepare(`UPDATE agent_eval_cases SET ${sets.join(', ')} WHERE tenant_id = ? AND id = ?`).run(...params);
        const updated = await db.prepare('SELECT * FROM agent_eval_cases WHERE tenant_id = ? AND id = ?').get(tenantIdFor(activeUser), id);
        await audit(db, activeUser, 'UPDATE', 'agent_eval_case', id);
        return send(res, 200, { case: rowToAgentEvalCase(updated) });
      }

      if (method === 'DELETE' && pathParts[0] === 'api' && pathParts[1] === 'agent' && pathParts[2] === 'eval-cases' && pathParts[3]) {
        const activeUser = await requireCapability(db, req, 'agent:use');
        if (!AGENT_OPERATION_ROLES.includes(activeUser.role)) throw Object.assign(new Error('当前角色不能管理评测用例'), { status: 403 });
        const id = decodeURIComponent(pathParts[3]);
        const existing = await db.prepare('SELECT id FROM agent_eval_cases WHERE tenant_id = ? AND id = ?').get(tenantIdFor(activeUser), id);
        if (!existing) throw Object.assign(new Error('评测用例不存在'), { status: 404 });
        await db.prepare('DELETE FROM agent_eval_cases WHERE tenant_id = ? AND id = ?').run(tenantIdFor(activeUser), id);
        await audit(db, activeUser, 'DELETE', 'agent_eval_case', id);
        return send(res, 200, { deleted: true });
      }

      if (method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'agent' && pathParts[2] === 'eval-cases' && pathParts[3] && pathParts[4] === 'run') {
        const activeUser = await requireCapability(db, req, 'agent:use');
        if (!AGENT_OPERATION_ROLES.includes(activeUser.role)) throw Object.assign(new Error('当前角色不能运行评测用例'), { status: 403 });
        const id = decodeURIComponent(pathParts[3]);
        const existing = await db.prepare('SELECT * FROM agent_eval_cases WHERE tenant_id = ? AND id = ?').get(tenantIdFor(activeUser), id);
        if (!existing) throw Object.assign(new Error('评测用例不存在'), { status: 404 });
        const testCase = rowToAgentEvalCase(existing);
        const result = await runCanteenAgent(db, activeUser, { query: testCase.query });
        const scored = scoreAgentEvalCase(testCase, result);
        const caseRunId = `agent-eval-case-run-${randomUUID()}`;
        const timestamp = now();
        const resultBody = { intent: result.intent, steps: result.steps.map((step) => step.tool), actions: result.actions.length, checks: scored.checks };
        await db.prepare('INSERT INTO agent_eval_case_runs (id, tenant_id, case_id, user_id, passed, score, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(caseRunId, tenantIdFor(activeUser), id, activeUser.id, scored.passed ? 1 : 0, scored.score, serializeJson(resultBody), timestamp);
        await audit(db, activeUser, 'RUN', 'agent_eval_case', id);
        return send(res, 200, { run: { id: caseRunId, caseId: id, passed: scored.passed, score: scored.score, intent: result.intent, matchedIntent: scored.checks.find((check) => check.name === 'intent')?.passed ?? true, hasRequired: scored.checks.filter((check) => check.name.startsWith('required:')).every((check) => check.passed), hasForbidden: scored.checks.filter((check) => check.name.startsWith('forbidden:')).every((check) => check.passed), hasAction: scored.checks.find((check) => check.name === 'action')?.passed ?? true, checks: scored.checks, createdAt: timestamp } });
      }

      // ── Deployment readiness ────────────────────────────────────
      if (method === 'GET' && url.pathname === '/api/deployment/readiness') {
        await requireCapability(db, req, 'ai:configure');
        const checks = {
          agent: { status: 'ok', summary: 'agent route handler loaded' },
          runtime: { status: 'ok', node: process.version, platform: process.platform },
          schema: { status: 'ok' },
          driver: { status: 'ok', type: process.env.DB_DRIVER === 'postgres' || process.env.DATABASE_URL ? 'postgresql' : 'sqlite' },
        };
        const requiredTables = ['users', 'dishes', 'agent_actions', 'agent_memories', 'agent_eval_cases', 'user_dish_preferences', 'campus_environment'];
        try {
          let tables = [];
          try {
            // SQLite path
            const tableCheck = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${requiredTables.map(() => '?').join(',')})`).all(...requiredTables);
            tables = tableCheck.map((r) => r.name);
          } catch {
            // PostgreSQL path
            const tableCheck = await db.prepare("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (" + requiredTables.map(() => '?').join(',') + ")").all(...requiredTables);
            tables = tableCheck.map((r) => r.name);
          }
          const missing = requiredTables.filter((t) => !tables.includes(t));
          checks.schema = missing.length ? { status: 'warn', tables, missing } : { status: 'ok', tables };
        } catch (err) {
          checks.schema = { status: 'error', message: err.message };
        }
        const allOk = Object.values(checks).every((c) => c.status === 'ok' || c.status === 'warn');
        return send(res, allOk ? 200 : 503, { ok: allOk, checks, aiKeysConfigured: false });
      }

      // ── Agent SSE stream: text/event-stream for a session ─────────
      if (method === 'GET' && url.pathname === '/api/agent/stream') {
        const activeUser = await requireCapability(db, req, 'agent:use');
        const sessionId = String(url.searchParams.get('sessionId') || '').trim();
        if (!sessionId) throw Object.assign(new Error('缺少 sessionId'), { status: 400 });
        const data = await agentSessionEvents(db, activeUser, sessionId);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Request-Id': requestId,
        });
        writeSse(res, 'agent.session', data.session);
        for (const event of data.events) {
          const eventName = ['user_message', 'assistant_message', 'tool_message'].includes(event.type) ? 'agent.message' : (event.type === 'agent_action' ? 'agent.action' : 'agent.event');
          writeSse(res, eventName, event);
        }
        writeSse(res, 'agent.snapshot', { session: data.session, actions: data.actions });
        writeSse(res, 'agent.done', { sessionId });
        res.end();
        return;
      }


      // ── Admin stall CRUD ─────────────────────────────────────────
      if (method === 'POST' && url.pathname === '/api/admin/stalls') {
        const activeUser = await requireCapability(db, req, 'stall:write');
        const body = await readBody(req);
        if (!body.canteenId || !String(body.name || '').trim() || !String(body.floor || '').trim() || !String(body.category || '').trim()) throw Object.assign(new Error('缺少必填字段：canteenId, name, floor, category'), { status: 400 });
        const tenantId = tenantIdFor(activeUser);
        const canteenId = String(body.canteenId).trim();
        const stallId = String(body.id || `stall-${randomUUID()}`).trim();
        const parentId = normalizeStallParentId(body.parentId);
        if (parentId) {
          throw Object.assign(new Error('不再支持新建子档口；请将档口直属餐厅或楼层餐区'), {
            status: 400,
            code: 'STALL_PARENT_LEGACY_ONLY'
          });
        }
        await requireCatalogDiningArea(db, { tenantId, canteenId });
        await validateStallParent(db, { tenantId, stallId, canteenId, parentId });
        await db.prepare('INSERT INTO stalls (id, tenant_id, canteen_id, parent_id, floor, name, category, rating, avg_price, open, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(stallId, tenantId, canteenId, parentId, body.floor, String(body.name).trim(), String(body.category).trim(), Number(body.rating || 4.5), Number(body.avgPrice || 0), body.open !== false ? 1 : 0, body.description || '', now(), now());
        await audit(db, activeUser, 'CREATE', 'stall', stallId);
        await invalidateRankings();
        return send(res, 201, { ...(await snapshot(db, activeUser)), savedId: stallId });
      }

      if ((method === 'PUT' || method === 'DELETE') && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'stalls' && pathParts[3]) {
        const permission = method === 'DELETE' ? 'stall:delete' : 'stall:write';
        const activeUser = await requireCapability(db, req, permission);
        const tenantId = tenantIdFor(activeUser);
        const stallId = decodeURIComponent(pathParts[3]);
        const existing = await db.prepare('SELECT id, canteen_id, parent_id FROM stalls WHERE tenant_id = ? AND id = ?').get(tenantId, stallId);
        if (!existing) throw Object.assign(new Error('档口不存在'), { status: 404 });
        const childCount = Number((await db.prepare('SELECT COUNT(*) AS count FROM stalls WHERE tenant_id = ? AND parent_id = ?').get(tenantId, stallId))?.count || 0);
        if (method === 'DELETE') {
          if (childCount > 0) throw Object.assign(new Error('请先删除或迁移该档口下的子档口'), { status: 409, code: 'STALL_HAS_CHILDREN' });
          await db.prepare('DELETE FROM stalls WHERE tenant_id = ? AND id = ?').run(tenantId, stallId);
          await audit(db, activeUser, 'DELETE', 'stall', stallId);
          await invalidateRankings();
          return send(res, 200, await snapshot(db, activeUser));
        }
        const body = await readBody(req);
        const sets = [];
        const params = [];
        const canteenId = body.canteenId !== undefined ? String(body.canteenId).trim() : existing.canteen_id;
        const parentId = body.parentId !== undefined ? normalizeStallParentId(body.parentId) : (existing.parent_id || null);
        if (parentId && parentId !== existing.parent_id) {
          throw Object.assign(new Error('不再支持新增或变更父档口；历史子档口只能迁移为餐饮分区直属档口'), {
            status: 400,
            code: 'STALL_PARENT_LEGACY_ONLY'
          });
        }
        const isMoving = canteenId !== existing.canteen_id;
        const isMigratingLegacyChild = Boolean(existing.parent_id && body.parentId !== undefined && parentId === null);
        if (isMoving || isMigratingLegacyChild) {
          await requireCatalogDiningArea(db, { tenantId, canteenId });
        } else {
          const canteen = await db.prepare('SELECT id FROM canteens WHERE tenant_id = ? AND id = ?').get(tenantId, canteenId);
          if (!canteen) throw Object.assign(new Error('所属食堂不存在，或餐饮分区不属于当前租户'), { status: 400, code: 'STALL_CANTEEN_NOT_FOUND' });
        }
        if (childCount > 0 && isMoving) throw Object.assign(new Error('存在子档口的一级档口不能直接更换所属餐饮分区'), { status: 400, code: 'STALL_PARENT_HAS_CHILDREN' });
        await validateStallParent(db, { tenantId, stallId, canteenId, parentId, hasChildren: childCount > 0 });
        if (body.canteenId !== undefined) {
          sets.push('canteen_id = ?'); params.push(canteenId);
        }
        if (body.parentId !== undefined) { sets.push('parent_id = ?'); params.push(parentId); }
        if (body.name !== undefined) { sets.push('name = ?'); params.push(String(body.name).trim()); }
        if (body.floor !== undefined) { sets.push('floor = ?'); params.push(String(body.floor).trim()); }
        if (body.category !== undefined) { sets.push('category = ?'); params.push(String(body.category).trim()); }
        if (body.rating !== undefined) { sets.push('rating = ?'); params.push(Number(body.rating)); }
        if (body.avgPrice !== undefined) { sets.push('avg_price = ?'); params.push(Number(body.avgPrice)); }
        if (body.open !== undefined) { sets.push('open = ?'); params.push(body.open ? 1 : 0); }
        if (body.description !== undefined) { sets.push('description = ?'); params.push(body.description); }
        if (!sets.length) throw Object.assign(new Error('至少需要一个更新字段'), { status: 400 });
        sets.push('updated_at = ?');
        params.push(now(), tenantId, stallId);
        await db.prepare(`UPDATE stalls SET ${sets.join(', ')} WHERE tenant_id = ? AND id = ?`).run(...params);
        await audit(db, activeUser, 'UPDATE', 'stall', stallId);
        await invalidateRankings();
        return send(res, 200, { ...(await snapshot(db, activeUser)), savedId: stallId });
      }

      // ── Campus environment (admin) ───────────────────────────────
      if (method === 'GET' && url.pathname === '/api/admin/environment') {
        const activeUser = await requireCapability(db, req, 'environment:write');
        const envRow = await db.prepare('SELECT * FROM campus_environment WHERE tenant_id = ?').get(tenantIdFor(activeUser));
        return send(res, 200, { environment: envRow ? rowToEnvironment(envRow) : { temperature: 25, weatherLabel: '晴' } });
      }

      if (method === 'PUT' && url.pathname === '/api/admin/environment') {
        const activeUser = await requireCapability(db, req, 'environment:write');
        const body = await readBody(req);
        const temp = Number(body.temperature);
        if (!Number.isFinite(temp) || temp < -40 || temp > 55) throw Object.assign(new Error('温度需要在 -40 到 55 之间'), { status: 400 });
        const weatherLabel = String(body.weatherLabel || '晴').trim();
        if (!weatherLabel) throw Object.assign(new Error('请输入天气标签'), { status: 400 });
        const tenantId = tenantIdFor(activeUser);
        const envId = `env-${tenantId}`;
        await db.prepare('INSERT INTO campus_environment (id, tenant_id, temperature, weather_label, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tenant_id) DO UPDATE SET temperature=excluded.temperature, weather_label=excluded.weather_label, updated_at=excluded.updated_at')
          .run(envId, tenantId, temp, weatherLabel, now());
        await audit(db, activeUser, 'UPSERT', 'campus_environment', envId);
        return send(res, 200, { environment: { tenantId, temperature: temp, weatherLabel, updatedAt: now() } });
      }

      // ── User dish preferences (authenticated) ───────────────────
      if (method === 'GET' && url.pathname === '/api/preferences/dishes') {
        const activeUser = await requireUser(db, req);
        const tenantId = tenantIdFor(activeUser);
        const rows = await db.prepare('SELECT * FROM user_dish_preferences WHERE tenant_id = ? AND user_id = ?').all(tenantId, activeUser.id);
        return send(res, 200, { preferences: rows.map(rowToPreference) });
      }

      if (method === 'PUT' && url.pathname === '/api/preferences/dishes') {
        const activeUser = await requireCapability(db, req, 'preference:write');
        const body = await readBody(req);
        if (!body.dishId) throw Object.assign(new Error('缺少 dishId'), { status: 400 });
        const tenantId = tenantIdFor(activeUser);
        const dish = await db.prepare("SELECT id FROM dishes WHERE tenant_id = ? AND id = ? AND status = 'active'").get(tenantId, body.dishId);
        if (!dish) throw Object.assign(new Error('菜品不存在'), { status: 404 });
        const prefId = `udp-${activeUser.id}-${body.dishId}`;
        const favorite = body.favorite !== undefined ? (body.favorite ? 1 : 0) : undefined;
        const existing = await db.prepare('SELECT * FROM user_dish_preferences WHERE tenant_id = ? AND user_id = ? AND dish_id = ?').get(tenantId, activeUser.id, body.dishId);
        if (existing) {
          const sets = ['updated_at = ?'];
          const params = [now()];
          if (favorite !== undefined) { sets.unshift('favorite = ?'); params.unshift(favorite); }
          params.push(tenantId, activeUser.id, body.dishId);
          await db.prepare(`UPDATE user_dish_preferences SET ${sets.join(', ')} WHERE tenant_id = ? AND user_id = ? AND dish_id = ?`).run(...params);
        } else {
          await db.prepare('INSERT INTO user_dish_preferences (id, tenant_id, user_id, dish_id, favorite, eaten_count, drawn_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)')
            .run(prefId, tenantId, activeUser.id, body.dishId, favorite ?? 0, now(), now());
        }
        await audit(db, activeUser, 'UPSERT', 'dish_preference', body.dishId);
        const rows = await db.prepare('SELECT * FROM user_dish_preferences WHERE tenant_id = ? AND user_id = ?').all(tenantId, activeUser.id);
        return send(res, 200, { preferences: rows.map(rowToPreference) });
      }

      if (method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'preferences' && pathParts[2] === 'dishes' && pathParts[3] && pathParts[4] === 'drawn') {
        const activeUser = await requireCapability(db, req, 'preference:write');
        const dishId = decodeURIComponent(pathParts[3]);
        const tenantId = tenantIdFor(activeUser);
        const dish = await db.prepare("SELECT id FROM dishes WHERE tenant_id = ? AND id = ? AND status = 'active'").get(tenantId, dishId);
        if (!dish) throw Object.assign(new Error('菜品不存在'), { status: 404 });
        const prefId = `udp-${activeUser.id}-${dishId}`;
        const existing = await db.prepare('SELECT * FROM user_dish_preferences WHERE tenant_id = ? AND user_id = ? AND dish_id = ?').get(tenantId, activeUser.id, dishId);
        if (existing) {
          await db.prepare('UPDATE user_dish_preferences SET drawn_count = drawn_count + 1, last_drawn_at = ?, updated_at = ? WHERE tenant_id = ? AND user_id = ? AND dish_id = ?')
            .run(now(), now(), tenantId, activeUser.id, dishId);
        } else {
          await db.prepare('INSERT INTO user_dish_preferences (id, tenant_id, user_id, dish_id, favorite, eaten_count, drawn_count, last_drawn_at, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, 1, ?, ?, ?)')
            .run(prefId, tenantId, activeUser.id, dishId, now(), now(), now());
        }
        await audit(db, activeUser, 'DRAW', 'dish_preference', dishId);
        const updated = await db.prepare('SELECT * FROM user_dish_preferences WHERE tenant_id = ? AND user_id = ? AND dish_id = ?').get(tenantId, activeUser.id, dishId);
        return send(res, 200, { preference: rowToPreference(updated) });
      }

      if (method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'preferences' && pathParts[2] === 'dishes' && pathParts[3] && pathParts[4] === 'eaten') {
        const activeUser = await requireCapability(db, req, 'preference:write');
        const dishId = decodeURIComponent(pathParts[3]);
        const tenantId = tenantIdFor(activeUser);
        const dish = await db.prepare("SELECT id FROM dishes WHERE tenant_id = ? AND id = ? AND status = 'active'").get(tenantId, dishId);
        if (!dish) throw Object.assign(new Error('菜品不存在'), { status: 404 });
        const prefId = `udp-${activeUser.id}-${dishId}`;
        const existing = await db.prepare('SELECT * FROM user_dish_preferences WHERE tenant_id = ? AND user_id = ? AND dish_id = ?').get(tenantId, activeUser.id, dishId);
        if (existing) {
          await db.prepare('UPDATE user_dish_preferences SET eaten_count = eaten_count + 1, last_eaten_at = ?, updated_at = ? WHERE tenant_id = ? AND user_id = ? AND dish_id = ?')
            .run(now(), now(), tenantId, activeUser.id, dishId);
        } else {
          await db.prepare('INSERT INTO user_dish_preferences (id, tenant_id, user_id, dish_id, favorite, eaten_count, drawn_count, last_eaten_at, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 1, 0, ?, ?, ?)')
            .run(prefId, tenantId, activeUser.id, dishId, now(), now(), now());
        }
        await audit(db, activeUser, 'EATEN', 'dish_preference', dishId);
        const updated = await db.prepare('SELECT * FROM user_dish_preferences WHERE tenant_id = ? AND user_id = ? AND dish_id = ?').get(tenantId, activeUser.id, dishId);
        return send(res, 200, { preference: rowToPreference(updated) });
      }

        throw Object.assign(new Error('接口不存在'), { status: 404 });
      });
    } catch (error) {
      fail(res, error, requestId);
    }
  }

  return { handler, db };
}

export function createHttpServer(options) {
  const app = createApp(options);
  return createServer(app.handler);
}
