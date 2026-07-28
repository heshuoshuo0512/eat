<template>
  <view class="dish-media" :class="[`ratio-${ratio}`, `tone-${tone}`]">
    <image v-if="imageUrl && !failed" class="dish-image" :src="imageUrl" mode="aspectFill" lazy-load @error="handleError" />
    <view v-else class="dish-fallback">
      <text class="fallback-mark">{{ mark }}</text>
      <view class="fallback-copy">
        <text>{{ category }}</text>
        <text>{{ fallbackLabel }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { verifiedDishImageUrl } from '../../domain/dishPresentation.js';

const props = defineProps({
  dish: { type: Object, default: () => ({}) },
  ratio: { type: String, default: 'wide' },
  fallbackLabel: { type: String, default: '暂无实拍图' }
});
const emit = defineEmits(['error']);
const failed = ref(false);
const imageUrl = computed(() => verifiedDishImageUrl(props.dish));
const category = computed(() => String(props.dish?.cuisine || props.dish?.category || '校园风味'));
const mark = computed(() => category.value.slice(0, 1));
const tone = computed(() => {
  const source = `${category.value}${props.dish?.name || ''}`;
  return [...source].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4;
});
watch(imageUrl, () => { failed.value = false; });
function handleError(event) { failed.value = true; emit('error', event); }
</script>

<style scoped>
.dish-media { position:relative; overflow:hidden; width:100%; border-radius:var(--radius-large); background:var(--module-soft); }
.ratio-wide { aspect-ratio:16/9; }
.ratio-square { aspect-ratio:1; }
.dish-image { display:block; width:100%; height:100%; background:var(--surface-soft); }
.dish-fallback { position:absolute; inset:0; display:flex; align-items:flex-end; justify-content:space-between; gap:16px; padding:16px; box-sizing:border-box; }
.fallback-mark { color:rgba(201,59,66,.16); font-size:28px; font-weight:600; line-height:1; }
.fallback-copy { min-width:0; text-align:right; }
.fallback-copy text { display:block; color:var(--module-dark); font-size:12px; font-weight:600; }
.fallback-copy text+text { margin-top:3px; color:var(--muted); font-weight:400; }
.tone-1 { background:#fff7e8; }.tone-1 .fallback-mark { color:rgba(169,103,0,.12); }.tone-1 .fallback-copy text:first-child { color:var(--warning); }
.tone-2 { background:#edf8f2; }.tone-2 .fallback-mark { color:rgba(31,138,91,.12); }.tone-2 .fallback-copy text:first-child { color:var(--success); }
.tone-3 { background:#eef2ff; }.tone-3 .fallback-mark { color:rgba(49,94,251,.10); }.tone-3 .fallback-copy text:first-child { color:var(--info); }
</style>
