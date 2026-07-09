<template>
  <view class="screen">
    <view class="header">
      <view>
        <text class="eyebrow">食堂 / 楼层 / 档口</text>
        <text class="title">食堂全景导航</text>
        <text class="subtitle">先解决在哪吃、有什么、开没开、拥不拥挤。</text>
      </view>
    </view>

    <view v-for="canteen in store.canteens.value" :key="canteen.id" class="card">
      <view class="between">
        <view>
          <text class="eyebrow">{{ canteen.location }}</text>
          <text class="canteen-title">{{ canteen.name }}</text>
        </view>
        <text class="crowd" :class="crowdClass(canteen.crowdLevel)">{{ canteen.crowdLevel }}%</text>
      </view>
      <text class="subtitle desc">{{ canteen.description }}</text>
      <view class="tag-row">
        <text class="pill">营业 {{ canteen.hours }}</text>
        <text v-for="tag in canteen.tags" :key="tag" class="pill">{{ tag }}</text>
      </view>
      <view v-for="stall in stallsByCanteen(canteen.id)" :key="stall.id" class="stall-row">
        <view class="flex-1">
          <text class="main-text">{{ stall.floor }} · {{ stall.name }}</text>
          <text class="sub-text">{{ stall.category }} · 人均 ¥{{ stall.avgPrice }} · {{ stall.description }}</text>
        </view>
        <text class="pill">{{ stall.rating.toFixed(1) }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { onShow } from '@dcloudio/uni-app';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();

onShow(() => {
  if (!store.user.value) uni.redirectTo({ url: '/pages/login/login' });
});

function stallsByCanteen(canteenId) {
  return store.stalls.value.filter((stall) => stall.canteenId === canteenId);
}

function crowdClass(value) {
  if (value >= 70) return 'hot';
  if (value >= 50) return 'warm';
  return 'calm';
}
</script>

<style scoped>
.canteen-title {
  display: block;
  margin-top: 8rpx;
  font-size: 36rpx;
  font-weight: 900;
}
.desc { margin-bottom: 20rpx; }
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin: 20rpx 0 8rpx;
}
.crowd {
  padding: 16rpx 18rpx;
  border-radius: 22rpx;
  color: #fff;
  font-size: 26rpx;
  font-weight: 900;
}
.crowd.hot { background: #ef6a4d; }
.crowd.warm { background: #f0a534; }
.crowd.calm { background: #10b981; }
.flex-1 { flex: 1; min-width: 0; }
</style>
