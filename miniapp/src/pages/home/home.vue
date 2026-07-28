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
      <view class="home-primary">
        <view class="home-section core-section">
          <view class="section-heading"><view><text>开始用餐</text><text>从真实校园目录找到这一餐</text></view><text>{{ store.state.value.catalogStats?.dishes??store.catalogPage.value.total }} 道菜</text></view>
          <view class="core-actions">
            <button v-for="(entry, index) in coreEntries" :key="entry.id" class="core-action" :class="`core-${index}`" @tap="openEntry(entry)">
              <view class="core-icon"><sc-icon :name="entry.iconName" :size="20" /></view>
              <view class="entry-copy"><text class="ui-strong">{{ entry.label }}</text><text>{{ entry.description }}</text></view><sc-icon class="core-arrow" name="arrow-right" :size="16" tone="muted" />
            </button>
          </view>
        </view>
      </view>

      <view class="home-secondary">
        <view class="home-section explore-section">
          <view class="section-heading"><view><text>校园服务</text><text>食堂、排行与个人档案</text></view></view>
          <view class="list-group explore-grid">
            <sc-list-row v-for="entry in utilityEntries" :key="entry.id" :icon-name="entry.iconName" :title="entry.label" :description="entry.description" :meta="exploreDescription(entry)" :tone="entry.tone" @tap="openEntry(entry)" />
          </view>
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
const coreEntries = getStudentEntries(CORE_ENTRY_IDS);
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
const greeting = computed(() => { const hour = new Date().getHours(); return hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'; });

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
.home-hero-inner { width:100%; max-width:1120px; margin:0 auto; padding:18px var(--page-gutter) 20px; background:transparent; box-sizing:border-box; }
.home-layout,.home-primary,.home-secondary { min-width:0; }
.home-section { margin-top:4px; }
.section-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin-bottom:12px; }
.section-heading view text { display:block; color:var(--ink); font-size:16px; font-weight:600; }
.section-heading view text+text { margin-top:3px; color:var(--muted); font-size:12px; font-weight:400; }
.section-heading>text { flex:0 0 auto; color:var(--brand-dark); font-size:12px; font-weight:600; }
.core-actions { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.core-action { display:grid; grid-template-columns:36px minmax(0,1fr) 20px; min-width:0; min-height:68px; align-items:center; gap:10px; padding:12px 14px; border:1px solid var(--brand-line); border-radius:var(--radius-large); background:var(--brand-soft); text-align:left; transition:background-color var(--motion-base) var(--ease-standard),transform var(--motion-fast) var(--ease-standard); }
.core-action.core-1 { border-color:var(--info-line); background:var(--info-soft); }
.core-icon { display:flex; width:36px; height:36px; align-items:center; justify-content:center; border-radius:8px; color:var(--brand-dark); background:#fff; }
.core-1 .core-icon { color:var(--info); }
.entry-copy { min-width:0; }
.entry-copy .ui-strong,.entry-copy text { display:block; overflow:hidden; }
.entry-copy .ui-strong { color:var(--ink); font-size:14px; font-weight:600; white-space:nowrap; text-overflow:ellipsis; }
.entry-copy text { display:-webkit-box; margin-top:3px; overflow:hidden; color:var(--muted); font-size:12px; line-height:1.4; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
.core-action:active { transform:translateY(1px); background:#ffe5e7; }.core-action.core-1:active { background:#e3e9ff; }
.explore-grid { margin-bottom:0; background:var(--surface); }
@media (max-width:359px) {
  .core-action { grid-template-columns:32px minmax(0,1fr); gap:8px; padding:12px; }
  .core-icon { width:32px; height:32px; }
  .core-arrow { display:none; }
}
@media (max-width:479px) { .core-actions { grid-template-columns:1fr; }.core-action { min-height:68px; }.entry-copy text { -webkit-line-clamp:1; } }
@media (min-width:360px) and (max-width:479px) and (max-height:900px) {
  .home-hero-inner { padding-top:12px; padding-bottom:14px; }
  .section-heading { margin-bottom:8px; }
  .core-actions { gap:8px; }
  .core-action { min-height:64px; }
}
@media (min-width:480px) and (max-width:767px) { .core-action { min-height:82px; } }
@media (min-width:768px) {
  .home-hero-inner { padding-top:24px; padding-bottom:28px; }
  .home-layout { display:grid; grid-template-columns:minmax(0,1fr) minmax(320px,1fr); gap:28px; align-items:start; }
  .home-section { margin-top:0; }
  .core-actions { grid-template-columns:1fr; }
  .core-action { min-height:68px; }
}
@media (min-width:1024px) { .core-actions { grid-template-columns:1fr 1fr; }.core-action { min-height:92px; } }
@media (min-width:768px) and (max-height:700px) { .home-hero-inner { padding-top:12px; padding-bottom:14px; }.home-layout { gap:20px; } }
</style>
