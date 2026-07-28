<template>
  <view class="responsive-panel">
    <button v-if="!isWide" class="panel-trigger" @tap="$emit('update:modelValue', true)">
      <sc-icon :name="iconName" :size="16" />
      <text>{{ title }}</text>
      <text v-if="activeCount" class="active-count">{{ activeCount }}</text>
    </button>

    <view v-if="isWide" class="panel-wide">
      <view class="panel-heading"><sc-icon :name="iconName" :size="18" /><text>{{ title }}</text></view>
      <slot></slot>
    </view>

    <wd-popup v-else :model-value="modelValue" position="bottom" round safe-area-inset-bottom root-portal @update:model-value="$emit('update:modelValue', $event)">
      <view class="panel-sheet">
        <view class="panel-sheet__head"><view><sc-icon :name="iconName" :size="18" /><text>{{ title }}</text></view><button aria-label="关闭" @tap="$emit('update:modelValue', false)"><sc-icon name="close" :size="18" /></button></view>
        <scroll-view scroll-y class="panel-sheet__body"><slot></slot></scroll-view>
        <button class="primary-btn panel-sheet__done" @tap="$emit('update:modelValue', false)">完成</button>
      </view>
    </wd-popup>
  </view>
</template>

<script setup>
import { useResponsiveLayout } from '../../composables/useResponsiveLayout.js';

defineProps({
  modelValue: Boolean,
  title: { type: String, default: '筛选' },
  iconName: { type: String, default: 'filter' },
  activeCount: { type: Number, default: 0 }
});
defineEmits(['update:modelValue']);
const { isWide } = useResponsiveLayout();
</script>

<style scoped>
.panel-trigger { display:flex; align-items:center; gap:7px; min-height:44px; padding:0 12px; border:1px solid var(--line); border-radius:var(--radius); color:var(--ink); background:var(--surface); font-size:14px; font-weight:500; }
.panel-trigger:active { transform:translateY(1px); background:var(--surface-soft); }
.active-count { display:flex; min-width:18px; height:18px; align-items:center; justify-content:center; border-radius:999px; color:#fff; background:var(--module-accent); font-size:12px; }
.panel-wide { padding:16px; border:1px solid var(--module-line); border-radius:var(--radius-large); background:var(--module-soft); }
.panel-heading { display:flex; align-items:center; gap:8px; margin-bottom:14px; color:var(--ink); font-size:14px; font-weight:600; }
.panel-sheet { max-height:88vh; padding:16px 16px calc(16px + env(safe-area-inset-bottom)); border-radius:16px 16px 0 0; background:var(--surface); box-shadow:var(--shadow-soft); box-sizing:border-box; }
.panel-sheet__head { display:flex; min-height:44px; align-items:center; justify-content:space-between; gap:12px; }
.panel-sheet__head>view { display:flex; align-items:center; gap:8px; font-size:16px; font-weight:600; }
.panel-sheet__head>button { display:flex; width:44px; height:44px; align-items:center; justify-content:center; border-radius:50%; }
.panel-sheet__head>button:active { background:var(--surface-soft); }
.panel-sheet__body { max-height:calc(88vh - 132px); }
.panel-sheet__done { width:100%; margin-top:12px; }
</style>
