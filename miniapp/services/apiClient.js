import { API_BASE_URL } from '../config.js';

const TOKEN_KEY = 'smart-canteen-token';

function tokenStore() {
  return {
    getItem: (key) => uni.getStorageSync(key),
    setItem: (key, value) => uni.setStorageSync(key, value),
    removeItem: (key) => uni.removeStorageSync(key)
  };
}

function normalizeUrl(path) {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE_URL}${path}`;
}

function request(path, options = {}) {
  const token = tokenStore().getItem(TOKEN_KEY);
  const { method = 'GET', body, timeoutMs = 20000, headers = {} } = options;
  return new Promise((resolve, reject) => {
    uni.request({
      url: normalizeUrl(path),
      method,
      data: body ? JSON.parse(body) : undefined,
      timeout: timeoutMs,
      header: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      success(response) {
        const data = response.data || {};
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(data.error || `请求失败：${response.statusCode}`));
          return;
        }
        resolve(data);
      },
      fail(error) {
        reject(new Error(error.errMsg || '网络请求失败，请稍后重试。'));
      }
    });
  });
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
  async todayMenu(mealType) {
    const query = mealType ? `?mealType=${encodeURIComponent(mealType)}` : '';
    return request(`/api/menus/today${query}`);
  },
  async ragSearch(query) {
    return request(`/api/rag/search?q=${encodeURIComponent(query)}`);
  },
  async askMealAdvisor(payload) {
    return request('/api/agent/meal-advisor', { method: 'POST', body: JSON.stringify(payload), timeoutMs: 60000 });
  },
  async analyzeMealImage(payload) {
    return request('/api/vision/meal-analyze', { method: 'POST', body: JSON.stringify(payload), timeoutMs: 60000 });
  }
};
