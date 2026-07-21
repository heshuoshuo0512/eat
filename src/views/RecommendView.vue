<template>
  <section class="page-heading recommendation-heading">
    <div>
      <p class="eyebrow">Profile-aware Agent</p>
      <h1>智能推荐</h1>
      <p>结合健康档案、今日菜单和真实菜品数据生成建议，并明确展示引用与可信度。</p>
    </div>
    <RouterLink class="secondary button-link" to="/health-profile">调整健康档案</RouterLink>
  </section>

  <SmartMealComposer
    v-model="question"
    v-model:memory-draft="memoryDraft"
    title="帮我规划这一餐"
    subtitle="结合健康档案、今日真实供应、评价和校园环境生成推荐。"
    :prompts="profilePrompts"
    :loading="loading"
    :memory-open="memoryOpen"
    :memory-saving="memorySaving"
    action-text="生成推荐"
    loading-text="分析中…"
    @submit="runPrompt(question)"
    @prompt="runPrompt"
    @toggle-memory="memoryOpen = !memoryOpen"
    @save-memory="saveMemory"
    @clear-memory="clearMemory"
  />

  <section v-if="result" class="trust-status-bar" aria-label="推荐可信度参考">
    <article><span>依据充分度</span><strong>{{ percent(result?.eval?.groundednessScore) }}</strong></article>
    <article><span>工具成功率</span><strong>{{ percent(result?.eval?.toolSuccessRate) }}</strong></article>
    <article><span>安全性</span><strong>{{ percent(result?.eval?.safetyScore) }}</strong></article>
    <small>指标用于辅助判断，饮食选择仍需结合个人身体状况。</small>
  </section>

  <section class="recommend-results-grid">
    <main class="card workspace-panel conversation-panel">
      <div class="conversation-header">
        <div><p class="eyebrow">Recommendation</p><h2>你的用餐建议</h2></div>
        <span class="live-indicator"><i></i>{{ loading ? '分析中' : '数据已连接' }}</span>
      </div>

      <div ref="conversationEl" class="conversation" aria-live="polite">
        <div v-if="!conversation.length && loading" class="assistant-thinking">
          <span></span><span></span><span></span><p>正在读取健康档案与今日供应</p>
        </div>
        <article v-for="(messageItem, index) in conversation" :key="`${messageItem.role}-${index}`" :class="['message', messageItem.role]">
          <span class="message-label">{{ messageItem.role === 'user' ? '你' : '智能推荐' }}</span>
          <p>{{ messageItem.content }}</p>
        </article>
      </div>

      <div v-if="mealPicks.length" class="recommendation-strip">
        <div class="recommend-sort"><strong>推荐菜品</strong><div role="group" aria-label="推荐评分排序"><button class="pill" :class="{ active: sortDir === 'desc' }" type="button" @click="sortDir = 'desc'">评分高→低</button><button class="pill" :class="{ active: sortDir === 'asc' }" type="button" @click="sortDir = 'asc'">评分低→高</button></div></div>
        <article v-for="(dish, index) in mealPicks" :key="dish.id" class="recommend-dish" :style="{ '--delay': `${index * 70}ms` }">
          <RouterLink :to="{ path: '/dishes', query: { dish: dish.id } }" class="recommend-dish-media">
            <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="dish.name" />
            <span v-else class="emoji large">{{ dish.image || '🍽️' }}</span>
          </RouterLink>
          <div><strong>{{ dish.name }}</strong><small>评分 {{ dish.displayRating.toFixed(1) }} · ¥{{ dish.price }} · {{ dish.nutrition?.calories || 0 }} kcal</small></div>
          <RouterLink class="primary button-link compact order-link" :to="{ path: '/dishes', query: { dish: dish.id } }">查看详情</RouterLink>
        </article>
      </div>
      <p v-if="message" class="form-message" :class="{ danger: isError }">{{ message }}</p>
    </main>

    <aside class="workspace-side">
      <section class="card workspace-panel source-panel">
        <div class="section-title horizontal"><div><p class="eyebrow">Sources</p><h2>真实引用</h2></div><span class="pill">{{ citations.length }} 条</span></div>
        <div v-if="citations.length" class="source-list">
          <RouterLink v-for="source in visibleRecommendationCitations" :key="source.id || source.sourceId || source.name" :to="citationLink(source)" class="source-item">
            <strong>{{ source.name || source.title || '菜品数据' }}</strong>
            <small>相关度 {{ formatScore(source.score) }}</small>
            <p>{{ compactCitationSnippet(source.snippet) }}</p>
          </RouterLink>
          <button v-if="citations.length > 3" class="text-link source-toggle" type="button" @click="citationsExpanded = !citationsExpanded">{{ citationsExpanded ? '收起引用' : `查看全部 ${citations.length} 条` }}</button>
        </div>
        <p v-else class="muted">完成一次推荐后显示引用来源。</p>
      </section>

      <section v-if="pendingActions.length" class="card workspace-panel action-panel">
        <div class="section-title"><p class="eyebrow">Confirm</p><h2>待确认操作</h2></div>
        <article v-for="action in pendingActions" :key="action.id" class="pending-action">
          <strong>{{ action.label || action.type }}</strong><small>{{ action.riskLevel || 'low' }} 风险</small>
          <div><button class="primary" type="button" @click="confirmAction(action)">确认</button><button class="ghost" type="button" @click="rejectAction(action)">拒绝</button></div>
        </article>
      </section>
    </aside>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import SmartMealComposer from '../components/SmartMealComposer.vue';
import { buildProfilePrompts, compactCitationSnippet, createRatingMap, sortDishesByRating, visibleCitations } from '../domain/studentDiscovery.js';
import { validateQuestion } from '../domain/validation.js';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const question = ref('');
const loading = ref(false);
const message = ref('');
const isError = ref(false);
const sessionId = ref('');
const result = ref(null);
const conversation = ref([]);
const citations = ref([]);
const pendingActions = ref([]);
const memory = ref({ summary: '', preferences: {} });
const memoryDraft = ref('');
const memorySaving = ref(false);
const conversationEl = ref(null);
const memoryOpen = ref(false);
const citationsExpanded = ref(false);
const sortDir = ref('desc');
const profilePrompts = computed(() => buildProfilePrompts(store.profile, 'recommend'));
const visibleRecommendationCitations = computed(() => visibleCitations(citations.value, citationsExpanded.value));
const ratingById = computed(() => createRatingMap(store.rankings.dishes));
const mealPicks = computed(() => {
  const rawPicks = result.value?.recommendations
    || result.value?.mealPlan?.dishes
    || result.value?.mealPlan?.picks
    || result.value?.ranked
    || result.value?.plan?.picks
    || [];
  const dishById = new Map(store.dishes.map((dish) => [String(dish.id), dish]));
  const hydrated = rawPicks.map((pick) => {
    const id = pick.id || pick.dishId;
    return { ...(dishById.get(String(id)) || {}), ...pick, id };
  }).filter((dish) => dish.id);
  return sortDishesByRating(hydrated, ratingById.value, sortDir.value);
});

function deterministicSummary(recommendation) {
  const picks = recommendation.recommendations || recommendation.ranked || [];
  if (!picks.length) {
    const relaxation = recommendation.suggestedRelaxations?.[0];
    const suggestion = typeof relaxation === 'string' ? relaxation : relaxation?.label || relaxation?.message;
    return suggestion ? `当前没有满足全部条件且可点的菜品。可以尝试：${suggestion}` : '当前没有满足全部条件且可点的菜品，请稍后刷新今日供应。';
  }
  const names = picks.slice(0, 3).map((dish) => dish.name).join('、');
  const warning = recommendation.warnings?.[0];
  const warningText = typeof warning === 'string' ? warning : warning?.message;
  return `已根据健康档案与今日真实供应生成 ${picks.length} 个备选方案：${names}。${warningText ? ` ${warningText}` : ''}`;
}

function recommendationCitations(recommendation) {
  const evidence = recommendation.evidence?.dishes || [];
  if (evidence.length) return evidence;
  return (recommendation.recommendations || recommendation.ranked || []).map((dish) => ({
    id: dish.id,
    sourceId: dish.id,
    name: dish.name,
    score: dish.recommendationScore,
    snippet: Array.isArray(dish.why) && dish.why.length ? dish.why.slice(0, 2).join(' · ') : '来源于当前校园菜品库与已发布菜单。'
  }));
}

async function loadInitialRecommendation() {
  loading.value = true;
  message.value = '';
  isError.value = false;
  citationsExpanded.value = false;
  try {
    const response = await store.loadRecommendation();
    result.value = response;
    citations.value = recommendationCitations(response);
    if (response.error) {
      isError.value = true;
      message.value = response.error;
    }
    conversation.value = [{ role: 'assistant', content: deterministicSummary(response) }];
  } finally {
    loading.value = false;
    await scrollToLatest();
  }
}

async function runPrompt(rawText) {
  const text = String(rawText || '').trim();
  const validationError = validateQuestion(text);
  if (validationError) {
    isError.value = true;
    message.value = validationError;
    return;
  }
  loading.value = true;
  message.value = '';
  isError.value = false;
  conversation.value.push({ role: 'user', content: text });
  question.value = '';
  await scrollToLatest();
  try {
    const response = await store.runAgent({ query: text, sessionId: sessionId.value || undefined });
    result.value = response;
    sessionId.value = response.sessionId || sessionId.value;
    citations.value = response.citations || [];
    memory.value = response.memory || memory.value;
    memoryDraft.value = memory.value.summary || '';
    pendingActions.value = (response.actions || []).filter((action) => action.requiresConfirmation);
    conversation.value.push({ role: 'assistant', content: response.answer || response.summary?.text || '推荐已生成。' });
  } catch (error) {
    isError.value = true;
    message.value = error.message || '智能推荐暂时不可用';
    conversation.value.push({ role: 'assistant', content: '本次推荐没有完成，请稍后重试。' });
  } finally {
    loading.value = false;
    await scrollToLatest();
  }
}

async function scrollToLatest() {
  await nextTick();
  if (conversationEl.value) conversationEl.value.scrollTop = conversationEl.value.scrollHeight;
}

async function loadMemory() {
  try {
    memory.value = await store.loadAgentMemory();
    memoryDraft.value = memory.value.summary || '';
  } catch {
    memory.value = { summary: '', preferences: {} };
  }
}

async function saveMemory() {
  memorySaving.value = true;
  try {
    memory.value = await store.saveAgentMemory({ summary: memoryDraft.value.trim(), preferences: memory.value.preferences || {} });
    message.value = '推荐记忆已保存。';
    isError.value = false;
  } catch (error) {
    message.value = error.message || '记忆保存失败';
    isError.value = true;
  } finally {
    memorySaving.value = false;
  }
}

async function clearMemory() {
  memorySaving.value = true;
  try {
    memory.value = await store.clearAgentMemory();
    memoryDraft.value = '';
    message.value = '推荐记忆已清除。';
    isError.value = false;
  } catch (error) {
    message.value = error.message || '记忆清除失败';
    isError.value = true;
  } finally {
    memorySaving.value = false;
  }
}

async function confirmAction(action) {
  try {
    await store.confirmAgentAction(action.id);
    pendingActions.value = pendingActions.value.filter((item) => item.id !== action.id);
    message.value = '操作已确认执行。';
    isError.value = false;
  } catch (error) {
    message.value = error.message;
    isError.value = true;
  }
}

async function rejectAction(action) {
  try {
    await store.rejectAgentAction(action.id);
    pendingActions.value = pendingActions.value.filter((item) => item.id !== action.id);
    message.value = '操作已拒绝。';
    isError.value = false;
  } catch (error) {
    message.value = error.message;
    isError.value = true;
  }
}

function percent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  const normalized = numeric <= 1 ? numeric * 100 : numeric;
  return `${Math.max(0, Math.min(100, Math.round(normalized)))}%`;
}

function formatScore(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? (numeric <= 1 ? `${Math.round(numeric * 100)}%` : numeric.toFixed(1)) : '已验证';
}

function citationLink(source) {
  const dishId = source.sourceId || source.dishId || source.id;
  return dishId ? { path: '/dishes', query: { dish: dishId } } : '/dishes';
}

onMounted(async () => {
  await Promise.all([loadMemory(), loadInitialRecommendation()]);
});
</script>

<style scoped>
.recommendation-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
.trust-status-bar { display: grid; grid-template-columns: repeat(3, minmax(120px, .55fr)) minmax(240px, 1.4fr); align-items: center; gap: 10px; margin: 14px 0; padding: 10px 14px; border: 1px solid rgba(31, 122, 77, .14); background: #f7fbf5; }
.trust-status-bar article { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-right: 10px; border-right: 1px solid rgba(31, 122, 77, .12); font-size: 12px; }
.trust-status-bar strong { color: var(--primary-dark); }
.trust-status-bar small { color: var(--muted); line-height: 1.45; }
.recommend-results-grid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(260px, .72fr); gap: 16px; align-items: start; }
.recommend-workspace { display: grid; grid-template-columns: minmax(210px, .72fr) minmax(420px, 1.55fr) minmax(240px, .82fr); gap: 16px; align-items: start; }
.workspace-panel { padding: 18px; border-radius: 8px; }
.quick-panel { display: grid; gap: 22px; position: sticky; top: 18px; }
.quick-prompts { display: grid; gap: 9px; }
.prompt-button { width: 100%; min-height: 66px; display: grid; grid-template-columns: 30px minmax(0, 1fr); grid-template-rows: auto auto; column-gap: 8px; text-align: left; align-items: center; padding: 11px; border: 1px solid rgba(31, 122, 77, .14); background: #f8fbf7; color: var(--text); }
.prompt-button > span { grid-row: 1 / 3; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 50%; background: #e8f4e5; color: var(--primary-dark); font-weight: 800; }
.prompt-button small { color: var(--muted); }
.prompt-button:hover { border-color: var(--primary); transform: translateX(3px); }
.memory-editor { display: grid; gap: 10px; padding-top: 18px; border-top: 1px solid rgba(31, 122, 77, .12); }
.memory-editor textarea { min-height: 118px; resize: vertical; }
.memory-status { font-size: 11px; color: var(--primary-dark); }
.memory-actions { display: flex; gap: 8px; }
.memory-actions button { flex: 1; }
.conversation-panel { min-height: 570px; display: flex; flex-direction: column; gap: 16px; }
.conversation-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
.live-indicator { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--primary-dark); white-space: nowrap; }
.live-indicator i { width: 8px; height: 8px; border-radius: 50%; background: #36a567; box-shadow: 0 0 0 5px rgba(54, 165, 103, .12); }
.conversation { min-height: 300px; max-height: 430px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding: 8px 4px; scroll-behavior: smooth; }
.message { max-width: 88%; padding: 14px 16px; border-radius: 8px; animation: message-in .28s ease both; }
.message p { margin: 5px 0 0; line-height: 1.7; white-space: pre-wrap; }
.message-label { font-size: 11px; font-weight: 800; color: var(--muted); }
.message.user { align-self: flex-end; background: var(--primary); color: #fff; }
.message.user .message-label { color: rgba(255, 255, 255, .76); }
.message.assistant { align-self: flex-start; background: #f0f7ed; border: 1px solid rgba(31, 122, 77, .12); }
.assistant-thinking { min-height: 210px; display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap; color: var(--muted); }
.assistant-thinking span { width: 8px; height: 8px; border-radius: 50%; background: var(--primary); animation: thinking 1s ease-in-out infinite; }
.assistant-thinking span:nth-child(2) { animation-delay: .12s; }.assistant-thinking span:nth-child(3) { animation-delay: .24s; }
.assistant-thinking p { flex-basis: 100%; text-align: center; }
.recommendation-strip { display: grid; gap: 9px; }
.recommend-sort { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 4px; }
.recommend-sort > div { display: flex; gap: 7px; }
.recommend-sort .pill { border: 1px solid rgba(31, 122, 77, .12); background: #f8fbf7; }
.recommend-sort .pill.active { color: #fff; background: var(--primary); }
.recommend-dish { display: grid; grid-template-columns: 58px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 9px; border: 1px solid rgba(31, 122, 77, .12); border-radius: 8px; animation: dish-in .32s ease both; animation-delay: var(--delay); }
.recommend-dish-media { width: 58px; aspect-ratio: 1; overflow: hidden; border-radius: 6px; background: #edf6e9; display: grid; place-items: center; }
.recommend-dish-media img { width: 100%; height: 100%; object-fit: cover; }
.recommend-dish > div { display: grid; gap: 3px; min-width: 0; }
.button-link.compact { min-height: 36px; padding: 7px 12px; }
.recommend-input { display: grid; grid-template-columns: minmax(0, 1fr) 46px; gap: 9px; margin-top: auto; }
.recommend-input textarea { min-height: 76px; resize: none; }
.send-button { width: 46px; min-height: 46px; padding: 0; align-self: end; font-size: 19px; }
.workspace-side { display: grid; gap: 16px; position: sticky; top: 18px; }
.trust-metrics { display: grid; gap: 14px; }
.trust-metrics article { display: grid; grid-template-columns: 1fr auto; gap: 7px; font-size: 12px; }
.trust-metrics strong { color: var(--primary-dark); }
.trust-metrics i { grid-column: 1 / 3; height: 6px; overflow: hidden; border-radius: 3px; background: #e6ece4; }
.trust-metrics b { display: block; height: 100%; background: var(--primary); border-radius: inherit; transition: width .45s ease; }
.trust-copy { margin: 14px 0 0; font-size: 11px; }
.source-list { display: grid; gap: 9px; }
.source-item { display: grid; gap: 4px; padding: 10px 0; border-bottom: 1px solid rgba(31, 122, 77, .1); color: inherit; text-decoration: none; }
.source-item p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
.source-toggle { width: max-content; justify-self: start; margin-top: 3px; }
.pending-action { display: grid; gap: 7px; padding: 10px 0; border-bottom: 1px solid rgba(31, 122, 77, .1); }
.pending-action > div { display: flex; gap: 8px; }
@keyframes thinking { 0%, 100% { transform: translateY(0); opacity: .45; } 50% { transform: translateY(-6px); opacity: 1; } }
@keyframes message-in { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: translateY(0); } }
@keyframes dish-in { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
@media (max-width: 1180px) {
  .recommend-results-grid { grid-template-columns: minmax(0, 1.35fr) minmax(240px, .65fr); }
  .trust-status-bar { grid-template-columns: repeat(3, 1fr); }
  .trust-status-bar small { grid-column: 1 / 4; }
}
@media (max-width: 760px) {
  .recommendation-heading { align-items: stretch; flex-direction: column; }
  .recommendation-heading .button-link { width: 100%; justify-content: center; }
  .recommend-results-grid { grid-template-columns: 1fr; }
  .quick-panel, .workspace-side { position: static; }
  .workspace-side { grid-column: auto; grid-template-columns: 1fr; }
  .trust-status-bar { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .trust-status-bar article { align-items: flex-start; flex-direction: column; }
  .trust-status-bar small { grid-column: 1 / 4; }
  .quick-prompts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .conversation-panel { min-height: 600px; }
  .message { max-width: 94%; }
}
@media (max-width: 480px) {
  .quick-prompts { grid-template-columns: 1fr; }
  .recommend-dish { grid-template-columns: 52px minmax(0, 1fr); }
  .recommend-dish .button-link { grid-column: 1 / 3; width: 100%; justify-content: center; }
  .recommend-sort { align-items: stretch; flex-direction: column; }
  .recommend-sort > div { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .trust-status-bar { grid-template-columns: 1fr; }
  .trust-status-bar article { align-items: center; flex-direction: row; padding: 0 0 8px; border-right: 0; border-bottom: 1px solid rgba(31, 122, 77, .1); }
  .trust-status-bar small { grid-column: auto; }
  .recommend-input { grid-template-columns: minmax(0, 1fr) 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .message, .recommend-dish, .assistant-thinking span { animation: none; }
  .prompt-button, .trust-metrics b, .conversation { transition: none; scroll-behavior: auto; }
}
</style>
