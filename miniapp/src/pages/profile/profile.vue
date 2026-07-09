<template>
  <sc-page-shell title="我的" subtitle="学生档案 · 健康偏好" status="在线">
    <view class="profile-card">
      <view class="avatar">{{ avatarText }}</view>
      <view class="flex-1">
        <text class="profile-name">{{ store.user.value?.nickname || store.user.value?.username || '学生用户' }}</text>
        <text class="profile-desc">学生端 · 微信小程序</text>
      </view>
      <button class="logout-btn" @tap="logout">退出</button>
    </view>

    <sc-state-card v-if="store.loading.value" type="loading" title="正在同步学生档案" desc="健康偏好和账号状态正在更新。" />
    <sc-state-card v-else-if="store.error.value" type="error" title="档案同步失败" :desc="store.error.value" action-text="重试" @action="reload" />

    <view class="panel-card">
      <sc-section eyebrow="HEALTH PROFILE" title="健康档案" desc="这里是推荐、识餐和顾问共用的偏好设置。" />
      <view class="profile-grid">
        <view><text class="label-text">目标</text><text class="value-text">{{ goalLabel }}</text></view>
        <view><text class="label-text">预算</text><text class="value-text">¥{{ store.profile.value.budgetMax }}</text></view>
        <view><text class="label-text">餐别</text><text class="value-text">{{ mealLabel }}</text></view>
        <view><text class="label-text">口味</text><text class="value-text">{{ store.profile.value.taste }}</text></view>
      </view>
      <button class="primary-btn" @tap="openRecommend">编辑健康档案</button>
    </view>

    <view class="panel-card">
      <sc-section eyebrow="SHORTCUTS" title="常用入口" />
      <view class="shortcut-row" @tap="openHealth"><image src="/static/icons/meal-plan.png" mode="aspectFit" /><text>健康中心</text><text>›</text></view>
      <view class="shortcut-row" @tap="openMenu"><image src="/static/icons/order-dish.png" mode="aspectFit" /><text>菜单检索</text><text>›</text></view>
      <view class="shortcut-row" @tap="openCanteens"><image src="/static/icons/menu.png" mode="aspectFit" /><text>食堂导航</text><text>›</text></view>
      <view class="shortcut-row" @tap="openAgent"><image src="/static/icons/agent.png" mode="aspectFit" /><text>智能顾问</text><text>›</text></view>
    </view>

    <view class="panel-card">
      <sc-section eyebrow="LEGAL" title="协议与隐私" desc="上线审核和学生授权前置说明。" />
      <view class="shortcut-row" @tap="openPrivacy"><image src="/static/icons/menu.png" mode="aspectFit" /><text>隐私保护指引</text><text>›</text></view>
      <view class="shortcut-row" @tap="openTerms"><image src="/static/icons/menu.png" mode="aspectFit" /><text>用户服务协议</text><text>›</text></view>
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
const goalLabel = computed(() => goals[store.profile.value.goal] || '健康饮食');
const mealLabel = computed(() => meals[store.profile.value.mealType] || '午餐');
const avatarText = computed(() => (store.user.value?.nickname || store.user.value?.username || '学').slice(0, 1));

onShow(() => {
  if (!store.user.value) uni.redirectTo({ url: '/pages/login/login' });
});

function logout() { store.logout(); uni.redirectTo({ url: '/pages/login/login' }); }
async function reload() { await store.load(); }
function openRecommend() { uni.navigateTo({ url: '/pages/recommend/recommend' }); }
function openHealth() { uni.switchTab({ url: '/pages/health/health' }); }
function openMenu() { uni.switchTab({ url: '/pages/dishes/dishes' }); }
function openCanteens() { uni.navigateTo({ url: '/pages/canteens/canteens' }); }
function openAgent() { uni.navigateTo({ url: '/pages/agent/agent' }); }
function openPrivacy() { uni.navigateTo({ url: '/pages/privacy/privacy' }); }
function openTerms() { uni.navigateTo({ url: '/pages/terms/terms' }); }
</script>

<style scoped>
.profile-card { display:flex; align-items:center; gap:20rpx; margin:4rpx 0 24rpx; padding:26rpx; border-radius:36rpx; background:linear-gradient(135deg,#7be0b7,#1f9f72); color:#fff; box-shadow:0 24rpx 60rpx rgba(47,185,135,.22); }
.avatar { display:flex; align-items:center; justify-content:center; width:92rpx; height:92rpx; border-radius:30rpx; background:rgba(255,255,255,.22); font-size:42rpx; font-weight:850; }
.profile-name,.profile-desc { display:block; }
.profile-name { font-size:34rpx; font-weight:850; }
.profile-desc { margin-top:6rpx; font-size:22rpx; opacity:.78; }
.logout-btn { flex:0 0 auto; padding:10rpx 18rpx; border-radius:999rpx; color:#1f9f72; background:#fff; font-size:22rpx; font-weight:750; }
.profile-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:16rpx; margin-bottom:22rpx; }
.profile-grid view { padding:22rpx; border-radius:28rpx; background:#f3fbf5; }
.label-text,.value-text { display:block; }
.label-text { color:#70877b; font-size:21rpx; }
.value-text { margin-top:8rpx; color:#20342b; font-size:30rpx; font-weight:850; }
.shortcut-row { display:flex; align-items:center; gap:18rpx; padding:22rpx 0; border-bottom:1rpx solid var(--line); color:#20342b; font-size:28rpx; font-weight:750; }
.shortcut-row:last-child { border-bottom:0; }
.shortcut-row image { width:46rpx; height:46rpx; }
.shortcut-row text:nth-child(2) { flex:1; }
.shortcut-row text:last-child { color:#70877b; font-size:38rpx; }
</style>
