<template>
  <view class="screen">
    <view class="header">
      <view>
        <text class="eyebrow">健康档案 / 规则推荐</text>
        <text class="title">个性化餐单</text>
        <text class="subtitle">推荐只来自真实菜品库，优先今日已发布且未售罄菜单。</text>
      </view>
    </view>

    <view class="card profile-card">
      <view class="form-item">
        <text class="label">目标</text>
        <picker class="select-box" :range="goalOptions" range-key="label" :value="goalIndex" @change="setGoal">
          <view>{{ currentGoalLabel }}</view>
        </picker>
      </view>
      <view class="form-item">
        <text class="label">餐别</text>
        <picker class="select-box" :range="mealOptions" range-key="label" :value="mealIndex" @change="setMealType">
          <view>{{ currentMealLabel }}</view>
        </picker>
      </view>
      <view class="form-item">
        <text class="label">预算上限</text>
        <input class="input" type="number" v-model="form.budgetMax" />
      </view>
      <view class="form-item">
        <text class="label">忌口食材</text>
        <input class="input" v-model="avoidText" placeholder="例如：花生、牛肉" />
      </view>
      <button class="primary-btn" @tap="save">保存并生成推荐</button>
      <text v-if="message" class="notice">{{ message }}</text>
    </view>

    <view class="card recommendation-card">
      <view class="between title-row">
        <view>
          <text class="eyebrow">{{ menuSourceLabel }}</text>
          <text class="section-heading">{{ store.recommendation.value.goalLabel }}餐单</text>
        </view>
        <text class="pill">{{ currentMealLabel }}</text>
      </view>
      <view v-for="dish in store.recommendation.value.dishes" :key="dish.id" class="dish-row">
        <text class="emoji">{{ dish.image }}</text>
        <view class="flex-1">
          <text class="main-text">{{ dish.name }}</text>
          <text class="sub-text">{{ dish.nutrition.calories }} kcal · 蛋白 {{ dish.nutrition.protein }}g · ¥{{ dish.price }}</text>
        </view>
      </view>
      <view class="summary-grid">
        <view><text class="num">{{ store.recommendation.value.totals.calories }}</text><text>kcal</text></view>
        <view><text class="num">{{ store.recommendation.value.totals.protein }}g</text><text>蛋白</text></view>
        <view><text class="num">¥{{ store.recommendation.value.totals.price }}</text><text>合计</text></view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { normalizeProfileInput } from '../../../src/domain/validation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const form = reactive({ ...store.profile.value });
const avoidText = ref(store.profile.value.avoid.join(', '));
const message = ref('');
const goalOptions = [
  { value: 'fatLoss', label: '减脂控卡' },
  { value: 'muscleGain', label: '增肌高蛋白' },
  { value: 'maintain', label: '均衡维持' },
  { value: 'healthy', label: '健康饮食' }
];
const mealOptions = [
  { value: 'breakfast', label: '早餐' },
  { value: 'lunch', label: '午餐' },
  { value: 'dinner', label: '晚餐' }
];
const goalIndex = computed(() => Math.max(0, goalOptions.findIndex((item) => item.value === form.goal)));
const mealIndex = computed(() => Math.max(0, mealOptions.findIndex((item) => item.value === form.mealType)));
const currentGoalLabel = computed(() => goalOptions[goalIndex.value].label);
const currentMealLabel = computed(() => mealOptions[mealIndex.value].label);
const menuSourceLabel = computed(() => store.todayMenu.value.dishes.length ? '今日供应优先' : '菜品库兜底');

onShow(() => {
  if (!store.user.value) uni.redirectTo({ url: '/pages/login/login' });
});

watch(store.profile, (profile) => {
  Object.assign(form, profile);
  avoidText.value = profile.avoid.join(', ');
}, { deep: true });

function setGoal(event) {
  form.goal = goalOptions[Number(event.detail.value)]?.value || 'healthy';
}
function setMealType(event) {
  form.mealType = mealOptions[Number(event.detail.value)]?.value || 'lunch';
}
async function save() {
  try {
    await store.saveProfile(normalizeProfileInput(form, avoidText.value));
    message.value = '健康档案已保存，推荐结果已更新。';
  } catch (error) {
    message.value = error.message;
  }
}
</script>

<style scoped>
.section-heading { display: block; margin-top: 6rpx; font-size: 34rpx; font-weight: 900; }
.title-row { margin-bottom: 12rpx; }
.flex-1 { flex: 1; min-width: 0; }
.summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14rpx; margin-top: 22rpx; }
.summary-grid view { padding: 20rpx; border-radius: 24rpx; background: #f3faf0; text-align: center; color: #708093; font-size: 22rpx; }
.summary-grid .num { display: block; color: #08785c; font-size: 32rpx; font-weight: 900; }
</style>
