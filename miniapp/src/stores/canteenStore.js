import { computed, reactive, ref } from 'vue';
import { buildMealPlan, normalizeProfile } from '../domain/recommendation.js';
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
  return { date: '', mealType: 'lunch', menus: [], dishes: [], source: 'stable_catalog' };
}

const state = ref(emptyState());
const loading = ref(false);
const error = ref('');
const loaded = ref(false);
const lastLoadedAt = ref(0);
const todayMenu = ref(emptyMenu());
const catalogPage = ref({ page: 0, pageSize: 50, total: 0, hasMore: false });
const catalogCategories = ref({ meal: [], snack: [], beverage: [] });
const reservationCatalogPage = ref({ page: 0, pageSize: 50, total: 0, hasMore: false });
const remoteRankings = ref({ dishes: [], stalls: [], canteens: [] });
const rankingMeta = ref({ dishes: null, stalls: null, canteens: null });
const catalogRegions = ref({ meal: [], snack: [], beverage: [] });
const catalogRegionDetails = ref({});
const savedCatalog = ref({ favorite: { items: [], page: { page: 0, hasMore: false, total: 0 } }, eaten: { items: [], page: { page: 0, hasMore: false, total: 0 } } });
const contextualRecommendation = ref(normalizeRecommendationResult());
const recommendationLoading = ref(false);
const discoveryMode = ref('search');
const communitySection = ref('posts');
const runtimeUni = typeof uni !== 'undefined' ? uni : globalThis?.uni;
const motionReduced = ref(runtimeUni?.getStorageSync?.(MOTION_KEY) === '1');
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

function mergeDishes(items = [], { replace = false } = {}) {
  const entities = new Map((replace ? [] : state.value.dishes).map((dish) => [String(dish.id), dish]));
  for (const dish of items) entities.set(String(dish.id), { ...(entities.get(String(dish.id)) || {}), ...dish });
  state.value.dishes = [...entities.values()];
}

async function hydrateExtras() {
  const results = await Promise.allSettled([
    apiClient.catalogVenues(),
    apiClient.catalogStalls({ page: 1, pageSize: 100 }),
    apiClient.searchDishes({ page: 1, pageSize: 50, sort: 'rating_desc' }),
    apiClient.catalogRankings({ type: 'dishes', page: 1, pageSize: 20 }),
    apiClient.catalogRankings({ type: 'stalls', page: 1, pageSize: 20 }),
    apiClient.catalogRankings({ type: 'venues', page: 1, pageSize: 20 }),
    apiClient.listPreferences()
  ]);
  if (results[0].status === 'fulfilled') state.value.canteens = results[0].value.venues || [];
  if (results[1].status === 'fulfilled') {
    state.value.stalls = results[1].value.stalls || [];
    if (results[1].value.page?.hasMore) {
      const next = await apiClient.catalogStalls({ page: 2, pageSize: 100 });
      state.value.stalls.push(...(next.stalls || []));
    }
  }
  if (results[2].status === 'fulfilled') {
    state.value.dishes = results[2].value.items || [];
    catalogPage.value = results[2].value.page || { page: 1, pageSize: 50, total: state.value.dishes.length, hasMore: false };
  }
  remoteRankings.value = {
    dishes: results[3].status === 'fulfilled' ? results[3].value.items || [] : [],
    stalls: results[4].status === 'fulfilled' ? results[4].value.items || [] : [],
    canteens: results[5].status === 'fulfilled' ? results[5].value.items || [] : [],
  };
  rankingMeta.value = {
    dishes: results[3].status === 'fulfilled' ? results[3].value.ranking || null : null,
    stalls: results[4].status === 'fulfilled' ? results[4].value.ranking || null : null,
    canteens: results[5].status === 'fulfilled' ? results[5].value.ranking || null : null,
  };
  if (results[6].status === 'fulfilled') setPreferences(results[6].value.preferences || []);
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
const rankings = computed(() => remoteRankings.value);
const searchedDishes = computed(() => state.value.dishes.filter((dish) => dish.status !== 'archived' && dish.status !== 'inactive'));
const recommendation = computed(() => buildMealPlan(todayMenu.value.dishes?.length ? todayMenu.value.dishes : state.value.dishes, state.value.profile));

async function login(payload) {
  const result = await apiClient.login(payload);
  await load(true);
  return result.user;
}

async function register(payload) {
  const result = await apiClient.register(payload);
  await load(true);
  return result.user;
}

async function wechatLogin({ phoneCode = '', agreementVersion = '2026-07', profile = {} } = {}) {
  const code = await new Promise((resolve, reject) => {
    uni.login({ provider: 'weixin', success: (result) => resolve(result.code), fail: (err) => reject(new Error(err?.errMsg || '微信登录失败。')) });
  });
  const result = await apiClient.wechatLogin({ code, phoneCode, agreementVersion, profile });
  await load(true);
  return result.user;
}

function logout() {
  apiClient.logout();
  setState();
  todayMenu.value = emptyMenu();
  remoteRankings.value = { dishes: [], stalls: [], canteens: [] };
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
    const result = await apiClient.searchDishes({ page: 1, pageSize: 50, reservationOnly: true, sort: 'rating_desc' });
    reservationCatalogPage.value = result.page || { page: 1, pageSize: 50, total: result.items?.length || 0, hasMore: false };
    todayMenu.value = { date: '', mealType, menus: [], dishes: result.items || [], source: 'stable_catalog' };
    mergeDishes(result.items || []);
    return todayMenu.value;
  } catch (err) {
    error.value = err.message || '校园菜单加载失败';
    throw err;
  }
}

async function loadMoreTodayMenu(mealType = state.value.profile.mealType) {
  if (!reservationCatalogPage.value.hasMore) return todayMenu.value;
  const result = await apiClient.searchDishes({ page: reservationCatalogPage.value.page + 1, pageSize: reservationCatalogPage.value.pageSize || 50, reservationOnly: true, sort: 'rating_desc' });
  const entities = new Map(todayMenu.value.dishes.map((dish) => [String(dish.id), dish]));
  for (const dish of result.items || []) entities.set(String(dish.id), dish);
  todayMenu.value = { date: '', mealType, menus: [], dishes: [...entities.values()], source: 'stable_catalog' };
  reservationCatalogPage.value = result.page;
  mergeDishes(result.items || []);
  return todayMenu.value;
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

async function loadCatalogDishes({ page = 1, pageSize = 50, ...filters } = {}) {
  const result = await apiClient.searchDishes({ page, pageSize, ...filters });
  // Pagination owns the visible catalog page; do not retain previous pages.
  mergeDishes(result.items || [], { replace: true });
  catalogPage.value = result.page || { page, pageSize, total: state.value.dishes.length, hasMore: false };
  return result;
}

async function loadCatalogCategories(itemType = 'meal', { force = false } = {}) {
  if (!force && catalogCategories.value[itemType]?.length) return catalogCategories.value[itemType];
  const result = await apiClient.catalogCategories(itemType);
  catalogCategories.value = { ...catalogCategories.value, [itemType]: result.categories || [] };
  return catalogCategories.value[itemType];
}

async function loadMoreCatalog(filters = {}) {
  if (!catalogPage.value.hasMore) return { items: [], page: catalogPage.value };
  return loadCatalogDishes({ ...filters, page: catalogPage.value.page + 1, pageSize: catalogPage.value.pageSize || 50 });
}

async function fetchDishDetail(id) {
  const detail = await apiClient.dishDetail(id);
  mergeDishes([detail]);
  return detail;
}

async function loadSavedCatalog(kind = 'favorite', { page = 1, pageSize = 20 } = {}) {
  const result = await apiClient.savedCatalog({ kind, page, pageSize });
  const previous = page > 1 ? savedCatalog.value[kind]?.items || [] : [];
  const entities = new Map(previous.map((dish) => [String(dish.id), dish]));
  for (const dish of result.items || []) entities.set(String(dish.id), dish);
  savedCatalog.value[kind] = { items: [...entities.values()], page: result.page };
  mergeDishes(result.items || []);
  return savedCatalog.value[kind];
}

async function loadCatalogRanking(type = 'dishes', { page = 1, pageSize = 20 } = {}) {
  const result = await apiClient.catalogRankings({ type, page, pageSize });
  const key = type === 'venues' ? 'canteens' : type;
  const previous = page > 1 ? remoteRankings.value[key] || [] : [];
  const entities = new Map(previous.map((item) => [String(item.id), item]));
  for (const item of result.items || []) entities.set(String(item.id), item);
  remoteRankings.value = { ...remoteRankings.value, [key]: [...entities.values()] };
  rankingMeta.value = { ...rankingMeta.value, [key]: result.ranking || null };
  if (type === 'dishes') mergeDishes(result.items || []);
  return result;
}

async function loadCatalogRegions(itemType = 'meal') {
  const result = await apiClient.catalogRegions({ itemType });
  catalogRegions.value = { ...catalogRegions.value, [itemType]: result.regions || [] };
  return result;
}

async function loadCatalogRegionDishes(regionId, params = {}) {
  const result = await apiClient.catalogRegionDishes(regionId, params);
  const key = `${params.itemType || 'meal'}:${regionId}`;
  const previous = Number(params.page || 1) > 1 ? catalogRegionDetails.value[key]?.items || [] : [];
  const entities = new Map(previous.map((item) => [String(item.id), item]));
  for (const item of result.items || []) entities.set(String(item.id), item);
  catalogRegionDetails.value = { ...catalogRegionDetails.value, [key]: { ...result, items: [...entities.values()] } };
  mergeDishes(result.items || []);
  return catalogRegionDetails.value[key];
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

async function deferProfileOnboarding() {
  const result = await apiClient.deferProfileOnboarding();
  if (result.state) setState(result.state);
  return result.profile;
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
    state, loading, error, loaded, lastLoadedAt, todayMenu, catalogPage, catalogCategories, reservationCatalogPage, remoteRankings, rankingMeta, catalogRegions, catalogRegionDetails, savedCatalog, contextualRecommendation, recommendationLoading,
    discoveryMode, communitySection, motionReduced, searchFilters, user, canteens, stalls, dishes, profile, dishPreferences,
    rankings, searchedDishes, recommendation,
    load, ensureLoaded, refreshIfStale, login, register, wechatLogin, logout, getDishDetail, addReview, saveProfile, deferProfileOnboarding,
    loadTodayMenu, loadMoreTodayMenu, loadCatalogDishes, loadMoreCatalog, loadCatalogCategories, loadSavedCatalog, loadCatalogRanking, loadCatalogRegions, loadCatalogRegionDishes, loadRecommendation, requestRecommendation, searchDishes, toggleFavorite, markDishEaten,
    markDishDrawn, openDiscoveryMode, openCommunitySection, setMotionReduced,
    fetchDishDetail,
    runAgent: apiClient.runAgent,
    loadAgentMemory: apiClient.loadAgentMemory,
    saveAgentMemory: apiClient.saveAgentMemory,
    clearAgentMemory: apiClient.clearAgentMemory,
    confirmAgentAction: apiClient.confirmAgentAction,
    rejectAgentAction: apiClient.rejectAgentAction,
    listReviews: apiClient.listReviews,
    listPosts: apiClient.listPosts,
    communityDishOptions: apiClient.communityDishOptions,
    createPost: apiClient.createPost,
    reactToContent: apiClient.reactToContent,
    reportContent: apiClient.reportContent,
    listPostComments: apiClient.listPostComments,
    createPostComment: apiClient.createPostComment,
    updateCommunityContent: apiClient.updateCommunityContent,
    deleteCommunityContent: apiClient.deleteCommunityContent,
    uploadImage: apiClient.uploadImage,
    listOrders: apiClient.listOrders,
    createOrder: apiClient.createOrder,
    cancelOrder: apiClient.cancelOrder,
    analyzeMealImage: apiClient.analyzeMealImage,
    confirmMealVision: apiClient.confirmMealVision
    ,sendVerificationCode: apiClient.sendVerificationCode
    ,resetPassword: apiClient.resetPassword
  };
}
