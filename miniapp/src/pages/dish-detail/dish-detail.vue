<template>
  <sc-page-shell :back="true" :title="dish?.name || '菜品详情'" :subtitle="dish?.canteen?.name || '校园食堂'">
    <sc-state-card v-if="loading" type="loading" title="正在加载菜品详情" desc="从服务器获取最新信息。" />
    <sc-state-card v-else-if="error" type="error" title="加载失败" :desc="error" action-text="重试" @action="loadDetail" />
    <sc-state-card v-else-if="!dish" type="empty" title="菜品不存在" desc="该菜品可能已下架，请返回菜单检索。" action-text="去菜单" @action="openDishes" />

    <template v-if="dish">
      <view class="panel-card detail-hero-card">
        <view class="detail-hero">
          <view>
            <text class="eyebrow">{{ dish.canteen?.name || '食堂' }} · {{ dish.stall?.name || '档口' }}</text>
            <text class="detail-title">{{ dish.name }}</text>
            <view class="detail-meta-row">
              <text class="detail-price">¥{{ dish.price }}</text>
              <text v-if="supplyStatus" class="supply-tag" :class="supplyClass">{{ supplyStatus }}</text>
            </view>
          </view>
          <image class="detail-icon" :src="detailIconSrc" mode="aspectFit" />
        </view>
        <text v-if="dish.description" class="detail-desc">{{ dish.description }}</text>
      </view>

      <view class="panel-card">
        <sc-section eyebrow="NUTRITION" title="营养信息" />
        <view class="summary-grid">
          <view><text class="num">{{ dish.nutrition?.calories || 0 }}</text><text>kcal</text></view>
          <view><text class="num">{{ dish.nutrition?.protein || 0 }}g</text><text>蛋白</text></view>
          <view><text class="num">{{ dish.nutrition?.fat || 0 }}g</text><text>脂肪</text></view>
          <view><text class="num">{{ dish.nutrition?.carbs || 0 }}g</text><text>碳水</text></view>
        </view>
      </view>

      <view class="panel-card">
        <sc-section eyebrow="INFO" title="菜品信息" />
        <view class="info-grid">
          <view class="info-item">
            <text class="info-label">口味</text>
            <text class="info-value">{{ dish.taste }}</text>
          </view>
          <view class="info-item">
            <text class="info-label">菜系</text>
            <text class="info-value">{{ dish.cuisine }}</text>
          </view>
          <view class="info-item">
            <text class="info-label">评分</text>
            <text class="info-value">★ {{ (dish.rating || 0).toFixed(1) }}</text>
          </view>
          <view class="info-item">
            <text class="info-label">评价数</text>
            <text class="info-value">{{ dish.reviewCount || 0 }}</text>
          </view>
          <view class="info-item" v-if="dish.halal">
            <text class="info-label">清真</text>
            <text class="info-value halal-text">是</text>
          </view>
          <view class="info-item" v-if="supplyStatus">
            <text class="info-label">供应状态</text>
            <text class="info-value">{{ supplyStatus }}</text>
          </view>
        </view>
        <view v-if="dish.tags?.length" class="tag-row">
          <text v-for="tag in dish.tags" :key="tag" class="pill">{{ tag }}</text>
        </view>
        <view v-if="dish.ingredients?.length" class="tag-row">
          <text v-for="ing in dish.ingredients" :key="ing" class="pill ingredient-pill">{{ ing }}</text>
        </view>
      </view>

      <view class="panel-card">
        <sc-section eyebrow="REVIEW" title="写评价" desc="帮助同学了解这道菜。" />
        <view class="rating-row">
          <text v-for="n in 5" :key="n" class="star" :class="{ 'star-active': n <= review.rating }" @tap="review.rating = n">★</text>
        </view>
        <textarea class="textarea" v-model="review.content" maxlength="240" placeholder="说说这道菜的真实体验" />
        <button class="primary-btn" :disabled="!canReview" @tap="submitReview">提交评价</button>
        <text v-if="reviewMessage" class="notice" :class="{ 'notice-error': reviewError }">{{ reviewMessage }}</text>
      </view>

      <view v-if="dish.reviews?.length" class="panel-card">
        <sc-section eyebrow="REVIEWS" :title="`用户评价 (${dish.reviews.length})`" />
        <view v-for="item in dish.reviews" :key="item.id" class="review-item">
          <view class="review-header">
            <text class="review-user">{{ item.user }}</text>
            <text class="review-rating">★ {{ item.rating }}</text>
          </view>
          <text class="review-content">{{ item.content }}</text>
          <text class="review-date">{{ item.createdAt }}</text>
        </view>
        <sc-state-card v-if="!dish.reviews.length" type="empty" title="暂无评价" desc="成为第一个评价这道菜的人。" />
      </view>
    </template>
  </sc-page-shell>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { supplyStatusLabel } from '../../domain/recommendation.js';
import { validateReviewForm } from '../../domain/validation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const dish = ref(null);
const loading = ref(false);
const error = ref('');
const dishId = ref('');
const review = reactive({ rating: 5, content: '' });
const reviewMessage = ref('');
const reviewError = ref(false);

const detailIconMap = ['menu', 'meal-plan', 'order-dish'];
const detailIconSrc = computed(() => `/static/icons/${detailIconMap[Math.abs(hashCode(dish.value?.id || dish.value?.name)) % detailIconMap.length]}.png`);
const supplyStatus = computed(() => {
  if (!dish.value) return '';
  if (dish.value.menuItem?.soldOut) return '已售罄';
  if (dish.value.menuItem?.supplyLimit > 0) return `限量 ${dish.value.menuItem.supplyLimit} 份`;
  return supplyStatusLabel(dish.value);
});
const supplyClass = computed(() => {
  if (dish.value?.menuItem?.soldOut) return 'supply-soldout';
  if (dish.value?.menuItem?.supplyLimit > 0) return 'supply-limited';
  return 'supply-available';
});
const canReview = computed(() => store.user.value && dish.value && !dish.value.menuItem?.soldOut);

onLoad((options) => {
  dishId.value = options?.id || '';
  if (!store.user.value) {
    uni.redirectTo({ url: '/pages/login/login' });
    return;
  }
  if (dishId.value) loadDetail();
});

async function loadDetail() {
  if (!dishId.value) return;
  loading.value = true;
  error.value = '';
  try {
    const detail = await store.fetchDishDetail(dishId.value);
    dish.value = detail;
  } catch (err) {
    error.value = err.message;
    dish.value = store.getDishDetail(dishId.value);
  } finally {
    loading.value = false;
  }
}

async function submitReview() {
  const validationError = validateReviewForm({ targetId: dishId.value, rating: review.rating, content: review.content });
  if (validationError) {
    reviewMessage.value = validationError;
    reviewError.value = true;
    return;
  }
  try {
    const detail = await store.addReview({ targetId: dishId.value, rating: review.rating, content: review.content });
    review.content = '';
    reviewMessage.value = '评价已提交，感谢你的反馈。';
    reviewError.value = false;
    if (detail) dish.value = detail;
    else await loadDetail();
  } catch (err) {
    reviewMessage.value = err.message;
    reviewError.value = true;
  }
}

function openDishes() { uni.switchTab({ url: '/pages/dishes/dishes' }); }

function hashCode(value) {
  let hash = 0;
  const text = String(value || 'dish');
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) - hash) + text.charCodeAt(index);
  return hash;
}
</script>

<style scoped>
.detail-hero-card { margin-bottom: 22rpx; }
.detail-hero { display: flex; align-items: center; justify-content: space-between; gap: 20rpx; }
.eyebrow { display: block; color: #00a874; font-size: 21rpx; font-weight: 900; letter-spacing: 2rpx; }
.detail-title { display: block; margin-top: 8rpx; color: #20342b; font-size: 42rpx; font-weight: 950; }
.detail-meta-row { display: flex; align-items: center; gap: 16rpx; margin-top: 12rpx; }
.detail-price { color: #1f9f72; font-size: 38rpx; font-weight: 850; }
.supply-tag { padding: 6rpx 14rpx; border-radius: 999rpx; font-size: 20rpx; font-weight: 800; }
.supply-available { color: #1f9f72; background: #e9f8ef; }
.supply-limited { color: #b66b00; background: #fff7d8; }
.supply-soldout { color: #d9544d; background: #fde8e6; }
.detail-icon { width: 120rpx; height: 120rpx; border-radius: 34rpx; background: linear-gradient(145deg, #fff7d8, #e9f8ef); padding: 24rpx; box-sizing: border-box; }
.detail-desc { display: block; margin-top: 18rpx; color: #536b61; font-size: 26rpx; line-height: 1.6; }
.summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14rpx; }
.summary-grid view { padding: 22rpx; border-radius: 26rpx; background: #f3fbf5; text-align: center; color: #70877b; font-size: 22rpx; }
.summary-grid .num { display: block; color: #1f9f72; font-size: 33rpx; font-weight: 850; }
.info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16rpx; }
.info-item { padding: 18rpx; border-radius: 22rpx; background: #f7fbf7; }
.info-label { display: block; color: #70877b; font-size: 21rpx; }
.info-value { display: block; margin-top: 6rpx; color: #20342b; font-size: 28rpx; font-weight: 850; }
.halal-text { color: #1f9f72; }
.tag-row { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 18rpx; }
.ingredient-pill { color: #72818c; background: #f0f4f2; }
.rating-row { display: flex; gap: 12rpx; margin-bottom: 16rpx; }
.star { font-size: 42rpx; color: #d4dde0; }
.star-active { color: #ffd86b; }
.review-item { padding: 18rpx 0; border-bottom: 1rpx solid var(--line, #eee); }
.review-item:last-child { border-bottom: 0; }
.review-header { display: flex; align-items: center; justify-content: space-between; }
.review-user { color: #20342b; font-size: 26rpx; font-weight: 800; }
.review-rating { color: #ffd86b; font-size: 24rpx; }
.review-content { display: block; margin-top: 8rpx; color: #536b61; font-size: 25rpx; line-height: 1.5; }
.review-date { display: block; margin-top: 8rpx; color: #a0b0a8; font-size: 21rpx; }
</style>
