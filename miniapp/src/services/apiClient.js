import { API_BASE_URL } from '../config.js';

const TOKEN_KEY = 'smart-canteen-token';
let redirectingToLogin = false;

function tokenStore() {
  return {
    getItem: (key) => uni.getStorageSync(key),
    setItem: (key, value) => uni.setStorageSync(key, value),
    removeItem: (key) => uni.removeStorageSync(key)
  };
}

function normalizeUrl(path) {
  if (/^https?:\/\//.test(path)) return path;
  return `${String(API_BASE_URL || '').replace(/\/$/, '')}${path}`;
}

function queryString(params = {}) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return query ? `?${query}` : '';
}

function apiError(response) {
  const data = response.data || {};
  const error = new Error(data.error || `请求失败：${response.statusCode}`);
  error.statusCode = response.statusCode;
  error.code = data.code || '';
  return error;
}

function handleUnauthorized(path) {
  tokenStore().removeItem(TOKEN_KEY);
  if (path.startsWith('/api/auth/') || redirectingToLogin) return;
  redirectingToLogin = true;
  uni.reLaunch({
    url: '/pages/login/login',
    complete() {
      setTimeout(() => { redirectingToLogin = false; }, 300);
    }
  });
}

function request(path, options = {}) {
  const token = tokenStore().getItem(TOKEN_KEY);
  const { method = 'GET', body, timeoutMs = 20000, headers = {} } = options;
  return new Promise((resolve, reject) => {
    uni.request({
      url: normalizeUrl(path),
      method,
      data: body,
      timeout: timeoutMs,
      header: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      success(response) {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          if (response.statusCode === 401) handleUnauthorized(path);
          reject(apiError(response));
          return;
        }
        resolve(response.data || {});
      },
      fail(error) {
        const requestError = new Error(error?.errMsg || '网络请求失败，请稍后重试。');
        requestError.code = 'NETWORK_ERROR';
        reject(requestError);
      }
    });
  });
}

async function authenticate(path, payload) {
  const result = await request(path, { method: 'POST', body: payload, timeoutMs: 15000 });
  tokenStore().setItem(TOKEN_KEY, result.token);
  redirectingToLogin = false;
  return result;
}

export const apiClient = {
  hasToken() {
    return Boolean(tokenStore().getItem(TOKEN_KEY));
  },
  bootstrap() {
    return request('/api/bootstrap');
  },
  login(payload) {
    return authenticate('/api/auth/login', payload);
  },
  wechatLogin(payload) {
    return authenticate('/api/auth/wechat-login', payload);
  },
  logout() {
    tokenStore().removeItem(TOKEN_KEY);
  },
  dishDetail(id) {
    return request(`/api/dishes/${encodeURIComponent(id)}`);
  },
  searchDishes(payload) {
    return request('/api/dishes/search', { method: 'POST', body: payload, timeoutMs: 60000 });
  },
  todayMenu(mealType) {
    return request(`/api/menus/today${queryString({ mealType })}`);
  },
  loadRankings() {
    return request('/api/rankings');
  },
  loadRecommendation() {
    return request('/api/recommend', { timeoutMs: 60000 });
  },
  requestRecommendation(payload) {
    return request('/api/recommend', { method: 'POST', body: payload, timeoutMs: 60000 });
  },
  runAgent(payload) {
    return request('/api/agent/assistant', { method: 'POST', body: payload, timeoutMs: 60000 });
  },
  loadAgentMemory() {
    return request('/api/agent/memory');
  },
  saveAgentMemory(payload) {
    return request('/api/agent/memory', { method: 'PUT', body: payload });
  },
  clearAgentMemory() {
    return request('/api/agent/memory', { method: 'DELETE' });
  },
  confirmAgentAction(id) {
    return request(`/api/agent/actions/${encodeURIComponent(id)}/confirm`, { method: 'POST' });
  },
  rejectAgentAction(id) {
    return request(`/api/agent/actions/${encodeURIComponent(id)}/reject`, { method: 'POST' });
  },
  listReviews(params = {}) {
    return request(`/api/reviews${queryString(params)}`);
  },
  addReview(payload) {
    return request('/api/reviews', { method: 'POST', body: payload });
  },
  listPosts(params = {}) {
    return request(`/api/posts${queryString(params)}`);
  },
  createPost(payload) {
    return request('/api/posts', { method: 'POST', body: payload });
  },
  uploadImage(payload) {
    return request('/api/uploads', { method: 'POST', body: payload, timeoutMs: 60000 });
  },
  saveProfile(payload) {
    return request('/api/health/profile', { method: 'PUT', body: payload });
  },
  listPreferences() {
    return request('/api/preferences/dishes');
  },
  setDishPreference(payload) {
    return request('/api/preferences/dishes', { method: 'PUT', body: payload });
  },
  recordDishDrawn(id) {
    return request(`/api/preferences/dishes/${encodeURIComponent(id)}/drawn`, { method: 'POST' });
  },
  recordDishEaten(id) {
    return request(`/api/preferences/dishes/${encodeURIComponent(id)}/eaten`, { method: 'POST' });
  },
  listOrders() {
    return request('/api/orders');
  },
  analyzeMealImage(payload) {
    return request('/api/vision/meal-analyze', { method: 'POST', body: payload, timeoutMs: 60000 });
  }
};
