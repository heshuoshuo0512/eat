<template>
  <view class="page-shell" :class="toneClass">
    <view class="nav-safe"></view>
    <view class="brand-nav">
      <view class="brand-left">
        <button v-if="back" class="nav-back" @tap="goBack">‹</button>
        <view class="brand-mark">食</view>
        <view>
          <text class="brand-name">{{ title }}</text>
          <text class="brand-sub">{{ subtitle }}</text>
        </view>
      </view>
      <view class="nav-right">
        <slot name="action">
          <view class="status-pill">
            <text class="status-dot"></text>
            <text>{{ status }}</text>
          </view>
        </slot>
      </view>
    </view>
    <view class="page-content">
      <slot></slot>
    </view>
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
.page-shell {
  min-height: 100vh;
  background:
    radial-gradient(circle at 16% 0%, rgba(195, 246, 213, 0.86), transparent 38%),
    radial-gradient(circle at 100% 10%, rgba(224, 245, 186, 0.78), transparent 34%),
    linear-gradient(180deg, #f7fff8 0%, #ecf9f0 50%, #f3fbf5 100%);
  color: #20342b;
}
.tone-orange {
  background:
    radial-gradient(circle at 10% 0%, rgba(204, 248, 216, 0.95), transparent 36%),
    radial-gradient(circle at 100% 12%, rgba(224, 245, 186, 0.78), transparent 34%),
    linear-gradient(180deg, #f7fff8 0%, #e9f8ef 100%);
}
.tone-blue {
  background:
    radial-gradient(circle at 12% 0%, rgba(210, 226, 255, 0.95), transparent 36%),
    radial-gradient(circle at 95% 10%, rgba(210, 246, 220, 0.75), transparent 34%),
    linear-gradient(180deg, #f4f7ff 0%, #f3fbf5 100%);
}
.nav-safe { height: 56rpx; }
.brand-nav {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 96rpx;
  padding: 0 28rpx 12rpx;
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(30rpx) saturate(1.35);
  border-bottom: 1rpx solid rgba(255, 255, 255, 0.42);
  box-sizing: border-box;
}
.brand-left {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.nav-right {
  display: flex;
  align-items: center;
  min-width: 0;
}
.nav-back {
  width: 56rpx;
  height: 56rpx;
  padding: 0;
  border-radius: 999rpx;
  color: #20342b;
  background: rgba(255, 255, 255, 0.78);
  font-size: 46rpx;
  line-height: 50rpx;
}
.brand-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64rpx;
  height: 64rpx;
  border-radius: 22rpx;
  color: #fff;
  background: linear-gradient(135deg, #6cddb0, #1f9f72);
  box-shadow: 0 16rpx 34rpx rgba(88, 207, 160, 0.22);
  font-size: 31rpx;
  font-weight: 850;
}
.brand-name,
.brand-sub { display: block; }
.brand-name {
  color: #20342b;
  font-size: 30rpx;
  font-weight: 850;
  letter-spacing: -0.2rpx;
}
.brand-sub {
  margin-top: 2rpx;
  color: #70877b;
  font-size: 18rpx;
  letter-spacing: 1.8rpx;
  text-transform: uppercase;
}
.status-pill {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 10rpx 16rpx;
  border-radius: 999rpx;
  color: #1f9f72;
  background: rgba(255, 255, 255, 0.74);
  backdrop-filter: blur(18rpx) saturate(1.25);
  box-shadow: 0 10rpx 26rpx rgba(21, 62, 43, 0.07);
  font-size: 22rpx;
  font-weight: 750;
}
.status-dot {
  width: 10rpx;
  height: 10rpx;
  border-radius: 999rpx;
  background: #58cfa0;
  box-shadow: 0 0 0 6rpx rgba(88, 207, 160, 0.14);
}

@keyframes nav-pop {
  from { opacity: 0; transform: translateY(-10rpx); }
  to { opacity: 1; transform: translateY(0); }
}

.brand-nav { animation: nav-pop 320ms ease-out both; }
.brand-mark { animation: sc-mark-float 3.8s ease-in-out infinite; }

@keyframes sc-mark-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4rpx); }
}
.page-content {
  padding: 0 28rpx 44rpx;
  box-sizing: border-box;
}
</style>
