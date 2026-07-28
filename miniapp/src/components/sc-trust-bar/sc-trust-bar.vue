<template>
  <view class="trust-bar">
    <view v-if="confidenceMetric"><text>检索可信度</text><text class="ui-strong">{{ confidenceMetric }}</text></view>
    <view v-for="item in metrics" :key="item.label"><text>{{ item.label }}</text><text class="ui-strong">{{ item.value }}</text></view>
  </view>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ evaluation: { type: Object, default: () => ({}) }, confidence: { type: Object, default: () => ({}) } });
function percent(value) { const number = Number(value); if (!Number.isFinite(number)) return '-'; const normalized = number <= 1 ? number * 100 : number; return `${Math.round(Math.max(0, Math.min(100, normalized)))}%`; }
const confidenceMetric = computed(() => ({ high: '高', medium: '中', low: '低' }[props.confidence?.level] || ''));
const metrics = computed(() => [
  { label: '依据充分度', value: percent(props.evaluation.groundednessScore) },
  { label: '工具成功率', value: percent(props.evaluation.toolSuccessRate) },
  { label: '安全性', value: percent(props.evaluation.safetyScore) }
]);
</script>

<style scoped>
.trust-bar { display:flex; margin-bottom:16px; overflow:hidden; border:1px solid var(--line); border-radius:var(--radius); background:var(--surface); }
.trust-bar view { flex:1; min-width:0; padding:10px 6px; border-right:1px solid var(--line); text-align:center; }
.trust-bar view:last-child { border-right:0; }
.trust-bar text,.trust-bar .ui-strong { display:block; }
.trust-bar text { overflow:hidden; color:var(--muted); font-size:12px; white-space:nowrap; text-overflow:ellipsis; }
.trust-bar .ui-strong { margin-top:3px; color:var(--ink); font-size:14px; font-weight:600; }
</style>
