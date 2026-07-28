<template>
  <view class="state-card" :class="[`state-${type}`, { illustrated: illustration }]">
    <sc-illustration v-if="illustration" :name="illustration" size="medium" :label="title" />
    <view v-else class="state-icon"><wd-loading v-if="type==='loading'" type="dots" size="18px" color="var(--module-accent)" /><sc-icon v-else :name="icon" :size="18" :tone="type==='error'?'danger':type==='success'?'success':'muted'" /></view>
    <view class="state-body"><text class="state-title">{{ title }}</text><text v-if="desc" class="state-desc">{{ desc }}</text></view>
    <button v-if="actionText" class="state-action" @tap="$emit('action')">{{ actionText }}</button>
  </view>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ type: { type: String, default: 'info' }, title: { type: String, required: true }, desc: { type: String, default: '' }, actionText: { type: String, default: '' }, illustration: { type: String, default: '' } });
defineEmits(['action']);
const iconMap = { error: 'exclamation-circle', empty: 'empty', info: 'info-circle', success: 'check-circle' };
const icon = computed(() => iconMap[props.type] || iconMap.info);
</script>

<style scoped>
.state-card { display:flex; align-items:center; gap:12px; margin:0 0 12px; padding:14px; border:1px solid var(--line); border-radius:var(--radius-large); background:var(--surface); }
.state-card.illustrated { min-height:190px; flex-direction:column; justify-content:center; padding:24px; text-align:center; }
.illustrated .state-body { flex:0 1 auto; }
.illustrated .state-action { min-height:44px; margin-top:4px; padding:0 16px; border-color:var(--module-line); color:var(--module-dark); background:var(--module-soft); }
.state-icon { display:flex; width:32px; height:32px; flex:0 0 32px; align-items:center; justify-content:center; border-radius:8px; color:var(--ink); background:var(--surface-soft); }
.state-error .state-icon { color:var(--danger); background:var(--danger-soft); }
.state-success .state-icon { color:var(--success); background:var(--success-soft); }
.state-empty .state-icon { color:var(--muted); background:var(--surface-soft); }
.state-body { flex:1; min-width:0; }
.state-title { display:block; color:var(--ink); font-size:14px; font-weight:600; }
.state-desc { display:block; margin-top:3px; color:var(--muted); font-size:12px; line-height:1.45; }
.state-action { display:flex; min-height:36px; flex:0 0 auto; align-items:center; justify-content:center; padding:0 10px; border:1px solid var(--line); border-radius:var(--radius); color:var(--ink); background:var(--surface); font-size:12px; font-weight:500; }
</style>
