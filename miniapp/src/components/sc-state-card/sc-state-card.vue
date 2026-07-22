<template>
  <view class="state-card" :class="`state-${type}`">
    <view class="state-icon">{{ icon }}</view>
    <view class="state-body"><text class="state-title">{{ title }}</text><text v-if="desc" class="state-desc">{{ desc }}</text></view>
    <button v-if="actionText" class="state-action" @tap="$emit('action')">{{ actionText }}</button>
  </view>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ type: { type: String, default: 'info' }, title: { type: String, required: true }, desc: { type: String, default: '' }, actionText: { type: String, default: '' } });
defineEmits(['action']);
const iconMap = { loading: '…', error: '!', empty: '—', info: 'i', success: '✓' };
const icon = computed(() => iconMap[props.type] || iconMap.info);
</script>

<style scoped>
.state-card { display:flex; align-items:center; gap:16rpx; margin:0 0 20rpx; padding:22rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); }
.state-icon { display:flex; align-items:center; justify-content:center; width:48rpx; height:48rpx; flex:0 0 48rpx; border-radius:50%; color:var(--brand); background:var(--brand-soft); font-size:24rpx; font-weight:600; }
.state-error .state-icon { color:var(--danger); background:var(--danger-soft); }
.state-empty .state-icon { color:var(--muted); background:var(--surface-soft); }
.state-body { flex:1; min-width:0; }
.state-title { display:block; color:var(--ink); font-size:26rpx; font-weight:600; }
.state-desc { display:block; margin-top:4rpx; color:var(--muted); font-size:24rpx; line-height:1.45; }
.state-action { display:flex; align-items:center; justify-content:center; flex:0 0 auto; min-height:64rpx; padding:0 16rpx; border-radius:10rpx; color:var(--brand); background:var(--brand-soft); font-size:24rpx; font-weight:500; }
</style>
