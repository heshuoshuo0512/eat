import { computed, reactive, ref } from 'vue';
import { buildMealPlan, calculateRanking, normalizeProfile } from '../../src/domain/recommendation.js';
import { apiClient } from '../services/apiClient.js';

function emptyState() {
  return {
    session: { user: null },
    canteens: [],
    stalls: [],
    dishes: [],
    reviews: [],
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

const state = ref(emptyState());
const loading = ref(false);
const error = ref('');
const searchFilters = reactive({ keyword: '', maxPrice: 25, taste: '不限', halalOnly: false });
const todayMenu = ref({ date: '', mealType: 'lunch', menus: [], dishes: [], source: 'fallback' });

function setState(nextState) {
  state.value = { ...emptyState(), ...nextState, profile: normalizeProfile(nextState?.profile) };
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
const searchedDishes = computed(() => filterDishes(state.value.dishes, searchFilters));
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

async function login(payload) {
  const result = await apiClient.login(payload);
  setState(result.state);
  todayMenu.value = await apiClient.todayMenu(state.value.profile.mealType);
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

async function loadTodayMenu(mealType = state.value.profile.mealType) {
  todayMenu.value = await apiClient.todayMenu(mealType);
  return todayMenu.value;
}

export function useCanteenStore() {
  return {
    state,
    loading,
    error,
    searchFilters,
    todayMenu,
    user,
    canteens,
    stalls,
    dishes,
    profile,
    searchedDishes,
    rankings,
    recommendation,
    load,
    login,
    logout,
    getDishDetail,
    addReview,
    saveProfile,
    loadTodayMenu,
    ragSearch: apiClient.ragSearch,
    askMealAdvisor: apiClient.askMealAdvisor,
    analyzeMealImage: apiClient.analyzeMealImage
  };
}
