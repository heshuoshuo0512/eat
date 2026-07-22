<template>
  <sc-page-shell title="我的">
    <view class="account-panel">
      <view class="avatar">{{ avatarText }}</view>
      <view class="account-copy"><text class="account-name">{{ displayName }}</text><text class="account-meta">学生账户 · 数据已同步</text></view>
    </view>

    <button class="favorite-preview" @tap="open('/pages/saved/saved?panel=favorites')">
      <view class="favorite-copy"><text>我的收藏</text><text class="ui-strong">{{ saved.favorites.length }} 道想吃的菜</text><text class="ui-small">{{ saved.favorites.length ? '最近收藏已同步' : '收藏菜品后会显示在这里' }}</text></view>
      <view v-if="favoritePreview.length" class="favorite-images"><image v-for="dish in favoritePreview" :key="dish.id" :src="dish.imageUrl || '/static/food/bowl.svg'" mode="aspectFill" /></view>
      <view v-else class="favorite-empty"><image src="/static/icons/bookmark.png" mode="aspectFit" /></view>
      <text class="arrow">›</text>
    </button>

    <view class="record-grid">
      <button @tap="open('/pages/saved/saved?panel=history')"><text>吃过记录</text><text class="ui-strong">{{ saved.eaten.length }}</text><text class="ui-small">累计 {{ saved.totalEaten }} 次</text></button>
      <button @tap="open('/pages/orders/orders?panel=history')"><text>历史订单</text><text class="ui-strong">{{ orderCount }}</text><text class="ui-small">查看取餐码</text></button>
    </view>

    <view class="menu-section">
      <text class="section-label">个人服务</text>
      <button class="menu-row" @tap="open('/pages/health-profile/health-profile')"><view class="row-icon"><image src="/static/icons/heart-pulse.png" mode="aspectFit" /></view><view class="row-copy"><text class="ui-strong">健康档案</text><text>{{ profileSummary }}</text></view><text class="arrow">›</text></button>
      <button class="menu-row" @tap="open('/pages/orders/orders')"><view class="row-icon"><image src="/static/icons/utensils.png" mode="aspectFit" /></view><view class="row-copy"><text class="ui-strong">今日点餐</text><text>菜单、购物车与取餐码预览</text></view><text class="preview-tag">联调中</text><text class="arrow">›</text></button>
    </view>

    <view class="menu-section">
      <text class="section-label">设置与协议</text>
      <view class="menu-row static-row"><view class="row-icon"><image src="/static/icons/settings.png" mode="aspectFit" /></view><view class="row-copy"><text class="ui-strong">减少动画</text><text>关闭翻转与列表位移动效</text></view><switch color="#237A57" :checked="store.motionReduced.value" @change="toggleMotion" /></view>
      <button class="menu-row text-row" @tap="open('/pages/privacy/privacy')"><view class="row-copy"><text class="ui-strong">隐私保护指引</text></view><text class="arrow">›</text></button>
      <button class="menu-row text-row" @tap="open('/pages/terms/terms')"><view class="row-copy"><text class="ui-strong">用户服务协议</text></view><text class="arrow">›</text></button>
    </view>

    <button class="logout-button" @tap="logout">退出登录</button>
  </sc-page-shell>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { savedDishEntries } from '../../domain/studentDiscovery.js';
import { goalLabel, mealTypeLabel } from '../../utils/format.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const orderCount = ref(0);
const displayName = computed(() => store.user.value?.nickname || store.user.value?.username || '学生用户');
const avatarText = computed(() => displayName.value.slice(0, 1));
const saved = computed(() => savedDishEntries(store.dishes.value, store.dishPreferences.value));
const favoritePreview = computed(() => saved.value.favorites.slice(0, 3));
const profileSummary = computed(() => `${goalLabel(store.profile.value.goal)} · ${mealTypeLabel(store.profile.value.mealType)} · ¥${store.profile.value.budgetMax} 内`);

onShow(async () => {
  try {
    await store.refreshIfStale();
    if (!store.user.value) { uni.reLaunch({ url: '/pages/login/login' }); return; }
    const result = await store.listOrders().catch(() => ({ orders: [] }));
    orderCount.value = Array.isArray(result.orders) ? result.orders.length : 0;
  } catch {}
});

onPullDownRefresh(async () => {
  try {
    await store.load(true);
    const result = await store.listOrders().catch(() => ({ orders: [] }));
    orderCount.value = Array.isArray(result.orders) ? result.orders.length : 0;
  } catch {} finally {
    uni.stopPullDownRefresh();
  }
});

function open(url) { uni.navigateTo({ url }); }
function toggleMotion(event) { store.setMotionReduced(Boolean(event.detail.value)); }
function logout() {
  uni.showModal({
    title: '退出登录', content: '确认退出当前账号？',
    success(result) { if (!result.confirm) return; store.logout(); uni.reLaunch({ url: '/pages/login/login' }); }
  });
}
</script>

<style scoped>
.account-panel { display:flex; align-items:center; gap:16rpx; padding:12rpx 0 26rpx; }
.avatar { display:flex; align-items:center; justify-content:center; width:88rpx; height:88rpx; flex:0 0 88rpx; border-radius:50%; color:#fff; background:var(--brand); font-size:36rpx; font-weight:600; }
.account-copy { flex:1; min-width:0; }
.account-name,.account-meta { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.account-name { color:var(--ink); font-size:32rpx; font-weight:600; }
.account-meta { margin-top:5rpx; color:var(--muted); font-size:24rpx; }
.favorite-preview { position:relative; display:flex; align-items:center; gap:18rpx; width:100%; min-height:190rpx; padding:24rpx 46rpx 24rpx 24rpx; border:1rpx solid var(--line); border-radius:var(--radius-large); background:var(--surface); text-align:left; box-shadow:var(--shadow-soft); }
.favorite-copy { flex:1; min-width:0; }
.favorite-copy text,.favorite-copy .ui-strong,.favorite-copy .ui-small { display:block; }
.favorite-copy text { color:var(--brand); font-size:22rpx; font-weight:500; }
.favorite-copy .ui-strong { margin-top:6rpx; color:var(--ink); font-size:30rpx; font-weight:600; }
.favorite-copy .ui-small { margin-top:6rpx; color:var(--muted); font-size:22rpx; }
.favorite-images { position:relative; width:158rpx; height:92rpx; flex:0 0 158rpx; }
.favorite-images image { position:absolute; top:0; width:84rpx; height:84rpx; border:4rpx solid #fff; border-radius:50%; background:var(--surface-soft); }
.favorite-images image:nth-child(1) { left:0; z-index:3; }
.favorite-images image:nth-child(2) { left:36rpx; z-index:2; }
.favorite-images image:nth-child(3) { left:72rpx; z-index:1; }
.favorite-empty { display:flex; align-items:center; justify-content:center; width:80rpx; height:80rpx; flex:0 0 80rpx; border-radius:50%; background:var(--brand-soft); }
.favorite-empty image { width:38rpx; height:38rpx; }
.arrow { color:#97a29b; font-size:36rpx; }
.favorite-preview>.arrow { position:absolute; right:18rpx; top:50%; transform:translateY(-50%); }
.record-grid { display:grid; grid-template-columns:1fr 1fr; gap:14rpx; margin:16rpx 0 30rpx; }
.record-grid button { min-height:154rpx; padding:20rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); text-align:left; }
.record-grid text,.record-grid .ui-strong,.record-grid .ui-small { display:block; }
.record-grid text { color:var(--muted); font-size:22rpx; }
.record-grid .ui-strong { margin-top:4rpx; color:var(--ink); font-size:34rpx; font-weight:600; }
.record-grid .ui-small { margin-top:4rpx; color:var(--muted); font-size:22rpx; }
.menu-section { margin-bottom:20rpx; overflow:hidden; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); }
.section-label { display:block; padding:20rpx 20rpx 8rpx; color:var(--muted); font-size:22rpx; font-weight:500; }
.menu-row { display:flex; align-items:center; gap:14rpx; width:100%; min-height:104rpx; padding:14rpx 20rpx; border-bottom:1rpx solid var(--line); border-radius:0; background:transparent; text-align:left; box-sizing:border-box; }
.menu-row:last-child { border-bottom:0; }
.menu-row:active { background:var(--surface-soft); }
.static-row:active { background:transparent; }
.row-icon { display:flex; align-items:center; justify-content:center; width:52rpx; height:52rpx; flex:0 0 52rpx; border-radius:12rpx; background:var(--brand-soft); }
.row-icon image { width:32rpx; height:32rpx; }
.row-copy { flex:1; min-width:0; }
.row-copy .ui-strong,.row-copy text { display:block; }
.row-copy .ui-strong { color:var(--ink); font-size:26rpx; font-weight:500; }
.row-copy text { margin-top:4rpx; overflow:hidden; color:var(--muted); font-size:22rpx; white-space:nowrap; text-overflow:ellipsis; }
.text-row { min-height:88rpx; padding-left:22rpx; }
.preview-tag { flex:0 0 auto; min-height:38rpx; padding:0 8rpx; border-radius:8rpx; color:#936016; background:var(--rating-soft); font-size:22rpx; line-height:38rpx; }
.logout-button { width:100%; min-height:88rpx; margin-top:8rpx; border:1rpx solid #f0d9d4; border-radius:var(--radius); color:var(--danger); background:var(--surface); font-size:26rpx; font-weight:500; }
.favorite-preview:active,.record-grid button:active { transform:scale(.985); background:#fafcfa; }
</style>
