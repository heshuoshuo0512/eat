<template>
  <sc-page-shell title="轻食食堂" subtitle="校园中心食堂 · 健康午餐" status="营业中">
    <template #action>
      <button class="nav-action" @tap="logout">退出</button>
    </template>

    <view class="search-card" @tap="openDishes">
      <image class="search-icon" src="/static/icons/menu.png" mode="aspectFit" />
      <text class="search-placeholder">搜索低卡、鸡胸、沙拉、清真窗口</text>
      <text class="search-tag">智能推荐</text>
    </view>

    <sc-state-card v-if="store.loading.value" type="loading" title="正在同步食堂数据" desc="菜单、推荐和评分正在更新。" />
    <sc-state-card v-else-if="store.error.value" type="error" title="数据同步失败" :desc="store.error.value" action-text="重试" @action="reload" />

    <view class="hero-shop-card">
      <view class="hero-copy">
        <text class="hero-kicker">LIGHT MEAL TODAY</text>
        <text class="hero-title">{{ greeting }}，今天吃得轻一点</text>
        <text class="hero-subtitle">按预算、热量和口味，优先推荐还在供应的健康套餐。</text>
        <view class="hero-chips">
          <text>低脂</text>
          <text>高蛋白</text>
          <text>少油</text>
        </view>
      </view>
      <image class="hero-meal hero-plate" src="/static/food/hero-meal.svg" mode="aspectFill" />
      <view class="hero-order-card">
        <view>
          <text class="order-label">今日首推</text>
          <text class="order-name">{{ heroDish?.name || '低脂鸡胸能量餐' }}</text>
          <text class="order-meta">{{ heroDish?.nutrition?.calories || 520 }} kcal · {{ heroDish?.taste || '均衡' }}</text>
        </view>
        <view class="order-price">¥{{ heroDish?.price || 18 }}</view>
      </view>
    </view>

    <view class="quick-actions">
      <view class="quick-action primary" @tap="openRecommend"><image class="quick-icon" src="/static/icons/meal-plan.png" mode="aspectFit" /><text>智能配餐</text></view>
      <view class="quick-action" @tap="openDishes"><image class="quick-icon" src="/static/icons/order-dish.png" mode="aspectFit" /><text>点菜</text></view>
      <view class="quick-action" @tap="openHealth"><image class="quick-icon" src="/static/icons/camera.png" mode="aspectFit" /><text>健康</text></view>
      <view class="quick-action" @tap="openAgent"><image class="quick-icon" src="/static/icons/agent.png" mode="aspectFit" /><text>顾问</text></view>
    </view>

    <view class="health-strip" @tap="openRecommend">
      <view class="ring"><text>{{ heroDish?.nutrition?.calories || 520 }}</text><text>kcal</text></view>
      <view class="flex-1">
        <text class="health-title">本餐预算 ¥{{ store.profile.value.budgetMax }} 内</text>
        <text class="health-desc">目标：{{ store.recommendation.value.goalLabel }} · 优先高蛋白低油菜品</text>
      </view>
      <text class="health-arrow">›</text>
    </view>

    <view class="metric-grid home-metrics">
      <view class="metric"><text class="num">{{ store.canteens.value.length }}</text><text class="label">食堂</text></view>
      <view class="metric"><text class="num">{{ store.stalls.value.length }}</text><text class="label">档口</text></view>
      <view class="metric"><text class="num">{{ store.dishes.value.length }}</text><text class="label">菜品</text></view>
      <view class="metric"><text class="num">{{ topScore }}</text><text class="label">最高分</text></view>
    </view>

    <view class="panel-card featured-panel">
      <sc-section :eyebrow="menuSourceLabel" title="为你推荐">
        <template #right><text class="pill orange">{{ store.recommendation.value.goalLabel }}</text></template>
      </sc-section>
      <view class="dish-stack">
        <sc-dish-card v-for="dish in store.recommendation.value.dishes" :key="dish.id" :dish="dish" badge="推荐" @tap="openDishes" />
      </view>
    </view>

    <view class="panel-card ranking-panel">
      <sc-section eyebrow="HOT RANKING" title="校园热榜 Top 4">
        <template #right><button class="text-action" @tap="openDishes">去检索</button></template>
      </sc-section>
      <view v-for="(dish, index) in store.rankings.value.dishes.slice(0, 4)" :key="dish.id" class="rank-row brand-rank">
        <text class="rank-no">{{ index + 1 }}</text>
        <image class="rank-icon" :src="dishIconSrc(dish)" mode="aspectFit" />
        <view class="flex-1">
          <text class="main-text">{{ dish.name }}</text>
          <text class="sub-text">{{ dish.tags.join(' / ') }}</text>
        </view>
        <text class="pill">{{ dish.rankScore }}</text>
      </view>
    </view>
  </sc-page-shell>
</template>

<script setup>
import { computed } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const greeting = computed(() => store.user.value?.nickname || store.user.value?.username || '欢迎回来');
const topScore = computed(() => store.rankings.value.dishes[0]?.rating?.toFixed?.(1) || '—');
const menuSourceLabel = computed(() => store.todayMenu.value.dishes.length ? '今日供应优先' : '菜品库兜底');
const heroDish = computed(() => store.recommendation.value.dishes[0] || store.rankings.value.dishes[0]);
const dishIconMap = ['menu', 'meal-plan', 'order-dish'];

onShow(async () => {
  await store.load();
  if (!store.user.value) uni.redirectTo({ url: '/pages/login/login' });
});

onPullDownRefresh(async () => {
  await store.load();
  uni.stopPullDownRefresh();
});

function logout() { store.logout(); uni.redirectTo({ url: '/pages/login/login' }); }
async function reload() { await store.load(); }
function openRecommend() { uni.navigateTo({ url: '/pages/recommend/recommend' }); }
function openDishes() { uni.switchTab({ url: '/pages/dishes/dishes' }); }
function openHealth() { uni.switchTab({ url: '/pages/health/health' }); }
function openAgent() { uni.navigateTo({ url: '/pages/agent/agent' }); }
function openDishDetail(id) { uni.navigateTo({ url: `/pages/dish-detail/dish-detail?id=${encodeURIComponent(id)}` }); }
function dishIconSrc(dish) { return `/static/icons/${dishIconMap[Math.abs(hashCode(dish?.id || dish?.name)) % dishIconMap.length]}.png`; }
function hashCode(value) {
  let hash = 0;
  const text = String(value || 'dish');
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) - hash) + text.charCodeAt(index);
  return hash;
}
</script>
<style scoped>
.nav-action,
.text-action { padding: 10rpx 20rpx; border-radius: 999rpx; color: #1f9f72; background: rgba(255,255,255,.76); font-size: 23rpx; font-weight: 750; }
.search-card { display:flex; align-items:center; gap:14rpx; margin: 4rpx 0 22rpx; padding:18rpx 20rpx; border-radius:999rpx; background:rgba(255,255,255,.78); border:1rpx solid rgba(255,255,255,.58); box-shadow:0 12rpx 30rpx rgba(21,62,43,.06); backdrop-filter:blur(24rpx) saturate(1.2); }
.search-icon { width:38rpx; height:38rpx; padding:8rpx; border-radius:999rpx; background:#58cfa0; box-sizing:border-box; }
.search-placeholder { flex:1; min-width:0; color:#70877b; font-size:24rpx; }
.search-tag { padding:8rpx 14rpx; border-radius:999rpx; color:#1f9f72; background:#e9f8ef; font-size:20rpx; font-weight:750; }
.hero-shop-card { position:relative; overflow:hidden; min-height:430rpx; margin-bottom:22rpx; padding:34rpx 34rpx 160rpx; border-radius:46rpx; color:#fff; background:linear-gradient(145deg,#7be0b7 0%,#35bd8d 54%,#0e795b 100%); box-shadow:0 34rpx 80rpx rgba(47,185,135,.24); }
.hero-shop-card::before { content:''; position:absolute; inset:0; background:radial-gradient(circle at 82% 18%,rgba(255,255,255,.28),transparent 24%), radial-gradient(circle at 4% 88%,rgba(255,216,107,.28),transparent 28%); }
.hero-copy { position:relative; z-index:2; width:66%; }
.hero-kicker { display:block; font-size:20rpx; font-weight:800; letter-spacing:2.6rpx; opacity:.82; }
.hero-title { display:block; margin-top:16rpx; font-size:52rpx; font-weight:850; line-height:1.04; letter-spacing:-1rpx; }
.hero-subtitle { display:block; margin-top:16rpx; font-size:24rpx; line-height:1.55; opacity:.9; }
.hero-chips { display:flex; flex-wrap:wrap; gap:10rpx; margin-top:22rpx; }
.hero-chips text { padding:8rpx 16rpx; border-radius:999rpx; background:rgba(255,255,255,.18); border:1rpx solid rgba(255,255,255,.22); font-size:20rpx; font-weight:750; }
.hero-plate { position:absolute; z-index:1; right:-34rpx; top:82rpx; width:310rpx; height:232rpx; filter: drop-shadow(0 22rpx 32rpx rgba(9,79,55,.2)); animation: meal-float 4.8s ease-in-out infinite; }
.hero-order-card { position:absolute; left:28rpx; right:28rpx; bottom:28rpx; z-index:2; display:flex; align-items:center; justify-content:space-between; gap:18rpx; padding:22rpx; border-radius:32rpx; color:#20342b; background:rgba(255,255,255,.84); border:1rpx solid rgba(255,255,255,.62); box-shadow:0 18rpx 46rpx rgba(9,79,55,.12); backdrop-filter:blur(24rpx) saturate(1.25); }
.order-label,.order-name,.order-meta { display:block; }
.order-label { color:#58cfa0; font-size:20rpx; font-weight:800; letter-spacing:1.6rpx; }
.order-name { margin-top:6rpx; color:#20342b; font-size:30rpx; font-weight:850; }
.order-meta { margin-top:4rpx; color:#70877b; font-size:22rpx; }
.order-price { flex:0 0 auto; color:#1f9f72; font-size:40rpx; font-weight:850; letter-spacing:-1rpx; }
.quick-actions { display:grid; grid-template-columns:repeat(4,1fr); gap:14rpx; margin-bottom:22rpx; }
.quick-action { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8rpx; min-height:128rpx; border-radius:30rpx; color:#426052; background:rgba(255,255,255,.84); box-shadow:0 12rpx 32rpx rgba(21,62,43,.06); backdrop-filter:blur(22rpx) saturate(1.2); font-size:21rpx; font-weight:750; animation: sc-fade-up 360ms ease-out both; }
.quick-action.primary { color:#fff; background:linear-gradient(145deg,#ffd86b,#58cfa0); }
.quick-icon { width:40rpx; height:40rpx; }
.health-strip { display:flex; align-items:center; gap:18rpx; margin-bottom:22rpx; padding:22rpx; border-radius:34rpx; background:linear-gradient(135deg,#20342b,#1f9f72); color:#fff; box-shadow:0 20rpx 50rpx rgba(31,159,114,.16); }
.ring { display:flex; flex-direction:column; align-items:center; justify-content:center; width:92rpx; height:92rpx; border-radius:999rpx; background:conic-gradient(#ffd86b 0 72%, rgba(255,255,255,.2) 72%); box-shadow:inset 0 0 0 10rpx rgba(255,255,255,.18); }
.ring text:first-child { font-size:24rpx; font-weight:850; line-height:1; }
.ring text:last-child { margin-top:2rpx; font-size:17rpx; opacity:.75; }
.health-title,.health-desc { display:block; }
.health-title { font-size:28rpx; font-weight:850; }
.health-desc { margin-top:6rpx; font-size:21rpx; opacity:.78; }
.health-arrow { font-size:54rpx; opacity:.78; }
.home-metrics { margin: 0 0 30rpx; }
.featured-panel { margin-bottom:24rpx; }
.dish-stack { display:flex; flex-direction:column; gap:18rpx; }
.brand-rank { padding:18rpx 0; }
.rank-icon { width:46rpx; height:46rpx; flex:0 0 46rpx; }
.rank-no { display:flex; align-items:center; justify-content:center; width:42rpx; height:42rpx; border-radius:999rpx; color:#fff; background:linear-gradient(135deg,#ffd86b,#58cfa0); font-size:22rpx; font-weight:850; }
@keyframes meal-float { 0%,100% { transform:translateY(0) rotate(0deg); } 50% { transform:translateY(-8rpx) rotate(1deg); } }
</style>
