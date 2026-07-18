<template>
  <view class="page-shell" :class="toneClass">
    <view class="nav-safe"></view>
    <view class="brand-nav">
      <view class="brand-left">
        <button v-if="back" class="nav-back" @tap="goBack">‹</button>
        <view class="brand-mark">食</view>
        <view class="brand-copy">
          <text class="brand-name">{{ title }}</text>
          <text class="brand-sub">{{ subtitle }}</text>
        </view>
      </view>
      <view class="nav-right">
        <slot name="action">
          <view class="status-pill"><text class="status-dot"></text><text>{{ status }}</text></view>
        </slot>
      </view>
    </view>
    <view class="page-content"><slot></slot></view>
  </view>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  tone: { type: String, default: 'green' },
  back: { type: Boolean, default: false },
  title: { type: String, default: '智慧食堂' },
  subtitle: { type: String, default: 'Smart Canteen' },
  status: { type: String, default: '营业中' }
});

const toneClass = computed(() => `tone-${props.tone}`);

function goBack() {
  const pages = getCurrentPages();
  if (pages.length > 1) uni.navigateBack();
  else uni.switchTab({ url: '/pages/home/home' });
}
</script>

<style scoped>
.page-shell { min-height:100vh; background:#f4f7f5; color:#18251f; }
.tone-orange { background:#f8f7f2; }
.tone-blue { background:#f3f7fb; }
.nav-safe { height:44rpx; background:#fff; }
.brand-nav { position:sticky; top:0; z-index:20; display:flex; align-items:center; justify-content:space-between; min-height:104rpx; padding:0 30rpx 12rpx; background:#fff; border-bottom:1rpx solid #e9eeeb; box-sizing:border-box; }
.brand-left { display:flex; align-items:center; gap:16rpx; min-width:0; }
.brand-copy { min-width:0; }
.nav-right { display:flex; align-items:center; }
.nav-back { width:58rpx; height:58rpx; padding:0; border-radius:18rpx; color:#18251f; background:#f3f6f4; font-size:46rpx; line-height:52rpx; }
.brand-mark { display:flex; align-items:center; justify-content:center; width:66rpx; height:66rpx; border-radius:20rpx; color:#fff; background:#167a5b; font-size:32rpx; font-weight:900; }
.brand-name,.brand-sub { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.brand-name { color:#18251f; font-size:31rpx; font-weight:900; }
.brand-sub { margin-top:4rpx; color:#84918a; font-size:19rpx; }
.status-pill { display:flex; align-items:center; gap:8rpx; padding:10rpx 16rpx; border-radius:999rpx; color:#167a5b; background:#edf7f1; font-size:21rpx; font-weight:800; }
.status-dot { width:10rpx; height:10rpx; border-radius:50%; background:#35b27f; }
.page-content { width:100%; max-width:750rpx; margin:0 auto; padding:28rpx 30rpx 56rpx; box-sizing:border-box; }
</style>
