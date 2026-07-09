<template>
  <sc-page-shell tone="orange">
    <view class="hero-panel dishes-hero">
      <text class="hero-kicker">DISH DISCOVERY</text>
      <text class="hero-title">找得到，也买得到。</text>
      <text class="hero-subtitle">从真实菜品库筛选价格、口味和清真条件，减少选择成本。</text>
    </view>

    <view class="filter-panel panel-card">
      <input class="search-input" v-model="store.searchFilters.keyword" placeholder="搜菜名、食材、口味" />
      <view class="filter-row">
        <input class="input half" type="number" v-model="store.searchFilters.maxPrice" placeholder="最高价" />
        <picker class="select-box half" :range="tastes" :value="tasteIndex" @change="setTaste">
          <view>{{ store.searchFilters.taste }}</view>
        </picker>
      </view>
      <label class="check-row">
        <checkbox :checked="store.searchFilters.halalOnly" color="#58cfa0" @tap="toggleHalal" />
        <text>只看清真</text>
      </label>
    </view>

    <sc-state-card v-if="store.loading.value" type="loading" title="正在同步菜品库" desc="价格、口味和评分正在更新。" />
    <sc-state-card v-else-if="store.error.value" type="error" title="菜品数据加载失败" :desc="store.error.value" action-text="重试" @action="reload" />

    <sc-section eyebrow="MENU RESULT" :title="`共 ${store.searchedDishes.value.length} 道菜`" desc="点击菜品可在下方写评价。" />
    <view class="dish-stack">
      <sc-dish-card v-for="dish in store.searchedDishes.value" :key="dish.id" :dish="dish" :badge="dish.rating.toFixed(1)" @tap="selectDish(dish.id)" />
      <sc-state-card v-if="!store.searchedDishes.value.length" type="empty" title="没有匹配菜品" desc="试试放宽价格、口味或清真筛选条件。" />
    </view>

    <view v-if="detail" class="panel-card detail-card">
      <view class="detail-hero">
        <view>
          <text class="eyebrow">当前选择</text>
          <text class="detail-title">{{ detail.name }}</text>
          <text class="detail-location">{{ detail.canteen?.name }} · {{ detail.stall?.name }}</text>
        </view>
        <image class="detail-icon" :src="detailIconSrc" mode="aspectFit" />
      </view>
      <view class="tag-row">
        <text v-for="tag in detail.tags" :key="tag" class="pill">{{ tag }}</text>
      </view>
      <textarea class="textarea" v-model="review.content" maxlength="240" placeholder="写一句真实评价，帮助同学选餐" />
      <button class="primary-btn" @tap="submitReview">提交评价</button>
      <text v-if="message" class="notice">{{ message }}</text>
      <view class="button-row detail-actions">
        <button class="secondary-btn" @tap="openRecommend">按健康目标配餐</button>
        <button class="secondary-btn" @tap="openAgent">问智能顾问</button>
      </view>
    </view>
  </sc-page-shell>
</template>

<script setup>
import { computed, reactive, ref, watchEffect } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { validateReviewForm } from '../../domain/validation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const tastes = ['不限', '清淡', '鲜香', '香辣', '浓郁', '酸甜'];
const selectedId = ref('');
const review = reactive({ rating: 5, content: '' });
const message = ref('');
const detail = computed(() => store.getDishDetail(selectedId.value));
const detailIconMap = ['menu', 'meal-plan', 'order-dish'];
const detailIconSrc = computed(() => `/static/icons/${detailIconMap[Math.abs(hashCode(detail.value?.id || detail.value?.name)) % detailIconMap.length]}.png`);
const tasteIndex = computed(() => Math.max(0, tastes.indexOf(store.searchFilters.taste)));

onShow(() => {
  if (!store.user.value) uni.redirectTo({ url: '/pages/login/login' });
});

watchEffect(() => {
  if (!store.searchedDishes.value.some((dish) => dish.id === selectedId.value)) {
    selectedId.value = store.searchedDishes.value[0]?.id || '';
  }
});

function setTaste(event) {
  store.searchFilters.taste = tastes[Number(event.detail.value)] || '不限';
}
function toggleHalal() {
  store.searchFilters.halalOnly = !store.searchFilters.halalOnly;
}
function selectDish(id) {
  selectedId.value = id;
}
async function reload() { await store.load(); }
function openRecommend() { uni.navigateTo({ url: '/pages/recommend/recommend' }); }
function openAgent() { uni.navigateTo({ url: '/pages/agent/agent' }); }
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
function hashCode(value) {
  let hash = 0;
  const text = String(value || 'dish');
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) - hash) + text.charCodeAt(index);
  return hash;
}
</script>

<style scoped>
.dishes-hero { margin-bottom: 22rpx; }
.filter-panel { display: flex; flex-direction: column; gap: 18rpx; }
.search-input {
  width: 100%;
  min-height: 94rpx;
  padding: 0 30rpx;
  border-radius: 999rpx;
  background: #fff;
  color: #20342b;
  font-size: 28rpx;
  box-sizing: border-box;
  box-shadow: inset 0 0 0 1rpx rgba(24, 35, 42, 0.06);
}
.filter-row { display: flex; gap: 16rpx; }
.half { flex: 1; }
.check-row { display: flex; align-items: center; gap: 10rpx; color: #40505a; font-size: 26rpx; }
.dish-stack { display: flex; flex-direction: column; gap: 18rpx; margin-bottom: 24rpx; }
.detail-card { margin-bottom: 120rpx; }
.detail-hero { display: flex; align-items: center; justify-content: space-between; gap: 20rpx; }
.detail-title { display: block; margin-top: 8rpx; color: #20342b; font-size: 40rpx; font-weight: 950; }
.detail-location { display: block; margin-top: 8rpx; color: #70877b; font-size: 24rpx; }
.detail-icon { width: 112rpx; height: 112rpx; border-radius: 34rpx; background: linear-gradient(145deg, #fff7d8, #e9f8ef); padding: 24rpx; box-sizing: border-box; }
.tag-row { display: flex; flex-wrap: wrap; gap: 12rpx; margin: 22rpx 0; }
.button-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16rpx; margin-top: 20rpx; }
.detail-actions { margin-top: 18rpx; }
</style>
