<template>
  <section class="page-heading region-page-heading">
    <p class="eyebrow">风味 / 评分 / 热度</p>
    <h1>{{ selectedRegion ? selectedRegion.name : '区域推荐' }}</h1>
    <p>{{ selectedRegion ? selectedRegion.description : '从校园餐单里找到更合口味的那一片，打开区域就能继续挑菜。' }}</p>
  </section>

  <template v-if="!selectedRegion">
    <section class="region-showcase" aria-labelledby="region-showcase-title">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">今天想吃哪一派</p>
          <h2 id="region-showcase-title">按风味逛一圈</h2>
        </div>
        <span class="pill">{{ regionSummaries.length }} 个区域 · {{ store.dishes.length }} 道菜</span>
      </div>

      <div class="region-grid">
        <RouterLink
          v-for="(region, index) in regionSummaries"
          :key="region.id"
          class="region-card"
          :class="[`tone-${region.tone}`, `delay-${index + 1}`, { 'is-pressed': pressedRegionId === region.id }]"
          :to="{ path: '/regions', query: { region: region.id, sort: 'forYou' } }"
          @pointerdown="pressRegion(region.id)"
          @pointerup="releaseRegion"
          @pointercancel="releaseRegion"
          @pointerleave="releaseRegion"
        >
          <div class="region-card-media">
            <img v-if="region.heroDish?.imageUrl" :src="region.heroDish.imageUrl" :alt="region.name" />
            <span v-else class="region-card-fallback">{{ region.icon }}</span>
            <span class="region-card-icon" aria-hidden="true">{{ region.icon }}</span>
          </div>
          <div class="region-card-body">
            <span class="eyebrow">{{ region.subtitle }}</span>
            <h2>{{ region.name }}</h2>
            <p>{{ region.description }}</p>
            <div class="region-card-meta">
              <span>{{ region.count }} 道菜</span>
              <span>⭐ {{ region.averageRating.toFixed(1) }}</span>
              <span>热度 {{ formatSales(region.totalSales) }}</span>
            </div>
          </div>
        </RouterLink>
      </div>
    </section>
  </template>

  <template v-else>
    <section class="region-detail-actions">
      <button class="pill region-back-button" type="button" @click="backToRegions">← 查看全部区域</button>
    </section>

    <section class="region-detail-hero card">
      <div class="region-detail-image">
        <img v-if="selectedRegion.heroDish?.imageUrl" :src="selectedRegion.heroDish.imageUrl" :alt="selectedRegion.name" />
        <span v-else class="region-card-fallback">{{ selectedRegion.icon }}</span>
      </div>
      <div class="region-detail-copy">
        <p class="eyebrow">{{ selectedRegion.subtitle }}</p>
        <h2>{{ selectedRegion.name }}</h2>
        <p class="hero-copy">{{ selectedRegion.description }}</p>
        <div class="metric-grid compact region-stats">
          <article><strong>{{ selectedRegion.count }}</strong><span>道菜</span></article>
          <article><strong>{{ selectedRegion.averageRating.toFixed(1) }}</strong><span>平均评分</span></article>
          <article><strong>{{ formatSales(selectedRegion.totalSales) }}</strong><span>总热度</span></article>
        </div>
      </div>
    </section>

    <section class="region-menu" aria-labelledby="region-menu-title">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">区域菜品</p>
          <h2 id="region-menu-title">挑一份现在想吃的</h2>
        </div>
        <div class="tab-bar region-sort-bar" role="tablist" aria-label="区域菜品排序">
          <button
            v-for="option in sortOptions"
            :key="option.value"
            class="tab"
            :class="{ active: selectedSort === option.value }"
            type="button"
            role="tab"
            :aria-selected="selectedSort === option.value"
            @click="setSort(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <TransitionGroup v-if="selectedDishes.length" name="region-dish" tag="div" class="region-dish-grid">
        <article v-for="dish in selectedDishes" :key="dish.id" class="region-dish-card">
          <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="dish.name" class="region-dish-image" />
          <span v-else class="emoji large region-dish-image-fallback">{{ dish.image }}</span>
          <div class="region-dish-content">
            <div class="region-dish-title">
              <RouterLink class="region-dish-name" :to="{ path: '/dishes', query: { dish: dish.id } }">{{ dish.name }}</RouterLink>
              <span class="rating">{{ dish.displayRating.toFixed(1) }}</span>
            </div>
            <small class="muted">{{ dish.cuisine }} · {{ dish.taste }} · ¥{{ dish.price }}</small>
            <small class="muted">{{ dishStallLabel(dish) }}</small>
            <div class="region-dish-meta">
              <span class="pill">热度 {{ formatSales(dish.sales) }}</span>
              <span class="pill">{{ dish.displayReviewCount }} 条评价</span>
              <span v-if="dish.isFavorite" class="pill">已收藏</span>
            </div>
            <div class="region-dish-footer">
              <span :class="['supply-badge', supplyState(dish).className]">{{ supplyState(dish).label }}</span>
              <RouterLink v-if="supplyState(dish).canOrder" class="primary button-link region-order-link" :to="{ path: '/orders', query: { dish: dish.id } }">去点这道菜</RouterLink>
              <RouterLink v-else class="text-link" :to="{ path: '/dishes', query: { dish: dish.id } }">看详情</RouterLink>
            </div>
          </div>
        </article>
      </TransitionGroup>
      <p v-else class="muted region-empty">这个区域暂时还没有可展示的菜品，去菜品检索看看其他选择。</p>
    </section>
  </template>
</template>

<script setup>
import { computed, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import {
  getRegionById,
  getRegionDishes,
  rankRegionDishes,
  summarizeRegions
} from '../domain/regionRecommendation.js';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const route = useRoute();
const router = useRouter();
const pressedRegionId = ref('');

const sortOptions = [
  { value: 'forYou', label: '适合我' },
  { value: 'rating', label: '评分优先' },
  { value: 'hot', label: '热度优先' },
  { value: 'price', label: '价格优先' }
];
const sortValues = new Set(sortOptions.map((option) => option.value));

const ratingById = computed(() => new Map(store.rankings.dishes.map((dish) => [dish.id, dish])));
const regionSummaries = computed(() => summarizeRegions(store.dishes, {
  ratingById: ratingById.value,
  preferences: store.dishPreferences
}));
const selectedRegionId = computed(() => String(route.query.region || ''));
const selectedRegion = computed(() => {
  const definition = getRegionById(selectedRegionId.value);
  return definition ? regionSummaries.value.find((region) => region.id === definition.id) : null;
});
const selectedSort = computed(() => sortValues.has(route.query.sort) ? route.query.sort : 'forYou');
const selectedDishes = computed(() => {
  if (!selectedRegion.value) return [];
  return rankRegionDishes(getRegionDishes(selectedRegion.value.id, store.dishes), {
    sortBy: selectedSort.value,
    ratingById: ratingById.value,
    preferences: store.dishPreferences
  });
});
const todayMenuMap = computed(() => new Map(store.todayMenu.dishes.map((dish) => [dish.id, dish])));

function formatSales(value) {
  const sales = Number(value || 0);
  return sales >= 1000 ? `${(sales / 1000).toFixed(1)}k` : String(sales);
}

function dishStallLabel(dish) {
  const stall = store.stalls.find((item) => item.id === dish.stallId);
  if (!stall) return '档口信息待补充';
  const canteen = store.canteens.find((item) => item.id === stall.canteenId);
  return canteen ? `${stall.name} · ${canteen.name}` : stall.name;
}

function supplyState(dish) {
  const menuDish = todayMenuMap.value.get(dish.id);
  if (!menuDish) return { label: '暂非今日供应', className: 'off-menu', canOrder: false };
  const status = menuDish.supplyStatus || 'available';
  if (status === 'sold_out') return { label: '今日售罄', className: 'sold-out', canOrder: false };
  if (status === 'limited') return { label: '库存紧张', className: 'limited', canOrder: true };
  return { label: '今日可点', className: 'available', canOrder: true };
}

function setSort(sortBy) {
  router.replace({ query: { ...route.query, sort: sortBy } });
}

function pressRegion(id) {
  pressedRegionId.value = id;
}

function releaseRegion() {
  window.setTimeout(() => {
    pressedRegionId.value = '';
  }, 140);
}

function backToRegions() {
  const query = { ...route.query };
  delete query.region;
  delete query.sort;
  router.replace({ query });
}
</script>

<style scoped>
.region-page-heading { margin-bottom: 1.25rem; }
.region-showcase, .region-menu { display: grid; gap: 1.125rem; }
.region-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.125rem; }
.region-card { position: relative; display: grid; overflow: hidden; min-width: 0; border: 1px solid rgba(255,255,255,.72); border-radius: 1.5rem; background: linear-gradient(145deg, rgba(255,255,255,.86), rgba(244,250,239,.7)); color: inherit; text-decoration: none; box-shadow: var(--shadow-soft); cursor: pointer; user-select: none; animation: region-float 7s ease-in-out infinite; transition: transform .24s var(--ease), box-shadow .24s var(--ease), border-color .24s var(--ease); }
.region-card::before { position: absolute; top: -35%; left: -25%; z-index: 2; width: 18%; height: 170%; content: ''; background: rgba(255,255,255,.34); transform: translateX(-260%) rotate(18deg); pointer-events: none; transition: transform .65s var(--ease); }
.region-card.delay-2 { animation-delay: -.9s; }
.region-card.delay-3 { animation-delay: -1.8s; }
.region-card.delay-4 { animation-delay: -2.7s; }
.region-card.delay-5 { animation-delay: -3.6s; }
.region-card.delay-6 { animation-delay: -4.5s; }
.region-card:hover { animation-play-state: paused; transform: translateY(-7px); border-color: rgba(31,122,77,.2); box-shadow: var(--shadow-hover); }
.region-card:hover::before { transform: translateX(780%) rotate(18deg); }
.region-card.is-pressed { animation-play-state: paused; transform: scale(.975); box-shadow: 0 .35rem .75rem rgba(31,122,77,.14); }
.region-card-media { position: relative; overflow: hidden; aspect-ratio: 16 / 9; background: linear-gradient(135deg, rgba(235,247,229,.72), rgba(255,255,255,.62)); }
.region-card-media::after { position: absolute; inset: 0; content: ''; background: linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(20,53,36,.25)); pointer-events: none; }
.region-card-media img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform .5s var(--ease); }
.region-card:hover .region-card-media img { transform: scale(1.055); }
.region-card-fallback { display: grid; place-items: center; width: 100%; height: 100%; font-size: 3.5rem; }
.region-card-icon { position: absolute; right: .875rem; bottom: .75rem; z-index: 1; display: grid; place-items: center; width: 2.5rem; height: 2.5rem; border: 1px solid rgba(255,255,255,.7); border-radius: 1rem; background: rgba(255,255,255,.78); font-size: 1.35rem; box-shadow: 0 .5rem 1.25rem rgba(20,53,36,.13); }
.region-card:hover .region-card-icon { transform: translateY(-3px) rotate(-6deg) scale(1.06); box-shadow: 0 .7rem 1.35rem rgba(20,53,36,.18); }
.region-card-body { display: grid; gap: .5rem; padding: 1rem 1.125rem 1.125rem; }
.region-card-body .eyebrow { margin: 0; }
.region-card-body h2 { margin: 0; font-size: 1.25rem; }
.region-card-body p { min-height: 2.8rem; margin: 0; color: var(--muted); font-size: .875rem; line-height: 1.6; }
.region-card-meta { display: flex; flex-wrap: wrap; gap: .5rem; color: var(--primary-dark); font-size: .75rem; font-weight: 720; }
.region-detail-actions { margin: -.35rem 0 1rem; }
.region-back-button { cursor: pointer; border: 1px solid rgba(31,122,77,.12); }
.region-detail-hero { display: grid; grid-template-columns: minmax(16rem, .95fr) minmax(0, 1.2fr); gap: 1.5rem; align-items: center; }
.region-detail-image { overflow: hidden; min-height: 15rem; border-radius: 1.25rem; background: linear-gradient(135deg, rgba(235,247,229,.72), rgba(255,255,255,.62)); }
.region-detail-image img { display: block; width: 100%; height: 100%; min-height: 15rem; object-fit: cover; }
.region-detail-copy { display: grid; gap: .625rem; }
.region-detail-copy h2 { margin: 0; font-size: clamp(1.5rem, 3vw, 2.25rem); }
.region-detail-copy .hero-copy { margin: 0; }
.region-stats { margin-top: .5rem; }
.region-stats article { padding: .875rem; }
.region-stats strong { font-size: 1.5rem; }
.region-sort-bar { justify-content: flex-end; margin: 0; }
.region-sort-bar .tab { border: 0; transition: transform .16s var(--ease), background .15s var(--ease), box-shadow .15s var(--ease); }
.region-sort-bar .tab:active { transform: scale(.94); }
.region-dish-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.region-dish-card { display: grid; grid-template-columns: 8.5rem minmax(0, 1fr); gap: 1rem; min-width: 0; padding: .875rem; border: 1px solid rgba(255,255,255,.72); border-radius: 1.25rem; background: linear-gradient(135deg, rgba(255,255,255,.84), rgba(244,250,239,.68)); box-shadow: var(--shadow-soft); transition: transform .22s var(--ease), box-shadow .22s var(--ease), border-color .22s var(--ease); }
.region-dish-card:hover { transform: translateY(-2px); border-color: rgba(31,122,77,.16); box-shadow: var(--shadow-hover); }
.region-dish-card:active { transform: scale(.99); }
.region-dish-image { display: block; width: 8.5rem; height: 8.5rem; object-fit: cover; border-radius: 1rem; }
.region-dish-image-fallback { display: grid; place-items: center; background: rgba(235,247,229,.7); }
.region-dish-content { display: grid; align-content: start; gap: .4rem; min-width: 0; }
.region-dish-title { display: flex; align-items: start; gap: .5rem; }
.region-dish-name { min-width: 0; overflow: hidden; color: var(--text); font-weight: 760; line-height: 1.4; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
.region-dish-name:hover { color: var(--primary); }
.region-dish-title .rating { flex-shrink: 0; margin-left: auto; }
.region-dish-content small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.region-dish-meta { display: flex; flex-wrap: wrap; gap: .375rem; margin-top: .25rem; }
.region-dish-meta .pill { padding: .25rem .45rem; font-size: .6875rem; }
.region-dish-footer { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin-top: .25rem; }
.region-dish-footer .supply-badge { font-size: .75rem; }
.region-order-link { padding: .4rem .6rem; font-size: .75rem; }
.region-empty { padding: 2rem; text-align: center; border: 1px dashed rgba(31,122,77,.2); border-radius: 1rem; background: rgba(255,255,255,.42); }
.region-dish-enter-active, .region-dish-leave-active { transition: opacity .24s var(--ease), transform .24s var(--ease); }
.region-dish-enter-from, .region-dish-leave-to { opacity: 0; transform: translateY(10px) scale(.985); }
.region-dish-leave-active { position: absolute; }

@keyframes region-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

@media (max-width: 1020px) {
  .region-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .region-detail-hero { grid-template-columns: 1fr; }
  .region-detail-image, .region-detail-image img { min-height: 13rem; max-height: 18rem; }
}

@media (max-width: 680px) {
  .region-page-heading { margin-bottom: 1rem; }
  .region-showcase, .region-menu { gap: .875rem; }
  .region-grid, .region-dish-grid { grid-template-columns: 1fr; gap: .875rem; }
  .region-card { border-radius: 1.125rem; }
  .region-card-media { aspect-ratio: 16 / 9; }
  .region-card-icon { right: .75rem; bottom: .625rem; width: 2.25rem; height: 2.25rem; border-radius: .75rem; }
  .region-card-body { gap: .375rem; padding: .875rem 1rem 1rem; }
  .region-card-body h2 { font-size: 1.125rem; }
  .region-card-body p { min-height: 0; font-size: .8125rem; }
  .region-card-meta { gap: .375rem .75rem; }

  .region-detail-actions { margin-bottom: .75rem; }
  .region-back-button { justify-content: center; width: 100%; min-height: 2.75rem; }
  .region-detail-hero { gap: 1rem; }
  .region-detail-image { aspect-ratio: 16 / 9; min-height: 0; max-height: none; border-radius: 1rem; }
  .region-detail-image img { height: 100%; min-height: 0; max-height: none; }
  .region-detail-copy { gap: .5rem; }
  .region-detail-copy h2 { font-size: 1.5rem; }
  .region-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem; }
  .region-stats article { min-width: 0; padding: .625rem .375rem; text-align: center; }
  .region-stats strong { font-size: 1.25rem; }
  .region-stats span { font-size: .6875rem; }

  .region-sort-bar { justify-content: flex-start; overflow-x: auto; flex-wrap: nowrap; width: 100%; padding: 0 0 .375rem; scroll-snap-type: x proximity; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
  .region-sort-bar::-webkit-scrollbar { display: none; }
  .region-sort-bar .tab { flex: 0 0 auto; min-height: 2.75rem; scroll-snap-align: start; }
  .region-dish-card { grid-template-columns: 5.75rem minmax(0, 1fr); gap: .75rem; padding: .75rem; border-radius: 1rem; }
  .region-dish-image { width: 5.75rem; height: 5.75rem; border-radius: .75rem; }
  .region-dish-content { gap: .35rem; }
  .region-dish-footer { justify-content: space-between; }
  .region-order-link { display: inline-flex; align-items: center; min-height: 2.5rem; }
  .region-empty { padding: 1.5rem 1rem; }
}

@media (max-width: 360px) {
  .region-dish-card { grid-template-columns: 5rem minmax(0, 1fr); gap: .625rem; }
  .region-dish-image { width: 5rem; height: 5rem; }
  .region-dish-meta { gap: .25rem; }
  .region-dish-meta .pill { padding-inline: .375rem; }
}
</style>
