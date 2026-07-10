<template>
  <section class="page-heading">
    <p class="eyebrow">平均评分 × 评论热度</p>
    <h1>校园食堂排行榜</h1>
    <p>MVP 使用综合分：评分权重 70% + 评论热度权重 30%。</p>
  </section>

  <section class="card">
    <div class="section-title">
      <p class="eyebrow">菜品分类筛选</p>
      <h2>按类别查看</h2>
    </div>
    <div class="category-filter">
      <button
        v-for="cat in dishCategories"
        :key="cat"
        :class="['filter-btn', { active: selectedCategory === cat }]"
        @click="selectedCategory = cat"
      >
        {{ cat }}
      </button>
    </div>
  </section>

  <section class="grid three-columns">
    <article class="card rank-column">
      <h2>菜品榜</h2>
      <div v-if="filteredDishes.length === 0" class="empty-state">
        <p>该分类暂无菜品</p>
      </div>
      <div v-for="(dish, index) in filteredDishes" :key="dish.id" class="rank-row">
        <span class="rank-index">{{ index + 1 }}</span>
        <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="dish.name" class="dish-thumb" />
        <span v-else class="emoji">{{ dish.image }}</span>
        <span class="rank-info">
          <strong>{{ dish.name }}</strong>
          <small class="location-label">{{ dishStallCanteen(dish) }}</small>
          <small>{{ dish.computedRating.toFixed(1) }} 分 · {{ dish.computedReviewCount }} 条评价</small>
        </span>
        <div class="rank-actions">
          <b>{{ dish.rankScore }}</b>
          <RouterLink :to="{ path: '/dishes', query: { dish: dish.id } }" class="detail-link">查看详情</RouterLink>
        </div>
      </div>
    </article>

    <article class="card rank-column">
      <h2>档口榜</h2>
      <div v-for="(stall, index) in store.rankings.stalls" :key="stall.id" class="rank-row">
        <span class="rank-index">{{ index + 1 }}</span>
        <span class="rank-info">
          <strong>{{ stall.name }}</strong>
          <small class="location-label">{{ stallCanteen(stall) }}</small>
          <small>{{ stall.category }} · {{ stall.dishCount }} 个菜品</small>
        </span>
        <b>{{ stall.rankScore }}</b>
      </div>
    </article>

    <article class="card rank-column">
      <h2>食堂榜</h2>
      <div v-for="(canteen, index) in store.rankings.canteens" :key="canteen.id" class="rank-row">
        <span class="rank-index">{{ index + 1 }}</span>
        <span class="rank-info">
          <strong>{{ canteen.name }}</strong>
          <small>{{ canteen.location }} · {{ canteen.stallCount }} 个档口</small>
        </span>
        <b>{{ canteen.rankScore }}</b>
      </div>
    </article>
  </section>
</template>

<script setup>
import { ref, computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();

const dishCategories = ['全部', '饭', '面', '粉', '汉堡', '饮品'];
const selectedCategory = ref('全部');

function classifyDish(dish) {
  const name = dish.name || '';
  const cuisine = dish.cuisine || '';
  const tags = (dish.tags || []).join(' ');
  const text = `${name} ${cuisine} ${tags}`;
  if (/面|拉面|拌面|刀削/.test(text)) return '面';
  if (/粉|米粉|河粉|螺蛳/.test(text)) return '粉';
  if (/汉堡|burger/i.test(text)) return '汉堡';
  if (/饮|奶|茶|果汁|咖啡|豆浆/.test(text)) return '饮品';
  if (/饭|盖饭|炒饭|拌饭|粥|碗|套餐|饭/.test(text)) return '饭';
  return '其他';
}

const filteredDishes = computed(() => {
  const ranked = store.rankings.dishes;
  if (selectedCategory.value === '全部') return ranked.slice(0, 6);
  return ranked.filter(d => classifyDish(d) === selectedCategory.value).slice(0, 6);
});

function dishStallCanteen(dish) {
  const stall = store.stalls.find(s => s.id === dish.stallId);
  if (!stall) return '未知档口';
  const canteen = store.canteens.find(c => c.id === stall.canteenId);
  return canteen ? `${stall.name} · ${canteen.name}` : stall.name;
}

function stallCanteen(stall) {
  const canteen = store.canteens.find(c => c.id === stall.canteenId);
  return canteen ? canteen.name : '未知食堂';
}
</script>

<style scoped>
.category-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.filter-btn {
  padding: 6px 16px;
  border: 1px solid var(--border, #ddd);
  border-radius: 20px;
  background: var(--bg-primary, #fff);
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s;
}

.filter-btn:hover {
  background: var(--bg-hover, #f0f0f0);
}

.filter-btn.active {
  background: var(--accent, #4a90d9);
  color: #fff;
  border-color: var(--accent, #4a90d9);
}

.dish-thumb {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
}

.rank-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.location-label {
  color: var(--accent, #4a90d9);
  font-weight: 500;
  font-size: 0.8rem;
}

.rank-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.detail-link {
  font-size: 0.75rem;
  color: var(--accent, #4a90d9);
  text-decoration: none;
  white-space: nowrap;
}

.detail-link:hover {
  text-decoration: underline;
}

.empty-state {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary, #888);
}
</style>
