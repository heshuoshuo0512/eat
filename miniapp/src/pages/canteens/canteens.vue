<template>
  <sc-page-shell back tone="blue">
    <view class="hero-panel canteen-hero">
      <text class="hero-kicker">CAMPUS MAP</text>
      <text class="hero-title">食堂全景导航</text>
      <text class="hero-subtitle">看楼层、档口、营业时间和拥挤度，减少来回跑空。</text>
    </view>

    <sc-state-card v-if="store.loading.value" type="loading" title="正在同步食堂信息" desc="楼层、档口和拥挤度正在更新。" />
    <sc-state-card v-else-if="store.error.value" type="error" title="食堂信息加载失败" :desc="store.error.value" action-text="重试" @action="reload" />

    <view v-for="canteen in store.canteens.value" :key="canteen.id" class="panel-card canteen-card">
      <view class="between canteen-top">
        <view>
          <text class="eyebrow">{{ canteen.location }}</text>
          <text class="canteen-title">{{ canteen.name }}</text>
        </view>
        <view class="crowd" :class="crowdClass(canteen.crowdLevel)">
          <text class="crowd-num">{{ canteen.crowdLevel }}%</text>
          <text class="crowd-label">拥挤度</text>
        </view>
      </view>
      <text class="subtitle desc">{{ canteen.description }}</text>
      <view class="tag-row">
        <text class="pill blue">营业 {{ canteen.hours }}</text>
        <text v-for="tag in canteen.tags" :key="tag" class="pill">{{ tag }}</text>
      </view>
      <view class="stall-box">
        <view v-for="stall in stallsByCanteen(canteen.id)" :key="stall.id" class="stall-row">
          <view class="stall-dot"></view>
          <view class="flex-1">
            <text class="main-text">{{ stall.floor }} · {{ stall.name }}</text>
            <text class="sub-text">{{ stall.category }} · 人均 ¥{{ stall.avgPrice }} · {{ stall.description }}</text>
          </view>
          <text class="pill orange">{{ stall.rating.toFixed(1) }}</text>
        </view>
      </view>
    </view>

    <sc-state-card v-if="!store.canteens.value.length" type="empty" title="暂无食堂数据" desc="请确认后端已配置食堂、档口和菜品基础数据。" />
  </sc-page-shell>
</template>

<script setup>
import { onShow } from '@dcloudio/uni-app';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();

onShow(() => {
  if (!store.user.value) uni.redirectTo({ url: '/pages/login/login' });
});
async function reload() { await store.load(); }

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
.canteen-hero { margin-bottom: 24rpx; }
.canteen-card { position: relative; overflow: hidden; }
.canteen-top { align-items: flex-start; }
.canteen-title {
  display: block;
  margin-top: 8rpx;
  font-size: 38rpx;
  font-weight: 950;
}
.desc { margin-bottom: 20rpx; }
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin: 20rpx 0;
}
.crowd {
  min-width: 118rpx;
  padding: 16rpx 14rpx;
  border-radius: 28rpx;
  color: #fff;
  text-align: center;
}
.crowd.hot { background: linear-gradient(135deg, #ef6a4d, #d9482e); }
.crowd.warm { background: linear-gradient(135deg, #f2ad3c, #ef7b2d); }
.crowd.calm { background: linear-gradient(135deg, #00c78a, #008562); }
.crowd-num,
.crowd-label { display: block; }
.crowd-num { font-size: 30rpx; font-weight: 950; }
.crowd-label { margin-top: 4rpx; font-size: 19rpx; opacity: 0.82; }
.stall-box { margin-top: 10rpx; }
.stall-dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 999rpx;
  background: #00ab77;
  box-shadow: 0 0 0 8rpx #e8f8e1;
}
</style>
