<template>
  <sc-page-shell back title="智能顾问" subtitle="问答 · 解释 · 建议" status="基于真实数据">
    <view class="page-intro">
      <text class="intro-title">把问题问清楚，再做决定。</text>
      <text class="intro-desc">顾问负责解释营养、口味和供应信息，不替代健康推荐生成餐单。</text>
    </view>

    <sc-state-card v-if="store.error.value" type="error" title="顾问服务暂不可用" :desc="store.error.value" action-text="去菜单检索" @action="openDishes" />

    <view class="ask-card">
      <view class="ask-card__header">
        <text class="ask-card__eyebrow">ASK</text>
        <text class="ask-card__title">今天想了解什么？</text>
        <text class="ask-card__desc">输入营养、忌口、预算或菜品问题，先检索再获得解释。</text>
      </view>
      <textarea class="ask-card__input" v-model="question" maxlength="200" placeholder="例如：鸡胸肉和牛肉饭的蛋白质有什么区别？" />
      <view class="ask-card__actions">
        <button class="secondary-btn" @tap="runSearch">先检索</button>
        <button class="primary-btn" :loading="loading" @tap="askAdvisor">问顾问</button>
      </view>
      <text v-if="message" class="notice">{{ message }}</text>
    </view>

    <view v-if="result" class="answer-card panel-card">
      <view class="answer-card__header">
        <text class="answer-card__eyebrow">ANSWER</text>
        <text class="answer-card__title">顾问回答</text>
      </view>
      <text class="answer-card__body">{{ result.answer || result.message }}</text>
    </view>

    <view v-if="citations.length" class="panel-card">
      <view class="citations-header">
        <text class="citations-eyebrow">CITATIONS</text>
        <text class="citations-title">引用菜品</text>
        <text class="citations-desc">回答可回到真实菜品库核验。</text>
      </view>
      <view v-for="item in citations" :key="item.id || item.dish?.id" class="citation-row" @tap="openDishes">
        <view class="flex-1">
          <text class="main-text">{{ item.dish?.name || item.name || item.title }}</text>
          <text class="sub-text">{{ item.reason || item.content || item.snippet || '来自真实菜品库检索结果' }}</text>
        </view>
        <text class="citation-arrow">›</text>
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
const question = ref('我想了解今天有哪些高蛋白菜品？');
const result = ref(null);
const citations = ref([]);
const loading = ref(false);
const message = ref('');

onShow(() => { if (!store.user.value) uni.redirectTo({ url: '/pages/login/login' }); });
function openDishes() { uni.switchTab({ url: '/pages/dishes/dishes' }); }
async function askAdvisor() {
  const text = question.value.trim(); message.value = validateQuestion(text); if (message.value) return;
  loading.value = true;
  try { result.value = await store.askMealAdvisor({ query: text, profile: store.profile.value }); citations.value = result.value.citations || []; message.value = ''; }
  catch (error) { message.value = error.message; } finally { loading.value = false; }
}
async function runSearch() {
  const text = question.value.trim(); message.value = validateQuestion(text, { min: 2, max: 100, label: '检索关键词' }); if (message.value) return;
  try { const data = await store.ragSearch(text); citations.value = data.results || []; result.value = null; message.value = ''; } catch (error) { message.value = error.message; }
}
</script>

<style scoped>
.page-intro { margin-bottom: 24rpx; padding: 28rpx 30rpx; border-radius: 28rpx; background: linear-gradient(135deg, #f6f2ff, #ede6fc); }
.intro-title { display: block; font-size: 34rpx; font-weight: 900; color: #18251f; line-height: 1.25; }
.intro-desc { display: block; margin-top: 10rpx; font-size: 23rpx; color: #70877b; line-height: 1.5; }

.ask-card { margin-bottom: 24rpx; border-radius: 28rpx; background: #fff; border: 1rpx solid #e5ece8; box-shadow: 0 4rpx 20rpx rgba(0,0,0,.04); overflow: hidden; }
.ask-card__header { padding: 28rpx 28rpx 0; }
.ask-card__eyebrow { display:block; font-size: 20rpx; font-weight: 800; color: #84918a; letter-spacing: 2rpx; }
.ask-card__title { display: block; margin-top: 8rpx; font-size: 32rpx; font-weight: 900; color: #18251f; }
.ask-card__desc { display: block; margin-top: 6rpx; font-size: 23rpx; color: #70877b; line-height: 1.5; }
.ask-card__input { display: block; width: 100%; margin-top: 20rpx; padding: 20rpx 24rpx; border-radius: 20rpx; border: 1rpx solid #e5ece8; background: #f8fbf9; font-size: 26rpx; line-height: 1.6; color: #18251f; box-sizing: border-box; min-height: 120rpx; }
.ask-card__input:focus { border-color: #1f9f72; background: #fff; }
.ask-card__actions { display: grid; grid-template-columns: 1fr 1fr; gap: 16rpx; padding: 20rpx 28rpx 28rpx; }

.answer-card { border-left: 6rpx solid #1f9f72; }
.answer-card__header { margin-bottom: 14rpx; }
.answer-card__eyebrow { display: block; font-size: 20rpx; font-weight: 800; color: #1f9f72; letter-spacing: 2rpx; }
.answer-card__title { display: block; margin-top: 4rpx; font-size: 28rpx; font-weight: 900; color: #18251f; }
.answer-card__body { display: block; color: #25343b; font-size: 28rpx; line-height: 1.75; }

.citations-header { margin-bottom: 16rpx; }
.citations-eyebrow { display: block; font-size: 20rpx; font-weight: 800; color: #84918a; letter-spacing: 2rpx; }
.citations-title { display: block; margin-top: 4rpx; font-size: 28rpx; font-weight: 900; color: #18251f; }
.citations-desc { display: block; margin-top: 4rpx; font-size: 22rpx; color: #70877b; }

.citation-row { display: flex; align-items: center; gap: 14rpx; padding: 22rpx 0; border-bottom: 1rpx solid var(--line); }
.citation-row:last-child { border-bottom: 0; }
.citation-row:active { opacity: .7; }
.citation-arrow { font-size: 32rpx; color: #a0b8ab; flex-shrink: 0; }
</style>
