const BASE = String(import.meta.env.VITE_COLLECTOR_API_BASE || '').replace(/\/$/, '');

async function request(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, { credentials: 'include', ...options });
  const body = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(body?.error || `请求失败（${response.status}）`);
    error.code = body?.code || 'REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }
  return body;
}

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const collectorApi = {
  groups: () => request('/api/collector/groups'),
  me: () => request('/api/collector/me'),
  search: (groupId, term) => request(`/api/collector/groups/${encodeURIComponent(groupId)}/search?q=${encodeURIComponent(term)}`),
  createDraft: (form) => request('/api/collector/drafts', { method: 'POST', body: form }),
  confirm: (id, body) => request(`/api/collector/drafts/${encodeURIComponent(id)}/confirm`, json('POST', body)),
  withdraw: (id) => request(`/api/collector/submissions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  staffMe: () => request('/api/collector/staff/me'),
  login: (username, password) => request('/api/collector/staff/login', json('POST', { username, password })),
  logout: () => request('/api/collector/staff/logout', { method: 'POST' }),
  reviewQueue: (status) => request(`/api/collector/review/submissions?status=${encodeURIComponent(status)}`),
  review: (id, body) => request(`/api/collector/review/submissions/${encodeURIComponent(id)}/decision`, json('POST', body)),
  adminState: () => request('/api/collector/admin/state'),
  updateGroup: (id, body) => request(`/api/collector/admin/groups/${encodeURIComponent(id)}`, json('PUT', body)),
  updateTargets: (id, targets) => request(`/api/collector/admin/groups/${encodeURIComponent(id)}/targets`, json('PUT', { targets })),
  syncCatalog: () => request('/api/collector/admin/catalog/sync', { method: 'POST' }),
};

export function assetUrl(path) {
  return `${BASE}${path}`;
}
