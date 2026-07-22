<template>
  <view class="trust-bar">
    <view v-for="item in metrics" :key="item.label"><text>{{ item.label }}</text><text class="ui-strong">{{ item.value }}</text></view>
  </view>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ evaluation: { type: Object, default: () => ({}) } });
function percent(value) { const number = Number(value); if (!Number.isFinite(number)) return '-'; const normalized = number <= 1 ? number * 100 : number; return `${Math.round(Math.max(0, Math.min(100, normalized)))}%`; }
const metrics = computed(() => [
  { label: '依据充分度', value: percent(props.evaluation.groundednessScore) },
  { label: '工具成功率', value: percent(props.evaluation.toolSuccessRate) },
  { label: '安全性', value: percent(props.evaluation.safetyScore) }
]);
</script>

<style scoped>
.trust-bar { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); margin-bottom:20rpx; overflow:hidden; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); }
.trust-bar view { min-width:0; padding:16rpx 8rpx; border-right:1rpx solid var(--line); text-align:center; }
.trust-bar view:last-child { border-right:0; }
.trust-bar text,.trust-bar .ui-strong { display:block; }
.trust-bar text { overflow:hidden; color:var(--muted); font-size:22rpx; white-space:nowrap; text-overflow:ellipsis; }
.trust-bar .ui-strong { margin-top:4rpx; color:var(--brand-dark); font-size:28rpx; font-weight:600; }
</style>
