<template>
  <view v-if="model.confidence || model.safety || model.factMeta" class="trust-state" :class="{ compact }">
    <text v-if="model.confidence" class="trust-chip" :class="model.confidence.tone">{{ model.confidence.label }}<text v-if="!compact"> · {{ model.confidence.detail }}</text></text>
    <text v-if="model.safety" class="trust-chip" :class="model.safety.tone">{{ model.safety.label }}<text v-if="!compact"> · {{ model.safety.detail }}</text></text>
    <text v-if="model.factMeta&&!compact" class="fact-meta">{{ model.factMeta }}</text>
  </view>
</template>

<script setup>
import { computed } from 'vue';
import { ragPresentation } from '../../domain/ragPresentation.js';
const props = defineProps({ item: { type: Object, default: () => ({}) }, compact: Boolean });
const model = computed(() => ragPresentation(props.item));
</script>

<style scoped>
.trust-state { display:flex; flex-wrap:wrap; gap:8rpx; margin-top:10rpx; }
.trust-chip { min-height:40rpx; padding:4rpx 10rpx; border:1rpx solid transparent; border-radius:8rpx; font-size:22rpx; font-weight:500; line-height:32rpx; box-sizing:border-box; }
.trust-chip.positive { color:#176344; background:#edf7f2; border-color:#cfe7dc; }
.trust-chip.caution { color:#85580e; background:#fff7e8; border-color:#f1ddb6; }
.trust-chip.muted { color:#596660; background:#f2f4f3; border-color:#dfe4e1; }
.trust-chip.warning { color:#874f08; background:#fff1d6; border-color:#eecb83; }
.trust-chip.danger { color:#a13d2c; background:#fff0ec; border-color:#efc6bc; }
.fact-meta { width:100%; color:var(--muted); font-size:22rpx; line-height:1.45; }
.compact { gap:6rpx; margin-top:6rpx; }
.compact .trust-chip { min-height:34rpx; padding:1rpx 8rpx; font-size:22rpx; line-height:30rpx; }
</style>
