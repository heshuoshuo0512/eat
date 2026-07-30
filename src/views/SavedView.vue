<template>
  <section class="page-heading">
    <p class="eyebrow">个人记录</p>
    <h1>收藏与用餐记录</h1>
    <p>收藏想再吃的菜；小程序订单完成后会自动记录吃过次数。</p>
  </section>

  <section class="saved-summary">
    <article><strong>{{ store.savedCatalog.favorite.page.total || favoriteEntries.length }}</strong><span>收藏菜品</span></article>
    <article><strong>{{ store.savedCatalog.eaten.page.total || eatenEntries.length }}</strong><span>吃过菜品</span></article>
    <article><strong>{{ totalEaten }}</strong><span>累计吃过</span></article>
  </section>

  <div class="saved-tabs segmented" role="tablist" aria-label="个人记录类型">
    <button type="button" role="tab" :aria-selected="activeSavedTab === 'favorites'" :class="{ active: activeSavedTab === 'favorites' }" @click="activeSavedTab = 'favorites'">收藏菜品</button>
    <button type="button" role="tab" :aria-selected="activeSavedTab === 'history'" :class="{ active: activeSavedTab === 'history' }" @click="activeSavedTab = 'history'">吃过统计</button>
  </div>

  <section v-if="activeSavedTab === 'favorites'" class="saved-section saved-panel">
    <div class="section-title horizontal">
      <div><p class="eyebrow">Favorites</p><h2>收藏菜品</h2></div>
      <RouterLink class="text-link" to="/dishes">继续找菜</RouterLink>
    </div>
    <template v-if="favoriteEntries.length">
      <div class="favorite-group-controls segmented" aria-label="收藏分组方式">
        <button type="button" :class="{ active: favoriteGroupMode === 'canteen' }" @click="favoriteGroupMode = 'canteen'">按食堂</button>
        <button type="button" :class="{ active: favoriteGroupMode === 'category' }" @click="favoriteGroupMode = 'category'">按类型</button>
      </div>
      <div class="saved-groups">
        <section v-for="group in favoriteGroups" :key="group.id" class="saved-group">
          <header><h3>{{ group.label }}</h3><span>{{ group.items.length }} 道</span></header>
          <div class="saved-grid">
            <article v-for="entry in group.items" :key="entry.id" class="saved-item">
              <RouterLink :to="{ name: 'dish-detail', params: { id: entry.id } }" class="saved-media">
                <img v-if="entry.imageUrl" :src="entry.imageUrl" :alt="entry.name" />
                <span v-else class="emoji large">{{ entry.image || '🍽️' }}</span>
              </RouterLink>
              <div class="saved-body">
                <div><strong>{{ entry.name }}</strong><small>{{ locationLabel(entry) }} · {{ priceLabel(entry) }}</small></div>
                <div class="saved-actions">
                  <button class="icon-action active" type="button" title="取消收藏" aria-label="取消收藏" @click="toggleFavorite(entry.id)">★</button>
                  <RouterLink class="primary button-link compact" :to="{ path: '/orders', query: { dish: entry.id } }">点餐</RouterLink>
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>
    </template>
    <button v-if="store.savedCatalog.favorite.page.hasMore" class="secondary load-more" type="button" :disabled="savedLoading" @click="loadMoreSaved('favorite')">{{ savedLoading ? '加载中…' : '加载更多收藏' }}</button>
    <div v-if="!favoriteEntries.length" class="card empty-state">
      <h2>还没有收藏</h2>
      <p>在菜品检索、地区口味推荐或智能推荐中点击星标即可加入。</p>
      <RouterLink class="primary button-link" to="/dishes">浏览菜品</RouterLink>
    </div>
  </section>

  <section v-else class="saved-section saved-panel">
    <div class="section-title"><p class="eyebrow">History</p><h2>吃过统计</h2></div>
    <template v-if="eatenEntries.length">
      <div class="history-list">
        <article v-for="entry in eatenEntries" :key="entry.id" class="history-row">
          <span class="history-count">{{ entry.eatenCount }}</span>
          <span class="history-main"><strong>{{ entry.name }}</strong><small>抽取 {{ entry.drawnCount }} 次 · 最近记录 {{ formatDate(entry.lastEatenAt) }}</small></span>
          <button class="secondary" type="button" @click="markEaten(entry.id)">再记一次</button>
        </article>
      </div>
      <button v-if="store.savedCatalog.eaten.page.hasMore" class="secondary load-more" type="button" :disabled="savedLoading" @click="loadMoreSaved('eaten')">{{ savedLoading ? '加载中…' : '加载更多记录' }}</button>
    </template>
    <p v-else class="muted">还没有用餐记录；完成小程序订单后会自动出现在这里。</p>
  </section>

  <p v-if="message" class="form-message" :class="{ danger: isError }" aria-live="polite">{{ message }}</p>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const message = ref('');
const isError = ref(false);
const activeSavedTab = ref('favorites');
const favoriteGroupMode = ref('canteen');
const savedLoading = ref(false);

const favoriteEntries = computed(() => store.savedCatalog.favorite.items
  .map((dish) => ({ ...dish, ...(dish.preference || {}) })));
const eatenEntries = computed(() => store.savedCatalog.eaten.items
  .map((dish) => ({ ...dish, ...(dish.preference || {}) }))
  .filter((dish) => Number(dish.eatenCount || 0) > 0)
  .sort((left, right) => right.eatenCount - left.eatenCount));
const totalEaten = computed(() => eatenEntries.value.reduce((sum, item) => sum + Number(item.eatenCount || 0), 0));
const favoriteGroups = computed(() => {
  const groups = new Map();
  for (const dish of favoriteEntries.value) {
    const label = favoriteGroupMode.value === 'canteen' ? canteenLabel(dish) : categoryLabel(dish);
    const id = `${favoriteGroupMode.value}:${label}`;
    if (!groups.has(id)) groups.set(id, { id, label, items: [] });
    groups.get(id).items.push(dish);
  }
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
});

function locationLabel(dish) {
  const stall = store.stalls.find((item) => item.id === dish.stallId);
  const canteen = store.canteens.find((item) => item.id === stall?.canteenId);
  return [canteen?.name, stall?.name].filter(Boolean).join(' · ') || '校内档口';
}

function formatDate(value) {
  return value ? String(value).slice(0, 10) : '暂无时间';
}

async function runAction(action, successText) {
  message.value = '';
  isError.value = false;
  try {
    await action();
    message.value = successText;
  } catch (error) {
    isError.value = true;
    message.value = error.message || '操作失败';
  }
}

function toggleFavorite(dishId) {
  return runAction(async () => { await store.toggleFavorite(dishId); await store.loadSavedCatalog('favorite'); }, '收藏状态已更新。');
}

function canteenLabel(dish) {
  const stall = store.stalls.find((item) => item.id === dish.stallId);
  const canteen = store.canteens.find((item) => item.id === stall?.canteenId);
  const parent = store.canteens.find((item) => item.id === canteen?.parentId);
  return [parent?.name, canteen?.name].filter(Boolean).join(' · ') || '其他校内场所';
}

function categoryLabel(dish) {
  if (dish.catalogItemType === 'beverage') return '饮品';
  if (dish.catalogItemType === 'snack') return '小吃';
  return dish.catalogCategory || dish.category || '其他餐食';
}

function priceLabel(dish) {
  return dish.priceDisplay || (Number.isFinite(Number(dish.price)) ? `¥${dish.price}` : '价格待核验');
}

function markEaten(dishId) {
  return runAction(async () => { await store.markDishEaten(dishId); await store.loadSavedCatalog('eaten'); }, '已记录一次“吃过”。');
}

async function loadMoreSaved(kind) {
  const page = store.savedCatalog[kind].page;
  if (savedLoading.value || !page.hasMore) return;
  savedLoading.value = true;
  try { await store.loadSavedCatalog(kind, { page: page.page + 1, pageSize: page.pageSize || 20 }); } finally { savedLoading.value = false; }
}

onMounted(() => Promise.all([store.loadSavedCatalog('favorite'), store.loadSavedCatalog('eaten')]));
</script>

<style scoped>
.saved-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 28px; }
.saved-summary article { padding: 18px; border: 1px solid rgba(31, 122, 77, .14); background: #fff; border-radius: 8px; display: grid; gap: 4px; }
.saved-summary strong { color: var(--primary-dark); font-size: 26px; }
.saved-tabs { display: inline-grid; grid-template-columns: repeat(2, minmax(120px, 1fr)); margin-bottom: 22px; padding: 4px; border: 1px solid rgba(31,122,77,.16); background: #eef5eb; }.saved-tabs button { border: 0; background: transparent; color: var(--muted); }.saved-tabs button.active { background: #fff; color: var(--primary-dark); box-shadow: 0 3px 10px rgba(21,95,59,.1); }
.saved-section { margin-bottom: 32px; }
.saved-panel { animation: saved-panel-in .26s ease both; }
.favorite-group-controls { margin-bottom: 18px; }
.saved-groups { display: grid; gap: 24px; }.saved-group { display: grid; gap: 12px; }.saved-group > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(31, 122, 77, .12); }.saved-group h3 { margin: 0; font-size: 17px; }.saved-group > header span { color: var(--muted); font-size: 13px; font-weight: 700; }
.saved-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.saved-item { display: grid; grid-template-columns: 132px minmax(0, 1fr); min-height: 132px; overflow: hidden; border: 1px solid rgba(31, 122, 77, .14); border-radius: 8px; background: #fff; transition: transform .22s ease, box-shadow .22s ease; }
.saved-item:hover { transform: translateY(-3px); box-shadow: 0 14px 30px rgba(21, 95, 59, .1); }
.saved-media { display: grid; place-items: center; background: #eef7ed; min-width: 0; }
.saved-media img { width: 100%; height: 100%; object-fit: cover; }
.saved-body { padding: 16px; display: flex; flex-direction: column; justify-content: space-between; gap: 14px; min-width: 0; }
.saved-body div:first-child { display: grid; gap: 5px; }
.saved-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.icon-action { width: 38px; height: 38px; padding: 0; display: grid; place-items: center; border: 1px solid rgba(31, 122, 77, .2); background: #fff; color: var(--primary); font-size: 18px; }
.icon-action.active { background: #eff8e8; }
.button-link.compact { min-height: 38px; padding: 8px 14px; }
.history-list { display: grid; gap: 10px; }
.history-row { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-bottom: 1px solid rgba(31, 122, 77, .12); background: #fff; }
.history-count { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 50%; background: var(--primary); color: #fff; font-weight: 800; }
.history-main { display: grid; gap: 4px; flex: 1; min-width: 0; }
@keyframes saved-panel-in { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: translateY(0); } }
@media (max-width: 820px) { .saved-grid { grid-template-columns: 1fr; } }
@media (max-width: 600px) {
  .saved-tabs { width: 100%; }
  .saved-summary { grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .saved-summary article { padding: 12px 8px; text-align: center; }
  .saved-summary strong { font-size: 21px; }
  .saved-item { grid-template-columns: 104px minmax(0, 1fr); }
  .history-row { align-items: flex-start; flex-wrap: wrap; }
  .history-row button { width: 100%; }
}
@media (prefers-reduced-motion: reduce) { .saved-item { transition: none; }.saved-panel { animation: none; } }
</style>
