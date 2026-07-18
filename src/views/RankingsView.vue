<template>
  <section class="page-heading">
    <p class="eyebrow">数据排行</p>
    <h1>全站排行榜</h1>
    <p class="muted">基于综合评分（评分 70% + 热度 30%）实时排名，涵盖菜品、档口、食堂三大维度。</p>
  </section>

  <div class="rankings-grid">
    <!-- ── Dish Rankings ── -->
    <section class="card rank-card" :class="{ 'is-expanded': expandedSection === 'dishes' }">
      <div class="rank-card-header" @click="toggleSection('dishes')" role="button" tabindex="0" @keydown.enter="toggleSection('dishes')">
        <div>
          <p class="eyebrow">菜品排行</p>
          <h2>菜品乐榜</h2>
        </div>
        <span class="expand-indicator">{{ expandedSection === 'dishes' ? '▾' : '▸' }}</span>
      </div>

      <!-- Collapsed: top 3 preview -->
      <div v-if="expandedSection !== 'dishes'" class="rank-preview">
        <div v-for="(dish, i) in filteredDishes.slice(0, 3)" :key="dish.id" class="preview-item">
          <span class="preview-rank">{{ i + 1 }}</span>
          <span class="preview-name">{{ dish.name }}</span>
          <span class="preview-score">{{ dish.rankScore }}</span>
        </div>
        <p v-if="filteredDishes.length === 0" class="preview-empty">暂无数据</p>
      </div>

      <!-- Expanded: full list with category filter -->
      <template v-if="expandedSection === 'dishes'">
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
          <div
            v-for="(dish, i) in filteredDishes"
            :key="dish.id"
            class="rank-item"
          >
            <span class="rank-badge" :class="{ 'badge-top': i < 3, 'badge-gold': i === 0, 'badge-silver': i === 1, 'badge-bronze': i === 2 }">{{ i + 1 }}</span>
            <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="dish.name" class="rank-thumb" />
            <span v-else class="rank-emoji">{{ dish.image }}</span>
            <div class="rank-body">
              <strong class="rank-name">{{ dish.name }}</strong>
              <div class="rank-meta">
                <span class="meta-price">¥{{ dish.price }}</span>
                <span class="meta-dot">·</span>
                <span>{{ dish.taste }}</span>
                <span class="meta-dot">·</span>
                <span>{{ dish.nutrition?.calories || '—' }} kcal</span>
              </div>
              <small class="rank-path">{{ dishLocationPath(dish) }}</small>
            </div>
            <span class="rank-score">{{ dish.rankScore }}</span>
          </div>
        </div>
        <div v-else class="empty-state">
          <p>{{ selectedCategory === '全部' ? '暂无菜品数据。' : `"${selectedCategory}"分类暂无菜品。` }}</p>
        </div>
      </template>
    </section>

    <!-- ── Stall Rankings ── -->
    <section class="card rank-card" :class="{ 'is-expanded': expandedSection === 'stalls' }">
      <div class="rank-card-header" @click="toggleSection('stalls')" role="button" tabindex="0" @keydown.enter="toggleSection('stalls')">
        <div>
          <p class="eyebrow">档口排行</p>
          <h2>档口口碑</h2>
        </div>
        <span class="expand-indicator">{{ expandedSection === 'stalls' ? '▾' : '▸' }}</span>
      </div>

      <!-- Collapsed: top 3 preview -->
      <div v-if="expandedSection !== 'stalls'" class="rank-preview">
        <div v-for="(stall, i) in rankedStalls.slice(0, 3)" :key="stall.id" class="preview-item">
          <span class="preview-rank">{{ i + 1 }}</span>
          <span class="preview-name">{{ stall.name }}</span>
          <span class="preview-score">{{ stall.rankScore }}</span>
        </div>
        <p v-if="rankedStalls.length === 0" class="preview-empty">暂无数据</p>
      </div>

      <!-- Expanded: full list -->
      <template v-if="expandedSection === 'stalls'">
        <div v-if="rankedStalls.length" class="rank-list">
          <div
            v-for="(stall, i) in rankedStalls"
            :key="stall.id"
            class="rank-item"
          >
            <span class="rank-badge" :class="{ 'badge-top': i < 3, 'badge-gold': i === 0, 'badge-silver': i === 1, 'badge-bronze': i === 2 }">{{ i + 1 }}</span>
            <div class="rank-body">
              <strong class="rank-name">{{ stall.name }}</strong>
              <div class="rank-meta">
                <span class="meta-tag">{{ stall.floor }}</span>
                <span :class="['status-dot', stall.open ? 'open' : 'closed']">
                  {{ stall.open ? '营业中' : '已打烊' }}
                </span>
                <span class="meta-dot">·</span>
                <span>{{ stall.category }}</span>
              </div>
              <small class="rank-path">
                {{ stallSignature(stall) }} · {{ stallHierarchy(stall) }}
              </small>
            </div>
            <span class="rank-score">{{ stall.rankScore }}</span>
          </div>
        </div>
        <div v-else class="empty-state">
          <p>暂无档口数据。</p>
        </div>
      </template>
    </section>

    <!-- ── Canteen Rankings ── -->
    <section class="card rank-card" :class="{ 'is-expanded': expandedSection === 'canteens' }">
      <div class="rank-card-header" @click="toggleSection('canteens')" role="button" tabindex="0" @keydown.enter="toggleSection('canteens')">
        <div>
          <p class="eyebrow">食堂排行</p>
          <h2>食堂综合榜</h2>
        </div>
        <span class="expand-indicator">{{ expandedSection === 'canteens' ? '▾' : '▸' }}</span>
      </div>

      <!-- Collapsed: top 3 preview -->
      <div v-if="expandedSection !== 'canteens'" class="rank-preview">
        <div v-for="(canteen, i) in rankedSubCanteens.slice(0, 3)" :key="canteen.id" class="preview-item">
          <span class="preview-rank">{{ i + 1 }}</span>
          <span class="preview-name">{{ canteen.name }}</span>
          <span class="preview-score">{{ canteen.rankScore }}</span>
        </div>
        <p v-if="rankedSubCanteens.length === 0" class="preview-empty">暂无数据</p>
      </div>

      <!-- Expanded: full list -->
      <template v-if="expandedSection === 'canteens'">
        <div v-if="rankedSubCanteens.length" class="rank-list">
          <div
            v-for="(canteen, i) in rankedSubCanteens"
            :key="canteen.id"
            class="rank-item"
          >
            <span class="rank-badge" :class="{ 'badge-top': i < 3, 'badge-gold': i === 0, 'badge-silver': i === 1, 'badge-bronze': i === 2 }">{{ i + 1 }}</span>
            <div class="rank-body">
              <strong class="rank-name">{{ canteen.name }}</strong>
              <div class="rank-meta">
                <span class="meta-tag">{{ parentCanteenName(canteen) }}</span>
                <span class="meta-dot">·</span>
                <span>{{ canteen.hours || '时间未设置' }}</span>
              </div>
              <small class="rank-path">
                人流 {{ crowdLabel(canteen.crowdLevel) }} · {{ canteen.stallCount }} 个档口
              </small>
            </div>
            <span class="rank-score">{{ canteen.rankScore }}</span>
          </div>
        </div>
        <div v-else class="empty-state">
          <p>暂无食堂数据。</p>
        </div>
      </template>
    </section>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();

/* ── Expand/collapse state ── */
const expandedSection = ref('');
function toggleSection(name) {
  expandedSection.value = expandedSection.value === name ? '' : name;
}

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

/* ── Stall & Canteen rankings ── */
const rankedStalls = computed(() => store.rankings.stalls.slice(0, 8));

const rankedSubCanteens = computed(() =>
  store.rankings.canteens
    .filter((c) => c.canteenType === 'sub' || c.parentId)
    .slice(0, 8)
);

/* ── Location helpers ── */

function dishLocationPath(dish) {
  const stall = store.stalls.find((s) => s.id === dish.stallId);
  if (!stall) return '未知';
  const canteen = store.canteens.find((c) => c.id === stall.canteenId);
  if (!canteen) return stall.name;
  const parent = store.canteens.find((c) => c.id === canteen.parentId);
  return parent ? `${parent.name} → ${canteen.name} → ${stall.name}` : `${canteen.name} → ${stall.name}`;
}

function stallHierarchy(stall) {
  const canteen = store.canteens.find((c) => c.id === stall.canteenId);
  if (!canteen) return '未知食堂';
  const parent = store.canteens.find((c) => c.id === canteen.parentId);
  return parent ? `${parent.name} → ${canteen.name}` : canteen.name;
}

function stallSignature(stall) {
  const stallDishes = store.dishes.filter((d) => d.stallId === stall.id);
  if (!stallDishes.length) return '—';
  const top = stallDishes.reduce((best, d) => (d.rating > best.rating ? d : best), stallDishes[0]);
  return `招牌: ${top.name}`;
}

function parentCanteenName(canteen) {
  const parent = store.canteens.find((c) => c.id === canteen.parentId);
  return parent ? `${parent.name} 分区` : '分区食堂';
}

function crowdLabel(level) {
  if (level == null) return '未知';
  if (level >= 70) return '拥挤';
  if (level >= 45) return '适中';
  return '宽松';
}
</script>

<style scoped>
/* ── Grid: 3-col desktop, 1-col mobile ── */
.rankings-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  align-items: start;
}

@media (max-width: 960px) {
  .rankings-grid {
    grid-template-columns: 1fr;
  }
}

/* ── Card ── */
.rank-card {
  display: flex;
  flex-direction: column;
  padding: 20px;
  transition: box-shadow .22s var(--ease), border-color .22s var(--ease);
}
.rank-card.is-expanded {
  border-color: rgba(31, 122, 77, .18);
  box-shadow: 0 20px 48px rgba(31, 122, 77, .1);
}

/* ── Clickable Header ── */
.rank-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
  border-radius: 14px;
  padding: 4px 2px;
  margin: -4px -2px -8px;
  transition: background .15s;
}
.rank-card-header:hover {
  background: rgba(31, 122, 77, .04);
}
.rank-card-header h2 {
  margin: 0;
  font-family: var(--font-display, sans-serif);
  font-weight: 730;
  font-size: 1.05rem;
  letter-spacing: -.02em;
}
.expand-indicator {
  font-size: 14px;
  color: var(--muted, #999);
  transition: transform .22s var(--ease);
}

/* ── Collapsed preview ── */
.rank-preview {
  margin-top: 6px;
  display: grid;
  gap: 6px;
}
.preview-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(255,255,255,.62), rgba(255,255,255,.38));
  border: 1px solid rgba(255,255,255,.5);
  font-size: 13px;
}
.preview-rank {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(31, 122, 77, .1);
  color: var(--primary-dark, #115b37);
  font-weight: 700;
  font-size: 11px;
  flex-shrink: 0;
}
.preview-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 550;
}
.preview-score {
  font-weight: 700;
  font-size: 12px;
  color: var(--primary-dark, #115b37);
  flex-shrink: 0;
}
.preview-empty {
  color: var(--muted, #999);
  font-size: 13px;
  text-align: center;
  padding: 12px;
}

/* ── Category chips ── */
.category-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
  margin-bottom: 14px;
}

.filter-btn {
  padding: 4px 12px;
  border: 1px solid rgba(191, 211, 181, 0.5);
  border-radius: 16px;
  background: rgba(255, 255, 255, .7);
  cursor: pointer;
  font-size: 0.8rem;
  transition: all 0.18s;
}
.filter-btn:hover { background: rgba(235, 247, 229, .7); }
.filter-btn.active {
  background: var(--primary, #1f7a4d);
  color: #fff;
  border-color: var(--primary, #1f7a4d);
}

/* ── Rank list ── */
.rank-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rank-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(255,255,255,.72), rgba(255,255,255,.48));
  border: 1px solid rgba(255,255,255,.6);
  transition: transform .15s, box-shadow .15s;
}
.rank-item:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(0,0,0,.06);
}

/* ── Rank badge ── */
.rank-badge {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(0,0,0,.06);
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary, #666);
  flex-shrink: 0;
}
.rank-badge.badge-top {
  background: linear-gradient(135deg, #ffd700, #ffb800);
  color: #5a3e00;
  box-shadow: 0 2px 8px rgba(255,200,0,.3);
}
.rank-badge.badge-gold {
  background: linear-gradient(135deg, #ffd700, #ffb800);
  color: #5a3e00;
}
.rank-badge.badge-silver {
  background: linear-gradient(135deg, #d4d4d8, #a1a1aa);
  color: #27272a;
}
.rank-badge.badge-bronze {
  background: linear-gradient(135deg, #e7a977, #c77d4a);
  color: #3e2410;
}

/* ── Thumbnail ── */
.rank-thumb {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 10px;
  flex-shrink: 0;
}
.rank-emoji {
  font-size: 24px;
  flex-shrink: 0;
  width: 40px;
  text-align: center;
}

/* ── Body ── */
.rank-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.rank-name {
  font-size: 0.88rem;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  color: var(--text-secondary, #888);
  flex-wrap: wrap;
}
.meta-price {
  font-weight: 700;
  color: var(--primary-dark, #155f3b);
}
.meta-dot {
  opacity: .4;
}
.meta-tag {
  background: rgba(31,122,77,.1);
  color: var(--primary-dark, #155f3b);
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 600;
}
.status-dot {
  font-size: 0.7rem;
  font-weight: 600;
}
.status-dot.open { color: #16a34a; }
.status-dot.closed { color: #dc2626; }

.rank-path {
  font-size: 0.72rem;
  color: var(--muted, #999);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Score ── */
.rank-score {
  font-weight: 750;
  font-size: 0.85rem;
  color: var(--primary-dark, #155f3b);
  flex-shrink: 0;
  min-width: 32px;
  text-align: right;
}

/* ── Empty ── */
.empty-state {
  padding: 28px 12px;
  text-align: center;
  color: var(--text-secondary, #888);
  font-size: 0.88rem;
}

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  .rank-card,
  .rank-item,
  .rank-card-header {
    transition: none !important;
  }
}
</style>
