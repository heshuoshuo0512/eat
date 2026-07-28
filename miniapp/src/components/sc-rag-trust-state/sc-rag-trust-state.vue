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
.trust-state { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.trust-chip { min-height:24px; padding:3px 8px; border:1px solid transparent; border-radius:6px; font-size:12px; font-weight:500; line-height:16px; box-sizing:border-box; }
.trust-chip.positive { color:var(--ink-2); background:var(--surface-soft); border-color:var(--line); }
.trust-chip.caution,.trust-chip.warning { color:var(--warning); background:var(--warning-soft); border-color:var(--warning-line); }
.trust-chip.muted { color:var(--muted); background:var(--surface-soft); border-color:var(--line); }
.trust-chip.danger { color:var(--danger); background:var(--danger-soft); border-color:var(--danger-line); }
.fact-meta { width:100%; color:var(--muted); font-size:12px; line-height:1.45; }
.compact { gap:4px; margin-top:6px; }
.compact .trust-chip { min-height:20px; padding:1px 6px; font-size:12px; line-height:16px; }
</style>
