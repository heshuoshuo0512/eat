<template>
  <section class="page-heading">
    <p class="eyebrow">健康档案 / 规则推荐</p>
    <h1>个性化餐单生成</h1>
    <p>企业级原则：推荐只能来自真实菜品库，AI 后续只负责解释，不凭空造菜。</p>
  </section>

  <section class="grid two-columns align-start">
    <form class="card profile-form" @submit.prevent="save">
      <div class="section-title">
        <p class="eyebrow">用户健康档案</p>
        <h2>推荐条件</h2>
      </div>
      <label>
        健康目标
        <select v-model="form.goal">
          <option value="fatLoss">减脂</option>
          <option value="muscleGain">增肌</option>
          <option value="maintain">维持体重</option>
          <option value="healthy">健康饮食</option>
        </select>
      </label>
      <label>
        就餐时间
        <select v-model="form.mealType">
          <option value="breakfast">早餐</option>
          <option value="lunch">午餐</option>
          <option value="dinner">晚餐</option>
        </select>
      </label>
      <label>
        预算上限 ¥{{ form.budgetMax }}
        <input v-model.number="form.budgetMax" type="range" min="8" max="35" />
      </label>
      <label>
        口味偏好
        <input v-model="form.taste" type="text" placeholder="例如：麻辣、酸甜、黑椒" />
      </label>
      <label>
        就餐地点
        <select v-model="selectedCanteenId">
          <option value="">全部食堂</option>
          <option v-for="canteen in store.canteens" :key="canteen.id" :value="canteen.id">{{ canteen.name }}</option>
        </select>
      </label>
      <label>
        营养侧重
        <select v-model="nutrientEmphasis">
          <option value="balanced">均衡</option>
          <option value="protein">高蛋白优先</option>
          <option value="carbs">高碳水优先</option>
          <option value="lowFat">低脂优先</option>
        </select>
      </label>
      <label>
        忌口食材
        <input v-model="avoidText" placeholder="例如：香菜, 牛肉" />
      </label>
      <label class="check-label">
        <input v-model="form.halalOnly" type="checkbox" />
        只推荐清真菜品
      </label>
      <button class="primary" type="submit">保存并生成推荐</button>
      <p v-if="message" class="form-message">{{ message }}</p>
    </form>

    <article class="card recommendation-card">
      <div class="section-title">
        <p class="eyebrow">推荐结果</p>
        <h2>{{ store.recommendation.goalLabel }} · {{ mealTypeLabel }}</h2>
        <span class="pill">{{ menuSourceLabel }}</span>
      </div>
      <p class="muted">{{ store.todayMenu.dishes.length ? `本次优先从 ${store.todayMenu.date} 已发布且未售罄的今日菜单中筛选。` : store.recommendation.reason }}</p>

      <div v-if="rerankedDishes.length" class="dish-list dense">
        <article v-for="dish in rerankedDishes" :key="dish.id" class="dish-row rich">
          <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="dish.name" class="dish-thumb" />
          <span v-else class="emoji large">{{ dish.image }}</span>
          <span class="dish-info">
            <strong>
              {{ dish.name }}
              <button class="fav-toggle" type="button" :aria-label="isFavorite(dish.id) ? '取消收藏' : '收藏'" @click.stop="toggleFavorite(dish)">{{ isFavorite(dish.id) ? '★' : '☆' }}</button>
            </strong>
            <small>{{ dish.tags.join(' / ') }}</small>
            <small>{{ dish.nutrition.calories }} kcal · 蛋白 {{ dish.nutrition.protein }}g · 脂肪 {{ dish.nutrition.fat }}g · 碳水 {{ dish.nutrition.carbs }}g · ¥{{ dish.price }}</small>
            <small v-if="dish.rating">{{ dish.rating.toFixed(1) }} 分{{ dish.reviewCount ? ` · ${dish.reviewCount} 条评价` : '' }} · <RouterLink class="text-link" :to="{ name: 'dishes', query: { dish: dish.id } }">查看详情/评价</RouterLink></small>
          </span>
          <span class="pill">{{ dish.recommendationScore }}</span>
        </article>
      </div>
      <div class="nutrition-grid totals">
        <span><strong>{{ displayedTotals.calories }}</strong><small>总 kcal</small></span>
        <span><strong>{{ displayedTotals.protein }}g</strong><small>蛋白</small></span>
        <span><strong>¥{{ displayedTotals.price }}</strong><small>合计</small></span>
      </div>
    </article>
  </section>

  <section class="card favorites-panel">
    <div class="section-title horizontal">
      <div>
        <p class="eyebrow">个人中心</p>
        <h2>收藏夹与常吃记录</h2>
      </div>
      <span class="pill">{{ userFavorites.length }} 个菜品</span>
    </div>
    <p v-if="!userFavorites.length" class="muted">还没有收藏。点击推荐菜品旁的 ☆，即可在这里保留常吃选择。</p>
    <div class="dish-list dense">
      <article v-for="fav in userFavorites" :key="fav.id" class="dish-row">
        <img v-if="fav.imageUrl" :src="fav.imageUrl" :alt="fav.name" class="dish-thumb" />
        <span v-else class="emoji">{{ fav.image }}</span>
        <span>
          <strong>{{ fav.name }}</strong>
          <small>{{ fav.tags.join(' / ') }}</small>
          <small>{{ fav.nutrition.calories }} kcal · 蛋白 {{ fav.nutrition.protein }}g · ¥{{ fav.price }}</small>
        </span>
        <button class="ghost" type="button" @click="removeFavorite(fav.id)">移除</button>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch, watchEffect } from 'vue';
import { RouterLink } from 'vue-router';
import { normalizeProfileInput } from '../domain/validation.js';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const form = reactive({ ...store.profile });
const avoidText = ref(store.profile.avoid.join(', '));
const message = ref('');
const selectedCanteenId = ref('');
const nutrientEmphasis = ref('balanced');

function favoritesKey() {
  return `sc-favorites-${store.user?.id || 'anon'}`;
}

function safeLoadFavorites() {
  try {
    const raw = localStorage.getItem(favoritesKey());
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string');
  } catch {
    return [];
  }
}

function safeSaveFavorites(list) {
  try { localStorage.setItem(favoritesKey(), JSON.stringify(list)); } catch { /* quota exceeded, ignore */ }
}

const userFavorites = ref(safeLoadFavorites());

watchEffect(() => { safeSaveFavorites(userFavorites.value); });

watch(() => store.profile, (profile) => {
  Object.assign(form, profile);
  avoidText.value = profile.avoid.join(', ');
}, { deep: true });

watch(() => store.canteens, (canteens) => {
  if (!selectedCanteenId.value && canteens.length) selectedCanteenId.value = '';
}, { immediate: true });

watch(() => store.user, () => { userFavorites.value = safeLoadFavorites(); });

const mealTypeLabel = computed(() => ({ breakfast: '早餐', lunch: '午餐', dinner: '晚餐' }[store.profile.mealType] || '午餐'));
const menuSourceLabel = computed(() => (store.todayMenu.dishes.length ? '今日供应优先' : '菜品库兜底'));

async function save() {
  try {
    const { selectedCanteenId: _loc, nutrientEmphasis: _nutr, ...profileFields } = form;
    await store.saveProfile(normalizeProfileInput(profileFields, avoidText.value));
    message.value = '健康档案已保存，推荐结果已更新。';
  } catch (error) {
    message.value = error.message;
  }
}

function isFavorite(dishId) {
  return userFavorites.value.some((item) => item.id === dishId);
}

function toggleFavorite(dish) {
  if (isFavorite(dish.id)) {
    userFavorites.value = userFavorites.value.filter((item) => item.id !== dish.id);
  } else {
    const fav = {
      id: dish.id,
      name: dish.name,
      image: dish.image,
      imageUrl: dish.imageUrl || '',
      price: dish.price,
      tags: Array.isArray(dish.tags) ? [...dish.tags] : [],
      nutrition: dish.nutrition ? { ...dish.nutrition } : { calories: 0, protein: 0, fat: 0, carbs: 0 },
      taste: dish.taste || ''
    };
    userFavorites.value = [fav, ...userFavorites.value.filter((item) => item.id !== dish.id)];
  }
}

function removeFavorite(dishId) {
  userFavorites.value = userFavorites.value.filter((item) => item.id !== dishId);
}

const filteredRecommendations = computed(() => {
  const base = store.recommendation.dishes;
  if (!selectedCanteenId.value) return base;
  const canteenId = selectedCanteenId.value;
  const filtered = base.filter((dish) => {
    const stall = store.stalls.find((s) => s.id === dish.stallId);
    return stall && stall.canteenId === canteenId;
  });
  return filtered.length ? filtered : base;
});

const rerankedDishes = computed(() => {
  const dishes = filteredRecommendations.value;
  if (!dishes.length || nutrientEmphasis.value === 'balanced') return dishes;
  return [...dishes].sort((a, b) => {
    const aProtein = a.nutrition.protein;
    const bProtein = b.nutrition.protein;
    const aCarbs = a.nutrition.carbs;
    const bCarbs = b.nutrition.carbs;
    const aFat = a.nutrition.fat;
    const bFat = b.nutrition.fat;
    if (nutrientEmphasis.value === 'protein') {
      return (bProtein - aProtein) || (b.recommendationScore - a.recommendationScore);
    }
    if (nutrientEmphasis.value === 'carbs') {
      return (bCarbs - aCarbs) || (b.recommendationScore - a.recommendationScore);
    }
    if (nutrientEmphasis.value === 'lowFat') {
      return (aFat - bFat) || (b.recommendationScore - a.recommendationScore);
    }
    return b.recommendationScore - a.recommendationScore;
  });
});

const displayedTotals = computed(() => rerankedDishes.value.reduce((totals, dish) => ({
  calories: totals.calories + Number(dish.nutrition?.calories || 0),
  protein: totals.protein + Number(dish.nutrition?.protein || 0),
  price: totals.price + Number(dish.price || 0)
}), { calories: 0, protein: 0, price: 0 }));
</script>
