import { createServer } from 'node:http';
import { contributorFromRequest, loginStaff, logoutStaff, requireStaff, staffFromRequest } from './auth.js';
import { readJson, readMultipart, sendJson } from './http.js';
import {
  cleanupCollectorData,
  collectorAdminState,
  confirmCollectorDraft,
  contributorSummary,
  createCollectorDraft,
  listCollectorGroups,
  listReviewQueue,
  readAuthorizedObject,
  reviewSubmission,
  searchCollectorCatalog,
  syncCollectorCatalog,
  updateCollectorGroup,
  updateCollectorTargets,
  withdrawSubmission,
} from './service.js';

const ipBuckets = new Map();

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

function limitPublicUploads(req) {
  const key = clientIp(req);
  const now = Date.now();
  const current = ipBuckets.get(key);
  if (!current || current.expiresAt <= now) {
    ipBuckets.set(key, { count: 1, expiresAt: now + 24 * 60 * 60 * 1000 });
    return;
  }
  current.count += 1;
  if (current.count > 20) throw Object.assign(new Error('当前网络今天上传次数过多'), { status: 429, code: 'COLLECTOR_IP_DAILY_LIMIT' });
}

function pathParts(url) {
  return url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
}

export function createCollectorServer({ db }) {
  return createServer(async (req, res) => {
    const requestId = crypto.randomUUID();
    try {
      const url = new URL(req.url, 'http://collector.local');
      const parts = pathParts(url);
      const method = req.method || 'GET';
      if (method === 'GET' && url.pathname === '/api/collector/health') return sendJson(res, 200, { ok: true, service: 'collector-api' }, { 'X-Request-Id': requestId });

      if (method === 'POST' && url.pathname === '/api/collector/staff/login') {
        const body = await readJson(req);
        const result = await loginStaff(db, body.username, body.password);
        return sendJson(res, 200, { staff: result.staff }, { 'Set-Cookie': result.setCookie, 'X-Request-Id': requestId });
      }
      if (method === 'POST' && url.pathname === '/api/collector/staff/logout') {
        return sendJson(res, 200, { loggedOut: true }, { 'Set-Cookie': await logoutStaff(db, req), 'X-Request-Id': requestId });
      }
      if (method === 'GET' && url.pathname === '/api/collector/staff/me') {
        return sendJson(res, 200, { staff: await staffFromRequest(db, req) }, { 'X-Request-Id': requestId });
      }

      const publicSession = await contributorFromRequest(db, req, { create: !url.pathname.startsWith('/api/collector/review') && !url.pathname.startsWith('/api/collector/admin') });
      const cookieHeader = publicSession.setCookie ? { 'Set-Cookie': publicSession.setCookie } : {};

      if (method === 'GET' && url.pathname === '/api/collector/groups') {
        return sendJson(res, 200, { groups: await listCollectorGroups(db) }, { ...cookieHeader, 'X-Request-Id': requestId });
      }
      if (method === 'GET' && parts[0] === 'api' && parts[1] === 'collector' && parts[2] === 'groups' && parts[3] && parts[4] === 'search') {
        const matches = await searchCollectorCatalog(db, parts[3], [url.searchParams.get('q') || ''], 30);
        return sendJson(res, 200, { matches }, { ...cookieHeader, 'X-Request-Id': requestId });
      }
      if (method === 'POST' && url.pathname === '/api/collector/drafts') {
        limitPublicUploads(req);
        const { fields, file } = await readMultipart(req);
        const draft = await createCollectorDraft({
          db,
          contributor: publicSession.contributor,
          groupId: fields.groupId,
          claimedName: fields.claimedName,
          requestAiSuggestion: fields.requestAiSuggestion !== 'false',
          file,
        });
        return sendJson(res, 201, { draft }, { ...cookieHeader, 'X-Request-Id': requestId });
      }
      if (method === 'POST' && parts[0] === 'api' && parts[1] === 'collector' && parts[2] === 'drafts' && parts[3] && parts[4] === 'confirm') {
        const body = await readJson(req);
        const submission = await confirmCollectorDraft({ db, contributor: publicSession.contributor, submissionId: parts[3], dishId: body.dishId, consent: body.consent, consentVersion: body.consentVersion });
        return sendJson(res, 200, { submission }, { ...cookieHeader, 'X-Request-Id': requestId });
      }
      if (method === 'GET' && url.pathname === '/api/collector/me') {
        return sendJson(res, 200, await contributorSummary(db, publicSession.contributor), { ...cookieHeader, 'X-Request-Id': requestId });
      }
      if (method === 'DELETE' && parts[0] === 'api' && parts[1] === 'collector' && parts[2] === 'submissions' && parts[3]) {
        return sendJson(res, 200, { submission: await withdrawSubmission(db, publicSession.contributor, parts[3]) }, { ...cookieHeader, 'X-Request-Id': requestId });
      }
      if (method === 'GET' && parts[0] === 'api' && parts[1] === 'collector' && parts[2] === 'objects' && parts[3]) {
        const staff = await staffFromRequest(db, req);
        const payload = await readAuthorizedObject(db, { objectId: parts[3], contributor: publicSession.contributor, staff });
        res.writeHead(200, { 'Content-Type': payload.object.content_type, 'Content-Length': payload.body.length, 'Cache-Control': 'private, max-age=300', ...cookieHeader });
        res.end(payload.body);
        return;
      }

      if (method === 'GET' && url.pathname === '/api/collector/review/submissions') {
        await requireStaff(db, req);
        return sendJson(res, 200, { submissions: await listReviewQueue(db, { status: url.searchParams.get('status') || 'pending_review', limit: url.searchParams.get('limit') }) }, { 'X-Request-Id': requestId });
      }
      if (method === 'POST' && parts[0] === 'api' && parts[1] === 'collector' && parts[2] === 'review' && parts[3] === 'submissions' && parts[4] && parts[5] === 'decision') {
        const staff = await requireStaff(db, req);
        const body = await readJson(req);
        return sendJson(res, 200, { submission: await reviewSubmission({ db, staff, submissionId: parts[4], action: body.action, dishId: body.dishId, reason: body.reason }) }, { 'X-Request-Id': requestId });
      }

      if (method === 'GET' && url.pathname === '/api/collector/admin/state') {
        await requireStaff(db, req, { admin: true });
        return sendJson(res, 200, await collectorAdminState(db), { 'X-Request-Id': requestId });
      }
      if (method === 'PUT' && parts[0] === 'api' && parts[1] === 'collector' && parts[2] === 'admin' && parts[3] === 'groups' && parts[4] && parts[5] === 'targets') {
        await requireStaff(db, req, { admin: true });
        return sendJson(res, 200, { groups: await updateCollectorTargets(db, parts[4], (await readJson(req)).targets) }, { 'X-Request-Id': requestId });
      }
      if (method === 'PUT' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'collector' && parts[2] === 'admin' && parts[3] === 'groups' && parts[4]) {
        await requireStaff(db, req, { admin: true });
        return sendJson(res, 200, await updateCollectorGroup(db, parts[4], await readJson(req)), { 'X-Request-Id': requestId });
      }
      if (method === 'POST' && url.pathname === '/api/collector/admin/catalog/sync') {
        await requireStaff(db, req, { admin: true });
        return sendJson(res, 200, await syncCollectorCatalog(db), { 'X-Request-Id': requestId });
      }
      if (method === 'POST' && url.pathname === '/api/collector/admin/cleanup') {
        await requireStaff(db, req, { admin: true });
        return sendJson(res, 200, await cleanupCollectorData(db), { 'X-Request-Id': requestId });
      }

      sendJson(res, 404, { error: '接口不存在', code: 'COLLECTOR_ROUTE_NOT_FOUND', requestId });
    } catch (error) {
      sendJson(res, Number(error.status || 500), {
        error: error.status ? error.message : '采集服务暂不可用',
        code: error.code || 'COLLECTOR_INTERNAL_ERROR',
        requestId,
      }, { 'X-Request-Id': requestId });
    }
  });
}
