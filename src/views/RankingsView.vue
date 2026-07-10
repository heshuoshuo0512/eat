<template>
  <section class="page-heading">
    <p class="eyebrow">综合分 = 评分权重 70% + 评论热度 30%</p>
    <h1>校园食堂排行榜</h1>
    <p>分类查看菜品榜，档口榜和食堂榜独立展示，信息更清晰。</p>
  </section>

  <!-- Dish Rankings with category chips -->
  <section class="card rank-section">
    <div class="section-title">
      <p class="eyebrow">菜品排行</p>
      <h2>🏅 菜品榜</h2>
    </div>
    <p class="muted rank-explanation">基于综合评分（评分 70% + 热度 30%）排名，按分类筛选只影响菜品榜。</p>
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
    <div v-if="filteredDishes.length" class="rank-list">
      <div v-for="(dish, index) in filteredDishes" :key="dish.id" class="rank-row">
        <span class="rank-index" :class="{ 'rank-top': index < 3 }">{{ index + 1 }}</span>
        <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="dish.name" class="dish-thumb" />
        <span v-else class="emoji">{{ dish.image }}</span>
        <span class="rank-info">
          <strong>{{ dish.name }}</strong>
          <small class="location-label">{{ dishStallCanteen(dish) }}</small>
          <small>{{ (dish.computedRating || dish.rating || 0).toFixed(1) }} 分 · {{ dish.computedReviewCount || dish.reviewCount || 0 }} 条评价</small>
        </span>
        <div class="rank-actions">
          <b>{{ dish.rankScore }}</b>
          <RouterLink :to="{ path: '/dishes', query: { dish: dish.id } }" class="detail-link">查看详情</RouterLink>
        </div>
      </div>
    </div>
    <div v-else class="empty-state">
      <p>{{ selectedCategory === '全部' ? '暂无菜品数据。' : `"${selectedCategory}"分类暂无菜品。` }}</p>
    </div>
  </section>

  <!-- Stall Rankings -->
  <section class="card rank-section">
    <div class="section-title">
      <p class="eyebrow">档口排行</p>
      <h2>🏪 档口榜</h2>
    </div>
    <p class="muted rank-explanation">档口得分取其菜品综合分均值，包含所属食堂层级信息和在售菜品数量。</p>
    <div v-if="store.rankings.stalls.length" class="rank-list">
      <div v-for="(stall, index) in store.rankings.stalls" :key="stall.id" class="rank-row">
        <span class="rank-index" :class="{ 'rank-top': index < 3 }">{{ index + 1 }}</span>
        <span class="rank-info">
          <strong>{{ stall.name }}</strong>
          <small class="location-label">{{ stallCanteenPath(stall) }}</small>
          <small>{{ stall.category }} · {{ stall.dishCount }} 个菜品 · 人均 ¥{{ stall.avgPrice }}</small>
        </span>
        <b>{{ stall.rankScore }}</b>
      </div>
    </div>
    <div v-else class="empty-state">
      <p>暂无档口数据。</p>
    </div>
  </section>

  <!-- Canteen Rankings -->
  <section class="card rank-section">
    <div class="section-title">
      <p class="eyebrow">食堂排行</p>
      <h2>🏫 食堂榜</h2>
    </div>
    <p class="muted rank-explanation">食堂得分取其档口得分均值，展示档口数量和所属层级。</p>
    <div v-if="store.rankings.canteens.length" class="rank-list">
      <div v-for="(canteen, index) in store.rankings.canteens" :key="canteen.id" class="rank-row">
        <span class="rank-index" :class="{ 'rank-top': index < 3 }">{{ index + 1 }}</span>
        <span class="rank-info">
          <strong>{{ canteen.name }}</strong>
          <small class="location-label">{{ canteenHierarchyLabel(canteen) }}</small>
          <small>{{ canteen.location }} · {{ canteen.stallCount }} 个档口</small>
        </span>
        <b>{{ canteen.rankScore }}</b>
      </div>
    </div>
    <div v-else class="empty-state">
      <p>暂无食堂数据。</p>
    </div>
  </section>
</template>

<script setup>
import { ref, computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();

/* ── Dish category chips ── */
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
  if (selectedCategory.value === '全部') return ranked.slice(0, 8);
  return ranked.filter((d) => classifyDish(d) === selectedCategory.value).slice(0, 8);
});

/* ── Location hierarchy helpers ── */

function dishStallCanteen(dish) {
  const stall = store.stalls.find((s) => s.id === dish.stallId);
  if (!stall) return '未知档口';
  const canteen = store.canteens.find((c) => c.id === stall.canteenId);
  if (!canteen) return stall.name;
  const parent = store.canteens.find((c) => c.id === canteen.parentId);
  if (parent) return `${stall.name} · ${canteen.name} · ${parent.name}`;
  return `${stall.name} · ${canteen.name}`;
}

function stallCanteenPath(stall) {
  const canteen = store.canteens.find((c) => c.id === stall.canteenId);
  if (!canteen) return '未知食堂';
  const parent = store.canteens.find((c) => c.id === canteen.parentId);
  if (parent) return `${canteen.name} · ${parent.name}`;
  return canteen.name;
}

function canteenHierarchyLabel(canteen) {
  if (canteen.canteenType === 'primary') return '主食堂';
  if (canteen.canteenType === 'sub') {
    const parent = store.canteens.find((c) => c.id === canteen.parentId);
    return parent ? `${parent.name} 分区` : '分区食堂';
  }
  if (canteen.parentId) {
    const parent = store.canteens.find((c) => c.id === canteen.parentId);
    return parent ? `${parent.name} 分区` : '分区食堂';
  }
  return canteen.location || '';
}
</script>

<style scoped>
.rank-section { margin-bottom: 24px; }
.rank-section:last-child { margin-bottom: 0; }
.rank-explanation { margin: 4px 0 14px; font-size: 13px; }

.category-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.filter-btn {
  padding: 6px 16px;
  border: 1px solid var(--border, #ddd);
  border-radius: 20px;
  background: var(--bg-primary, #fff);
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.18s;
}

.filter-btn:hover {
  background: var(--bg-hover, #f0f0f0);
}

.filter-btn.active {
  background: var(--accent, #1f7a4d);
  color: #fff;
  border-color: var(--accent, #1f7a4d);
}

.rank-list { display: flex; flex-direction: column; gap: 8px; }

.rank-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(255,255,255,.72), rgba(255,255,255,.48));
  border: 1px solid rgba(255,255,255,.6);
  transition: background .15s;
}
.rank-row:hover { background: rgba(235,247,229,.5); }

.rank-index {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(0,0,0,.05);
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary, #666);
  flex-shrink: 0;
}
.rank-top {
  background: linear-gradient(135deg, #ffd700, #ffb800);
  color: #5a3e00;
}

.dish-thumb {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 10px;
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
  color: var(--accent, #1f7a4d);
  font-weight: 500;
  font-size: 0.8rem;
}

.rank-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.detail-link {
  font-size: 0.75rem;
  color: var(--accent, #1f7a4d);
  text-decoration: none;
  white-space: nowrap;
}

.detail-link:hover {
  text-decoration: underline;
}

.empty-state {
  padding: 28px;
  text-align: center;
  color: var(--text-secondary, #888);
}

/* Mobile */
@media (max-width: 640px) {
  .rank-row { padding: 10px; gap: 8px; }
  .rank-index { width: 24px; height: 24px; font-size: 12px; }
  .dish-thumb { width: 40px; height: 40px; }
}
</style>
