<template>
  <div v-if="model.confidence || model.safety || model.factMeta" class="rag-trust-state" :class="{ compact }">
    <span v-if="model.confidence" class="trust-chip" :class="model.confidence.tone" :title="model.confidence.detail">
      {{ model.confidence.label }}<small v-if="!compact">{{ model.confidence.detail }}</small>
    </span>
    <span v-if="model.safety" class="trust-chip" :class="model.safety.tone" :title="model.safety.detail">
      {{ model.safety.label }}<small v-if="!compact">{{ model.safety.detail }}</small>
    </span>
    <small v-if="model.factMeta && !compact" class="fact-meta">{{ model.factMeta }}</small>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { ragPresentation } from '../domain/ragPresentation.js';

const props = defineProps({ item: { type: Object, default: () => ({}) }, compact: Boolean });
const model = computed(() => ragPresentation(props.item));
</script>

<style scoped>
.rag-trust-state { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:8px; }
.trust-chip { display:inline-flex; align-items:center; gap:6px; min-height:26px; padding:4px 8px; border:1px solid transparent; border-radius:6px; font-size:12px; font-weight:650; line-height:1.35; }
.trust-chip small { font-size:11px; font-weight:500; opacity:.82; }
.trust-chip.positive { color:#176344; background:#edf7f2; border-color:#cfe7dc; }
.trust-chip.caution { color:#85580e; background:#fff7e8; border-color:#f1ddb6; }
.trust-chip.muted { color:#596660; background:#f2f4f3; border-color:#dfe4e1; }
.trust-chip.warning { color:#874f08; background:#fff1d6; border-color:#eecb83; }
.trust-chip.danger { color:#a13d2c; background:#fff0ec; border-color:#efc6bc; }
.fact-meta { flex-basis:100%; color:var(--muted); font-size:11px; line-height:1.45; }
.compact { margin-top:5px; gap:4px; }
.compact .trust-chip { min-height:22px; padding:2px 6px; font-size:11px; }
</style>
