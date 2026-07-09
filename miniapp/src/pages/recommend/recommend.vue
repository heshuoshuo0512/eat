<template>
  <sc-page-shell>
    <view class="hero-panel recommend-hero">
      <text class="hero-kicker">HEALTH PLAN</text>
      <text class="hero-title">把目标变成今天这一餐。</text>
      <text class="hero-subtitle">先选健康目标和餐别，再从今日供应或真实菜品库生成餐单。</text>
    </view>

    <sc-state-card v-if="store.loading.value" type="loading" title="正在生成健康餐单" desc="同步健康档案和今日供应。" />
    <sc-state-card v-else-if="store.error.value" type="error" title="推荐数据加载失败" :desc="store.error.value" action-text="重试" @action="reload" />

    <view class="panel-card profile-card">
      <sc-section eyebrow="PROFILE" title="健康档案" desc="减少输入，优先用选择项完成配置。" />
      <view class="form-item">
        <text class="label">目标</text>
        <view class="segment">
          <button v-for="item in goalOptions" :key="item.value" class="segment-item" :class="{ active: form.goal === item.value }" @tap="form.goal = item.value">{{ item.label }}</button>
        </view>
      </view>
      <view class="form-item">
        <text class="label">餐别</text>
        <view class="segment">
          <button v-for="item in mealOptions" :key="item.value" class="segment-item" :class="{ active: form.mealType === item.value }" @tap="form.mealType = item.value">{{ item.label }}</button>
        </view>
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
      <view class="button-row">
        <button class="secondary-btn" @tap="openHealth">回健康中心</button>
        <button class="secondary-btn" @tap="openDishes">去菜单检索</button>
      </view>
    </view>

    <view class="panel-card recommendation-card">
      <sc-section :eyebrow="menuSourceLabel" :title="`${store.recommendation.value.goalLabel}餐单`">
        <template #right><text class="pill orange">{{ currentMealLabel }}</text></template>
      </sc-section>
      <view class="dish-stack">
        <sc-dish-card v-for="dish in store.recommendation.value.dishes" :key="dish.id" :dish="dish" badge="推荐" @tap="openDishes" />
      </view>
      <sc-state-card v-if="!store.recommendation.value.dishes.length" type="empty" title="暂无推荐结果" desc="请调整预算、餐别或忌口设置后再试。" />
      <view class="summary-grid">
        <view><text class="num">{{ store.recommendation.value.totals.calories }}</text><text>kcal</text></view>
        <view><text class="num">{{ store.recommendation.value.totals.protein }}g</text><text>蛋白</text></view>
        <view><text class="num">¥{{ store.recommendation.value.totals.price }}</text><text>合计</text></view>
      </view>
    </view>
  </sc-page-shell>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { normalizeProfileInput } from '../../domain/validation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const form = reactive({ ...store.profile.value });
const avoidText = ref(store.profile.value.avoid.join(', '));
const message = ref('');
const goalOptions = [
  { value: 'fatLoss', label: '减脂' },
  { value: 'muscleGain', label: '增肌' },
  { value: 'maintain', label: '均衡' },
  { value: 'healthy', label: '健康' }
];
const mealOptions = [
  { value: 'breakfast', label: '早餐' },
  { value: 'lunch', label: '午餐' },
  { value: 'dinner', label: '晚餐' }
];
const currentMealLabel = computed(() => mealOptions.find((item) => item.value === form.mealType)?.label || '午餐');
const menuSourceLabel = computed(() => store.todayMenu.value.dishes.length ? '今日供应优先' : '菜品库兜底');

onShow(() => {
  if (!store.user.value) uni.redirectTo({ url: '/pages/login/login' });
});

watch(store.profile, (profile) => {
  Object.assign(form, profile);
  avoidText.value = profile.avoid.join(', ');
}, { deep: true });

async function reload() { await store.loadTodayMenu(form.mealType); }
function openHealth() { uni.switchTab({ url: '/pages/health/health' }); }
function openDishes() { uni.switchTab({ url: '/pages/dishes/dishes' }); }
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
.recommend-hero { margin-bottom: 24rpx; }
.dish-stack { display: flex; flex-direction: column; gap: 18rpx; }
.button-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16rpx; margin-top: 18rpx; }
.summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14rpx; margin-top: 24rpx; }
.summary-grid view { padding: 22rpx; border-radius: 26rpx; background: #f4fbef; text-align: center; color: #72818c; font-size: 22rpx; }
.summary-grid .num { display: block; color: #007f61; font-size: 33rpx; font-weight: 950; }
</style>
