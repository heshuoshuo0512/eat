<template>
  <section class="page-heading">
    <p class="eyebrow">检索 / 筛选 / 评价</p>
    <h1>菜品多维查询</h1>
    <p>按名称、食材、口味、价格和清真条件筛选真实可买到的菜。</p>
  </section>

  <section class="card filter-bar">
    <label>
      搜索
      <input v-model="store.searchFilters.keyword" placeholder="鸡肉 / 清真 / 高蛋白" />
    </label>
    <label>
      最高价格 ¥{{ store.searchFilters.maxPrice }}
      <input v-model.number="store.searchFilters.maxPrice" type="range" min="1" max="30" />
    </label>
    <label>
      口味
      <input v-model="store.searchFilters.taste" placeholder="不限 / 麻辣 / 酸甜" list="taste-suggestions" @blur="normalizeTaste" />
      <datalist id="taste-suggestions">
        <option>不限</option>
        <option>黑椒</option>
        <option>酸甜</option>
        <option>咸鲜</option>
        <option>清爽</option>
        <option>麻辣</option>
      </datalist>
    </label>
    <label class="check-label">
      <input v-model="store.searchFilters.halalOnly" type="checkbox" />
      只看清真
    </label>
  </section>

  <p v-if="stallFilter" class="stall-banner">
    正在查看：<strong>{{ stallFilterName }}</strong> 的菜品
    <button class="text-link" type="button" @click="clearStallFilter">查看全部</button>
  </p>

  <div class="sort-bar">
    <button class="pill sort-btn" :class="{ active: sortDir === 'desc' }" type="button" @click="sortDir = 'desc'">评分高→低</button>
    <button class="pill sort-btn" :class="{ active: sortDir === 'asc' }" type="button" @click="sortDir = 'asc'">评分低→高</button>
  </div>

  <section class="dish-layout">
    <div class="dish-list">
      <button v-for="dish in sortedDishes" :key="dish.id" class="dish-card" type="button" @click="selectDish(dish.id)">
        <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="dish.name" class="dish-thumb" />
        <span v-else class="emoji large">{{ dish.image }}</span>
        <span>
          <strong>{{ dish.name }}</strong>
          <small>{{ dish.cuisine }} · {{ dish.taste }} · ¥{{ dish.price }}</small>
          <small>{{ dish.nutrition.calories }} kcal · 蛋白 {{ dish.nutrition.protein }}g · 脂肪 {{ dish.nutrition.fat }}g · 碳水 {{ dish.nutrition.carbs }}g</small>
        </span>
        <span class="rating">{{ dish.rating.toFixed(1) }}</span>
      </button>
      <p v-if="!sortedDishes.length" class="muted" style="padding:18px;text-align:center;">没有匹配的菜品，试试调整筛选条件。</p>
    </div>

    <aside v-if="detail" class="card detail-panel">
      <div class="section-title">
        <p class="eyebrow">菜品详情</p>
        <h2>{{ detail.name }}</h2>
      </div>
      <div v-if="detail.imageUrl" class="vision-preview" style="max-width:100%;margin-bottom:12px;">
        <img :src="detail.imageUrl" :alt="detail.name" />
      </div>
      <span v-else class="emoji large" style="display:block;margin-bottom:12px;">{{ detail.image }}</span>
      <p class="muted">{{ detail.description }}</p>
      <div class="meta-row">
        <span class="pill">{{ detail.canteen?.name }}</span>
        <span class="pill">{{ detail.stall?.name }}</span>
        <span class="pill">¥{{ detail.price }}</span>
      </div>
      <div class="nutrition-grid">
        <span><strong>{{ detail.nutrition.calories }}</strong><small>kcal</small></span>
        <span><strong>{{ detail.nutrition.protein }}g</strong><small>蛋白</small></span>
        <span><strong>{{ detail.nutrition.fat }}g</strong><small>脂肪</small></span>
        <span><strong>{{ detail.nutrition.carbs }}g</strong><small>碳水</small></span>
      </div>
      <div class="tag-row">
        <span v-for="tag in detail.tags" :key="tag" class="pill">{{ tag }}</span>
      </div>

      <form class="review-form" @submit.prevent="submitReview">
        <h3>发布评价</h3>
        <select v-model.number="review.rating" aria-label="评分">
          <option :value="5">5 分</option>
          <option :value="4">4 分</option>
          <option :value="3">3 分</option>
          <option :value="2">2 分</option>
          <option :value="1">1 分</option>
        </select>
        <textarea v-model="review.content" placeholder="写下真实体验" />
        <button class="primary" type="submit">提交评价</button>
        <p v-if="message" class="form-message">{{ message }}</p>
      </form>

      <button class="pill sort-btn" type="button" @click="jumpToReviews" style="margin-top:8px;">查看评价列表 ↓</button>

      <div ref="reviewSection" class="reviews">
        <h3>评价列表</h3>
        <article v-for="item in detail.reviews" :key="item.id" class="review-row">
          <div v-if="item.imageUrl" class="review-photo">
            <img :src="item.imageUrl" :alt="item.user + '的评价图片'" />
          </div>
          <div>
            <strong>{{ item.user }} · {{ item.rating }} 分</strong>
            <p>{{ item.content }}</p>
            <small>{{ item.createdAt }}</small>
          </div>
        </article>
        <p v-if="!detail.reviews?.length" class="muted">暂无评价，快来抢先点评吧。</p>
      </div>
    </aside>
  </section>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch, watchEffect } from 'vue';
import { useRoute } from 'vue-router';
import { validateReviewForm } from '../domain/validation.js';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const route = useRoute();

const stallFilter = ref(route.query.stall || '');
const selectedId = ref(route.query.dish || store.searchedDishes[0]?.id);
const sortDir = ref('desc');
const review = reactive({ rating: 5, content: '' });
const message = ref('');
const reviewSection = ref(null);

const stallFilterName = computed(() => store.stalls.find((s) => s.id === stallFilter.value)?.name || '');

const filteredDishes = computed(() => {
  if (!stallFilter.value) return store.searchedDishes;
  return store.searchedDishes.filter((d) => d.stallId === stallFilter.value);
});

const sortedDishes = computed(() => {
  const list = [...filteredDishes.value];
  list.sort((a, b) => sortDir.value === 'desc' ? b.rating - a.rating : a.rating - b.rating);
  return list;
});

const detail = computed(() => {
  store.state;
  return store.getDishDetail(selectedId.value);
});

watchEffect(() => {
  if (!filteredDishes.value.some((dish) => dish.id === selectedId.value)) {
    selectedId.value = filteredDishes.value[0]?.id;
  }
});

watch(() => route.query.stall, (val) => {
  stallFilter.value = val || '';
});

watch(() => route.query.dish, (val) => {
  if (val) selectedId.value = val;
});

function selectDish(id) {
  selectedId.value = id;
}

function clearStallFilter() {
  stallFilter.value = '';
}

function normalizeTaste() {
  if (!store.searchFilters.taste.trim()) store.searchFilters.taste = '不限';
}

function jumpToReviews() {
  nextTick(() => {
    reviewSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

async function submitReview() {
  message.value = validateReviewForm({ targetId: selectedId.value, rating: review.rating, content: review.content });
  if (message.value) return;
  try {
    await store.addReview({ targetId: selectedId.value, rating: review.rating, content: review.content });
    review.content = '';
    message.value = '评价已保存，排行榜会同步更新。';
  } catch (error) {
    message.value = error.message;
  }
}
</script>

<style scoped>
.stall-banner { display: flex; align-items: center; gap: 10px; padding: 12px 18px; margin-bottom: 14px; border-radius: 18px; background: linear-gradient(135deg, rgba(31,122,77,.1), rgba(255,255,255,.68)); border: 1px solid rgba(31,122,77,.14); font-size: 14px; }
.sort-bar { display: flex; gap: 8px; margin-bottom: 14px; }
.sort-btn { cursor: pointer; border: 1px solid rgba(255,255,255,.62); background: linear-gradient(135deg, rgba(255,255,255,.78), rgba(255,255,255,.56)); transition: border-color .18s, box-shadow .18s; }
.sort-btn.active { border-color: rgba(31,122,77,.32); box-shadow: 0 0 0 2px rgba(31,122,77,.12); }
.dish-thumb { width: 56px; height: 56px; border-radius: 16px; object-fit: cover; flex-shrink: 0; border: 1px solid rgba(255,255,255,.62); }
.review-photo { overflow: hidden; border-radius: 16px; border: 1px solid rgba(255,255,255,.62); flex-shrink: 0; }
.review-photo img { display: block; width: 72px; height: 72px; object-fit: cover; }
</style>
