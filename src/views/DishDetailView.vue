<template>
  <section class="dish-detail-page">
    <RouterLink class="detail-back" :to="backTarget">
      <ArrowLeft :size="17" aria-hidden="true" />
      返回菜品目录
    </RouterLink>

    <p v-if="loading" class="detail-state">正在读取菜品详情...</p>
    <section v-else-if="error && !dish" class="detail-state error-state">
      <CircleAlert :size="24" aria-hidden="true" />
      <h1>菜品详情加载失败</h1>
      <p>{{ error }}</p>
      <button class="secondary" type="button" @click="loadDetail">重新加载</button>
    </section>

    <template v-else-if="dish">
      <header class="dish-detail-header">
        <div class="dish-detail-media">
          <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="dish.name" />
          <Utensils v-else :size="42" aria-hidden="true" />
        </div>
        <div class="dish-detail-heading">
          <p class="eyebrow">{{ dish.cuisine || '校园菜品' }} · {{ dish.taste || '口味待核验' }}</p>
          <h1>{{ dish.name }}</h1>
          <p class="dish-location"><MapPin :size="16" aria-hidden="true" />{{ locationLabel }}</p>
          <div class="headline-facts">
            <strong>{{ dishPriceText(dish) }}</strong>
            <span>{{ dishRatingText(dish) }}</span>
            <span :class="['supply-status', supply.className]">{{ supply.label }}</span>
          </div>
          <CatalogIntroduction :entity="dish" positioning />
        </div>
      </header>

      <nav class="detail-actions" aria-label="菜品操作">
        <button class="secondary" type="button" @click="toggleFavorite">
          <Heart :size="17" :fill="isFavorite ? 'currentColor' : 'none'" aria-hidden="true" />
          {{ isFavorite ? '已收藏' : '收藏' }}
        </button>
        <RouterLink v-if="supply.canOrder" class="primary button-link" :to="{ path: '/orders', query: { dish: dish.id } }">
          <ShoppingBag :size="17" aria-hidden="true" />
          到店预约
        </RouterLink>
        <span v-else class="order-unavailable">当前暂停预约，可先收藏</span>
      </nav>
      <p v-if="message" class="form-message">{{ message }}</p>

      <div class="detail-content">
        <main>
          <section class="detail-section">
            <div class="section-heading"><div><p class="eyebrow">Nutrition</p><h2>营养信息</h2></div><span>{{ nutrition.known ? '当前记录' : '待食堂核验' }}</span></div>
            <div v-if="nutrition.known" class="nutrition-grid">
              <div v-for="item in nutritionItems" :key="item.label"><strong>{{ item.value }}</strong><small>{{ item.unit }}</small><span>{{ item.label }}</span></div>
            </div>
            <p v-else class="fact-warning">营养数据尚未核验，系统不会把占位零值作为真实营养结论。</p>
          </section>

          <section class="detail-section">
            <div class="section-heading"><div><p class="eyebrow">Ingredients & Safety</p><h2>食材与安全</h2></div><span>数据库事实</span></div>
            <dl class="fact-list">
              <div><dt>过敏原</dt><dd :class="{ warning: allergenUnknown }">{{ allergenLabel }}</dd></div>
              <div><dt>清真状态</dt><dd>{{ halalLabel }}</dd></div>
              <div><dt>供应餐次</dt><dd>{{ mealTypeLabel }}</dd></div>
              <div><dt>档口位置</dt><dd>{{ locationLabel }}</dd></div>
            </dl>
            <div v-if="dish.ingredients?.length || dish.tags?.length" class="tag-row">
              <span v-for="tag in [...(dish.ingredients || []), ...(dish.tags || [])]" :key="tag" class="pill">{{ tag }}</span>
            </div>
            <RagTrustState :item="dish" />
          </section>

          <section class="detail-section">
            <div class="section-heading"><div><p class="eyebrow">Reviews</p><h2>菜品评价</h2></div><span>{{ dish.reviews?.length || 0 }} 条公开评价</span></div>
            <form class="review-form" @submit.prevent="submitReview">
              <select v-model.number="review.rating" aria-label="评分">
                <option v-for="score in [5, 4, 3, 2, 1]" :key="score" :value="score">{{ score }} 分</option>
              </select>
              <textarea v-model="review.content" maxlength="240" placeholder="写下味道、份量或用餐体验" />
              <button class="secondary" type="submit">提交评价</button>
            </form>
            <div class="reviews">
              <article v-for="item in dish.reviews || []" :key="item.id" class="review-row">
                <div><strong>{{ item.user || '校园用户' }} · {{ item.rating }} 分</strong><p>{{ item.content }}</p><small>{{ item.createdAt }}</small></div>
              </article>
              <p v-if="!dish.reviews?.length" class="muted">暂无公开评价，提交后需审核通过才会显示。</p>
            </div>
          </section>
        </main>

        <aside class="evidence-panel">
          <div class="section-heading"><div><p class="eyebrow">Evidence</p><h2>信息依据</h2></div></div>
          <dl class="fact-list compact-facts">
            <div><dt>目录来源</dt><dd>{{ dish.introduction?.provenanceLabel || '校园菜品数据库' }}</dd></div>
            <div><dt>介绍状态</dt><dd>{{ dish.introduction ? '已审核发布' : '尚无审核介绍' }}</dd></div>
            <div><dt>可信等级</dt><dd>{{ dish.introduction?.confidence?.level || '以字段状态为准' }}</dd></div>
            <div><dt>证据数量</dt><dd>{{ dish.introduction?.evidenceIds?.length || 0 }}</dd></div>
          </dl>
          <p class="evidence-note"><ShieldAlert :size="17" aria-hidden="true" />目录定位只帮助理解和检索，不能替代真实配方、营养、过敏原或当日供应核验。</p>
        </aside>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ArrowLeft, CircleAlert, Heart, MapPin, ShieldAlert, ShoppingBag, Utensils } from '@lucide/vue';
import CatalogIntroduction from '../components/CatalogIntroduction.vue';
import RagTrustState from '../components/RagTrustState.vue';
import { dishNutritionPresentation, dishPriceText, dishRatingText, dishSupplyPresentation } from '../domain/dishPresentation.js';
import { validateReviewForm } from '../domain/validation.js';
import { useCanteenStore } from '../stores/canteenStore.js';

const route = useRoute();
const store = useCanteenStore();
const dish = ref(null);
const loading = ref(true);
const error = ref('');
const message = ref('');
const review = reactive({ rating: 5, content: '' });
const dishId = computed(() => String(route.params.id || ''));
const backTarget = computed(() => dish.value?.stallId ? { path: '/dishes', query: { stall: dish.value.stallId } } : '/dishes');
const supply = computed(() => dishSupplyPresentation(dish.value || {}, store.todayMenu.dishes?.find((item) => String(item.id) === dishId.value) || null));
const nutrition = computed(() => dishNutritionPresentation(dish.value || {}));
const isFavorite = computed(() => store.dishPreferences.some((item) => String(item.dishId) === dishId.value && item.favorite));
const parentCanteen = computed(() => store.canteens.find((item) => item.id === dish.value?.canteen?.parentId));
const locationLabel = computed(() => [parentCanteen.value?.name, dish.value?.canteen?.name, dish.value?.stall?.name, dish.value?.stall?.floor].filter(Boolean).join(' · ') || '位置待补充');
const allergenUnknown = computed(() => dish.value?.safety?.status === 'unknown' || dish.value?.safetyDeclarations?.some((item) => item.status === 'unknown') || !dish.value?.allergens?.length);
const allergenLabel = computed(() => dish.value?.allergens?.length ? dish.value.allergens.join('、') : '数据库尚未确认');
const halalLabel = computed(() => dish.value?.factStatus?.halal === 'unknown' ? '数据库尚未确认' : dish.value?.halal ? '已标注为清真' : '未标注为清真');
const mealTypeLabel = computed(() => (dish.value?.mealTypes || []).map((item) => ({ breakfast: '早餐', lunch: '午餐', dinner: '晚餐' }[item] || item)).join('、') || '未标注');
const nutritionItems = computed(() => {
  if (!nutrition.value.known) return [];
  const value = dish.value?.nutrition || {};
  return [
    ['热量', value.calories, 'kcal'], ['蛋白质', value.protein, 'g'], ['碳水', value.carbs, 'g'], ['脂肪', value.fat, 'g'],
    ['膳食纤维', value.fiber, 'g'], ['钠', value.sodium, 'mg'], ['糖', value.sugar, 'g'],
  ].filter(([, amount]) => amount != null).map(([label, amount, unit]) => ({ label, value: Number(amount), unit }));
});

async function loadDetail() {
  if (!dishId.value) return;
  loading.value = true;
  error.value = '';
  try {
    dish.value = await store.fetchDishDetail(dishId.value);
  } catch (loadError) {
    dish.value = store.getDishDetail(dishId.value);
    error.value = loadError.message || '菜品详情加载失败。';
  } finally {
    loading.value = false;
  }
}

async function toggleFavorite() {
  message.value = '';
  try { await store.toggleFavorite(dishId.value); message.value = isFavorite.value ? '已加入收藏。' : '已取消收藏。'; }
  catch (actionError) { message.value = actionError.message; }
}

async function markEaten() {
  message.value = '';
  try { await store.markDishEaten(dishId.value); message.value = '已记录一次“吃过”。'; }
  catch (actionError) { message.value = actionError.message; }
}

async function submitReview() {
  message.value = validateReviewForm({ targetId: dishId.value, rating: review.rating, content: review.content });
  if (message.value) return;
  try {
    await store.addReview({ targetType: 'dish', targetId: dishId.value, rating: review.rating, content: review.content.trim() });
    review.content = '';
    message.value = '评价已提交审核，通过后会公开显示。';
    await loadDetail();
  } catch (actionError) { message.value = actionError.message; }
}

watch(dishId, loadDetail);
onMounted(loadDetail);
</script>

<style scoped>
.dish-detail-page { max-width: 1120px; margin: 0 auto; }
.detail-back { display: inline-flex; align-items: center; gap: 7px; margin-bottom: 18px; color: var(--primary-dark); font-weight: 650; text-decoration: none; }
.detail-state { display: grid; min-height: 260px; place-items: center; text-align: center; }
.error-state { align-content: center; gap: 8px; }.error-state h1,.error-state p { margin: 0; }
.dish-detail-header { display: grid; grid-template-columns: minmax(260px, .82fr) minmax(0, 1.18fr); gap: 28px; padding-bottom: 26px; border-bottom: 1px solid rgba(31,122,77,.15); }
.dish-detail-media { display: grid; min-height: 310px; place-items: center; overflow: hidden; border: 1px solid rgba(31,122,77,.13); border-radius: 8px; color: var(--primary); background: #f2f7ef; }
.dish-detail-media img { width: 100%; height: 100%; object-fit: cover; }
.dish-detail-heading { align-self: center; min-width: 0; }.dish-detail-heading h1 { margin: 4px 0 10px; font-size: clamp(30px, 4vw, 48px); letter-spacing: 0; overflow-wrap: anywhere; }
.dish-location { display: flex; align-items: flex-start; gap: 6px; color: var(--muted); line-height: 1.5; }.dish-location svg { margin-top: 3px; flex: 0 0 auto; }
.headline-facts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 14px; }.headline-facts strong { margin-right: 6px; font-size: 22px; }.headline-facts span { padding: 5px 9px; border: 1px solid rgba(31,122,77,.13); border-radius: 6px; font-size: 12px; }
.detail-actions { display: flex; align-items: center; gap: 10px; padding: 18px 0; }.detail-actions button,.detail-actions .button-link { display: inline-flex; min-height: 42px; align-items: center; justify-content: center; gap: 7px; text-decoration: none; }.order-unavailable { color: var(--muted); font-size: 13px; }
.detail-content { display: grid; grid-template-columns: minmax(0,1fr) 300px; gap: 34px; align-items: start; }
.detail-section { padding: 26px 0; border-bottom: 1px solid rgba(31,122,77,.12); }.section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 16px; }.section-heading h2,.section-heading p { margin: 0; }.section-heading h2 { font-size: 20px; }.section-heading > span { color: var(--muted); font-size: 12px; }
.nutrition-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 8px; }.nutrition-grid div { display: grid; min-height: 88px; place-content: center; padding: 10px; border-radius: 6px; background: #f4f7f3; text-align: center; }.nutrition-grid strong { font-size: 18px; }.nutrition-grid small,.nutrition-grid span { color: var(--muted); font-size: 11px; }
.fact-warning,.evidence-note { padding: 12px 14px; border: 1px solid #e7c77f; border-radius: 6px; color: #76510d; background: #fff8e9; line-height: 1.55; }
.fact-list { margin: 0; }.fact-list div { display: grid; grid-template-columns: 110px minmax(0,1fr); gap: 14px; padding: 11px 0; border-bottom: 1px solid rgba(31,122,77,.09); }.fact-list dt { color: var(--muted); }.fact-list dd { margin: 0; text-align: right; overflow-wrap: anywhere; }.fact-list dd.warning { color: #9a4f12; font-weight: 650; }
.review-form { display: grid; grid-template-columns: 90px minmax(0,1fr) auto; gap: 8px; }.review-form textarea { min-height: 82px; resize: vertical; }.reviews { margin-top: 14px; }
.evidence-panel { position: sticky; top: 24px; margin-top: 26px; padding: 18px; border: 1px solid rgba(31,122,77,.13); border-radius: 8px; background: #f7faf6; }.compact-facts div { grid-template-columns: 90px minmax(0,1fr); font-size: 12px; }.evidence-note { display: flex; align-items: flex-start; gap: 8px; margin: 16px 0 0; font-size: 12px; }.evidence-note svg { flex: 0 0 auto; }
@media (max-width: 760px) { .dish-detail-header,.detail-content { grid-template-columns: 1fr; }.dish-detail-media { min-height: 220px; }.dish-detail-heading h1 { font-size: 30px; }.evidence-panel { position: static; margin-top: 0; }.nutrition-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }.review-form { grid-template-columns: 1fr; }.detail-actions { align-items: stretch; flex-direction: column; }.detail-actions button,.detail-actions .button-link { width: 100%; }.fact-list div { grid-template-columns: 92px minmax(0,1fr); } }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }
</style>
