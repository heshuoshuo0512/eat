const TOKEN_KEY = 'smart-canteen-token';

function tokenStore() {
  return window.localStorage;
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
    if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求超时或已取消，请稍后重试。');
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
  logout() {
    tokenStore().removeItem(TOKEN_KEY);
  },
  async addReview(payload) {
    return request('/api/reviews', { method: 'POST', body: JSON.stringify(payload) });
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
  async listReviewsAdmin(limit = 50, offset = 0) {
    return request(`/api/admin/reviews?limit=${limit}&offset=${offset}`);
  },
  async deleteReview(id) {
    return request(`/api/admin/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
};
