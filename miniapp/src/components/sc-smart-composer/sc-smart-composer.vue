<template>
  <view class="smart-composer">
    <view class="composer-head">
      <view class="composer-copy"><text class="composer-title">{{ title }}</text><text class="composer-subtitle">{{ subtitle }}</text></view>
    </view>
    <view class="input-panel">
      <textarea class="composer-input" :value="modelValue" :maxlength="300" :placeholder="placeholder" @input="$emit('update:modelValue', $event.detail.value)" />
    </view>
    <scroll-view class="prompt-track" scroll-x enable-flex show-scrollbar="false">
      <view class="prompt-row"><button v-for="prompt in prompts" :key="prompt.id" class="prompt-chip" :disabled="loading" @tap="$emit('prompt', prompt.query)"><text>{{ prompt.label }}</text></button></view>
    </scroll-view>
    <view class="composer-actions"><button class="memory-toggle" @tap="$emit('toggle-memory')"><sc-icon name="history" :size="16" /><text>{{ memoryOpen ? '收起记忆' : '饮食记忆' }}</text></button><button class="composer-submit" :loading="loading" :disabled="loading || !modelValue.trim()" @tap="$emit('submit')">{{ loading ? loadingText : actionText }}</button></view>
    <view v-if="memoryOpen" class="memory-panel">
      <text class="memory-label">长期饮食记忆</text>
      <textarea class="memory-input" :value="memoryDraft" :maxlength="500" placeholder="常吃口味、预算或不喜欢的食材" @input="$emit('update:memoryDraft', $event.detail.value)" />
      <view class="memory-actions"><button class="secondary-btn" :disabled="memorySaving" @tap="$emit('save-memory')">保存记忆</button><button class="ghost-btn" :disabled="memorySaving" @tap="$emit('clear-memory')">清除</button></view>
    </view>
  </view>
</template>

<script setup>
defineProps({
  title: { type: String, default: '帮我找菜' }, subtitle: { type: String, default: '描述预算、口味或营养目标。' },
  placeholder: { type: String, default: '例如：20 元以内，高蛋白，不要太辣的午餐' }, modelValue: { type: String, default: '' },
  prompts: { type: Array, default: () => [] }, loading: Boolean, actionText: { type: String, default: '找一找' },
  loadingText: { type: String, default: '分析中…' }, memoryOpen: Boolean, memoryDraft: { type: String, default: '' }, memorySaving: Boolean
});
defineEmits(['update:modelValue', 'update:memoryDraft', 'submit', 'prompt', 'toggle-memory', 'save-memory', 'clear-memory']);
</script>

<style scoped>
.smart-composer { display:flex; flex-direction:column; gap:12px; margin-bottom:16px; padding:16px; border:1px solid var(--module-line); border-radius:14px; background:var(--surface); box-sizing:border-box; }
.composer-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.composer-copy { min-width:0; }
.composer-title,.composer-subtitle { display:block; }
.composer-title { color:var(--ink); font-size:16px; font-weight:600; }
.composer-subtitle { margin-top:3px; color:var(--muted); font-size:12px; line-height:1.5; }
.memory-toggle { display:flex; min-height:44px; flex:0 0 auto; align-items:center; justify-content:center; gap:6px; padding:0 10px; border-radius:10px; color:var(--ink-2); background:var(--surface-soft); font-size:12px; font-weight:500; white-space:nowrap; }
.memory-toggle:active { transform:translateY(1px); opacity:.8; }
.input-panel { overflow:hidden; border:1px solid var(--line); border-radius:10px; background:var(--surface-soft); }
.composer-input { width:100%; min-height:92px; padding:14px; color:var(--ink); background:transparent; font-size:14px; line-height:1.55; box-sizing:border-box; }
.composer-actions { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.composer-submit { min-width:112px; min-height:44px; padding:0 18px; border-radius:10px; color:#fff; background:var(--module-accent); font-size:14px; font-weight:600; }
.composer-submit:active { transform:translateY(1px); background:var(--module-dark); }
.prompt-track { width:100%; white-space:nowrap; }
.prompt-row { display:flex; gap:8px; width:max-content; padding-right:16px; }
.prompt-chip { display:flex; min-height:36px; align-items:center; justify-content:center; padding:0 12px; border:1px solid var(--module-line); border-radius:999px; background:var(--module-soft); text-align:center; }
.prompt-chip text { color:var(--module-dark); font-size:12px; font-weight:500; }
.prompt-chip:active { transform:translateY(1px); opacity:.78; }
.memory-panel { padding:14px; border:1px solid var(--line); border-radius:var(--radius-large); background:var(--surface); animation:panel-in 200ms ease both; }
.memory-label { display:block; margin-bottom:8px; color:var(--ink); font-size:14px; font-weight:600; }
.memory-input { width:100%; min-height:84px; padding:12px; border:1px solid var(--line); border-radius:var(--radius); color:var(--ink); background:var(--surface-soft); font-size:14px; line-height:1.5; box-sizing:border-box; }
.memory-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px; }
@keyframes panel-in { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:none; } }
@media (max-width:359px) { .smart-composer { padding:13px; }.composer-actions { align-items:stretch; flex-direction:column; }.memory-toggle,.composer-submit { width:100%; } }
</style>
