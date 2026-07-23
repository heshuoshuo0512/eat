import { computed, reactive, ref } from 'vue';
import { buildMealPlan, calculateRanking, normalizeProfile } from '../domain/recommendation.js';
import { DEFAULT_DATA_MAX_AGE_MS, isDataCacheStale } from '../domain/cachePolicy.js';
import { normalizeRecommendationResult } from '../domain/studentDiscovery.js';
import { apiClient } from '../services/apiClient.js';

const MOTION_KEY = 'smart-canteen-reduced-motion';

function emptyState() {
  return {
    session: { user: null },
    canteens: [],
    stalls: [],
    dishes: [],
    reviews: [],
    dishPreferences: [],
    profile: normalizeProfile({ goal: 'healthy', budgetMax: 20, mealType: 'lunch' })
  };
}

function emptyMenu() {
  return { date: '', mealType: 'lunch', menus: [], dishes: [], source: 'fallback' };
}

function localRankings(source) {
  const reviewsByTarget = new Map();
  for (const review of source.reviews || []) {
    reviewsByTarget.set(review.targetId, [...(reviewsByTarget.get(review.targetId) || []), review]);
  }
  const dishes = calculateRanking(source.dishes || [], reviewsByTarget);
  const stalls = (source.stalls || []).map((stall) => {
    const items = dishes.filter((dish) => dish.stallId === stall.id);
    const rankScore = items.length ? items.reduce((sum, dish) => sum + dish.rankScore, 0) / items.length : Number(stall.rating || 0);
    return { ...stall, rankScore: Number(rankScore.toFixed(2)), dishCount: items.length };
  }).sort((left, right) => right.rankScore - left.rankScore);
  const canteens = (source.canteens || []).map((canteen) => {
    const items = stalls.filter((stall) => stall.canteenId === canteen.id);
    const rankScore = items.length ? items.reduce((sum, stall) => sum + stall.rankScore, 0) / items.length : 0;
    return { ...canteen, rankScore: Number(rankScore.toFixed(2)), stallCount: items.length };
  }).sort((left, right) => right.rankScore - left.rankScore);
  return { dishes, stalls, canteens };
}

const state = ref(emptyState());
const loading = ref(false);
const error = ref('');
const loaded = ref(false);
const lastLoadedAt = ref(0);
const todayMenu = ref(emptyMenu());
const remoteRankings = ref(null);
const contextualRecommendation = ref(normalizeRecommendationResult());
const recommendationLoading = ref(false);
const discoveryMode = ref('search');
const communitySection = ref('posts');
const motionReduced = ref(Boolean(uni.getStorageSync(MOTION_KEY)));
const searchFilters = reactive({ keyword: '', maxPrice: 999, taste: '不限', halalOnly: false });
let loadPromise = null;

function setState(nextState = {}) {
  state.value = {
    ...emptyState(),
    ...nextState,
    session: nextState.session || { user: null },
    canteens: Array.isArray(nextState.canteens) ? nextState.canteens : [],
    stalls: Array.isArray(nextState.stalls) ? nextState.stalls : [],
    dishes: Array.isArray(nextState.dishes) ? nextState.dishes : [],
    reviews: Array.isArray(nextState.reviews) ? nextState.reviews : [],
    dishPreferences: Array.isArray(nextState.dishPreferences) ? nextState.dishPreferences : [],
    profile: normalizeProfile(nextState.profile)
  };
}

function setPreferences(preferences = []) {
  state.value.dishPreferences = Array.isArray(preferences) ? preferences : [];
}

async function hydrateExtras() {
  const mealType = state.value.profile.mealType;
  const results = await Promise.allSettled([apiClient.todayMenu(mealType), apiClient.loadRankings()]);
  if (results[0].status === 'fulfilled') todayMenu.value = results[0].value;
  if (results[1].status === 'fulfilled') remoteRankings.value = results[1].value;
}

async function load(force = false) {
  if (!apiClient.hasToken()) {
    setState();
    loaded.value = false;
    lastLoadedAt.value = 0;
    return state.value;
  }
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    loading.value = true;
    error.value = '';
    try {
      setState(await apiClient.bootstrap());
      loaded.value = true;
      await hydrateExtras();
      lastLoadedAt.value = Date.now();
      return state.value;
    } catch (err) {
      error.value = err.message || '数据加载失败';
      if (err.statusCode === 401) {
        setState();
        loaded.value = false;
        lastLoadedAt.value = 0;
      }
      throw err;
    } finally {
      loading.value = false;
      loadPromise = null;
    }
  })();
  return loadPromise;
}

async function ensureLoaded() {
  if (loaded.value && state.value.session.user) return state.value;
  return load();
}

async function refreshIfStale(maxAgeMs = DEFAULT_DATA_MAX_AGE_MS) {
  if (!loaded.value || !state.value.session.user) return load();
  if (!isDataCacheStale(lastLoadedAt.value, Date.now(), maxAgeMs)) return state.value;
  try {
    return await load(true);
  } catch {
    return state.value;
  }
}

const user = computed(() => state.value.session.user);
const canteens = computed(() => state.value.canteens);
const stalls = computed(() => state.value.stalls);
const dishes = computed(() => state.value.dishes);
const profile = computed(() => state.value.profile);
const dishPreferences = computed(() => state.value.dishPreferences);
const rankings = computed(() => remoteRankings.value || localRankings(state.value));
const searchedDishes = computed(() => state.value.dishes.filter((dish) => dish.status !== 'archived' && dish.status !== 'inactive'));
const recommendation = computed(() => buildMealPlan(todayMenu.value.dishes?.length ? todayMenu.value.dishes : state.value.dishes, state.value.profile));

async function login(payload) {
  const result = await apiClient.login(payload);
  setState(result.state);
  loaded.value = true;
  await hydrateExtras();
  lastLoadedAt.value = Date.now();
  return result.user;
}

async function wechatLogin(profilePayload = {}) {
  const code = await new Promise((resolve, reject) => {
    uni.login({ provider: 'weixin', success: (result) => resolve(result.code), fail: (err) => reject(new Error(err?.errMsg || '微信登录失败。')) });
  });
  const result = await apiClient.wechatLogin({ code, profile: profilePayload });
  setState(result.state);
  loaded.value = true;
  await hydrateExtras();
  lastLoadedAt.value = Date.now();
  return result.user;
}

function logout() {
  apiClient.logout();
  setState();
  todayMenu.value = emptyMenu();
  remoteRankings.value = null;
  contextualRecommendation.value = normalizeRecommendationResult();
  loaded.value = false;
  lastLoadedAt.value = 0;
}

function getDishDetail(id) {
  const dish = state.value.dishes.find((item) => String(item.id) === String(id));
  if (!dish) return null;
  const stall = state.value.stalls.find((item) => String(item.id) === String(dish.stallId));
  const canteen = state.value.canteens.find((item) => String(item.id) === String(stall?.canteenId));
  const reviews = state.value.reviews.filter((review) => review.targetType === 'dish' && String(review.targetId) === String(id));
  return { ...dish, stall, canteen, reviews };
}

async function addReview(payload) {
  return apiClient.addReview(payload);
}

async function saveProfile(payload) {
  const result = await apiClient.saveProfile(payload);
  if (result.state) setState(result.state);
  else state.value.profile = normalizeProfile(result.profile || payload);
  contextualRecommendation.value = normalizeRecommendationResult(result.recommendation || {});
  await loadTodayMenu(state.value.profile.mealType);
  return state.value.profile;
}

async function loadTodayMenu(mealType = state.value.profile.mealType) {
  try {
    todayMenu.value = await apiClient.todayMenu(mealType);
    return todayMenu.value;
  } catch (err) {
    error.value = err.message || '今日菜单加载失败';
    throw err;
  }
}

async function loadRecommendation() {
  recommendationLoading.value = true;
  try {
    contextualRecommendation.value = normalizeRecommendationResult(await apiClient.loadRecommendation());
    return contextualRecommendation.value;
  } catch (err) {
    contextualRecommendation.value = normalizeRecommendationResult({ error: err.message });
    contextualRecommendation.value.error = err.message;
    throw err;
  } finally {
    recommendationLoading.value = false;
  }
}

async function requestRecommendation(payload) {
  recommendationLoading.value = true;
  try {
    contextualRecommendation.value = normalizeRecommendationResult(await apiClient.requestRecommendation(payload));
    return contextualRecommendation.value;
  } finally {
    recommendationLoading.value = false;
  }
}

async function searchDishes(payload) {
  return apiClient.searchDishes(payload);
}

async function toggleFavorite(dishId) {
  const current = state.value.dishPreferences.find((item) => String(item.dishId) === String(dishId));
  const result = await apiClient.setDishPreference({ dishId, favorite: !current?.favorite });
  setPreferences(result.preferences);
  return result.preferences;
}

async function markDishEaten(dishId) {
  const result = await apiClient.recordDishEaten(dishId);
  const index = state.value.dishPreferences.findIndex((item) => String(item.dishId) === String(dishId));
  if (index >= 0) state.value.dishPreferences.splice(index, 1, result.preference);
  else state.value.dishPreferences.push(result.preference);
  return result.preference;
}

async function markDishDrawn(dishId) {
  const result = await apiClient.recordDishDrawn(dishId);
  const index = state.value.dishPreferences.findIndex((item) => String(item.dishId) === String(dishId));
  if (index >= 0) state.value.dishPreferences.splice(index, 1, result.preference);
  else state.value.dishPreferences.push(result.preference);
  return result.preference;
}

function openCommunitySection(section) {
  communitySection.value = section === 'reviews' ? 'reviews' : 'posts';
}

function openDiscoveryMode(mode) {
  discoveryMode.value = mode === 'recommend' ? 'recommend' : 'search';
}

function setMotionReduced(value) {
  motionReduced.value = Boolean(value);
  uni.setStorageSync(MOTION_KEY, motionReduced.value ? '1' : '');
}

export function useCanteenStore() {
  return {
    state, loading, error, loaded, lastLoadedAt, todayMenu, remoteRankings, contextualRecommendation, recommendationLoading,
    discoveryMode, communitySection, motionReduced, searchFilters, user, canteens, stalls, dishes, profile, dishPreferences,
    rankings, searchedDishes, recommendation,
    load, ensureLoaded, refreshIfStale, login, wechatLogin, logout, getDishDetail, addReview, saveProfile,
    loadTodayMenu, loadRecommendation, requestRecommendation, searchDishes, toggleFavorite, markDishEaten,
    markDishDrawn, openDiscoveryMode, openCommunitySection, setMotionReduced,
    fetchDishDetail: apiClient.dishDetail,
    runAgent: apiClient.runAgent,
    loadAgentMemory: apiClient.loadAgentMemory,
    saveAgentMemory: apiClient.saveAgentMemory,
    clearAgentMemory: apiClient.clearAgentMemory,
    confirmAgentAction: apiClient.confirmAgentAction,
    rejectAgentAction: apiClient.rejectAgentAction,
    listReviews: apiClient.listReviews,
    listPosts: apiClient.listPosts,
    createPost: apiClient.createPost,
    uploadImage: apiClient.uploadImage,
    listOrders: apiClient.listOrders,
    analyzeMealImage: apiClient.analyzeMealImage
  };
}
