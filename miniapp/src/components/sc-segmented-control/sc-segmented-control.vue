<template>
  <view class="segmented" :class="[{ block }, `density-${density}`]">
    <wd-segmented :value="modelValue" :options="options" custom-class="sc-wd-segmented" @update:value="$emit('update:modelValue', $event)">
      <template #label="{ option }"><text>{{ option.label || option.value }}</text></template>
    </wd-segmented>
  </view>
</template>

<script setup>
defineProps({ modelValue: { type: [String, Number], default: '' }, options: { type: Array, default: () => [] }, block: Boolean, density: { type: String, default: 'regular' } });
defineEmits(['update:modelValue']);
</script>

<style scoped>
.segmented { display:inline-flex; min-width:0; min-height:44px; align-items:center; }
.segmented.block { display:flex; width:100%; }
.segmented :deep(.wd-segmented) { width:100%; min-width:0; height:36px; padding:2px; border-radius:8px; background:var(--surface-soft); box-sizing:border-box; }
.segmented :deep(.wd-segmented__item) { min-width:0; height:32px; padding:0 8px; color:var(--muted); font-size:14px; font-weight:500; }
.segmented :deep(.wd-segmented__item-label) { position:relative; z-index:2; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.segmented :deep(.wd-segmented__item.is-active) { color:var(--module-dark); }
.segmented :deep(.wd-segmented__slider) { top:2px; bottom:2px; height:32px; border:1px solid var(--module-line); border-radius:6px; background:var(--surface); box-shadow:none; transition:transform 220ms var(--ease-spring),width 220ms var(--ease-standard); }
.density-compact :deep(.wd-segmented) { height:32px; border-radius:7px; }
.density-compact :deep(.wd-segmented__item) { height:28px; padding:0 7px; font-size:12px; }
.density-compact :deep(.wd-segmented__slider) { height:28px; border-radius:5px; }
</style>
