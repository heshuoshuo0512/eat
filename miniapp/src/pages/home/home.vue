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
        <text class="hero-title">今天吃得轻一点</text>
        <text class="hero-subtitle">轻松吃好每一餐 · 健康无负担</text>
        <view class="hero-chips">
          <text>低脂</text>
          <text>高蛋白</text>
          <text>少油</text>
        </view>
      </view>
    </view>
    <view class="quick-actions">
      <view class="quick-action" :class="{ active: currentAction === 'recommend' }" @tap="openRecommend"><image class="quick-icon" src="/static/icons/meal-plan.png" mode="aspectFit" /><text>智能配餐</text></view>
      <view class="quick-action" :class="{ active: currentAction === 'vision' }" @tap="openVision"><image class="quick-icon" src="/static/icons/camera.png" mode="aspectFit" /><text>拍照识餐</text></view>
      <view class="quick-action" :class="{ active: currentAction === 'eat' }" @tap="openEat"><image class="quick-icon" src="/static/icons/order-dish.png" mode="aspectFit" /><text>吃什么</text></view>
    </view>

    <view class="panel-card swipe-panel">
      <sc-section :eyebrow="menuSourceLabel" title="为你推荐">
        <template #right><text class="pill">{{ progressText }}</text></template>
      </sc-section>
      <sc-state-card v-if="!totalCards && !store.loading.value" type="empty" title="暂无推荐" desc="先去逛逛菜单，推荐会更精准。" />
      <view v-if="currentCard" class="swipe-card" @tap="openDishDetail(currentCard.id)">
        <image class="swipe-cover" :src="dishCoverSrc(currentCard)" mode="aspectFill" />
        <view class="swipe-body">
          <text class="swipe-name">{{ currentCard.name }}</text>
          <text class="swipe-meta">{{ currentCard.taste }} · {{ currentCard.cuisine }} · {{ currentCard.nutrition?.calories || 0 }} kcal</text>
          <view class="swipe-stats">
            <text class="stat"><text class="stat-label">评分</text> {{ (currentCard.rating || 0).toFixed(1) }}</text>
            <text class="stat"><text class="stat-label">热度</text> {{ currentCard.rankScore?.toFixed?.(1) || '—' }}</text>
            <text class="stat"><text class="stat-label">位置</text> {{ dishLocation(currentCard) }}</text>
          </view>
          <view class="swipe-tags">
            <text v-for="tag in (currentCard.tags || []).slice(0, 3)" :key="tag" class="tag">{{ tag }}</text>
          </view>
      </view>
      </view>
      <view class="swipe-actions">
        <button class="secondary-btn" @tap="resetCards">重置</button>
        <button class="primary-btn" @tap="nextCard">下一张 ›</button>
      </view>
    </view>

  </sc-page-shell>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const greeting = computed(() => store.user.value?.nickname || store.user.value?.username || '欢迎回来');
const menuSourceLabel = computed(() => store.todayMenu.value.dishes.length ? '今日供应优先' : '菜品库兜底');
const coverMap = ['bowl', 'rice', 'noodle', 'protein', 'soup'];
const cardIndex = ref(0);
const currentAction = ref('recommend');
const currentCard = computed(() => store.recommendation.value.dishes[cardIndex.value] || null);
const totalCards = computed(() => store.recommendation.value.dishes.length);
const progressText = computed(() => totalCards.value ? `${cardIndex.value + 1}/${totalCards.value}` : '0/0');
function dishCoverSrc(dish) { return `/static/food/${coverMap[Math.abs(hashCode(dish?.id || dish?.name)) % coverMap.length]}.svg`; }
function nextCard() { if (!totalCards.value) return; cardIndex.value = (cardIndex.value + 1) % totalCards.value; }
function resetCards() { cardIndex.value = 0; }

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
function openRecommend() { currentAction.value = 'recommend'; uni.navigateTo({ url: '/pages/recommend/recommend' }); }
function openVision() { currentAction.value = 'vision'; uni.navigateTo({ url: '/pages/vision/vision' }); }
function openEat() { currentAction.value = 'eat'; uni.switchTab({ url: '/pages/dishes/dishes' }); }
function openDishDetail(id) { uni.navigateTo({ url: `/pages/dish-detail/dish-detail?id=${encodeURIComponent(id)}` }); }
function dishLocation(dish) {
  const stall = store.stalls.value.find((s) => s.id === dish.stallId);
  if (!stall) return '—';
  const canteen = store.canteens.value.find((c) => c.id === stall.canteenId);
  return canteen ? `${canteen.name} · ${stall.name}` : stall.name;
}
function hashCode(value) {
  let hash = 0;
  const text = String(value || 'dish');
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) - hash) + text.charCodeAt(index);
  return hash;
}
</script>
<style scoped>
.nav-action,.text-action { padding:10rpx 18rpx; border-radius:999rpx; color:#167a5b; background:#eaf5ef; font-size:22rpx; font-weight:800; }
.search-card { display:flex; align-items:center; gap:14rpx; margin-bottom:20rpx; padding:18rpx 20rpx; border:1rpx solid #e5ece8; border-radius:20rpx; background:#fff; box-shadow:0 8rpx 22rpx rgba(24,37,31,.05); }
.search-icon { width:34rpx; height:34rpx; padding:7rpx; border-radius:12rpx; background:#eaf5ef; }
.search-placeholder { flex:1; min-width:0; color:#84918a; font-size:24rpx; }
.search-tag { padding:8rpx 12rpx; border-radius:10rpx; color:#167a5b; background:#eaf5ef; font-size:19rpx; font-weight:800; }
.hero-shop-card { position:relative; overflow:hidden; min-height:330rpx; margin-bottom:20rpx; padding:28rpx 28rpx 128rpx; border-radius:28rpx; color:#fff; background:linear-gradient(135deg,#167a5b,#0b6047); box-shadow:0 22rpx 48rpx rgba(12,98,72,.2); }
.hero-copy { position:relative; z-index:2; width:100%; }
.hero-kicker { display:block; font-size:19rpx; font-weight:800; letter-spacing:2rpx; opacity:.75; }
.hero-title { display:block; margin-top:14rpx; font-size:42rpx; font-weight:900; line-height:1.12; }
.hero-subtitle { display:block; margin-top:12rpx; font-size:23rpx; line-height:1.5; opacity:.84; }
.hero-chips { display:flex; flex-wrap:wrap; gap:8rpx; margin-top:18rpx; }
.quick-actions { display:grid; grid-template-columns:repeat(3,1fr); gap:10rpx; margin-bottom:20rpx; }
.quick-action { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8rpx; min-height:108rpx; border:1rpx solid #e5ece8; border-radius:20rpx; color:#486257; background:#fff; font-size:21rpx; font-weight:800; }
.quick-action.active { color:#fff; background:#0d4d3a; }
.quick-icon { width:38rpx; height:38rpx; }
.swipe-panel { margin-bottom:20rpx; }.swipe-card { display:flex; flex-direction:row; gap:18rpx; padding:16rpx 0; }.swipe-cover { width:140rpx; height:130rpx; border-radius:16rpx; object-fit:cover; }.swipe-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:6rpx; }.swipe-name { font-size:30rpx; font-weight:900; color:#18251f; }.swipe-meta { font-size:20rpx; color:#84918a; }.swipe-stats { display:flex; flex-wrap:wrap; gap:10rpx; margin:6rpx 0; font-size:20rpx; color:#6b7d75; }.swipe-stats .stat { display:inline-flex; align-items:center; gap:3rpx; padding:3rpx 8rpx; border-radius:8rpx; background:#f0f4f2; }.swipe-stats .stat-label { color:#84918a; font-size:18rpx; }
.swipe-tags { display:flex; flex-wrap:wrap; gap:6rpx; margin-top:4rpx; }.swipe-tags .tag { padding:4rpx 10rpx; border-radius:8rpx; background:#eaf5ef; color:#167a5b; font-size:18rpx; }.swipe-actions { display:flex; gap:12rpx; margin-top:16rpx; }
</style>
