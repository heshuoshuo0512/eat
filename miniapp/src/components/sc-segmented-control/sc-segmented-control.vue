<template>
  <view class="segmented" :class="[{ block }, `density-${density}`]">
    <view class="segmented-surface">
      <button v-for="option in options" :key="option.value" class="segment-button" :class="{ active: option.value === modelValue }" :aria-pressed="option.value === modelValue" @tap="$emit('update:modelValue', option.value)"><view class="segment-visual">{{ option.label }}</view></button>
    </view>
  </view>
</template>

<script setup>
defineProps({ modelValue: { type: [String, Number], default: '' }, options: { type: Array, default: () => [] }, block: Boolean, density: { type: String, default: 'regular' } });
defineEmits(['update:modelValue']);
</script>

<style scoped>
.segmented { display:inline-flex; align-items:center; min-width:0; min-height:88rpx; }
.segmented.block { display:flex; width:100%; }
.segmented-surface { display:flex; min-width:0; height:72rpx; padding:4rpx; border-radius:14rpx; background:var(--surface-soft); box-sizing:border-box; }
.block .segmented-surface { width:100%; }
.segment-button { display:flex; align-items:center; justify-content:center; height:88rpx; min-height:88rpx; flex:1; min-width:0; margin-top:-12rpx; padding:0 4rpx; color:var(--muted); background:transparent; white-space:nowrap; }
.segment-visual { display:flex; align-items:center; justify-content:center; width:100%; height:64rpx; padding:0 14rpx; border-radius:10rpx; font-size:24rpx; font-weight:500; line-height:1.2; box-sizing:border-box; transition:background-color 180ms ease,color 180ms ease,transform 180ms ease; }
.segment-button.active .segment-visual { color:var(--ink); background:var(--surface); box-shadow:0 2rpx 8rpx rgba(23,33,27,.06); }
.segment-button:active .segment-visual { transform:scale(.97); }
.density-compact .segmented-surface { height:64rpx; border-radius:12rpx; }
.density-compact .segment-button { margin-top:-16rpx; }
.density-compact .segment-visual { height:56rpx; padding:0 12rpx; border-radius:9rpx; font-size:22rpx; }
</style>
