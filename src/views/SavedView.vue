<template>
  <section class="page-heading">
    <p class="eyebrow">个人记录</p>
    <h1>收藏与吃过</h1>
    <p>把想再吃的菜和真实用餐记录集中放在这里。</p>
  </section>

  <section class="saved-summary">
    <article><strong>{{ favoriteEntries.length }}</strong><span>收藏菜品</span></article>
    <article><strong>{{ eatenEntries.length }}</strong><span>吃过菜品</span></article>
    <article><strong>{{ totalEaten }}</strong><span>累计吃过</span></article>
  </section>

  <section class="saved-section">
    <div class="section-title horizontal">
      <div><p class="eyebrow">Favorites</p><h2>收藏菜品</h2></div>
      <RouterLink class="text-link" to="/dishes">继续找菜</RouterLink>
    </div>
    <div v-if="favoriteEntries.length" class="saved-grid">
      <article v-for="entry in favoriteEntries" :key="entry.id" class="saved-item">
        <RouterLink :to="{ path: '/dishes', query: { dish: entry.id } }" class="saved-media">
          <img v-if="entry.imageUrl" :src="entry.imageUrl" :alt="entry.name" />
          <span v-else class="emoji large">{{ entry.image || '🍽️' }}</span>
        </RouterLink>
        <div class="saved-body">
          <div><strong>{{ entry.name }}</strong><small>{{ locationLabel(entry) }} · ¥{{ entry.price }}</small></div>
          <div class="saved-actions">
            <button class="icon-action active" type="button" title="取消收藏" aria-label="取消收藏" @click="toggleFavorite(entry.id)">★</button>
            <button class="icon-action" type="button" title="记录吃过" aria-label="记录吃过" @click="markEaten(entry.id)">✓</button>
            <RouterLink class="primary button-link compact" :to="{ path: '/orders', query: { dish: entry.id } }">点餐</RouterLink>
          </div>
        </div>
      </article>
    </div>
    <div v-else class="card empty-state">
      <h2>还没有收藏</h2>
      <p>在菜品检索、区域推荐或智能推荐中点击星标即可加入。</p>
      <RouterLink class="primary button-link" to="/dishes">浏览菜品</RouterLink>
    </div>
  </section>

  <section class="saved-section">
    <div class="section-title"><p class="eyebrow">History</p><h2>吃过统计</h2></div>
    <div v-if="eatenEntries.length" class="history-list">
      <article v-for="entry in eatenEntries" :key="entry.id" class="history-row">
        <span class="history-count">{{ entry.eatenCount }}</span>
        <span class="history-main"><strong>{{ entry.name }}</strong><small>抽取 {{ entry.drawnCount }} 次 · 最近记录 {{ formatDate(entry.lastEatenAt) }}</small></span>
        <button class="secondary" type="button" @click="markEaten(entry.id)">再记一次</button>
      </article>
    </div>
    <p v-else class="muted">还没有“吃过”记录。</p>
  </section>

  <p v-if="message" class="form-message" :class="{ danger: isError }" aria-live="polite">{{ message }}</p>
</template>

<script setup>
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const message = ref('');
const isError = ref(false);
const preferenceMap = computed(() => new Map(store.dishPreferences.map((item) => [item.dishId, item])));

const favoriteEntries = computed(() => store.dishes
  .filter((dish) => preferenceMap.value.get(dish.id)?.favorite)
  .map((dish) => ({ ...dish, ...preferenceMap.value.get(dish.id) })));
const eatenEntries = computed(() => store.dishes
  .filter((dish) => Number(preferenceMap.value.get(dish.id)?.eatenCount || 0) > 0)
  .map((dish) => ({ ...dish, ...preferenceMap.value.get(dish.id) }))
  .sort((left, right) => right.eatenCount - left.eatenCount));
const totalEaten = computed(() => eatenEntries.value.reduce((sum, item) => sum + Number(item.eatenCount || 0), 0));

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
  return runAction(() => store.toggleFavorite(dishId), '收藏状态已更新。');
}

function markEaten(dishId) {
  return runAction(() => store.markDishEaten(dishId), '已记录一次“吃过”。');
}
</script>

<style scoped>
.saved-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 28px; }
.saved-summary article { padding: 18px; border: 1px solid rgba(31, 122, 77, .14); background: #fff; border-radius: 8px; display: grid; gap: 4px; }
.saved-summary strong { color: var(--primary-dark); font-size: 26px; }
.saved-section { margin-bottom: 32px; }
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
@media (max-width: 820px) { .saved-grid { grid-template-columns: 1fr; } }
@media (max-width: 600px) {
  .saved-summary { grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .saved-summary article { padding: 12px 8px; text-align: center; }
  .saved-summary strong { font-size: 21px; }
  .saved-item { grid-template-columns: 104px minmax(0, 1fr); }
  .history-row { align-items: flex-start; flex-wrap: wrap; }
  .history-row button { width: 100%; }
}
@media (prefers-reduced-motion: reduce) { .saved-item { transition: none; } }
</style>
