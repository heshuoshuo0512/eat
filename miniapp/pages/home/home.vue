<template>
  <view class="screen">
    <view class="header">
      <view>
        <text class="eyebrow">今日食堂</text>
        <text class="title">{{ greeting }}</text>
        <text class="subtitle">{{ store.todayMenu.value.dishes.length ? `${store.todayMenu.value.date} 已发布菜单` : '今日菜单未发布，已用菜品库兜底推荐' }}</text>
      </view>
      <button class="logout" @tap="logout">退出</button>
    </view>

    <view class="card glass">
      <view class="metric-grid">
        <view class="metric"><text class="num">{{ store.canteens.value.length }}</text><text class="label">食堂</text></view>
        <view class="metric"><text class="num">{{ store.stalls.value.length }}</text><text class="label">档口</text></view>
        <view class="metric"><text class="num">{{ store.dishes.value.length }}</text><text class="label">菜品</text></view>
        <view class="metric"><text class="num">{{ topScore }}</text><text class="label">最高分</text></view>
      </view>
    </view>

    <view class="card">
      <view class="between title-row">
        <view>
          <text class="eyebrow">{{ menuSourceLabel }}</text>
          <text class="section-heading">为你推荐</text>
        </view>
        <text class="pill">{{ store.recommendation.value.goalLabel }}</text>
      </view>
      <view v-for="dish in store.recommendation.value.dishes" :key="dish.id" class="dish-row" @tap="openDishes">
        <text class="emoji">{{ dish.image }}</text>
        <view class="flex-1">
          <text class="main-text">{{ dish.name }}</text>
          <text class="sub-text">{{ dish.nutrition.calories }} kcal · 蛋白 {{ dish.nutrition.protein }}g · ¥{{ dish.price }}</text>
        </view>
      </view>
      <button class="primary-btn" @tap="openRecommend">生成我的餐单</button>
    </view>

    <view class="card">
      <view class="between title-row">
        <view>
          <text class="eyebrow">校园热榜</text>
          <text class="section-heading">综合评分 Top 4</text>
        </view>
        <button class="link-btn" @tap="openDishes">去检索</button>
      </view>
      <view v-for="dish in store.rankings.value.dishes.slice(0, 4)" :key="dish.id" class="rank-row">
        <text class="emoji">{{ dish.image }}</text>
        <view class="flex-1">
          <text class="main-text">{{ dish.name }}</text>
          <text class="sub-text">{{ dish.tags.join(' / ') }}</text>
        </view>
        <text class="pill">{{ dish.rankScore }}</text>
      </view>
    </view>

    <view class="quick-grid">
      <button class="quick-card" @tap="openCanteens">食堂导航</button>
      <button class="quick-card" @tap="openVision">拍照识餐</button>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const greeting = computed(() => store.user.value?.nickname || store.user.value?.username || '欢迎回来');
const topScore = computed(() => store.rankings.value.dishes[0]?.rating?.toFixed?.(1) || '—');
const menuSourceLabel = computed(() => store.todayMenu.value.dishes.length ? '今日供应优先' : '菜品库兜底');

onShow(async () => {
  await store.load();
  if (!store.user.value) uni.redirectTo({ url: '/pages/login/login' });
});

onPullDownRefresh(async () => {
  await store.load();
  uni.stopPullDownRefresh();
});

function logout() {
  store.logout();
  uni.redirectTo({ url: '/pages/login/login' });
}
function openRecommend() { uni.switchTab({ url: '/pages/recommend/recommend' }); }
function openDishes() { uni.switchTab({ url: '/pages/dishes/dishes' }); }
function openVision() { uni.switchTab({ url: '/pages/vision/vision' }); }
function openCanteens() { uni.navigateTo({ url: '/pages/canteens/canteens' }); }
</script>

<style scoped>
.logout,
.link-btn {
  padding: 10rpx 20rpx;
  border-radius: 999rpx;
  color: #08785c;
  background: #e7f7e3;
  font-size: 24rpx;
}
.section-heading {
  display: block;
  margin-top: 6rpx;
  font-size: 34rpx;
  font-weight: 900;
}
.title-row { margin-bottom: 12rpx; }
.flex-1 { flex: 1; min-width: 0; }
.quick-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18rpx;
}
.quick-card {
  height: 116rpx;
  border-radius: 30rpx;
  color: #172126;
  background: linear-gradient(135deg, #ffffff, #eaf8e8);
  font-size: 28rpx;
  font-weight: 900;
  box-shadow: var(--shadow);
}
</style>
