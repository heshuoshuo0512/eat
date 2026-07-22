const TOKEN_KEY = 'smart-canteen-token';

function tokenStore() {
  return window.localStorage;
}

/**
 * Keep the server's backwards-compatible flat error response while exposing a
 * stable client-side contract to forms and drawers.  Older API responses use
 * `{ error: string, code }`; newer endpoints may return `{ error: { message,
 * code } }`.  Consumers should only need `message`, `code`, `status`, and
 * `kind`.
 */
export function normalizeApiError(data = {}, status = 0) {
  const payload = data?.error && typeof data.error === 'object' ? data.error : null;
  const message = String(payload?.message || (typeof data?.error === 'string' ? data.error : data?.message) || `请求失败：${status || '网络错误'}`);
  const code = String(payload?.code || data?.code || '');
  let kind = 'unknown';
  if (!status) kind = 'network';
  else if (status === 401 || status === 403 || /permission|forbidden|unauthor/i.test(code)) kind = 'permission';
  else if (status === 409 || /conflict|duplicate|has_|tenant_conflict|parent_/i.test(code)) kind = 'conflict';
  else if (status >= 400 && status < 500) kind = 'validation';
  else if (status >= 500) kind = 'server';
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.kind = kind;
  error.requestId = data?.requestId || '';
  return error;
}

async function request(path, options = {}) {
  const token = tokenStore().getItem(TOKEN_KEY);
  const { timeoutMs = 20_000, signal, ...fetchOptions } = options;
  const controller = !signal && timeoutMs ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  const headers = {
    Accept: 'application/json',
    ...(fetchOptions.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
  try {
    const response = await fetch(path, { ...fetchOptions, headers: { ...headers, ...fetchOptions.headers }, signal: signal || controller?.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw normalizeApiError(data, response.status);
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = normalizeApiError({}, 0);
      timeoutError.message = '请求超时或已取消，请稍后重试。';
      throw timeoutError;
    }
    if (!error.kind) {
      error.status = Number(error.status || 0);
      error.code = String(error.code || '');
      error.kind = 'network';
    }
    throw error;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

export const apiClient = {
  async bootstrap() {
    return request('/api/bootstrap');
  },
  async login(payload) {
    const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
    tokenStore().setItem(TOKEN_KEY, result.token);
    return result;
  },
  async register(payload) {
    const result = await request('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
    tokenStore().setItem(TOKEN_KEY, result.token);
    return result;
  },
  logout() {
    tokenStore().removeItem(TOKEN_KEY);
  },
  async addReview(payload) {
    return request('/api/reviews', { method: 'POST', body: JSON.stringify(payload) });
  },
  async listReviews(params = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== '' && value != null) query.set(key, value);
    }
    return request(`/api/reviews?${query}`);
  },
  async listPosts(params = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== '' && value != null) query.set(key, value);
    }
    return request(`/api/posts?${query}`);
  },
  async createPost(payload) {
    return request('/api/posts', { method: 'POST', body: JSON.stringify(payload) });
  },
  async saveProfile(payload) {
    return request('/api/health/profile', { method: 'PUT', body: JSON.stringify(payload) });
  },
  async upsertCanteen(payload) {
    const path = payload.id ? `/api/admin/canteens/${encodeURIComponent(payload.id)}` : '/api/admin/canteens';
    return request(path, { method: payload.id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
  },
  async deleteCanteen(id) {
    return request(`/api/admin/canteens/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async upsertDish(payload) {
    const path = payload.id ? `/api/admin/dishes/${encodeURIComponent(payload.id)}` : '/api/admin/dishes';
    return request(path, { method: payload.id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
  },
  async deleteDish(id) {
    return request(`/api/admin/dishes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async importDishes(dishes) {
    return request('/api/admin/dishes/import', { method: 'POST', body: JSON.stringify({ dishes }) });
  },
  async previewDishImport(csvText) {
    return request('/api/admin/dishes/import/preview', { method: 'POST', body: JSON.stringify({ csvText }), timeoutMs: 60_000 });
  },
  async confirmDishImport(csvText) {
    return request('/api/admin/dishes/import/confirm', { method: 'POST', body: JSON.stringify({ csvText }), timeoutMs: 60_000 });
  },
  async identifyDishImage(payload, options = {}) {
    return request('/api/admin/dishes/vision-import', { method: 'POST', body: JSON.stringify(payload), timeoutMs: 60_000, ...options });
  },
  async uploadImage(payload) {
    return request('/api/uploads', { method: 'POST', body: JSON.stringify(payload) });
  },
  async todayMenu(mealType) {
    const query = mealType ? `?mealType=${encodeURIComponent(mealType)}` : '';
    return request(`/api/menus/today${query}`);
  },
  async dishesSearch(payload) {
    return request('/api/dishes/search', { method: 'POST', body: JSON.stringify(payload), timeoutMs: 60_000 });
  },
  async recommend(payload = {}) {
    return request('/api/recommend', { method: 'POST', body: JSON.stringify(payload), timeoutMs: 60_000 });
  },
  async healthPlan(days) {
    return request('/api/recommend/plan', { method: 'POST', body: JSON.stringify({ days }) });
  },
  async createOrder(payload) {
    return request('/api/orders', { method: 'POST', body: JSON.stringify(payload) });
  },
  async payOrder(id, channel = 'mock') {
    return request(`/api/orders/${encodeURIComponent(id)}/pay`, { method: 'POST', body: JSON.stringify({ channel }) });
  },
  async cancelOrder(id) {
    return request(`/api/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  },
  async listOrders() {
    return request('/api/orders');
  },
  async listAdminOrders(status = '') {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return request(`/api/admin/orders${query}`);
  },
  async orderAnalytics() {
    return request('/api/admin/order-analytics');
  },
  async updateOrderStatus(id, status) {
    return request(`/api/admin/orders/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  },
  async ragSearch(query) {
    return request(`/api/rag/search?q=${encodeURIComponent(query)}`);
  },
  async askMealAdvisor(payload) {
    return request('/api/agent/meal-advisor', { method: 'POST', body: JSON.stringify(payload), timeoutMs: 60_000 });
  },
  async runAgent(payload) {
    return request('/api/agent/assistant', { method: 'POST', body: JSON.stringify(payload), timeoutMs: 60_000 });
  },
  async runAgentStream(payload) {
    const token = tokenStore().getItem(TOKEN_KEY);
    const response = await fetch('/api/agent/stream-run', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || '智能体实时执行流启动失败');
    }
    return await response.text();
  },
  async agentEvals() {
    return request('/api/agent/evals');
  },
  async confirmAgentAction(id) {
    return request(`/api/agent/actions/${encodeURIComponent(id)}/confirm`, { method: 'POST' });
  },
  async rejectAgentAction(id) {
    return request(`/api/agent/actions/${encodeURIComponent(id)}/reject`, { method: 'POST' });
  },
  async agentEvents(sessionId) {
    return request(`/api/agent/events?sessionId=${encodeURIComponent(sessionId)}`);
  },
  async listAgentActions(status = 'pending') {
    return request(`/api/agent/actions?status=${encodeURIComponent(status)}`);
  },
  async agentStream(sessionId) {
    const token = tokenStore().getItem(TOKEN_KEY);
    const response = await fetch(`/api/agent/stream?sessionId=${encodeURIComponent(sessionId)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || '智能体事件流读取失败');
    }
    return await response.text();
  },
  async agentMemory() {
    return request('/api/agent/memory');
  },
  async saveAgentMemory(payload) {
    return request('/api/agent/memory', { method: 'PUT', body: JSON.stringify(payload) });
  },
  async clearAgentMemory() {
    return request('/api/agent/memory', { method: 'DELETE' });
  },
  async listAgentEvalCases() {
    return request('/api/agent/eval-cases');
  },
  async createAgentEvalCase(payload) {
    return request('/api/agent/eval-cases', { method: 'POST', body: JSON.stringify(payload), timeoutMs: 60_000 });
  },
  async updateAgentEvalCase(id, payload) {
    return request(`/api/agent/eval-cases/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload), timeoutMs: 60_000 });
  },
  async deleteAgentEvalCase(id) {
    return request(`/api/agent/eval-cases/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async runAgentEvalCase(id) {
    return request(`/api/agent/eval-cases/${encodeURIComponent(id)}/run`, { method: 'POST', timeoutMs: 60_000 });
  },
  async deploymentReadiness() {
    return request('/api/deployment/readiness');
  },
  async getRetrievalIndexStatus() {
    return request('/api/admin/retrieval/status');
  },
  async rebuildRetrievalIndex(payload = {}) {
    return request('/api/admin/retrieval/reindex', { method: 'POST', body: JSON.stringify(payload), timeoutMs: 120_000 });
  },
  async analyzeMealImage(payload, options = {}) {
    return request('/api/vision/meal-analyze', { method: 'POST', body: JSON.stringify(payload), timeoutMs: 60_000, ...options });
  },
  async listUsers() {
    return request('/api/admin/users');
  },
  async updateUserRole(id, role) {
    return request(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ role }) });
  },
  async listAuditLogs(limit = 50, offset = 0) {
    return request(`/api/admin/audit-logs?limit=${limit}&offset=${offset}`);
  },
  async getAiSettings() {
    return request('/api/admin/ai-settings');
  },
  async saveAiSettings(payload) {
    return request('/api/admin/ai-settings', { method: 'PUT', body: JSON.stringify(payload) });
  },
  async clearAiSettings() {
    return request('/api/admin/ai-settings', { method: 'DELETE' });
  },
  async testAiSettings(payload) {
    return request('/api/admin/ai-settings/test', { method: 'POST', body: JSON.stringify(payload) });
  }
  ,
  async listAiUsage(limit = 50, offset = 0) {
    return request(`/api/admin/ai-usage?limit=${limit}&offset=${offset}`);
  }
  ,
  async listTenants() {
    return request('/api/admin/tenants');
  },
  async saveTenant(payload) {
    const path = payload.id ? `/api/admin/tenants/${encodeURIComponent(payload.id)}` : '/api/admin/tenants';
    return request(path, { method: payload.id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
  },
  async listMenus() {
    return request('/api/admin/menus');
  },
  async saveMenu(payload) {
    const path = payload.id ? `/api/admin/menus/${encodeURIComponent(payload.id)}` : '/api/admin/menus';
    return request(path, { method: payload.id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
  },
  async archiveMenu(id) {
    return request(`/api/admin/menus/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async batchMenuAction(ids, action) {
    return request('/api/admin/menus/batch', { method: 'POST', body: JSON.stringify({ ids, action }) });
  },
  async getAnalytics() {
    return request('/api/admin/analytics');
  },
  async getDatabaseOverview() {
    return request('/api/admin/database/overview');
  },
  async getAdminCatalogTree(params = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== '' && value != null) query.set(key, value);
    }
    return request(`/api/admin/catalog/tree?${query}`);
  },
  async listDatabaseEntities() {
    return request('/api/admin/database/entities');
  },
  async listDatabaseRows(entity, params = {}) {
    const query = new URLSearchParams(params);
    return request(`/api/admin/database/entities/${encodeURIComponent(entity)}?${query}`);
  },
  async createDatabaseRow(entity, payload) {
    return request(`/api/admin/database/entities/${encodeURIComponent(entity)}`, { method: 'POST', body: JSON.stringify(payload) });
  },
  async updateDatabaseRow(entity, id, payload) {
    return request(`/api/admin/database/entities/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  async deleteDatabaseRow(entity, id) {
    return request(`/api/admin/database/entities/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async listReviewsAdmin(limit = 50, offset = 0, status = '', filters = {}) {
    const qs = new URLSearchParams({ limit, offset });
    if (status) qs.set('status', status);
    for (const [key, value] of Object.entries(filters)) {
      if (value !== '' && value != null) qs.set(key, value);
    }
    return request(`/api/admin/reviews?${qs}`);
  },
  async listReviewAnalytics() {
    return request('/api/admin/reviews/analytics');
  },
  async deleteReview(id) {
    return request(`/api/admin/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async updateReviewStatus(id, status) {
    return request(`/api/admin/reviews/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  },
  async listAdminPosts(limit = 50, offset = 0, status = '', filters = {}) {
    const query = new URLSearchParams({ limit, offset });
    if (status) query.set('status', status);
    for (const [key, value] of Object.entries(filters)) {
      if (value !== '' && value != null) query.set(key, value);
    }
    return request(`/api/admin/posts?${query}`);
  },
  async updatePostStatus(id, status) {
    return request(`/api/admin/posts/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  },
  async upsertStall(payload) {
    const path = payload.id ? `/api/admin/stalls/${encodeURIComponent(payload.id)}` : '/api/admin/stalls';
    return request(path, { method: payload.id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
  },
  async deleteStall(id) {
    return request(`/api/admin/stalls/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async getEnvironment() {
    return request('/api/admin/environment');
  },
  async saveEnvironment(payload) {
    return request('/api/admin/environment', { method: 'PUT', body: JSON.stringify(payload) });
  },
  async getDishPreferences() {
    return request('/api/preferences/dishes');
  },
  async updateDishPreference(payload) {
    return request('/api/preferences/dishes', { method: 'PUT', body: JSON.stringify(payload) });
  },
  async recordDishDrawn(dishId) {
    return request(`/api/preferences/dishes/${encodeURIComponent(dishId)}/drawn`, { method: 'POST' });
  },
  async recordDishEaten(dishId) {
    return request(`/api/preferences/dishes/${encodeURIComponent(dishId)}/eaten`, { method: 'POST' });
  },
  async loadRecommendation() {
    return request('/api/recommend');
  }
};
