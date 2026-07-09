<template>
  <sc-page-shell title="健康中心" subtitle="推荐 · 识餐 · 顾问" status="已同步">
    <view class="hero-panel health-hero">
      <text class="hero-kicker">HEALTH HUB</text>
      <text class="hero-title">把健康目标，落到今天这一餐。</text>
      <text class="hero-subtitle">推荐、拍照识餐和 AI 顾问合并到一个健康入口，路径更清楚。</text>
    </view>

    <sc-state-card v-if="store.loading.value" type="loading" title="正在更新健康餐单" desc="同步今日供应和营养汇总。" />
    <sc-state-card v-else-if="store.error.value" type="error" title="健康数据加载失败" :desc="store.error.value" action-text="重试" @action="reload" />

    <view class="health-actions">
      <view class="health-action primary" @tap="openRecommend">
        <image src="/static/icons/meal-plan.png" mode="aspectFit" />
        <view><text class="action-title">健康推荐</text><text class="action-desc">按预算和目标生成餐单</text></view>
      </view>
      <view class="health-action" @tap="openVision">
        <image src="/static/icons/camera.png" mode="aspectFit" />
        <view><text class="action-title">拍照识餐</text><text class="action-desc">估算营养并匹配菜品</text></view>
      </view>
      <view class="health-action" @tap="openAgent">
        <image src="/static/icons/agent.png" mode="aspectFit" />
        <view><text class="action-title">智能顾问</text><text class="action-desc">基于真实菜品回答</text></view>
      </view>
    </view>

    <view class="panel-card">
      <sc-section eyebrow="TODAY PLAN" :title="`${store.recommendation.value.goalLabel}餐单`">
        <template #right><text class="pill orange">{{ mealLabel }}</text></template>
      </sc-section>
      <view class="summary-grid">
        <view><text class="num">{{ store.recommendation.value.totals.calories }}</text><text>kcal</text></view>
        <view><text class="num">{{ store.recommendation.value.totals.protein }}g</text><text>蛋白</text></view>
        <view><text class="num">¥{{ store.recommendation.value.totals.price }}</text><text>合计</text></view>
      </view>
    </view>

    <view class="panel-card">
      <sc-section eyebrow="RECOMMENDED" title="今日推荐" />
      <view class="dish-stack">
        <sc-dish-card v-for="dish in store.recommendation.value.dishes" :key="dish.id" :dish="dish" badge="推荐" />
      </view>
      <sc-state-card v-if="!store.recommendation.value.dishes.length" type="empty" title="暂无推荐菜品" desc="请先到菜单维护菜品，或放宽健康档案限制。" />
    </view>
  </sc-page-shell>
</template>

<script setup>
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const mealMap = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };
const mealLabel = computed(() => mealMap[store.profile.value.mealType] || '午餐');

onShow(async () => {
  if (!store.user.value) uni.redirectTo({ url: '/pages/login/login' });
  else await store.loadTodayMenu();
});

async function reload() { await store.loadTodayMenu(); }
function openRecommend() { uni.navigateTo({ url: '/pages/recommend/recommend' }); }
function openVision() { uni.navigateTo({ url: '/pages/vision/vision' }); }
function openAgent() { uni.navigateTo({ url: '/pages/agent/agent' }); }
</script>

<style scoped>
.health-hero { margin-bottom: 22rpx; }
.health-actions { display:flex; flex-direction:column; gap:18rpx; margin-bottom:24rpx; }
.health-action { display:flex; align-items:center; gap:20rpx; padding:24rpx; border-radius:34rpx; background:rgba(255,255,255,.84); border:1rpx solid rgba(255,255,255,.58); box-shadow:0 14rpx 38rpx rgba(21,62,43,.07); backdrop-filter:blur(22rpx) saturate(1.2); }
.health-action.primary { color:#fff; background:linear-gradient(135deg,#7be0b7,#1f9f72); }
.health-action image { width:58rpx; height:58rpx; flex:0 0 58rpx; }
.action-title,.action-desc { display:block; }
.action-title { font-size:30rpx; font-weight:850; }
.action-desc { margin-top:6rpx; font-size:22rpx; color:#70877b; }
.health-action.primary .action-desc { color:rgba(255,255,255,.78); }
.summary-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14rpx; }
.summary-grid view { padding:22rpx; border-radius:26rpx; background:#f3fbf5; text-align:center; color:#70877b; font-size:22rpx; }
.summary-grid .num { display:block; color:#1f9f72; font-size:33rpx; font-weight:850; }
.dish-stack { display:flex; flex-direction:column; gap:18rpx; }
</style>
