<template>
  <wd-config-provider :theme-vars="themeVars">
    <view class="page-shell" :class="[{ 'motion-reduced': reducedMotion, 'has-back': back, 'has-app-nav': tabId }, `tone-${toneName}`, `appearance-${appearance}`, `content-${contentMode}`]" :style="toneStyle">
      <view class="nav-safe" :style="{ height: `${statusBarHeight}px` }"></view>
      <view v-if="!hideNav" class="page-nav" :style="navStyle">
        <view class="nav-main">
          <button v-if="back" class="nav-back" aria-label="返回" @tap="goBack"><sc-icon name="arrow-left" :size="20" /></button>
          <view class="nav-copy">
            <text class="nav-title">{{ title }}</text>
          </view>
        </view>
        <view class="nav-action">
          <slot name="action">
            <view v-if="status" class="status-label"><text></text>{{ status }}</view>
          </slot>
        </view>
      </view>
      <view v-if="$slots.hero" class="page-hero">
        <slot name="hero"></slot>
      </view>
      <view class="page-content" :class="{ 'content-no-nav': hideNav }">
        <text v-if="subtitle && !hideNav" class="page-description">{{ subtitle }}</text>
        <slot></slot>
      </view>
      <!-- #ifdef H5 -->
      <sc-app-nav v-if="tabId" :active="tabId" />
      <!-- #endif -->
    </view>
  </wd-config-provider>
</template>

<script setup>
import { computed } from 'vue';
import { useCanteenStore } from '../../stores/canteenStore.js';

const props = defineProps({
  tone: { type: String, default: 'neutral' },
  tabId: { type: String, default: '' },
  back: Boolean,
  hideNav: Boolean,
  title: { type: String, default: '智慧食堂' },
  subtitle: { type: String, default: '' },
  status: { type: String, default: '' }
  ,appearance: { type: String, default: 'default', validator: (value) => ['default', 'brand', 'plain'].includes(value) }
  ,contentMode: { type: String, default: 'app', validator: (value) => ['app', 'reading'].includes(value) }
});

const store = useCanteenStore();
const windowInfo = typeof uni.getWindowInfo === 'function' ? uni.getWindowInfo() : uni.getSystemInfoSync();
const statusBarHeight = Number(windowInfo.statusBarHeight || 20);
let capsule = null;
try { capsule = typeof uni.getMenuButtonBoundingClientRect === 'function' ? uni.getMenuButtonBoundingClientRect() : null; } catch { capsule = null; }
const navStyle = computed(() => ({ paddingRight: `${capsule?.width ? Math.max(16, windowInfo.windowWidth - capsule.left + 8) : 16}px` }));
const reducedMotion = computed(() => store.motionReduced.value);
const TONES = {
  neutral: { accent:'#181a1f', dark:'#000000', soft:'#f2f3f5', line:'#e6e8ec' },
  meal: { accent:'#e23d4a', dark:'#c9323e', soft:'#fff1f2', line:'#f4c3c7' },
  discover: { accent:'#356ae6', dark:'#2855c2', soft:'#eef4ff', line:'#c9d8ff' },
  community: { accent:'#7656d6', dark:'#6042bb', soft:'#f5f1ff', line:'#d9cdf8' },
  records: { accent:'#238460', dark:'#19694b', soft:'#eef8f3', line:'#c4e4d4' },
  health: { accent:'#238460', dark:'#19694b', soft:'#eef8f3', line:'#c4e4d4' },
  ranking: { accent:'#a56a00', dark:'#825400', soft:'#fff7e8', line:'#ead3a6' }
};
const TONE_ALIASES = { default:'neutral', core:'meal', explore:'discover', profile:'records' };
const toneName = computed(() => TONES[props.tone] ? props.tone : (TONE_ALIASES[props.tone] || 'neutral'));
const activeTone = computed(() => TONES[toneName.value]);
const toneStyle = computed(() => ({
  '--module-accent': activeTone.value.accent,
  '--module-dark': activeTone.value.dark,
  '--module-soft': activeTone.value.soft,
  '--module-line': activeTone.value.line
}));
const themeVars = computed(() => ({
  baseWhite: '#ffffff',
  primary6: activeTone.value.accent,
  primary7: activeTone.value.dark,
  textMain: '#181a1f',
  textSecondary: '#5e626a',
  textAuxiliary: '#858991',
  borderMain: '#e6e8ec',
  borderLight: '#f2f3f5',
  filledBottom: '#f7f8fa',
  filledZero: '#ffffff',
  filledContent: '#f2f3f5',
  successMain: '#238460',
  warningMain: '#a56a00',
  dangerMain: '#b42318',
  buttonPrimaryBg: activeTone.value.accent,
  buttonPrimaryColor: '#ffffff',
  segmentedBg: '#f2f3f5',
  segmentedItemBgActive: '#ffffff',
  segmentedItemColor: '#858991',
  segmentedItemColorActive: activeTone.value.accent,
  switchColorActiveBg: activeTone.value.accent,
  loadingColorMain: activeTone.value.accent
}));

function goBack() {
  const pages = getCurrentPages();
  if (pages.length > 1) uni.navigateBack();
  else uni.switchTab({ url: '/pages/home/home' });
}
</script>

<style scoped>
.page-shell { min-height:100vh; color:var(--ink); background:var(--bg); }
.nav-safe { background:var(--surface); }
.page-nav { position:sticky; top:0; z-index:20; display:flex; height:48px; align-items:center; justify-content:space-between; padding:0 var(--page-gutter); border-bottom:1px solid var(--line); background:rgba(255,255,255,.96); box-sizing:border-box; }
.nav-main { display:flex; align-items:center; gap:8px; min-width:0; }
.nav-back { display:flex; width:44px; height:44px; flex:0 0 44px; align-items:center; justify-content:center; margin-left:-10px; border-radius:50%; background:transparent; }
.nav-back:active { background:var(--surface-soft); }
.nav-copy { min-width:0; }
.nav-title { display:block; overflow:hidden; color:var(--ink); font-size:16px; font-weight:600; line-height:1.25; white-space:nowrap; text-overflow:ellipsis; }
.nav-action { flex:0 0 auto; }
.status-label { display:flex; min-height:28px; align-items:center; gap:6px; padding:0 9px; border:1px solid var(--line); border-radius:999px; color:var(--ink-2); background:var(--surface); font-size:12px; }
.status-label>text { width:5px; height:5px; border-radius:50%; background:var(--module-accent); }
.page-content { width:100%; max-width:var(--content-max); margin:0 auto; padding:16px var(--page-gutter) calc(28px + env(safe-area-inset-bottom)); box-sizing:border-box; animation:page-enter var(--motion-base) var(--ease-standard) both; }
.page-description { display:block; margin:-2px 0 16px; color:var(--muted); font-size:14px; line-height:1.5; }
.content-no-nav { padding-top:0; }
.page-hero { width:100%; animation:page-enter var(--motion-base) var(--ease-standard) both; }
.content-reading .page-content { max-width:720px; }
.appearance-plain .nav-safe,.appearance-plain .page-nav,.appearance-brand .nav-safe,.appearance-brand .page-nav { background:var(--surface); }
.has-app-nav .page-content { padding-bottom:calc(96px + env(safe-area-inset-bottom)); }
@keyframes page-enter { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
@media (min-width:768px) { .page-shell.has-app-nav { padding-left:84px; }.page-content { padding-top:24px; padding-bottom:40px; }.page-description { margin-bottom:24px; }.has-app-nav .page-content { padding-bottom:40px; } }
</style>
