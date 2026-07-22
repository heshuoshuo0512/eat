<template>
  <view class="page-shell" :class="[{ 'motion-reduced': reducedMotion, 'has-back': back }, `tone-${tone}`]">
    <view class="nav-safe" :style="{ height: `${statusBarHeight}px` }"></view>
    <view v-if="!hideNav" class="page-nav" :style="navStyle">
      <view class="nav-main">
        <button v-if="back" class="nav-back" aria-label="返回" @tap="goBack">
          <image src="/static/icons/chevron-left.png" mode="aspectFit" />
        </button>
        <view class="nav-copy">
          <text class="nav-title">{{ title }}</text>
          <text v-if="subtitle && !back" class="nav-subtitle">{{ subtitle }}</text>
        </view>
      </view>
      <view class="nav-action">
        <slot name="action">
          <view v-if="status" class="status-label"><text></text>{{ status }}</view>
        </slot>
      </view>
    </view>
    <view class="page-content" :class="{ 'content-no-nav': hideNav }"><slot></slot></view>
  </view>
</template>

<script setup>
import { computed } from 'vue';
import { useCanteenStore } from '../../stores/canteenStore.js';

const props = defineProps({
  tone: { type: String, default: 'default' },
  back: Boolean,
  hideNav: Boolean,
  title: { type: String, default: '智慧食堂' },
  subtitle: { type: String, default: '' },
  status: { type: String, default: '' }
});

const store = useCanteenStore();
const windowInfo = typeof uni.getWindowInfo === 'function' ? uni.getWindowInfo() : uni.getSystemInfoSync();
const statusBarHeight = Number(windowInfo.statusBarHeight || 20);
let capsule = null;
try { capsule = typeof uni.getMenuButtonBoundingClientRect === 'function' ? uni.getMenuButtonBoundingClientRect() : null; } catch { capsule = null; }
const navStyle = computed(() => ({ paddingRight: `${capsule?.width ? Math.max(16, windowInfo.windowWidth - capsule.left + 8) : 16}px` }));
const reducedMotion = computed(() => store.motionReduced.value);

function goBack() {
  const pages = getCurrentPages();
  if (pages.length > 1) uni.navigateBack();
  else uni.switchTab({ url: '/pages/home/home' });
}
</script>

<style scoped>
.page-shell { min-height:100vh; color:var(--ink); background:var(--bg); }
.nav-safe { background:var(--bg); }
.page-nav { position:sticky; top:0; z-index:20; display:flex; align-items:center; justify-content:space-between; min-height:96rpx; padding:8rpx var(--page-gutter) 12rpx; background:var(--bg); box-sizing:border-box; }
.nav-main { display:flex; align-items:center; gap:12rpx; min-width:0; }
.nav-back { display:flex; align-items:center; justify-content:center; width:88rpx; height:88rpx; flex:0 0 88rpx; padding:0; border-radius:50%; background:transparent; }
.nav-back:active { background:var(--surface-soft); }
.nav-back image { width:42rpx; height:42rpx; }
.nav-copy { min-width:0; }
.nav-title,.nav-subtitle { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.nav-title { color:var(--ink); font-size:34rpx; font-weight:600; line-height:1.25; }
.nav-subtitle { margin-top:2rpx; color:var(--muted); font-size:22rpx; line-height:1.35; }
.nav-action { flex:0 0 auto; }
.status-label { display:flex; align-items:center; gap:8rpx; min-height:48rpx; padding:0 12rpx; border-radius:12rpx; color:var(--brand); background:var(--brand-soft); font-size:22rpx; }
.status-label>text { width:8rpx; height:8rpx; border-radius:50%; background:var(--brand); }
.page-content { width:100%; max-width:750rpx; margin:0 auto; padding:20rpx var(--page-gutter) calc(56rpx + env(safe-area-inset-bottom)); box-sizing:border-box; }
.content-no-nav { padding-top:0; }
</style>
