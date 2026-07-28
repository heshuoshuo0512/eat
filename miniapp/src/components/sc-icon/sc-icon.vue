<template>
  <view class="sc-icon" :class="`tone-${tone}`" aria-hidden="true">
    <wd-icon :name="safeName" :size="`${safeSize}px`" />
  </view>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  name: { type: String, default: 'info-circle' },
  size: { type: Number, default: 18 },
  tone: { type: String, default: 'default' }
});

const safeName = computed(() => props.name && !props.name.includes('/') ? props.name : 'info-circle');
const safeSize = computed(() => [16, 18, 20].includes(Number(props.size)) ? Number(props.size) : 18);
</script>

<style scoped>
.sc-icon { display:flex; width:20px; height:20px; flex:0 0 20px; align-items:center; justify-content:center; color:var(--ink); line-height:1; }
.tone-muted { color:var(--muted); }
.tone-current { color:inherit; }
.tone-inverted { color:#fff; }
.tone-danger { color:var(--danger); }
.tone-warning { color:var(--warning); }
.tone-brand { color:var(--brand); }
.tone-success { color:var(--success); }
.tone-info { color:var(--info); }
</style>
