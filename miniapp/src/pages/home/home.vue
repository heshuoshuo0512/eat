<template>
  <sc-page-shell :title="greeting" tone="meal" tab-id="home" :status="mealContext">
    <template #hero>
      <view class="home-hero-inner">
        <sc-reveal-card
          :dish="revealDish" :index="revealState.index" :total="revealDishes.length" :phase="revealState.phase"
          :location="dishLocation(revealDish)" :reason="dishReason(revealDish)" :supply="supplyLabel(revealDish)"
          :reduced-motion="store.motionReduced.value" @action="handleReveal" @reset="resetReveal" @detail="openDishDetail"
        />
      </view>
    </template>
    <sc-state-card v-if="store.loading.value && !store.loaded.value" type="loading" title="正在同步食堂数据" desc="菜单、评分和供应状态正在更新。" />
    <sc-state-card v-else-if="store.error.value && !store.loaded.value" type="error" title="数据同步失败" :desc="store.error.value" action-text="重试" @action="reload" />

    <view class="home-layout">
      <view class="home-section core-section">
        <text class="section-label">开始用餐</text>
        <view class="core-actions">
          <button v-for="entry in coreEntries" :key="entry.id" class="core-action" @tap="openEntry(entry)">
            <view class="core-icon"><sc-icon :name="entry.iconName" :size="20" tone="current" /></view>
            <text class="core-label">{{ coreLabel(entry) }}</text>
            <text class="core-sub">{{ coreDescription(entry) }}</text>
          </button>
        </view>
      </view>

      <view class="home-section explore-section">
        <text class="section-label">更多探索</text>
        <view class="explore-list explore-grid">
          <button v-for="entry in utilityEntries" :key="entry.id" class="explore-row" @tap="openEntry(entry)">
            <view class="explore-icon"><sc-icon :name="entry.iconName" :size="18" tone="current" /></view>
            <view class="explore-copy"><text class="explore-title">{{ entry.label }}</text><text class="explore-description">{{ utilityDescription(entry) }}</text></view>
            <text class="explore-meta">{{ exploreDescription(entry) }}</text>
            <sc-icon name="arrow-right" :size="16" tone="muted" />
          </button>
        </view>
      </view>
    </view>

  </sc-page-shell>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { dishSupplyPresentation } from '../../domain/dishPresentation.js';
import { CORE_ENTRY_IDS, EXPLORE_ENTRY_IDS, getStudentEntries } from '../../domain/studentNavigation.js';
import { nextRevealState, resetRevealState } from '../../domain/studentDiscovery.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const revealState = reactive(resetRevealState());
const onboardingPromptHandled = ref(false);
const onboardingPromptOpen = ref(false);
const drawnThisVisit = new Set();
const coreEntries = getStudentEntries([...CORE_ENTRY_IDS.slice(0, 2), 'vision']);
const exploreEntries = getStudentEntries(EXPLORE_ENTRY_IDS);
const utilityEntries = [...exploreEntries, { id:'health-profile', label:'健康档案', description:'管理过敏原、忌口和饮食目标', iconName:'safe', tone:'health', route:'/pages/health-profile/health-profile', navigationType:'navigateTo' }];
const revealDishes = computed(() => {
  const picks = store.contextualRecommendation.value?.recommendations || [];
  const catalog = new Map(store.dishes.value.map((dish) => [String(dish.id), dish]));
  const hydrated = picks.map((item) => ({ ...(catalog.get(String(item.id || item.dishId)) || {}), ...item, id: item.id || item.dishId })).filter((item) => item.id);
  return hydrated.length ? hydrated : store.recommendation.value.dishes;
});
const revealDish = computed(() => revealDishes.value[revealState.index] || revealDishes.value[0] || null);
const mealContext = computed(() => ({ breakfast:'早餐', lunch:'午餐', dinner:'晚餐' }[store.profile.value.mealType] || '今日餐次'));
const greeting = computed(() => '智慧食堂');

onShow(async () => {
  try {
    await store.refreshIfStale();
    if (!store.user.value) { uni.reLaunch({ url: '/pages/login/login' }); return; }
    if (!store.contextualRecommendation.value.recommendations?.length) await store.loadRecommendation().catch(() => {});
    promptHealthProfile();
  } catch {}
});
onPullDownRefresh(async () => { await reload(); uni.stopPullDownRefresh(); });

async function reload() {
  try { await store.load(true); await store.loadRecommendation().catch(() => {}); Object.assign(revealState, resetRevealState()); drawnThisVisit.clear(); } catch {}
}
async function handleReveal() {
  if (!revealDish.value) return;
  const wasCovered = revealState.phase === 'covered';
  Object.assign(revealState, nextRevealState(revealState, revealDishes.value.length));
  if (wasCovered && !drawnThisVisit.has(revealDish.value.id)) { drawnThisVisit.add(revealDish.value.id); store.markDishDrawn(revealDish.value.id).catch(() => {}); }
}
function resetReveal() { Object.assign(revealState, resetRevealState()); }
function dishLocation(dish) { if (!dish) return ''; const stall = store.stalls.value.find((item) => item.id === dish.stallId); const canteen = store.canteens.value.find((item) => item.id === stall?.canteenId); return [canteen?.name, stall?.name].filter(Boolean).join(' · ') || '校园档口'; }
function dishReason(dish) { if (!dish) return ''; if (Array.isArray(dish.why)) return dish.why.slice(0, 2).join(' · '); return dish.reason || '结合健康档案、评分与当前供应推荐。'; }
function supplyLabel(dish) { if (!dish) return ''; const menu = store.todayMenu.value.dishes?.find((item) => String(item.id) === String(dish.id)); return dishSupplyPresentation(dish, menu || null).label; }
function openDishDetail(id) { uni.navigateTo({ url: `/pages/dish-detail/dish-detail?id=${encodeURIComponent(id)}` }); }
function exploreDescription(entry) {
  if (entry.id === 'canteens') return `${store.canteens.value.length} 座食堂`;
  if (entry.id === 'rankings') return '真实评分榜';
  if (entry.id === 'health-profile') return store.profile.value.onboardingStatus === 'completed' ? '已同步' : '待完善';
  return '六种风味';
}
function coreDescription(entry) {
  return ({ dishes:'筛选菜品', recommend:'生成建议', vision:'识别营养' })[entry.id] || entry.description;
}
function coreLabel(entry) {
  return ({ dishes:'找菜', recommend:'智能推荐', vision:'拍照识餐' })[entry.id] || entry.label;
}
function utilityDescription(entry) {
  return ({ canteens:'查找食堂、楼层与档口', rankings:'查看真实评分与校园热度', regions:'从地区风味发现下一餐', 'health-profile':'管理忌口与饮食目标' })[entry.id] || entry.description;
}
function openEntry(entry) {
  if (!entry) return;
  if (entry.discoveryMode) store.openDiscoveryMode(entry.discoveryMode);
  if (entry.communitySection) store.openCommunitySection(entry.communitySection);
  uni[entry.navigationType]({ url: entry.route });
}
function promptHealthProfile() {
  if (store.profile.value.onboardingStatus !== 'pending' || onboardingPromptHandled.value || onboardingPromptOpen.value) return;
  onboardingPromptOpen.value = true;
  uni.showModal({
    title: '完善健康档案',
    content: '先确认过敏原、忌口和预算，推荐才能使用你的真实限制。也可以稍后再填。',
    cancelText: '稍后填写',
    confirmText: '去填写',
    success(result) {
      onboardingPromptHandled.value = true;
      if (result.confirm) uni.navigateTo({ url: '/pages/health-profile/health-profile' });
      else store.deferProfileOnboarding().catch(() => {});
    },
    complete() { onboardingPromptOpen.value = false; }
  });
}
</script>

<style scoped>
.home-hero-inner { width:100%; max-width:680px; margin:0 auto; padding:16px var(--page-gutter) 0; box-sizing:border-box; }
.home-layout,.home-section { min-width:0; }
.home-section { margin-top:18px; }
.section-label { display:block; margin:0 4px 8px; color:var(--module-dark); font-size:12px; font-weight:600; }
.core-actions { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
.core-action { display:flex; min-width:0; min-height:104px; flex-direction:column; align-items:center; justify-content:center; padding:13px 6px; border:1px solid var(--module-line); border-radius:14px; color:var(--module-dark); background:var(--module-soft); text-align:center; transition:background-color var(--motion-fast) var(--ease-standard),transform var(--motion-fast) var(--ease-standard); }
.core-action:active { transform:translateY(1px); background:#ffe5e7; }
.core-icon { display:flex; width:38px; height:38px; align-items:center; justify-content:center; margin-bottom:8px; border-radius:10px; background:#fff; }
.core-label,.core-sub { display:block; max-width:100%; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.core-label { color:var(--ink); font-size:14px; font-weight:600; }
.core-sub { margin-top:2px; color:var(--muted); font-size:12px; }
.explore-list { display:flex; flex-direction:column; gap:10px; }
.explore-row { display:flex; width:100%; min-height:60px; align-items:center; gap:12px; padding:10px 14px; border:1px solid var(--line); border-radius:14px; background:var(--surface); text-align:left; }
.explore-row:active { transform:translateY(1px); background:var(--module-soft); }
.explore-icon { display:flex; width:34px; height:34px; flex:0 0 34px; align-items:center; justify-content:center; border-radius:9px; color:var(--module-dark); background:var(--module-soft); }
.explore-copy { flex:1; min-width:0; }
.explore-title,.explore-description { display:block; overflow:hidden; text-overflow:ellipsis; }
.explore-title { color:var(--ink); font-size:14px; font-weight:500; white-space:nowrap; }
.explore-description { margin-top:3px; color:var(--muted); font-size:12px; line-height:1.4; }
.explore-meta { flex:0 0 auto; max-width:88px; overflow:hidden; color:var(--module-dark); font-size:12px; white-space:nowrap; text-overflow:ellipsis; }
@media (max-width:359px) { .core-actions { gap:7px; }.core-action { min-height:96px; padding-right:3px; padding-left:3px; }.core-label { font-size:12px; }.explore-meta { display:none; } }
@media (min-width:768px) { .home-hero-inner { padding-top:24px; }.home-layout { display:grid; grid-template-columns:minmax(0,.8fr) minmax(360px,1.2fr); gap:28px; align-items:start; }.home-section { margin-top:24px; }.core-actions { grid-template-columns:1fr; }.core-action { min-height:92px; }.explore-row { min-height:64px; } }
@media (min-width:1024px) { .home-layout { grid-template-columns:minmax(300px,.7fr) minmax(480px,1.3fr); } }
</style>
