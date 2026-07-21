<template>
  <section class="card smart-meal-composer">
    <div class="composer-heading">
      <div>
        <p class="eyebrow">Smart Meal</p>
        <h2>{{ title }}</h2>
        <p>{{ subtitle }}</p>
      </div>
      <button class="ghost memory-toggle" type="button" :aria-expanded="memoryOpen" @click="$emit('toggle-memory')">
        {{ memoryOpen ? '收起记忆' : '饮食记忆' }}
      </button>
    </div>

    <form class="composer-form" @submit.prevent="$emit('submit')">
      <textarea
        :value="modelValue"
        maxlength="300"
        :placeholder="placeholder"
        @input="$emit('update:modelValue', $event.target.value)"
      />
      <button class="primary composer-submit" type="submit" :disabled="loading || !modelValue.trim()">
        {{ loading ? loadingText : actionText }}
      </button>
    </form>

    <div class="profile-prompts" aria-label="根据健康档案生成的快捷提问">
      <button
        v-for="prompt in prompts"
        :key="prompt.id"
        type="button"
        class="profile-prompt"
        :disabled="loading"
        @click="$emit('prompt', prompt.query)"
      >
        <strong>{{ prompt.label }}</strong>
        <small>{{ prompt.hint }}</small>
      </button>
    </div>

    <Transition name="memory-panel">
      <div v-if="memoryOpen" class="memory-panel">
        <label>
          <span>饮食记忆</span>
          <textarea
            :value="memoryDraft"
            maxlength="500"
            placeholder="记录常吃口味、预算或不喜欢的食材"
            @input="$emit('update:memoryDraft', $event.target.value)"
          />
        </label>
        <div>
          <button class="secondary" type="button" :disabled="memorySaving" @click="$emit('save-memory')">保存记忆</button>
          <button class="ghost" type="button" :disabled="memorySaving" @click="$emit('clear-memory')">清除</button>
        </div>
      </div>
    </Transition>
  </section>
</template>

<script setup>
defineProps({
  title: { type: String, default: '帮我找菜' },
  subtitle: { type: String, default: '描述这一餐的预算、口味或营养目标。' },
  placeholder: { type: String, default: '例如：20 元以内，高蛋白，不要太辣的午餐' },
  modelValue: { type: String, default: '' },
  prompts: { type: Array, default: () => [] },
  loading: Boolean,
  loadingText: { type: String, default: '分析中…' },
  actionText: { type: String, default: '帮我找菜' },
  memoryOpen: Boolean,
  memoryDraft: { type: String, default: '' },
  memorySaving: Boolean
});

defineEmits([
  'update:modelValue',
  'update:memoryDraft',
  'submit',
  'prompt',
  'toggle-memory',
  'save-memory',
  'clear-memory'
]);
</script>

<style scoped>
.smart-meal-composer { display: grid; gap: 16px; padding: 20px; overflow: hidden; }
.composer-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.composer-heading h2 { margin: 0; font-size: 20px; }
.composer-heading p:not(.eyebrow) { margin: 6px 0 0; color: var(--muted); line-height: 1.55; }
.memory-toggle { flex: 0 0 auto; min-height: 40px; }
.composer-form { display: grid; grid-template-columns: minmax(0, 1fr) 132px; gap: 10px; align-items: stretch; }
.composer-form textarea { min-height: 74px; resize: none; padding: 14px 16px; line-height: 1.55; }
.composer-submit { min-height: 74px; }
.profile-prompts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 9px; }
.profile-prompt { min-width: 0; min-height: 64px; display: grid; align-content: center; gap: 4px; padding: 10px 12px; text-align: left; border: 1px solid rgba(31, 122, 77, .14); background: #f8fbf7; color: var(--text); transition: transform .2s ease, border-color .2s ease, background .2s ease; }
.profile-prompt:hover { transform: translateY(-2px); border-color: rgba(31, 122, 77, .34); background: #eef7eb; }
.profile-prompt strong, .profile-prompt small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.profile-prompt small { color: var(--muted); font-size: 11px; }
.memory-panel { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: end; padding-top: 14px; border-top: 1px solid rgba(31, 122, 77, .12); }
.memory-panel label { display: grid; gap: 7px; }
.memory-panel textarea { min-height: 82px; resize: vertical; }
.memory-panel > div { display: grid; gap: 8px; }
.memory-panel-enter-active, .memory-panel-leave-active { transition: opacity .22s ease, transform .22s ease; }
.memory-panel-enter-from, .memory-panel-leave-to { opacity: 0; transform: translateY(-8px); }
@media (max-width: 860px) { .profile-prompts { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 620px) {
  .smart-meal-composer { padding: 16px; }
  .composer-heading { align-items: stretch; flex-direction: column; }
  .memory-toggle { width: 100%; }
  .composer-form { grid-template-columns: 1fr; }
  .composer-submit { min-height: 46px; }
  .profile-prompts { display: flex; overflow-x: auto; padding-bottom: 4px; scroll-snap-type: x mandatory; }
  .profile-prompt { flex: 0 0 72%; scroll-snap-align: start; }
  .memory-panel { grid-template-columns: 1fr; }
  .memory-panel > div { grid-template-columns: repeat(2, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .profile-prompt, .memory-panel-enter-active, .memory-panel-leave-active { transition: none; }
}
</style>
