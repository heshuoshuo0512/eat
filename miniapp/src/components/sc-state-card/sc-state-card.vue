<template>
  <view class="state-card" :class="`state-${type}`">
    <view class="state-icon">{{ icon }}</view>
    <view class="state-body">
      <text class="state-title">{{ title }}</text>
      <text v-if="desc" class="state-desc">{{ desc }}</text>
    </view>
    <button v-if="actionText" class="state-action" @tap="$emit('action')">{{ actionText }}</button>
  </view>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  type: { type: String, default: 'info' },
  title: { type: String, required: true },
  desc: { type: String, default: '' },
  actionText: { type: String, default: '' }
});

defineEmits(['action']);

const iconMap = { loading: '...', error: '!', empty: '-', info: 'i', success: 'OK' };
const icon = computed(() => iconMap[props.type] || iconMap.info);
</script>

<style scoped>
.state-card {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin: 0 0 22rpx;
  padding: 20rpx;
  border-radius: 30rpx;
  background: rgba(255,255,255,.84);
  border: 1rpx solid rgba(255,255,255,.58);
  box-shadow: 0 12rpx 32rpx rgba(21,62,43,.06);
  backdrop-filter: blur(22rpx) saturate(1.2);
}
.state-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48rpx;
  height: 48rpx;
  flex: 0 0 48rpx;
  border-radius: 999rpx;
  color: #fff;
  background: #58cfa0;
  font-size: 25rpx;
  font-weight: 850;
}
.state-error .state-icon { background: #d9544d; }
.state-empty .state-icon { background: #70877b; }
.state-success .state-icon { background: #1f9f72; }
.state-body { flex: 1; min-width: 0; }
.state-title { display:block; color:#20342b; font-size:26rpx; font-weight:850; }
.state-desc { display:block; margin-top:4rpx; color:#70877b; font-size:22rpx; line-height:1.42; }
.state-action {
  flex: 0 0 auto;
  padding: 8rpx 16rpx;
  border-radius: 999rpx;
  color: #1f9f72;
  background: #e9f8ef;
  font-size: 22rpx;
  font-weight: 750;
}
</style>
