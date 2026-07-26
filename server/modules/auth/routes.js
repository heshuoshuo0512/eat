import { publicUser, refreshTokenTenant, verifyToken } from '../../security.js';
import {
  revokeAllUserSessions,
  revokeSession,
  rotateAuthSession
} from './sessionService.js';

function bearerPayload(req) {
  const authorization = String(req.headers.authorization || '');
  return verifyToken(authorization.startsWith('Bearer ') ? authorization.slice(7) : '');
}

export async function handleAuthSessionRoute({ method, pathname, req, db, user, readBody, send }) {
  if (method === 'POST' && pathname === '/api/auth/refresh') {
    const body = await readBody(req);
    const refreshToken = String(body.refreshToken || '').trim();
    const tenantId = refreshTokenTenant(refreshToken);
    if (tenantId && typeof db.updateContext === 'function') {
      db.updateContext({ tenantId, userId: '', role: 'authenticator' });
    }
    const result = await rotateAuthSession(db, refreshToken);
    if (typeof db.updateContext === 'function') {
      db.updateContext({
        tenantId: result.user.tenant_id || 'default',
        userId: result.user.id,
        role: result.user.role
      });
    }
    send(200, {
      user: publicUser(result.user),
      token: result.token,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      refreshExpiresIn: result.refreshExpiresIn
    });
    return true;
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    const body = await readBody(req);
    const payload = bearerPayload(req);
    const refreshToken = String(body.refreshToken || '').trim();
    const tenantId = refreshTokenTenant(refreshToken);
    if (!user && tenantId && typeof db.updateContext === 'function') {
      db.updateContext({ tenantId, userId: '', role: 'authenticator' });
    }
    await revokeSession(db, { sessionId: payload?.sid || '', refreshToken });
    send(200, { loggedOut: true });
    return true;
  }

  if (method === 'POST' && pathname === '/api/auth/logout-all') {
    if (!user) throw Object.assign(new Error('请先登录'), { status: 401 });
    await revokeAllUserSessions(db, user.id);
    send(200, { loggedOut: true, allDevices: true });
    return true;
  }

  return false;
}
