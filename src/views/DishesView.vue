<template>
  <section class="page-heading">
    <p class="eyebrow">Smart Meal Discovery</p>
    <h1>菜品检索</h1>
    <p>说出这一餐的预算、口味或营养目标，从全部有效菜品中找到更合适的选择。</p>
  </section>

  <SmartMealComposer
    v-model="ragQuery"
    v-model:memory-draft="memoryDraft"
    title="帮我找菜"
    subtitle="快捷问题会随着你的健康档案、预算、餐次、口味和忌口自动变化。"
    :prompts="profilePrompts"
    :loading="ragLoading"
    :memory-open="memoryOpen"
    :memory-saving="memorySaving"
    action-text="找一找"
    loading-text="检索中…"
    @submit="submitRagQuery"
    @prompt="askPrompt"
    @toggle-memory="memoryOpen = !memoryOpen"
    @save-memory="saveMemory"
    @clear-memory="clearMemory"
  />

  <section v-if="ragResult" class="card discovery-answer">
    <div class="answer-heading"><span class="rag-source-badge" :class="ragResult.meta?.semanticUsed ? 'source-llm' : 'source-template'">{{ ragResult.meta?.semanticUsed ? '语义检索' : '规则检索' }}</span><strong>检索结论</strong></div>
    <p>{{ ragAnswer }}</p>
    <RagTrustState :item="ragResult" />
    <div v-if="ragResult.warnings?.length" class="rag-warning-list" role="status">
      <p v-for="warning in ragResult.warnings" :key="`${warning.code}-${warning.dishId || ''}`">{{ warning.message }}</p>
    </div>
    <div v-if="visibleSearchCitations.length" class="compact-citations">
      <button v-for="cite in visibleSearchCitations" :key="cite.id" type="button" @click="jumpToDish(cite.id)"><strong>{{ cite.name }}</strong><small>相关度 {{ formatRetrievalScore(cite.retrievalScore) }} · {{ compactCitationSnippet(dishMatchSnippet(cite)) }}</small></button>
    </div>
    <button v-if="(ragResult.items?.length || 0) > 3" class="text-link" type="button" @click="citationsExpanded = !citationsExpanded">{{ citationsExpanded ? '收起引用' : `查看全部 ${ragResult.items.length} 条引用` }}</button>
    <div v-if="ragResult.suggestedRelaxations?.length" class="relaxation-list"><strong>可放宽条件</strong><span v-for="suggestion in ragResult.suggestedRelaxations" :key="relaxationLabel(suggestion)" class="pill">{{ relaxationLabel(suggestion) }}</span></div>
  </section>
  <p v-if="ragError" class="form-message rag-error">{{ ragError }}</p>

  <p v-if="stallFilter" class="stall-banner">
    正在查看：<strong>{{ stallFilterName }}</strong> 的菜品
    <button class="text-link" type="button" @click="clearStallFilter">查看全部</button>
  </p>

  <div class="result-toolbar">
    <div><p class="eyebrow">{{ searchResultActive ? 'Semantic Results' : 'All Active Dishes' }}</p><h2>{{ sortedDishes.length }} 道有效菜品</h2></div>
    <div class="sort-bar" role="group" aria-label="菜品评分排序">
      <button class="pill sort-btn" :class="{ active: sortDir === 'desc' }" type="button" @click="sortDir = 'desc'">评分高→低</button>
      <button class="pill sort-btn" :class="{ active: sortDir === 'asc' }" type="button" @click="sortDir = 'asc'">评分低→高</button>
    </div>
  </div>

  <section class="dish-layout">
    <div class="dish-list">
      <RouterLink v-for="dish in sortedDishes" :key="dish.id" class="dish-card" :to="{ name: 'dish-detail', params: { id: dish.id } }">
        <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="dish.name" class="dish-thumb" />
        <span v-else class="emoji large">{{ dish.image }}</span>
        <span class="dish-card-info">
          <strong>{{ dish.name }}</strong>
          <small class="muted">{{ dish.cuisine }} · {{ dish.taste || '口味待核验' }} · {{ dishPriceText(dish) }}</small>
          <small class="muted">{{ dishNutritionPresentation(dish).label }}</small>
          <small v-if="dishLocation(dish)" class="dish-location">{{ dishLocation(dish) }}</small>
          <small :class="['supply-badge', supplyState(dish).className]">{{ supplyState(dish).label }}</small>
          <RagTrustState :item="dish" compact />
        </span>
        <span class="rating">{{ dishRatingText(dish) }}</span>
        <ChevronRight :size="18" class="dish-open-icon" aria-hidden="true" />
      </RouterLink>
      <p v-if="!sortedDishes.length" class="muted empty-dishes">暂无有效菜品。</p>
      <button v-if="!searchResultActive && store.catalogPage.hasMore" class="secondary load-more" type="button" :disabled="catalogLoadingMore" @click="loadMoreCatalog">{{ catalogLoadingMore ? '加载中…' : `加载更多（已加载 ${store.dishes.length} / ${store.catalogPage.total}）` }}</button>
    </div>

  </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ChevronRight } from '@lucide/vue';
import RagTrustState from '../components/RagTrustState.vue';
import SmartMealComposer from '../components/SmartMealComposer.vue';
import { dishNutritionPresentation, dishPriceText, dishRatingText, dishSupplyPresentation } from '../domain/dishPresentation.js';
import { buildProfilePrompts, compactCitationSnippet, createRatingMap, sortDishesByRating, visibleCitations } from '../domain/studentDiscovery.js';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const route = useRoute();
const router = useRouter();

const stallFilter = ref(route.query.stall || '');
const sortDir = ref('desc');
const catalogLoadingMore = ref(false);

const stallFilterName = computed(() => store.stalls.find((s) => s.id === stallFilter.value)?.name || '');
const todayMenuMap = computed(() => new Map(store.todayMenu.dishes.map((dish) => [dish.id, dish])));
const ratingById = computed(() => createRatingMap(store.rankings.dishes));

function supplyState(dish) {
  const menuDish = todayMenuMap.value.get(dish.id);
  return dishSupplyPresentation(dish, menuDish || null);
}

const filteredDishes = computed(() => {
  const source = searchResultActive.value ? store.dishSearchResult.items : store.dishes;
  let list = source.filter((dish) => dish.status !== 'archived' && dish.status !== 'inactive');
  if (stallFilter.value) list = list.filter((d) => d.stallId === stallFilter.value);
  return list;
});

const sortedDishes = computed(() => sortDishesByRating(filteredDishes.value, ratingById.value, sortDir.value));

const searchResultActive = computed(() => Boolean(store.dishSearchResult.query));

watch(() => route.query.stall, (val) => {
  stallFilter.value = val || '';
});

watch(() => route.query.dish, (val) => {
  if (val) router.replace({ name: 'dish-detail', params: { id: String(val) } });
});

async function loadMoreCatalog() {
  if (catalogLoadingMore.value || !store.catalogPage.hasMore) return;
  catalogLoadingMore.value = true;
  try { await store.loadMoreCatalog({ sort: 'rating_desc' }); } finally { catalogLoadingMore.value = false; }
}

function clearStallFilter() {
  stallFilter.value = '';
}

/* ── RAG search ── */
const ragQuery = ref('');
const ragLoading = computed(() => store.dishSearchLoading);
const ragResult = ref(null);
const ragError = ref('');
const memoryDraft = ref('');
const memoryPreferences = ref({});
const memorySaving = ref(false);
const memoryOpen = ref(false);
const citationsExpanded = ref(false);
const profilePrompts = computed(() => buildProfilePrompts(store.profile, 'search'));
const visibleSearchCitations = computed(() => visibleCitations(ragResult.value?.items || [], citationsExpanded.value));
const ragAnswer = computed(() => {
  if (!ragResult.value) return '';
  const total = Number(ragResult.value.availability?.totalCount ?? ragResult.value.items?.length ?? 0);
  const orderable = Number(ragResult.value.availability?.orderableCount ?? ragResult.value.items?.filter((dish) => dish.availability?.orderable).length ?? 0);
  if (!total) return '没有找到满足全部条件的真实菜品，请参考下方建议放宽条件。';
  const interpreted = ragResult.value.interpreted?.summary || ragResult.value.interpreted?.query || ragQuery.value;
  return `按“${interpreted}”找到 ${total} 道菜，其中 ${orderable} 道当前可预约。结果可按综合评分切换排序。`;
});

function askPrompt(query) {
  ragQuery.value = query;
  submitRagQuery();
}

async function submitRagQuery() {
  const q = ragQuery.value.trim();
  if (!q) return;
  ragError.value = '';
  ragResult.value = null;
  citationsExpanded.value = false;
  try {
    ragResult.value = await store.searchDishes({
      query: q,
      filters: {
        budgetMax: store.profile.budgetMax,
        taste: store.profile.taste !== '不限' ? store.profile.taste : undefined,
        halalOnly: store.profile.halalOnly,
        mealType: store.profile.mealType,
        stallId: stallFilter.value || undefined,
        avoidIngredients: store.profile.avoid || []
      },
      sort: 'relevance',
      limit: 50,
      offset: 0
    });
  } catch (err) {
    store.clearDishSearch();
    ragError.value = err.message || 'AI 检索失败，请重试。';
  }
}

function dishMatchSnippet(dish) {
  const reasons = Array.isArray(dish.matchReasons) ? dish.matchReasons : [];
  if (reasons.length) return reasons.slice(0, 2).join(' · ');
  return dish.availability?.reason || '来源于校园稳定菜品目录';
}

function formatRetrievalScore(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return '已匹配';
  return value <= 1 ? `${Math.round(value * 100)}%` : value.toFixed(1);
}

function relaxationLabel(suggestion) {
  if (typeof suggestion === 'string') return suggestion;
  return suggestion?.label || suggestion?.message || suggestion?.field || '调整筛选条件';
}

async function loadMemory() {
  try {
    const memory = await store.loadAgentMemory();
    memoryDraft.value = memory.summary || '';
    memoryPreferences.value = memory.preferences || {};
  } catch { /* dish search remains available */ }
}

async function saveMemory() {
  memorySaving.value = true;
  try {
    await store.saveAgentMemory({ summary: memoryDraft.value.trim(), preferences: memoryPreferences.value });
    ragError.value = '检索记忆已保存。';
  } catch (error) {
    ragError.value = error.message || '记忆保存失败';
  } finally {
    memorySaving.value = false;
  }
}

async function clearMemory() {
  memorySaving.value = true;
  try {
    await store.clearAgentMemory();
    memoryDraft.value = '';
    memoryPreferences.value = {};
    ragError.value = '检索记忆已清除。';
  } catch (error) {
    ragError.value = error.message || '记忆清除失败';
  } finally {
    memorySaving.value = false;
  }
}

function jumpToDish(dishId) {
  if (!dishId) return;
  router.push({ name: 'dish-detail', params: { id: dishId } });
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

onMounted(async () => {
  await loadMemory();
  if (route.query.dish) await router.replace({ name: 'dish-detail', params: { id: String(route.query.dish) } });
});
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

.dish-assistant-workspace { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 14px; align-items: stretch; }
.dish-assistant-rail { display: grid; align-content: start; gap: 9px; padding: 16px; }
.assistant-prompt { min-height: 42px; text-align: left; border: 1px solid rgba(31,122,77,.14); background: #f5faf2; color: var(--text); }
.assistant-prompt:hover { transform: translateX(3px); border-color: var(--primary); }
.dish-memory { display: grid; gap: 9px; margin-top: 10px; padding-top: 14px; border-top: 1px solid rgba(31,122,77,.12); }
.dish-memory textarea { min-height: 94px; resize: vertical; }.dish-memory > div:last-child { display: flex; gap: 7px; }.dish-memory button { flex: 1; }
.rag-section { margin-bottom: 0; min-width: 0; }
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
.citation-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.pick-list { display: flex; flex-wrap: wrap; gap: 6px; }
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
.citation-chip { justify-content: space-between; text-align: left; border-radius: 8px; padding: 9px 11px; }
.citation-chip > span { display: grid; gap: 3px; min-width: 0; }.citation-chip > span small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
.citation-chip:hover, .pick-chip:hover { background: rgba(31,122,77,.08); }
.citation-chip small, .pick-chip small { color: var(--text-secondary, #888); }
.rag-error { margin-top: 8px; }

.discovery-answer { display: grid; gap: 12px; margin-top: 14px; padding: 18px 20px; }
.answer-heading { display: flex; align-items: center; gap: 10px; }.discovery-answer > p { margin: 0; line-height: 1.65; }
.rag-warning-list { display:grid; gap:6px; }
.rag-warning-list p { margin:0; padding:8px 10px; border:1px solid #eecb83; border-radius:6px; color:#874f08; background:#fff7e8; font-size:12px; line-height:1.5; }
.compact-citations { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }
.compact-citations button { min-width: 0; display: grid; gap: 5px; padding: 10px 12px; text-align: left; border: 1px solid rgba(31,122,77,.13); background: #f8fbf7; color: inherit; }
.compact-citations strong, .compact-citations small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.compact-citations small { color: var(--muted); font-size: 11px; }
.relaxation-list { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 4px; }
.result-toolbar { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin: 28px 0 14px; }.result-toolbar h2 { margin: 0; font-size: 20px; }

.stall-banner { display: flex; align-items: center; gap: 10px; padding: 12px 18px; margin-bottom: 14px; border-radius: 18px; background: linear-gradient(135deg, rgba(31,122,77,.1), rgba(255,255,255,.68)); border: 1px solid rgba(31,122,77,.14); font-size: 14px; }
.sort-bar { display: flex; gap: 8px; margin: 0; }
.sort-btn { cursor: pointer; border: 1px solid rgba(255,255,255,.62); background: linear-gradient(135deg, rgba(255,255,255,.78), rgba(255,255,255,.56)); transition: border-color .18s, box-shadow .18s; }
.sort-btn.active { border-color: rgba(31,122,77,.32); box-shadow: 0 0 0 2px rgba(31,122,77,.12); }
.dish-thumb { width: 56px; height: 56px; border-radius: 16px; object-fit: cover; flex-shrink: 0; border: 1px solid rgba(255,255,255,.62); }
.dish-layout { display: block; }
.dish-list { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.dish-card-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.dish-card { color: inherit; text-decoration: none; transition: transform .2s ease, border-color .2s ease, background .2s ease; }.dish-card:hover { transform: translateX(3px); }
.dish-open-icon { flex: 0 0 auto; color: var(--muted); }
.dish-location { color: var(--accent, #1f7a4d); font-size: 12px; font-weight: 500; }
.empty-dishes { padding: 28px; text-align: center; }

.detail-location { margin-bottom: 10px; }
.location-pill { background: rgba(31,122,77,.08); color: var(--primary-dark, #155f3b); font-weight: 500; }
.halal-badge { background: rgba(59,130,246,.1); color: #2563eb; }

.review-photo { overflow: hidden; border-radius: 16px; border: 1px solid rgba(255,255,255,.62); flex-shrink: 0; }
.review-photo img { display: block; width: 72px; height: 72px; object-fit: cover; }

.order-dish-btn { display: inline-flex; align-items: center; gap: 6px; margin: 12px 0; padding: 10px 20px; font-size: 14px; text-decoration: none; border-radius: 15px; }

/* Mobile */
@media (max-width: 640px) {
  .filter-controls { flex-direction: column; }
  .rag-form { flex-direction: column; }
  .dish-assistant-workspace { grid-template-columns: 1fr; }
  .citation-list { grid-template-columns: 1fr; }
  .dish-list { grid-template-columns: 1fr; }
.result-toolbar { align-items: stretch; flex-direction: column; }.sort-bar { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); }.compact-citations { grid-template-columns: 1fr; }
.filter-controls { grid-template-columns: repeat(3, minmax(150px, 1fr)); }
.supply-badge { width: max-content; border-radius: 999px; padding: 3px 8px; font-weight: 720; }
.supply-badge.available { color: var(--primary-dark); background: rgba(31,122,77,.12); }
.supply-badge.limited { color: #79510d; background: #fff0bd; }
.supply-badge.sold-out { color: #fff; background: var(--danger); }
.supply-badge.off-menu { color: var(--muted); background: rgba(100,112,95,.1); }
.detail-actions { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
}
@media (prefers-reduced-motion: reduce) {
  .assistant-prompt, .citation-chip, .pick-chip, .chip, .sort-btn, .dish-card { transition: none; }
}
</style>
