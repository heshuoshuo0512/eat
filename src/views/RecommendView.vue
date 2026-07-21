<template>
  <section class="page-heading recommendation-heading">
    <div>
      <p class="eyebrow">Profile-aware Agent</p>
      <h1>智能推荐</h1>
      <p>结合健康档案、今日菜单和真实菜品数据生成建议，并明确展示引用与可信度。</p>
    </div>
    <RouterLink class="secondary button-link" to="/health-profile">调整健康档案</RouterLink>
  </section>

  <section class="recommend-workspace">
    <aside class="card workspace-panel quick-panel">
      <div class="section-title"><p class="eyebrow">Quick Ask</p><h2>快捷提问</h2></div>
      <div class="quick-prompts">
        <button v-for="prompt in quickPrompts" :key="prompt.label" type="button" class="prompt-button" :disabled="loading" @click="runPrompt(prompt.query)">
          <span>{{ prompt.icon }}</span><strong>{{ prompt.label }}</strong><small>{{ prompt.hint }}</small>
        </button>
      </div>

      <div class="memory-editor">
        <div class="section-title horizontal"><div><p class="eyebrow">Memory</p><h2>推荐记忆</h2></div><span class="memory-status">{{ memory.updatedAt ? '已同步' : '待同步' }}</span></div>
        <textarea v-model="memoryDraft" maxlength="500" placeholder="例如：最近偏好清淡、高蛋白，午餐不想排长队。" />
        <div class="memory-actions">
          <button class="secondary" type="button" :disabled="memorySaving" @click="saveMemory">保存</button>
          <button class="ghost" type="button" :disabled="memorySaving" @click="clearMemory">清除</button>
        </div>
      </div>
    </aside>

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
        <article v-for="(dish, index) in mealPicks" :key="dish.id" class="recommend-dish" :style="{ '--delay': `${index * 70}ms` }">
          <RouterLink :to="{ path: '/dishes', query: { dish: dish.id } }" class="recommend-dish-media">
            <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="dish.name" />
            <span v-else class="emoji large">{{ dish.image || '🍽️' }}</span>
          </RouterLink>
          <div><strong>{{ dish.name }}</strong><small>¥{{ dish.price }} · {{ dish.nutrition?.calories || 0 }} kcal</small></div>
          <RouterLink class="primary button-link compact order-link" :to="{ path: '/orders', query: { dish: dish.id } }">点餐</RouterLink>
        </article>
      </div>

      <form class="recommend-input" @submit.prevent="runPrompt(question)">
        <textarea v-model="question" maxlength="300" placeholder="继续追问：预算 20 元，想吃高蛋白又不辣的午餐…" />
        <button class="primary send-button" type="submit" :disabled="loading || !question.trim()" aria-label="发送问题" title="发送问题">➤</button>
      </form>
      <p v-if="message" class="form-message" :class="{ danger: isError }">{{ message }}</p>
    </main>

    <aside class="workspace-side">
      <section class="card workspace-panel trust-panel">
        <div class="section-title"><p class="eyebrow">Trust</p><h2>可信度参考</h2></div>
        <div class="trust-metrics">
          <article><span>依据充分度</span><strong>{{ percent(result?.eval?.groundednessScore) }}</strong><i><b :style="{ width: percent(result?.eval?.groundednessScore) }"></b></i></article>
          <article><span>工具成功率</span><strong>{{ percent(result?.eval?.toolSuccessRate) }}</strong><i><b :style="{ width: percent(result?.eval?.toolSuccessRate) }"></b></i></article>
          <article><span>安全性</span><strong>{{ percent(result?.eval?.safetyScore) }}</strong><i><b :style="{ width: percent(result?.eval?.safetyScore) }"></b></i></article>
        </div>
        <p class="muted trust-copy">评分用于辅助判断，最终饮食选择仍需结合个人身体状况。</p>
      </section>

      <section class="card workspace-panel source-panel">
        <div class="section-title horizontal"><div><p class="eyebrow">Sources</p><h2>真实引用</h2></div><span class="pill">{{ citations.length }} 条</span></div>
        <div v-if="citations.length" class="source-list">
          <RouterLink v-for="source in citations" :key="source.id || source.sourceId || source.name" :to="citationLink(source)" class="source-item">
            <strong>{{ source.name || source.title || '菜品数据' }}</strong>
            <small>相关度 {{ formatScore(source.score) }}</small>
            <p>{{ source.snippet || '来源于当前校园菜品库与已发布菜单。' }}</p>
          </RouterLink>
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

const quickPrompts = [
  { icon: '◉', label: '按档案推荐', hint: '结合目标与忌口', query: '请根据我的健康档案和今天的供应，推荐一顿合适的餐，并说明理由。' },
  { icon: '¥', label: '预算内吃好', hint: '控制总价与营养', query: '请在我的预算内推荐高性价比午餐，优先保证蛋白质和蔬菜。' },
  { icon: '⌁', label: '避开排队', hint: '优先低人流食堂', query: '我不想排长队，请结合食堂拥挤度推荐现在适合去的档口和菜品。' },
  { icon: '✓', label: '检查忌口', hint: '核对食材风险', query: '请检查今天适合我的菜品，排除健康档案中的忌口和过敏食材。' }
];

const mealPicks = computed(() => result.value?.mealPlan?.picks || result.value?.plan?.picks || []);

function profilePrompt() {
  const profile = store.profile;
  const goalMap = { fatLoss: '减脂', muscleGain: '增肌', maintain: '维持体重', healthy: '健康饮食' };
  return `请根据我的健康档案自动生成本餐推荐。目标：${goalMap[profile.goal] || '健康饮食'}，预算不超过 ${profile.budgetMax || 20} 元，口味偏好 ${profile.taste || '不限'}，并结合今日真实供应、营养和拥挤度说明选择依据。`;
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
  const numeric = Number(value || 0);
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
  await loadMemory();
  await runPrompt(profilePrompt());
});
</script>

<style scoped>
.recommendation-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
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
.conversation-panel { min-height: 680px; display: flex; flex-direction: column; gap: 16px; }
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
.pending-action { display: grid; gap: 7px; padding: 10px 0; border-bottom: 1px solid rgba(31, 122, 77, .1); }
.pending-action > div { display: flex; gap: 8px; }
@keyframes thinking { 0%, 100% { transform: translateY(0); opacity: .45; } 50% { transform: translateY(-6px); opacity: 1; } }
@keyframes message-in { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: translateY(0); } }
@keyframes dish-in { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
@media (max-width: 1180px) {
  .recommend-workspace { grid-template-columns: 230px minmax(0, 1fr); }
  .workspace-side { grid-column: 1 / 3; grid-template-columns: repeat(3, minmax(0, 1fr)); position: static; }
}
@media (max-width: 760px) {
  .recommendation-heading { align-items: stretch; flex-direction: column; }
  .recommendation-heading .button-link { width: 100%; justify-content: center; }
  .recommend-workspace { grid-template-columns: 1fr; }
  .quick-panel, .workspace-side { position: static; }
  .workspace-side { grid-column: auto; grid-template-columns: 1fr; }
  .quick-prompts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .conversation-panel { min-height: 600px; }
  .message { max-width: 94%; }
}
@media (max-width: 480px) {
  .quick-prompts { grid-template-columns: 1fr; }
  .recommend-dish { grid-template-columns: 52px minmax(0, 1fr); }
  .recommend-dish .button-link { grid-column: 1 / 3; width: 100%; justify-content: center; }
  .recommend-input { grid-template-columns: minmax(0, 1fr) 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .message, .recommend-dish, .assistant-thinking span { animation: none; }
  .prompt-button, .trust-metrics b, .conversation { transition: none; scroll-behavior: auto; }
}
</style>
