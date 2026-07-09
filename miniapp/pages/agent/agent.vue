<template>
  <view class="screen">
    <view class="header">
      <view>
        <text class="eyebrow">Grounded RAG</text>
        <text class="title">智能用餐顾问</text>
        <text class="subtitle">只基于真实菜品引用和你的健康档案回答。</text>
      </view>
    </view>

    <view class="card ask-card">
      <textarea class="textarea" v-model="question" maxlength="200" placeholder="例如：我今天午餐想减脂高蛋白，推荐什么？" />
      <view class="button-row">
        <button class="secondary-btn" @tap="runSearch">先检索</button>
        <button class="primary-btn" :loading="loading" @tap="askAdvisor">问顾问</button>
      </view>
      <text v-if="message" class="notice">{{ message }}</text>
    </view>

    <view v-if="result" class="card answer-card">
      <text class="eyebrow">顾问回答</text>
      <text class="answer">{{ result.answer || result.message }}</text>
      <view v-if="result.recommendation?.dishes?.length" class="answer-dishes">
        <view v-for="dish in result.recommendation.dishes" :key="dish.id" class="dish-row">
          <text class="emoji">{{ dish.image }}</text>
          <view class="flex-1">
            <text class="main-text">{{ dish.name }}</text>
            <text class="sub-text">{{ dish.nutrition.calories }} kcal · 蛋白 {{ dish.nutrition.protein }}g</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="citations.length" class="card">
      <text class="eyebrow">引用菜品</text>
      <view v-for="item in citations" :key="item.id || item.dish?.id" class="dish-row">
        <text class="emoji">{{ item.dish?.image || item.image || '🍽️' }}</text>
        <view class="flex-1">
          <text class="main-text">{{ item.dish?.name || item.name || item.title }}</text>
          <text class="sub-text">{{ item.reason || item.content || item.snippet || '来自真实菜品库检索结果' }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { validateQuestion } from '../../../src/domain/validation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const question = ref('我今天午餐想减脂高蛋白，推荐什么？');
const result = ref(null);
const citations = ref([]);
const loading = ref(false);
const message = ref('');

onShow(() => {
  if (!store.user.value) uni.redirectTo({ url: '/pages/login/login' });
});

async function askAdvisor() {
  const text = question.value.trim();
  message.value = validateQuestion(text);
  if (message.value) return;
  loading.value = true;
  try {
    result.value = await store.askMealAdvisor({ query: text, profile: store.profile.value });
    citations.value = result.value.citations || [];
    message.value = '';
  } catch (error) {
    message.value = error.message;
  } finally {
    loading.value = false;
  }
}

async function runSearch() {
  const text = question.value.trim();
  message.value = validateQuestion(text, { min: 2, max: 100, label: '检索关键词' });
  if (message.value) return;
  try {
    const data = await store.ragSearch(text);
    citations.value = data.results || [];
    result.value = null;
    message.value = '';
  } catch (error) {
    message.value = error.message;
  }
}
</script>

<style scoped>
.button-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16rpx; margin-top: 22rpx; }
.answer { display: block; margin-top: 16rpx; color: #25343b; font-size: 29rpx; line-height: 1.7; }
.answer-dishes { margin-top: 16rpx; }
.flex-1 { flex: 1; min-width: 0; }
</style>
