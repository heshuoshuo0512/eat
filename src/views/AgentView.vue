<template>
  <section class="page-heading">
    <p class="eyebrow">RAG 智能体实验室</p>
    <h1>运营智能体</h1>
    <p>基于真实菜品库和 RAG 检索增强生成，迭代推荐策略和运营建议。每步执行可观测，凭证安全隔离。</p>
  </section>

  <section v-if="!isAdmin" class="card empty-state">
    <h2>仅限管理员</h2>
    <p>运营智能体面向管理员和运营人员。请在左侧身份卡选择"管理员"并登录后使用。</p>
  </section>

  <template v-if="isAdmin">
    <section class="grid two-columns align-start">
      <form class="card admin-form" @submit.prevent="runAgent">
        <div class="section-title">
          <p class="eyebrow">Agent Console</p>
          <h2>发起运营任务</h2>
        </div>
        <p class="muted">智能体使用 RAG 检索真实菜品库、菜单和评价数据，逐步执行工具调用并给出可审计的回答。适合迭代推荐策略、价格/口味/清真/营养/拥挤度查询。</p>
        <label>会话 ID<input v-model="sessionId" placeholder="自动生成，可用于多轮追问" /></label>
        <label>任务<textarea v-model="question" placeholder="例：今天午餐有哪些菜？有素食选项吗？" required /></label>
        <div class="table-actions">
          <button class="primary" type="submit" :disabled="loading">{{ loading ? '执行中...' : '运行智能体' }}</button>
          <button class="secondary" type="button" @click="loadActions()">查看待处理动作</button>
        </div>
        <p v-if="message" class="form-message danger">{{ message }}</p>
        <div class="task-examples">
          <p class="muted">示例任务：</p>
          <button class="ghost" type="button" @click="setExample('今天午餐菜单是什么？有素食选项吗？')">今日午餐查询</button>
          <button class="ghost" type="button" @click="setExample('有哪些 15 元以下的高蛋白菜品？')">价格+营养查询</button>
          <button class="ghost" type="button" @click="setExample('有没有清真选项？口味偏辣的推荐一下')">清真+口味查询</button>
          <button class="ghost" type="button" @click="setExample('北苑食堂现在人多吗？推荐个不拥挤的档口')">拥挤度查询</button>
          <button class="ghost" type="button" @click="setExample('帮我看一下昨天的订单情况，哪些菜卖得最好？')">昨日销售分析</button>
          <button class="ghost" type="button" @click="setExample('当前菜品库中有多少道菜？价格分布怎么样？')">菜品库概览</button>
        </div>
      </form>

      <article class="card">
        <div class="section-title">
          <p class="eyebrow">Answer</p>
          <h2>智能体回答</h2>
        </div>
        <p class="hero-copy">{{ result?.answer || '提交任务后，智能体将基于真实菜品库、菜单和订单数据给出回答。' }}</p>
        <p v-if="result?.summary?.text" class="muted">{{ result.summary.text }}</p>

        <!-- 执行路由与角色 -->
        <div v-if="result?.intent" class="meta-bar">
          <span class="pill">意图：{{ result.intent }}</span>
          <span v-if="result.personas" class="pill">角色：{{ result.personas }}</span>
        </div>

        <!-- 餐单推荐结果 -->
        <div v-if="result?.plan" class="dish-list dense">
          <div class="dish-row">
            <span><strong>{{ result.plan.goal }}</strong><small>风险：{{ result.plan.riskLevel }} · {{ result.plan.steps?.length || 0 }} 步</small></span>
          </div>
          <div v-for="guardrail in result.plan.guardrails || []" :key="guardrail" class="dish-row">
            <span><strong>Guardrail</strong><small>{{ guardrail }}</small></span>
          </div>
        </div>
        <div v-if="result?.actions?.length" class="dish-list dense">
          <div v-for="action in result.actions" :key="action.id || action.to" class="dish-row">
            <span><strong>{{ action.label || action.type }}</strong><small>{{ action.status || action.to }} · {{ action.riskLevel || 'low' }}</small></span>
            <button v-if="action.requiresConfirmation" class="primary" type="button" @click="confirm(action)">确认执行</button>
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

    <!-- 执行步骤可观测 -->
    <section v-if="result?.steps?.length" class="card admin-form">
      <div class="section-title">
        <p class="eyebrow">Execution Trace</p>
        <h2>工具执行步骤</h2>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>工具</th><th>标题</th><th>类别</th><th>风险</th><th>状态</th><th>耗时</th></tr></thead>
          <tbody>
            <tr v-for="(step, idx) in result.steps" :key="idx">
              <td>{{ idx + 1 }}</td>
              <td><code>{{ step.tool }}</code></td>
              <td>{{ step.title }}</td>
              <td>{{ step.category }}</td>
              <td><span class="pill" :class="step.riskLevel === 'high' ? 'danger' : ''">{{ step.riskLevel }}</span></td>
              <td><span class="pill" :class="step.status === 'success' ? '' : 'danger'">{{ step.status }}</span></td>
              <td>{{ step.latencyMs }}ms</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="metric-grid compact" style="margin-top:12px;">
        <article>
          <strong>{{ result.steps.length }}</strong>
          <span>工具调用</span>
        </article>
        <article>
          <strong>{{ totalLatency }}ms</strong>
          <span>总耗时</span>
        </article>
        <article>
          <strong>{{ result.steps.filter(s => s.status === 'success').length }}/{{ result.steps.length }}</strong>
          <span>成功率</span>
        </article>
        <article>
          <strong>{{ result.steps.filter(s => s.status !== 'success').length }}</strong>
          <span>错误数</span>
        </article>
      </div>
    </section>

    <!-- 工具输出摘要（不暴露密钥和原始 schema） -->
    <section v-if="result?.toolResults" class="card admin-form">
      <div class="section-title">
        <p class="eyebrow">Tool Outputs</p>
        <h2>工具输出摘要</h2>
      </div>
      <div class="stats-grid">
        <article v-for="(value, key) in safeToolResults" :key="key" class="mini-card">
          <strong>{{ key }}</strong>
          <p class="muted">{{ summarizeToolOutput(value) }}</p>
        </article>
      </div>
      <p class="muted">仅展示摘要信息，不暴露 API Key、原始函数 Schema 或敏感配置。</p>
    </section>

    <!-- 待处理动作确认 -->
    <section v-if="actionCenter.length" class="card admin-form">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">Action Center</p>
          <h2>待处理动作</h2>
        </div>
        <select v-model="actionStatus" @change="loadActions()">
          <option value="pending">待确认</option>
          <option value="confirmed">已确认</option>
          <option value="rejected">已拒绝</option>
          <option value="all">全部</option>
        </select>
      </div>
      <div class="dish-list dense">
        <div v-for="action in actionCenter" :key="action.id" class="dish-row">
          <span><strong>{{ action.type }}</strong><small>{{ action.status }} · {{ action.riskLevel }} · 会话 {{ (action.sessionId || '').slice(0, 8) }}… · {{ action.expiresAt ? '过期 ' + action.expiresAt.slice(0, 10) : '无过期' }}</small></span>
          <span class="table-actions">
            <button v-if="action.requiresConfirmation" class="primary" type="button" @click="confirm(action)">确认</button>
            <button v-if="action.requiresConfirmation" class="ghost danger" type="button" @click="reject(action)">拒绝</button>
          </span>
        </div>
      </div>
    </section>

    <!-- 引用来源 -->
    <section v-if="citations.length" class="card">
      <div class="section-title">
        <p class="eyebrow">Sources</p>
        <h2>引用来源</h2>
      </div>
      <div class="cards-grid">
        <article v-for="item in citations" :key="item.id || item.name" class="mini-card">
          <strong>{{ item.name || item.title }}</strong>
          <small>相关度 {{ item.score }}</small>
          <p class="muted">{{ item.snippet }}</p>
        </article>
      </div>
    </section>

    <!-- 记忆状态 -->
    <section class="card admin-form">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">Memory</p>
          <h2>智能体记忆</h2>
        </div>
        <div class="table-actions">
          <button class="ghost" type="button" @click="loadMemory">刷新</button>
          <button class="ghost danger" type="button" @click="clearMemory">清空</button>
        </div>
      </div>
      <article v-if="memory.summary" class="mini-card">
        <strong>长期记忆摘要</strong>
        <p>{{ memory.summary }}</p>
        <p v-if="memory.preferences" class="muted">偏好：{{ JSON.stringify(memory.preferences) }}</p>
      </article>
      <p v-else class="muted">暂无长期记忆。智能体会在对话中积累用户偏好和上下文。</p>
    </section>

    <!-- Eval 指标 -->
    <section class="card admin-form">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">Eval Metrics</p>
          <h2>评测指标</h2>
        </div>
        <div class="table-actions">
          <button class="ghost" type="button" @click="loadEvalCases">刷新用例</button>
        </div>
      </div>
      <div v-if="result?.eval" class="metric-grid">
        <article>
          <strong>{{ result.eval.score || '—' }}</strong>
          <span>综合评分</span>
        </article>
        <article>
          <strong>{{ result.eval.latencyMs || '—' }}ms</strong>
          <span>总延迟</span>
        </article>
        <article>
          <strong>{{ result.eval.toolCount || result.steps?.length || 0 }}</strong>
          <span>工具调用数</span>
        </article>
      </div>
      <div v-if="evalCases.length" class="table-wrap">
        <table>
          <thead><tr><th>用例</th><th>查询</th><th>期望</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="c in evalCases" :key="c.id">
              <td>{{ c.name }}</td>
              <td>{{ c.query }}</td>
              <td>{{ c.expectedIntent || '—' }}</td>
              <td class="table-actions">
                <button class="ghost" type="button" @click="runEvalCase(c)">运行</button>
                <button class="ghost danger" type="button" @click="deleteEvalCase(c.id)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="muted">暂无评测用例。可通过 API 创建用例来测试智能体的回答质量。</p>
    </section>
  </template>
</template>

<script setup>
import { computed, ref } from 'vue';
import { validateQuestion } from '../domain/validation.js';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const adminRoleSet = new Set(['operator', 'stall_admin', 'canteen_admin', 'auditor', 'finance', 'tenant_admin', 'admin', 'super_admin']);
const isAdmin = computed(() => store.user && adminRoleSet.has(store.user.role));
const question = ref('今天午餐菜单是什么？有素食选项吗？');
const sessionId = ref('');
const result = ref(null);
const citations = ref([]);
const actionCenter = ref([]);
const actionStatus = ref('pending');
const loading = ref(false);
const message = ref('');
const memory = ref({ summary: '', preferences: {} });
const evalCases = ref([]);

const totalLatency = computed(() => {
  if (!result.value?.steps) return 0;
  return result.value.steps.reduce((sum, step) => sum + (step.latencyMs || 0), 0);
});

const safeToolResults = computed(() => {
  if (!result.value?.toolResults) return {};
  const { functions, catalog, ...safe } = result.value.toolResults;
  return safe;
});

function setExample(text) {
  question.value = text;
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
    memory.value = result.value.memory || { summary: '', preferences: {} };
    await loadActions();
  } catch (err) {
    message.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function confirm(action) {
  message.value = '';
  try {
    const data = await store.confirmAgentAction(action.id);
    message.value = `动作已执行：${data.action.type}`;
    await loadActions();
  } catch (err) {
    message.value = err.message;
  }
}

async function reject(action) {
  message.value = '';
  try {
    const data = await store.rejectAgentAction(action.id);
    message.value = `动作已拒绝：${data.action.type}`;
    await loadActions();
  } catch (err) {
    message.value = err.message;
  }
}

async function loadActions(status = actionStatus.value) {
  try {
    const data = await store.loadAgentActions(status);
    actionCenter.value = data.actions || [];
  } catch (err) {
    message.value = err.message;
  }
}

async function loadMemory() {
  try {
    memory.value = await store.loadAgentMemory();
  } catch (err) {
    message.value = err.message;
  }
}

async function clearMemory() {
  try {
    memory.value = await store.clearAgentMemory();
    message.value = '记忆已清空。';
  } catch (err) {
    message.value = err.message;
  }
}

async function loadEvalCases() {
  try {
    evalCases.value = await store.loadAgentEvalCases();
  } catch (err) {
    message.value = err.message;
  }
}

async function runEvalCase(c) {
  try {
    const run = await store.runAgentEvalCase(c.id);
    message.value = `用例 "${c.name}" 运行完成，评分：${run.score || '—'}`;
  } catch (err) {
    message.value = err.message;
  }
}

async function deleteEvalCase(id) {
  try {
    await store.deleteAgentEvalCase(id);
    evalCases.value = evalCases.value.filter((c) => c.id !== id);
    message.value = '用例已删除。';
  } catch (err) {
    message.value = err.message;
  }
}

function mealPicks() {
  return result.value?.mealPlan?.picks || result.value?.plan?.picks || [];
}

function summarizeToolOutput(value) {
  if (!value) return '无数据';
  if (typeof value === 'string') return value.length > 120 ? value.slice(0, 120) + '…' : value;
  if (Array.isArray(value)) return `${value.length} 条记录`;
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    return keys.length > 0 ? `${keys.length} 个字段：${keys.slice(0, 5).join(', ')}` : '空对象';
  }
  return String(value);
}
</script>
