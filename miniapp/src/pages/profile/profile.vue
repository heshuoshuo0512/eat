<template>
  <sc-page-shell title="我的" subtitle="学生档案 · 健康偏好" status="在线">
    <view class="profile-header">
      <view class="profile-avatar">{{ avatarText }}</view>
      <view class="profile-info">
        <text class="profile-name">{{ store.user.value?.nickname || store.user.value?.username || '学生用户' }}</text>
        <text class="profile-status">已登录</text>
      </view>
      <button class="logout-btn" @tap="logout">退出</button>
    </view>

    <sc-state-card v-if="store.error.value" type="error" title="档案同步失败" :desc="store.error.value" action-text="重试" @action="reload" />

    <view class="profile-section">
      <view class="section-header">
        <text class="section-eyebrow">HEALTH</text>
        <text class="section-title">健康档案</text>
      </view>
      <view class="grid-2col">
        <view class="grid-cell"><text class="label-text">目标</text><text class="value-text">{{ goalLabel }}</text></view>
        <view class="grid-cell"><text class="label-text">预算</text><text class="value-text">¥{{ store.profile.value.budgetMax }}</text></view>
        <view class="grid-cell"><text class="label-text">餐别</text><text class="value-text">{{ mealLabel }}</text></view>
        <view class="grid-cell"><text class="label-text">活动量</text><text class="value-text">{{ activityLabel }}</text></view>
      </view>
      <view class="grid-2col">
        <view class="grid-cell"><text class="label-text">身高</text><text class="value-text">{{ store.profile.value.height || '未填写' }}<text v-if="store.profile.value.height"> cm</text></text></view>
        <view class="grid-cell"><text class="label-text">体重</text><text class="value-text">{{ store.profile.value.weight || '未填写' }}<text v-if="store.profile.value.weight"> kg</text></text></view>
        <view class="grid-cell"><text class="label-text">过敏源</text><text class="value-text">{{ store.profile.value.allergies?.join('、') || '暂无' }}</text></view>
        <view class="grid-cell"><text class="label-text">身体状况</text><text class="value-text">{{ store.profile.value.conditions?.join('、') || '暂无' }}</text></view>
      </view>
      <button class="primary-btn section-cta" @tap="openRecommend">编辑健康档案</button>
    </view>

    <view class="profile-section">
      <view class="section-header">
        <text class="section-eyebrow">SHORTCUTS</text>
        <text class="section-title">常用入口</text>
      </view>
      <view class="shortcut-row" @tap="openHealth">
        <image src="/static/icons/meal-plan.png" mode="aspectFit" />
        <text class="shortcut-label">健康中心</text>
        <text class="shortcut-arrow">›</text>
      </view>
      <view class="shortcut-row" @tap="openMenu">
        <image src="/static/icons/order-dish.png" mode="aspectFit" />
        <text class="shortcut-label">菜单检索</text>
        <text class="shortcut-arrow">›</text>
      </view>
      <view class="shortcut-row" @tap="openCanteens">
        <image src="/static/icons/menu.png" mode="aspectFit" />
        <text class="shortcut-label">校园排行榜</text>
        <text class="shortcut-arrow">›</text>
      </view>
      <view class="shortcut-row" @tap="openAgent">
        <image src="/static/icons/agent.png" mode="aspectFit" />
        <text class="shortcut-label">智能顾问</text>
        <text class="shortcut-arrow">›</text>
      </view>
    </view>

    <view class="profile-section">
      <view class="section-header">
        <text class="section-eyebrow">LEGAL</text>
        <text class="section-title">协议与隐私</text>
      </view>
      <view class="shortcut-row" @tap="openPrivacy">
        <text class="shortcut-label">隐私保护指引</text>
        <text class="shortcut-arrow">›</text>
      </view>
      <view class="shortcut-row" @tap="openTerms">
        <text class="shortcut-label">用户服务协议</text>
        <text class="shortcut-arrow">›</text>
      </view>
    </view>
  </sc-page-shell>
</template>

<script setup>
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useCanteenStore } from '../../stores/canteenStore.js';
const store = useCanteenStore();
const goals = { fatLoss: '减脂', muscleGain: '增肌', maintain: '维持体重', healthy: '健康饮食' };
const meals = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };
const activities = { low: '低', moderate: '中等', high: '高' };
const goalLabel = computed(() => goals[store.profile.value.goal] || '健康饮食');
const mealLabel = computed(() => meals[store.profile.value.mealType] || '午餐');
const activityLabel = computed(() => activities[store.profile.value.activityLevel] || '中等');
const avatarText = computed(() => (store.user.value?.nickname || store.user.value?.username || '学').slice(0, 1));
onShow(() => { if (!store.user.value) uni.redirectTo({ url: '/pages/login/login' }); });
function logout() { store.logout(); uni.redirectTo({ url: '/pages/login/login' }); }
async function reload() { await store.load(); }
function openRecommend() { uni.navigateTo({ url: '/pages/recommend/recommend' }); }
function openHealth() { uni.switchTab({ url: '/pages/health/health' }); }
function openMenu() { uni.switchTab({ url: '/pages/dishes/dishes' }); }
function openCanteens() { uni.switchTab({ url: '/pages/canteens/canteens' }); }
function openAgent() { uni.navigateTo({ url: '/pages/agent/agent' }); }
function openPrivacy() { uni.navigateTo({ url: '/pages/privacy/privacy' }); }
function openTerms() { uni.navigateTo({ url: '/pages/terms/terms' }); }
</script>

<style scoped>
.profile-header { display: flex; align-items: center; gap: 18rpx; margin-bottom: 24rpx; padding: 28rpx; border-radius: 28rpx; color: #fff; background: linear-gradient(135deg, #187e5d, #0b6047); }
.profile-avatar { display: flex; align-items: center; justify-content: center; width: 86rpx; height: 86rpx; border-radius: 24rpx; background: rgba(255,255,255,.16); font-size: 40rpx; font-weight: 900; flex-shrink: 0; }
.profile-info { flex: 1; min-width: 0; }
.profile-name { display: block; font-size: 34rpx; font-weight: 900; line-height: 1.3; }
.profile-status { display: block; margin-top: 4rpx; font-size: 21rpx; opacity: .76; }
.logout-btn { padding: 10rpx 22rpx; border-radius: 999rpx; color: #167a5b; background: #fff; font-size: 22rpx; font-weight: 800; flex-shrink: 0; border: none; }

.profile-section { margin-bottom: 20rpx; padding: 24rpx; border-radius: 28rpx; background: var(--surface); border: 1rpx solid var(--line); box-shadow: var(--shadow); }
.section-header { margin-bottom: 16rpx; }
.section-eyebrow { display: block; font-size: 19rpx; font-weight: 800; color: #84918a; letter-spacing: 2rpx; }
.section-title { display: block; margin-top: 4rpx; font-size: 28rpx; font-weight: 900; color: #18251f; }

.grid-2col { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10rpx; margin-bottom: 12rpx; }
.grid-cell { padding: 16rpx; border-radius: 16rpx; background: #f4f8f5; }
.label-text { display: block; color: #84918a; font-size: 19rpx; }
.value-text { display: block; margin-top: 4rpx; color: #18251f; font-size: 24rpx; font-weight: 900; }
.section-cta { margin-top: 4rpx; }

.shortcut-row { display: flex; align-items: center; gap: 14rpx; min-height: 72rpx; padding: 10rpx 0; border-bottom: 1rpx solid #e5ece8; }
.shortcut-row:last-child { border-bottom: none; }
.shortcut-row:active { opacity: .7; }
.shortcut-row image { width: 40rpx; height: 40rpx; flex-shrink: 0; }
.shortcut-label { flex: 1; color: #18251f; font-size: 26rpx; font-weight: 800; }
.shortcut-arrow { color: #a0b8ab; font-size: 34rpx; flex-shrink: 0; }
</style>
