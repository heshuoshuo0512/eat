<template>
  <view class="app-nav" :class="`tone-${activeTab.tone}`" aria-label="主导航">
    <view class="nav-selection" :class="`slot-${activeIndex}`" aria-hidden="true"></view>
    <button
      v-for="item in APP_TABS"
      :key="item.id"
      class="app-nav-item"
      :class="{ active: item.id === visualActive }"
      :aria-label="item.label"
      @tap="open(item)"
    >
      <view class="nav-icon"><sc-icon :name="item.iconName" :size="20" tone="current" /></view>
      <text>{{ item.label }}</text>
    </button>
  </view>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { APP_TABS } from '../../domain/appNavigation.js';

const props = defineProps({ active: { type: String, default: 'home' } });
const visualActive = ref(props.active);
const activeIndex = computed(() => Math.max(0, APP_TABS.findIndex((item) => item.id === visualActive.value)));
const activeTab = computed(() => APP_TABS[activeIndex.value] || APP_TABS[0]);
let navigationTimer = 0;

watch(() => props.active, (value) => { visualActive.value = value; });

function open(item) {
  if (!item || item.id === visualActive.value) return;
  visualActive.value = item.id;
  clearTimeout(navigationTimer);
  navigationTimer = setTimeout(() => uni.switchTab({ url: item.route }), 220);
}

onBeforeUnmount(() => clearTimeout(navigationTimer));
</script>

<style scoped>
.app-nav { position:fixed; right:12px; bottom:calc(8px + env(safe-area-inset-bottom)); left:12px; z-index:60; display:grid; height:64px; grid-template-columns:repeat(4,minmax(0,1fr)); padding:4px; border:1px solid rgba(230,232,236,.92); border-radius:14px; background:#fff; box-shadow:0 10px 30px rgba(24,26,31,.12); box-sizing:border-box; }
.nav-selection { position:absolute; top:4px; left:4px; width:calc(25% - 2px); height:54px; border:1px solid var(--tab-line); border-radius:10px; background:var(--tab-soft); box-sizing:border-box; pointer-events:none; transition:transform 220ms cubic-bezier(.22,.8,.3,1),background-color 160ms ease,border-color 160ms ease; }
.nav-selection.slot-0 { transform:translateX(0); }.nav-selection.slot-1 { transform:translateX(100%); }.nav-selection.slot-2 { transform:translateX(200%); }.nav-selection.slot-3 { transform:translateX(300%); }
.app-nav-item { position:relative; z-index:1; display:flex; min-height:54px!important; flex-direction:column; align-items:center; justify-content:center; gap:2px; border-radius:10px; color:var(--muted); font-size:11px; transition:color 160ms var(--ease-standard),opacity 120ms ease; }
.app-nav-item:active { opacity:.68; }
.nav-icon { display:flex; width:24px; height:24px; align-items:center; justify-content:center; }
.app-nav-item.active { color:var(--tab-accent); font-weight:600; }
.tone-meal { --tab-accent:var(--brand); --tab-soft:var(--brand-soft); --tab-line:var(--brand-line); }
.tone-discover { --tab-accent:var(--discover); --tab-soft:var(--discover-soft); --tab-line:var(--discover-line); }
.tone-community { --tab-accent:var(--community); --tab-soft:var(--community-soft); --tab-line:#d9cdf8; }
.tone-records { --tab-accent:var(--records); --tab-soft:var(--records-soft); --tab-line:#c4e4d4; }
@media (max-width:359px) { .app-nav { right:8px; left:8px; }.app-nav-item { font-size:10px; } }
@media (min-width:768px) {
  .app-nav { top:50%; right:auto; bottom:auto; left:10px; width:68px; height:auto; grid-template-columns:1fr; gap:4px; padding:6px 4px; transform:translateY(-50%); }
  .app-nav-item { min-height:58px!important; }
  .nav-selection { top:6px; left:4px; width:58px; height:58px; }
  .nav-selection.slot-0 { transform:translateY(0); }.nav-selection.slot-1 { transform:translateY(calc(100% + 4px)); }.nav-selection.slot-2 { transform:translateY(calc(200% + 8px)); }.nav-selection.slot-3 { transform:translateY(calc(300% + 12px)); }
}
</style>
