<template>
  <view class="smart-composer">
    <view class="composer-head">
      <view class="composer-copy"><text class="composer-title">{{ title }}</text><text class="composer-subtitle">{{ subtitle }}</text></view>
      <button class="memory-toggle" @tap="$emit('toggle-memory')"><view>{{ memoryOpen ? '收起记忆' : '饮食记忆' }}</view></button>
    </view>
    <view class="input-panel">
      <textarea class="composer-input" :value="modelValue" :maxlength="300" :placeholder="placeholder" @input="$emit('update:modelValue', $event.detail.value)" />
      <button class="composer-submit" :loading="loading" :disabled="loading || !modelValue.trim()" @tap="$emit('submit')">{{ loading ? loadingText : actionText }}</button>
    </view>
    <scroll-view class="prompt-track" scroll-x enable-flex show-scrollbar="false">
      <view class="prompt-row"><button v-for="prompt in prompts" :key="prompt.id" class="prompt-chip" :disabled="loading" @tap="$emit('prompt', prompt.query)"><text>{{ prompt.label }}</text><text>{{ prompt.hint }}</text></button></view>
    </scroll-view>
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
.smart-composer { display:flex; flex-direction:column; gap:18rpx; margin-bottom:24rpx; }
.composer-head { display:flex; align-items:flex-end; justify-content:space-between; gap:18rpx; }
.composer-copy { min-width:0; }
.composer-title,.composer-subtitle { display:block; }
.composer-title { color:var(--ink); font-size:30rpx; font-weight:600; }
.composer-subtitle { margin-top:4rpx; color:var(--muted); font-size:24rpx; line-height:1.5; }
.memory-toggle { display:flex; align-items:center; justify-content:center; flex:0 0 auto; min-height:88rpx; padding:0 8rpx; background:transparent; }
.memory-toggle>view { display:flex; align-items:center; justify-content:center; min-height:56rpx; padding:0 14rpx; border-radius:10rpx; color:var(--brand); background:var(--brand-soft); font-size:24rpx; font-weight:500; white-space:nowrap; }
.memory-toggle:active>view { transform:scale(.97); }
.input-panel { overflow:hidden; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); box-shadow:var(--shadow-soft); }
.composer-input { width:100%; min-height:148rpx; padding:22rpx; color:var(--ink); background:transparent; font-size:28rpx; line-height:1.55; box-sizing:border-box; }
.composer-submit { width:calc(100% - 24rpx); min-height:88rpx; margin:0 12rpx 12rpx; border-radius:12rpx; color:#fff; background:var(--brand); font-size:28rpx; font-weight:500; }
.prompt-track { width:100%; white-space:nowrap; }
.prompt-row { display:flex; gap:12rpx; width:max-content; padding-right:24rpx; }
.prompt-chip { display:flex; width:232rpx; min-height:96rpx; flex-direction:column; justify-content:center; padding:14rpx 16rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); text-align:left; }
.prompt-chip text:first-child { color:var(--ink); font-size:24rpx; font-weight:600; }
.prompt-chip text:last-child { margin-top:4rpx; color:var(--muted); font-size:22rpx; }
.prompt-chip:active { transform:scale(.98); background:var(--brand-soft); }
.memory-panel { padding:20rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); animation:panel-in 200ms ease both; }
.memory-label { display:block; margin-bottom:10rpx; color:var(--ink); font-size:24rpx; font-weight:600; }
.memory-input { width:100%; min-height:128rpx; padding:18rpx; border:1rpx solid var(--line); border-radius:12rpx; color:var(--ink); background:var(--surface-soft); font-size:26rpx; line-height:1.5; box-sizing:border-box; }
.memory-actions { display:grid; grid-template-columns:1fr 1fr; gap:12rpx; margin-top:14rpx; }
.memory-actions .secondary-btn,.memory-actions .ghost-btn { min-height:64rpx; border-radius:10rpx; font-size:24rpx; }
@keyframes panel-in { from { opacity:0; transform:translateY(-6rpx); } to { opacity:1; transform:none; } }
</style>
