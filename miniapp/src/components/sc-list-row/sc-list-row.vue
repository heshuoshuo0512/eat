<template>
  <button class="list-row" :class="tone ? `tone-${tone}` : ''" :disabled="disabled" @tap="$emit('tap')">
    <sc-icon v-if="iconName" :name="iconName" :size="18" tone="muted" />
    <view class="list-copy">
      <text class="list-title">{{ title }}</text>
      <text v-if="description" class="list-description">{{ description }}</text>
    </view>
    <view class="list-trailing">
      <text v-if="meta" class="list-meta">{{ meta }}</text>
      <text v-if="badge" class="list-badge" :class="`tone-${badgeTone}`">{{ badge }}</text>
      <slot name="trailing"></slot>
      <sc-icon v-if="showArrow" name="arrow-right" :size="16" tone="muted" />
    </view>
  </button>
</template>

<script setup>
defineProps({
  iconName: { type: String, default: '' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  meta: { type: [String, Number], default: '' },
  badge: { type: String, default: '' },
  badgeTone: { type: String, default: 'default' },
  tone: { type: String, default: '' },
  showArrow: { type: Boolean, default: true },
  disabled: Boolean
});
defineEmits(['tap']);
</script>

<style scoped>
.list-row { display:flex; align-items:center; gap:12px; width:100%; min-height:56px; padding:10px 4px; border-bottom:1px solid var(--line); text-align:left; transition:background-color var(--motion-base) var(--ease-standard),transform var(--motion-fast) var(--ease-standard); }
.list-row:last-child { border-bottom:0; }
.list-row:active { transform:translateY(1px); background:var(--module-soft); }
.list-row :deep(.sc-icon) { color:var(--module-accent); }
.list-row.tone-meal :deep(.sc-icon) { color:var(--brand); }
.list-row.tone-discover :deep(.sc-icon) { color:var(--discover); }
.list-row.tone-community :deep(.sc-icon) { color:var(--community); }
.list-row.tone-records :deep(.sc-icon),.list-row.tone-health :deep(.sc-icon) { color:var(--records); }
.list-row.tone-ranking :deep(.sc-icon) { color:var(--ranking); }
.list-copy { flex:1; min-width:0; }
.list-title,.list-description { display:block; overflow:hidden; text-overflow:ellipsis; }
.list-title { color:var(--ink); font-size:14px; font-weight:500; white-space:nowrap; }
.list-description { margin-top:3px; color:var(--muted); font-size:12px; line-height:1.4; }
.list-trailing { display:flex; flex:0 0 auto; align-items:center; gap:8px; max-width:48%; }
.list-meta { overflow:hidden; color:var(--ink-2); font-size:14px; font-weight:600; white-space:nowrap; text-overflow:ellipsis; }
.list-badge { min-height:22px; padding:0 7px; border:1px solid var(--line); border-radius:999px; color:var(--ink-2); background:var(--surface-soft); font-size:12px; line-height:20px; }
.list-badge.tone-warning { color:var(--warning); border-color:var(--warning-line); background:var(--warning-soft); }
.list-badge.tone-danger { color:var(--danger); border-color:var(--danger-line); background:var(--danger-soft); }
.list-badge.tone-success { color:var(--success); border-color:var(--success-line); background:var(--success-soft); }
.list-badge.tone-info { color:var(--info); border-color:var(--info-line); background:var(--info-soft); }
</style>
