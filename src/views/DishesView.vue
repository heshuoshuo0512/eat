<template>
  <section class="page-heading">
    <p class="eyebrow">检索 / 筛选 / 帮我找菜</p>
    <h1>菜品多维查询</h1>
    <p>按名称、食材、口味、价格筛选真实可买到的菜，或用 AI 帮你找。</p>
  </section>

  <section class="card filter-bar">
    <div class="chip-bar">
      <button
        v-for="chip in filterChips"
        :key="chip.key"
        class="chip"
        :class="{ active: activeChips.has(chip.key) }"
        type="button"
        @click="toggleChip(chip.key)"
      >
        {{ chip.label }}
      </button>
    </div>

    <div class="filter-controls">
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
    </div>
  </section>

  <!-- RAG 帮我找菜 -->
  <section class="card rag-section">
    <div class="rag-header">
      <h3>🤖 帮我找菜</h3>
      <small class="muted">用自然语言描述需求，AI 从菜品库中为你检索推荐</small>
    </div>
    <form class="rag-form" @submit.prevent="submitRagQuery">
      <input v-model="ragQuery" placeholder="例如：低卡高蛋白的午餐推荐、适合减脂期吃的面食…" maxlength="200" />
      <button class="primary" type="submit" :disabled="ragLoading || !ragQuery.trim()">
        {{ ragLoading ? '检索中…' : '找一找' }}
      </button>
    </form>
    <div v-if="ragResult" class="rag-result">
      <div class="rag-answer">
        <span class="rag-source-badge" :class="ragResult.answerSource === 'llm' ? 'source-llm' : 'source-template'">
          {{ ragResult.answerSource === 'llm' ? 'AI 回答' : '模板回答' }}
        </span>
        <p>{{ ragResult.answer }}</p>
      </div>
      <div v-if="ragResult.citations?.length" class="rag-citations">
        <h4>引用菜品</h4>
        <div class="citation-list">
          <button
            v-for="cite in ragResult.citations"
            :key="cite.id"
            class="citation-chip"
            type="button"
            @click="jumpToDish(cite.id)"
          >
            {{ cite.name }}
            <small v-if="cite.score">相关度 {{ (cite.score * 100).toFixed(0) }}%</small>
          </button>
        </div>
      </div>
      <div v-if="ragResult.plan?.picks?.length" class="rag-picks">
        <h4>推荐菜品</h4>
        <div class="pick-list">
          <button
            v-for="pick in ragResult.plan.picks"
            :key="pick.id"
            class="pick-chip"
            type="button"
            @click="jumpToDish(pick.id)"
          >
            {{ pick.name }}
            <small>¥{{ pick.price }}</small>
          </button>
        </div>
      </div>
    </div>
    <p v-if="ragError" class="form-message rag-error">{{ ragError }}</p>
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
        <span class="dish-card-info">
          <strong>{{ dish.name }}</strong>
          <small class="muted">{{ dish.cuisine }} · {{ dish.taste }} · ¥{{ dish.price }}</small>
          <small class="muted">{{ dish.nutrition?.calories || 0 }} kcal · 蛋白 {{ dish.nutrition?.protein || 0 }}g · 脂肪 {{ dish.nutrition?.fat || 0 }}g · 碳水 {{ dish.nutrition?.carbs || 0 }}g</small>
          <small v-if="dishLocation(dish)" class="dish-location">{{ dishLocation(dish) }}</small>
        </span>
        <span class="rating">{{ (dish.rating || 0).toFixed(1) }}</span>
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

      <!-- Precise location: primary → sub → stall -->
      <div class="detail-location">
        <span class="pill location-pill">📍 {{ detailLocationFull(detail) }}</span>
      </div>

      <div class="meta-row">
        <span class="pill">¥{{ detail.price }}</span>
        <span class="pill">{{ detail.cuisine }}</span>
        <span class="pill">{{ detail.taste }}</span>
        <span v-if="detail.halal" class="pill halal-badge">清真</span>
      </div>

      <!-- Expanded nutrition -->
      <div class="nutrition-grid">
        <span><strong>{{ detail.nutrition?.calories || 0 }}</strong><small>kcal</small></span>
        <span><strong>{{ detail.nutrition?.protein || 0 }}g</strong><small>蛋白</small></span>
        <span><strong>{{ detail.nutrition?.fat || 0 }}g</strong><small>脂肪</small></span>
        <span><strong>{{ detail.nutrition?.carbs || 0 }}g</strong><small>碳水</small></span>
        <span v-if="detail.nutrition?.fiber != null"><strong>{{ detail.nutrition.fiber }}g</strong><small>膳食纤维</small></span>
        <span v-if="detail.nutrition?.sodium != null"><strong>{{ detail.nutrition.sodium }}mg</strong><small>钠</small></span>
        <span v-if="detail.nutrition?.sugar != null"><strong>{{ detail.nutrition.sugar }}g</strong><small>糖</small></span>
        <span v-if="detail.nutrition?.calcium != null"><strong>{{ detail.nutrition.calcium }}mg</strong><small>钙</small></span>
        <span v-if="detail.nutrition?.iron != null"><strong>{{ detail.nutrition.iron }}mg</strong><small>铁</small></span>
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

/* ── Chip filters ── */
const filterChips = [
  { key: '清爽', label: '清爽' },
  { key: '肉食', label: '肉食' },
  { key: '米饭', label: '米饭' },
  { key: '面食', label: '面食' },
  { key: '粉类', label: '粉类' },
  { key: '饼类', label: '饼类' },
  { key: '清真', label: '清真' },
  { key: '素食', label: '素食' },
  { key: '低价', label: '低价' },
  { key: '高蛋白', label: '高蛋白' },
];

const activeChips = reactive(new Set());

function toggleChip(key) {
  if (activeChips.has(key)) activeChips.delete(key);
  else activeChips.add(key);
}

function matchesChip(dish, chipKey) {
  const name = (dish.name || '').toLowerCase();
  const taste = (dish.taste || '').toLowerCase();
  const cuisine = (dish.cuisine || '').toLowerCase();
  const tags = (dish.tags || []).map((t) => t.toLowerCase());
  const ingredients = (dish.ingredients || []).map((i) => i.toLowerCase());
  const text = `${name} ${taste} ${cuisine} ${tags.join(' ')} ${ingredients.join(' ')}`;

  switch (chipKey) {
    case '清爽': return /清爽|清淡|沙拉|轻食|凉拌/.test(text);
    case '肉食': return /鸡|牛|猪|羊|鸭|鱼|虾|肉|排骨|鸡腿|鸡胸/.test(text);
    case '米饭': return /饭|盖饭|炒饭|拌饭|粥|碗饭|套餐/.test(text);
    case '面食': return /面|拉面|拌面|刀削|宽面|细面|汤面/.test(text);
    case '粉类': return /粉|米粉|河粉|螺蛳|红薯粉|粉丝/.test(text);
    case '饼类': return /饼|煎饼|馅饼|肉饼|烤饼|手抓饼|卷饼/.test(text);
    case '清真': return dish.halal || /清真|halal|牛肉面|羊肉/.test(text);
    case '素食': return /素|斋|豆腐|蔬菜|沙拉|蔬/.test(text) && !/鸡|牛|猪|羊|鸭|鱼|虾|肉/.test(text);
    case '低价': return (dish.price || 0) <= 12;
    case '高蛋白': return (dish.nutrition?.protein || 0) >= 20 || /高蛋白|蛋白|鸡胸/.test(text);
    default: return true;
  }
}

/* ── Stall / route filtering ── */
const stallFilter = ref(route.query.stall || '');
const selectedId = ref(route.query.dish || '');
const sortDir = ref('desc');
const review = reactive({ rating: 5, content: '' });
const message = ref('');
const reviewSection = ref(null);

const stallFilterName = computed(() => store.stalls.find((s) => s.id === stallFilter.value)?.name || '');

const filteredDishes = computed(() => {
  let list = store.searchedDishes;
  if (stallFilter.value) list = list.filter((d) => d.stallId === stallFilter.value);
  if (activeChips.size > 0) {
    list = list.filter((dish) => {
      for (const chip of activeChips) {
        if (!matchesChip(dish, chip)) return false;
      }
      return true;
    });
  }
  return list;
});

const sortedDishes = computed(() => {
  const list = [...filteredDishes.value];
  list.sort((a, b) => sortDir.value === 'desc' ? (b.rating || 0) - (a.rating || 0) : (a.rating || 0) - (b.rating || 0));
  return list;
});

const detail = computed(() => {
  store.state;
  return store.getDishDetail(selectedId.value);
});

// Set default selected on first load
if (!selectedId.value && sortedDishes.value.length) {
  selectedId.value = sortedDishes.value[0]?.id;
}

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

/* ── RAG search ── */
const ragQuery = ref('');
const ragLoading = ref(false);
const ragResult = ref(null);
const ragError = ref('');

async function submitRagQuery() {
  const q = ragQuery.value.trim();
  if (!q) return;
  ragLoading.value = true;
  ragError.value = '';
  ragResult.value = null;
  try {
    ragResult.value = await store.askMealAdvisor({ query: q });
  } catch (err) {
    ragError.value = err.message || 'AI 检索失败，请重试。';
  } finally {
    ragLoading.value = false;
  }
}

function jumpToDish(dishId) {
  if (!dishId) return;
  // Clear filters so the dish is visible
  stallFilter.value = '';
  activeChips.clear();
  store.searchFilters.keyword = '';
  store.searchFilters.taste = '不限';
  store.searchFilters.halalOnly = false;
  store.searchFilters.maxPrice = 30;
  nextTick(() => {
    selectedId.value = dishId;
  });
}

/* ── Location helpers ── */

function dishLocation(dish) {
  const stall = store.stalls.find((s) => s.id === dish.stallId);
  if (!stall) return '';
  const canteen = store.canteens.find((c) => c.id === stall.canteenId);
  if (!canteen) return stall.name;
  // Find parent canteen if hierarchical
  const parent = store.canteens.find((c) => c.id === canteen.parentId);
  if (parent) return `${parent.name} → ${canteen.name} → ${stall.name}`;
  return `${canteen.name} → ${stall.name}`;
}

function detailLocationFull(detail) {
  if (!detail?.stall) return '未知位置';
  const stall = detail.stall;
  const canteen = detail.canteen;
  if (!canteen) return stall.name;
  const parent = store.canteens.find((c) => c.id === canteen.parentId);
  if (parent) return `${parent.name} · ${canteen.name} · ${stall.name}`;
  return `${canteen.name} · ${stall.name}`;
}
</script>

<style scoped>
.chip-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}
.chip {
  padding: 6px 14px;
  border: 1px solid var(--border, #ddd);
  border-radius: 20px;
  background: var(--bg-primary, #fff);
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.18s;
  white-space: nowrap;
}
.chip:hover { background: var(--bg-hover, #f0f0f0); }
.chip.active {
  background: var(--accent, #1f7a4d);
  color: #fff;
  border-color: var(--accent, #1f7a4d);
}

.filter-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: flex-end;
}

.rag-section { margin-bottom: 0; }
.rag-header { margin-bottom: 12px; }
.rag-header h3 { margin: 0 0 4px; }
.rag-form { display: flex; gap: 10px; }
.rag-form input { flex: 1; }
.rag-result { margin-top: 14px; padding: 14px; border-radius: 16px; background: linear-gradient(135deg, rgba(235,247,229,.4), rgba(255,255,255,.6)); border: 1px solid rgba(31,122,77,.12); }
.rag-answer { margin-bottom: 12px; }
.rag-answer p { margin: 6px 0 0; line-height: 1.6; }
.rag-source-badge { display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 11px; font-weight: 600; }
.source-llm { background: rgba(31,122,77,.15); color: var(--primary-dark, #155f3b); }
.source-template { background: rgba(100,100,100,.1); color: #666; }
.rag-citations h4, .rag-picks h4 { margin: 0 0 8px; font-size: 13px; }
.citation-list, .pick-list { display: flex; flex-wrap: wrap; gap: 6px; }
.citation-chip, .pick-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border: 1px solid rgba(31,122,77,.2);
  border-radius: 14px;
  background: rgba(255,255,255,.8);
  cursor: pointer;
  font-size: 13px;
  transition: background .15s;
}
.citation-chip:hover, .pick-chip:hover { background: rgba(31,122,77,.08); }
.citation-chip small, .pick-chip small { color: var(--text-secondary, #888); }
.rag-error { margin-top: 8px; }

.stall-banner { display: flex; align-items: center; gap: 10px; padding: 12px 18px; margin-bottom: 14px; border-radius: 18px; background: linear-gradient(135deg, rgba(31,122,77,.1), rgba(255,255,255,.68)); border: 1px solid rgba(31,122,77,.14); font-size: 14px; }
.sort-bar { display: flex; gap: 8px; margin-bottom: 14px; }
.sort-btn { cursor: pointer; border: 1px solid rgba(255,255,255,.62); background: linear-gradient(135deg, rgba(255,255,255,.78), rgba(255,255,255,.56)); transition: border-color .18s, box-shadow .18s; }
.sort-btn.active { border-color: rgba(31,122,77,.32); box-shadow: 0 0 0 2px rgba(31,122,77,.12); }
.dish-thumb { width: 56px; height: 56px; border-radius: 16px; object-fit: cover; flex-shrink: 0; border: 1px solid rgba(255,255,255,.62); }
.dish-card-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.dish-location { color: var(--accent, #1f7a4d); font-size: 12px; font-weight: 500; }

.detail-location { margin-bottom: 10px; }
.location-pill { background: rgba(31,122,77,.08); color: var(--primary-dark, #155f3b); font-weight: 500; }
.halal-badge { background: rgba(59,130,246,.1); color: #2563eb; }

.review-photo { overflow: hidden; border-radius: 16px; border: 1px solid rgba(255,255,255,.62); flex-shrink: 0; }
.review-photo img { display: block; width: 72px; height: 72px; object-fit: cover; }

/* Mobile */
@media (max-width: 640px) {
  .filter-controls { flex-direction: column; }
  .rag-form { flex-direction: column; }
  .dish-layout { flex-direction: column; }
  .detail-panel { width: 100%; }
}
</style>
