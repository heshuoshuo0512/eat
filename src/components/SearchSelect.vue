<template>
  <div ref="root" class="search-select" @focusout="closeAfterFocus">
    <div class="search-select-input">
      <input
        v-model="query"
        type="search"
        :placeholder="placeholder"
        :aria-label="ariaLabel || placeholder"
        autocomplete="off"
        @focus="open = true"
        @input="onInput"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="selectHighlighted"
        @keydown.esc="open = false"
      >
      <button v-if="modelValue" type="button" class="clear-select" title="清除选择" aria-label="清除选择" @click="clear">×</button>
      <button type="button" class="toggle-select" title="展开选项" aria-label="展开选项" @click="open = !open">⌄</button>
    </div>
    <ul v-if="open" class="search-select-menu" role="listbox">
      <li v-for="(option, index) in filteredOptions" :key="option.id">
        <div
          v-if="option.group && (index === 0 || filteredOptions[index - 1]?.group !== option.group)"
          class="search-select-group"
        >{{ option.group }}</div>
        <button
          type="button"
          :class="{ highlighted: index === highlighted, selected: String(option.id) === String(modelValue) }"
          role="option"
          :aria-selected="String(option.id) === String(modelValue)"
          @mousedown.prevent="choose(option)"
        >
          <strong>{{ option.label || option.name }}</strong>
          <small v-if="option.description">{{ option.description }}</small>
        </button>
      </li>
      <li v-if="!filteredOptions.length" class="search-select-empty">没有匹配项</li>
    </ul>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '输入或展开选择' },
  ariaLabel: { type: String, default: '' }
});
const emit = defineEmits(['update:modelValue', 'change', 'search']);
const root = ref(null);
const open = ref(false);
const highlighted = ref(0);
const query = ref('');

const selected = computed(() => props.options.find((option) => String(option.id) === String(props.modelValue)) || null);
const filteredOptions = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase();
  if (!keyword || selected.value && query.value === (selected.value.label || selected.value.name)) return props.options.slice(0, 80);
  return props.options.filter((option) => [option.label, option.name, option.description]
    .filter(Boolean).join(' ').toLocaleLowerCase().includes(keyword)).slice(0, 80);
});

watch(() => props.modelValue, () => {
  query.value = selected.value?.label || selected.value?.name || '';
}, { immediate: true });
watch(() => props.options, () => {
  if (props.modelValue && selected.value) query.value = selected.value.label || selected.value.name || '';
}, { deep: true });

function onInput() {
  open.value = true;
  highlighted.value = 0;
  if (props.modelValue) { emit('update:modelValue', ''); emit('change', ''); }
  emit('search', query.value);
}
function choose(option) {
  emit('update:modelValue', option.id);
  emit('change', option.id);
  query.value = option.label || option.name;
  open.value = false;
}
function clear() {
  query.value = '';
  emit('update:modelValue', '');
  emit('change', '');
  emit('search', '');
  open.value = true;
}
function move(direction) {
  open.value = true;
  highlighted.value = Math.max(0, Math.min(filteredOptions.value.length - 1, highlighted.value + direction));
}
function selectHighlighted() {
  const option = filteredOptions.value[highlighted.value];
  if (option) choose(option);
}
function closeAfterFocus() {
  window.setTimeout(() => {
    if (!root.value?.contains(document.activeElement)) {
      open.value = false;
      if (selected.value) query.value = selected.value.label || selected.value.name || '';
    }
  }, 0);
}
</script>

<style scoped>
.search-select { position:relative; min-width:0; }
.search-select-input { display:grid; grid-template-columns:minmax(0,1fr) 32px 32px; min-height:42px; border:1px solid #ccd8ca; border-radius:6px; background:#fff; overflow:hidden; }
.search-select-input:focus-within { border-color:var(--primary); box-shadow:0 0 0 3px rgba(31,122,77,.1); }
.search-select input { min-width:0; width:100%; border:0; outline:0; padding:0 10px; background:transparent; }
.clear-select,.toggle-select { width:32px; height:40px; padding:0; border:0; background:transparent; color:var(--muted); font-size:18px; }
.clear-select:hover,.toggle-select:hover { color:var(--primary-dark); background:#f1f6ef; }
.search-select-menu { position:absolute; z-index:30; top:calc(100% + 4px); left:0; right:0; max-height:280px; margin:0; padding:4px; overflow:auto; list-style:none; border:1px solid #d8e1d6; border-radius:6px; background:#fff; box-shadow:0 12px 28px rgba(20,50,32,.14); }
.search-select-group { position:sticky; top:-4px; z-index:1; margin:4px -4px 2px; padding:7px 10px 5px; color:var(--primary-dark); background:#f3f7f1; font-size:12px; font-weight:700; }
.search-select-menu button { display:grid; width:100%; gap:2px; padding:9px 10px; border:0; border-radius:4px; background:transparent; color:inherit; text-align:left; }
.search-select-menu button:hover,.search-select-menu button.highlighted { background:#eef6eb; }
.search-select-menu button.selected { color:var(--primary-dark); }
.search-select-menu small { color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.search-select-empty { padding:12px 10px; color:var(--muted); font-size:13px; }
</style>
