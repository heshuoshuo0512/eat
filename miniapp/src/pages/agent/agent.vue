<template>
  <sc-page-shell>
    <view class="hero-panel agent-hero">
      <text class="hero-kicker">AI ADVISOR</text>
      <text class="hero-title">问之前，先保证它不胡说。</text>
      <text class="hero-subtitle">顾问只基于真实菜品引用和你的健康档案回答。</text>
    </view>

    <sc-state-card v-if="store.error.value" type="error" title="顾问服务暂不可用" :desc="store.error.value" action-text="去菜单检索" @action="openDishes" />

    <view class="panel-card ask-card">
      <sc-section eyebrow="ASK" title="今天想怎么吃？" desc="输入目标、忌口或预算，先检索再生成回答。" />
      <textarea class="textarea" v-model="question" maxlength="200" placeholder="例如：我今天午餐想减脂高蛋白，推荐什么？" />
      <view class="button-row">
        <button class="secondary-btn" @tap="runSearch">先检索</button>
        <button class="primary-btn" :loading="loading" @tap="askAdvisor">问顾问</button>
      </view>
      <text v-if="message" class="notice">{{ message }}</text>
    </view>

    <view v-if="result" class="panel-card answer-card">
      <sc-section eyebrow="ANSWER" title="顾问回答" />
      <text class="answer">{{ result.answer || result.message }}</text>
      <view v-if="result.recommendation?.dishes?.length" class="answer-dishes">
        <sc-dish-card v-for="dish in result.recommendation.dishes" :key="dish.id" :dish="dish" badge="推荐" @tap="openDishes" />
      </view>
    </view>

    <view v-if="citations.length" class="panel-card">
      <sc-section eyebrow="CITATIONS" title="引用菜品" desc="每条回答都要能回到真实菜品。" />
      <view v-for="item in citations" :key="item.id || item.dish?.id" class="citation-row" @tap="openDishes">
        <image class="citation-icon" :src="citationIconSrc(item)" mode="aspectFit" />
        <view class="flex-1">
          <text class="main-text">{{ item.dish?.name || item.name || item.title }}</text>
          <text class="sub-text">{{ item.reason || item.content || item.snippet || '来自真实菜品库检索结果' }}</text>
        </view>
      </view>
    </view>

    <sc-state-card v-if="result && !citations.length" type="empty" title="暂无引用菜品" desc="请换一个更具体的问题，或先去菜单检索真实菜品。" action-text="去菜单" @action="openDishes" />
  </sc-page-shell>
</template>

<script setup>
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { validateQuestion } from '../../domain/validation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const question = ref('我今天午餐想减脂高蛋白，推荐什么？');
const result = ref(null);
const citations = ref([]);
const loading = ref(false);
const message = ref('');
const citationIconMap = ['menu', 'meal-plan', 'order-dish'];

onShow(() => {
  if (!store.user.value) uni.redirectTo({ url: '/pages/login/login' });
});
function openDishes() { uni.switchTab({ url: '/pages/dishes/dishes' }); }

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
function citationIconSrc(item) {
  const value = item?.id || item?.dish?.id || item?.name || item?.dish?.name;
  return `/static/icons/${citationIconMap[Math.abs(hashCode(value)) % citationIconMap.length]}.png`;
}
function hashCode(value) {
  let hash = 0;
  const text = String(value || 'dish');
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) - hash) + text.charCodeAt(index);
  return hash;
}
</script>

<style scoped>
.agent-hero { margin-bottom: 24rpx; }
.button-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16rpx; margin-top: 22rpx; }
.answer { display: block; color: #25343b; font-size: 29rpx; line-height: 1.75; }
.answer-dishes { display: flex; flex-direction: column; gap: 18rpx; margin-top: 22rpx; }
.citation-row { display: flex; align-items: flex-start; gap: 18rpx; padding: 22rpx 0; border-bottom: 1rpx solid var(--line); }
.citation-icon { width:76rpx; height:76rpx; flex:0 0 76rpx; border-radius:24rpx; background:linear-gradient(145deg,#fff7d8,#e9f8ef); padding:16rpx; box-sizing:border-box; }
.citation-row:last-child { border-bottom: 0; }
</style>
