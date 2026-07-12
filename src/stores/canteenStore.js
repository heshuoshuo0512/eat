import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { buildMealPlan, calculateRanking, contextualRankDishes, normalizeProfile } from '../domain/recommendation.js';
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

  const orders = ref([]);
  const adminOrders = ref([]);
  const agentMemory = ref({ summary: '', preferences: {} });
  const agentEvalCases = ref([]);
  const agentEvalRuns = ref([]);
  const deploymentReadiness = ref(null);
  const contextualRecommendation = ref({ ranked: [], plan: null, context: null, source: null, menu: null, error: null });
  const healthPlan = ref(null);
  const adminEnvironment = ref(null);

  function setState(nextState) {
    state.value = { ...emptyState(), ...nextState, profile: normalizeProfile(nextState?.profile) };
    if (nextState?.dishPreferences) state.value.dishPreferences = nextState.dishPreferences;
  }

  async function load() {
    loading.value = true;
    error.value = '';
    try {
      setState(await apiClient.bootstrap());
      todayMenu.value = await apiClient.todayMenu(state.value.profile.mealType);
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
  const rankings = computed(() => {
    const reviewsByTarget = new Map();
    for (const review of state.value.reviews) {
      reviewsByTarget.set(review.targetId, [...(reviewsByTarget.get(review.targetId) || []), review]);
    }
    const rankedDishes = calculateRanking(state.value.dishes, reviewsByTarget);
    const rankedStalls = state.value.stalls.map((stall) => {
      const stallDishes = rankedDishes.filter((dish) => dish.stallId === stall.id);
      const rankScore = stallDishes.length ? stallDishes.reduce((sum, dish) => sum + dish.rankScore, 0) / stallDishes.length : stall.rating;
      return { ...stall, rankScore: Number(rankScore.toFixed(2)), dishCount: stallDishes.length };
    }).sort((left, right) => right.rankScore - left.rankScore);
    const rankedCanteens = state.value.canteens.map((canteen) => {
      const canteenStalls = rankedStalls.filter((stall) => stall.canteenId === canteen.id);
      const rankScore = canteenStalls.length ? canteenStalls.reduce((sum, stall) => sum + stall.rankScore, 0) / canteenStalls.length : 0;
      return { ...canteen, rankScore: Number(rankScore.toFixed(2)), stallCount: canteenStalls.length };
    }).sort((left, right) => right.rankScore - left.rankScore);
    return { dishes: rankedDishes, stalls: rankedStalls, canteens: rankedCanteens };
  });
  const recommendation = computed(() => buildMealPlan(todayMenu.value.dishes.length ? todayMenu.value.dishes : state.value.dishes, state.value.profile));

  async function loadRecommendation() {
    try {
      const result = await apiClient.loadRecommendation();
      contextualRecommendation.value = {
        ranked: result.dishes || result.ranked || result.picks || [],
        plan: result.plan || { goalLabel: result.goalLabel, totals: result.totals, reason: result.reason },
        context: result.context || result.reason || null,
        source: result.source || null,
        menu: result.menu || null,
        goalLabel: result.goalLabel || result.plan?.goalLabel || null,
        totals: result.totals || result.plan?.totals || null,
        error: null
      };
      return contextualRecommendation.value;
    } catch (error) {
      contextualRecommendation.value = {
        ranked: [],
        plan: null,
        context: null,
        source: null,
        menu: null,
        goalLabel: null,
        totals: null,
        error: error?.message || '推荐请求失败，请稍后重试。'
      };
      return contextualRecommendation.value;
    }
  }
  async function loadHealthPlan(days = 1) {
    healthPlan.value = await apiClient.healthPlan(days);
    return healthPlan.value;
  }

  async function login(payload) {
    const result = await apiClient.login(payload);
    setState(result.state);
    return result.user;
  }

  async function register(payload) {
    const result = await apiClient.register(payload);
    setState(result.state);
    return result.user;
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
    setState(result.state);
    todayMenu.value = await apiClient.todayMenu(state.value.profile.mealType);
    return result.profile;
  }

  async function upsertCanteen(payload) {
    setState(await apiClient.upsertCanteen(payload));
  }

  async function deleteCanteen(id) {
    setState(await apiClient.deleteCanteen(id));
  }

  async function upsertDish(payload) {
    setState(await apiClient.upsertDish(payload));
  }

  async function deleteDish(id) {
    setState(await apiClient.deleteDish(id));
  }

  async function upsertStall(payload) {
    setState(await apiClient.upsertStall(payload));
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

  async function loadTodayMenu(mealType = state.value.profile.mealType) {
    todayMenu.value = await apiClient.todayMenu(mealType);
    return todayMenu.value;
  }

  async function createOrder(payload) {
    const result = await apiClient.createOrder(payload);
    orders.value = [result.order, ...orders.value.filter((order) => order.id !== result.order.id)];
    todayMenu.value = await apiClient.todayMenu(state.value.profile.mealType);
    return result.order;
  }

  async function payOrder(id) {
    const result = await apiClient.payOrder(id);
    orders.value = orders.value.map((order) => order.id === id ? result.order : order);
    return result.order;
  }

  async function cancelOrder(id) {
    const result = await apiClient.cancelOrder(id);
    orders.value = orders.value.map((order) => order.id === id ? result.order : order);
    todayMenu.value = await apiClient.todayMenu(state.value.profile.mealType);
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

  async function loadReviewsAdmin(limit = 50, offset = 0, status = '') {
    const result = await apiClient.listReviewsAdmin(limit, offset, status);
    adminReviews.value = result.reviews;
    adminReviewTotal.value = result.total;
    return result;
  }

  async function loadReviewAnalytics() {
    const result = await apiClient.listReviewAnalytics();
    adminReviewAnalytics.value = result;
    return result;
  }

  async function deleteReviewAdmin(id) {
    const result = await apiClient.deleteReview(id);
    adminReviews.value = adminReviews.value.filter((r) => r.id !== id);
    adminReviewTotal.value = Math.max(0, adminReviewTotal.value - 1);
    return result;
  }

  async function approveReviewAdmin(id) {
    const result = await apiClient.updateReviewStatus(id, 'approved');
    adminReviews.value = adminReviews.value.map((r) => r.id === id ? { ...r, status: 'approved' } : r);
    return result;
  }

  async function rejectReviewAdmin(id) {
    const result = await apiClient.updateReviewStatus(id, 'rejected');
    adminReviews.value = adminReviews.value.map((r) => r.id === id ? { ...r, status: 'rejected' } : r);
    return result;
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
    recommendation,
    todayMenu,
    orders,
    adminOrders,
    agentMemory,
    agentEvalCases,
    agentEvalRuns,
    deploymentReadiness,
    contextualRecommendation,
    adminEnvironment,
    load,
    login,
    register,
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
    loadAgentMemory,
    saveAgentMemory,
    clearAgentMemory,
    loadAgentEvalCases,
    saveAgentEvalCase,
    deleteAgentEvalCase,
    runAgentEvalCase,
    loadDeploymentReadiness,
    loadRecommendation,
    healthPlan,
    loadHealthPlan,
    fetchRecommendation,
    toggleFavorite,
    markDishEaten,
    recordDishDrawn,
    loadEnvironment,
    saveEnvironment,
    createOrder,
    payOrder,
    cancelOrder,
    loadOrders,
    loadAdminOrders,
    updateOrderStatus,
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
    loadReviewsAdmin,
    deleteReviewAdmin,
    approveReviewAdmin,
    rejectReviewAdmin,
    loadReviewAnalytics
  };
});
