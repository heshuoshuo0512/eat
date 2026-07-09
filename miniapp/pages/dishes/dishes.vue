<template>
  <view class="screen">
    <view class="header">
      <view>
        <text class="eyebrow">检索 / 筛选 / 评价</text>
        <text class="title">菜品多维查询</text>
        <text class="subtitle">只展示真实可购买菜品，按名称、口味、价格快速筛选。</text>
      </view>
    </view>

    <view class="card filter-card">
      <input class="input" v-model="store.searchFilters.keyword" placeholder="搜菜名、食材、口味" />
      <view class="filter-row">
        <input class="input half" type="number" v-model="store.searchFilters.maxPrice" placeholder="最高价" />
        <picker class="select-box half" :range="tastes" :value="tasteIndex" @change="setTaste">
          <view>{{ store.searchFilters.taste }}</view>
        </picker>
      </view>
      <label class="check-row">
        <checkbox :checked="store.searchFilters.halalOnly" color="#0f9f76" @tap="toggleHalal" />
        <text>只看清真</text>
      </label>
    </view>

    <view class="card">
      <text class="eyebrow">共 {{ store.searchedDishes.value.length }} 道</text>
      <view v-for="dish in store.searchedDishes.value" :key="dish.id" class="dish-row" @tap="selectDish(dish.id)">
        <text class="emoji">{{ dish.image }}</text>
        <view class="flex-1">
          <text class="main-text">{{ dish.name }}</text>
          <text class="sub-text">{{ dish.taste }} · {{ dish.cuisine }} · ¥{{ dish.price }} · {{ dish.nutrition.calories }} kcal</text>
        </view>
        <text class="pill">{{ dish.rating.toFixed(1) }}</text>
      </view>
      <text v-if="!store.searchedDishes.value.length" class="empty">没有匹配菜品，试试放宽条件。</text>
    </view>

    <view v-if="detail" class="card detail-card">
      <view class="between">
        <view>
          <text class="eyebrow">当前选择</text>
          <text class="detail-title">{{ detail.name }}</text>
        </view>
        <text class="emoji">{{ detail.image }}</text>
      </view>
      <text class="subtitle">{{ detail.canteen?.name }} · {{ detail.stall?.name }}</text>
      <view class="tag-row">
        <text v-for="tag in detail.tags" :key="tag" class="pill">{{ tag }}</text>
      </view>
      <textarea class="textarea" v-model="review.content" maxlength="240" placeholder="写一句真实评价，帮助同学选餐" />
      <button class="primary-btn" @tap="submitReview">提交评价</button>
      <text v-if="message" class="notice">{{ message }}</text>
    </view>
  </view>
</template>

<script setup>
import { computed, reactive, ref, watchEffect } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { validateReviewForm } from '../../../src/domain/validation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const tastes = ['不限', '清淡', '鲜香', '香辣', '浓郁', '酸甜'];
const selectedId = ref('');
const review = reactive({ rating: 5, content: '' });
const message = ref('');
const detail = computed(() => store.getDishDetail(selectedId.value));
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
</script>

<style scoped>
.filter-card { display: flex; flex-direction: column; gap: 18rpx; }
.filter-row { display: flex; gap: 16rpx; }
.half { flex: 1; }
.check-row { display: flex; align-items: center; gap: 10rpx; color: #40505a; font-size: 26rpx; }
.flex-1 { flex: 1; min-width: 0; }
.detail-title { display: block; margin-top: 8rpx; font-size: 36rpx; font-weight: 900; }
.tag-row { display: flex; flex-wrap: wrap; gap: 12rpx; margin: 20rpx 0; }
.detail-card { margin-bottom: 120rpx; }
</style>
