<template>
  <view class="illustration" :class="[`size-${size}`, `tone-${tone}`]" :aria-label="label">
    <image :src="source" mode="aspectFit" :alt="label" />
  </view>
</template>

<script setup>
import { computed } from 'vue';

const ASSETS = Object.freeze({
  brand: '/static/illustrations/brand-mark.svg',
  'empty-search': '/static/illustrations/empty-search.svg',
  'empty-community': '/static/illustrations/empty-community.svg',
  'empty-saved': '/static/illustrations/empty-saved.svg',
  vision: '/static/illustrations/vision-stage.svg',
  'order-complete': '/static/illustrations/order-complete.svg'
});

const props = defineProps({
  name: { type: String, required: true, validator: (value) => ['brand', 'empty-search', 'empty-community', 'empty-saved', 'vision', 'order-complete'].includes(value) },
  size: { type: String, default: 'medium', validator: (value) => ['small', 'medium', 'large'].includes(value) },
  tone: { type: String, default: 'neutral' },
  label: { type: String, default: '' }
});

const source = computed(() => ASSETS[props.name] || ASSETS.brand);
</script>

<style scoped>
.illustration { display:flex; align-items:center; justify-content:center; }
.illustration image { display:block; width:100%; height:100%; }
.size-small { width:52px; height:52px; }
.size-medium { width:132px; height:92px; }
.size-large { width:180px; height:124px; }
</style>
