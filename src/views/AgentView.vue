<template>
  <section class="page-heading">
    <p class="eyebrow">Enterprise Canteen Agent</p>
    <h1>食堂智能体中枢</h1>
    <p>具备实时执行流、Function Calling Schema、长期记忆、多 Agent 分工、动作中心和 Eval 仪表盘。</p>
  </section>

  <section class="grid two-columns align-start">
    <form class="card admin-form" @submit.prevent="runAgent">
      <div class="section-title">
        <p class="eyebrow">Agent Console</p>
        <h2>向智能体发起任务</h2>
      </div>
      <label>会话 ID<input v-model="sessionId" placeholder="自动生成，可用于多轮追问" /></label>
      <label>任务<textarea v-model="question" placeholder="帮我下一份鸡腿饭，先给我确认动作" required /></label>
      <div class="table-actions">
        <button class="primary" type="submit" :disabled="loading">{{ loading ? '智能体执行中...' : '运行智能体' }}</button>
        <button class="secondary" type="button" :disabled="loading" @click="runRealtimeAgent">实时执行流</button>
        <button class="secondary" type="button" @click="runSearch">仅 RAG 检索</button>
        <button class="secondary" type="button" :disabled="!sessionId" @click="loadEvents">加载事件</button>
        <button class="secondary" type="button" @click="loadActions()">加载动作中心</button>
        <button class="secondary" type="button" :disabled="!sessionId" @click="loadStream">回放 SSE</button>
        <button class="secondary" type="button" @click="loadEvals">加载 Eval</button>
        <button class="secondary" type="button" @click="loadMemory">治理·记忆</button>
        <button class="secondary" type="button" @click="loadReadiness">治理·部署</button>
      </div>
      <p v-if="message" class="form-message danger">{{ message }}</p>
    </form>

    <article class="card">
      <div class="section-title">
        <p class="eyebrow">Answer</p>
        <h2>智能体回答</h2>
      </div>
      <p class="hero-copy">{{ result?.answer || '提交任务后展示智能体基于真实工具链的回答。' }}</p>
      <p v-if="result?.summary?.text" class="muted">{{ result.summary.text }}</p>
      <div v-if="result?.plan" class="dish-list dense">
        <div class="dish-row">
          <span><strong>{{ result.plan.goal }}</strong><small>风险：{{ result.plan.riskLevel }} · {{ result.plan.steps?.length || 0 }} 步</small></span>
        </div>
        <div v-for="guardrail in result.plan.guardrails || []" :key="guardrail" class="dish-row">
          <span><strong>Guardrail</strong><small>{{ guardrail }}</small></span>
        </div>
      </div>
      <div v-if="result?.personas?.length" class="dish-list dense">
        <div v-for="persona in result.personas" :key="persona.name" class="dish-row">
          <span><strong>{{ persona.title }}</strong><small>{{ persona.name }} · {{ persona.responsibility }}</small></span>
        </div>
      </div>
      <div v-if="result?.memory" class="dish-list dense">
        <div class="dish-row"><span><strong>长期记忆</strong><small>{{ result.memory.summary || '暂无摘要' }} · {{ JSON.stringify(result.memory.preferences || {}) }}</small></span></div>
      </div>
      <div v-if="result?.actions?.length" class="dish-list dense">
        <div v-for="action in result.actions" :key="action.id || action.to" class="dish-row">
          <span><strong>{{ action.label || action.type }}</strong><small>{{ action.status || action.to }} · {{ action.riskLevel || 'low' }}</small></span>
          <button v-if="action.requiresConfirmation" class="primary" type="button" @click="confirm(action)">确认执行</button>
          <RouterLink v-else-if="action.to" class="button-link" :to="action.to">前往</RouterLink>
        </div>
      </div>
      <div v-if="mealPicks().length" class="dish-list">
        <article v-for="dish in mealPicks()" :key="dish.id" class="dish-row">
          <span class="emoji">{{ dish.image }}</span>
          <div>
            <strong>{{ dish.name }}</strong>
            <small>¥{{ dish.price }} · {{ dish.taste }} · 蛋白 {{ dish.nutrition.protein }}g</small>
          </div>
        </article>
      </div>
    </article>
  </section>

  <section v-if="result" class="grid two-columns align-start">
    <article class="card">
      <div class="section-title">
        <p class="eyebrow">Tool Registry</p>
        <h2>执行轨迹 · {{ result.intent }}</h2>
      </div>
      <div class="dish-list dense">
        <div v-for="step in registryEntries()" :key="step.tool" class="dish-row">
          <span><strong>{{ step.title || step.tool }}</strong><small>{{ step.tool }} · {{ step.category || 'tool' }} · {{ step.riskLevel || 'low' }} · {{ step.status }} · {{ step.latencyMs || 0 }}ms</small></span>
        </div>
      </div>
      <div v-if="functionSchemas().length" class="dish-list dense">
        <div v-for="tool in functionSchemas()" :key="tool.name" class="dish-row">
          <span><strong>{{ tool.name }}</strong><small>Function Schema · {{ JSON.stringify(tool.parameters) }}</small></span>
        </div>
      </div>
    </article>

    <article class="card">
      <div class="section-title">
        <p class="eyebrow">Tool Results</p>
        <h2>工具结果</h2>
      </div>
      <pre class="code-block">{{ JSON.stringify(result.toolResults, null, 2) }}</pre>
    </article>
  </section>

  <section class="grid two-columns align-start">
    <article class="card">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">Action Center</p>
          <h2>待确认动作中心</h2>
        </div>
        <select v-model="actionStatus" @change="loadActions()">
          <option value="pending">pending</option>
          <option value="confirmed">confirmed</option>
          <option value="rejected">rejected</option>
          <option value="all">all</option>
        </select>
      </div>
      <div v-if="actionCenter.length" class="dish-list dense">
        <div v-for="action in actionCenter" :key="action.id" class="dish-row">
          <span><strong>{{ action.type }}</strong><small>{{ action.status }} · {{ action.riskLevel }} · {{ action.sessionId }} · Hash {{ (action.payloadHash || '').slice(0,8) }}… · {{ action.expiresAt ? '过期'+action.expiresAt.slice(0,10) : '无过期' }}</small></span>
          <button v-if="action.requiresConfirmation" class="primary" type="button" @click="confirm(action)">确认</button>
        </div>
      </div>
      <p v-else class="muted">当前筛选下暂无动作。</p>
    </article>

    <article class="card">
      <div class="section-title">
        <p class="eyebrow">SSE Replay</p>
        <h2>事件流回放</h2>
      </div>
      <div v-if="streamEvents.length" class="dish-list dense">
        <div v-for="(event, index) in streamEvents" :key="`${event.event}-${index}`" class="dish-row">
          <span><strong>{{ event.event }}</strong><small>{{ JSON.stringify(event.data) }}</small></span>
        </div>
      </div>
      <p v-else class="muted">点击“回放 SSE”读取当前会话的命名事件流。</p>
    </article>
  </section>

  <section class="grid two-columns align-start">
    <article class="card">
      <div class="section-title">
        <p class="eyebrow">Realtime Run</p>
        <h2>实时执行流</h2>
      </div>
      <div v-if="realtimeEvents.length" class="dish-list dense">
        <div v-for="(event, index) in realtimeEvents" :key="`${event.event}-${index}`" class="dish-row">
          <span><strong>{{ event.event }}</strong><small>{{ JSON.stringify(event.data) }}</small></span>
        </div>
      </div>
      <p v-else class="muted">点击“实时执行流”后展示 run started、tool finished、action required、eval 和 done 事件。</p>
    </article>

    <article class="card">
      <div class="section-title">
        <p class="eyebrow">Agent Eval</p>
        <h2>评测仪表盘</h2>
      </div>
      <div v-if="evals" class="dish-list dense">
        <div class="dish-row"><span><strong>运行数 {{ evals.metrics.totalRuns }}</strong><small>Grounded {{ score(evals.metrics.avgGroundedness) }} · Tool {{ score(evals.metrics.avgToolSuccess) }} · Safety {{ score(evals.metrics.avgSafety) }} · {{ Math.round(evals.metrics.avgLatencyMs || 0) }}ms</small></span></div>
        <div v-for="run in evals.runs" :key="run.id" class="dish-row">
          <span><strong>{{ run.intent }}</strong><small>{{ run.riskLevel }} · tools {{ run.toolCount }} · actions {{ run.actionCount }} · safety {{ score(run.safetyScore) }}</small></span>
        </div>
      </div>
      <p v-else class="muted">运营角色可加载最近智能体评测记录。</p>
    </article>
  </section>

  <section class="grid two-columns align-start">
    <article class="card admin-form">
      <div class="section-title horizontal">
        <h2>长期记忆治理</h2>
        <button class="secondary" type="button" @click="loadMemory">刷新</button>
      </div>
      <label>记忆摘要<textarea v-model="memoryForm.summary" placeholder="当前用户长期记忆摘要，tenant+user 隔离" /></label>
      <label>偏好 JSON<textarea v-model="memoryForm.preferencesJson" placeholder='{"taste":"不辣","halalOnly":true}' /></label>
      <div class="table-actions">
        <button class="primary" type="button" @click="saveMemory">保存</button>
        <button class="secondary" type="button" @click="clearMemory">清空我的记忆</button>
      </div>
    </article>

    <article class="card admin-form">
      <div class="section-title horizontal">
        <h2>部署就绪检查</h2>
        <button class="secondary" type="button" @click="loadReadiness">检查</button>
      </div>
      <div v-if="readiness" class="dish-list dense">
        <div :class="readiness.ok ? 'dish-row' : 'dish-row danger'">
          <span><strong>{{ readiness.ok ? 'Ready' : 'Blocked' }}</strong><small>AI Key 暴露：{{ readiness.aiKeysConfigured ? '异常' : '未暴露' }}</small></span>
        </div>
        <div v-for="(check, name) in readiness.checks" :key="name" class="dish-row">
          <span><strong>{{ name }}</strong><small>{{ check.status }} · {{ check.summary || check.message || check.tables?.join(',') || '' }}</small></span>
        </div>
      </div>
      <p v-else class="muted">检查 agent/runtime/schema；不返回 AI Key。</p>
    </article>
  </section>

  <section class="card admin-form">
    <div class="section-title horizontal">
      <h2>评测用例治理</h2>
      <button class="secondary" type="button" @click="loadEvalCases">加载</button>
    </div>
    <div class="grid two-columns align-start">
      <div class="admin-form">
        <label>名称<input v-model="evalCaseForm.name" placeholder="清真午餐推荐" /></label>
        <label>Query<textarea v-model="evalCaseForm.query" placeholder="推荐清真午餐" /></label>
        <label>期望 Intent<input v-model="evalCaseForm.expectedIntent" placeholder="meal_planning" /></label>
        <label>必需工具 CSV<input v-model="evalCaseForm.requiredTools" placeholder="rag.meal_advisor,menu.today" /></label>
        <label>禁止工具 CSV<input v-model="evalCaseForm.forbiddenTools" placeholder="orders.analytics" /></label>
        <label class="checkbox-row"><input v-model="evalCaseForm.expectAction" type="checkbox" /> 期望动作</label>
        <label class="checkbox-row"><input v-model="evalCaseForm.enabled" type="checkbox" /> 启用</label>
        <div class="table-actions">
          <button class="primary" type="button" @click="saveEvalCase">{{ evalCaseForm.id ? '更新' : '新建' }}</button>
          <button class="secondary" type="button" @click="resetEvalCaseForm">重置</button>
        </div>
      </div>
      <div class="dish-list dense">
        <div v-for="tc in evalCases" :key="tc.id" class="dish-row">
          <span><strong>{{ tc.name }}</strong><small>{{ tc.expectedIntent || '-' }} · req {{ tc.requiredTools?.join(',') || '-' }} · forb {{ tc.forbiddenTools?.join(',') || '-' }} · {{ tc.enabled ? 'on' : 'off' }}</small></span>
          <span class="table-actions">
            <button class="secondary" type="button" @click="editEvalCase(tc)">编辑</button>
            <button class="secondary" type="button" @click="runEvalCase(tc)">运行</button>
            <button class="secondary" type="button" @click="deleteEvalCase(tc)">删除</button>
          </span>
        </div>
        <p v-if="!evalCases.length" class="muted">运营角色可管理；学生被后端拒绝。</p>
      </div>
    </div>
  </section>

  <section v-if="events" class="card">
    <div class="section-title">
      <p class="eyebrow">Session Events</p>
      <h2>会话事件</h2>
    </div>
    <pre class="code-block">{{ JSON.stringify(events, null, 2) }}</pre>
  </section>

  <section class="card">
    <div class="section-title horizontal">
      <div>
        <p class="eyebrow">RAG Citations</p>
        <h2>检索引用</h2>
      </div>
    </div>
    <div v-if="citations.length" class="cards-grid">
      <article v-for="item in citations" :key="item.id || item.name" class="mini-card">
        <strong>{{ item.name || item.title }}</strong>
        <small>score {{ item.score }}</small>
        <p class="muted">{{ item.snippet }}</p>
      </article>
    </div>
    <p v-else class="muted">暂无引用。智能体会优先检索真实菜品库。</p>
  </section>
</template>

<script setup>
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import { validateQuestion } from '../domain/validation.js';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const question = ref('帮我下一份鸡腿饭，先给我确认动作');
const sessionId = ref('');
const result = ref(null);
const events = ref(null);
const citations = ref([]);
const actionCenter = ref([]);
const streamEvents = ref([]);
const realtimeEvents = ref([]);
const evals = ref(null);
const actionStatus = ref('pending');
const loading = ref(false);
const message = ref('');
const readiness = ref(null);
const evalCases = ref([]);
const memoryForm = ref({ summary: '', preferencesJson: '' });
const evalCaseForm = ref({ name: '', query: '', expectedIntent: '', requiredTools: '', forbiddenTools: '', expectAction: false, enabled: true, id: '' });

async function loadMemory() {
  try {
    const mem = await store.loadAgentMemory();
    memoryForm.value = { summary: mem.summary, preferencesJson: JSON.stringify(mem.preferences || {}, null, 2) };
  } catch (e) { message.value = e.message; }
}

async function saveMemory() {
  try {
    let preferences = {};
    try { preferences = JSON.parse(memoryForm.value.preferencesJson || '{}'); } catch { preferences = {}; }
    await store.saveAgentMemory({ summary: memoryForm.value.summary, preferences });
    message.value = '记忆已保存';
  } catch (e) { message.value = e.message; }
}

async function clearMemory() {
  try {
    await store.clearAgentMemory();
    memoryForm.value = { summary: '', preferencesJson: '' };
    message.value = '记忆已清空';
  } catch (e) { message.value = e.message; }
}

async function loadReadiness() {
  try {
    const r = await store.loadDeploymentReadiness();
    readiness.value = r;
  } catch (e) { message.value = e.message; }
}

async function loadEvalCases() {
  try {
    const cases = await store.loadAgentEvalCases();
    evalCases.value = cases;
  } catch (e) { message.value = e.message; }
}

async function saveEvalCase() {
  try {
    const f = evalCaseForm.value;
    const payload = {
      name: f.name, query: f.query, expectedIntent: f.expectedIntent,
      requiredTools: f.requiredTools ? f.requiredTools.split(',').map((t) => t.trim()).filter(Boolean) : [],
      forbiddenTools: f.forbiddenTools ? f.forbiddenTools.split(',').map((t) => t.trim()).filter(Boolean) : [],
      expectAction: f.expectAction, enabled: f.enabled,
    };
    if (f.id) payload.id = f.id;
    const result = await store.saveAgentEvalCase(payload);
    message.value = f.id ? '用例已更新' : '用例已创建';
    await loadEvalCases();
    resetEvalCaseForm();
  } catch (e) { message.value = e.message; }
}

function editEvalCase(tc) {
  evalCaseForm.value = {
    id: tc.id, name: tc.name, query: tc.query, expectedIntent: tc.expectedIntent || '',
    requiredTools: (tc.requiredTools || []).join(','),
    forbiddenTools: (tc.forbiddenTools || []).join(','),
    expectAction: tc.expectAction || false, enabled: tc.enabled !== false,
  };
}

async function deleteEvalCase(tc) {
  try {
    await store.deleteAgentEvalCase(tc.id);
    message.value = '用例已删除';
    await loadEvalCases();
  } catch (e) { message.value = e.message; }
}

async function runEvalCase(tc) {
  try {
    const result = await store.runAgentEvalCase(tc.id);
    message.value = `运行完成：${result.passed ? '通过' : '未通过'} 得分 ${result.score}`;
  } catch (e) { message.value = e.message; }
}

function resetEvalCaseForm() {
  evalCaseForm.value = { name: '', query: '', expectedIntent: '', requiredTools: '', forbiddenTools: '', expectAction: false, enabled: true, id: '' };
}
async function runAgent() {
  const text = question.value.trim();
  const error = validateQuestion(text);
  if (error) {
    message.value = error;
    return;
  }
  loading.value = true;
  message.value = '';
  try {
    result.value = await store.runAgent({ query: text, sessionId: sessionId.value || undefined });
    sessionId.value = result.value.sessionId;
    citations.value = result.value.citations || [];
    events.value = null;
    await loadActions();
  } catch (error) {
    message.value = error.message;
  } finally {
    loading.value = false;
  }
}

async function runRealtimeAgent() {
  const text = question.value.trim();
  const error = validateQuestion(text);
  if (error) {
    message.value = error;
    return;
  }
  loading.value = true;
  message.value = '';
  try {
    const textStream = await store.runAgentStream({ query: text, sessionId: sessionId.value || undefined });
    realtimeEvents.value = parseSse(textStream);
    const done = realtimeEvents.value.find((event) => event.event === 'agent.done');
    if (done?.data?.sessionId) sessionId.value = done.data.sessionId;
    await loadActions();
  } catch (error) {
    message.value = error.message;
  } finally {
    loading.value = false;
  }
}

async function confirm(action) {
  message.value = '';
  try {
    const data = await store.confirmAgentAction(action.id);
    message.value = `动作已执行：${data.action.type}`;
    await loadEvents();
    await loadActions();
  } catch (error) {
    message.value = error.message;
  }
}

async function reject(action) {
  message.value = '';
  try {
    const data = await store.rejectAgentAction(action.id);
    message.value = `动作已拒绝：${data.action.type}`;
    await loadEvents();
    await loadActions();
  } catch (error) {
    message.value = error.message;
  }
}

async function loadEvents() {
  if (!sessionId.value) return;
  events.value = await store.loadAgentEvents(sessionId.value);
}

async function loadActions(status = actionStatus.value) {
  const data = await store.loadAgentActions(status);
  actionCenter.value = data.actions || [];
}

async function loadStream() {
  if (!sessionId.value) {
    message.value = '请先运行一次智能体生成会话';
    return;
  }
  try {
    const text = await store.loadAgentStream(sessionId.value);
    streamEvents.value = text.split(/\n\n+/).map((block) => {
      const lines = block.split('\n');
      const eventLine = lines.find((line) => line.startsWith('event:'));
      const dataLine = lines.find((line) => line.startsWith('data:'));
      if (!eventLine || !dataLine) return null;
      return { event: eventLine.slice(6).trim(), data: JSON.parse(dataLine.slice(5).trim()) };
    }).filter(Boolean);
  } catch (error) {
    message.value = error.message;
  }
}

async function loadEvals() {
  try {
    evals.value = await store.loadAgentEvals();
  } catch (error) {
    message.value = error.message;
  }
}

function parseSse(text) {
  return text.split(/\n\n+/).map((block) => {
    const lines = block.split('\n');
    const eventLine = lines.find((line) => line.startsWith('event:'));
    const dataLine = lines.find((line) => line.startsWith('data:'));
    if (!eventLine || !dataLine) return null;
    return { event: eventLine.slice(6).trim(), data: JSON.parse(dataLine.slice(5).trim()) };
  }).filter(Boolean);
}

function registryEntries() {
  return result.value?.toolResults?.registry || result.value?.steps || [];
}

function functionSchemas() {
  return (result.value?.toolResults?.catalog || []).filter((tool) => tool.parameters);
}

function score(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function mealPicks() {
  return result.value?.mealPlan?.picks || result.value?.plan?.picks || [];
}

async function runSearch() {
  const text = question.value.trim();
  const error = validateQuestion(text, { min: 2, max: 100, label: '检索关键词' });
  if (error) {
    message.value = error;
    return;
  }
  message.value = '';
  try {
    const data = await store.ragSearch(text);
    result.value = null;
    citations.value = data.results;
  } catch (error) {
    message.value = error.message;
  }
}
</script>
