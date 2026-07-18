<template>
  <sc-page-shell title="健康中心" subtitle="推荐 · 识餐 · 顾问" status="已同步">
    <view class="page-intro">
      <text class="intro-title">把健康目标，落到今天这一餐。</text>
      <text class="intro-desc">健康推荐、拍照识餐、智能顾问 — 三个独立模块各司其职。</text>
    </view>

    <sc-state-card v-if="store.loading.value" type="loading" title="正在更新健康餐单" desc="同步今日供应和营养汇总。" />
    <sc-state-card v-else-if="store.error.value" type="error" title="健康数据加载失败" :desc="store.error.value" action-text="重试" @action="reload" />

    <view class="func-card func-card--recommend" @tap="openRecommend">
      <view class="func-card__body">
        <view class="func-card__icon-wrap" style="background: #e8f9f1;">
          <image class="func-card__icon" src="/static/icons/meal-plan.png" mode="aspectFit" />
        </view>
        <view class="func-card__content">
          <text class="func-card__title">健康推荐</text>
          <text class="func-card__desc">按预算、目标和忌口生成餐单</text>
        </view>
      </view>
      <view class="func-card__cta">
        <text>打开推荐</text>
        <text class="func-card__arrow">›</text>
      </view>
    </view>

    <view class="func-card func-card--vision" @tap="openVision">
      <view class="func-card__body">
        <view class="func-card__icon-wrap" style="background: #eef8ff;">
          <image class="func-card__icon" src="/static/icons/camera.png" mode="aspectFit" />
        </view>
        <view class="func-card__content">
          <text class="func-card__title">拍照识餐</text>
          <text class="func-card__desc">拍照或上传菜品图片估算营养</text>
        </view>
      </view>
      <view class="func-card__cta">
        <text>打开拍照</text>
        <text class="func-card__arrow">›</text>
      </view>
    </view>

    <view class="func-card func-card--agent" @tap="openAgent">
      <view class="func-card__body">
        <view class="func-card__icon-wrap" style="background: #f5f0ff;">
          <image class="func-card__icon" src="/static/icons/agent.png" mode="aspectFit" />
        </view>
        <view class="func-card__content">
          <text class="func-card__title">智能顾问</text>
          <text class="func-card__desc">基于真实菜品数据回答饮食问题</text>
        </view>
      </view>
      <view class="func-card__cta">
        <text>打开顾问</text>
        <text class="func-card__arrow">›</text>
      </view>
    </view>

    <view class="panel-card profile-slim">
      <view class="profile-slim__header">
        <text class="profile-slim__section">档案概览</text>
        <view class="profile-slim__edit" @tap="openProfile">
          <text>编辑</text>
          <text class="profile-slim__arrow">›</text>
        </view>
      </view>
      <view class="archive-grid">
        <view><text class="label-text">目标</text><text class="value-text">{{ goalLabel }}</text></view>
        <view><text class="label-text">餐别</text><text class="value-text">{{ mealLabel }}</text></view>
        <view><text class="label-text">预算</text><text class="value-text">¥{{ store.profile.value.budgetMax }}</text></view>
        <view><text class="label-text">过敏源</text><text class="value-text">{{ store.profile.value.allergies?.join('、') || '无' }}</text></view>
      </view>
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
const goalMap = { fatLoss: '减脂', muscleGain: '增肌', maintain: '维持体重', healthy: '健康饮食' };
const goalLabel = computed(() => goalMap[store.profile.value.goal] || '健康饮食');

onShow(async () => {
  if (!store.user.value) uni.redirectTo({ url: '/pages/login/login' });
  else await store.loadTodayMenu();
});

async function reload() { await store.loadTodayMenu(); }
function openRecommend() { uni.navigateTo({ url: '/pages/recommend/recommend' }); }
function openProfile() { uni.navigateTo({ url: '/pages/recommend/recommend' }); }
function openVision() { uni.navigateTo({ url: '/pages/vision/vision' }); }
function openAgent() { uni.navigateTo({ url: '/pages/agent/agent' }); }
</script>

<style scoped>
.page-intro { margin-bottom: 24rpx; padding: 28rpx 30rpx; border-radius: 28rpx; background: linear-gradient(135deg, #f0faf4, #e7f5ee); }
.intro-title { display: block; font-size: 34rpx; font-weight: 900; color: #18251f; line-height: 1.25; }
.intro-desc { display: block; margin-top: 10rpx; font-size: 23rpx; color: #70877b; line-height: 1.5; }

.func-card { margin-bottom: 18rpx; border-radius: 26rpx; overflow: hidden; box-sizing: border-box; }
.func-card--recommend { background: linear-gradient(135deg, #f0fcf4, #e3f5e9); border: 1rpx solid #d2ecdc; }
.func-card--vision { background: linear-gradient(135deg, #f0f8ff, #e4f0fa); border: 1rpx solid #d0e4f5; }
.func-card--agent { background: linear-gradient(135deg, #f6f2ff, #ede6fc); border: 1rpx solid #dbd1f2; }
.func-card__body { display: flex; align-items: center; gap: 20rpx; padding: 28rpx 28rpx 0; }
.func-card__icon-wrap { width: 72rpx; height: 72rpx; border-radius: 20rpx; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.func-card__icon { width: 40rpx; height: 40rpx; }
.func-card__content { flex: 1; min-width: 0; }
.func-card__title { display: block; font-size: 30rpx; font-weight: 900; color: #18251f; line-height: 1.3; }
.func-card__desc { display: block; margin-top: 4rpx; font-size: 22rpx; color: #70877b; line-height: 1.4; }
.func-card__cta { display: flex; align-items: center; justify-content: space-between; padding: 14rpx 28rpx 20rpx; font-size: 25rpx; font-weight: 800; color: #167a5b; }
.func-card__arrow { font-size: 32rpx; color: #a0b8ab; }
.func-card--recommend .func-card__cta { color: #167a5b; }
.func-card--vision .func-card__cta { color: #167a5b; }
.func-card--agent .func-card__cta { color: #167a5b; }
.func-card:active { transform: scale(0.982); }

.profile-slim { }
.profile-slim__header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14rpx; }
.profile-slim__section { font-size: 20rpx; font-weight: 800; color: #84918a; letter-spacing: 2rpx; }
.profile-slim__edit { display: flex; align-items: center; gap: 4rpx; color: #167a5b; font-size: 24rpx; font-weight: 800; }
.profile-slim__arrow { font-size: 30rpx; color: #a0b8ab; }
.archive-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 10rpx; }
.archive-grid view { padding: 14rpx; border-radius: 14rpx; background: #f4f8f5; }
.archive-grid .label-text { display: block; color: #84918a; font-size: 19rpx; }
.archive-grid .value-text { display: block; margin-top: 4rpx; color: #18251f; font-size: 24rpx; font-weight: 900; }
</style>
