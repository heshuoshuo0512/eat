<template>
  <sc-page-shell title="智慧食堂">
    <sc-state-card v-if="store.loading.value && !store.loaded.value" type="loading" title="正在同步食堂数据" desc="菜单、评分和供应状态正在更新。" />
    <sc-state-card v-else-if="store.error.value && !store.loaded.value" type="error" title="数据同步失败" :desc="store.error.value" action-text="重试" @action="reload" />

    <sc-reveal-card
      :dish="revealDish" :index="revealState.index" :total="revealDishes.length" :phase="revealState.phase"
      :location="dishLocation(revealDish)" :reason="dishReason(revealDish)" :supply="supplyLabel(revealDish)"
      :reduced-motion="store.motionReduced.value" @action="handleReveal" @reset="resetReveal" @detail="openDishDetail"
    />

    <view class="home-section core-section">
      <view class="section-heading"><view><text>智能吃饭</text><text class="ui-strong">两个入口，直接开始</text></view></view>
      <view class="core-actions">
        <button v-for="entry in coreEntries" :key="entry.id" class="core-action" @tap="openEntry(entry)">
          <view class="entry-icon"><image :src="entry.icon" mode="aspectFit" /></view>
          <view class="entry-copy"><text class="ui-strong">{{ entry.label }}</text><text>{{ entry.description }}</text></view>
          <text class="entry-arrow">›</text>
        </button>
      </view>
    </view>

    <view class="home-section explore-section">
      <view class="section-heading"><view><text>更多探索</text><text class="ui-strong">常用功能，直接打开</text></view></view>
      <view class="explore-grid">
        <button v-for="entry in exploreEntries" :key="entry.id" class="explore-card" @tap="openEntry(entry)">
          <view class="explore-icon"><image :src="entry.icon" mode="aspectFit" /></view>
          <text class="ui-strong">{{ entry.label }}</text>
          <text class="explore-note">{{ exploreDescription(entry) }}</text>
        </button>
      </view>
    </view>

    <view class="home-section community-section">
      <view class="section-heading"><view><text>校园互动</text><text class="ui-strong">帖子与评价，一页切换</text></view></view>
      <view class="community-grid">
        <button v-for="entry in communityEntries" :key="entry.id" class="community-card" @tap="openEntry(entry)">
          <view class="community-icon"><image :src="entry.icon" mode="aspectFit" /></view>
          <view><text class="ui-strong">{{ entry.label }}</text><text>{{ entry.description }}</text></view>
          <text class="entry-arrow">›</text>
        </button>
      </view>
    </view>
  </sc-page-shell>
</template>

<script setup>
import { computed, reactive } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { COMMUNITY_ENTRY_IDS, CORE_ENTRY_IDS, EXPLORE_ENTRY_IDS, getStudentEntries } from '../../domain/studentNavigation.js';
import { nextRevealState, resetRevealState } from '../../domain/studentDiscovery.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const revealState = reactive(resetRevealState());
const drawnThisVisit = new Set();
const coreEntries = getStudentEntries(CORE_ENTRY_IDS);
const exploreEntries = getStudentEntries(EXPLORE_ENTRY_IDS);
const communityEntries = getStudentEntries(COMMUNITY_ENTRY_IDS);
const revealDishes = computed(() => {
  const picks = store.contextualRecommendation.value?.recommendations || [];
  const catalog = new Map(store.dishes.value.map((dish) => [String(dish.id), dish]));
  const hydrated = picks.map((item) => ({ ...(catalog.get(String(item.id || item.dishId)) || {}), ...item, id: item.id || item.dishId })).filter((item) => item.id);
  return hydrated.length ? hydrated : store.recommendation.value.dishes;
});
const revealDish = computed(() => revealDishes.value[revealState.index] || revealDishes.value[0] || null);

onShow(async () => {
  try {
    await store.refreshIfStale();
    if (!store.user.value) { uni.reLaunch({ url: '/pages/login/login' }); return; }
    if (!store.contextualRecommendation.value.recommendations?.length) await store.loadRecommendation().catch(() => {});
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
function supplyLabel(dish) { if (!dish) return ''; if (dish.availability?.reason) return dish.availability.reason; const menu = store.todayMenu.value.dishes?.find((item) => String(item.id) === String(dish.id)); if (!menu) return '非今日供应'; return menu.supplyStatus === 'sold_out' ? '今日售罄' : menu.supplyStatus === 'limited' ? '库存紧张' : '今日可点'; }
function openDishDetail(id) { uni.navigateTo({ url: `/pages/dish-detail/dish-detail?id=${encodeURIComponent(id)}` }); }
function exploreDescription(entry) {
  if (entry.id === 'canteens') return `${store.canteens.value.length} 座食堂`;
  if (entry.id === 'rankings') return '真实评分榜';
  return '六种风味';
}
function openEntry(entry) {
  if (!entry) return;
  if (entry.discoveryMode) store.openDiscoveryMode(entry.discoveryMode);
  if (entry.communitySection) store.openCommunitySection(entry.communitySection);
  uni[entry.navigationType]({ url: entry.route });
}
</script>

<style scoped>
.home-section { margin-top:28rpx; }
.section-heading { display:flex; align-items:flex-end; justify-content:space-between; margin-bottom:14rpx; }
.section-heading text,.section-heading .ui-strong { display:block; }
.section-heading text { color:var(--section-tone, var(--brand)); font-size:22rpx; font-weight:500; }
.section-heading .ui-strong { margin-top:4rpx; color:var(--ink); font-size:30rpx; font-weight:600; line-height:1.35; }
.core-section,.explore-section { --section-tone:var(--brand); }
.community-section { --section-tone:var(--community); }
.core-actions { display:flex; flex-direction:column; gap:12rpx; }
.core-action { display:flex; align-items:center; gap:14rpx; width:100%; min-height:96rpx; padding:10rpx 16rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); text-align:left; box-shadow:var(--shadow-soft); box-sizing:border-box; }
.entry-icon { display:flex; align-items:center; justify-content:center; width:54rpx; height:54rpx; flex:0 0 54rpx; border-radius:12rpx; background:var(--brand-soft); }
.entry-icon image { width:32rpx; height:32rpx; }
.entry-copy { flex:1; min-width:0; }
.entry-copy .ui-strong,.entry-copy text { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.entry-copy .ui-strong { color:var(--ink); font-size:27rpx; font-weight:600; }
.entry-copy text { margin-top:4rpx; color:var(--muted); font-size:22rpx; }
.entry-arrow { color:#96a199; font-size:36rpx; }
.explore-grid { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:10rpx; }
.explore-card { display:flex; flex-direction:column; align-items:center; justify-content:center; min-width:0; min-height:144rpx; padding:14rpx 8rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); text-align:center; box-shadow:var(--shadow-soft); box-sizing:border-box; }
.explore-icon { display:flex; align-items:center; justify-content:center; width:50rpx; height:50rpx; margin-bottom:8rpx; border-radius:14rpx; background:var(--brand-soft); }
.explore-icon image { width:30rpx; height:30rpx; }
.explore-card .ui-strong,.explore-note { display:block; max-width:100%; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.explore-card .ui-strong { color:var(--ink); font-size:24rpx; font-weight:600; }
.explore-note { margin-top:4rpx; color:var(--muted); font-size:22rpx; }
.community-grid { display:flex; flex-direction:column; gap:10rpx; }
.community-card { display:flex; align-items:center; gap:12rpx; width:100%; min-height:92rpx; padding:10rpx 14rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); text-align:left; box-shadow:var(--shadow-soft); box-sizing:border-box; }
.community-icon { display:flex; align-items:center; justify-content:center; width:50rpx; height:50rpx; flex:0 0 50rpx; border-radius:14rpx; background:var(--community-soft); }
.community-icon image { width:30rpx; height:30rpx; }
.community-card>view:nth-child(2) { flex:1; min-width:0; }
.community-card .ui-strong,.community-card>view:nth-child(2)>text { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.community-card .ui-strong { color:var(--ink); font-size:26rpx; font-weight:600; }
.community-card>view:nth-child(2)>text { margin-top:4rpx; color:var(--muted); font-size:22rpx; }
.core-action:active,.explore-card:active { transform:scale(.985); opacity:.92; background:var(--surface-soft); }
.community-card:active { transform:scale(.985); opacity:.92; background:var(--surface-soft); }
</style>
