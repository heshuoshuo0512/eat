import { API_BASE_URL } from '../config.js';

const TOKEN_KEY = 'smart-canteen-token';
const REFRESH_TOKEN_KEY = 'smart-canteen-refresh-token';
let redirectingToLogin = false;
let refreshPromise = null;

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
  const payload = data.error && typeof data.error === 'object' ? data.error : null;
  const error = new Error(payload?.message || data.error || data.message || `请求失败：${response.statusCode}`);
  error.statusCode = response.statusCode;
  error.code = payload?.code || data.code || '';
  error.details = payload?.details || data.details || null;
  return error;
}

function handleUnauthorized(path) {
  tokenStore().removeItem(TOKEN_KEY);
  tokenStore().removeItem(REFRESH_TOKEN_KEY);
  if (path.startsWith('/api/auth/') || redirectingToLogin) return;
  redirectingToLogin = true;
  uni.reLaunch({
    url: '/pages/login/login',
    complete() {
      setTimeout(() => { redirectingToLogin = false; }, 300);
    }
  });
}

function requestOnce(path, options = {}) {
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

async function refreshSession() {
  if (refreshPromise) return refreshPromise;
  const refreshToken = tokenStore().getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return false;
  refreshPromise = requestOnce('/api/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
    timeoutMs: 15000
  }).then((result) => {
    tokenStore().setItem(TOKEN_KEY, result.accessToken || result.token);
    tokenStore().setItem(REFRESH_TOKEN_KEY, result.refreshToken);
    return true;
  }).catch(() => false).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function request(path, options = {}) {
  try {
    return await requestOnce(path, options);
  } catch (error) {
    if (error.statusCode === 401 && !path.startsWith('/api/auth/')) {
      if (!options._retried && await refreshSession()) return request(path, { ...options, _retried: true });
      handleUnauthorized(path);
    }
    if (error.statusCode === 428 && error.code === 'PROFILE_REQUIRED' && path !== '/api/account/profile') {
      uni.switchTab({ url: '/pages/profile/profile' });
    }
    throw error;
  }
}

async function authenticate(path, payload) {
  const result = await request(path, { method: 'POST', body: payload, timeoutMs: 15000 });
  tokenStore().setItem(TOKEN_KEY, result.accessToken || result.token);
  if (result.refreshToken) tokenStore().setItem(REFRESH_TOKEN_KEY, result.refreshToken);
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
  catalogVenues() {
    return request('/api/catalog/venues');
  },
  catalogStalls(params = {}) {
    return request(`/api/catalog/stalls${queryString({ page: params.page || 1, pageSize: params.pageSize || 100, venueId: params.venueId || '' })}`);
  },
  catalogCategories(itemType = 'meal') {
    return request(`/api/catalog/categories${queryString({ itemType })}`);
  },
  catalogRankings(params = {}) {
    return request(`/api/catalog/rankings${queryString({ type: params.type || 'dishes', itemType: params.type === 'dishes' || !params.type ? (params.itemType || 'meal') : '', catalogCategory: params.catalogCategory || '', page: params.page || 1, pageSize: params.pageSize || 20 })}`);
  },
  catalogRegions(params = {}) {
    return request(`/api/catalog/regions${queryString({ itemType: params.itemType || '' })}`);
  },
  catalogRegionDishes(regionId, params = {}) {
    return request(`/api/catalog/regions/${encodeURIComponent(regionId)}/dishes${queryString({ itemType: params.itemType || '', page: params.page || 1, pageSize: params.pageSize || 20, sort: params.sort || 'rating' })}`);
  },
  savedCatalog(params = {}) {
    return request(`/api/catalog/saved${queryString({ kind: params.kind || 'favorite', page: params.page || 1, pageSize: params.pageSize || 20 })}`);
  },
  communityDishOptions(params = {}) {
    return request(`/api/community/dish-options${queryString({ query: params.query || '', venueId: params.venueId || '', stallId: params.stallId || '', page: params.page || 1, pageSize: params.pageSize || 30 })}`);
  },
  login(payload) {
    return authenticate('/api/auth/login', payload);
  },
  register(payload) {
    return authenticate('/api/auth/register', payload);
  },
  phoneLogin(payload) {
    return authenticate('/api/auth/phone-login', payload);
  },
  bindPhone(payload) {
    return request('/api/auth/phone/bind', { method: 'POST', body: payload });
  },
  updatePublicProfile(payload) {
    return request('/api/account/profile', { method: 'PATCH', body: payload });
  },
  sendVerificationCode(payload) {
    return request('/api/auth/verification-codes', { method: 'POST', body: payload });
  },
  resetPassword(payload) {
    return request('/api/auth/password/reset', { method: 'POST', body: payload });
  },
  exportAccount() {
    return request('/api/account/export');
  },
  async deleteAccount(payload) {
    const result = await request('/api/account', { method: 'DELETE', body: payload });
    tokenStore().removeItem(TOKEN_KEY);
    tokenStore().removeItem(REFRESH_TOKEN_KEY);
    return result;
  },
  wechatLogin(payload) {
    return authenticate('/api/auth/wechat-login', payload);
  },
  logout() {
    const refreshToken = tokenStore().getItem(REFRESH_TOKEN_KEY);
    tokenStore().removeItem(TOKEN_KEY);
    tokenStore().removeItem(REFRESH_TOKEN_KEY);
    if (refreshToken) requestOnce('/api/auth/logout', { method: 'POST', body: { refreshToken }, timeoutMs: 5000 }).catch(() => {});
  },
  dishDetail(id) {
    return request(`/api/dishes/${encodeURIComponent(id)}`);
  },
  searchDishes(payload) {
    return request('/api/dishes/search', { method: 'POST', body: payload, timeoutMs: 60000 });
  },
  loadRankings(params = {}) {
    return request(`/api/catalog/rankings${queryString({ type: params.type || 'dishes', itemType: params.type === 'dishes' || !params.type ? (params.itemType || 'meal') : '', catalogCategory: params.catalogCategory || '', page: params.page || 1, pageSize: params.pageSize || 20 })}`);
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
  reactToContent(type, id, reaction) {
    return request(`/api/${type === 'post' ? 'posts' : 'reviews'}/${encodeURIComponent(id)}/reaction`, { method: 'PUT', body: { reaction } });
  },
  reportContent(type, id, payload = {}) {
    return request(`/api/${type === 'post' ? 'posts' : 'reviews'}/${encodeURIComponent(id)}/report`, { method: 'POST', body: payload });
  },
  listPostComments(id) {
    return request(`/api/posts/${encodeURIComponent(id)}/comments`);
  },
  createPostComment(id, content) {
    return request(`/api/posts/${encodeURIComponent(id)}/comments`, { method: 'POST', body: { content } });
  },
  updatePostComment(postId, commentId, content) {
    return request(`/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`, { method: 'PATCH', body: { content } });
  },
  deletePostComment(postId, commentId) {
    return request(`/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
  },
  reportPostComment(postId, commentId, payload = {}) {
    return request(`/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}/report`, { method: 'POST', body: payload });
  },
  archiveCommunityContent(type, id) {
    return request(`/api/${type === 'post' ? 'posts' : 'reviews'}/${encodeURIComponent(id)}/archive`, { method: 'POST' });
  },
  restoreCommunityContent(type, id) {
    return request(`/api/${type === 'post' ? 'posts' : 'reviews'}/${encodeURIComponent(id)}/restore`, { method: 'POST' });
  },
  updateCommunityContent(type, id, payload) {
    return request(`/api/${type === 'post' ? 'posts' : 'reviews'}/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload });
  },
  deleteCommunityContent(type, id) {
    return request(`/api/${type === 'post' ? 'posts' : 'reviews'}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  listCommunityReports(params = {}) {
    const query = Object.entries({ status: 'pending', limit: 50, offset: 0, ...params }).filter(([, value]) => value !== '' && value != null).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
    return request(`/api/admin/community/reports?${query}`);
  },
  updateCommunityReport(id, status) {
    return request(`/api/admin/community/reports/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  },
  uploadImage(payload) {
    return request('/api/uploads', { method: 'POST', body: payload, timeoutMs: 60000 });
  },
  saveProfile(payload) {
    return request('/api/health/profile', { method: 'PUT', body: payload });
  },
  deferProfileOnboarding() {
    return request('/api/health/profile/onboarding', { method: 'PATCH', body: { status: 'deferred' } });
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
  createOrder(payload) {
    const idempotencyKey = payload.idempotencyKey || `reservation:${Date.now()}:${Math.random().toString(36).slice(2, 12)}`;
    return request('/api/orders', { method: 'POST', body: { ...payload, idempotencyKey }, headers: { 'X-Idempotency-Key': idempotencyKey } });
  },
  cancelOrder(id) {
    return request(`/api/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  },
  analyzeMealImage(payload) {
    return request('/api/vision/meal-analyze', { method: 'POST', body: payload, timeoutMs: 60000 });
  },
  confirmMealVision(analysisId, payload) {
    return request(`/api/vision/analyses/${encodeURIComponent(analysisId)}/confirm`, { method: 'POST', body: payload });
  }
};
