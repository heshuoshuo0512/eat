import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { buildMealPlan, contextualRankDishes, normalizeProfile } from '../domain/recommendation.js';
import { apiClient } from '../services/apiClient.js';

function emptyState() {
  return {
    session: { user: null },
    canteens: [],
    stalls: [],
    dishes: [],
    reviews: [],
    dishPreferences: [],
    profile: normalizeProfile({ goal: 'fatLoss', budgetMax: 18, mealType: 'lunch' })
  };
}

function emptyDishSearchResult() {
  return {
    query: '',
    interpreted: null,
    items: [],
    availability: { orderableCount: 0, totalCount: 0 },
    matchReasons: {},
    suggestedRelaxations: [],
    page: { limit: 0, offset: 0, total: 0 },
    meta: null,
    error: null
  };
}

function emptyContextualRecommendation(error = null) {
  return {
    recommendations: [],
    mealPlan: null,
    evidence: { dishes: [], knowledge: [] },
    warnings: [],
    suggestedRelaxations: [],
    meta: null,
    ranked: [],
    plan: null,
    context: null,
    source: null,
    menu: null,
    goalLabel: null,
    totals: null,
    error
  };
}

function normalizeRecommendationResult(result = {}) {
  const mealPlan = result.mealPlan || result.plan || null;
  const recommendations = result.recommendations
    || result.dishes
    || mealPlan?.dishes
    || mealPlan?.picks
    || result.ranked
    || result.picks
    || [];
  const plan = result.plan || (mealPlan ? {
    ...mealPlan,
    dishes: mealPlan.dishes || recommendations,
    picks: mealPlan.picks || mealPlan.dishes || recommendations
  } : null);
  const meta = result.meta || null;
  return {
    ...emptyContextualRecommendation(),
    ...result,
    recommendations,
    mealPlan,
    evidence: {
      dishes: result.evidence?.dishes || [],
      knowledge: result.evidence?.knowledge || []
    },
    warnings: result.warnings || [],
    suggestedRelaxations: result.suggestedRelaxations || [],
    meta,
    ranked: recommendations,
    plan,
    context: result.context || meta?.context || result.reason || null,
    source: result.source || meta?.source || null,
    menu: result.menu || (meta?.date || meta?.mealType ? { date: meta.date, mealType: meta.mealType } : null),
    goalLabel: result.goalLabel || plan?.goalLabel || null,
    totals: result.totals || plan?.totals || mealPlan?.totals || null,
    error: null
  };
}

function filterDishes(dishes, filters = {}) {
  const keyword = String(filters.keyword || '').trim().toLowerCase();
  const maxPrice = Number(filters.maxPrice || 999);
  const taste = filters.taste || '不限';
  const halalOnly = Boolean(filters.halalOnly);
  return dishes.filter((dish) => {
    const haystack = [dish.name, dish.cuisine, dish.taste, ...dish.tags, ...dish.ingredients].join(' ').toLowerCase();
    if (keyword && !haystack.includes(keyword)) return false;
    if (dish.price > maxPrice) return false;
    if (taste !== '不限' && dish.taste !== taste && !dish.tags.includes(taste)) return false;
    if (halalOnly && !dish.halal) return false;
    return true;
  });
}

export const useCanteenStore = defineStore('canteen', () => {
  const state = ref(emptyState());
  const loading = ref(false);
  const error = ref('');
  const searchFilters = ref({ keyword: '', maxPrice: 25, taste: '不限', halalOnly: false });
  const todayMenu = ref({ date: '', mealType: 'lunch', menus: [], dishes: [], source: 'fallback' });
  const catalogPage = ref({ page: 0, pageSize: 20, total: 0, hasMore: false });
  const catalogCategories = ref({ meal: [], snack: [], beverage: [] });
  const reservationCatalogPage = ref({ page: 0, pageSize: 50, total: 0, hasMore: false });
  const remoteRankings = ref({ dishes: [], stalls: [], canteens: [] });
  const rankingMeta = ref({ dishes: null, stalls: null, canteens: null });
  const catalogRegions = ref({ meal: [], snack: [], beverage: [] });
  const catalogRegionDetails = ref({});
  const adminCatalogOverview = ref(null);
  const savedCatalog = ref({ favorite: { items: [], page: { page: 0, hasMore: false, total: 0 } }, eaten: { items: [], page: { page: 0, hasMore: false, total: 0 } } });

  const orders = ref([]);
  const adminOrders = ref([]);
  const agentMemory = ref({ summary: '', preferences: {} });
  const agentEvalCases = ref([]);
  const agentEvalRuns = ref([]);
  const deploymentReadiness = ref(null);
  const retrievalIndexStatus = ref(null);
  const retrievalReindexResult = ref(null);
  const dishSearchResult = ref(emptyDishSearchResult());
  const dishSearchLoading = ref(false);
  let dishSearchRequestId = 0;
  const catalogPageCache = new Map();
  const catalogPageInflight = new Map();
  const searchPageCache = new Map();
  const searchPageInflight = new Map();
  const PAGE_CACHE_LIMIT = 24;
  const recommendationLoading = ref(false);
  const contextualRecommendation = ref(emptyContextualRecommendation());
  const healthPlan = ref(null);
  const adminEnvironment = ref(null);
  const adminCatalogTree = ref(null);

  function setState(nextState) {
    state.value = { ...emptyState(), ...nextState, profile: normalizeProfile(nextState?.profile) };
    if (nextState?.dishPreferences) state.value.dishPreferences = nextState.dishPreferences;
  }

  async function load() {
    loading.value = true;
    error.value = '';
    clearPageCaches();
    try {
      const bootstrap = await apiClient.bootstrap();
      const [venuesResult, firstStalls, dishesResult, dishRanks, stallRanks, venueRanks] = await Promise.all([
        apiClient.catalogVenues(),
        apiClient.catalogStalls({ page: 1, pageSize: 100 }),
        apiClient.dishesSearch({ page: 1, pageSize: 20, sort: 'rating_desc' }),
        apiClient.catalogRankings({ type: 'dishes', page: 1, pageSize: 20 }),
        apiClient.catalogRankings({ type: 'stalls', page: 1, pageSize: 20 }),
        apiClient.catalogRankings({ type: 'venues', page: 1, pageSize: 20 })
      ]);
      let allStalls = firstStalls.stalls || [];
      if (firstStalls.page?.hasMore) {
        const second = await apiClient.catalogStalls({ page: 2, pageSize: 100 });
        allStalls = [...allStalls, ...(second.stalls || [])];
      }
      const preferences = bootstrap.session?.user ? await apiClient.getDishPreferences().catch(() => ({ preferences: [] })) : { preferences: [] };
      setState({
        ...bootstrap,
        canteens: venuesResult.venues || [],
        stalls: allStalls,
        dishes: dishesResult.items || [],
        reviews: [],
        dishPreferences: preferences.preferences || []
      });
      catalogPage.value = dishesResult.page || { page: 1, pageSize: 20, total: dishesResult.items?.length || 0, hasMore: false };
      remoteRankings.value = { dishes: dishRanks.items || [], stalls: stallRanks.items || [], canteens: venueRanks.items || [] };
      rankingMeta.value = { dishes: dishRanks.ranking || null, stalls: stallRanks.ranking || null, canteens: venueRanks.ranking || null };
      todayMenu.value = { date: '', mealType: state.value.profile.mealType, menus: [], dishes: [], source: 'stable_catalog' };
    } catch (err) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  }

  const user = computed(() => state.value.session.user);
  const canteens = computed(() => state.value.canteens);
  const stalls = computed(() => state.value.stalls);
  const dishes = computed(() => state.value.dishes);
  const profile = computed(() => state.value.profile);
  const dishPreferences = computed(() => state.value.dishPreferences);
  const searchedDishes = computed(() => filterDishes(state.value.dishes, searchFilters.value));
  const rankings = computed(() => remoteRankings.value);
  const recommendation = computed(() => buildMealPlan(todayMenu.value.dishes.length ? todayMenu.value.dishes : state.value.dishes, state.value.profile));

  function stablePageKey(value) {
    if (Array.isArray(value)) return value.map(stablePageKey);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stablePageKey(value[key])]));
    }
    return value == null ? null : value;
  }

  function requestKey(value) {
    return JSON.stringify(stablePageKey(value));
  }

  function rememberPage(cache, key, result) {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, result);
    while (cache.size > PAGE_CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return result;
  }

  function clearPageCaches() {
    catalogPageCache.clear();
    catalogPageInflight.clear();
    searchPageCache.clear();
    searchPageInflight.clear();
  }

  async function fetchCatalogPage(payload, { force = false } = {}) {
    const key = requestKey(payload);
    if (!force && catalogPageCache.has(key)) return catalogPageCache.get(key);
    if (!force && catalogPageInflight.has(key)) return catalogPageInflight.get(key);
    const pending = apiClient.dishesSearch(payload).then((result) => rememberPage(catalogPageCache, key, result));
    catalogPageInflight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (catalogPageInflight.get(key) === pending) catalogPageInflight.delete(key);
    }
  }

  async function fetchSearchPage(payload, { force = false, request = null } = {}) {
    const key = requestKey(payload);
    if (!force && searchPageCache.has(key)) return searchPageCache.get(key);
    if (!force && searchPageInflight.has(key)) return searchPageInflight.get(key);
    const pending = (request ? request() : apiClient.dishesSearch(payload))
      .then((result) => rememberPage(searchPageCache, key, result));
    searchPageInflight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (searchPageInflight.get(key) === pending) searchPageInflight.delete(key);
    }
  }

  async function loadRecommendation() {
    recommendationLoading.value = true;
    try {
      const result = await apiClient.loadRecommendation();
      contextualRecommendation.value = normalizeRecommendationResult(result);
      return contextualRecommendation.value;
    } catch (error) {
      contextualRecommendation.value = emptyContextualRecommendation(error?.message || '推荐请求失败，请稍后重试。');
      return contextualRecommendation.value;
    } finally {
      recommendationLoading.value = false;
    }
  }

  async function requestRecommendation(payload = {}) {
    recommendationLoading.value = true;
    try {
      const result = await apiClient.recommend(payload);
      contextualRecommendation.value = normalizeRecommendationResult(result);
      return contextualRecommendation.value;
    } catch (error) {
      contextualRecommendation.value = emptyContextualRecommendation(error?.message || '推荐请求失败，请稍后重试。');
      throw error;
    } finally {
      recommendationLoading.value = false;
    }
  }

  async function searchDishes(payload, { append = false } = {}) {
    const requestId = ++dishSearchRequestId;
    dishSearchLoading.value = true;
    const previous = append ? dishSearchResult.value : emptyDishSearchResult();
    if (!append) dishSearchResult.value = { ...previous, query: String(payload?.query || '').trim() };
    try {
      const result = await fetchSearchPage(payload, {
        request: () => apiClient.dishesSearch(payload)
      });
      if (requestId !== dishSearchRequestId) return result;
      const entities = new Map((append ? previous.items : []).map((item) => [String(item.id), item]));
      for (const item of result.items || []) entities.set(String(item.id), item);
      dishSearchResult.value = {
        ...emptyDishSearchResult(),
        ...result,
        query: String(payload?.query || '').trim(),
        items: [...entities.values()],
        suggestedRelaxations: Array.isArray(result.suggestedRelaxations) ? result.suggestedRelaxations : [],
        error: null
      };
      return dishSearchResult.value;
    } catch (error) {
      if (requestId !== dishSearchRequestId) return null;
      dishSearchResult.value = {
        ...emptyDishSearchResult(),
        query: String(payload?.query || '').trim(),
        error: error?.message || '菜品检索失败，请稍后重试。'
      };
      throw error;
    } finally {
      if (requestId === dishSearchRequestId) dishSearchLoading.value = false;
    }
  }

  async function loadCatalogDishes({ page = 1, pageSize = 20, force = false, ...filters } = {}) {
    const result = await fetchCatalogPage({ page, pageSize, ...filters }, { force });
    // Pagination owns the visible catalog page; do not retain previous pages.
    mergeDishes(result.items || [], { replace: true });
    catalogPage.value = result.page || { page, pageSize, total: state.value.dishes.length, hasMore: false };
    return result;
  }

  async function prefetchCatalogDishes({ page = 1, pageSize = 20, ...filters } = {}) {
    return fetchCatalogPage({ page, pageSize, ...filters });
  }

  async function prefetchSearchDishes(payload) {
    return fetchSearchPage(payload);
  }

  async function loadCatalogCategories(itemType = 'meal', { force = false } = {}) {
    if (!force && catalogCategories.value[itemType]?.length) return catalogCategories.value[itemType];
    const result = await apiClient.catalogCategories(itemType);
    catalogCategories.value = { ...catalogCategories.value, [itemType]: result.categories || [] };
    return catalogCategories.value[itemType];
  }

  async function loadMoreCatalog(filters = {}) {
    if (!catalogPage.value.hasMore) return { items: [], page: catalogPage.value };
    return loadCatalogDishes({ ...filters, page: catalogPage.value.page + 1, pageSize: catalogPage.value.pageSize || 20 });
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

  async function loadCatalogRanking(type = 'dishes', { page = 1, pageSize = 20, itemType = 'meal', catalogCategory = '' } = {}) {
    const result = await apiClient.catalogRankings({ type, itemType, catalogCategory, page, pageSize });
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

  async function loadAdminCatalogOverview() {
    adminCatalogOverview.value = await apiClient.getAdminCatalogOverview();
    return adminCatalogOverview.value;
  }

  async function loadCommunityDishOptions(filters = {}) {
    return apiClient.communityDishOptions(filters);
  }

  function clearDishSearch() {
    dishSearchResult.value = emptyDishSearchResult();
  }
  async function loadHealthPlan(days = 1) {
    healthPlan.value = await apiClient.healthPlan(days);
    return healthPlan.value;
  }

  async function login(payload) {
    const result = await apiClient.login(payload);
    await load();
    return result.user;
  }

  function mergeDishes(items = [], { replace = false } = {}) {
    const entities = new Map((replace ? [] : state.value.dishes).map((dish) => [String(dish.id), dish]));
    for (const dish of items) entities.set(String(dish.id), { ...(entities.get(String(dish.id)) || {}), ...dish });
    state.value.dishes = [...entities.values()];
    return state.value.dishes;
  }

  async function register(payload) {
    const result = await apiClient.register(payload);
    await load();
    return result.user;
  }

  async function phoneLogin(payload) {
    const result = await apiClient.phoneLogin(payload);
    await load();
    return result.user;
  }

  async function bindPhone(payload) {
    const result = await apiClient.bindPhone(payload);
    state.value.session.user = result.user;
    return result.user;
  }

  async function updatePublicProfile(payload) {
    const result = await apiClient.updatePublicProfile(payload);
    state.value.session.user = result.user;
    return result.user;
  }

  async function sendVerificationCode(payload) {
    return apiClient.sendVerificationCode(payload);
  }

  async function resetPassword(payload) {
    return apiClient.resetPassword(payload);
  }

  async function deferProfileOnboarding() {
    const result = await apiClient.deferProfileOnboarding();
    if (result.state) setState(result.state);
    return result.profile;
  }

  function logout() {
    apiClient.logout();
    state.value.session.user = null;
  }

  function getDishDetail(id) {
    const dish = state.value.dishes.find((item) => item.id === id);
    if (!dish) return null;
    const stall = state.value.stalls.find((item) => item.id === dish.stallId);
    const canteen = state.value.canteens.find((item) => item.id === stall?.canteenId);
    const detailReviews = state.value.reviews.filter((review) => review.targetType === 'dish' && review.targetId === id);
    return { ...dish, stall, canteen, reviews: detailReviews };
  }

  async function addReview(payload) {
    const detail = await apiClient.addReview(payload);
    await load();
    return detail;
  }

  async function saveProfile(payload) {
    const result = await apiClient.saveProfile(payload);
    if (result.state) setState(result.state);
    else state.value.profile = normalizeProfile(result.profile || payload);
    await loadTodayMenu(state.value.profile.mealType);
    return result.profile;
  }

  async function upsertCanteen(payload) {
    const result = await apiClient.upsertCanteen(payload);
    setState(result);
    return state.value.canteens.find((item) => item.id === result.savedId) || null;
  }

  async function deleteCanteen(id) {
    setState(await apiClient.deleteCanteen(id));
  }

  async function upsertDish(payload) {
    const result = await apiClient.upsertDish(payload);
    setState(result);
    return result.savedEntity || state.value.dishes.find((item) => item.id === result.savedId) || null;
  }

  async function deleteDish(id) {
    setState(await apiClient.deleteDish(id));
  }

  async function upsertStall(payload) {
    const result = await apiClient.upsertStall(payload);
    setState(result);
    return state.value.stalls.find((item) => item.id === result.savedId) || null;
  }

  async function deleteStall(id) {
    setState(await apiClient.deleteStall(id));
  }

  async function importDishes(dishes) {
    const result = await apiClient.importDishes(dishes);
    setState(result.state);
    return result.imported;
  }

  async function previewDishImport(csvText) {
    return apiClient.previewDishImport(csvText);
  }

  async function confirmDishImport(csvText) {
    const result = await apiClient.confirmDishImport(csvText);
    setState(result.state);
    return result;
  }

  async function uploadImage(payload) {
    return apiClient.uploadImage(payload);
  }

  async function identifyDishImage(payload, options = {}) {
    return apiClient.identifyDishImage(payload, options);
  }

  async function ragSearch(query) {
    return apiClient.ragSearch(query);
  }

  async function analyzeMealImage(payload, options = {}) {
    return apiClient.analyzeMealImage(payload, options);
  }

  async function confirmMealVision(analysisId, payload, options = {}) {
    return apiClient.confirmMealVision(analysisId, payload, options);
  }

  async function listDishReferenceImages(dishId) { return apiClient.listDishReferenceImages(dishId); }
  async function addDishReferenceImage(dishId, payload) { return apiClient.addDishReferenceImage(dishId, payload); }
  async function updateDishReferenceImage(referenceImageId, payload) { return apiClient.updateDishReferenceImage(referenceImageId, payload); }
  async function deleteDishReferenceImage(referenceImageId) { return apiClient.deleteDishReferenceImage(referenceImageId); }
  async function reindexDishReferenceImages(payload = {}) { return apiClient.reindexDishReferenceImages(payload); }
  async function listDishRecipes(dishId) { return apiClient.listDishRecipes(dishId); }
  async function createDishRecipe(dishId, payload) { return apiClient.createDishRecipe(dishId, payload); }

  async function askMealAdvisor(payload) {
    return apiClient.askMealAdvisor(payload);
  }

  async function runAgent(payload) {
    return apiClient.runAgent(payload);
  }

  async function runAgentStream(payload) {
    return apiClient.runAgentStream(payload);
  }

  async function loadAgentEvals() {
    return apiClient.agentEvals();
  }

  async function confirmAgentAction(id) {
    return apiClient.confirmAgentAction(id);
  }

  async function rejectAgentAction(id) {
    return apiClient.rejectAgentAction(id);
  }

  async function loadAgentEvents(sessionId) {
    return apiClient.agentEvents(sessionId);
  }

  async function loadAgentActions(status = 'pending') {
    return apiClient.listAgentActions(status);
  }

  async function loadAgentStream(sessionId) {
    return apiClient.agentStream(sessionId);
  }
  async function loadAgentMemory() {
    const result = await apiClient.agentMemory();
    agentMemory.value = result.memory;
    return result.memory;
  }

  async function saveAgentMemory(payload) {
    const result = await apiClient.saveAgentMemory(payload);
    agentMemory.value = result.memory;
    return result.memory;
  }

  async function clearAgentMemory() {
    const result = await apiClient.clearAgentMemory();
    agentMemory.value = result.memory;
    return result.memory;
  }

  async function loadAgentEvalCases() {
    const result = await apiClient.listAgentEvalCases();
    agentEvalCases.value = result.cases;
    return result.cases;
  }

  async function saveAgentEvalCase(payload) {
    const result = payload.id
      ? await apiClient.updateAgentEvalCase(payload.id, payload)
      : await apiClient.createAgentEvalCase(payload);
    const idx = agentEvalCases.value.findIndex((item) => item.id === result.case.id);
    if (idx === -1) agentEvalCases.value = [result.case, ...agentEvalCases.value];
    else agentEvalCases.value[idx] = result.case;
    return result.case;
  }

  async function deleteAgentEvalCase(id) {
    const result = await apiClient.deleteAgentEvalCase(id);
    agentEvalCases.value = agentEvalCases.value.filter((item) => item.id !== id);
    return result;
  }

  async function runAgentEvalCase(id) {
    const result = await apiClient.runAgentEvalCase(id);
    agentEvalRuns.value = [result.run, ...agentEvalRuns.value.filter((item) => item.id !== result.run.id)];
    return result.run;
  }

  async function loadDeploymentReadiness() {
    const result = await apiClient.deploymentReadiness();
    deploymentReadiness.value = result;
    return result;
  }

  async function loadRetrievalIndexStatus() {
    const result = await apiClient.getRetrievalIndexStatus();
    retrievalIndexStatus.value = result;
    return result;
  }

  async function rebuildRetrievalIndex(payload = {}) {
    const result = await apiClient.rebuildRetrievalIndex(payload);
    retrievalReindexResult.value = result;
    return result;
  }

  async function loadTodayMenu(mealType = state.value.profile.mealType) {
    const result = await apiClient.dishesSearch({ page: 1, pageSize: 50, reservationOnly: true, sort: 'rating_desc' });
    reservationCatalogPage.value = result.page || { page: 1, pageSize: 50, total: result.items?.length || 0, hasMore: false };
    todayMenu.value = { date: '', mealType, menus: [], dishes: result.items || [], source: 'stable_catalog' };
    mergeDishes(result.items || []);
    return todayMenu.value;
  }

  async function loadMoreTodayMenu(mealType = state.value.profile.mealType) {
    if (!reservationCatalogPage.value.hasMore) return todayMenu.value;
    const result = await apiClient.dishesSearch({ page: reservationCatalogPage.value.page + 1, pageSize: reservationCatalogPage.value.pageSize || 50, reservationOnly: true, sort: 'rating_desc' });
    const entities = new Map(todayMenu.value.dishes.map((dish) => [String(dish.id), dish]));
    for (const dish of result.items || []) entities.set(String(dish.id), dish);
    todayMenu.value = { date: '', mealType, menus: [], dishes: [...entities.values()], source: 'stable_catalog' };
    reservationCatalogPage.value = result.page;
    mergeDishes(result.items || []);
    return todayMenu.value;
  }

  async function createOrder(payload) {
    const result = await apiClient.createOrder(payload);
    orders.value = [result.order, ...orders.value.filter((order) => order.id !== result.order.id)];
    return result.order;
  }

  async function cancelOrder(id) {
    const result = await apiClient.cancelOrder(id);
    orders.value = orders.value.map((order) => order.id === id ? result.order : order);
    return result.order;
  }


  async function loadOrders() {
    const result = await apiClient.listOrders();
    orders.value = result.orders;
    return result.orders;
  }

  async function loadAdminOrders(status = '') {
    const result = await apiClient.listAdminOrders(status);
    adminOrders.value = result.orders;
    return result.orders;
  }

  async function updateOrderStatus(id, status) {
    const result = await apiClient.updateOrderStatus(id, status);
    adminOrders.value = adminOrders.value.map((order) => order.id === id ? result.order : order);
    return result.order;
  }

  async function confirmReservationPrice(id, finalAmount) {
    const result = await apiClient.confirmReservationPrice(id, { finalAmount });
    adminOrders.value = adminOrders.value.map((order) => order.id === id ? result.order : order);
    return result.order;
  }

  async function updateStallReservation(id, enabled) {
    const result = await apiClient.updateStallReservation(id, enabled);
    state.value.stalls = state.value.stalls.map((stall) => stall.id === id ? { ...stall, reservationEnabled: result.reservation.reservationEnabled } : stall);
    return result.reservation;
  }

  async function updateDishReservation(id, enabled) {
    const result = await apiClient.updateDishReservation(id, enabled);
    const existing = state.value.dishes.find((dish) => dish.id === id) || {};
    mergeDishes([{ ...existing, id, reservationEnabled: result.reservation.reservationEnabled }]);
    return result.reservation;
  }

  async function loadOrderAnalytics() {
    return apiClient.orderAnalytics();
  }

  const adminUsers = ref([]);
  const adminAuditLogs = ref([]);
  const adminAuditTotal = ref(0);
  const aiSettings = ref(null);
  const aiStatus = ref(null);
  const aiUsageLogs = ref([]);
  const aiUsageSummary = ref([]);
  const aiUsageTotal = ref(0);
  const aiQuotaStatus = ref({ quota: 0, used: 0, remaining: 0, period: '' });
  const adminTenants = ref([]);
  const adminMenus = ref([]);
  const adminAnalytics = ref({ dishes: 0, reviews: 0, users: 0, menus: 0, todayPublished: 0, avgRating: 0, recentDishes: [] });
  const adminReviews = ref([]);
  const adminReviewTotal = ref(0);
  const adminReviewAnalytics = ref({ total: 0, averageRating: 0, statusDistribution: { approved: 0, pending: 0, rejected: 0 }, ratingDistribution: {} });
  const studentReviews = ref([]);
  const studentReviewTotal = ref(0);
  const studentReviewSummary = ref({ averageRating: 0, dishReviews: 0, canteenReviews: 0 });
  const communityPosts = ref([]);
  const communityPostTotal = ref(0);
  const communityPostDraft = ref(null);
  const adminPosts = ref([]);
  const adminPostTotal = ref(0);
  const adminCommunityReports = ref([]);
  const adminCommunityReportTotal = ref(0);



  async function loadUsers() {
    const result = await apiClient.listUsers();
    adminUsers.value = result.users;
    return result.users;
  }

  async function updateUserRole(id, role) {
    const result = await apiClient.updateUserRole(id, role);
    const idx = adminUsers.value.findIndex((u) => u.id === id);
    if (idx !== -1) adminUsers.value[idx] = result.user;
    return result.user;
  }

  async function loadAuditLogs(limit, offset) {
    const result = await apiClient.listAuditLogs(limit, offset);
    adminAuditLogs.value = result.logs;
    adminAuditTotal.value = result.total;
    return result;
  }

  async function loadAiSettings() {
    const result = await apiClient.getAiSettings();
    aiSettings.value = result.settings;
    aiStatus.value = result.status;
    return result;
  }

  async function saveAiSettings(payload) {
    const result = await apiClient.saveAiSettings(payload);
    aiSettings.value = result.settings;
    aiStatus.value = result.status;
    return result;
  }

  async function clearAiSettings() {
    const result = await apiClient.clearAiSettings();
    aiSettings.value = result.settings;
    aiStatus.value = result.status;
    return result;
  }

  async function testAiSettings(payload) {
    return apiClient.testAiSettings(payload);
  }

  async function loadAiUsage(limit = 50, offset = 0) {
    const result = await apiClient.listAiUsage(limit, offset);
    aiUsageLogs.value = result.logs;
    aiUsageSummary.value = result.summary;
    aiUsageTotal.value = result.total;
    aiQuotaStatus.value = result.quota;
    return result;
  }

  async function loadTenants() {
    const result = await apiClient.listTenants();
    adminTenants.value = result.tenants;
    return result.tenants;
  }

  async function saveTenant(payload) {
    const result = await apiClient.saveTenant(payload);
    adminTenants.value = result.tenants;
    return result.tenants;
  }

  async function loadMenus() {
    const result = await apiClient.listMenus();
    adminMenus.value = result.menus;
    return result.menus;
  }

  async function saveMenu(payload) {
    const result = await apiClient.saveMenu(payload);
    adminMenus.value = result.menus;
    return result.menus;
  }

  async function archiveMenu(id) {
    const result = await apiClient.archiveMenu(id);
    adminMenus.value = result.menus;
    return result.menus;
  }

  async function batchMenuAction(ids, action) {
    const result = await apiClient.batchMenuAction(ids, action);
    adminMenus.value = result.menus;
    return result;
  }

  async function loadAnalytics() { const result = await apiClient.getAnalytics();
  adminAnalytics.value = result;
  return result; }
  
  async function loadDatabaseOverview() {
    return apiClient.getDatabaseOverview();
  }
  async function loadAdminCatalogTree(params = {}) {
    const result = await apiClient.getAdminCatalogTree(params);
    adminCatalogTree.value = result;
    return result;
  }
  async function loadAdminCatalogArea(params = {}) {
    const result = await apiClient.getAdminCatalogTree({ ...params, include: 'dishes' });
    const current = adminCatalogTree.value;
    const incomingRegion = result.regions?.[0];
    if (!current || !incomingRegion) return result;
    const regionIndex = current.regions.findIndex((region) => region.id === incomingRegion.id);
    if (regionIndex < 0) return result;
    const areaId = String(params.areaId || params.canteenId || '');
    const mergedRegion = { ...current.regions[regionIndex] };
    if (areaId) {
      const incomingArea = incomingRegion.canteens?.find((node) => node.canteen?.id === areaId);
      if (incomingArea) {
        mergedRegion.canteens = mergedRegion.canteens.map((node) => node.canteen?.id === areaId
          ? { ...incomingArea, detailsLoaded: true }
          : node);
      }
    } else {
      mergedRegion.canteens = (incomingRegion.canteens || []).map((node) => ({ ...node, detailsLoaded: true }));
      mergedRegion.directStalls = incomingRegion.directStalls || [];
    }
    adminCatalogTree.value = {
      ...current,
      regions: current.regions.map((region, index) => index === regionIndex ? mergedRegion : region)
    };
    return result;
  }
  async function loadAdminStallDishes(stallId, params = {}) {
    return apiClient.getAdminStallDishes(stallId, params);
  }
  const databaseEntities = ref([]);
  const databaseRows = ref([]);
  const databaseEntityMeta = ref(null);
  const databaseTotal = ref(0);

  async function loadDatabaseEntities() {
    const result = await apiClient.listDatabaseEntities();
    databaseEntities.value = result.entities;
    return result.entities;
  }

  async function loadDatabaseRows(entity, params = {}) {
    const result = await apiClient.listDatabaseRows(entity, params);
    databaseRows.value = result.rows;
    databaseEntityMeta.value = result.entity;
    databaseTotal.value = result.total;
    return result;
  }

  async function createDatabaseRow(entity, payload) { return apiClient.createDatabaseRow(entity, payload); }
  async function updateDatabaseRow(entity, id, payload) { return apiClient.updateDatabaseRow(entity, id, payload); }
  async function deleteDatabaseRow(entity, id) { return apiClient.deleteDatabaseRow(entity, id); }

  async function loadReviewsAdmin(limit = 50, offset = 0, status = '', filters = {}) {
    const result = await apiClient.listReviewsAdmin(limit, offset, status, filters);
    adminReviews.value = result.reviews;
    adminReviewTotal.value = result.total;
    return result;
  }

  async function loadReviewAnalytics() {
    const result = await apiClient.listReviewAnalytics();
    adminReviewAnalytics.value = result;
    return result;
  }

  async function loadStudentReviews(params = {}) {
    const result = await apiClient.listReviews(params);
    studentReviews.value = result.reviews || [];
    studentReviewTotal.value = Number(result.total || 0);
    studentReviewSummary.value = result.summary || { averageRating: 0, dishReviews: 0, canteenReviews: 0 };
    return result;
  }

  async function loadCommunityPosts(params = {}) {
    const result = await apiClient.listPosts(params);
    communityPosts.value = result.posts || [];
    communityPostTotal.value = Number(result.total || 0);
    return result;
  }

  async function createCommunityPost(payload) {
    const result = await apiClient.createPost(payload);
    communityPosts.value = [result.post, ...communityPosts.value.filter((post) => post.id !== result.post.id)];
    communityPostTotal.value += 1;
    return result;
  }

  function saveCommunityPostDraft(draft) { communityPostDraft.value = draft ? { ...draft } : null; }
  function clearCommunityPostDraft() { communityPostDraft.value = null; }

  async function reactToCommunityContent(type, id, reaction) {
    const result = await apiClient.reactToContent(type, id, reaction);
    const list = type === 'post' ? communityPosts : studentReviews;
    list.value = list.value.map((item) => item.id === id ? { ...item, engagement: result.engagement, viewerReaction: result.viewerReaction } : item);
    return result;
  }

  async function reportCommunityContent(type, id, payload = {}) {
    const result = await apiClient.reportContent(type, id, payload);
    const list = type === 'post' ? communityPosts : studentReviews;
    list.value = list.value.map((item) => item.id === id ? { ...item, viewerReported: true } : item);
    return result;
  }

  async function updateCommunityContent(type, id, payload) {
    const result = await apiClient.updateCommunityContent(type, id, payload);
    const updated = result[type];
    const list = type === 'post' ? communityPosts : studentReviews;
    list.value = list.value.map((item) => item.id === id ? { ...item, ...updated } : item);
    return updated;
  }

  async function deleteCommunityContent(type, id) {
    const result = await apiClient.deleteCommunityContent(type, id);
    if (type === 'post') {
      communityPosts.value = communityPosts.value.filter((item) => item.id !== id);
      communityPostTotal.value = Math.max(0, communityPostTotal.value - 1);
    } else {
      studentReviews.value = studentReviews.value.filter((item) => item.id !== id);
      studentReviewTotal.value = Math.max(0, studentReviewTotal.value - 1);
    }
    return result;
  }

  async function setCommunityArchive(type, id, archived) {
    const result = archived
      ? await apiClient.archiveCommunityContent(type, id)
      : await apiClient.restoreCommunityContent(type, id);
    const list = type === 'post' ? communityPosts : studentReviews;
    list.value = list.value.map((item) => item.id === id ? { ...item, status: result.status } : item);
    return result;
  }

  async function loadPostsAdmin(limit = 50, offset = 0, status = '', filters = {}) {
    const result = await apiClient.listAdminPosts(limit, offset, status, filters);
    adminPosts.value = result.posts || [];
    adminPostTotal.value = Number(result.total || 0);
    return result;
  }

  async function updatePostStatusAdmin(id, status) {
    const result = await apiClient.updatePostStatus(id, status);
    adminPosts.value = adminPosts.value.map((post) => post.id === id ? result.post : post);
    return result.post;
  }

  async function loadCommunityReports(params = {}) {
    const result = await apiClient.listCommunityReports(params);
    adminCommunityReports.value = result.reports || [];
    adminCommunityReportTotal.value = Number(result.total || 0);
    return result;
  }

  async function updateCommunityReport(id, status) {
    const result = await apiClient.updateCommunityReport(id, status);
    adminCommunityReports.value = adminCommunityReports.value.map((report) => report.id === id ? { ...report, status: result.status } : report);
    return result;
  }

  async function deleteReviewAdmin(id) {
    const result = await apiClient.deleteReview(id);
    adminReviews.value = adminReviews.value.filter((r) => r.id !== id);
    adminReviewTotal.value = Math.max(0, adminReviewTotal.value - 1);
    return result;
  }

  async function updateReviewStatusAdmin(id, status) {
    const result = await apiClient.updateReviewStatus(id, status);
    adminReviews.value = adminReviews.value.map((review) => review.id === id ? { ...review, status } : review);
    return result;
  }

  async function approveReviewAdmin(id) {
    return updateReviewStatusAdmin(id, 'approved');
  }

  async function rejectReviewAdmin(id) {
    return updateReviewStatusAdmin(id, 'rejected');
  }

  async function toggleFavorite(dishId) {
    const existing = state.value.dishPreferences.find((p) => p.dishId === dishId);
    const newFav = existing ? !existing.favorite : true;
    const result = await apiClient.updateDishPreference({ dishId, favorite: newFav });
    state.value.dishPreferences = result.preferences;
    return result.preferences;
  }

  async function markDishEaten(dishId) {
    const result = await apiClient.recordDishEaten(dishId);
    const idx = state.value.dishPreferences.findIndex((p) => p.dishId === dishId);
    if (idx === -1) state.value.dishPreferences = [...state.value.dishPreferences, result.preference];
    else state.value.dishPreferences = state.value.dishPreferences.map((p) => p.dishId === dishId ? result.preference : p);
    return result.preference;
  }

  async function recordDishDrawn(dishId) {
    const result = await apiClient.recordDishDrawn(dishId);
    const idx = state.value.dishPreferences.findIndex((p) => p.dishId === dishId);
    if (idx === -1) state.value.dishPreferences = [...state.value.dishPreferences, result.preference];
    else state.value.dishPreferences = state.value.dishPreferences.map((p) => p.dishId === dishId ? result.preference : p);
    return result.preference;
  }

  async function loadEnvironment() {
    const result = await apiClient.getEnvironment();
    adminEnvironment.value = result.environment;
    return result.environment;
  }

  async function saveEnvironment(payload) {
    const result = await apiClient.saveEnvironment(payload);
    adminEnvironment.value = result.environment;
    return result.environment;
  }

  // Legacy alias for fetchRecommendation used by existing views
  async function fetchRecommendation() {
    return loadRecommendation();
  }

  return {
    state,
    loading,
    error,
    searchFilters,
    user,
    canteens,
    stalls,
    dishes,
    profile,
    dishPreferences,
    searchedDishes,
    rankings,
    remoteRankings,
    catalogPage,
    reservationCatalogPage,
    savedCatalog,
    recommendation,
    todayMenu,
    orders,
    adminOrders,
    agentMemory,
    agentEvalCases,
    agentEvalRuns,
    deploymentReadiness,
    retrievalIndexStatus,
    retrievalReindexResult,
    dishSearchResult,
    dishSearchLoading,
    recommendationLoading,
    contextualRecommendation,
    adminEnvironment,
    load,
    login,
    register,
    phoneLogin,
    bindPhone,
    updatePublicProfile,
    sendVerificationCode,
    resetPassword,
    deferProfileOnboarding,
    logout,
    getDishDetail,
    addReview,
    saveProfile,
    upsertCanteen,
    deleteCanteen,
    upsertDish,
    deleteDish,
    upsertStall,
    deleteStall,
    importDishes,
    previewDishImport,
    confirmDishImport,
    uploadImage,
    identifyDishImage,
    analyzeMealImage,
    confirmMealVision,
    listDishReferenceImages,
    addDishReferenceImage,
    updateDishReferenceImage,
    deleteDishReferenceImage,
    reindexDishReferenceImages,
    listDishRecipes,
    createDishRecipe,
    ragSearch,
    askMealAdvisor,
    runAgent,
    runAgentStream,
    loadAgentEvals,
    confirmAgentAction,
    rejectAgentAction,
    loadAgentActions,
    loadAgentStream,
    loadAgentEvents,
    loadTodayMenu,
    loadMoreTodayMenu,
    loadAgentMemory,
    saveAgentMemory,
    clearAgentMemory,
    loadAgentEvalCases,
    saveAgentEvalCase,
    deleteAgentEvalCase,
    runAgentEvalCase,
    loadDeploymentReadiness,
    loadRetrievalIndexStatus,
    rebuildRetrievalIndex,
    searchDishes,
    prefetchSearchDishes,
    catalogCategories,
    catalogRegions,
    catalogRegionDetails,
    rankingMeta,
    adminCatalogOverview,
    loadCatalogCategories,
    loadCatalogDishes,
    prefetchCatalogDishes,
    loadMoreCatalog,
    fetchDishDetail,
    loadSavedCatalog,
    loadCatalogRanking,
    loadCatalogRegions,
    loadCatalogRegionDishes,
    loadAdminCatalogOverview,
    loadCommunityDishOptions,
    clearDishSearch,
    loadRecommendation,
    requestRecommendation,
    healthPlan,
    loadHealthPlan,
    fetchRecommendation,
    toggleFavorite,
    markDishEaten,
    recordDishDrawn,
    loadEnvironment,
    saveEnvironment,
    createOrder,
    cancelOrder,
    loadOrders,
    loadAdminOrders,
    updateOrderStatus,
    confirmReservationPrice,
    updateStallReservation,
    updateDishReservation,
    loadOrderAnalytics,
    adminUsers,
    adminAuditLogs,
    adminAuditTotal,
    aiSettings,
    aiStatus,
    aiUsageLogs,
    aiUsageSummary,
    aiUsageTotal,
    aiQuotaStatus,
    adminTenants,
    adminMenus,
    adminAnalytics,
    adminReviews,
    adminReviewTotal,
    adminReviewAnalytics,
    studentReviews,
    studentReviewTotal,
    studentReviewSummary,
    communityPosts,
    communityPostTotal,
    communityPostDraft,
    adminPosts,
    adminPostTotal,
    adminCommunityReports,
    adminCommunityReportTotal,
    loadUsers,
    updateUserRole,
    loadAuditLogs,
    loadAiSettings,
    saveAiSettings,
    clearAiSettings,
    testAiSettings,
    loadAiUsage,
    loadTenants,
    saveTenant,
    loadMenus,
    saveMenu,
    archiveMenu,
    batchMenuAction,
    loadAnalytics,
    databaseEntities,
    databaseRows,
    databaseEntityMeta,
    databaseTotal,
    loadDatabaseEntities,
    loadDatabaseRows,
    createDatabaseRow,
    updateDatabaseRow,
    deleteDatabaseRow,
    loadDatabaseOverview,
    adminCatalogTree,
    loadAdminCatalogTree,
    loadAdminCatalogArea,
    loadAdminStallDishes,
    loadReviewsAdmin,
    deleteReviewAdmin,
    updateReviewStatusAdmin,
    approveReviewAdmin,
    rejectReviewAdmin,
    loadReviewAnalytics,
    loadStudentReviews,
    loadCommunityPosts,
    createCommunityPost, reactToCommunityContent, reportCommunityContent, updateCommunityContent, deleteCommunityContent, setCommunityArchive,
    saveCommunityPostDraft, clearCommunityPostDraft,
    listPostComments: apiClient.listPostComments, createPostComment: apiClient.createPostComment,
    updatePostComment: apiClient.updatePostComment, deletePostComment: apiClient.deletePostComment, reportPostComment: apiClient.reportPostComment,
    loadPostsAdmin,
    updatePostStatusAdmin,
    loadCommunityReports,
    updateCommunityReport
  };
});
