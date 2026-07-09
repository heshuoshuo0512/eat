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
      <input v-model.number="store.searchFilters.maxPrice" type="range" min="8" max="30" />
    </label>
    <label>
      口味
      <select v-model="store.searchFilters.taste">
        <option>不限</option>
        <option>黑椒</option>
        <option>酸甜</option>
        <option>咸鲜</option>
        <option>清爽</option>
        <option>麻辣</option>
      </select>
    </label>
    <label class="check-label">
      <input v-model="store.searchFilters.halalOnly" type="checkbox" />
      只看清真
    </label>
  </section>

  <section class="dish-layout">
    <div class="dish-list">
      <button v-for="dish in store.searchedDishes" :key="dish.id" class="dish-card" type="button" @click="selectedId = dish.id">
        <span class="emoji large">{{ dish.image }}</span>
        <span>
          <strong>{{ dish.name }}</strong>
          <small>{{ dish.cuisine }} · {{ dish.taste }} · ¥{{ dish.price }}</small>
          <small>{{ dish.nutrition.calories }} kcal · P {{ dish.nutrition.protein }}g · F {{ dish.nutrition.fat }}g · C {{ dish.nutrition.carbs }}g</small>
        </span>
        <span class="rating">{{ dish.rating.toFixed(1) }}</span>
      </button>
    </div>

    <aside class="card detail-panel" v-if="detail">
      <div class="section-title">
        <p class="eyebrow">菜品详情</p>
        <h2>{{ detail.image }} {{ detail.name }}</h2>
      </div>
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

      <div class="reviews">
        <h3>评价列表</h3>
        <article v-for="item in detail.reviews" :key="item.id" class="review-row">
          <strong>{{ item.user }} · {{ item.rating }} 分</strong>
          <p>{{ item.content }}</p>
          <small>{{ item.createdAt }}</small>
        </article>
      </div>
    </aside>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watchEffect } from 'vue';
import { validateReviewForm } from '../domain/validation.js';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const selectedId = ref(store.searchedDishes[0]?.id);
const review = reactive({ rating: 5, content: '' });
const message = ref('');
const detail = computed(() => {
  store.state;
  return store.getDishDetail(selectedId.value);
});

watchEffect(() => {
  if (!store.searchedDishes.some((dish) => dish.id === selectedId.value)) {
    selectedId.value = store.searchedDishes[0]?.id;
  }
});

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
