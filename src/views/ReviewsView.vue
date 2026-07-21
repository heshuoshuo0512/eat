<template>
  <section class="page-heading">
    <p class="eyebrow">全校评价总览</p>
    <h1>菜品与食堂评价</h1>
    <p>汇总全部食堂的公开评价，按食堂、档口和菜品快速筛选。</p>
  </section>

  <section class="review-toolbar">
    <div class="segmented" aria-label="评价类型">
      <button type="button" :class="{ active: filters.targetType === 'dish' }" @click="setTargetType('dish')">菜品评价</button>
      <button type="button" :class="{ active: filters.targetType === 'canteen' }" @click="setTargetType('canteen')">食堂评价</button>
    </div>
    <select v-model="filters.sort" aria-label="评价排序" @change="resetAndLoad">
      <option value="rating_desc">评分优先</option>
      <option value="rating_asc">低分优先</option>
      <option value="latest">最新评价</option>
    </select>
  </section>

  <section class="card filter-panel">
    <label><span>食堂</span><select v-model="filters.canteenId" @change="onCanteenChange"><option value="">全部食堂</option><option v-for="canteen in store.canteens" :key="canteen.id" :value="canteen.id">{{ canteen.name }}</option></select></label>
    <label v-if="filters.targetType === 'dish'"><span>档口</span><select v-model="filters.stallId" @change="onStallChange"><option value="">全部档口</option><option v-for="stall in availableStalls" :key="stall.id" :value="stall.id">{{ stall.name }}</option></select></label>
    <label v-if="filters.targetType === 'dish'"><span>菜品</span><select v-model="filters.dishId" @change="resetAndLoad"><option value="">全部菜品</option><option v-for="dish in availableDishes" :key="dish.id" :value="dish.id">{{ dish.name }}</option></select></label>
    <button class="ghost reset-button" type="button" @click="resetFilters">重置筛选</button>
  </section>

  <section class="review-summary">
    <article><strong>{{ store.studentReviewSummary.averageRating || '—' }}</strong><span>平均评分</span></article>
    <article><strong>{{ store.studentReviewTotal }}</strong><span>当前评价</span></article>
    <article><strong>{{ store.studentReviewSummary.dishReviews }}</strong><span>菜品评价</span></article>
    <article><strong>{{ store.studentReviewSummary.canteenReviews }}</strong><span>食堂评价</span></article>
  </section>

  <section v-if="loading" class="card empty-state" aria-live="polite"><p>正在加载评价…</p></section>
  <section v-else-if="error" class="card empty-state"><p>{{ error }}</p><button class="primary" type="button" @click="loadReviews">重新加载</button></section>
  <section v-else-if="store.studentReviews.length" class="review-list">
    <article v-for="review in store.studentReviews" :key="review.id" class="review-item">
      <div class="review-score"><strong>{{ review.rating }}</strong><span>★</span></div>
      <div class="review-content">
        <div class="review-title"><strong>{{ targetName(review) }}</strong><span class="pill">{{ review.targetType === 'dish' ? '菜品' : '食堂' }}</span></div>
        <small>{{ locationLabel(review) }}</small>
        <p>{{ review.content }}</p>
        <footer><span>{{ review.user }}</span><time>{{ formatDate(review.createdAt) }}</time></footer>
      </div>
      <RouterLink v-if="review.dish" class="secondary button-link" :to="{ path: '/dishes', query: { dish: review.dish.id } }">查看菜品</RouterLink>
      <RouterLink v-else class="secondary button-link" to="/canteens">查看食堂</RouterLink>
    </article>
  </section>
  <section v-else class="card empty-state"><h2>没有符合条件的评价</h2><p>调整筛选条件后再试。</p></section>

  <nav v-if="store.studentReviewTotal > pageSize" class="pagination" aria-label="评价分页">
    <button class="secondary" type="button" :disabled="page === 0" @click="changePage(page - 1)">上一页</button>
    <span>第 {{ page + 1 }} / {{ Math.ceil(store.studentReviewTotal / pageSize) }} 页</span>
    <button class="secondary" type="button" :disabled="(page + 1) * pageSize >= store.studentReviewTotal" @click="changePage(page + 1)">下一页</button>
  </nav>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const pageSize = 20;
const page = ref(0);
const loading = ref(false);
const error = ref('');
const filters = reactive({ targetType: 'dish', canteenId: '', stallId: '', dishId: '', sort: 'rating_desc' });
const availableStalls = computed(() => store.stalls.filter((stall) => !filters.canteenId || stall.canteenId === filters.canteenId));
const availableDishes = computed(() => store.dishes.filter((dish) => {
  if (filters.stallId) return dish.stallId === filters.stallId;
  if (!filters.canteenId) return true;
  return availableStalls.value.some((stall) => stall.id === dish.stallId);
}));

function setTargetType(value) { filters.targetType = value; filters.stallId = ''; filters.dishId = ''; resetAndLoad(); }
function onCanteenChange() { filters.stallId = ''; filters.dishId = ''; resetAndLoad(); }
function onStallChange() { filters.dishId = ''; resetAndLoad(); }
function resetAndLoad() { page.value = 0; loadReviews(); }
function resetFilters() { Object.assign(filters, { targetType: filters.targetType, canteenId: '', stallId: '', dishId: '', sort: 'rating_desc' }); resetAndLoad(); }
function changePage(next) { page.value = next; loadReviews(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

async function loadReviews() {
  loading.value = true;
  error.value = '';
  try {
    await store.loadStudentReviews({ ...filters, limit: pageSize, offset: page.value * pageSize });
  } catch (loadError) {
    error.value = loadError.message || '评价加载失败';
  } finally {
    loading.value = false;
  }
}

function targetName(review) { return review.dish?.name || review.canteen?.name || '校园评价'; }
function locationLabel(review) { return [review.canteen?.name, review.stall?.name].filter(Boolean).join(' · ') || review.canteen?.location || '校内食堂'; }
function formatDate(value) { return String(value || '').slice(0, 10); }
onMounted(loadReviews);
</script>

<style scoped>
.review-toolbar { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 14px; }
.segmented { display: inline-grid; grid-template-columns: repeat(2, 1fr); padding: 4px; border: 1px solid rgba(31, 122, 77, .16); border-radius: 8px; background: #eef5eb; }
.segmented button { border: 0; background: transparent; color: var(--muted); min-width: 110px; }
.segmented button.active { background: #fff; color: var(--primary-dark); box-shadow: 0 3px 10px rgba(21, 95, 59, .1); }
.filter-panel { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) auto; gap: 12px; align-items: end; }
.filter-panel label { display: grid; gap: 6px; }
.filter-panel select { min-height: 42px; }
.reset-button { min-height: 42px; }
.review-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 18px 0 24px; }
.review-summary article { display: grid; gap: 4px; padding: 16px; border-left: 3px solid var(--primary); background: #fff; }
.review-summary strong { font-size: 23px; color: var(--primary-dark); }
.review-list { display: grid; gap: 12px; }
.review-item { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; gap: 16px; align-items: center; padding: 18px; border: 1px solid rgba(31, 122, 77, .14); border-radius: 8px; background: #fff; animation: review-enter .3s ease both; transition: transform .2s ease, box-shadow .2s ease; }
.review-item:nth-child(2) { animation-delay: 45ms; }.review-item:nth-child(3) { animation-delay: 90ms; }.review-item:nth-child(4) { animation-delay: 135ms; }
.review-item:hover { transform: translateY(-2px); box-shadow: 0 12px 24px rgba(21, 95, 59, .08); }
.review-score { width: 58px; height: 58px; display: grid; place-items: center; align-content: center; border-radius: 50%; background: #eff8e8; color: var(--primary-dark); }
.review-score strong { font-size: 22px; line-height: 1; }.review-score span { color: #d59a16; font-size: 12px; }
.review-content { min-width: 0; }.review-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }.review-content p { margin: 9px 0; line-height: 1.65; }.review-content footer { display: flex; gap: 12px; color: var(--muted); font-size: 12px; }
.pagination { display: flex; justify-content: center; align-items: center; gap: 14px; margin-top: 20px; }
@keyframes review-enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@media (max-width: 850px) { .filter-panel { grid-template-columns: repeat(2, 1fr); }.review-summary { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 620px) {
  .review-toolbar { align-items: stretch; flex-direction: column; }.segmented, .review-toolbar > select { width: 100%; }.filter-panel { grid-template-columns: 1fr; }.review-item { grid-template-columns: 52px minmax(0, 1fr); padding: 14px; }.review-item .button-link { grid-column: 1 / 3; width: 100%; justify-content: center; }.review-score { width: 48px; height: 48px; }
}
@media (prefers-reduced-motion: reduce) { .review-item { animation: none; transition: none; } }
</style>
