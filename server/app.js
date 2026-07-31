import { createServer } from 'node:http';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { buildHealthPlan, calculateRanking, normalizeProfile } from '../src/domain/recommendation.js';
import { isServingTierCatalogName, openDatabase, parseJson, rowToAiUsageLog, rowToAuditLog, rowToCanteen, rowToDish, rowToEnvironment, rowToMenu, rowToMenuItem, rowToPost, rowToPreference, rowToProfile, rowToReview, rowToStall, rowToTenant, rowToUser, serializeJson } from './database.js';
import { assignableRoles, hasPermission, requirePermission } from './rbac.js';
import { decryptSecret, encryptPhone, encryptSecret, hashPassword, maskedPhone, normalizePhone, phoneLookupHash, publicUser, verifyPassword, verifySignedUploadUrl, verifyToken } from './security.js';
import { deleteStoredUpload, readStoredUpload, storeUpload } from './storage.js';
import { generateAgentToolCalls, generateDishSearchFilterSupplement, generateGroundedAgentAnswer, getAiProviderStatus, identifyDishFromImage, testAiProviderConnection, withAiRuntimeConfig } from './aiProvider.js';
import { createCache, rankingCacheKey } from './cache.js';
import { clientIpFromRequest } from './network.js';
import { handleAuthSessionRoute } from './modules/auth/routes.js';
import { syncLegacyUserIdentities } from './modules/auth/identityService.js';
import { createAuthSession, revokeAllUserSessions, validateAccessSession } from './modules/auth/sessionService.js';
import { getSmsProviderStatus, sendSmsVerificationCode } from './modules/auth/smsProvider.js';
import {
  addDishReferenceImage,
  analyzeTrustworthyMeal,
  confirmMealVisionAnalysis,
  createDishRecipeVersion,
  getMealVisionMetrics,
  listDishRecipeVersions,
  listDishReferenceImages,
  reindexDishReferenceImages,
  updateDishReferenceImage,
} from './visionMealService.js';
import {
  buildKnowledgeAnswer,
  matchFoodCompositionReferencesForQuery,
  parseDishSearchRequest,
  retrieveRoutedKnowledge,
  runDishSearchWorkflow,
  runMealRecommendationWorkflow,
} from './retrievalService.js';
import { CAMPUS_KNOWLEDGE_SOURCE_TYPE, GLOBAL_KNOWLEDGE_TENANT_ID } from './campusDiningKnowledgeBase.js';
import { CAMPUS_POLICY_SOURCE_TYPE } from './knowledgeGovernance.js';
import { loadFoodCompositionReferences } from './healthKnowledgeBase.js';
import { FACT_STATUSES, SAFETY_STATUSES, normalizeSafetyDeclarations } from './diningFacts.js';
import { generateInvitationCode, invitationCodeHash, isValidInvitationCode, normalizeInvitationCode } from './invitationCodes.js';
import { businessDate, businessDayUtcRange } from './time.js';
import { enqueueOutboxEvent, outboxBacklog } from './outbox.js';
import { createRuntimeMetrics } from './metrics.js';
import { normalizeDishPricing, PRICING_MODES } from './dishPricing.js';
import { classifyCatalogItem } from './catalogClassification.js';
import {
  RETRIEVAL_INDEX_VERSION,
  getRetrievalIndexStatus,
  reindexRetrieval,
  searchRetrievalIndex
} from './retrievalIndex.js';
import {
  applyCatalogIntroduction,
  approveCatalogIntroductionBatch,
  listCatalogIntroductionBatches,
  listCatalogIntroductionCandidates,
  loadCatalogIntroductionMap,
  previewCatalogIntroductionBatchApproval,
  rollbackCatalogIntroductionBatch,
  updateCatalogIntroductionCandidate,
} from './catalogIntroductions.js';

const MAX_BODY_BYTES = 128 * 1024;
const MAX_IMPORT_BODY_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_ROWS = 1_000;
const MAX_IMAGE_BODY_BYTES = 8 * 1024 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 180;
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_LOCK_MS = 15 * 60_000;

function loginKey(username, req) {
  const subject = createHash('sha256')
    .update(`${getClientIp(req)}:${String(username || '').trim().toLowerCase()}`)
    .digest('hex');
  return `sc:v1:rate:login:${subject}`;
}

async function assertLoginAllowed(cache, username, req) {
  if (await cache.get(`${loginKey(username, req)}:locked`)) {
    throw Object.assign(new Error('登录失败次数过多，请稍后再试'), { status: 429 });
  }
}

async function recordLoginFailure(cache, username, req) {
  const key = loginKey(username, req);
  const failures = await cache.increment(`${key}:count`, LOGIN_LOCK_MS);
  if (failures >= LOGIN_FAILURE_LIMIT) await cache.set(`${key}:locked`, true, LOGIN_LOCK_MS);
}

async function clearLoginFailures(cache, username, req) {
  const key = loginKey(username, req);
  await Promise.all([cache.del(`${key}:count`), cache.del(`${key}:locked`)]);
}

function tenantIdFor(user) {
  return user?.tenant_id || user?.tenantId || 'default';
}

function catalogTextMatches(value, query) {
  return !query || String(value || '').toLocaleLowerCase().includes(query);
}

function catalogListText(value) {
  if (Array.isArray(value)) return value.join(' ');
  return String(value || '');
}

async function loadAdminCatalogTree(db, { tenantId, regionId = '', canteenId = '', stallId = '', query = '', includeDishes = false, limit = 20, offset = 0 }) {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
  const canteenRows = await db.prepare('SELECT * FROM canteens WHERE tenant_id = ? ORDER BY COALESCE(parent_id, id), display_order ASC, name ASC, id ASC').all(tenantId);
  const stallRows = await db.prepare('SELECT * FROM stalls WHERE tenant_id = ? ORDER BY name ASC, id ASC').all(tenantId);
  const canteens = canteenRows.map(rowToCanteen);
  const stalls = stallRows.map(rowToStall);
  const canteenById = new Map(canteens.map((item) => [item.id, item]));
  const rootCanteens = canteens.filter((item) => !item.parentId || !canteenById.has(item.parentId));
  const selectedCanteenIds = canteenId
    ? [canteenId]
    : regionId
      ? [regionId, ...canteens.filter((item) => item.parentId === regionId).map((item) => item.id)]
      : [];
  const dishCountRows = await db.prepare('SELECT stall_id, COUNT(*) AS count FROM dishes WHERE tenant_id = ? GROUP BY stall_id').all(tenantId);
  const dishCountByStall = new Map(dishCountRows.map((row) => [row.stall_id, Number(row.count || 0)]));
  let dishRows = [];
  if (includeDishes || normalizedQuery) {
    const clauses = ['d.tenant_id = ?'];
    const params = [tenantId];
    if (selectedCanteenIds.length) {
      clauses.push(`s.canteen_id IN (${selectedCanteenIds.map(() => '?').join(', ')})`);
      params.push(...selectedCanteenIds);
    }
    if (stallId) {
      clauses.push('(s.id = ? OR s.parent_id = ?)');
      params.push(stallId, stallId);
    }
    if (normalizedQuery) {
      const pattern = `%${normalizedQuery}%`;
      clauses.push(`LOWER(COALESCE(d.name, '') || ' ' || COALESCE(d.taste, '') || ' ' || COALESCE(d.cuisine, '') || ' ' || COALESCE(d.tags_json, '') || ' ' || COALESCE(d.ingredients_json, '') || ' ' || COALESCE(d.allergens_json, '')) LIKE ?`);
      params.push(pattern);
    }
    dishRows = await db.prepare(`SELECT d.* FROM dishes d JOIN stalls s ON s.id = d.stall_id AND s.tenant_id = d.tenant_id WHERE ${clauses.join(' AND ')} ORDER BY d.name ASC, d.id ASC LIMIT 100`).all(...params);
  }
  const dishes = dishRows.map(rowToDish);
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
    const dishCount = Number(dishCountByStall.get(stall.id) || 0) + children.reduce((sum, child) => sum + child.dishCount, 0);
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
       displayName: canteen.displayName,
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
      || catalogTextMatches(node.stall.floor, normalizedQuery)
      || node.allDirectDishes.some((dish) => [
        dish.name,
        dish.taste,
        dish.cuisine,
        catalogListText(dish.tags),
        catalogListText(dish.ingredients),
        catalogListText(dish.allergens)
      ].some((value) => catalogTextMatches(value, normalizedQuery)))
      || node.children.some((child) => matchesStall(child));
  }

  function matchesCanteen(node) {
    return !normalizedQuery
      || catalogTextMatches(node.canteen.name, normalizedQuery)
      || catalogTextMatches(node.canteen.location, normalizedQuery)
      || node.stalls.some((stall) => matchesStall(stall));
  }

  const regions = rootCanteens
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .filter((region) => !regionId || region.id === regionId)
    .map((region, index) => {
      const children = canteens
        .filter((canteen) => canteen.parentId === region.id)
        .sort((left, right) => left.displayOrder - right.displayOrder);
      const directCatalog = children.length === 0;
      const areaLabel = region.id === 'campus-main'
        ? '餐厅'
        : region.id === 'east-zone'
          ? '楼层'
          : directCatalog
            ? '档口'
            : '下属场所';
      const venueMatches = normalizedQuery && [region.name, region.location]
        .some((value) => catalogTextMatches(value, normalizedQuery));
      const canteenNodes = children.map((canteen) => buildCanteen(canteen, canteen.venueKind || 'dining_area', areaLabel)).filter((node) => {
        if (canteenId && node.canteen.id !== canteenId) return false;
        if (stallId && !node.stalls.some((stall) => stall.stall.id === stallId || stall.children.some((child) => child.stall.id === stallId))) return false;
        return venueMatches || matchesCanteen(node);
      });
      const directStalls = (stallsByCanteen.get(region.id) || []).filter((stall) => !stall.parentId).map(buildStall).filter((node) => venueMatches || matchesStall(node));
      const directMatchesFilter = !canteenId || canteenId === region.id;
      const visibleDirectStalls = directMatchesFilter
        ? directStalls.filter((node) => !stallId || node.stall.id === stallId || node.children.some((child) => child.stall.id === stallId))
        : [];
      const counts = canteenNodes.reduce((total, node) => ({
        canteens: total.canteens + 1,
        stalls: total.stalls + node.stallCount,
        dishes: total.dishes + node.dishCount,
        openStalls: total.openStalls + node.openStallCount
      }), {
        canteens: 0,
        stalls: visibleDirectStalls.reduce((sum, node) => sum + 1 + node.childCount, 0),
        dishes: visibleDirectStalls.reduce((sum, node) => sum + node.dishCount, 0),
        openStalls: visibleDirectStalls.reduce((sum, node) => sum + Number(node.stall.open) + node.children.filter((child) => child.stall.open).length, 0)
      });
      return {
        id: region.id,
        name: region.name,
        defaultName: region.name,
        displayName: region.displayName,
        displayOrder: region.displayOrder,
        operatingStatus: region.operatingStatus,
        position: `venue-${String(index + 1).padStart(2, '0')}`,
        venueType: region.venueKind || 'dining_hall',
        hierarchyMode: directCatalog ? 'direct' : 'grouped',
        supportsDirectStalls: directCatalog,
        areaType: 'venue_area',
        areaLabel,
        missing: false,
        region,
        labels: { venue: '餐饮场所', area: areaLabel, stall: '档口', dish: '菜品' },
        counts,
        canteens: canteenNodes,
        directStalls: visibleDirectStalls
      };
    });
  const safeOffset = Math.max(0, offset);
  const safeLimit = Math.max(1, Math.min(limit, 20));
  const searchMatches = normalizedQuery ? dishes.map((dish) => {
    const stall = stalls.find((item) => item.id === dish.stallId);
    const area = canteenById.get(stall?.canteenId);
    const venue = area?.parentId ? canteenById.get(area.parentId) : area;
    return {
      dishId: dish.id,
      dishName: dish.name,
      stallId: stall?.id || '',
      stallName: stall?.name || '',
      areaId: area?.parentId ? area.id : null,
      areaName: area?.parentId ? (area.displayName || area.name) : null,
      venueId: venue?.id || '',
      venueName: venue?.displayName || venue?.name || '',
    };
  }) : [];
  return { regions: regions.slice(safeOffset, safeOffset + safeLimit), total: regions.length, limit: safeLimit, offset: safeOffset, include: includeDishes ? 'dishes' : 'summary', searchMatches };
}

const DATABASE_ENTITIES = {
  users: { label: '用户', table: 'users', capability: 'user:read', writeCapability: 'user:write', key: 'id', columns: ['id', 'username', 'nickname', 'role', 'created_at', 'updated_at'], writable: ['nickname', 'role'], search: ['username', 'nickname', 'role'] },
  canteens: { label: '餐饮场所', table: 'canteens', capability: 'canteen:write', writeCapability: 'canteen:write', deleteCapability: 'canteen:delete', key: 'id', columns: ['id', 'name', 'display_name', 'display_order', 'operating_status', 'location', 'hours', 'crowd_level', 'tags_json', 'description', 'created_at', 'updated_at'], writable: ['name', 'display_name', 'display_order', 'operating_status', 'location', 'hours', 'crowd_level', 'tags_json', 'description'], search: ['name', 'display_name', 'location'] },
  stalls: { label: '档口', table: 'stalls', capability: 'stall:write', writeCapability: 'stall:write', deleteCapability: 'stall:delete', key: 'id', columns: ['id', 'canteen_id', 'parent_id', 'floor', 'name', 'category', 'rating', 'avg_price', 'open', 'description', 'created_at', 'updated_at'], writable: ['canteen_id', 'floor', 'name', 'category', 'rating', 'avg_price', 'open', 'description'], search: ['name', 'category'] },
  dishes: { label: '菜品与营养', table: 'dishes', capability: 'dish:write', writeCapability: 'dish:write', deleteCapability: 'dish:delete', key: 'id', columns: ['id', 'stall_id', 'name', 'price', 'taste', 'cuisine', 'ingredients_json', 'seasonings_json', 'additives_json', 'tags_json', 'halal', 'meal_types_json', 'calories', 'protein', 'fat', 'carbs', 'rating', 'review_count', 'sales', 'image', 'image_url', 'description', 'status', 'allergens_json', 'safety_declarations_json', 'nutrition_fact_status', 'recipe_fact_status', 'halal_fact_status', 'dietary_fact_status', 'spice_level', 'spice_fact_status', 'fact_source', 'fact_verified_at', 'fact_expires_at', 'data_version', 'synthetic', 'created_at', 'updated_at'], writable: ['stall_id', 'name', 'price', 'taste', 'cuisine', 'ingredients_json', 'seasonings_json', 'additives_json', 'tags_json', 'halal', 'meal_types_json', 'calories', 'protein', 'fat', 'carbs', 'rating', 'review_count', 'sales', 'image', 'image_url', 'description', 'status', 'allergens_json', 'safety_declarations_json', 'nutrition_fact_status', 'recipe_fact_status', 'halal_fact_status', 'dietary_fact_status', 'spice_level', 'spice_fact_status', 'fact_source', 'fact_verified_at', 'fact_expires_at', 'data_version'], search: ['name', 'taste', 'cuisine'] },
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

function persistentUploadReference(value) {
  const raw = String(value || '').trim();
  if (raw.startsWith('upload://')) return raw;
  const match = raw.match(/\/api\/uploads\/([^/?#]+)\/content(?:[?#]|$)/);
  return match ? `upload://${decodeURIComponent(match[1])}` : raw;
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

export function initialDatabaseContext({ claims = null, authRoute = false, requestId = '' } = {}) {
  return {
    tenantId: claims?.tenant || 'default',
    userId: claims?.sub || '',
    role: (claims || authRoute) ? 'authenticator' : 'anonymous',
    requestId
  };
}

function sendBinary(res, status, body, contentType, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': contentType || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(body);
}

function fail(res, error, requestId) {
  const status = error.status || 500;
  if (status === 500 && process.env.LOG_INTERNAL_ERRORS === '1') {
    console.error(`[${requestId}]`, error);
  }
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

function parseJsonField(value, fallback) {
  if (value && typeof value === 'object') return value;
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function getClientIp(req) {
  return clientIpFromRequest(req);
}

async function rateLimit(cache, req) {
  const subject = createHash('sha256').update(getClientIp(req)).digest('hex');
  const count = await cache.increment(`sc:v1:rate:request:${subject}`, RATE_WINDOW_MS);
  const bucket = { count };
  if (bucket.count > RATE_MAX) throw Object.assign(new Error('请求过于频繁，请稍后再试'), { status: 429 });
}

async function getUserFromRequest(db, req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload) return null;
  if (!(await validateAccessSession(db, payload))) return null;
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub) || null;
  if (!user || Number(payload.ver || 0) !== Number(user.token_version || 0)) return null;
  return user;
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

const AUTH_CODE_PURPOSES = new Set(['register', 'reset_password', 'delete_account']);
const AUTH_CODE_TTL_MS = 5 * 60_000;
const AUTH_CODE_RESEND_MS = 60_000;
const AUTH_CODE_HOURLY_LIMIT = 5;
const AUTH_CODE_MAX_ATTEMPTS = 5;
const CURRENT_AGREEMENT_VERSION = String(process.env.CURRENT_AGREEMENT_VERSION || '2026-07').trim() || '2026-07';
let wechatAccessTokenCache = { token: '', expiresAt: 0 };

function assertStudentPassword(value) {
  const password = String(value || '');
  if (password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw Object.assign(new Error('密码需为 8-72 位，且同时包含字母和数字'), { status: 400, code: 'INVALID_PASSWORD' });
  }
  return password;
}

function assertAgreementVersion(value) {
  const version = String(value || '').trim();
  if (!version) throw Object.assign(new Error('请先同意隐私保护指引和用户服务协议'), { status: 400, code: 'AGREEMENT_REQUIRED' });
  if (version !== CURRENT_AGREEMENT_VERSION) {
    throw Object.assign(new Error('请阅读并同意最新版本的隐私保护指引和用户服务协议'), {
      status: 409,
      code: 'AGREEMENT_VERSION_OUTDATED'
    });
  }
  return CURRENT_AGREEMENT_VERSION;
}

function verificationTestCode() {
  if (process.env.NODE_ENV !== 'test') return '';
  return String(process.env.SMS_TEST_CODE || '246810').trim();
}

function invitationRegistrationConfig(env = process.env) {
  const configuredMode = String(env.PILOT_REGISTRATION_MODE || '').trim().toLowerCase();
  return { mode: ['invitation', 'optional', 'sms'].includes(configuredMode) ? configuredMode : 'sms' };
}

function assertInvitationCode(value) {
  const config = invitationRegistrationConfig();
  if (!['invitation', 'optional'].includes(config.mode)) {
    throw Object.assign(new Error('当前未启用邀请码注册'), { status: 400, code: 'INVITATION_REGISTRATION_DISABLED' });
  }
  const code = normalizeInvitationCode(value);
  if (!isValidInvitationCode(code)) throw Object.assign(new Error('邀请码无效或已失效'), { status: 403, code: 'INVALID_INVITATION_CODE' });
  return code;
}

async function authCapabilities(db, tenantId = 'default') {
  const invitation = invitationRegistrationConfig();
  const row = ['invitation', 'optional'].includes(invitation.mode)
    ? await db.prepare(`SELECT COUNT(*) AS count FROM pilot_invitations
        WHERE tenant_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)
          AND NOT EXISTS (
            SELECT 1 FROM pilot_invitation_claims c
            WHERE c.invitation_id = pilot_invitations.id
              AND (c.reclaimed_at IS NOT NULL OR c.claim_expires_at <= ?)
          )`)
      .get(tenantId, now(), now())
    : { count: 0 };
  return {
    registrationMode: invitation.mode,
    invitationConfigured: Number(row?.count || 0) > 0,
    wechatLoginConfigured: Boolean(String(process.env.WECHAT_MINIAPP_APPID || '').trim() && String(process.env.WECHAT_MINIAPP_SECRET || '').trim())
  };
}

function invitationExpiry(value) {
  const raw = String(value || '').trim();
  const candidate = raw ? new Date(raw) : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(candidate.getTime()) || candidate.getTime() <= Date.now()) {
    throw Object.assign(new Error('邀请码有效期必须是未来时间'), { status: 400, code: 'INVALID_INVITATION_EXPIRY' });
  }
  return candidate.toISOString();
}

const MAX_DAILY_INVITATION_QUOTA = 5000;
const DEFAULT_INVITATION_SETTINGS = Object.freeze({
  dailyQuota: 0,
  autoIssue: true,
  expiresAfterDays: 3,
  claimTtlHours: 24,
  issueTime: '09:00',
  timeZone: 'Asia/Shanghai'
});

function normalizeInvitationDate(value) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw Object.assign(new Error('邀请码批次日期格式必须是 YYYY-MM-DD'), { status: 400, code: 'INVALID_INVITATION_DATE' });
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw Object.assign(new Error('邀请码批次日期无效'), { status: 400, code: 'INVALID_INVITATION_DATE' });
  }
  return date;
}

function normalizeInvitationTime(value) {
  const time = String(value || '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw Object.assign(new Error('邀请码发放时间必须是 HH:mm 格式'), { status: 400, code: 'INVALID_INVITATION_ISSUE_TIME' });
  }
  return time;
}

function currentTimeInZone(timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date()).replace('.', ':');
}

function normalizeInvitationSettings(row = {}) {
  return {
    dailyQuota: Number(row.daily_quota ?? DEFAULT_INVITATION_SETTINGS.dailyQuota),
    autoIssue: Number(row.auto_issue ?? (DEFAULT_INVITATION_SETTINGS.autoIssue ? 1 : 0)) === 1,
    expiresAfterDays: Number(row.expires_after_days ?? DEFAULT_INVITATION_SETTINGS.expiresAfterDays),
    claimTtlHours: Number(row.claim_ttl_hours ?? DEFAULT_INVITATION_SETTINGS.claimTtlHours),
    issueTime: String(row.issue_time || DEFAULT_INVITATION_SETTINGS.issueTime),
    timeZone: String(row.time_zone || DEFAULT_INVITATION_SETTINGS.timeZone)
  };
}

function invitationBatchId(tenantId, date) {
  return `invite-batch-${createHash('sha256').update(`${tenantId}:${date}`).digest('hex').slice(0, 24)}`;
}

function invitationStatus(row, timestamp = Date.now()) {
  if (row.status !== 'active') return row.status;
  if (row.expires_at && new Date(row.expires_at).getTime() <= timestamp) return 'expired';
  if (row.reclaimed_at) return 'expired';
  if (row.claimed_at && row.claim_expires_at && new Date(row.claim_expires_at).getTime() <= timestamp) return 'expired';
  if (row.claimed_at) return 'claimed';
  return 'active';
}

function invitationBatchView(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessDate: row.business_date,
    dailyQuota: Number(row.daily_quota || 0),
    issuedCount: Number(row.issued_count || 0),
    remainingQuota: Math.max(0, Number(row.daily_quota || 0) - Number(row.issued_count || 0)),
    status: row.status,
    expiresAt: row.expires_at,
    autoIssued: Number(row.auto_issued || 0) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function ensureInvitationSettings(db, tenantId) {
  const existing = await db.prepare('SELECT * FROM pilot_invitation_settings WHERE tenant_id = ?').get(tenantId);
  if (existing) return existing;
  const timestamp = now();
  await db.prepare(`INSERT INTO pilot_invitation_settings
    (tenant_id, daily_quota, auto_issue, expires_after_days, claim_ttl_hours, issue_time, time_zone, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id) DO NOTHING`)
    .run(tenantId, DEFAULT_INVITATION_SETTINGS.dailyQuota, DEFAULT_INVITATION_SETTINGS.autoIssue ? 1 : 0,
      DEFAULT_INVITATION_SETTINGS.expiresAfterDays, DEFAULT_INVITATION_SETTINGS.claimTtlHours,
      DEFAULT_INVITATION_SETTINGS.issueTime, DEFAULT_INVITATION_SETTINGS.timeZone, timestamp, timestamp);
  return db.prepare('SELECT * FROM pilot_invitation_settings WHERE tenant_id = ?').get(tenantId);
}

async function ensureInvitationBatch(db, tenantId, date, { force = false, createdBy = null } = {}) {
  const settingsRow = await ensureInvitationSettings(db, tenantId);
  const settings = normalizeInvitationSettings(settingsRow);
  const batchId = invitationBatchId(tenantId, date);
  const existing = await db.prepare('SELECT * FROM pilot_invitation_batches WHERE tenant_id = ? AND business_date = ?').get(tenantId, date);
  if (existing) {
    const nextDailyQuota = Math.max(settings.dailyQuota, Number(existing.issued_count || 0));
    if (existing.status === 'active' && Number(existing.daily_quota) !== nextDailyQuota) {
      await db.prepare(`UPDATE pilot_invitation_batches SET daily_quota = ?, updated_at = ?
        WHERE tenant_id = ? AND business_date = ?`)
        .run(nextDailyQuota, now(), tenantId, date);
    }
    return db.prepare('SELECT * FROM pilot_invitation_batches WHERE tenant_id = ? AND business_date = ?').get(tenantId, date);
  }
  if (!force && !settings.autoIssue) return null;
  if (!force && process.env.NODE_ENV !== 'test'
    && date === businessDate(new Date(), settings.timeZone)
    && currentTimeInZone(settings.timeZone) < settings.issueTime) return null;
  if (!existing) {
    const timestamp = now();
    const expiresAt = new Date(Date.now() + settings.expiresAfterDays * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare(`INSERT INTO pilot_invitation_batches
      (id, tenant_id, business_date, daily_quota, issued_count, status, expires_at, created_by, auto_issued, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, 'active', ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, business_date) DO NOTHING`)
      .run(batchId, tenantId, date, settings.dailyQuota, expiresAt, createdBy, force ? 0 : 1, timestamp, timestamp);
  }
  return db.prepare('SELECT * FROM pilot_invitation_batches WHERE tenant_id = ? AND business_date = ?').get(tenantId, date);
}

async function reserveInvitationBatchSlot(tx, batchId) {
  const updated = await tx.prepare(`UPDATE pilot_invitation_batches
    SET issued_count = issued_count + 1, updated_at = ?
    WHERE id = ? AND status = 'active' AND issued_count < daily_quota`).run(now(), batchId);
  if (Number(updated?.changes || 0) !== 1) {
    throw Object.assign(new Error('今日邀请码额度已用完，请调整配额或等待下一批次'), { status: 409, code: 'INVITATION_DAILY_QUOTA_EXHAUSTED' });
  }
}

async function insertInvitationRow(tx, { tenantId, createdBy, expiresAt, batchId = null, claim = null }) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateInvitationCode();
    const hash = invitationCodeHash(code);
    const duplicate = await tx.prepare('SELECT id FROM pilot_invitations WHERE tenant_id = ? AND code_hash = ?').get(tenantId, hash);
    if (duplicate) continue;
    const id = `invite-${randomUUID()}`;
    const timestamp = now();
    await tx.prepare(`INSERT INTO pilot_invitations
      (id, tenant_id, code_hash, code_hint, status, created_by, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
      .run(id, tenantId, hash, code.slice(-4), createdBy || null, expiresAt, timestamp, timestamp);
    if (batchId) {
      await tx.prepare(`INSERT INTO pilot_invitation_batch_items
        (tenant_id, batch_id, invitation_id, created_at) VALUES (?, ?, ?, ?)`)
        .run(tenantId, batchId, id, timestamp);
    }
    if (claim) {
      await tx.prepare(`INSERT INTO pilot_invitation_claims
        (invitation_id, tenant_id, claimed_by, claimed_at, claim_expires_at, revealed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, tenantId, claim.claimedBy, timestamp, claim.claimExpiresAt, timestamp, timestamp);
    }
    return { id, code, codeHint: code.slice(-4), status: claim ? 'claimed' : 'active', expiresAt, batchId };
  }
  throw Object.assign(new Error('邀请码生成失败，请稍后重试'), { status: 503, code: 'INVITATION_GENERATION_FAILED' });
}

async function reclaimExpiredInvitationClaimsInTransaction(tx, { tenantId, batchId = null } = {}) {
  const timestamp = now();
  const batchClause = batchId ? 'AND bi.batch_id = ?' : '';
  const batchParams = batchId ? [batchId] : [];
  const candidates = await tx.prepare(`SELECT p.id, bi.batch_id
    FROM pilot_invitations p
    JOIN pilot_invitation_claims c ON c.invitation_id = p.id AND c.tenant_id = p.tenant_id
    JOIN pilot_invitation_batch_items bi ON bi.invitation_id = p.id AND bi.tenant_id = p.tenant_id
    WHERE p.tenant_id = ? AND p.status = 'active'
      AND c.reclaimed_at IS NULL AND c.claim_expires_at <= ?
      AND (p.expires_at IS NULL OR p.expires_at > ?)
      ${batchClause}
    ORDER BY c.claim_expires_at ASC, p.id ASC`).all(tenantId, timestamp, timestamp, ...batchParams);
  const reclaimed = [];
  for (const candidate of candidates) {
    // Lock the invitation row on PostgreSQL so an expired claim cannot race
    // with registration while its batch slot is being returned.
    const current = tx.isPostgres
      ? await tx.prepare(`SELECT id, status, expires_at FROM pilot_invitations
          WHERE tenant_id = ? AND id = ? FOR UPDATE`).get(tenantId, candidate.id)
      : await tx.prepare('SELECT id, status, expires_at FROM pilot_invitations WHERE tenant_id = ? AND id = ?').get(tenantId, candidate.id);
    if (!current || current.status !== 'active' || (current.expires_at && current.expires_at <= timestamp)) continue;
    const updated = await tx.prepare(`UPDATE pilot_invitation_claims
      SET reclaimed_at = ?, updated_at = ?
      WHERE tenant_id = ? AND invitation_id = ? AND reclaimed_at IS NULL AND claim_expires_at <= ?`).run(
      timestamp, timestamp, tenantId, candidate.id, timestamp
    );
    if (Number(updated?.changes || 0) !== 1) continue;
    await tx.prepare(`UPDATE pilot_invitation_batches
      SET issued_count = CASE WHEN issued_count > 0 THEN issued_count - 1 ELSE 0 END, updated_at = ?
      WHERE tenant_id = ? AND id = ? AND issued_count > 0`).run(timestamp, tenantId, candidate.batch_id);
    reclaimed.push({ invitationId: candidate.id, batchId: candidate.batch_id });
  }
  return reclaimed;
}

async function reclaimExpiredInvitationClaims(db, options) {
  return withTransaction(db, (tx) => reclaimExpiredInvitationClaimsInTransaction(tx, options));
}

async function auditReclaimedInvitationClaims(db, user, reclaimed = []) {
  for (const item of reclaimed) {
    await audit(db, user, 'EXPIRE', 'pilot_invitation', item.invitationId, { batchId: item.batchId });
  }
}

async function consumeInvitationCode(db, tenantId, value, phoneHash) {
  const code = assertInvitationCode(value);
  const hash = invitationCodeHash(code);
  const updated = await db.prepare(`UPDATE pilot_invitations
    SET status = 'consumed', used_phone_hash = ?, used_at = ?, updated_at = ?
    WHERE tenant_id = ? AND code_hash = ? AND status = 'active'
      AND (expires_at IS NULL OR expires_at > ?)
      AND NOT EXISTS (
        SELECT 1 FROM pilot_invitation_claims c
        WHERE c.invitation_id = pilot_invitations.id
          AND (c.reclaimed_at IS NOT NULL OR c.claim_expires_at <= ?)
      )`)
    .run(phoneHash, now(), now(), tenantId, hash, now(), now());
  if (Number(updated?.changes || 0) !== 1) {
    throw Object.assign(new Error('邀请码无效、已使用或已过期'), { status: 403, code: 'INVALID_INVITATION_CODE' });
  }
  return { code, hash };
}

async function generateInvitationRows(db, { tenantId, count, expiresAt, createdBy, batchId = null }) {
  return withTransaction(db, async (tx) => {
    const rows = [];
    for (let index = 0; index < count; index += 1) {
      if (batchId) await reserveInvitationBatchSlot(tx, batchId);
      rows.push(await insertInvitationRow(tx, { tenantId, createdBy, expiresAt, batchId }));
    }
    return rows;
  });
}

async function claimInvitationSlot(db, { tenantId, batchId, claimedBy }) {
  const settings = normalizeInvitationSettings(await ensureInvitationSettings(db, tenantId));
  return withTransaction(db, async (tx) => {
    const reclaimedInvitationIds = await reclaimExpiredInvitationClaimsInTransaction(tx, { tenantId, batchId });
    const batch = await tx.prepare('SELECT * FROM pilot_invitation_batches WHERE tenant_id = ? AND id = ?').get(tenantId, batchId);
    if (!batch) throw Object.assign(new Error('邀请码批次不存在或不属于当前租户'), { status: 404, code: 'INVITATION_BATCH_NOT_FOUND' });
    if (batch.status !== 'active') throw Object.assign(new Error('邀请码批次已停止发放'), { status: 409, code: 'INVITATION_BATCH_NOT_ACTIVE' });
    await reserveInvitationBatchSlot(tx, batch.id);
    const claimExpiresAt = new Date(Date.now() + settings.claimTtlHours * 60 * 60 * 1000).toISOString();
    const invitation = await insertInvitationRow(tx, {
      tenantId,
      createdBy: claimedBy,
      expiresAt: batch.expires_at,
      batchId: batch.id,
      claim: { claimedBy, claimExpiresAt }
    });
    return { invitation, reclaimedInvitationIds };
  });
}

function invitationRowView(row) {
  return {
    id: row.id,
    batchId: row.batch_id || null,
    businessDate: row.business_date || null,
    codeHint: row.code_hint,
    status: invitationStatus(row),
    expiresAt: row.expires_at,
    claimedBy: row.claimed_by || null,
    claimedAt: row.claimed_at || null,
    claimExpiresAt: row.claim_expires_at || null,
    reclaimedAt: row.reclaimed_at || null,
    usedAt: row.used_at,
    usedUserId: row.used_user_id,
    usedPhone: row.phone_encrypted ? maskedPhone(decryptSecret(row.phone_encrypted)) : null,
    usedPhoneVerified: Boolean(row.phone_verified_at),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function invitationSummary(db, tenantId, date) {
  const settingsRow = await ensureInvitationSettings(db, tenantId);
  const settings = normalizeInvitationSettings(settingsRow);
  const batch = await ensureInvitationBatch(db, tenantId, date, { createdBy: null });
  const rows = batch
    ? await db.prepare(`SELECT p.status, p.expires_at, c.claimed_at, c.claim_expires_at
        FROM pilot_invitation_batch_items bi
        JOIN pilot_invitations p ON p.id = bi.invitation_id AND p.tenant_id = bi.tenant_id
        LEFT JOIN pilot_invitation_claims c ON c.invitation_id = p.id AND c.tenant_id = p.tenant_id
        WHERE bi.tenant_id = ? AND bi.batch_id = ?`).all(tenantId, batch.id)
    : [];
  const counts = { active: 0, claimed: 0, consumed: 0, revoked: 0, expired: 0 };
  for (const row of rows) counts[invitationStatus(row)] = (counts[invitationStatus(row)] || 0) + 1;
  const registrations = batch
    ? await db.prepare(`SELECT p.id AS invitation_id, p.code_hint, p.used_at, p.used_user_id,
          u.phone_encrypted, u.phone_verified_at
        FROM pilot_invitation_batch_items bi
        JOIN pilot_invitations p ON p.id = bi.invitation_id AND p.tenant_id = bi.tenant_id
        LEFT JOIN users u ON u.id = p.used_user_id AND u.tenant_id = p.tenant_id
        WHERE bi.tenant_id = ? AND bi.batch_id = ? AND p.status = 'consumed'
        ORDER BY p.used_at DESC, p.id DESC`).all(tenantId, batch.id)
      : [];
  return {
    settings,
    batch: invitationBatchView(batch),
    counts: {
      ...counts,
      generated: Number(batch?.issued_count || 0),
      available: Number(counts.active || 0),
      remainingQuota: Math.max(0, Number(batch?.daily_quota || settings.dailyQuota) - Number(batch?.issued_count || 0))
    },
    registrations: {
      count: registrations.length,
      items: registrations.map((row) => ({
        invitationId: row.invitation_id,
        codeHint: row.code_hint,
        phone: row.phone_encrypted ? maskedPhone(decryptSecret(row.phone_encrypted)) : '未提供',
        phoneVerified: Boolean(row.phone_verified_at),
        registeredAt: row.used_at,
        userId: row.used_user_id || null
      }))
    },
    businessDate: date,
    serverTime: now()
  };
}

function startInvitationBatchScheduler(db) {
  if (process.env.NODE_ENV === 'test') return null;
  const run = async () => {
    let settings = [];
    try {
      const listSettings = () => db.prepare('SELECT tenant_id, time_zone FROM pilot_invitation_settings WHERE auto_issue = 1').all();
      settings = typeof db.runWithContext === 'function'
        ? await db.runWithContext({ tenantId: '*', userId: '', role: 'super_admin', requestId: 'invitation-scheduler-list' }, listSettings)
        : await listSettings();
    }
    catch { return; }
    for (const setting of settings) {
      const operation = () => ensureInvitationBatch(db, setting.tenant_id, businessDate(new Date(), setting.time_zone), { createdBy: null });
      await (typeof db.runWithContext === 'function'
        ? db.runWithContext({ tenantId: setting.tenant_id, userId: '', role: 'authenticator' }, operation)
        : operation()).catch(() => {});
    }
  };
  const timer = setInterval(() => { void run(); }, 60_000);
  timer.unref?.();
  void run();
  return timer;
}

function pilotRuntimeConfig(env = process.env) {
  const configuredMode = String(env.PILOT_MODE || '').trim().toLowerCase();
  const mode = ['team', 'invite', 'open'].includes(configuredMode)
    ? configuredMode
    : env.NODE_ENV === 'production'
      ? 'team'
      : 'open';
  const defaultDisabled = mode === 'open' ? [] : ['community_write', 'review_write'];
  const disabled = new Set([
    ...defaultDisabled,
    ...String(env.PILOT_DISABLED_FEATURES || '').split(',').map((value) => value.trim()).filter(Boolean)
  ]);
  const allowedPhoneHashes = new Set(
    String(env.PILOT_ALLOWED_PHONE_HASHES || '').split(',').map((value) => value.trim()).filter(Boolean)
  );
  return { mode, disabled, allowedPhoneHashes };
}

function assertNewRegistrationAllowed(phone, { invitation = false } = {}) {
  const pilot = pilotRuntimeConfig();
  if (pilot.mode === 'open') return;
  if (pilot.mode === 'team') {
    throw Object.assign(new Error('当前仅开放已创建的团队体验账号登录'), {
      status: 403,
      code: 'PILOT_REGISTRATION_CLOSED'
    });
  }
  if (pilot.mode === 'invite' && invitation) return;
  if (!pilot.allowedPhoneHashes.has(phoneLookupHash(phone))) {
    throw Object.assign(new Error('当前仅向受邀用户开放注册'), {
      status: 403,
      code: 'PILOT_INVITATION_REQUIRED'
    });
  }
}

function disabledPilotWriteFeature(method, pathname, pathParts) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return '';
  if (pathname === '/api/reviews' || pathParts[1] === 'reviews') return 'review_write';
  if (pathname === '/api/posts' || pathParts[1] === 'posts') return 'community_write';
  if (pathname === '/api/orders') return 'order_write';
  return '';
}

function assertPilotWriteAllowed(feature) {
  if (!feature || !pilotRuntimeConfig().disabled.has(feature)) return;
  throw Object.assign(new Error('该功能在当前试运行阶段暂未开放'), {
    status: 403,
    code: 'PILOT_FEATURE_DISABLED'
  });
}

async function issueVerificationCode(db, req, body = {}) {
  const phone = normalizePhone(body.phone);
  const purpose = String(body.purpose || '').trim();
  if (!phone) throw Object.assign(new Error('请输入有效的中国大陆手机号'), { status: 400, code: 'INVALID_PHONE' });
  if (!AUTH_CODE_PURPOSES.has(purpose)) throw Object.assign(new Error('验证码用途不合法'), { status: 400, code: 'INVALID_CODE_PURPOSE' });
  if (purpose === 'register' && invitationRegistrationConfig().mode === 'invitation') {
    throw Object.assign(new Error('当前注册模式使用邀请码，不需要短信验证码'), { status: 400, code: 'VERIFICATION_CODE_NOT_NEEDED' });
  }
  const smsStatus = getSmsProviderStatus();
  if (!smsStatus.ready) {
    const missing = smsStatus.missing?.length ? `（缺少 ${smsStatus.missing.join('、')}）` : '';
    throw Object.assign(new Error(`短信服务尚未配置${missing}`), { status: 503, code: 'SMS_PROVIDER_NOT_CONFIGURED' });
  }
  if (purpose === 'register') assertNewRegistrationAllowed(phone);
  const tenantId = 'default';
  const hash = phoneLookupHash(phone);
  const current = Date.now();
  const oneHourAgo = new Date(current - 60 * 60_000).toISOString();
  const recent = await db.prepare('SELECT created_at FROM auth_verification_codes WHERE tenant_id = ? AND phone_hash = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1').get(tenantId, hash, purpose);
  if (recent && current - Date.parse(recent.created_at) < AUTH_CODE_RESEND_MS) {
    throw Object.assign(new Error('验证码发送过于频繁，请稍后再试'), { status: 429, code: 'CODE_RESEND_TOO_SOON' });
  }
  const phoneCount = Number((await db.prepare('SELECT COUNT(*) AS count FROM auth_verification_codes WHERE tenant_id = ? AND phone_hash = ? AND created_at >= ?').get(tenantId, hash, oneHourAgo))?.count || 0);
  const ip = getClientIp(req);
  const ipCount = Number((await db.prepare('SELECT COUNT(*) AS count FROM auth_verification_codes WHERE tenant_id = ? AND requested_ip = ? AND created_at >= ?').get(tenantId, ip, oneHourAgo))?.count || 0);
  if (phoneCount >= AUTH_CODE_HOURLY_LIMIT || ipCount >= AUTH_CODE_HOURLY_LIMIT) {
    throw Object.assign(new Error('验证码请求次数过多，请一小时后再试'), { status: 429, code: 'CODE_RATE_LIMITED' });
  }
  const code = verificationTestCode() || String(randomInt(100000, 1000000));
  const createdAt = now();
  const verificationId = `auth-code-${randomUUID()}`;
  await db.prepare('INSERT INTO auth_verification_codes (id, tenant_id, phone_hash, purpose, code_hash, requested_ip, attempts, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(verificationId, tenantId, hash, purpose, hashPassword(code), ip, 0, new Date(current + AUTH_CODE_TTL_MS).toISOString(), null, createdAt);
  let delivery;
  try {
    delivery = await sendSmsVerificationCode({ phone, code, purpose });
  } catch (error) {
    await db.prepare('DELETE FROM auth_verification_codes WHERE id = ?').run(verificationId);
    throw error;
  }
  return {
    accepted: true,
    expiresIn: Math.floor(AUTH_CODE_TTL_MS / 1000),
    retryAfter: Math.floor(AUTH_CODE_RESEND_MS / 1000),
    ...(delivery.testCode ? { testCode: code } : {})
  };
}

async function consumeVerificationCode(db, phone, purpose, value) {
  const normalized = normalizePhone(phone);
  const code = String(value || '').trim();
  if (!normalized || !/^\d{6}$/.test(code)) throw Object.assign(new Error('手机号或验证码格式错误'), { status: 400, code: 'INVALID_VERIFICATION_CODE' });
  const hash = phoneLookupHash(normalized);
  const row = await db.prepare('SELECT * FROM auth_verification_codes WHERE tenant_id = ? AND phone_hash = ? AND purpose = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1').get('default', hash, purpose);
  if (!row || Date.parse(row.expires_at) <= Date.now()) throw Object.assign(new Error('验证码不存在或已过期'), { status: 400, code: 'VERIFICATION_CODE_EXPIRED' });
  if (Number(row.attempts || 0) >= AUTH_CODE_MAX_ATTEMPTS) throw Object.assign(new Error('验证码尝试次数过多，请重新获取'), { status: 429, code: 'VERIFICATION_CODE_LOCKED' });
  if (!verifyPassword(code, row.code_hash)) {
    const attemptedAt = now();
    const updated = await db.prepare(`
      UPDATE auth_verification_codes
      SET attempts = attempts + 1,
          consumed_at = CASE WHEN attempts + 1 >= ? THEN ? ELSE consumed_at END
      WHERE id = ? AND consumed_at IS NULL AND attempts < ?
    `).run(AUTH_CODE_MAX_ATTEMPTS, attemptedAt, row.id, AUTH_CODE_MAX_ATTEMPTS);
    if (Number(updated.changes || 0) !== 1) {
      throw Object.assign(new Error('验证码不存在或已过期'), { status: 400, code: 'VERIFICATION_CODE_EXPIRED' });
    }
    throw Object.assign(new Error('验证码错误'), { status: 400, code: 'INVALID_VERIFICATION_CODE' });
  }
  const consumed = await db.prepare(`
    UPDATE auth_verification_codes
    SET consumed_at = ?
    WHERE id = ? AND consumed_at IS NULL AND attempts < ? AND expires_at > ?
  `).run(now(), row.id, AUTH_CODE_MAX_ATTEMPTS, now());
  if (Number(consumed.changes || 0) !== 1) {
    throw Object.assign(new Error('验证码不存在或已过期'), { status: 400, code: 'VERIFICATION_CODE_EXPIRED' });
  }
  return normalized;
}

async function createPendingHealthProfile(db, userId, tenantId = 'default') {
  await db.prepare('INSERT INTO health_profiles (user_id, tenant_id, goal, budget_max, meal_type, taste, halal_only, avoid_json, allergies_json, dietary_pattern, spice_level, nutrition_focus_json, prefer_low_crowd, favorite_tags_json, onboarding_status, allergy_status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(userId, tenantId, 'healthy', 20, 'lunch', '不限', 0, '[]', '[]', 'unrestricted', 0, '[]', 0, '[]', 'pending', 'unknown', now());
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

async function getWechatAccessToken() {
  if (wechatAccessTokenCache.token && wechatAccessTokenCache.expiresAt > Date.now() + 60_000) return wechatAccessTokenCache.token;
  const appid = process.env.WECHAT_MINIAPP_APPID;
  const secret = process.env.WECHAT_MINIAPP_SECRET;
  if (!appid || !secret) throw Object.assign(new Error('微信小程序登录未配置'), { status: 503, code: 'WECHAT_NOT_CONFIGURED' });
  const endpoint = new URL('https://api.weixin.qq.com/cgi-bin/token');
  endpoint.searchParams.set('grant_type', 'client_credential');
  endpoint.searchParams.set('appid', appid);
  endpoint.searchParams.set('secret', secret);
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(Number(process.env.WECHAT_LOGIN_TIMEOUT_MS || 8000)) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.errcode || !data.access_token) throw Object.assign(new Error(data.errmsg || '微信服务凭证获取失败'), { status: 502, code: 'WECHAT_TOKEN_FAILED' });
  wechatAccessTokenCache = { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 7200) * 1000 };
  return data.access_token;
}

async function exchangeWechatPhone(phoneCode) {
  const code = String(phoneCode || '').trim();
  if (!code) throw Object.assign(new Error('首次微信登录需要授权手机号'), { status: 400, code: 'WECHAT_PHONE_REQUIRED' });
  const accessToken = await getWechatAccessToken();
  const response = await fetch(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(Number(process.env.WECHAT_LOGIN_TIMEOUT_MS || 8000))
  });
  const data = await response.json().catch(() => ({}));
  const phone = normalizePhone(data.phone_info?.purePhoneNumber || data.phone_info?.phoneNumber);
  if (!response.ok || data.errcode || !phone) throw Object.assign(new Error(data.errmsg || '微信手机号授权失败'), { status: 401, code: 'WECHAT_PHONE_FAILED' });
  return phone;
}

async function findOrCreateWechatUser(db, session, { profile = {}, phoneCode = '', agreementVersion = '' } = {}) {
  const openid = String(session.openid || '').trim();
  if (!openid) throw Object.assign(new Error('微信登录缺少 openid'), { status: 401 });
  const existing = await db.prepare('SELECT * FROM users WHERE wechat_openid = ?').get(openid);
  if (existing) {
    if (!phoneCode) return { user: existing, isNewUser: false };
    const phone = await exchangeWechatPhone(phoneCode);
    const hash = phoneLookupHash(phone);
    const phoneUser = await db.prepare('SELECT * FROM users WHERE tenant_id = ? AND phone_hash = ?').get(tenantIdFor(existing), hash);
    if (phoneUser && phoneUser.id !== existing.id) {
      throw Object.assign(new Error('该手机号与当前微信分别绑定了不同账号，请联系管理员处理'), { status: 409, code: 'WECHAT_BINDING_CONFLICT' });
    }
    if (existing.phone_hash && existing.phone_hash !== hash) {
      throw Object.assign(new Error('当前微信已绑定其他手机号'), { status: 409, code: 'WECHAT_BINDING_CONFLICT' });
    }
    const agreement = agreementVersion ? assertAgreementVersion(agreementVersion) : existing.agreement_version;
    await db.prepare('UPDATE users SET phone_hash = ?, phone_encrypted = ?, phone_verified_at = COALESCE(phone_verified_at, ?), agreement_version = ?, agreement_accepted_at = COALESCE(agreement_accepted_at, ?), updated_at = ? WHERE id = ?')
      .run(hash, encryptPhone(phone), now(), agreement || '', now(), now(), existing.id);
    return { user: await db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id), isNewUser: false };
  }
  const agreement = assertAgreementVersion(agreementVersion);
  const developmentPhone = process.env.NODE_ENV === 'production' ? '' : normalizePhone(profile.phone);
  const phone = developmentPhone || await exchangeWechatPhone(phoneCode);
  const hash = phoneLookupHash(phone);
  const phoneUser = await db.prepare('SELECT * FROM users WHERE tenant_id = ? AND phone_hash = ?').get('default', hash);
  if (phoneUser) {
    if (phoneUser.wechat_openid && phoneUser.wechat_openid !== openid) throw Object.assign(new Error('该手机号已绑定其他微信账号'), { status: 409, code: 'WECHAT_BINDING_CONFLICT' });
    await db.prepare('UPDATE users SET wechat_openid = ?, phone_verified_at = COALESCE(phone_verified_at, ?), agreement_version = ?, agreement_accepted_at = COALESCE(agreement_accepted_at, ?), updated_at = ? WHERE id = ?')
      .run(openid, now(), agreement, now(), now(), phoneUser.id);
    return { user: await db.prepare('SELECT * FROM users WHERE id = ?').get(phoneUser.id), isNewUser: false };
  }
  assertNewRegistrationAllowed(phone);
  const id = `u-${randomUUID()}`;
  const tenantId = 'default';
  const username = `student_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const nickname = String(profile.nickname || profile.nickName || '微信用户').trim().slice(0, 32) || '微信用户';
  const timestamp = now();
  await db.prepare('INSERT INTO users (id, tenant_id, username, password_hash, nickname, role, wechat_openid, phone_hash, phone_encrypted, phone_verified_at, token_version, agreement_version, agreement_accepted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, tenantId, username, hashPassword(randomUUID()), nickname, 'student', openid, hash, encryptPhone(phone), timestamp, 0, agreement, timestamp, timestamp, timestamp);
  await createPendingHealthProfile(db, id, tenantId);
  return { user: await db.prepare('SELECT * FROM users WHERE id = ?').get(id), isNewUser: true };
}

async function authenticatedSessionResponse(db, req, user, extra = {}) {
  await syncLegacyUserIdentities(db, user);
  const session = await createAuthSession(db, user, {
    userAgent: req.headers['user-agent'] || '',
    clientIp: getClientIp(req)
  });
  if (typeof db.updateContext === 'function') {
    db.updateContext({
      tenantId: tenantIdFor(user),
      userId: user.id,
      role: user.role
    });
  }
  return {
    user: publicUser(user),
    ...session,
    state: await clientBootstrapSnapshot(db, user),
    ...extra
  };
}

function exportRecord(row) {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    key.endsWith('_json') ? parseJson(value, value) : value
  ]));
}

async function buildAccountDataExport(db, user) {
  const tenantId = tenantIdFor(user);
  const [profile, preferences, orders, reviews, posts, analyses, memories, uploads, identities] = await Promise.all([
    db.prepare('SELECT * FROM health_profiles WHERE tenant_id = ? AND user_id = ?').get(tenantId, user.id),
    db.prepare('SELECT * FROM user_dish_preferences WHERE tenant_id = ? AND user_id = ? ORDER BY updated_at DESC').all(tenantId, user.id),
    db.prepare('SELECT * FROM orders WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC').all(tenantId, user.id),
    db.prepare('SELECT * FROM reviews WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC').all(tenantId, user.id),
    db.prepare('SELECT * FROM campus_posts WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC').all(tenantId, user.id),
    db.prepare('SELECT * FROM meal_vision_analyses WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC').all(tenantId, user.id),
    db.prepare('SELECT * FROM agent_memories WHERE tenant_id = ? AND user_id = ?').all(tenantId, user.id),
    db.prepare('SELECT id, filename, content_type, size_bytes, visibility, created_at FROM uploads WHERE tenant_id = ? AND owner_id = ? ORDER BY created_at DESC').all(tenantId, user.id),
    db.prepare('SELECT provider, verified_at, status, created_at, updated_at FROM user_identities WHERE tenant_id = ? AND user_id = ? ORDER BY provider ASC').all(tenantId, user.id)
  ]);
  const phone = normalizePhone(decryptSecret(user.phone_encrypted));
  return {
    format: 'smart-canteen-account-export/v1',
    exportedAt: now(),
    account: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
      tenantId,
      phone: phone || null,
      phoneVerifiedAt: user.phone_verified_at || null,
      wechatMiniappBound: Boolean(user.wechat_openid),
      agreementVersion: user.agreement_version || '',
      agreementAcceptedAt: user.agreement_accepted_at || null,
      createdAt: user.created_at,
      updatedAt: user.updated_at
    },
    identities: identities.map(exportRecord),
    healthProfile: exportRecord(profile),
    dishPreferences: preferences.map(exportRecord),
    orders: orders.map(exportRecord),
    reviews: reviews.map(exportRecord),
    posts: posts.map(exportRecord),
    mealVisionAnalyses: analyses.map(exportRecord),
    agentMemories: memories.map(exportRecord),
    uploadMetadata: uploads.map(exportRecord)
  };
}

async function assertAccountDeletionVerification(db, user, body = {}) {
  if (String(body.confirmation || '').trim() !== 'DELETE_MY_ACCOUNT') {
    throw Object.assign(new Error('请确认注销操作'), { status: 400, code: 'ACCOUNT_DELETION_CONFIRMATION_REQUIRED' });
  }
  const password = String(body.currentPassword || '');
  if (password && verifyPassword(password, user.password_hash)) return;

  const phone = normalizePhone(body.phone);
  if (phone && user.phone_hash && phoneLookupHash(phone) === user.phone_hash && body.verificationCode) {
    await consumeVerificationCode(db, phone, 'delete_account', body.verificationCode);
    return;
  }

  const wechatCode = String(body.wechatCode || '').trim();
  if (wechatCode && user.wechat_openid) {
    const session = await exchangeWechatCode(wechatCode);
    if (session.openid === user.wechat_openid) return;
  }
  throw Object.assign(new Error('请使用当前密码、已验证手机号验证码或微信授权完成二次确认'), {
    status: 400,
    code: 'ACCOUNT_DELETION_VERIFICATION_REQUIRED'
  });
}

async function deleteAccount(db, user) {
  if (user.role !== 'student') {
    throw Object.assign(new Error('管理账号需要先完成权限交接，不能自助注销'), {
      status: 409,
      code: 'ACCOUNT_DELETION_REQUIRES_ADMIN_TRANSFER'
    });
  }
  const tenantId = tenantIdFor(user);
  const uploads = await db.prepare('SELECT * FROM uploads WHERE tenant_id = ? AND owner_id = ?').all(tenantId, user.id);
  for (const upload of uploads) await deleteStoredUpload(upload);

  await withTransaction(db, async (transactionDb) => {
    await transactionDb.prepare('DELETE FROM uploads WHERE tenant_id = ? AND owner_id = ?').run(tenantId, user.id);
    await transactionDb.prepare('DELETE FROM users WHERE tenant_id = ? AND id = ?').run(tenantId, user.id);
    await audit(transactionDb, user, 'DELETE_ACCOUNT', 'user', user.id, {
      channel: 'self_service',
      deletedUploads: uploads.length
    });
  });
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

async function applyApprovedIntroductions(db, tenantId, entityType, entities) {
  if (!entities.length) return entities;
  const introductions = await loadCatalogIntroductionMap(db, {
    tenantId,
    entityType,
    statuses: ['approved'],
    entityIds: entities.map((entity) => entity.id),
  });
  return entities.map((entity) => applyCatalogIntroduction(entity, introductions.get(`${entityType}:${entity.id}`)));
}

async function listCanteens(db, tenantId = 'default') {
  const canteens = (await db.prepare(`SELECT c.* FROM canteens c
    LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = c.tenant_id
    WHERE c.tenant_id = ? AND c.review_status = 'approved'
      AND (c.parent_id IS NULL OR parent.review_status = 'approved')
    ORDER BY CASE WHEN c.parent_id IS NULL THEN c.display_order ELSE 999 END, c.parent_id, c.display_order, c.name, c.id`).all(tenantId)).map(rowToCanteen);
  return applyApprovedIntroductions(db, tenantId, 'canteen', canteens);
}

async function listStalls(db, tenantId = 'default') {
  const stalls = (await db.prepare(`SELECT s.* FROM stalls s
    JOIN canteens c ON c.id = s.canteen_id AND c.tenant_id = s.tenant_id
    LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = c.tenant_id
    WHERE s.tenant_id = ? AND s.review_status = 'approved' AND c.review_status = 'approved'
      AND (c.parent_id IS NULL OR parent.review_status = 'approved')
    ORDER BY s.canteen_id, s.floor, s.name`).all(tenantId)).map(rowToStall);
  return applyApprovedIntroductions(db, tenantId, 'stall', stalls);
}

function normalizeStallParentId(value) {
  if (value == null) return null;
  return String(value).trim() || null;
}

async function requireCatalogDiningArea(db, { tenantId, canteenId }) {
  const area = await db.prepare('SELECT id, parent_id, venue_kind FROM canteens WHERE tenant_id = ? AND id = ?').get(tenantId, canteenId);
  if (!area) {
    throw Object.assign(new Error('所属食堂不存在，或餐饮分区不属于当前租户'), {
      status: 400,
      code: 'STALL_CANTEEN_NOT_FOUND'
    });
  }
  if (!area.parent_id) {
    const childCount = Number((await db.prepare('SELECT COUNT(*) AS count FROM canteens WHERE tenant_id = ? AND parent_id = ?').get(tenantId, area.id))?.count || 0);
    if (childCount === 0) return area;
    throw Object.assign(new Error('该餐饮场所有下属餐厅或楼层，请先选择下一级再维护档口'), {
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
      throw Object.assign(new Error('新建或迁移菜品必须选择有效餐厅、楼层或直属场所下的档口'), {
        status: 400,
        code: 'DISH_STALL_AREA_REQUIRED'
      });
    }
    throw error;
  }
  return stall;
}

async function findPublishedDish(db, tenantId, dishId) {
  return db.prepare(`SELECT d.* FROM dishes d
    JOIN stalls s ON s.id = d.stall_id AND s.tenant_id = d.tenant_id
    JOIN canteens c ON c.id = s.canteen_id AND c.tenant_id = d.tenant_id
    LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = c.tenant_id
    WHERE d.tenant_id = ? AND d.id = ? AND d.status = 'active' AND d.review_status = 'approved'
      AND s.review_status = 'approved' AND c.review_status = 'approved'
      AND (c.parent_id IS NULL OR parent.review_status = 'approved')`).get(tenantId, dishId);
}

async function findPublishedCanteen(db, tenantId, canteenId) {
  return db.prepare(`SELECT c.* FROM canteens c
    LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = c.tenant_id
    WHERE c.tenant_id = ? AND c.id = ? AND c.review_status = 'approved'
      AND (c.parent_id IS NULL OR parent.review_status = 'approved')`).get(tenantId, canteenId);
}

async function requirePublishedCatalogTarget(db, tenantId, targetType, targetId) {
  const target = targetType === 'dish'
    ? await findPublishedDish(db, tenantId, targetId)
    : await findPublishedCanteen(db, tenantId, targetId);
  if (!target) {
    throw Object.assign(new Error(targetType === 'dish' ? '关联菜品不存在或尚未发布' : '关联食堂不存在或尚未发布'), {
      status: 404,
      code: 'CATALOG_TARGET_NOT_PUBLISHED'
    });
  }
  return target;
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
  const mapped = (await db.prepare(`SELECT d.* FROM dishes d
    JOIN stalls s ON s.id = d.stall_id AND s.tenant_id = d.tenant_id
    JOIN canteens c ON c.id = s.canteen_id AND c.tenant_id = d.tenant_id
    LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = c.tenant_id
    WHERE d.tenant_id = ? AND d.status = 'active' AND d.review_status = 'approved'
      AND s.review_status = 'approved' AND c.review_status = 'approved'
      AND (c.parent_id IS NULL OR parent.review_status = 'approved')
    ORDER BY d.name`).all(tenantId)).map(rowToDish);
  const rows = await applyApprovedIntroductions(db, tenantId, 'dish', mapped);
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
  const [dishes, stalls, canteens] = await Promise.all([
    listDishes(db, new URLSearchParams(), tenantId),
    listStalls(db, tenantId),
    listCanteens(db, tenantId),
  ]);
  return {
    dishes: new Map(dishes.map((item) => [item.id, item])),
    stalls: new Map(stalls.map((item) => [item.id, item])),
    canteens: new Map(canteens.map((item) => [item.id, item]))
  };
}

function enrichReview(review, catalog, currentUserId = '') {
  const dish = review.targetType === 'dish' ? catalog.dishes.get(review.targetId) || null : null;
  const stall = dish ? catalog.stalls.get(dish.stallId) || null : null;
  const canteen = review.targetType === 'canteen'
    ? catalog.canteens.get(review.targetId) || null
    : (stall ? catalog.canteens.get(stall.canteenId) || null : null);
  return {
    ...review,
    dish: dish ? { id: dish.id, name: dish.name, image: dish.image, imageUrl: dish.imageUrl, price: dish.price } : null,
    stall: stall ? { id: stall.id, name: stall.name, floor: stall.floor } : null,
    canteen: canteen ? { id: canteen.id, name: canteen.name, location: canteen.location } : null,
    isOwn: review.userId === currentUserId,
    canEdit: review.userId === currentUserId && !review.linkedPostId,
    canDelete: review.userId === currentUserId
  };
}

function enrichPost(post, catalog, currentUserId = '') {
  const contextual = enrichReview({ targetType: post.targetType, targetId: post.targetId }, catalog);
  return {
    ...post,
    dish: contextual.dish,
    stall: contextual.stall,
    canteen: contextual.canteen,
    isOwn: post.userId === currentUserId,
    canEdit: post.userId === currentUserId,
    canDelete: post.userId === currentUserId
  };
}

async function attachCommunityEngagement(db, tenantId, currentUserId, targetType, items) {
  if (!items.length) return items;
  const ids = [...new Set(items.map((item) => item.id))];
  const placeholders = ids.map(() => '?').join(',');
  const [reactionRows, viewerRows, reportRows, commentRows] = await Promise.all([
    db.prepare(`SELECT target_id, reaction, COUNT(*) AS count FROM content_reactions WHERE tenant_id = ? AND target_type = ? AND target_id IN (${placeholders}) GROUP BY target_id, reaction`).all(tenantId, targetType, ...ids),
    db.prepare(`SELECT target_id, reaction FROM content_reactions WHERE tenant_id = ? AND target_type = ? AND user_id = ? AND target_id IN (${placeholders})`).all(tenantId, targetType, currentUserId, ...ids),
    db.prepare(`SELECT target_id FROM content_reports WHERE tenant_id = ? AND target_type = ? AND reporter_id = ? AND status = 'pending' AND target_id IN (${placeholders})`).all(tenantId, targetType, currentUserId, ...ids),
    targetType === 'post'
      ? db.prepare(`SELECT post_id AS target_id, COUNT(*) AS count FROM post_comments WHERE tenant_id = ? AND status = 'approved' AND post_id IN (${placeholders}) GROUP BY post_id`).all(tenantId, ...ids)
      : Promise.resolve([])
  ]);
  const engagement = new Map(ids.map((id) => [id, { likes: 0, dislikes: 0, comments: 0 }]));
  for (const row of reactionRows) engagement.get(row.target_id)[row.reaction === 'like' ? 'likes' : 'dislikes'] = Number(row.count || 0);
  for (const row of commentRows) engagement.get(row.target_id).comments = Number(row.count || 0);
  const viewerReactions = new Map(viewerRows.map((row) => [row.target_id, row.reaction]));
  const reported = new Set(reportRows.map((row) => row.target_id));
  return items.map((item) => ({
    ...item,
    engagement: engagement.get(item.id),
    viewerReaction: viewerReactions.get(item.id) || null,
    viewerReported: reported.has(item.id)
  }));
}

function communityTargetTable(targetType) {
  if (targetType === 'post') return 'campus_posts';
  if (targetType === 'review') return 'reviews';
  throw Object.assign(new Error('不支持的互动对象'), { status: 400 });
}

async function requireCommunityTarget(db, tenantId, targetType, targetId, { approved = false } = {}) {
  const table = communityTargetTable(targetType);
  const row = await db.prepare(`SELECT * FROM ${table} WHERE tenant_id = ? AND id = ?`).get(tenantId, targetId);
  if (!row) throw Object.assign(new Error(targetType === 'post' ? '帖子不存在' : '评价不存在'), { status: 404 });
  if (approved && row.status !== 'approved') throw Object.assign(new Error('只能互动已公开内容'), { status: 409 });
  return row;
}

async function dishDetail(db, id, tenantId = 'default') {
  const requestedRow = await db.prepare('SELECT * FROM dishes WHERE tenant_id = ? AND id = ?').get(tenantId, id);
  if (!requestedRow) return null;
  let row = requestedRow.status === 'active' && requestedRow.review_status === 'approved'
    ? requestedRow
    : requestedRow.parent_dish_id
      ? await db.prepare("SELECT * FROM dishes WHERE tenant_id = ? AND id = ? AND status = 'active' AND review_status = 'approved'").get(tenantId, requestedRow.parent_dish_id)
      : null;
  if (!row) return null;
  row = await db.prepare(`SELECT d.* FROM dishes d
    JOIN stalls s ON s.id = d.stall_id AND s.tenant_id = d.tenant_id
    JOIN canteens c ON c.id = s.canteen_id AND c.tenant_id = d.tenant_id
    LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = c.tenant_id
    WHERE d.tenant_id = ? AND d.id = ? AND d.status = 'active' AND d.review_status = 'approved'
      AND s.review_status = 'approved' AND c.review_status = 'approved'
      AND (c.parent_id IS NULL OR parent.review_status = 'approved')`).get(tenantId, row.id);
  if (!row) return null;
  const [dish] = await applyApprovedIntroductions(db, tenantId, 'dish', [rowToDish(row)]);
  const stallRow = await db.prepare('SELECT * FROM stalls WHERE tenant_id = ? AND id = ?').get(tenantId, dish.stallId);
  const stall = stallRow ? (await applyApprovedIntroductions(db, tenantId, 'stall', [rowToStall(stallRow)]))[0] : null;
  const canteenRow = stall ? await db.prepare('SELECT * FROM canteens WHERE tenant_id = ? AND id = ?').get(tenantId, stall.canteenId) : null;
  const canteen = canteenRow ? (await applyApprovedIntroductions(db, tenantId, 'canteen', [rowToCanteen(canteenRow)]))[0] : null;
  return {
    ...dish,
    stall,
    canteen,
    reviews: await listReviews(db, row.id, tenantId),
    canonicalDishId: row.id,
    redirectedFromDishId: row.id === id ? null : id,
  };
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
  const publicDishIds = new Set(dishes.map((dish) => dish.id));
  const publicCanteenIds = new Set(canteens.map((canteen) => canteen.id));
  const reviews = (await db.prepare(`SELECT reviews.*, users.nickname, users.username FROM reviews JOIN users ON users.id = reviews.user_id WHERE reviews.tenant_id = ? AND reviews.status = 'approved' ORDER BY reviews.created_at DESC`).all(tenantId))
    .map(rowToReview)
    .filter((review) => review.targetType === 'dish' ? publicDishIds.has(review.targetId) : publicCanteenIds.has(review.targetId));
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
  const dishes = (await listDishes(db, new URLSearchParams(), tenantId))
    .filter((dish) => dish.catalogItemType === 'meal');
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
  const conflictingRecord = await db.prepare(`SELECT tenant_id, stall_id, pricing_mode, price_display, pricing_json,
      aliases_json, semantic_labels_json, source_ref_json, catalog_item_type, catalog_category, parent_dish_id,
      rating, review_count, sales, review_status, retrieval_eligible FROM dishes WHERE id = ?`).get(normalizedId);
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
  const stallRecord = await db.prepare('SELECT name FROM stalls WHERE tenant_id = ? AND id = ?').get(tenantId, stallId);
  const automaticClassification = classifyCatalogItem({ name: body.name, price: body.price, stallName: stallRecord?.name, currentType: conflictingRecord?.catalog_item_type || 'meal' });
  const catalogItemType = String(body.catalogItemType || conflictingRecord?.catalog_item_type || automaticClassification.itemType).trim();
  if (!['meal', 'beverage', 'snack', 'addon', 'fee'].includes(catalogItemType)) {
    throw Object.assign(new Error('目录类型仅支持餐食、小吃、饮品、加购项或费用项'), { status: 400, code: 'INVALID_CATALOG_ITEM_TYPE' });
  }
  const catalogCategory = String(body.catalogCategory || conflictingRecord?.catalog_category || automaticClassification.category).trim().slice(0, 30) || '其他餐食';
  const structuralItem = ['addon', 'fee', 'variant', 'section'].includes(catalogItemType);
  const reviewStatus = structuralItem
    ? 'excluded'
    : String(body.reviewStatus || conflictingRecord?.review_status || 'approved').trim();
  if (!['approved', 'pending', 'excluded'].includes(reviewStatus)) {
    throw Object.assign(new Error('目录审核状态仅支持 approved、pending 或 excluded'), { status: 400, code: 'INVALID_CATALOG_REVIEW_STATUS' });
  }
  const retrievalEligible = structuralItem
    ? 0
    : (body.retrievalEligible == null ? Number(conflictingRecord?.retrieval_eligible ?? 1) : (body.retrievalEligible ? 1 : 0));
  const dietaryLabels = splitList(body.dietaryLabels || []);
  if (dietaryLabels.some((label) => !['pescatarian', 'vegetarian', 'vegan'].includes(label))) {
    throw Object.assign(new Error('饮食模式标签仅支持 pescatarian、vegetarian、vegan'), { status: 400, code: 'INVALID_DIETARY_LABEL' });
  }
  const factStatus = body.factStatus || {};
  const factStatuses = {
    nutrition: String(factStatus.nutrition || body.nutritionFactStatus || 'unknown'),
    recipe: String(factStatus.recipe || body.recipeFactStatus || 'unknown'),
    halal: String(factStatus.halal || body.halalFactStatus || 'unknown'),
    dietary: String(factStatus.dietary || body.dietaryFactStatus || 'unknown'),
    spice: String(factStatus.spice || body.spiceFactStatus || 'unknown'),
  };
  if (Object.values(factStatuses).some((value) => !FACT_STATUSES.includes(value))) {
    throw Object.assign(new Error('事实状态仅支持 unknown、estimated、verified'), { status: 400, code: 'INVALID_FACT_STATUS' });
  }
  const safetyDeclarations = normalizeSafetyDeclarations({
    safetyDeclarations: body.safetyDeclarations,
    allergens: splitList(body.allergens || []),
    factSource: body.factSource,
    factVerifiedAt: body.factVerifiedAt,
    factExpiresAt: body.factExpiresAt,
    dataVersion: body.dataVersion,
  });
  if (safetyDeclarations.some((item) => !SAFETY_STATUSES.includes(item.status))) {
    throw Object.assign(new Error('过敏原声明状态不合法'), { status: 400, code: 'INVALID_SAFETY_STATUS' });
  }
  const spiceLevel = body.spiceLevel == null || body.spiceLevel === '' ? null : Number(body.spiceLevel);
  if (spiceLevel != null && (!Number.isInteger(spiceLevel) || spiceLevel < 0 || spiceLevel > 5)) {
    throw Object.assign(new Error('辣度等级需要在 0-5 之间'), { status: 400, code: 'INVALID_SPICE_LEVEL' });
  }
  const synthetic = Boolean(body.synthetic);
  if (synthetic && (process.env.NODE_ENV === 'production' || process.env.ALLOW_SYNTHETIC_DATA !== '1')) {
    throw Object.assign(new Error('模拟菜品只能写入本地实验数据库'), { status: 403, code: 'SYNTHETIC_DATA_FORBIDDEN' });
  }
  const hasPricing = ['pricing', 'pricingMode', 'priceDisplay'].some((key) => Object.prototype.hasOwnProperty.call(body, key));
  const pricing = normalizeDishPricing(hasPricing ? body : {
    pricingMode: conflictingRecord?.pricing_mode,
    priceDisplay: conflictingRecord?.price_display,
    pricing: conflictingRecord?.pricing_json,
  }, body.price);
  if (!PRICING_MODES.includes(pricing.mode)) {
    throw Object.assign(new Error('不支持的菜品计价方式'), { status: 400, code: 'INVALID_PRICING_MODE' });
  }
  const rating = body.rating == null ? Number(conflictingRecord?.rating ?? 0) : Number(body.rating);
  const reviewCount = body.reviewCount == null ? Number(conflictingRecord?.review_count ?? 0) : Number(body.reviewCount);
  const sales = body.sales == null ? Number(conflictingRecord?.sales ?? 0) : Number(body.sales);
  if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
    throw Object.assign(new Error('菜品评分需要在 0-5 之间'), { status: 400, code: 'INVALID_DISH_RATING' });
  }
  if (!Number.isInteger(reviewCount) || reviewCount < 0 || !Number.isInteger(sales) || sales < 0) {
    throw Object.assign(new Error('评价数和销量必须是非负整数'), { status: 400, code: 'INVALID_DISH_COUNTER' });
  }
  await db.prepare(`INSERT INTO dishes (id, tenant_id, stall_id, name, price, taste, cuisine, ingredients_json, tags_json, halal, meal_types_json, calories, protein, fat, carbs, fiber, sodium, sugar, calcium, iron, rating, review_count, sales, image, image_url, description, status, allergens_json, dietary_labels_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET stall_id=excluded.stall_id, name=excluded.name, price=excluded.price, taste=excluded.taste, cuisine=excluded.cuisine, ingredients_json=excluded.ingredients_json, tags_json=excluded.tags_json, halal=excluded.halal, meal_types_json=excluded.meal_types_json, calories=excluded.calories, protein=excluded.protein, fat=excluded.fat, carbs=excluded.carbs, fiber=excluded.fiber, sodium=excluded.sodium, sugar=excluded.sugar, calcium=excluded.calcium, iron=excluded.iron, rating=excluded.rating, review_count=excluded.review_count, sales=excluded.sales, image=excluded.image, image_url=excluded.image_url, description=excluded.description, status=excluded.status, allergens_json=excluded.allergens_json, dietary_labels_json=excluded.dietary_labels_json, updated_at=excluded.updated_at WHERE dishes.tenant_id=excluded.tenant_id`)
    .run(normalizedId, tenantId, stallId, body.name, Number(body.price), body.taste, body.cuisine, serializeJson(splitList(body.ingredients)), serializeJson(splitList(body.tags)), body.halal ? 1 : 0, serializeJson(body.mealTypes || ['lunch', 'dinner']), Number(nutrition.calories || 0), Number(nutrition.protein || 0), Number(nutrition.fat || 0), Number(nutrition.carbs || 0), fiber, sodium, sugar, calcium, iron, rating, reviewCount, sales, body.image || '🍽️', body.imageUrl || null, body.description || '管理员录入菜品。', status, serializeJson(splitList(body.allergens || [])), serializeJson(dietaryLabels), now(), now());
  const savedRecord = await db.prepare('SELECT tenant_id FROM dishes WHERE id = ?').get(normalizedId);
  if (!savedRecord || savedRecord.tenant_id !== tenantId) {
    throw Object.assign(new Error('该菜品 ID 已被其他租户使用，请更换 ID'), { status: 409, code: 'DISH_ID_TENANT_CONFLICT' });
  }
  await db.prepare('UPDATE dishes SET regional_taste = ? WHERE tenant_id = ? AND id = ?')
    .run(String(body.regionalTaste || '').trim(), tenantId, normalizedId);
  await db.prepare(`UPDATE dishes SET seasonings_json = ?, additives_json = ?, safety_declarations_json = ?,
      nutrition_fact_status = ?, recipe_fact_status = ?, halal_fact_status = ?, dietary_fact_status = ?,
      spice_level = ?, spice_fact_status = ?, fact_source = ?, fact_verified_at = ?, fact_expires_at = ?,
      data_version = ?, synthetic = ? WHERE tenant_id = ? AND id = ?`)
    .run(
      serializeJson(splitList(body.seasonings || [])),
      serializeJson(splitList(body.additives || [])),
      serializeJson(safetyDeclarations),
      factStatuses.nutrition,
      factStatuses.recipe,
      factStatuses.halal,
      factStatuses.dietary,
      spiceLevel,
      factStatuses.spice,
      String(body.factSource || 'manual').trim() || 'manual',
      body.factVerifiedAt || null,
      body.factExpiresAt || null,
      String(body.dataVersion || 'manual-v1').trim() || 'manual-v1',
      synthetic ? 1 : 0,
      tenantId,
      normalizedId,
    );
  await db.prepare(`UPDATE dishes SET pricing_mode = ?, price_display = ?, pricing_json = ?, aliases_json = ?,
      semantic_labels_json = ?, source_ref_json = ?, catalog_item_type = ?, catalog_category = ?,
      reservation_enabled = CASE WHEN ? IN ('addon', 'fee') THEN FALSE ELSE reservation_enabled END,
      review_status = ?, retrieval_eligible = ?
      WHERE tenant_id = ? AND id = ?`)
    .run(
      pricing.mode,
      pricing.display,
      serializeJson(pricing),
      serializeJson(Object.prototype.hasOwnProperty.call(body, 'aliases') ? splitList(body.aliases) : parseJsonField(conflictingRecord?.aliases_json, [])),
      serializeJson(Object.prototype.hasOwnProperty.call(body, 'semanticLabels') ? splitList(body.semanticLabels) : parseJsonField(conflictingRecord?.semantic_labels_json, [])),
      serializeJson(Object.prototype.hasOwnProperty.call(body, 'sourceRef') ? body.sourceRef : parseJsonField(conflictingRecord?.source_ref_json, {})),
      catalogItemType,
      catalogCategory,
      catalogItemType,
      reviewStatus,
      retrievalEligible,
      tenantId,
      normalizedId,
    );
  const eventVersion = Date.now();
  await enqueueOutboxEvent(db, {
    tenantId,
    aggregateType: 'dish',
    aggregateId: normalizedId,
    eventType: 'retrieval.dish.sync',
    payload: { dishId: normalizedId },
    idempotencyKey: `retrieval.dish.sync:${tenantId}:${normalizedId}:${eventVersion}`
  });
  await enqueueOutboxEvent(db, {
    tenantId,
    aggregateType: 'ranking',
    aggregateId: normalizedId,
    eventType: 'cache.ranking.invalidate',
    payload: { date: businessDate(), mealType: 'all' },
    idempotencyKey: `cache.ranking.invalidate:${tenantId}:${normalizedId}:${eventVersion}`
  });
  return normalizedId;
}

async function queueDishRetrieval(db, { tenantId, dishId, action = 'sync' }) {
  const eventType = action === 'delete' ? 'retrieval.source.delete' : 'retrieval.dish.sync';
  return enqueueOutboxEvent(db, {
    tenantId,
    aggregateType: 'dish',
    aggregateId: dishId,
    eventType,
    payload: action === 'delete'
      ? { sourceType: 'dish', sourceId: dishId }
      : { dishId },
    idempotencyKey: `${eventType}:${tenantId}:${dishId}:${randomUUID()}`
  });
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
    pricingMode: String(get('pricingMode', 'pricing_mode', '计价方式') || 'fixed').trim(),
    priceDisplay: String(get('priceDisplay', 'price_display', '价格展示') || '').trim(),
    pricing: (() => {
      const value = get('pricing', 'pricing_json', '结构化价格');
      if (!value) return {};
      try { return typeof value === 'object' ? value : JSON.parse(String(value)); } catch { return { raw: String(value) }; }
    })(),
    aliases: splitList(get('aliases', 'aliases_json', '别名')),
    semanticLabels: splitList(get('semanticLabels', 'semantic_labels_json', '语义标签')),
    sourceRef: (() => {
      const value = get('sourceRef', 'source_ref_json', '来源引用');
      if (!value) return {};
      try { return typeof value === 'object' ? value : JSON.parse(String(value)); } catch { return { raw: String(value) }; }
    })(),
    taste: String(get('taste', '口味') || '').trim(),
    cuisine: String(get('cuisine', '菜系') || '').trim(),
    ingredients: splitList(get('ingredients', '食材')),
    seasonings: splitList(get('seasonings', '调味料')),
    additives: splitList(get('additives', '添加物')),
    tags: splitList(get('tags', '标签')),
    allergens: splitList(get('allergens', '过敏原')),
    dietaryLabels: splitList(get('dietaryLabels', 'dietary_labels', '饮食模式标签')),
    halal: parseBoolean(get('halal', '清真')),
    mealTypes: parseMealTypes(get('mealTypes', 'meal_types', '餐别')),
    imageUrl: String(get('imageUrl', 'image_url', '图片地址') || '').trim(),
    description: String(get('description', '描述') || '').trim(),
    spiceLevel: get('spiceLevel', 'spice_level', '辣度等级') === undefined ? null : Number(get('spiceLevel', 'spice_level', '辣度等级')),
    factStatus: {
      nutrition: String(get('nutritionFactStatus', 'nutrition_fact_status', '营养事实状态') || 'unknown'),
      recipe: String(get('recipeFactStatus', 'recipe_fact_status', '配方事实状态') || 'unknown'),
      halal: String(get('halalFactStatus', 'halal_fact_status', '清真事实状态') || 'unknown'),
      dietary: String(get('dietaryFactStatus', 'dietary_fact_status', '饮食模式事实状态') || 'unknown'),
      spice: String(get('spiceFactStatus', 'spice_fact_status', '辣度事实状态') || 'unknown'),
    },
    factSource: String(get('factSource', 'fact_source', '事实来源') || 'csv_import').trim(),
    factVerifiedAt: String(get('factVerifiedAt', 'fact_verified_at', '核验时间') || '').trim() || null,
    factExpiresAt: String(get('factExpiresAt', 'fact_expires_at', '失效时间') || '').trim() || null,
    dataVersion: String(get('dataVersion', 'data_version', '数据版本') || 'csv-v1').trim(),
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
  if (dish.spiceLevel != null && (!Number.isInteger(dish.spiceLevel) || dish.spiceLevel < 0 || dish.spiceLevel > 5)) errors.push('辣度等级需要在 0-5 之间');
  if (Object.values(dish.factStatus).some((status) => !FACT_STATUSES.includes(status))) errors.push('事实状态仅支持 unknown、estimated、verified');
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
  const conflictingRecord = await db.prepare('SELECT tenant_id, parent_id, display_name, display_order, operating_status FROM canteens WHERE id = ?').get(normalizedId);
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
  const displayName = String(body.displayName || conflictingRecord?.display_name || body.name).trim().slice(0, 40);
  const displayOrder = Math.max(1, Math.min(Number(body.displayOrder ?? conflictingRecord?.display_order ?? 999) || 999, 9999));
  const operatingStatus = String(body.operatingStatus || conflictingRecord?.operating_status || 'open');
  if (!['open', 'renovating', 'closed'].includes(operatingStatus)) {
    throw Object.assign(new Error('营业状态必须为 open、renovating 或 closed'), { status: 400, code: 'CANTEEN_STATUS_INVALID' });
  }
  if (parentId) {
    if (parentId === normalizedId) {
      throw Object.assign(new Error('不能将餐饮分区设为自己的父级'), { status: 400, code: 'CANTEEN_PARENT_SELF' });
    }
    const parent = await db.prepare('SELECT id, parent_id FROM canteens WHERE tenant_id = ? AND id = ?').get(tenantId, parentId);
    if (!parent) {
      throw Object.assign(new Error('父级餐饮场所不存在或不属于当前租户'), { status: 400, code: 'CANTEEN_PARENT_NOT_FOUND' });
    }
    if (parent.parent_id) {
      throw Object.assign(new Error('餐饮分区只能直属顶层餐饮场所，不能创建三级餐区'), {
        status: 400,
        code: 'CANTEEN_PARENT_NESTED'
      });
    }
    const childCount = Number((await db.prepare('SELECT COUNT(*) AS count FROM canteens WHERE tenant_id = ? AND parent_id = ?').get(tenantId, normalizedId))?.count || 0);
    if (childCount > 0) {
      throw Object.assign(new Error('该顶层场所仍包含下属场所，不能直接移动为餐饮分区'), {
        status: 409,
        code: 'CANTEEN_PARENT_HAS_CHILDREN'
      });
    }
  } else if (conflictingRecord?.tenant_id === tenantId && conflictingRecord.parent_id && hasParentId) {
    throw Object.assign(new Error('已有餐饮分区不能清空父级场所'), {
      status: 400,
      code: 'CANTEEN_AREA_PARENT_REQUIRED'
    });
  }
  await db.prepare('INSERT INTO canteens (id, tenant_id, name, display_name, display_order, operating_status, location, hours, crowd_level, tags_json, description, parent_id, canteen_type, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, display_name=excluded.display_name, display_order=excluded.display_order, operating_status=excluded.operating_status, location=excluded.location, hours=excluded.hours, crowd_level=excluded.crowd_level, tags_json=excluded.tags_json, description=excluded.description, parent_id=excluded.parent_id, canteen_type=excluded.canteen_type, image=excluded.image, updated_at=excluded.updated_at WHERE canteens.tenant_id=excluded.tenant_id')
    .run(normalizedId, tenantId, body.name, displayName, displayOrder, operatingStatus, body.location, body.hours, Number(body.crowdLevel || 30), serializeJson(splitList(body.tags)), body.description, parentId, canteenType, image, now(), now());
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
  const canteen = await findPublishedCanteen(db, tenantId, body.canteenId);
  if (!canteen) throw Object.assign(new Error('菜单食堂不存在或不属于当前租户'), { status: 400 });
  const dishIds = [...new Set((Array.isArray(body.items) ? body.items : []).map((item) => item.dishId).filter(Boolean))];
  for (const dishId of dishIds) {
    const dish = await findPublishedDish(db, tenantId, dishId);
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

function recommendationGoalLabel(goal) {
  return ({ fatLoss: '减脂控卡', muscleGain: '增肌高蛋白', maintain: '均衡维持', healthy: '健康均衡' })[goal] || '健康均衡';
}

async function retrievalIndexQuery(db, user, { query, tenantId, limit, candidateIds, itemType, catalogCategories, sourceType, sourceTypes }) {
  await getAiSettings(db, user).catch(() => {});
  const quota = await aiQuotaStatus(db, tenantId);
  const quotaExhausted = quota.quota > 0 && quota.remaining <= 0;
  const requestedTypes = sourceTypes || (sourceType ? [sourceType] : undefined);
  const normalizedTypes = requestedTypes ? [...new Set(requestedTypes.flatMap((type) => {
    if (type === 'health') return ['health_knowledge'];
    if (type === 'knowledge') return ['health_knowledge', CAMPUS_KNOWLEDGE_SOURCE_TYPE, CAMPUS_POLICY_SOURCE_TYPE];
    if (['campus', 'campus_knowledge'].includes(type)) return [CAMPUS_KNOWLEDGE_SOURCE_TYPE];
    if (['policy', 'campus_faq'].includes(type)) return [CAMPUS_POLICY_SOURCE_TYPE];
    return [type];
  }))] : undefined;
  const activeTenantId = tenantId || tenantIdFor(user);
  const globalKnowledgeTypes = (normalizedTypes || ['health_knowledge', CAMPUS_KNOWLEDGE_SOURCE_TYPE])
    .filter((type) => ['health_knowledge', CAMPUS_KNOWLEDGE_SOURCE_TYPE].includes(type));
  const searchOptions = {
    limit,
    candidateIds,
    itemType,
    catalogCategories,
    ...(quotaExhausted ? { embeddingProvider: null } : {}),
  };
  const searches = [searchRetrievalIndex(db, query, { tenantId: activeTenantId, sourceTypes: normalizedTypes, ...searchOptions })];
  if (globalKnowledgeTypes.length && activeTenantId !== GLOBAL_KNOWLEDGE_TENANT_ID) {
    searches.push(searchRetrievalIndex(db, query, {
      tenantId: GLOBAL_KNOWLEDGE_TENANT_ID,
      sourceTypes: globalKnowledgeTypes,
      limit,
      ...(quotaExhausted ? { embeddingProvider: null } : {}),
    }));
  }
  const responses = await Promise.all(searches);
  const result = responses[0];
  const mergedItems = new Map();
  for (const response of responses) {
    for (const item of response.items) {
      const logicalKey = `${item.sourceType}:${item.sourceId}:${item.chunkIndex || 0}`;
      const existing = mergedItems.get(logicalKey);
      const currentTenantOverride = item.tenantId === activeTenantId && existing?.tenantId === GLOBAL_KNOWLEDGE_TENANT_ID;
      if (!existing || currentTenantOverride || Number(item.score || 0) > Number(existing.score || 0)) mergedItems.set(logicalKey, item);
    }
  }
  const allowed = candidateIds?.length ? new Set(candidateIds) : null;
  const rankedItems = [...mergedItems.values()].sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
  const scopedItems = allowed ? rankedItems.filter((item) => allowed.has(item.sourceId || item.metadata?.dishId || item.id)) : rankedItems;
  const warningsByCode = new Map(responses.flatMap((response) => response.warnings).map((warning) => [warning.code, warning]));
  if (quotaExhausted) warningsByCode.set('AI_QUOTA_EXHAUSTED', { code: 'AI_QUOTA_EXHAUSTED', message: 'AI 额度已用完，已降级为词法检索。', fallback: 'lexical' });
  const retrievalModes = [...new Set(responses.flatMap((response) => response.meta?.retrievalModes || []))];
  return {
    ...result,
    items: scopedItems.slice(0, limit || 8),
    warnings: [...warningsByCode.values()],
    meta: {
      ...result.meta,
      tenantId: activeTenantId,
      sourceTypes: normalizedTypes || result.meta.sourceTypes,
      retrievalModes,
      retrievalScopes: responses.map((response) => response.meta.tenantId),
      globalKnowledgeUsed: responses.length > 1,
      quotaExhausted,
      trace: {
        scopes: responses.map((response) => ({
          tenantId: response.meta.tenantId,
          sourceTypes: response.meta.sourceTypes,
          vectorMode: response.meta.vectorMode,
          retrievalModes: response.meta.retrievalModes,
          ...response.meta.trace,
        })),
        totalLatencyMs: Math.max(...responses.map((response) => Number(response.meta?.trace?.totalLatencyMs || 0)), 0),
        fallbackReasons: [...new Set(responses.flatMap((response) => response.meta?.trace?.fallbackReasons || []))],
      },
    },
  };
}

function positivePage(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

async function catalogStats(db, tenantId) {
  const [venues, stalls, dishes] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS count FROM canteens WHERE tenant_id = ?').get(tenantId),
    db.prepare('SELECT COUNT(*) AS count FROM stalls WHERE tenant_id = ?').get(tenantId),
    db.prepare("SELECT COUNT(*) AS count FROM dishes WHERE tenant_id = ? AND status = 'active'").get(tenantId),
  ]);
  return { venues: Number(venues?.count || 0), stalls: Number(stalls?.count || 0), dishes: Number(dishes?.count || 0), imported: Number(dishes?.count || 0) > 0 };
}

async function bootstrapSnapshot(db, user = null) {
  const tenantId = tenantIdFor(user);
  return {
    session: { user: publicUser(user) },
    profile: user ? await getProfile(db, user.id, tenantId) : normalizeProfile({ goal: 'healthy', budgetMax: 20, mealType: 'lunch' }),
    features: {
      stableCatalog: true,
      reservations: true,
      paymentMethod: 'at_stall',
      todayMenus: false,
      vectorSearchMode: 'shadow',
    },
    catalogStats: await catalogStats(db, tenantId),
  };
}

async function clientBootstrapSnapshot(db, user = null) {
  if (process.env.NODE_ENV === 'test' && process.env.ENABLE_LEGACY_TEST_BOOTSTRAP === '1') return snapshot(db, user);
  return bootstrapSnapshot(db, user);
}

async function listCatalogVenues(db, tenantId) {
  const venues = await listCanteens(db, tenantId);
  return { venues, total: venues.length };
}

async function listCatalogStalls(db, tenantId, params) {
  const page = positivePage(params.get('page'), 1);
  const pageSize = positivePage(params.get('pageSize'), 30, 100);
  const venueId = String(params.get('venueId') || '').trim();
  const clauses = ['s.tenant_id = ?', "s.review_status = 'approved'", "c.review_status = 'approved'", "(parent.id IS NULL OR parent.review_status = 'approved')", "c.operating_status = 'open'", "(parent.id IS NULL OR parent.operating_status = 'open')"];
  const values = [tenantId];
  if (venueId) { clauses.push('s.canteen_id = ?'); values.push(venueId); }
  const where = clauses.join(' AND ');
  const from = 'FROM stalls s JOIN canteens c ON c.id = s.canteen_id AND c.tenant_id = s.tenant_id LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = c.tenant_id';
  const total = Number((await db.prepare(`SELECT COUNT(*) AS count ${from} WHERE ${where}`).get(...values))?.count || 0);
  const rows = await db.prepare(`SELECT s.*,
      (SELECT COUNT(*) FROM dishes d WHERE d.tenant_id = s.tenant_id AND d.stall_id = s.id AND d.status = 'active' AND d.review_status = 'approved') AS dish_count
      ${from} WHERE ${where} ORDER BY s.canteen_id, s.floor, s.name LIMIT ? OFFSET ?`)
    .all(...values, pageSize, (page - 1) * pageSize);
  const stalls = await applyApprovedIntroductions(db, tenantId, 'stall', rows.map((row) => ({ ...rowToStall(row), dishCount: Number(row.dish_count || 0) })));
  return { stalls, page: { page, pageSize, total, hasMore: page * pageSize < total } };
}

async function listAdminStallDishes(db, tenantId, stallId, params) {
  const page = positivePage(params.get('page'), 1);
  const pageSize = positivePage(params.get('pageSize'), 30, 100);
  const query = String(params.get('q') || '').trim().toLocaleLowerCase().slice(0, 80);
  const stall = await db.prepare('SELECT * FROM stalls WHERE tenant_id = ? AND id = ?').get(tenantId, stallId);
  if (!stall) throw Object.assign(new Error('档口不存在'), { status: 404, code: 'STALL_NOT_FOUND' });
  const clauses = ['tenant_id = ?', 'stall_id = ?'];
  const values = [tenantId, stallId];
  if (query) {
    clauses.push("LOWER(name || ' ' || taste || ' ' || cuisine || ' ' || tags_json || ' ' || ingredients_json || ' ' || allergens_json) LIKE ?");
    values.push(`%${query}%`);
  }
  const where = clauses.join(' AND ');
  const total = Number((await db.prepare(`SELECT COUNT(*) AS count FROM dishes WHERE ${where}`).get(...values))?.count || 0);
  const rows = await db.prepare(`SELECT * FROM dishes WHERE ${where} ORDER BY name, id LIMIT ? OFFSET ?`)
    .all(...values, pageSize, (page - 1) * pageSize);
  const items = await applyApprovedIntroductions(db, tenantId, 'dish', rows.map(rowToDish));
  const [presentedStall] = await applyApprovedIntroductions(db, tenantId, 'stall', [{ ...rowToStall(stall), dishCount: total }]);
  return {
    items,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
    stall: presentedStall,
  };
}

function catalogDishPresentation(row) {
  const dish = rowToDish(row);
  return {
    ...dish,
    stallName: row.stall_name || '',
    canteenId: row.canteen_id || '',
    canteenName: row.canteen_name || '',
    venueKind: row.venue_kind || 'dining_hall',
    availability: {
      status: dish.reservationEnabled && Boolean(row.stall_reservation_enabled) ? 'reservable' : 'reservation_paused',
      orderable: dish.reservationEnabled && Boolean(row.stall_reservation_enabled),
      reason: dish.reservationEnabled && Boolean(row.stall_reservation_enabled) ? '可预约，到店支付' : '暂停预约',
      price: dish.pricing.minAmount,
      priceDisplay: dish.priceDisplay,
    },
  };
}

async function searchCatalogDishes(db, tenantId, body = {}) {
  const page = positivePage(body.page, 1);
  const pageSize = positivePage(body.pageSize, positivePage(body.limit, 20, 50), 50);
  const offset = body.offset == null ? (page - 1) * pageSize : Math.max(Number(body.offset) || 0, 0);
  const filters = body.filters || {};
  const rawQuery = String(body.query ?? body.keyword ?? filters.keyword ?? '').trim().slice(0, 80);
  const parsedQuery = parseDishSearchRequest({ query: rawQuery, filters, limit: pageSize, offset });
  const budgetOnlyQuery = /^\s*(?:预算|价格)?\s*(?:不超过|不高于|最多|低于|少于)?\s*[¥￥]?\s*\d+(?:\.\d+)?\s*元?\s*(?:以内|以下|内)?\s*$/u.test(rawQuery);
  const keyword = (budgetOnlyQuery ? '' : rawQuery).toLocaleLowerCase();
  const requestedItemType = String(body.itemType || filters.itemType || '').trim().toLowerCase();
  const allowedItemTypes = new Set(['meal', 'beverage', 'snack', 'addon', 'fee', 'variant', 'section', 'all']);
  const publicItemTypes = new Set(['meal', 'beverage', 'snack']);
  if (requestedItemType && !allowedItemTypes.has(requestedItemType)) {
    throw Object.assign(new Error('目录商品类型不合法'), { status: 400, code: 'INVALID_CATALOG_ITEM_TYPE' });
  }
  const effectiveItemType = publicItemTypes.has(requestedItemType) ? requestedItemType : 'meal';
  const partitionInferred = !requestedItemType || requestedItemType === 'all';
  const clauses = ["d.tenant_id = ?", "d.status = 'active'", "d.review_status = 'approved'", "d.retrieval_eligible = 1",
    "s.review_status = 'approved'", "s.retrieval_eligible = 1",
    "c.review_status = 'approved'", "c.retrieval_eligible = 1", "c.operating_status = 'open'",
    "(parent.id IS NULL OR (parent.review_status = 'approved' AND parent.retrieval_eligible = 1 AND parent.operating_status = 'open'))",
    "TRIM(d.name) NOT LIKE '_人份'", "TRIM(d.name) NOT LIKE '_-_人份'", "TRIM(d.name) NOT LIKE '_~_人份'", "TRIM(d.name) NOT LIKE '_至_人份'",
    "TRIM(d.name) NOT LIKE '_._-_人份'", "TRIM(d.name) NOT LIKE '_、_-_人份'"];
  const values = [tenantId];
  clauses.push('d.catalog_item_type = ?');
  values.push(effectiveItemType);
  if (requestedItemType && !publicItemTypes.has(requestedItemType) && requestedItemType !== 'all') clauses.push('1 = 0');
  const catalogCategories = [...new Set([
    body.catalogCategory,
    filters.catalogCategory,
    ...[].concat(body.catalogCategories || filters.catalogCategories || []),
  ].flatMap((value) => String(value || '').split(/[，,、;；]/u)).map((value) => value.trim()).filter(Boolean))].slice(0, 30);
  if (catalogCategories.length) {
    clauses.push(`d.catalog_category IN (${catalogCategories.map(() => '?').join(', ')})`);
    values.push(...catalogCategories);
  }
  if (keyword) {
    clauses.push(`LOWER(
      d.name || ' ' || d.aliases_json || ' ' || d.catalog_category || ' ' || d.cuisine || ' ' || d.taste || ' ' ||
      d.ingredients_json || ' ' || d.tags_json || ' ' || d.semantic_labels_json || ' ' || d.description || ' ' ||
      s.name || ' ' || c.name || ' ' || COALESCE(parent.name, '')
    ) LIKE ?`);
    values.push(`%${keyword}%`);
  }
  const stallIds = [...new Set([
    ...[].concat(body.stallIds || filters.stallIds || []),
    body.stallId || filters.stallId || '',
  ].map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 100);
  const venueIds = [...new Set([
    ...[].concat(body.venueIds || filters.venueIds || []),
    body.venueId || filters.venueId || '',
  ].map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 50);
  if (stallIds.length) {
    clauses.push(`d.stall_id IN (${stallIds.map(() => '?').join(', ')})`);
    values.push(...stallIds);
  }
  if (venueIds.length) {
    clauses.push(`s.canteen_id IN (${venueIds.map(() => '?').join(', ')})`);
    values.push(...venueIds);
  }
  const maxPrice = Number(body.maxPrice ?? filters.maxPrice ?? filters.budgetMax ?? parsedQuery.filters.budgetMax);
  if (Number.isFinite(maxPrice) && maxPrice >= 0) { clauses.push('d.price <= ?'); values.push(maxPrice); }
  const taste = String(body.taste || filters.taste || '').trim();
  if (taste && taste !== '不限') { clauses.push('(d.taste = ? OR d.tags_json LIKE ?)'); values.push(taste, `%${taste}%`); }
  if (body.halalOnly || filters.halalOnly) clauses.push('d.halal = 1');
  if (body.reservationOnly || filters.reservationOnly) clauses.push('d.reservation_enabled = TRUE AND s.reservation_enabled = TRUE');
  const where = clauses.join(' AND ');
  const from = `FROM dishes d JOIN stalls s ON s.id = d.stall_id AND s.tenant_id = d.tenant_id JOIN canteens c ON c.id = s.canteen_id AND c.tenant_id = d.tenant_id LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = c.tenant_id`;
  const total = Number((await db.prepare(`SELECT COUNT(*) AS count ${from} WHERE ${where}`).get(...values))?.count || 0);
  const sort = String(body.sort || 'name');
  const relevanceSql = keyword ? `CASE
      WHEN LOWER(d.name) = ? THEN 100
      WHEN LOWER(d.aliases_json) LIKE ? THEN 90
      WHEN LOWER(d.name) LIKE ? THEN 80
      WHEN LOWER(d.catalog_category || ' ' || s.name || ' ' || c.name || ' ' || COALESCE(parent.name, '')) LIKE ? THEN 50
      WHEN LOWER(d.ingredients_json || ' ' || d.tags_json) LIKE ? THEN 25
      WHEN LOWER(d.description || ' ' || d.semantic_labels_json) LIKE ? THEN 10
      ELSE 0 END` : '0';
  const relevanceValues = keyword ? [keyword, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`] : [];
  const orderBy = sort === 'price_asc'
    ? 'd.price ASC, d.name'
    : sort === 'rating_desc'
      ? 'd.rating DESC, d.review_count DESC, d.name'
      : keyword
        ? 'relevance_score DESC, d.rating DESC, d.name'
        : 'd.name';
  const rows = await db.prepare(`SELECT d.*, s.name AS stall_name, s.canteen_id, s.reservation_enabled AS stall_reservation_enabled,
      c.name AS canteen_name, c.venue_kind, ${relevanceSql} AS relevance_score ${from} WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...relevanceValues, ...values, pageSize, offset);
  const items = await applyApprovedIntroductions(db, tenantId, 'dish', rows.map(catalogDishPresentation));
  const suggestedRelaxations = total || !keyword ? [] : [...publicItemTypes]
    .filter((itemType) => itemType !== effectiveItemType)
    .map((itemType) => ({
      filter: 'itemType',
      value: itemType,
      message: `可切换到${itemType === 'snack' ? '小吃' : itemType === 'beverage' ? '饮品' : '餐食'}分区继续查找`,
    }));
  return {
    query: keyword,
    interpreted: parsedQuery.interpreted,
    items,
    dishes: items,
    availability: { orderableCount: items.filter((item) => item.availability.orderable).length, totalCount: total },
    page: { page: Math.floor(offset / pageSize) + 1, pageSize, limit: pageSize, offset, total, hasMore: offset + items.length < total },
    warnings: [],
    suggestedRelaxations,
    meta: {
      source: 'stable_catalog',
      vectorSearchMode: 'shadow',
      itemType: effectiveItemType,
      partition: {
        itemType: effectiveItemType,
        categories: catalogCategories,
        inferred: partitionInferred,
        relaxableItemTypes: suggestedRelaxations.map((item) => item.value),
      },
    },
  };
}

async function listCatalogCategories(db, tenantId, params) {
  const itemType = String(params.get('itemType') || 'meal').trim().toLowerCase();
  if (!['meal', 'snack', 'beverage'].includes(itemType)) {
    throw Object.assign(new Error('学生目录只支持餐食、小吃和饮品分区'), { status: 400, code: 'INVALID_CATALOG_ITEM_TYPE' });
  }
  const rows = await db.prepare(`SELECT d.catalog_category AS value, COUNT(*) AS count
    FROM dishes d
    JOIN stalls s ON s.id = d.stall_id AND s.tenant_id = d.tenant_id
    JOIN canteens c ON c.id = s.canteen_id AND c.tenant_id = d.tenant_id
    LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = c.tenant_id
    WHERE d.tenant_id = ? AND d.status = 'active' AND d.review_status = 'approved' AND d.retrieval_eligible = 1
      AND d.catalog_item_type = ?
      AND s.review_status = 'approved' AND s.retrieval_eligible = 1
      AND c.review_status = 'approved' AND c.retrieval_eligible = 1 AND c.operating_status = 'open'
      AND (parent.id IS NULL OR (parent.review_status = 'approved' AND parent.retrieval_eligible = 1 AND parent.operating_status = 'open'))
    GROUP BY d.catalog_category
    ORDER BY COUNT(*) DESC, d.catalog_category ASC`).all(tenantId, itemType);
  return {
    itemType,
    categories: rows.map((row) => ({ value: row.value, label: row.value, count: Number(row.count || 0) })),
  };
}

async function listCatalogRankings(db, tenantId, params) {
  const type = ['dishes', 'stalls', 'venues'].includes(String(params.get('type') || '')) ? String(params.get('type')) : 'dishes';
  const page = positivePage(params.get('page'), 1);
  const pageSize = positivePage(params.get('pageSize'), 20, 50);
  const offset = (page - 1) * pageSize;
  let total = 0;
  let items = [];
  if (type === 'dishes') {
    total = Number((await db.prepare(`SELECT COUNT(*) AS count FROM dishes d
      JOIN stalls s ON s.id = d.stall_id AND s.tenant_id = d.tenant_id
      JOIN canteens c ON c.id = s.canteen_id AND c.tenant_id = d.tenant_id
      LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = c.tenant_id
      WHERE d.tenant_id = ? AND d.status = 'active' AND d.review_status = 'approved'
        AND s.review_status = 'approved' AND c.review_status = 'approved'
        AND (c.parent_id IS NULL OR parent.review_status = 'approved')
        AND d.catalog_item_type = 'meal'`).get(tenantId))?.count || 0);
    const rows = await db.prepare(`SELECT d.*, s.name AS stall_name, s.canteen_id, s.reservation_enabled AS stall_reservation_enabled,
      c.name AS canteen_name, c.venue_kind
      FROM dishes d JOIN stalls s ON s.id = d.stall_id AND s.tenant_id = d.tenant_id
      JOIN canteens c ON c.id = s.canteen_id AND c.tenant_id = d.tenant_id
      LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = c.tenant_id
      WHERE d.tenant_id = ? AND d.status = 'active' AND d.review_status = 'approved'
        AND s.review_status = 'approved' AND c.review_status = 'approved'
        AND (c.parent_id IS NULL OR parent.review_status = 'approved')
        AND d.catalog_item_type = 'meal'
      ORDER BY d.rating DESC, d.review_count DESC, d.sales DESC, d.name ASC LIMIT ? OFFSET ?`).all(tenantId, pageSize, offset);
    items = await applyApprovedIntroductions(db, tenantId, 'dish', rows.map((row) => ({ ...catalogDishPresentation(row), rankScore: Number(row.rating || 0) })));
  } else if (type === 'stalls') {
    total = Number((await db.prepare(`SELECT COUNT(*) AS count FROM stalls s
      JOIN canteens c ON c.id = s.canteen_id AND c.tenant_id = s.tenant_id
      LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = c.tenant_id
      WHERE s.tenant_id = ? AND s.review_status = 'approved' AND c.review_status = 'approved'
        AND (c.parent_id IS NULL OR parent.review_status = 'approved')`).get(tenantId))?.count || 0);
    const rows = await db.prepare(`SELECT s.*, c.name AS canteen_name,
      (SELECT COUNT(*) FROM dishes d WHERE d.tenant_id = s.tenant_id AND d.stall_id = s.id AND d.status = 'active' AND d.review_status = 'approved' AND d.catalog_item_type = 'meal') AS dish_count
      FROM stalls s JOIN canteens c ON c.id = s.canteen_id AND c.tenant_id = s.tenant_id
      LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = c.tenant_id
      WHERE s.tenant_id = ? AND s.review_status = 'approved' AND c.review_status = 'approved'
        AND (c.parent_id IS NULL OR parent.review_status = 'approved')
      ORDER BY s.rating DESC, dish_count DESC, s.name ASC LIMIT ? OFFSET ?`).all(tenantId, pageSize, offset);
    items = await applyApprovedIntroductions(db, tenantId, 'stall', rows.map((row) => ({ ...rowToStall(row), canteenName: row.canteen_name || '', dishCount: Number(row.dish_count || 0), rankScore: Number(row.rating || 0) })));
  } else {
    total = Number((await db.prepare(`SELECT COUNT(*) AS count FROM canteens c
      LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = c.tenant_id
      WHERE c.tenant_id = ? AND c.review_status = 'approved'
        AND (c.parent_id IS NULL OR parent.review_status = 'approved')`).get(tenantId))?.count || 0);
    const rows = await db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM stalls s WHERE s.tenant_id = c.tenant_id AND s.canteen_id = c.id AND s.review_status = 'approved') AS stall_count,
      (SELECT COALESCE(AVG(s.rating), 0) FROM stalls s WHERE s.tenant_id = c.tenant_id AND s.canteen_id = c.id AND s.review_status = 'approved') AS rank_score
      FROM canteens c LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = c.tenant_id
      WHERE c.tenant_id = ? AND c.review_status = 'approved'
        AND (c.parent_id IS NULL OR parent.review_status = 'approved')
      ORDER BY rank_score DESC, stall_count DESC, c.name ASC LIMIT ? OFFSET ?`).all(tenantId, pageSize, offset);
    items = await applyApprovedIntroductions(db, tenantId, 'canteen', rows.map((row) => ({ ...rowToCanteen(row), stallCount: Number(row.stall_count || 0), rankScore: Number(Number(row.rank_score || 0).toFixed(2)) })));
  }
  return { type, items, page: { page, pageSize, total, hasMore: offset + items.length < total } };
}

async function listSavedCatalogDishes(db, user, params) {
  const tenantId = tenantIdFor(user);
  const kind = ['favorite', 'eaten'].includes(String(params.get('kind') || '')) ? String(params.get('kind')) : 'favorite';
  const page = positivePage(params.get('page'), 1);
  const pageSize = positivePage(params.get('pageSize'), 20, 50);
  const offset = (page - 1) * pageSize;
  const predicate = kind === 'eaten' ? 'p.eaten_count > 0' : 'p.favorite = 1';
  const values = [tenantId, user.id];
  const from = `FROM user_dish_preferences p JOIN dishes d ON d.id = p.dish_id AND d.tenant_id = p.tenant_id
    JOIN stalls s ON s.id = d.stall_id AND s.tenant_id = d.tenant_id
    JOIN canteens c ON c.id = s.canteen_id AND c.tenant_id = d.tenant_id
    LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = c.tenant_id
    WHERE p.tenant_id = ? AND p.user_id = ? AND d.status = 'active' AND d.review_status = 'approved'
      AND s.review_status = 'approved' AND c.review_status = 'approved'
      AND (c.parent_id IS NULL OR parent.review_status = 'approved') AND ${predicate}`;
  const total = Number((await db.prepare(`SELECT COUNT(*) AS count ${from}`).get(...values))?.count || 0);
  const rows = await db.prepare(`SELECT d.*, s.name AS stall_name, s.canteen_id, s.reservation_enabled AS stall_reservation_enabled,
      c.name AS canteen_name, c.venue_kind, p.favorite, p.eaten_count, p.drawn_count, p.last_eaten_at, p.last_drawn_at
      ${from} ORDER BY p.updated_at DESC, d.name ASC LIMIT ? OFFSET ?`).all(...values, pageSize, offset);
  const mappedItems = rows.map((row) => ({
    ...catalogDishPresentation(row),
    preference: {
      favorite: Boolean(row.favorite), eatenCount: Number(row.eaten_count || 0), drawnCount: Number(row.drawn_count || 0),
      lastEatenAt: row.last_eaten_at || null, lastDrawnAt: row.last_drawn_at || null,
    },
  }));
  const items = await applyApprovedIntroductions(db, tenantId, 'dish', mappedItems);
  return { kind, items, page: { page, pageSize, total, hasMore: offset + items.length < total } };
}

async function listCommunityDishOptions(db, tenantId, params) {
  const result = await searchCatalogDishes(db, tenantId, {
    query: params.get('query') || '',
    venueId: params.get('venueId') || '',
    stallId: params.get('stallId') || '',
    page: params.get('page') || 1,
    pageSize: params.get('pageSize') || 30,
    itemType: 'all',
  });
  const options = result.items
    .filter((dish) => ['meal', 'beverage', 'snack'].includes(dish.catalogItemType) && !isServingTierCatalogName(dish.name))
    .map((dish) => ({
      id: dish.id,
      name: dish.name,
      sourceName: dish.sourceName,
      category: dish.catalogCategory || '其他',
      stallId: dish.stallId,
      stallName: dish.stallName,
      canteenId: dish.canteenId,
      canteenName: dish.canteenName,
      location: [dish.canteenName, dish.stallName].filter(Boolean).join(' · '),
      priceDisplay: dish.priceDisplay,
    }))
    .sort((left, right) => left.category.localeCompare(right.category, 'zh-CN')
      || left.name.localeCompare(right.name, 'zh-CN')
      || left.location.localeCompare(right.location, 'zh-CN'));
  return { options, page: { ...result.page, returned: options.length } };
}

let foodCompositionReferenceCache = null;

function lookupFoodCompositionReferences({ query, limit = 5 }) {
  if (!foodCompositionReferenceCache) foodCompositionReferenceCache = loadFoodCompositionReferences();
  return matchFoodCompositionReferencesForQuery(query, foodCompositionReferenceCache, limit);
}

function retrievalWorkflowDependencies(db, user) {
  return {
    db,
    indexVersion: RETRIEVAL_INDEX_VERSION,
    semanticSearch: (request) => retrievalIndexQuery(db, user, request),
    knowledgeSearch: (request) => retrievalIndexQuery(db, user, request),
    foodCompositionLookup: lookupFoodCompositionReferences,
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
    source: 'stable_catalog',
    menu: null,
    catalog: { source: 'stable_catalog', mealType: result.meta?.mealType }
  };
}

function recommendationAnswer(result) {
  const names = (result.recommendations || []).map((dish) => dish.name).filter(Boolean);
  if (!names.length) {
    const suggestion = result.suggestedRelaxations?.[0]?.message;
    return suggestion ? `当前没有满足全部条件的菜品。${suggestion}` : '当前没有满足全部条件的菜品，系统不会编造可点结果。';
  }
  const orderable = result.meta?.orderable !== false;
  const hasUnknownSafety = (result.recommendations || []).some((dish) => dish.safety?.status === 'unknown');
  const safetyNote = hasUnknownSafety ? '部分菜品的相关过敏原信息尚未确认，请务必向食堂现场核实配方和交叉接触风险。' : '';
  return `${orderable ? '根据校园稳定目录与当前预约开关' : '根据校园稳定目录'}，为你筛选出：${names.join('、')}。价格按目录展示，实际金额与可取时间以档口确认结果为准。${safetyNote}`;
}

function dishEvidenceFromSearch(result) {
  return (result.items || []).map((dish) => {
    const nutritionFactStatus = dish.facts?.factStatus?.nutrition || 'unknown';
    const hasKnownNutrition = nutritionFactStatus !== 'unknown'
      && Number.isFinite(Number(dish.nutrition?.calories))
      && Number.isFinite(Number(dish.nutrition?.protein));
    const nutritionText = hasKnownNutrition
      ? `${Number(dish.nutrition.calories)} kcal，蛋白质 ${Number(dish.nutrition.protein)} g`
      : '营养数据待核验';
    const availabilityStatus = dish.availability?.status || 'unknown';
    const reservationEnabled = Boolean(dish.availability?.orderable);
    return ({
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
        nutritionText,
      ].filter(Boolean).join('；'),
      snippet: `${dish.canteenName || '食堂'} · ${dish.stallName || '档口'} · ${dish.availability?.priceDisplay || dish.priceDisplay || `¥${dish.availability?.price ?? dish.price}`}`,
      score: dish.retrievalScore,
      metadata: {
        orderable: dish.availability?.orderable,
        menuItemId: dish.availability?.menuItemId || null,
        price: dish.availability?.price ?? dish.price,
        priceDisplay: dish.availability?.priceDisplay || dish.priceDisplay || null,
        availabilityStatus,
        reservationEnabled,
        safetyStatus: dish.safety?.status || 'not_applicable',
        unknownAllergens: dish.safety?.unknownAllergens || [],
        nutritionFactStatus,
        confidenceLevel: dish.confidence?.level || 'low',
        dataVersion: dish.dataQuality?.dataVersion || null,
        evidenceType: 'tenant_dish_fact',
      }
    });
  });
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
  result.meta.catalogSource = 'stable_catalog';
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
    stallId: row.stall_id || '',
    orderType: row.order_type || 'reservation',
    paymentMethod: row.payment_method || 'at_stall',
    pricingStatus: row.pricing_status || 'exact',
    estimatedAmount: Number(row.estimated_amount ?? row.total_amount ?? 0),
    finalAmount: row.final_amount == null ? null : Number(row.final_amount),
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
    pricingMode: row.pricing_mode || 'fixed',
    priceDisplay: row.price_display || '',
    pricingSnapshot: parseJson(row.pricing_snapshot_json, {}),
    pricingStatus: row.pricing_status || 'exact',
    estimatedUnitPrice: Number(row.estimated_unit_price ?? row.unit_price ?? 0),
    confirmedUnitPrice: row.confirmed_unit_price == null ? null : Number(row.confirmed_unit_price),
    note: row.item_note || '',
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
  const idempotencyKey = String(body.idempotencyKey || (process.env.NODE_ENV === 'test' ? `test:${randomUUID()}` : '')).trim();
  if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(idempotencyKey)) throw Object.assign(new Error('预约请求缺少有效幂等键'), { status: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' });
  const existingOrder = await db.prepare('SELECT * FROM orders WHERE tenant_id = ? AND user_id = ? AND idempotency_key = ?').get(tenantId, user.id, idempotencyKey);
  if (existingOrder) return (await hydrateOrders(db, [existingOrder], tenantId))[0];
  const quantities = new Map();
  const selections = new Map();
  for (const item of rawItems) {
    const dishId = String(item.dishId || '').trim();
    const quantity = Number(item.quantity || 0);
    if (!dishId || !Number.isInteger(quantity) || quantity <= 0 || quantity > 20) throw Object.assign(new Error('订单菜品和数量不合法'), { status: 400 });
    quantities.set(dishId, (quantities.get(dishId) || 0) + quantity);
    selections.set(dishId, item);
  }
  const orderItems = [];
  let estimatedAmount = 0;
  let pricingStatus = 'exact';
  let stallId = '';
  for (const [dishId, quantity] of quantities.entries()) {
    const row = await db.prepare(`SELECT d.*, s.reservation_enabled AS stall_reservation_enabled,
        c.operating_status AS area_operating_status, parent.operating_status AS venue_operating_status
      FROM dishes d JOIN stalls s ON s.id = d.stall_id AND s.tenant_id = d.tenant_id
      JOIN canteens c ON c.id = s.canteen_id AND c.tenant_id = s.tenant_id
      LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = c.tenant_id
      WHERE d.tenant_id = ? AND d.id = ? AND d.status = 'active'
        AND d.review_status = 'approved' AND s.review_status = 'approved' AND c.review_status = 'approved'
        AND (c.parent_id IS NULL OR parent.review_status = 'approved')`).get(tenantId, dishId);
    if (!row) throw Object.assign(new Error(`菜品不存在：${dishId}`), { status: 400, code: 'DISH_NOT_FOUND' });
    const dish = rowToDish(row);
    if ((row.area_operating_status || 'open') !== 'open' || (row.venue_operating_status && row.venue_operating_status !== 'open')) {
      throw Object.assign(new Error(`所属场所暂不可预约：${dish.name}`), { status: 409, code: 'VENUE_NOT_OPEN' });
    }
    if (!dish.reservationEnabled || !Boolean(row.stall_reservation_enabled)) throw Object.assign(new Error(`菜品暂停预约：${dish.name}`), { status: 409, code: 'RESERVATION_PAUSED' });
    if (stallId && stallId !== dish.stallId) throw Object.assign(new Error('一张预约单只能包含同一档口的菜品'), { status: 400, code: 'MIXED_STALL_ORDER' });
    stallId = dish.stallId;
    const selection = selections.get(dishId) || {};
    let unitPrice = Number(dish.pricing.baseAmount || dish.price || 0);
    let itemPricingStatus = 'exact';
    if (dish.pricingMode === 'variants') {
      const variant = dish.pricing.variants.find((item) => item.id === selection.variantId);
      if (variant) unitPrice = Number(variant.amount);
      else { unitPrice = Number(dish.pricing.minAmount || unitPrice); itemPricingStatus = 'pending_confirmation'; }
    } else if (dish.pricingMode === 'per_weight' || dish.pricing.maxAmount > dish.pricing.minAmount) {
      unitPrice = Number(dish.pricing.minAmount || unitPrice);
      itemPricingStatus = 'pending_confirmation';
    }
    const lineTotal = Number((unitPrice * quantity).toFixed(2));
    estimatedAmount += lineTotal;
    if (itemPricingStatus !== 'exact') pricingStatus = 'pending_confirmation';
    orderItems.push({ dish, quantity, unitPrice, lineTotal, pricingStatus: itemPricingStatus, note: String(selection.note || '').trim().slice(0, 80) });
  }
  const id = `order-${randomUUID()}`;
  const createdAt = now();
  await withTransaction(db, async (tx) => {
    await tx.prepare(`INSERT INTO orders (id, tenant_id, user_id, status, payment_status, total_amount, pickup_code, note,
      stall_id, order_type, payment_method, pricing_status, estimated_amount, final_amount, idempotency_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reservation', 'at_stall', ?, ?, ?, ?, ?, ?)`)
      .run(id, tenantId, user.id, 'pending', 'unpaid', Number(estimatedAmount.toFixed(2)), pickupCode(), String(body.note || '').trim().slice(0, 120), stallId, pricingStatus, Number(estimatedAmount.toFixed(2)), pricingStatus === 'exact' ? Number(estimatedAmount.toFixed(2)) : null, idempotencyKey, createdAt, createdAt);
    for (const item of orderItems) {
      await tx.prepare(`INSERT INTO order_items (id, tenant_id, order_id, dish_id, menu_item_id, dish_name, unit_price, quantity, line_total,
        pricing_mode, price_display, pricing_snapshot_json, pricing_status, estimated_unit_price, confirmed_unit_price, item_note, created_at)
        VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`order-item-${randomUUID()}`, tenantId, id, item.dish.id, item.dish.name, item.unitPrice, item.quantity, item.lineTotal,
          item.dish.pricingMode, item.dish.priceDisplay, serializeJson(item.dish.pricing), item.pricingStatus, item.unitPrice,
          item.pricingStatus === 'exact' ? item.unitPrice : null, item.note, createdAt);
    }
  });
  const [order] = await hydrateOrders(db, [await db.prepare('SELECT * FROM orders WHERE tenant_id = ? AND id = ?').get(tenantId, id)], tenantId);
  return order;
}

async function cancelOrder(db, user, orderId) {
  const tenantId = tenantIdFor(user);
  const order = await db.prepare('SELECT * FROM orders WHERE tenant_id = ? AND id = ?').get(tenantId, orderId);
  if (!order) throw Object.assign(new Error('订单不存在'), { status: 404 });
  if (order.user_id !== user.id) throw Object.assign(new Error('不能取消他人订单'), { status: 403 });
  if (!['pending', 'preparing'].includes(order.status) || order.payment_status === 'paid') throw Object.assign(new Error('当前订单不能取消'), { status: 400 });
  const timestamp = now();
  await withTransaction(db, async (tx) => {
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
  if ((order.order_type || 'reservation') === 'reservation') throw Object.assign(new Error('预约单需到档口支付'), { status: 409, code: 'PAY_AT_STALL_REQUIRED' });
  const timestamp = now();
  await withTransaction(db, async (tx) => {
    await tx.prepare('INSERT INTO payments (id, tenant_id, order_id, user_id, amount, channel, status, transaction_no, paid_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`payment-${randomUUID()}`, tenantId, orderId, user.id, Number(order.total_amount || 0), String(body.channel || 'mock').slice(0, 32), 'paid', `mock-${randomUUID()}`, timestamp, timestamp);
    await tx.prepare('UPDATE orders SET payment_status = ?, paid_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run('paid', timestamp, timestamp, tenantId, orderId);
  });
  const [updated] = await hydrateOrders(db, [await db.prepare('SELECT * FROM orders WHERE tenant_id = ? AND id = ?').get(tenantId, orderId)], tenantId);
  return updated;
}

async function orderAnalytics(db, tenantId, date = businessDate()) {
  const { startInclusive, endExclusive } = businessDayUtcRange(date);
  const orders = await db.prepare('SELECT * FROM orders WHERE tenant_id = ? AND created_at >= ? AND created_at < ?').all(tenantId, startInclusive, endExclusive);
  const completedRevenue = await db.prepare("SELECT COALESCE(SUM(COALESCE(final_amount, total_amount)), 0) AS total FROM orders WHERE tenant_id = ? AND status = 'completed' AND created_at >= ? AND created_at < ?").get(tenantId, startInclusive, endExclusive);
  const statusRows = await db.prepare('SELECT status, COUNT(*) AS count FROM orders WHERE tenant_id = ? AND created_at >= ? AND created_at < ? GROUP BY status').all(tenantId, startInclusive, endExclusive);
  const topDishes = await db.prepare(`SELECT oi.dish_id AS dishId, oi.dish_name AS dishName, SUM(oi.quantity) AS quantity, SUM(oi.line_total) AS amount
    FROM order_items oi JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
    WHERE oi.tenant_id = ? AND o.status = 'completed' AND o.created_at >= ? AND o.created_at < ?
    GROUP BY oi.dish_id, oi.dish_name ORDER BY quantity DESC, amount DESC LIMIT 10`).all(tenantId, startInclusive, endExclusive);
  return {
    date,
    todayOrders: orders.length,
    todayRevenue: Number(Number(completedRevenue?.total || 0).toFixed(2)),
    statusCounts: statusRows.reduce((acc, row) => ({ ...acc, [row.status]: Number(row.count || 0) }), {}),
    topDishes: topDishes.map((row) => ({ dishId: row.dishId, dishName: row.dishName, totalQuantity: Number(row.quantity || 0), totalRevenue: Number(Number(row.amount || 0).toFixed(2)), quantity: Number(row.quantity || 0), amount: Number(Number(row.amount || 0).toFixed(2)) })),
    soldOutItems: []
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
  if (nextStatus === 'completed' && order.pricing_status === 'pending_confirmation') {
    throw Object.assign(new Error('请先确认最终金额再完成预约'), { status: 409, code: 'FINAL_PRICE_REQUIRED' });
  }
  await withTransaction(db, async (tx) => {
    const timestamp = now();
    if (nextStatus === 'completed') {
      await tx.prepare("UPDATE orders SET status = ?, payment_status = 'paid', paid_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?")
        .run(nextStatus, timestamp, timestamp, tenantId, orderId);
    } else {
      await tx.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run(nextStatus, timestamp, tenantId, orderId);
    }
    if (nextStatus === 'completed') {
      const items = await tx.prepare('SELECT dish_id, quantity FROM order_items WHERE tenant_id = ? AND order_id = ?').all(tenantId, orderId);
      for (const item of items) {
        await tx.prepare('UPDATE dishes SET sales = sales + ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run(item.quantity, timestamp, tenantId, item.dish_id);
        await tx.prepare(`INSERT INTO user_dish_preferences
          (id, tenant_id, user_id, dish_id, favorite, eaten_count, drawn_count, last_eaten_at, last_drawn_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, 0, ?, NULL, ?, ?)
          ON CONFLICT(tenant_id, user_id, dish_id) DO UPDATE SET
            eaten_count = user_dish_preferences.eaten_count + excluded.eaten_count,
            last_eaten_at = excluded.last_eaten_at,
            updated_at = excluded.updated_at`)
          .run(`pref-${randomUUID()}`, tenantId, order.user_id, item.dish_id, Number(item.quantity), timestamp, timestamp, timestamp);
      }
    }
  });
  const [updated] = await hydrateOrders(db, [await db.prepare('SELECT * FROM orders WHERE tenant_id = ? AND id = ?').get(tenantId, orderId)], tenantId);
  return updated;
}

async function confirmReservationPrice(db, user, orderId, body = {}) {
  const tenantId = tenantIdFor(user);
  const order = await db.prepare("SELECT * FROM orders WHERE tenant_id = ? AND id = ? AND order_type = 'reservation'").get(tenantId, orderId);
  if (!order) throw Object.assign(new Error('预约单不存在'), { status: 404 });
  if (['completed', 'cancelled'].includes(order.status)) throw Object.assign(new Error('已结束预约不能修改金额'), { status: 409, code: 'ORDER_TERMINAL' });
  const finalAmount = Number(body.finalAmount);
  if (!Number.isFinite(finalAmount) || finalAmount < 0) throw Object.assign(new Error('最终金额不合法'), { status: 400 });
  const prices = new Map((body.items || []).map((item) => [String(item.itemId || ''), Number(item.confirmedUnitPrice)]));
  await withTransaction(db, async (tx) => {
    for (const [itemId, amount] of prices) {
      if (!itemId || !Number.isFinite(amount) || amount < 0) throw Object.assign(new Error('确认单价不合法'), { status: 400 });
      await tx.prepare(`UPDATE order_items SET confirmed_unit_price = ?, unit_price = ?, line_total = quantity * ?, pricing_status = 'confirmed'
        WHERE tenant_id = ? AND order_id = ? AND id = ?`).run(amount, amount, amount, tenantId, orderId, itemId);
    }
    await tx.prepare("UPDATE orders SET final_amount = ?, total_amount = ?, pricing_status = 'confirmed', updated_at = ? WHERE tenant_id = ? AND id = ?")
      .run(Number(finalAmount.toFixed(2)), Number(finalAmount.toFixed(2)), now(), tenantId, orderId);
  });
  return (await hydrateOrders(db, [await db.prepare('SELECT * FROM orders WHERE tenant_id = ? AND id = ?').get(tenantId, orderId)], tenantId))[0];
}

async function updateReservationState(db, user, entity, id, enabled) {
  const tenantId = tenantIdFor(user);
  const table = entity === 'stall' ? 'stalls' : 'dishes';
  const row = await db.prepare(`SELECT id FROM ${table} WHERE tenant_id = ? AND id = ?`).get(tenantId, id);
  if (!row) throw Object.assign(new Error(entity === 'stall' ? '档口不存在' : '菜品不存在'), { status: 404 });
  await db.prepare(`UPDATE ${table} SET reservation_enabled = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`)
    .run(enabled ? 1 : 0, now(), tenantId, id);
  return { id, reservationEnabled: Boolean(enabled) };
}

export function inferAgentIntent(query) {
  const text = String(query || '');
  if (/下单|点一份|来一份|购买|要一份|帮我点/.test(text)) return 'dish_search';
  if (/帮我找|想找|查找|搜索/.test(text)) return 'dish_search';
  if (/订单|支付|取消订单|订单状态|取餐码|查看取餐/.test(text)) return 'order_status';
  if (/营业|收入|销售|热销|看板|售罄统计|售罄数量/.test(text)) return 'operations';
  if (/菜单|价格|库存|可售|档口|食堂/.test(text)) return 'dish_search';
  if (/知识库|配方|过敏原未知|不会引发过敏|营养值|检测结果/.test(text)) return 'knowledge_qa';
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
    'dish.search': { name: 'dish.search', title: '查询校园稳定菜品目录', category: 'retrieval', riskLevel: 'low', permission: 'agent:use', requiresConfirmation: false, parameters: { type: 'object', properties: { query: { type: 'string' }, filters: { type: 'object' }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['query'] } },
    'meal.recommend': { name: 'meal.recommend', title: '根据档案和校园目录生成推荐', category: 'recommendation', riskLevel: 'low', permission: 'agent:use', requiresConfirmation: false, parameters: { type: 'object', properties: { query: { type: 'string' }, profileOverride: { type: 'object' }, options: { type: 'object' } }, required: ['query'] } },
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
  if (intent === 'dish_search') personas.push({ name: 'dish_retriever', title: '菜品检索员', responsibility: '按数据库真值查询菜品、价格和预约状态' });
  if (intent === 'meal_recommendation') personas.push({ name: 'nutritionist', title: '营养顾问', responsibility: '结合档案、校园目录和健康证据给出建议' });
  if (intent === 'knowledge_qa') personas.push({ name: 'knowledge_retriever', title: '知识检索员', responsibility: '只基于可引用健康知识回答问题' });
  if (intent === 'order_status') personas.push({ name: 'order_operator', title: '订单专员', responsibility: '只查询当前用户订单并解释状态' });
  if (intent === 'operations' && AGENT_OPERATION_ROLES.includes(user.role)) personas.push({ name: 'ops_analyst', title: '运营分析师', responsibility: '分析已完成预约金额与菜品热度' });
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
    if (!orders.length) return '你当前没有预约单。可以先到“到店预约”页选择同一档口菜品，提交后会生成预约码。';
    const latest = orders[0];
    const dishes = latest.items.map((item) => `${item.dishName}×${item.quantity}`).join('、');
    return `你最近的预约码是 ${latest.pickupCode}，状态为 ${latest.status}，支付方式为到店支付，菜品：${dishes}。未开始制作的预约可在“到店预约”页取消。`;
  }
  if (intent === 'operations' && analytics) {
    const top = analytics.topDishes?.[0];
    return `今日预约 ${analytics.todayOrders} 单，已完成预约金额 ¥${analytics.todayRevenue.toFixed(2)}。${top ? `当前已完成预约最多的菜品是 ${top.dishName}，数量 ${top.totalQuantity} 份。` : '暂无已完成预约数据。'}`;
  }
  if (intent === 'operations') return '当前角色不能读取营业分析数据。';
  if (intent === 'dish_search') {
    const names = (dishSearch?.items || []).slice(0, 5).map((item) => `${item.name}${item.availability?.orderable ? '' : '（当前不可点）'}`);
    if (names.length) {
      const hasUnknownSafety = (dishSearch?.items || []).some((item) => item.safety?.status === 'unknown');
      return `查到 ${dishSearch.page.total} 道匹配菜品：${names.join('、')}。价格来自校园稳定目录，可预约状态由档口运营开关决定。${hasUnknownSafety ? '部分菜品的相关过敏原信息尚未确认，请向食堂现场核实配方和交叉接触风险。' : ''}`;
    }
    const relaxation = dishSearch?.suggestedRelaxations?.[0]?.message;
    return relaxation ? `没有找到满足全部条件的菜品。${relaxation}` : '没有找到匹配菜品，系统不会编造结果。';
  }
  if (intent === 'meal_recommendation' && recommendation) return recommendationAnswer(recommendation);
  if (intent === 'knowledge_qa' && knowledge?.answer) return knowledge.answer;
  return `我已根据当前校园目录处理你的问题：“${String(query).slice(0, 80)}”。你可以询问菜品推荐、预约状态、预约码或运营数据。`;
}

function buildAgentPlan({ intent, steps, user, includeCreateOrder = false }) {
  const goals = { dish_search: '查询真实菜品与预约状态', meal_recommendation: '为用户推荐合适的餐品', knowledge_qa: '检索健康知识并回答', order_status: '查询用户预约状态', operations: '分析预约运营情况', general_canteen: '回答用户咨询' };
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
  const directIntent = inferAgentIntent(query);
  const deterministicIntent = directIntent === 'general_canteen' ? inferAgentIntent(effectiveQuery) : directIntent;
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
    analytics = await runAgentTool(registry, 'orders.analytics', user, steps, toolResults, async () => await orderAnalytics(db, tenantId, args.date || businessDate()));
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
    const args = routedToolArguments(toolRouting, ['meal.recommend', 'rag.meal_advisor']);
    recommendation = await runAgentTool(registry, 'meal.recommend', user, steps, toolResults, async () => executeMealRecommendation(db, user, {
      query: args.query || effectiveQuery,
      profileOverride: args.profileOverride || {},
      options: args.options || {}
    }));
    toolResults['rag.meal_advisor'] = toolResults['meal.recommend'];
  } else if (intent === 'knowledge_qa') {
    const args = routedToolArguments(toolRouting, 'knowledge.search');
    const search = await runAgentTool(registry, 'knowledge.search', user, steps, toolResults, async () => {
      const routed = await retrieveRoutedKnowledge({
        query: args.query || effectiveQuery,
        tenantId,
        limit: args.limit || 5,
      }, {
        knowledgeSearch: (request) => retrievalIndexQuery(db, user, request),
        foodCompositionLookup: lookupFoodCompositionReferences,
      });
      return {
        items: routed.results,
        warnings: routed.degradedReasons.map((message) => ({ code: 'KNOWLEDGE_RETRIEVAL_DEGRADED', message })),
        meta: { trace: routed.trace },
      };
    });
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

  const deterministicAnswer = buildAgentAnswer({ intent, query: effectiveQuery, dishSearch, recommendation, knowledge, orders, analytics });
  const evidence = recommendation?.evidence || { dishes: dishSearch ? dishEvidenceFromSearch(dishSearch) : [], knowledge: knowledge?.citations || [] };
  const citations = [...(evidence.dishes || []), ...(evidence.knowledge || [])];
  let groundedGeneration = { answer: null, citationIds: [], reason: 'INTENT_NOT_GENERATIVE' };
  if (['dish_search', 'meal_recommendation', 'knowledge_qa'].includes(intent) && citations.length) {
    try {
      groundedGeneration = await generateGroundedAgentAnswer({
        query: effectiveQuery,
        intent,
        deterministicAnswer,
        citations,
        hardConstraints: recommendation?.meta?.interpreted?.hardConstraints || dishSearch?.interpreted?.hardConstraints || {},
      });
    } catch (error) {
      groundedGeneration = { answer: null, citationIds: [], reason: error.code || error.message || 'GROUNDED_GENERATION_FAILED' };
    }
  }
  const answer = groundedGeneration.answer || deterministicAnswer;
  await runAgentTool(registry, 'session.save', user, steps, toolResults, async () => {
    await appendAgentMessage(db, user, session.id, 'assistant', answer, {
      intent,
      answerSource: groundedGeneration.answer ? 'llm_grounded' : 'deterministic',
      citationIds: groundedGeneration.citationIds,
      fallbackReason: groundedGeneration.answer ? null : groundedGeneration.reason,
    });
    return { sessionId: session.id, saved: true };
  });
  const plan = buildAgentPlan({ intent, steps, user, includeCreateOrder: Boolean(orderItems.length) });
  plan.picks = recommendation?.recommendations || dishSearch?.items || [];
  plan.citations = citations;
  plan.indexVersion = recommendation?.meta?.indexVersion || dishSearch?.meta?.indexVersion || RETRIEVAL_INDEX_VERSION;
  plan.degradedReasons = recommendation?.meta?.degradedReasons || dishSearch?.meta?.degradedReasons || [];
  const summary = summarizeAgentRun({ plan, steps, actions });
  toolResults.profile = toolResults['profile.load'] ? { goal: toolResults['profile.load'].goal, mealType: toolResults['profile.load'].mealType, taste: toolResults['profile.load'].taste, halalOnly: toolResults['profile.load'].halalOnly } : undefined;
  toolResults.recommendation = recommendation ? { source: recommendation.meta.source, citationCount: citations.length, pickCount: recommendation.recommendations.length, orderable: recommendation.meta.orderable } : undefined;
  toolResults.orders = orders;
  toolResults.analytics = analytics;
  toolResults.registry = steps.map((step) => ({ tool: step.tool, title: step.title, category: step.category, riskLevel: step.riskLevel, status: step.status, latencyMs: step.latencyMs }));
  toolResults.catalog = agentToolCatalog();
  toolResults.personas = agentPersonasFor(intent, user);
  toolResults.toolRouting = { ...toolRouting, deterministicIntent, resolvedIntent: intent, executedCalls: steps.map((step) => step.tool) };
  toolResults.grounding = {
    answerSource: groundedGeneration.answer ? 'llm_grounded' : 'deterministic',
    citationIds: groundedGeneration.citationIds,
    evidenceClasses: groundedGeneration.evidenceClasses || [],
    fallbackReason: groundedGeneration.answer ? null : groundedGeneration.reason,
    model: groundedGeneration.model || null,
  };
  toolResults.functions = agentToolFunctions(user);
  const result = {
    sessionId: session.id,
    answer,
    answerSource: groundedGeneration.answer ? 'llm_grounded' : 'deterministic',
    answerCitationIds: groundedGeneration.citationIds,
    answerEvidenceClasses: groundedGeneration.evidenceClasses || [],
    intent,
    steps,
    toolResults,
    citations,
    evidence,
    plan,
    mealPlan: recommendation?.mealPlan || null,
    recommendations: recommendation?.recommendations || [],
    search: dishSearch,
    summary,
    actions,
    memory: longMemory,
    personas: toolResults.personas,
  };
  const evalMetrics = await recordAgentEvalRun(db, user, session.id, result, steps.reduce((total, step) => total + (step.latencyMs || 0), 0));
  result.eval = evalMetrics;
  if (intent === 'meal_recommendation') result.memory = await updateAgentMemory(db, user, query);
  return result;
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
export function createApp({ db = openDatabase(), cache = createCache(), metrics = createRuntimeMetrics() } = {}) {
  const invitationScheduler = startInvitationBatchScheduler(db);

  async function rankings(tenantId = 'default', date = businessDate(), mealType = 'all') {
    const key = rankingCacheKey({ tenantId, date, mealType });
    const cached = await cache.get(key);
    if (cached) return cached;
    const value = await computeRankings(db, tenantId);
    await cache.set(key, value);
    return value;
  }

  async function invalidateRankings(tenantId = db.currentContext?.()?.tenantId || 'default') {
    await cache.del(rankingCacheKey({ tenantId, date: businessDate(), mealType: 'all' }));
  }

  async function handler(req, res) {
    const requestId = requestIdFrom(req);
    res.setHeader('X-Request-Id', requestId);
    const finishMetric = metrics.beginRequest();
    res.once('finish', () => finishMetric(res.statusCode));
    res.once('close', () => finishMetric(res.statusCode || 499));
    const authorization = String(req.headers.authorization || '');
    const claims = verifyToken(authorization.startsWith('Bearer ') ? authorization.slice(7) : '');
    const authRoute = String(req.url || '').startsWith('/api/auth/');
    const operation = async () => {
      try {
      await rateLimit(cache, req);
      const url = new URL(req.url, 'http://localhost');
      const method = req.method || 'GET';
      const user = await getUserFromRequest(db, req);
      if (user && typeof db.updateContext === 'function') {
        db.updateContext({ tenantId: tenantIdFor(user), userId: user.id, role: user.role, requestId });
      }
      const aiSettings = await getAiSettings(db, user).catch(() => ({}));
      return await withAiRuntimeConfig(aiSettings, async () => {
        const pathParts = url.pathname.split('/').filter(Boolean);

      if (method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true }, { 'X-Request-Id': requestId });
      if (method === 'GET' && url.pathname === '/api/health/live') {
        return send(res, 200, { ok: true, status: 'live', uptimeSeconds: Math.round(process.uptime()) }, { 'X-Request-Id': requestId });
      }
      if (method === 'GET' && url.pathname === '/api/health/ready') {
        let databaseReady = false;
        try {
          databaseReady = typeof db.ping === 'function'
            ? await db.ping()
            : Number((await db.prepare('SELECT 1 AS ok').get())?.ok || 0) === 1;
        } catch {}
        const cacheStatus = typeof cache.status === 'function'
          ? await cache.status()
          : { ok: true, backend: 'unknown', degraded: false };
        const cacheRequired = process.env.REDIS_REQUIRED === '1' || process.env.REDIS_REQUIRED === 'true';
        const cacheReady = !cacheRequired || (cacheStatus.ok && cacheStatus.distributed === true);
        const ready = databaseReady && cacheReady;
        return send(res, ready ? 200 : 503, {
          ok: ready,
          status: ready ? 'ready' : 'not_ready',
          checks: { database: databaseReady, cache: cacheStatus }
        }, { 'X-Request-Id': requestId });
      }
      if (method === 'GET' && url.pathname === '/api/internal/metrics') {
        const internalToken = String(process.env.INTERNAL_METRICS_TOKEN || '');
        const suppliedToken = String(req.headers['x-internal-token'] || '');
        if (internalToken && suppliedToken === internalToken) {
          db.updateContext?.({ tenantId: '*', userId: '', role: 'metrics_reader', requestId });
        } else {
          await requireCapability(db, req, 'audit:read');
        }
        const cacheStatus = typeof cache.status === 'function' ? await cache.status() : null;
        const backlog = await outboxBacklog(db).catch(() => null);
        return send(res, 200, metrics.snapshot({ db, cache: cacheStatus, outbox: backlog }), { 'X-Request-Id': requestId });
      }
      if (method === 'GET' && url.pathname === '/api/bootstrap') return send(res, 200, await clientBootstrapSnapshot(db, user), { 'X-Request-Id': requestId });

      if (method === 'GET' && url.pathname === '/api/auth/capabilities') {
        return send(res, 200, await authCapabilities(db), { 'X-Request-Id': requestId });
      }

      if (await handleAuthSessionRoute({
        method,
        pathname: url.pathname,
        req,
        db,
        user,
        readBody,
        send: (status, data) => send(res, status, data, { 'X-Request-Id': requestId })
      })) return;

      assertPilotWriteAllowed(disabledPilotWriteFeature(method, url.pathname, pathParts));

      if (method === 'POST' && url.pathname === '/api/auth/verification-codes') {
        return send(res, 202, await issueVerificationCode(db, req, await readBody(req)));
      }

      if (method === 'POST' && url.pathname === '/api/auth/register') {
        const body = await readBody(req);
        if (!body.phone && body.username && process.env.NODE_ENV !== 'production') {
          requireFields(body, ['username', 'password']);
          const username = String(body.username).trim();
          const existing = await db.prepare('SELECT id FROM users WHERE tenant_id = ? AND username = ?').get('default', username);
          if (existing) throw Object.assign(new Error('用户名已存在'), { status: 409 });
          const id = `u-${randomUUID()}`;
          await db.prepare('INSERT INTO users (id, tenant_id, username, password_hash, nickname, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(id, 'default', username, hashPassword(body.password), body.nickname || username, 'student', now(), now());
          await db.prepare('INSERT INTO health_profiles (user_id, tenant_id, goal, budget_max, meal_type, taste, halal_only, avoid_json, allergies_json, dietary_pattern, spice_level, nutrition_focus_json, prefer_low_crowd, favorite_tags_json, onboarding_status, allergy_status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(id, 'default', 'healthy', 20, 'lunch', '不限', 0, '[]', '[]', 'unrestricted', 0, '[]', 0, '[]', 'completed', 'none', now());
          const created = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
          return send(res, 201, await authenticatedSessionResponse(db, req, created, { isNewUser: true }));
        }
        requireFields(body, ['phone', 'password', 'agreementVersion']);
        const phone = normalizePhone(body.phone);
        if (!phone) throw Object.assign(new Error('请输入有效的中国大陆手机号'), { status: 400, code: 'INVALID_PHONE' });
        const password = assertStudentPassword(body.password);
        const agreement = assertAgreementVersion(body.agreementVersion);
        const registrationMode = invitationRegistrationConfig().mode;
        const hasInvitationCode = Boolean(String(body.invitationCode || '').trim());
        const invitationRegistration = registrationMode === 'invitation' || (registrationMode === 'optional' && hasInvitationCode);
        if (registrationMode === 'invitation') {
          requireFields({ invitationCode: body.invitationCode }, ['invitationCode']);
          assertInvitationCode(body.invitationCode);
          if (body.verificationCode) throw Object.assign(new Error('当前注册模式不需要短信验证码'), { status: 400, code: 'VERIFICATION_CODE_NOT_ALLOWED' });
        } else if (invitationRegistration) {
          assertInvitationCode(body.invitationCode);
        }
        const hash = phoneLookupHash(phone);
        assertNewRegistrationAllowed(phone, { invitation: invitationRegistration });
        const id = `u-${randomUUID()}`;
        const timestamp = now();
        const username = `student_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
        const nickname = String(body.nickname || `同学${phone.slice(-4)}`).trim().slice(0, 32) || `同学${phone.slice(-4)}`;
        let consumedInvitationHash = '';
        const createStudent = async (tx) => {
          const existing = await tx.prepare('SELECT id FROM users WHERE tenant_id = ? AND phone_hash = ?').get('default', hash);
          if (existing) throw Object.assign(new Error('该手机号已注册'), { status: 409, code: 'PHONE_ALREADY_REGISTERED' });
          if (invitationRegistration) {
            consumedInvitationHash = (await consumeInvitationCode(tx, 'default', body.invitationCode, hash)).hash;
          }
          await tx.prepare('INSERT INTO users (id, tenant_id, username, password_hash, nickname, role, phone_hash, phone_encrypted, phone_verified_at, token_version, agreement_version, agreement_accepted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(id, 'default', username, hashPassword(password), nickname, 'student', hash, encryptPhone(phone), invitationRegistration ? null : timestamp, 0, agreement, timestamp, timestamp, timestamp);
          if (consumedInvitationHash) {
            await tx.prepare('UPDATE pilot_invitations SET used_user_id = ?, updated_at = ? WHERE tenant_id = ? AND code_hash = ?')
              .run(id, now(), 'default', consumedInvitationHash);
          }
          await createPendingHealthProfile(tx, id, 'default');
          return tx.prepare('SELECT * FROM users WHERE id = ?').get(id);
        };
        if (!invitationRegistration) {
          if (!body.verificationCode) throw Object.assign(new Error('请输入短信验证码'), { status: 400, code: 'VERIFICATION_CODE_REQUIRED' });
          const existing = await db.prepare('SELECT id FROM users WHERE tenant_id = ? AND phone_hash = ?').get('default', hash);
          if (existing) throw Object.assign(new Error('该手机号已注册'), { status: 409, code: 'PHONE_ALREADY_REGISTERED' });
          await consumeVerificationCode(db, phone, 'register', body.verificationCode);
        }
        const created = await withTransaction(db, createStudent);
        if (consumedInvitationHash) {
          await audit(db, { ...created, tenant_id: 'default' }, 'CONSUME', 'pilot_invitation', consumedInvitationHash.slice(0, 16), { userId: created.id });
        }
        return send(res, 201, await authenticatedSessionResponse(db, req, created, { isNewUser: true }));
      }

      if (method === 'POST' && url.pathname === '/api/auth/login') {
        const body = await readBody(req);
        const identifier = String(body.identifier || body.username || '').trim();
        requireFields({ identifier, password: body.password }, ['identifier', 'password']);
        await assertLoginAllowed(cache, identifier, req);
        const phone = normalizePhone(identifier);
        const found = phone
          ? await db.prepare('SELECT * FROM users WHERE tenant_id = ? AND phone_hash = ?').get('default', phoneLookupHash(phone))
          : await db.prepare('SELECT * FROM users WHERE username = ?').get(identifier);
        const passwordMatches = found && verifyPassword(body.password, found.password_hash);
        const loginTenant = passwordMatches
          ? await db.prepare('SELECT status FROM tenants WHERE id = ?').get(found.tenant_id)
          : null;
        if (!passwordMatches || loginTenant?.status !== 'active') {
          await recordLoginFailure(cache, identifier, req);
          throw Object.assign(new Error('手机号、账号或密码错误'), { status: 401 });
        }
        await clearLoginFailures(cache, identifier, req);
        return send(res, 200, await authenticatedSessionResponse(db, req, found));
      }

      if (method === 'POST' && url.pathname === '/api/auth/wechat-login') {
        const body = await readBody(req);
        requireFields(body, ['code']);
        const session = await exchangeWechatCode(String(body.code).trim());
        const result = await findOrCreateWechatUser(db, session, {
          profile: body.profile || {},
          phoneCode: body.phoneCode,
          agreementVersion: body.agreementVersion
        });
        return send(res, 200, await authenticatedSessionResponse(db, req, result.user, { isNewUser: result.isNewUser }));
      }

      if (method === 'POST' && url.pathname === '/api/auth/password/reset') {
        const body = await readBody(req);
        requireFields(body, ['phone', 'verificationCode', 'newPassword']);
        const phone = normalizePhone(body.phone);
        if (!phone) throw Object.assign(new Error('请输入有效的中国大陆手机号'), { status: 400, code: 'INVALID_PHONE' });
        const password = assertStudentPassword(body.newPassword);
        const found = await db.prepare('SELECT * FROM users WHERE tenant_id = ? AND phone_hash = ?').get('default', phoneLookupHash(phone));
        if (!found) throw Object.assign(new Error('该手机号尚未注册'), { status: 404, code: 'PHONE_NOT_REGISTERED' });
        await consumeVerificationCode(db, phone, 'reset_password', body.verificationCode);
        await db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?')
          .run(hashPassword(password), now(), found.id);
        await revokeAllUserSessions(db, found.id);
        return send(res, 200, { reset: true });
      }

      if (method === 'GET' && url.pathname === '/api/account/export') {
        const activeUser = await requireUser(db, req);
        return send(res, 200, await buildAccountDataExport(db, activeUser), {
          'Content-Disposition': 'attachment; filename="smart-canteen-account-export.json"'
        });
      }

      if (method === 'DELETE' && url.pathname === '/api/account') {
        const activeUser = await requireUser(db, req);
        const body = await readBody(req);
        await assertAccountDeletionVerification(db, activeUser, body);
        await deleteAccount(db, activeUser);
        return send(res, 200, { deleted: true });
      }

      if (method === 'GET' && url.pathname === '/api/canteens') return send(res, 200, await listCanteens(db, tenantIdFor(user)));
      if (method === 'GET' && url.pathname === '/api/stalls') return send(res, 200, await listStalls(db, tenantIdFor(user)));
      if (method === 'GET' && url.pathname === '/api/catalog/venues') return send(res, 200, await listCatalogVenues(db, tenantIdFor(user)));
      if (method === 'GET' && url.pathname === '/api/catalog/stalls') return send(res, 200, await listCatalogStalls(db, tenantIdFor(user), url.searchParams));
      if (method === 'GET' && url.pathname === '/api/catalog/categories') return send(res, 200, await listCatalogCategories(db, tenantIdFor(user), url.searchParams));
      if (method === 'GET' && url.pathname === '/api/catalog/rankings') return send(res, 200, await listCatalogRankings(db, tenantIdFor(user), url.searchParams));
      if (method === 'GET' && url.pathname === '/api/catalog/saved') {
        const activeUser = await requireUser(db, req);
        return send(res, 200, await listSavedCatalogDishes(db, activeUser, url.searchParams));
      }
      if (method === 'GET' && url.pathname === '/api/community/dish-options') {
        const activeUser = await requireUser(db, req);
        return send(res, 200, await listCommunityDishOptions(db, tenantIdFor(activeUser), url.searchParams));
      }
      if (method === 'POST' && url.pathname === '/api/dishes/search') {
        const result = await searchCatalogDishes(db, tenantIdFor(user), await readBody(req));
        return send(res, 200, result);
      }
      if (method === 'GET' && url.pathname === '/api/dishes') return send(res, 200, await executeLegacyDishList(db, user, url.searchParams));
      if (method === 'GET' && url.pathname.startsWith('/api/dishes/')) {
        const detail = await dishDetail(db, decodeURIComponent(url.pathname.split('/').pop()), tenantIdFor(user));
        if (!detail) throw Object.assign(new Error('菜品不存在'), { status: 404 });
        return send(res, 200, detail);
      }
      if (method === 'GET' && url.pathname === '/api/rankings') {
        const tenantId = tenantIdFor(user);
        return send(res, 200, await rankings(
          tenantId,
          String(url.searchParams.get('date') || businessDate()),
          String(url.searchParams.get('mealType') || 'all')
        ));
      }
      if (method === 'GET' && url.pathname === '/api/menus/today') {
        return send(res, 410, { error: { code: 'TODAY_MENU_RETIRED', message: '学生端已切换为学期稳定目录，请使用 /api/dishes/search。' } });
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
        return send(res, 200, buildHealthPlan(dishes.filter((dish) => dish.status !== 'archived' && dish.catalogItemType === 'meal'), profile, days));
      }

      if (method === 'POST' && url.pathname === '/api/orders') {
        const activeUser = await requireUser(db, req);
        const body = await readBody(req);
        body.idempotencyKey ||= String(req.headers['x-idempotency-key'] || '');
        const order = await createOrder(db, activeUser, body);
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

      if (method === 'GET' && url.pathname === '/api/admin/invitations/summary') {
        const activeUser = await requireCapability(db, req, 'invitation:manage');
        const tenantId = tenantIdFor(activeUser);
        const settings = normalizeInvitationSettings(await ensureInvitationSettings(db, tenantId));
        const date = normalizeInvitationDate(url.searchParams.get('date') || businessDate(new Date(), settings.timeZone));
        const batch = await ensureInvitationBatch(db, tenantId, date, { createdBy: null });
        const reclaimed = await reclaimExpiredInvitationClaims(db, { tenantId, batchId: batch?.id || null });
        await auditReclaimedInvitationClaims(db, activeUser, reclaimed);
        return send(res, 200, await invitationSummary(db, tenantId, date));
      }

      if (method === 'PUT' && url.pathname === '/api/admin/invitations/settings') {
        const activeUser = await requireCapability(db, req, 'invitation:manage');
        const tenantId = tenantIdFor(activeUser);
        const current = normalizeInvitationSettings(await ensureInvitationSettings(db, tenantId));
        const body = await readBody(req);
        const dailyQuota = Number(body.dailyQuota ?? current.dailyQuota);
        const expiresAfterDays = Number(body.expiresAfterDays ?? current.expiresAfterDays);
        const claimTtlHours = Number(body.claimTtlHours ?? current.claimTtlHours);
        const issueTime = normalizeInvitationTime(body.issueTime ?? current.issueTime);
        const autoIssue = body.autoIssue === undefined ? current.autoIssue : Boolean(body.autoIssue);
        const timeZone = String(body.timeZone ?? current.timeZone).trim() || current.timeZone;
        if (!Number.isInteger(dailyQuota) || dailyQuota < 0 || dailyQuota > MAX_DAILY_INVITATION_QUOTA) {
          throw Object.assign(new Error('每日邀请码数量必须是 0-5000 的整数'), { status: 400, code: 'INVALID_INVITATION_DAILY_QUOTA' });
        }
        if (!Number.isInteger(expiresAfterDays) || expiresAfterDays < 1 || expiresAfterDays > 365) {
          throw Object.assign(new Error('邀请码有效期必须是 1-365 天'), { status: 400, code: 'INVALID_INVITATION_EXPIRY_DAYS' });
        }
        if (!Number.isInteger(claimTtlHours) || claimTtlHours < 1 || claimTtlHours > 168) {
          throw Object.assign(new Error('领取锁定时间必须是 1-168 小时'), { status: 400, code: 'INVALID_INVITATION_CLAIM_TTL' });
        }
        try { new Intl.DateTimeFormat('en-US', { timeZone }).format(); }
        catch { throw Object.assign(new Error('邀请码时区无效'), { status: 400, code: 'INVALID_INVITATION_TIME_ZONE' }); }
        const timestamp = now();
        await db.prepare(`UPDATE pilot_invitation_settings SET daily_quota = ?, auto_issue = ?, expires_after_days = ?,
          claim_ttl_hours = ?, issue_time = ?, time_zone = ?, updated_by = ?, updated_at = ? WHERE tenant_id = ?`)
          .run(dailyQuota, autoIssue ? 1 : 0, expiresAfterDays, claimTtlHours, issueTime, timeZone, activeUser.id, timestamp, tenantId);
        await audit(db, activeUser, 'UPDATE_SETTINGS', 'pilot_invitation', tenantId, { dailyQuota, autoIssue, expiresAfterDays, claimTtlHours, issueTime, timeZone });
        const date = normalizeInvitationDate(body.businessDate || businessDate(new Date(), timeZone));
        const batch = await ensureInvitationBatch(db, tenantId, date, { createdBy: activeUser.id });
        const reclaimed = await reclaimExpiredInvitationClaims(db, { tenantId, batchId: batch?.id || null });
        await auditReclaimedInvitationClaims(db, activeUser, reclaimed);
        return send(res, 200, await invitationSummary(db, tenantId, date));
      }

      if (method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'invitations'
        && pathParts[3] === 'batches' && pathParts[4] && pathParts[5] === 'issue') {
        const activeUser = await requireCapability(db, req, 'invitation:manage');
        const tenantId = tenantIdFor(activeUser);
        const date = normalizeInvitationDate(decodeURIComponent(pathParts[4]));
        let batch = await ensureInvitationBatch(db, tenantId, date, { force: true, createdBy: activeUser.id });
        const reclaimed = await reclaimExpiredInvitationClaims(db, { tenantId, batchId: batch.id });
        await auditReclaimedInvitationClaims(db, activeUser, reclaimed);
        batch = await db.prepare('SELECT * FROM pilot_invitation_batches WHERE tenant_id = ? AND id = ?').get(tenantId, batch.id);
        if (batch.status !== 'active') {
          throw Object.assign(new Error('邀请码批次已停止发放'), { status: 409, code: 'INVITATION_BATCH_NOT_ACTIVE' });
        }
        const body = await readBody(req);
        const requestedCount = Number(body.count ?? 1);
        const remaining = Math.max(0, Number(batch.daily_quota || 0) - Number(batch.issued_count || 0));
        if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 500) {
          throw Object.assign(new Error('每次补发数量必须是 1-500 的整数'), { status: 400, code: 'INVALID_INVITATION_COUNT' });
        }
        if (requestedCount > remaining) {
          throw Object.assign(new Error(`当天只剩 ${remaining} 个邀请码额度`), { status: 409, code: 'INVITATION_DAILY_QUOTA_EXHAUSTED' });
        }
        const invitations = await generateInvitationRows(db, {
          tenantId,
          count: requestedCount,
          expiresAt: batch.expires_at,
          createdBy: activeUser.id,
          batchId: batch.id
        });
        await audit(db, activeUser, 'ISSUE', 'pilot_invitation_batch', batch.id, { count: requestedCount, businessDate: date });
        return send(res, 201, { batch: invitationBatchView(await db.prepare('SELECT * FROM pilot_invitation_batches WHERE id = ?').get(batch.id)), invitations, plaintextShownOnce: true });
      }

      if (method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'invitations'
        && pathParts[3] === 'batches' && pathParts[4] && pathParts[5] === 'close') {
        const activeUser = await requireCapability(db, req, 'invitation:manage');
        const tenantId = tenantIdFor(activeUser);
        const batchId = decodeURIComponent(pathParts[4]);
        const closed = await withTransaction(db, async (tx) => {
          const updated = await tx.prepare(`UPDATE pilot_invitation_batches
            SET status = 'closed', updated_at = ?
            WHERE tenant_id = ? AND id = ? AND status = 'active'`).run(now(), tenantId, batchId);
          if (Number(updated?.changes || 0) !== 1) {
            throw Object.assign(new Error('批次不存在或已经停止发放'), { status: 409, code: 'INVITATION_BATCH_NOT_ACTIVE' });
          }
          return tx.prepare('SELECT * FROM pilot_invitation_batches WHERE tenant_id = ? AND id = ?').get(tenantId, batchId);
        });
        await audit(db, activeUser, 'CLOSE', 'pilot_invitation_batch', batchId, { issuedCount: closed.issued_count });
        return send(res, 200, { batch: invitationBatchView(closed), stoppedAt: now() });
      }

      if (method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'invitations'
        && pathParts[3] && pathParts[4] === 'claim') {
        const activeUser = await requireCapability(db, req, 'invitation:manage');
        const tenantId = tenantIdFor(activeUser);
        const batchId = decodeURIComponent(pathParts[3]);
        const result = await claimInvitationSlot(db, { tenantId, batchId, claimedBy: activeUser.id });
        await auditReclaimedInvitationClaims(db, activeUser, result.reclaimedInvitationIds);
        await audit(db, activeUser, 'CLAIM', 'pilot_invitation', result.invitation.id, { batchId });
        return send(res, 201, { invitation: result.invitation, plaintextShownOnce: true });
      }

      if (method === 'GET' && url.pathname === '/api/admin/invitations') {
        const activeUser = await requireCapability(db, req, 'invitation:manage');
        const tenantId = tenantIdFor(activeUser);
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
        const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
        const date = url.searchParams.get('date') ? normalizeInvitationDate(url.searchParams.get('date')) : '';
        const batchFilter = String(url.searchParams.get('batchId') || url.searchParams.get('batch') || '').trim();
        const requestedStatus = String(url.searchParams.get('status') || '').trim();
        if (requestedStatus && !['active', 'claimed', 'consumed', 'revoked', 'expired'].includes(requestedStatus)) {
          throw Object.assign(new Error('邀请码状态无效'), { status: 400, code: 'INVALID_INVITATION_STATUS' });
        }
        const clauses = ['p.tenant_id = ?'];
        const params = [tenantId];
        if (date) { clauses.push('b.business_date = ?'); params.push(date); }
        if (batchFilter) { clauses.push('bi.batch_id = ?'); params.push(batchFilter); }
        const rows = await db.prepare(`SELECT p.id, p.code_hint, p.status, p.expires_at, p.used_at, p.used_user_id, p.created_by, p.created_at, p.updated_at,
            bi.batch_id, b.business_date, c.claimed_by, c.claimed_at, c.claim_expires_at, c.reclaimed_at,
            u.phone_encrypted, u.phone_verified_at
          FROM pilot_invitations p
          LEFT JOIN pilot_invitation_batch_items bi ON bi.invitation_id = p.id AND bi.tenant_id = p.tenant_id
          LEFT JOIN pilot_invitation_batches b ON b.id = bi.batch_id AND b.tenant_id = p.tenant_id
          LEFT JOIN pilot_invitation_claims c ON c.invitation_id = p.id AND c.tenant_id = p.tenant_id
          LEFT JOIN users u ON u.id = p.used_user_id AND u.tenant_id = p.tenant_id
          WHERE ${clauses.join(' AND ')} ORDER BY p.created_at DESC, p.id DESC`).all(...params);
        const mapped = rows.map(invitationRowView).filter((row) => !requestedStatus || row.status === requestedStatus);
        return send(res, 200, { invitations: mapped.slice(offset, offset + limit), page: { limit, offset, total: mapped.length } });
      }

      if (method === 'POST' && url.pathname === '/api/admin/invitations/generate') {
        const activeUser = await requireCapability(db, req, 'invitation:manage');
        const body = await readBody(req);
        const count = Number(body.count ?? 1);
        if (!Number.isInteger(count) || count < 1 || count > 500) {
          throw Object.assign(new Error('一次只能生成 1-500 个邀请码'), { status: 400, code: 'INVALID_INVITATION_COUNT' });
        }
        const tenantId = tenantIdFor(activeUser);
        let batchId = null;
        let expiresAt = invitationExpiry(body.expiresAt);
        if (body.batchId) {
          const batch = await db.prepare('SELECT id, expires_at, status FROM pilot_invitation_batches WHERE tenant_id = ? AND id = ?').get(tenantId, String(body.batchId));
          if (!batch) throw Object.assign(new Error('邀请码批次不存在或不属于当前租户'), { status: 404, code: 'INVITATION_BATCH_NOT_FOUND' });
          if (batch.status !== 'active') throw Object.assign(new Error('邀请码批次已暂停或关闭'), { status: 409, code: 'INVITATION_BATCH_NOT_ACTIVE' });
          batchId = batch.id;
          expiresAt = batch.expires_at || expiresAt;
        } else if (body.businessDate) {
          const date = normalizeInvitationDate(body.businessDate);
          const batch = await ensureInvitationBatch(db, tenantId, date, { force: true, createdBy: activeUser.id });
          batchId = batch.id;
          expiresAt = batch.expires_at || expiresAt;
        }
        if (batchId) {
          const reclaimed = await reclaimExpiredInvitationClaims(db, { tenantId, batchId });
          await auditReclaimedInvitationClaims(db, activeUser, reclaimed);
        }
        const invitations = await generateInvitationRows(db, {
          tenantId,
          count,
          expiresAt,
          createdBy: activeUser.id,
          batchId
        });
        await audit(db, activeUser, 'GENERATE', 'pilot_invitation', batchId || `batch-${randomUUID()}`, { count, expiresAt, batchId });
        return send(res, 201, { invitations, plaintextShownOnce: true, batchId });
      }

      if (method === 'PATCH' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'invitations' && pathParts[3] && !pathParts[4]) {
        const activeUser = await requireCapability(db, req, 'invitation:manage');
        const invitationId = decodeURIComponent(pathParts[3]);
        const body = await readBody(req);
        if (!body.expiresAt) {
          throw Object.assign(new Error('请提供新的邀请码有效期'), { status: 400, code: 'INVITATION_EXPIRY_REQUIRED' });
        }
        const expiresAt = invitationExpiry(body.expiresAt);
        const tenantId = tenantIdFor(activeUser);
        const updated = await withTransaction(db, async (tx) => {
          const row = await tx.prepare(`SELECT p.id, p.status, p.expires_at, c.claimed_at, c.claim_expires_at, c.reclaimed_at
            FROM pilot_invitations p
            LEFT JOIN pilot_invitation_claims c ON c.invitation_id = p.id AND c.tenant_id = p.tenant_id
            WHERE p.tenant_id = ? AND p.id = ?`).get(tenantId, invitationId);
          if (!row || !['active', 'claimed'].includes(invitationStatus(row))) {
            throw Object.assign(new Error('只有未使用的邀请码可以修改'), { status: 409, code: 'INVITATION_NOT_EDITABLE' });
          }
          const result = await tx.prepare(`UPDATE pilot_invitations SET expires_at = ?, updated_at = ?
            WHERE tenant_id = ? AND id = ? AND status = 'active'`).run(expiresAt, now(), tenantId, invitationId);
          if (Number(result?.changes || 0) !== 1) {
            throw Object.assign(new Error('邀请码已被其他操作更新'), { status: 409, code: 'INVITATION_NOT_EDITABLE' });
          }
          return { id: invitationId, expiresAt };
        });
        await audit(db, activeUser, 'UPDATE_EXPIRY', 'pilot_invitation', invitationId, { expiresAt });
        return send(res, 200, { invitation: updated });
      }

      if ((method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'invitations' && pathParts[3] && pathParts[4] === 'revoke')
        || (method === 'DELETE' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'invitations' && pathParts[3] && !pathParts[4])) {
        const activeUser = await requireCapability(db, req, 'invitation:manage');
        const invitationId = decodeURIComponent(pathParts[3]);
        const tenantId = tenantIdFor(activeUser);
        const revoked = await withTransaction(db, async (tx) => {
          const row = await tx.prepare(`SELECT p.id, p.status, p.expires_at, c.claimed_at, c.claim_expires_at, c.reclaimed_at, bi.batch_id
            FROM pilot_invitations p
            LEFT JOIN pilot_invitation_claims c ON c.invitation_id = p.id AND c.tenant_id = p.tenant_id
            LEFT JOIN pilot_invitation_batch_items bi ON bi.invitation_id = p.id AND bi.tenant_id = p.tenant_id
            WHERE p.tenant_id = ? AND p.id = ?`).get(tenantId, invitationId);
          if (!row || !['active', 'claimed'].includes(invitationStatus(row))) {
            throw Object.assign(new Error('邀请码不存在或已不能撤销'), { status: 409, code: 'INVITATION_NOT_ACTIVE' });
          }
          const updated = await tx.prepare(`UPDATE pilot_invitations SET status = 'revoked', updated_at = ?
            WHERE tenant_id = ? AND id = ? AND status = 'active'`).run(now(), tenantId, invitationId);
          if (Number(updated?.changes || 0) !== 1) {
            throw Object.assign(new Error('邀请码不存在或已不能撤销'), { status: 409, code: 'INVITATION_NOT_ACTIVE' });
          }
          if (row.batch_id) {
            await tx.prepare(`UPDATE pilot_invitation_batches
              SET issued_count = CASE WHEN issued_count > 0 THEN issued_count - 1 ELSE 0 END, updated_at = ?
              WHERE tenant_id = ? AND id = ? AND issued_count > 0`).run(now(), tenantId, row.batch_id);
          }
          return { id: invitationId, batchId: row.batch_id || null };
        });
        await audit(db, activeUser, 'REVOKE', 'pilot_invitation', invitationId);
        return send(res, 200, { revoked: true, ...revoked });
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
        return send(res, 200, await orderAnalytics(db, tenantIdFor(activeUser), url.searchParams.get('date') || businessDate()));
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
          const analysis = await analyzeTrustworthyMeal({
            db,
            user: activeUser,
            body: await readBody(req, MAX_IMAGE_BODY_BYTES),
            model: status.visionModel,
          });
          await audit(db, activeUser, 'VISION_ANALYZE', 'meal_vision_analysis', analysis.analysisId);
          await recordAiUsage(db, activeUser, { feature: 'student-vision', provider: status.source, model: status.visionModel, status: 'success', imageCount: 1, outputTokens: estimateTokens(JSON.stringify(analysis.observation)), latencyMs: Date.now() - startedAt });
          return send(res, 200, analysis);
        } catch (error) {
          await recordAiUsage(db, activeUser, { feature: 'student-vision', provider: status.source, model: status.visionModel, status: 'failure', imageCount: 1, latencyMs: Date.now() - startedAt, error: error.message });
          throw error;
        }
      }

      if (method === 'PATCH' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'orders' && pathParts[3] && pathParts[4] === 'price') {
        const activeUser = await requireCapability(db, req, 'dish:write');
        const order = await confirmReservationPrice(db, activeUser, decodeURIComponent(pathParts[3]), await readBody(req));
        await audit(db, activeUser, 'CONFIRM_PRICE', 'order', order.id);
        return send(res, 200, { order });
      }

      if (method === 'PATCH' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'stalls' && pathParts[3] && pathParts[4] === 'reservation') {
        const activeUser = await requireCapability(db, req, 'stall:write');
        const body = await readBody(req);
        if (typeof body.enabled !== 'boolean') throw Object.assign(new Error('enabled 必须是布尔值'), { status: 400 });
        const reservation = await updateReservationState(db, activeUser, 'stall', decodeURIComponent(pathParts[3]), body.enabled);
        await audit(db, activeUser, 'UPDATE_RESERVATION', 'stall', reservation.id, { enabled: reservation.reservationEnabled });
        return send(res, 200, { reservation });
      }

      if (method === 'PATCH' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'dishes' && pathParts[3] && pathParts[4] === 'reservation') {
        const activeUser = await requireCapability(db, req, 'dish:write');
        const body = await readBody(req);
        if (typeof body.enabled !== 'boolean') throw Object.assign(new Error('enabled 必须是布尔值'), { status: 400 });
        const reservation = await updateReservationState(db, activeUser, 'dish', decodeURIComponent(pathParts[3]), body.enabled);
        await audit(db, activeUser, 'UPDATE_RESERVATION', 'dish', reservation.id, { enabled: reservation.reservationEnabled });
        return send(res, 200, { reservation });
      }

      if (method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'vision' && pathParts[2] === 'analyses' && pathParts[3] && pathParts[4] === 'confirm') {
        const activeUser = await requireCapability(db, req, 'agent:use');
        const analysisId = decodeURIComponent(pathParts[3]);
        const result = await confirmMealVisionAnalysis({ db, user: activeUser, analysisId, body: await readBody(req) });
        await audit(db, activeUser, 'VISION_CONFIRM', 'meal_vision_analysis', analysisId, { dishId: result.selectedDish?.id || null, feedbackType: result.feedbackType });
        return send(res, 200, result);
      }

      if (method === 'GET' && pathParts[0] === 'api' && pathParts[1] === 'uploads' && pathParts[2] && pathParts[3] === 'content') {
        const uploadId = decodeURIComponent(pathParts[2]);
        const signedAccess = verifySignedUploadUrl(
          uploadId,
          url.searchParams.get('expires'),
          url.searchParams.get('signature')
        );
        let activeUser = user;
        if (signedAccess && typeof db.updateContext === 'function') {
          db.updateContext({ tenantId: '*', userId: '', role: 'storage_reader', requestId });
        } else {
          activeUser = await requireUser(db, req);
        }
        const upload = await db.prepare('SELECT * FROM uploads WHERE id = ?').get(uploadId);
        if (!upload) throw Object.assign(new Error('上传对象不存在'), { status: 404, code: 'UPLOAD_NOT_FOUND' });
        const canManageUpload = activeUser && (
          hasPermission(activeUser, 'post:moderate')
          || hasPermission(activeUser, 'dish:write')
          || activeUser.role === 'super_admin'
        );
        if (!signedAccess && upload.owner_id !== activeUser.id && !canManageUpload) {
          throw Object.assign(new Error('无权访问该上传对象'), { status: 403, code: 'UPLOAD_ACCESS_DENIED' });
        }
        const content = await readStoredUpload(upload);
        return sendBinary(res, 200, content.body, content.contentType, { 'X-Request-Id': requestId });
      }

      if (method === 'POST' && url.pathname === '/api/uploads') {
        const activeUser = await requireCapability(db, req, 'upload:create');
        const upload = await storeUpload({ ...(await readBody(req)), tenantId: tenantIdFor(activeUser), ownerId: activeUser.id });
        await db.prepare(`INSERT INTO uploads (
          id, tenant_id, owner_id, filename, content_type, size_bytes, storage_key,
          public_url, visibility, storage_provider, object_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          upload.id,
          tenantIdFor(activeUser),
          activeUser.id,
          upload.filename,
          upload.contentType,
          upload.sizeBytes,
          upload.storageKey,
          upload.reference,
          upload.visibility,
          upload.provider,
          upload.objectVersion,
          now()
        );
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
        const includeMine = url.searchParams.get('includeMine') === 'true';
        const rows = includeMine
          ? await db.prepare("SELECT reviews.*, users.nickname, users.username, (SELECT campus_posts.id FROM campus_posts WHERE campus_posts.tenant_id = reviews.tenant_id AND campus_posts.linked_review_id = reviews.id LIMIT 1) AS linked_post_id FROM reviews JOIN users ON users.id = reviews.user_id WHERE reviews.tenant_id = ? AND (reviews.status = 'approved' OR reviews.user_id = ?)").all(tenantId, activeUser.id)
          : await db.prepare("SELECT reviews.*, users.nickname, users.username, (SELECT campus_posts.id FROM campus_posts WHERE campus_posts.tenant_id = reviews.tenant_id AND campus_posts.linked_review_id = reviews.id LIMIT 1) AS linked_post_id FROM reviews JOIN users ON users.id = reviews.user_id WHERE reviews.tenant_id = ? AND reviews.status = 'approved'").all(tenantId);
        const catalog = await reviewCatalog(db, tenantId);
        const targetType = String(url.searchParams.get('targetType') || '').trim();
        const canteenId = String(url.searchParams.get('canteenId') || '').trim();
        const stallId = String(url.searchParams.get('stallId') || '').trim();
        const dishId = String(url.searchParams.get('dishId') || '').trim();
        const q = String(url.searchParams.get('q') || '').trim().slice(0, 80).toLocaleLowerCase();
        const sort = String(url.searchParams.get('sort') || 'rating_desc');
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 30, 1), 100);
        const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
        if (targetType && !['dish', 'canteen'].includes(targetType)) throw Object.assign(new Error('targetType 必须是 dish 或 canteen'), { status: 400 });
        if (!['rating_desc', 'rating_asc', 'latest'].includes(sort)) throw Object.assign(new Error('不支持的评价排序方式'), { status: 400 });
        const enriched = await attachCommunityEngagement(db, tenantId, activeUser.id, 'review', rows.map(rowToReview)
          .map((review) => enrichReview(review, catalog, activeUser.id))
          .filter((review) => review.targetType === 'dish' ? Boolean(review.dish) : Boolean(review.canteen)));
        const filtered = enriched.filter((review) => {
          if (targetType && review.targetType !== targetType) return false;
          if (canteenId && review.canteen?.id !== canteenId) return false;
          if (stallId && review.stall?.id !== stallId) return false;
          if (dishId && review.dish?.id !== dishId) return false;
          if (q) {
            const haystack = [review.content, review.user, review.dish?.name, review.stall?.name, review.canteen?.name]
              .filter(Boolean).join(' ').toLocaleLowerCase();
            if (!haystack.includes(q)) return false;
          }
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
        await requirePublishedCatalogTarget(db, tenantIdFor(activeUser), targetType, body.targetId);
        const rating = Number(body.rating);
        const content = String(body.content).trim();
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw Object.assign(new Error('评分需要在 1-5 分之间。'), { status: 400 });
        if (content.length < 2 || content.length > 240) throw Object.assign(new Error('评价内容长度需要在 2-240 个字符之间。'), { status: 400 });
        const id = `r-${randomUUID()}`;
        await db.prepare('INSERT INTO reviews (id, tenant_id, user_id, target_type, target_id, rating, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, tenantIdFor(activeUser), activeUser.id, targetType, body.targetId, rating, content, 'pending', businessDate());
        await audit(db, activeUser, 'CREATE', 'review', id);
        await invalidateRankings();
        if (targetType === 'dish') return send(res, 201, await dishDetail(db, body.targetId, tenantIdFor(activeUser)));
        return send(res, 201, { review: { id, targetType, targetId: body.targetId, user: activeUser.nickname, rating, content, createdAt: businessDate() } });
      }

      if (method === 'GET' && url.pathname === '/api/posts') {
        const activeUser = await requireUser(db, req);
        const tenantId = tenantIdFor(activeUser);
        const rows = await db.prepare("SELECT campus_posts.*, users.nickname, users.username FROM campus_posts JOIN users ON users.id = campus_posts.user_id WHERE campus_posts.tenant_id = ? AND (campus_posts.status = 'approved' OR campus_posts.user_id = ?) ORDER BY campus_posts.created_at DESC").all(tenantId, activeUser.id);
        const catalog = await reviewCatalog(db, tenantId);
        const targetType = String(url.searchParams.get('targetType') || '').trim();
        const canteenId = String(url.searchParams.get('canteenId') || '').trim();
        const dishId = String(url.searchParams.get('dishId') || '').trim();
        const mine = url.searchParams.get('mine') === 'true';
        const q = String(url.searchParams.get('q') || '').trim().slice(0, 80).toLocaleLowerCase();
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 30, 1), 100);
        const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
        const enriched = await attachCommunityEngagement(db, tenantId, activeUser.id, 'post', rows.map(rowToPost)
          .map((post) => enrichPost(post, catalog, activeUser.id))
          .filter((post) => post.targetType === 'dish' ? Boolean(post.dish) : Boolean(post.canteen)));
        const posts = enriched.filter((post) => {
          if (mine && !post.isOwn) return false;
          if (targetType && post.targetType !== targetType) return false;
          if (canteenId && post.canteen?.id !== canteenId) return false;
          if (dishId && post.dish?.id !== dishId) return false;
          if (q) {
            const haystack = [post.content, post.user, post.dish?.name, post.stall?.name, post.canteen?.name]
              .filter(Boolean).join(' ').toLocaleLowerCase();
            if (!haystack.includes(q)) return false;
          }
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
        await requirePublishedCatalogTarget(db, tenantId, targetType, targetId);
        let rating = null;
        if (body.rating != null && body.rating !== '') {
          rating = Number(body.rating);
          if (targetType !== 'dish') throw Object.assign(new Error('只有菜品帖子可以填写评分'), { status: 400 });
          if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw Object.assign(new Error('评分需要在 1-5 分之间'), { status: 400 });
        }
        const imageUrl = persistentUploadReference(body.imageUrl);
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

      if (method === 'PUT' && pathParts[0] === 'api' && ['posts', 'reviews'].includes(pathParts[1]) && pathParts[2] && pathParts[3] === 'reaction') {
        const activeUser = await requireUser(db, req);
        const tenantId = tenantIdFor(activeUser);
        const targetType = pathParts[1] === 'posts' ? 'post' : 'review';
        const targetId = decodeURIComponent(pathParts[2]);
        await requireCommunityTarget(db, tenantId, targetType, targetId, { approved: true });
        const reaction = (await readBody(req)).reaction ?? null;
        if (reaction !== null && !['like', 'dislike'].includes(reaction)) throw Object.assign(new Error('reaction 必须是 like、dislike 或 null'), { status: 400 });
        if (reaction === null) {
          await db.prepare('DELETE FROM content_reactions WHERE tenant_id = ? AND target_type = ? AND target_id = ? AND user_id = ?').run(tenantId, targetType, targetId, activeUser.id);
        } else {
          const timestamp = now();
          await db.prepare(`INSERT INTO content_reactions (id, tenant_id, target_type, target_id, user_id, reaction, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tenant_id, target_type, target_id, user_id) DO UPDATE SET reaction = excluded.reaction, updated_at = excluded.updated_at`)
            .run(`reaction-${randomUUID()}`, tenantId, targetType, targetId, activeUser.id, reaction, timestamp, timestamp);
        }
        const [result] = await attachCommunityEngagement(db, tenantId, activeUser.id, targetType, [{ id: targetId }]);
        return send(res, 200, { id: targetId, engagement: result.engagement, viewerReaction: result.viewerReaction });
      }

      if (method === 'POST' && pathParts[0] === 'api' && ['posts', 'reviews'].includes(pathParts[1]) && pathParts[2] && pathParts[3] === 'report') {
        const activeUser = await requireUser(db, req);
        const tenantId = tenantIdFor(activeUser);
        const targetType = pathParts[1] === 'posts' ? 'post' : 'review';
        const targetId = decodeURIComponent(pathParts[2]);
        const target = await requireCommunityTarget(db, tenantId, targetType, targetId, { approved: true });
        if (target.user_id === activeUser.id) throw Object.assign(new Error('不能举报自己发布的内容'), { status: 400 });
        const body = await readBody(req);
        const reason = String(body.reason || 'other').trim().slice(0, 40);
        const detail = String(body.detail || '').trim().slice(0, 300);
        const timestamp = now();
        await db.prepare(`INSERT INTO content_reports (id, tenant_id, reporter_id, target_type, target_id, reason, detail, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
          ON CONFLICT DO NOTHING`).run(`report-${randomUUID()}`, tenantId, activeUser.id, targetType, targetId, reason || 'other', detail, timestamp, timestamp);
        return send(res, 200, { reported: true });
      }

      if (method === 'GET' && pathParts[0] === 'api' && pathParts[1] === 'posts' && pathParts[2] && pathParts[3] === 'comments') {
        const activeUser = await requireUser(db, req);
        const tenantId = tenantIdFor(activeUser);
        const postId = decodeURIComponent(pathParts[2]);
        await requireCommunityTarget(db, tenantId, 'post', postId, { approved: true });
        const comments = await db.prepare(`SELECT post_comments.*, users.nickname, users.username FROM post_comments
          JOIN users ON users.id = post_comments.user_id
          WHERE post_comments.tenant_id = ? AND post_comments.post_id = ? AND post_comments.status = 'approved'
          ORDER BY post_comments.created_at ASC`).all(tenantId, postId);
        return send(res, 200, { comments: comments.map((row) => ({
          id: row.id, postId: row.post_id, content: row.content,
          user: row.nickname || row.username || '匿名用户', userId: row.user_id,
          isOwn: row.user_id === activeUser.id, createdAt: row.created_at, updatedAt: row.updated_at
        })) });
      }

      if (method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'posts' && pathParts[2] && pathParts[3] === 'comments') {
        const activeUser = await requireUser(db, req);
        const tenantId = tenantIdFor(activeUser);
        const postId = decodeURIComponent(pathParts[2]);
        await requireCommunityTarget(db, tenantId, 'post', postId, { approved: true });
        const content = String((await readBody(req)).content || '').trim();
        if (content.length < 1 || content.length > 300) throw Object.assign(new Error('评论内容长度需要在 1-300 个字符之间'), { status: 400 });
        const id = `comment-${randomUUID()}`;
        const timestamp = now();
        await db.prepare('INSERT INTO post_comments (id, tenant_id, post_id, user_id, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, tenantId, postId, activeUser.id, content, 'approved', timestamp, timestamp);
        return send(res, 201, { comment: { id, postId, content, user: activeUser.nickname || activeUser.username, userId: activeUser.id, isOwn: true, createdAt: timestamp, updatedAt: timestamp } });
      }

      if (method === 'PATCH' && pathParts[0] === 'api' && pathParts[1] === 'posts' && pathParts[2] && pathParts.length === 3) {
        const activeUser = await requireUser(db, req);
        const tenantId = tenantIdFor(activeUser);
        const postId = decodeURIComponent(pathParts[2]);
        const post = await requireCommunityTarget(db, tenantId, 'post', postId);
        if (post.user_id !== activeUser.id) throw Object.assign(new Error('只能修改自己发布的帖子'), { status: 403 });
        const body = await readBody(req);
        const content = body.content === undefined ? post.content : String(body.content || '').trim();
        if (content.length < 2 || content.length > 600) throw Object.assign(new Error('帖子内容长度需要在 2-600 个字符之间'), { status: 400 });
        let rating = body.rating === undefined ? post.rating : (body.rating === null || body.rating === '' ? null : Number(body.rating));
        if (rating !== null && (post.target_type !== 'dish' || !Number.isInteger(rating) || rating < 1 || rating > 5)) throw Object.assign(new Error('菜品帖子评分需要在 1-5 分之间'), { status: 400 });
        await withTransaction(db, async (tx) => {
          let linkedReviewId = post.linked_review_id || null;
          if (linkedReviewId && rating === null) {
            await tx.prepare('DELETE FROM reviews WHERE tenant_id = ? AND id = ?').run(tenantId, linkedReviewId);
            linkedReviewId = null;
          } else if (linkedReviewId) {
            await tx.prepare("UPDATE reviews SET rating = ?, content = ?, status = 'pending' WHERE tenant_id = ? AND id = ?").run(rating, content, tenantId, linkedReviewId);
          }
          await tx.prepare("UPDATE campus_posts SET content = ?, rating = ?, status = 'pending', linked_review_id = ?, updated_at = ? WHERE tenant_id = ? AND id = ?")
            .run(content, rating, linkedReviewId, now(), tenantId, postId);
          await audit(tx, activeUser, 'UPDATE', 'campus_post', postId, { resetToPending: true });
        });
        await invalidateRankings();
        const catalog = await reviewCatalog(db, tenantId);
        const row = rowToPost(await db.prepare('SELECT campus_posts.*, users.nickname, users.username FROM campus_posts JOIN users ON users.id = campus_posts.user_id WHERE campus_posts.tenant_id = ? AND campus_posts.id = ?').get(tenantId, postId));
        return send(res, 200, { post: enrichPost(row, catalog, activeUser.id) });
      }

      if (method === 'DELETE' && pathParts[0] === 'api' && pathParts[1] === 'posts' && pathParts[2] && pathParts.length === 3) {
        const activeUser = await requireUser(db, req);
        const tenantId = tenantIdFor(activeUser);
        const postId = decodeURIComponent(pathParts[2]);
        const post = await requireCommunityTarget(db, tenantId, 'post', postId);
        if (post.user_id !== activeUser.id) throw Object.assign(new Error('只能删除自己发布的帖子'), { status: 403 });
        await withTransaction(db, async (tx) => {
          await tx.prepare("DELETE FROM content_reactions WHERE tenant_id = ? AND ((target_type = 'post' AND target_id = ?) OR (target_type = 'review' AND target_id = ?))").run(tenantId, postId, post.linked_review_id || '');
          await tx.prepare("DELETE FROM content_reports WHERE tenant_id = ? AND ((target_type = 'post' AND target_id = ?) OR (target_type = 'review' AND target_id = ?))").run(tenantId, postId, post.linked_review_id || '');
          if (post.linked_review_id) await tx.prepare('DELETE FROM reviews WHERE tenant_id = ? AND id = ?').run(tenantId, post.linked_review_id);
          await tx.prepare('DELETE FROM campus_posts WHERE tenant_id = ? AND id = ?').run(tenantId, postId);
          await audit(tx, activeUser, 'DELETE', 'campus_post', postId);
        });
        await invalidateRankings();
        return send(res, 200, { deleted: true, id: postId });
      }

      if (method === 'PATCH' && pathParts[0] === 'api' && pathParts[1] === 'reviews' && pathParts[2] && pathParts.length === 3) {
        const activeUser = await requireUser(db, req);
        const tenantId = tenantIdFor(activeUser);
        const reviewId = decodeURIComponent(pathParts[2]);
        const review = await requireCommunityTarget(db, tenantId, 'review', reviewId);
        if (review.user_id !== activeUser.id) throw Object.assign(new Error('只能修改自己的评价'), { status: 403 });
        const linkedPost = await db.prepare('SELECT id FROM campus_posts WHERE tenant_id = ? AND linked_review_id = ?').get(tenantId, reviewId);
        if (linkedPost) throw Object.assign(new Error('该评价由帖子生成，请在“我的帖子”中修改'), { status: 409, code: 'EDIT_LINKED_POST' });
        const body = await readBody(req);
        const content = body.content === undefined ? review.content : String(body.content || '').trim();
        const rating = body.rating === undefined ? Number(review.rating) : Number(body.rating);
        if (content.length < 2 || content.length > 240) throw Object.assign(new Error('评价内容长度需要在 2-240 个字符之间'), { status: 400 });
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw Object.assign(new Error('评分需要在 1-5 分之间'), { status: 400 });
        await db.prepare("UPDATE reviews SET content = ?, rating = ?, status = 'pending' WHERE tenant_id = ? AND id = ?").run(content, rating, tenantId, reviewId);
        await audit(db, activeUser, 'UPDATE', 'review', reviewId, { resetToPending: true });
        await invalidateRankings();
        const catalog = await reviewCatalog(db, tenantId);
        const row = rowToReview(await db.prepare('SELECT reviews.*, users.nickname, users.username FROM reviews JOIN users ON users.id = reviews.user_id WHERE reviews.tenant_id = ? AND reviews.id = ?').get(tenantId, reviewId));
        return send(res, 200, { review: enrichReview(row, catalog, activeUser.id) });
      }

      if (method === 'DELETE' && pathParts[0] === 'api' && pathParts[1] === 'reviews' && pathParts[2] && pathParts.length === 3) {
        const activeUser = await requireUser(db, req);
        const tenantId = tenantIdFor(activeUser);
        const reviewId = decodeURIComponent(pathParts[2]);
        const review = await requireCommunityTarget(db, tenantId, 'review', reviewId);
        if (review.user_id !== activeUser.id) throw Object.assign(new Error('只能删除自己的评价'), { status: 403 });
        await withTransaction(db, async (tx) => {
          await tx.prepare('UPDATE campus_posts SET rating = NULL, linked_review_id = NULL, updated_at = ? WHERE tenant_id = ? AND linked_review_id = ?').run(now(), tenantId, reviewId);
          await tx.prepare("DELETE FROM content_reactions WHERE tenant_id = ? AND target_type = 'review' AND target_id = ?").run(tenantId, reviewId);
          await tx.prepare("DELETE FROM content_reports WHERE tenant_id = ? AND target_type = 'review' AND target_id = ?").run(tenantId, reviewId);
          await tx.prepare('DELETE FROM reviews WHERE tenant_id = ? AND id = ?').run(tenantId, reviewId);
          await audit(tx, activeUser, 'DELETE', 'review', reviewId);
        });
        await invalidateRankings();
        return send(res, 200, { deleted: true, id: reviewId });
      }

      if (method === 'PATCH' && url.pathname === '/api/health/profile/onboarding') {
        const activeUser = await requireUser(db, req);
        const body = await readBody(req);
        if (body.status !== 'deferred') throw Object.assign(new Error('首次档案引导仅支持稍后填写'), { status: 400, code: 'INVALID_ONBOARDING_STATUS' });
        const current = await getProfile(db, activeUser.id, tenantIdFor(activeUser));
        if (current.onboardingStatus === 'pending') {
          await db.prepare("UPDATE health_profiles SET onboarding_status = 'deferred', updated_at = ? WHERE tenant_id = ? AND user_id = ?")
            .run(now(), tenantIdFor(activeUser), activeUser.id);
          await audit(db, activeUser, 'DEFER', 'health_profile_onboarding', activeUser.id);
        }
        return send(res, 200, { profile: await getProfile(db, activeUser.id, tenantIdFor(activeUser)), state: await snapshot(db, activeUser) });
      }

      if ((method === 'POST' || method === 'PUT') && url.pathname === '/api/health/profile') {
        const activeUser = await requireUser(db, req);
        const body = await readBody(req);
        const current = await getProfile(db, activeUser.id, tenantIdFor(activeUser));
        const submittedAllergies = normalizeProfile({ allergies: body.allergies }).allergies;
        const allergyStatus = String(
          body.allergyStatus
          || (Object.prototype.hasOwnProperty.call(body, 'allergies') ? (submittedAllergies.length ? 'declared' : 'none') : '')
          || (current.onboardingStatus === 'completed' ? current.allergyStatus : '')
        ).trim();
        if (!['none', 'declared'].includes(allergyStatus)) {
          throw Object.assign(new Error('请明确选择“暂无已知过敏”或填写过敏原'), { status: 400, code: 'ALLERGY_STATUS_REQUIRED' });
        }
        const budgetMax = Number(body.budgetMax);
        if (!Number.isFinite(budgetMax) || budgetMax < 8 || budgetMax > 200) {
          throw Object.assign(new Error('预算上限需要在 8-200 元之间'), { status: 400, code: 'INVALID_BUDGET' });
        }
        const profile = normalizeProfile({ ...body, budgetMax, allergyStatus, onboardingStatus: 'completed' });
        if (!['unrestricted', 'pescatarian', 'vegetarian', 'vegan'].includes(profile.dietaryPattern)) {
          throw Object.assign(new Error('饮食模式不合法'), { status: 400, code: 'INVALID_DIETARY_PATTERN' });
        }
        if (!Number.isInteger(profile.spiceLevel) || profile.spiceLevel < 0 || profile.spiceLevel > 5) {
          throw Object.assign(new Error('辣度偏好需要在 0-5 之间'), { status: 400, code: 'INVALID_SPICE_LEVEL' });
        }
        if (allergyStatus === 'declared' && !profile.allergies.length) {
          throw Object.assign(new Error('选择“有过敏原”后请至少填写一项'), { status: 400, code: 'ALLERGEN_REQUIRED' });
        }
        if (allergyStatus === 'none') profile.allergies = [];
        await db.prepare(`INSERT INTO health_profiles (user_id, tenant_id, goal, budget_max, meal_type, taste, halal_only, avoid_json, allergies_json, dietary_pattern, spice_level, nutrition_focus_json, prefer_low_crowd, favorite_tags_json, onboarding_status, allergy_status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET tenant_id=excluded.tenant_id, goal=excluded.goal, budget_max=excluded.budget_max, meal_type=excluded.meal_type, taste=excluded.taste, halal_only=excluded.halal_only, avoid_json=excluded.avoid_json, allergies_json=excluded.allergies_json, dietary_pattern=excluded.dietary_pattern, spice_level=excluded.spice_level, nutrition_focus_json=excluded.nutrition_focus_json, prefer_low_crowd=excluded.prefer_low_crowd, favorite_tags_json=excluded.favorite_tags_json, onboarding_status=excluded.onboarding_status, allergy_status=excluded.allergy_status, updated_at=excluded.updated_at`)
          .run(activeUser.id, tenantIdFor(activeUser), profile.goal, profile.budgetMax, profile.mealType, profile.taste, profile.halalOnly ? 1 : 0, serializeJson(profile.avoid), serializeJson(profile.allergies), profile.dietaryPattern, profile.spiceLevel, serializeJson(profile.nutritionFocus), profile.preferLowCrowd ? 1 : 0, serializeJson(profile.favoriteTags), 'completed', allergyStatus, now());
        await audit(db, activeUser, 'UPSERT', 'health_profile', activeUser.id);
        const recommendation = compatibleRecommendationResponse(await executeMealRecommendation(db, activeUser, { query: '', options: { mode: 'alternatives', limit: 3 } }));
        return send(res, 200, { profile: await getProfile(db, activeUser.id, tenantIdFor(activeUser)), recommendation, state: await snapshot(db, activeUser) });
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
        if (!existing) throw Object.assign(new Error('餐饮场所不存在'), { status: 404 });
        if (method === 'DELETE') {
          const areaCount = Number((await db.prepare('SELECT COUNT(*) AS count FROM canteens WHERE tenant_id = ? AND parent_id = ?').get(tenantIdFor(activeUser), id))?.count || 0);
          if (areaCount > 0) {
            throw Object.assign(new Error('该餐饮场所仍包含下属场所，请先迁移或删除这些场所'), {
              status: 409,
              code: 'CANTEEN_HAS_AREAS'
            });
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

      if ((method === 'GET' || method === 'POST')
        && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'dishes'
        && pathParts[3] && pathParts[4] === 'reference-images') {
        const activeUser = await requireCapability(db, req, 'dish:write');
        const dishId = decodeURIComponent(pathParts[3]);
        const tenantId = tenantIdFor(activeUser);
        const dish = await db.prepare('SELECT id FROM dishes WHERE tenant_id = ? AND id = ?').get(tenantId, dishId);
        if (!dish) throw Object.assign(new Error('菜品不存在'), { status: 404 });
        if (method === 'GET') return send(res, 200, { images: await listDishReferenceImages(db, tenantId, dishId) });
        const image = await addDishReferenceImage({ db, user: activeUser, dishId, body: await readBody(req) });
        await audit(db, activeUser, 'CREATE', 'dish_reference_image', image.id, { dishId, purpose: image.purpose });
        return send(res, 201, { image, images: await listDishReferenceImages(db, tenantId, dishId) });
      }

      if ((method === 'GET' || method === 'POST')
        && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'dishes'
        && pathParts[3] && pathParts[4] === 'recipes') {
        const activeUser = await requireCapability(db, req, 'dish:write');
        const dishId = decodeURIComponent(pathParts[3]);
        const tenantId = tenantIdFor(activeUser);
        if (method === 'GET') return send(res, 200, { recipes: await listDishRecipeVersions(db, tenantId, dishId) });
        const recipe = await createDishRecipeVersion({ db, user: activeUser, dishId, body: await readBody(req) });
        await audit(db, activeUser, recipe.status === 'approved' ? 'APPROVE' : 'CREATE', 'dish_recipe_version', recipe.recipeId, { dishId, version: recipe.version });
        return send(res, 201, recipe);
      }

      if ((method === 'PUT' || method === 'DELETE')
        && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'vision'
        && pathParts[3] === 'reference-images' && pathParts[4]) {
        const activeUser = await requireCapability(db, req, 'dish:write');
        const referenceImageId = decodeURIComponent(pathParts[4]);
        const tenantId = tenantIdFor(activeUser);
        if (method === 'DELETE') {
          const existing = await db.prepare('SELECT dish_id FROM dish_reference_images WHERE tenant_id = ? AND id = ?').get(tenantId, referenceImageId);
          if (!existing) throw Object.assign(new Error('参考图不存在'), { status: 404 });
          await db.prepare('DELETE FROM dish_reference_images WHERE tenant_id = ? AND id = ?').run(tenantId, referenceImageId);
          await audit(db, activeUser, 'DELETE', 'dish_reference_image', referenceImageId, { dishId: existing.dish_id });
          return send(res, 200, { deleted: true, images: await listDishReferenceImages(db, tenantId, existing.dish_id) });
        }
        const image = await updateDishReferenceImage({ db, user: activeUser, referenceImageId, body: await readBody(req) });
        await audit(db, activeUser, 'UPDATE', 'dish_reference_image', referenceImageId, { qualityStatus: image.qualityStatus, purpose: image.purpose });
        return send(res, 200, { image });
      }

      if (method === 'POST' && url.pathname === '/api/admin/vision/reindex') {
        const activeUser = await requireCapability(db, req, 'dish:write');
        const body = await readBody(req);
        const result = await reindexDishReferenceImages({
          db,
          user: activeUser,
          dishId: String(body.dishId || '').trim() || null,
          limit: body.limit,
        });
        await audit(db, activeUser, 'REINDEX', 'dish_reference_image', body.dishId || null, { indexed: result.indexed, failed: result.failed });
        return send(res, 200, result);
      }

      if (method === 'GET' && url.pathname === '/api/admin/vision/metrics') {
        const activeUser = await requireCapability(db, req, 'ai:configure');
        const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));
        return send(res, 200, await getMealVisionMetrics(db, tenantIdFor(activeUser), { days }));
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
          await enqueueOutboxEvent(db, {
            tenantId: tenantIdFor(activeUser),
            aggregateType: 'dish',
            aggregateId: id,
            eventType: 'retrieval.source.delete',
            payload: { sourceType: 'dish', sourceId: id }
          });
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
      if (method === 'GET' && url.pathname === '/api/admin/catalog-introductions/batches') {
        const activeUser = await requireCapability(db, req, 'catalog:introduction:review');
        const batches = await listCatalogIntroductionBatches(db, tenantIdFor(activeUser));
        await audit(db, activeUser, 'LIST', 'catalog_introduction_batch', null);
        return send(res, 200, { batches });
      }
      if (method === 'GET' && url.pathname === '/api/admin/catalog-introductions') {
        const activeUser = await requireCapability(db, req, 'catalog:introduction:review');
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
        const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
        const result = await listCatalogIntroductionCandidates(db, {
          tenantId: tenantIdFor(activeUser),
          batchId: String(url.searchParams.get('batchId') || '').trim(),
          status: String(url.searchParams.get('status') || '').trim(),
          entityType: String(url.searchParams.get('entityType') || '').trim(),
          query: String(url.searchParams.get('q') || '').trim().slice(0, 100),
          limit,
          offset,
        });
        return send(res, 200, { ...result, limit, offset });
      }
      if (method === 'PATCH' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'catalog-introductions' && pathParts[3] && pathParts[3] !== 'batches') {
        const activeUser = await requireCapability(db, req, 'catalog:introduction:review');
        const body = await readBody(req);
        const introduction = await updateCatalogIntroductionCandidate(db, {
          tenantId: tenantIdFor(activeUser),
          id: decodeURIComponent(pathParts[3]),
          factualSummary: body.factualSummary,
          recommendationCopy: body.recommendationCopy,
          status: body.status,
          expectedUpdatedAt: body.expectedUpdatedAt,
          reviewedBy: activeUser.id,
        });
        await audit(db, activeUser, 'REVIEW', 'catalog_introduction', introduction.id, { status: introduction.status, entityType: introduction.entityType, entityId: introduction.entityId });
        if (introduction.status === 'approved') {
          await enqueueOutboxEvent(db, {
            tenantId: tenantIdFor(activeUser), aggregateType: 'catalog_introduction', aggregateId: introduction.id,
            eventType: 'retrieval.catalog-introductions.sync', payload: { entityType: introduction.entityType, entityId: introduction.entityId },
            idempotencyKey: `retrieval.catalog-introduction:${introduction.id}:${introduction.contentHash}`,
          });
        }
        return send(res, 200, { introduction });
      }
      if (method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'catalog-introductions' && pathParts[3] === 'batches' && pathParts[4] && pathParts[5] === 'approval-preview') {
        const activeUser = await requireCapability(db, req, 'catalog:introduction:approve_all');
        const preview = await previewCatalogIntroductionBatchApproval(db, { tenantId: tenantIdFor(activeUser), batchId: decodeURIComponent(pathParts[4]) });
        return send(res, 200, preview);
      }
      if (method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'catalog-introductions' && pathParts[3] === 'batches' && pathParts[4] && pathParts[5] === 'approve') {
        const activeUser = await requireCapability(db, req, 'catalog:introduction:approve_all');
        const body = await readBody(req);
        const tenantId = tenantIdFor(activeUser);
        const result = await approveCatalogIntroductionBatch(db, {
          tenantId, batchId: decodeURIComponent(pathParts[4]), confirmation: body.confirmation,
          expectedDigest: body.expectedDigest, reviewedBy: activeUser.id,
        });
        await audit(db, activeUser, 'APPROVE_BATCH', 'catalog_introduction_batch', result.batchId, { approvedCount: result.approvedCount, approvalDigest: result.approvalDigest });
        await enqueueOutboxEvent(db, {
          tenantId, aggregateType: 'catalog_introduction_batch', aggregateId: result.batchId,
          eventType: 'retrieval.catalog-introductions.sync', payload: { batchId: result.batchId },
          idempotencyKey: `retrieval.catalog-introduction-batch:${result.batchId}:${result.approvalDigest}`,
        });
        return send(res, 200, result);
      }
      if (method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'catalog-introductions' && pathParts[3] === 'batches' && pathParts[4] && pathParts[5] === 'rollback') {
        const activeUser = await requireCapability(db, req, 'catalog:introduction:approve_all');
        const body = await readBody(req);
        const tenantId = tenantIdFor(activeUser);
        const result = await rollbackCatalogIntroductionBatch(db, { tenantId, batchId: decodeURIComponent(pathParts[4]), confirmation: body.confirmation, reviewedBy: activeUser.id });
        await audit(db, activeUser, 'ROLLBACK_BATCH', 'catalog_introduction_batch', result.batchId, { rolledBackCount: result.rolledBackCount });
        await enqueueOutboxEvent(db, {
          tenantId, aggregateType: 'catalog_introduction_batch', aggregateId: result.batchId,
          eventType: 'retrieval.catalog-introductions.sync', payload: { batchId: result.batchId },
          idempotencyKey: `retrieval.catalog-introduction-rollback:${result.batchId}:${result.rolledBackAt}`,
        });
        return send(res, 200, result);
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
      if (method === 'GET' && pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'catalog' && pathParts[3] === 'stalls' && pathParts[4] && pathParts[5] === 'dishes') {
        const activeUser = await requireAnyCapability(db, req, ['audit:read', 'canteen:write', 'stall:write', 'dish:write']);
        const stallId = decodeURIComponent(pathParts[4]);
        const result = await listAdminStallDishes(db, tenantIdFor(activeUser), stallId, url.searchParams);
        await audit(db, activeUser, 'LIST', 'stall_dishes', stallId, { page: result.page, pageSize: result.pageSize, query: url.searchParams.get('q') || '' });
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
        const sourceTypes = Array.isArray(body.sourceTypes) && body.sourceTypes.length
          ? body.sourceTypes
          : ['dish', 'stall', 'canteen', CAMPUS_POLICY_SOURCE_TYPE];
        const globalOnly = sourceTypes.filter((type) => ['health_knowledge', CAMPUS_KNOWLEDGE_SOURCE_TYPE].includes(type));
        if (globalOnly.length) {
          throw Object.assign(new Error(`全局知识请通过受控任务重建：${globalOnly.join('、')}`), {
            status: 400,
            code: 'GLOBAL_KNOWLEDGE_REINDEX_REQUIRED',
          });
        }
        await getAiSettings(db, activeUser).catch(() => {});
        const quota = await aiQuotaStatus(db, tenantId);
        const quotaExhausted = quota.quota > 0 && quota.remaining <= 0;
        const result = await reindexRetrieval(db, {
          tenantId,
          sourceTypes,
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
            if (entityName === 'dishes') await queueDishRetrieval(db, { tenantId, dishId: id, action: 'delete' });
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
            if (entityName === 'dishes') await queueDishRetrieval(db, { tenantId, dishId: id });
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
          if (entityName === 'dishes') await queueDishRetrieval(db, { tenantId, dishId: id });
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
          db.prepare("SELECT COUNT(*) AS c FROM menus WHERE tenant_id = ? AND date = ? AND status = 'published'").get(tenantId, businessDate())
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
        const rating = body.rating == null || body.rating === '' ? 0 : Number(body.rating);
        if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
          throw Object.assign(new Error('档口评分需要在 0-5 之间'), { status: 400, code: 'INVALID_STALL_RATING' });
        }
        await db.prepare('INSERT INTO stalls (id, tenant_id, canteen_id, parent_id, floor, name, category, rating, avg_price, open, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(stallId, tenantId, canteenId, parentId, body.floor, String(body.name).trim(), String(body.category).trim(), rating, Number(body.avgPrice || 0), body.open !== false ? 1 : 0, body.description || '', now(), now());
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
        const dish = await findPublishedDish(db, tenantId, body.dishId);
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
        const dish = await findPublishedDish(db, tenantId, dishId);
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
        const dish = await findPublishedDish(db, tenantId, dishId);
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
    };
    const context = initialDatabaseContext({ claims, authRoute, requestId });
    return typeof db.runWithContext === 'function'
      ? db.runWithContext(context, operation)
      : operation();
  }

  return {
    handler,
    db,
    cache,
    metrics,
    close() {
      if (invitationScheduler) clearInterval(invitationScheduler);
    }
  };
}

export function createHttpServer(options) {
  const app = createApp(options);
  const server = createServer(app.handler);
  server.once('close', () => app.close?.());
  server.smartCanteen = app;
  return server;
}
