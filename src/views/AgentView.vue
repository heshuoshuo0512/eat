<template>
  <main class="agent-view">
    <section class="page-heading agent-heading">
      <p class="eyebrow">Operations Agent</p>
      <h1>运营智能体</h1>
      <p>查看智能体的回答、执行质量与待确认操作，并在真实业务数据上完成运营调试。</p>
    </section>

    <section v-if="!canUseOperationsAgent" class="card empty-state">
      <h2>当前角色不可使用运营智能体</h2>
      <p>请使用具备智能体权限的后台账号登录。</p>
    </section>

    <template v-else>
      <section class="agent-workspace">
        <form class="card task-console" @submit.prevent="runAgent">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Task Console</p>
              <h2>运营任务</h2>
            </div>
            <span class="run-state" :class="{ active: loading }">{{ loading ? '执行中' : '就绪' }}</span>
          </div>

          <label>
            <span>会话 ID</span>
            <input v-model.trim="sessionId" autocomplete="off" placeholder="留空自动创建会话" />
          </label>
          <label>
            <span>任务</span>
            <textarea
              v-model="question"
              rows="6"
              placeholder="输入需要查询或分析的运营任务"
              required
            />
          </label>

          <div class="task-actions">
            <button class="primary" type="submit" :disabled="loading">
              {{ loading ? '正在运行' : '运行智能体' }}
            </button>
            <button class="secondary" type="button" :disabled="loading" @click="startNewSession">新建会话</button>
            <button class="secondary" type="button" @click="scrollToActions">动作中心</button>
          </div>

          <p v-if="message" class="console-message" :class="messageTone" aria-live="polite">{{ message }}</p>

          <div class="quick-task-section">
            <div class="subsection-title">
              <h3>快捷任务</h3>
              <span>常用场景</span>
            </div>
            <div class="quick-task-grid">
              <button
                v-for="example in taskExamples"
                :key="example.label"
                class="quick-task"
                type="button"
                @click="setExample(example.question)"
              >
                <strong>{{ example.label }}</strong>
                <small>{{ example.description }}</small>
              </button>
            </div>
          </div>
        </form>

        <article class="card answer-console" aria-live="polite">
          <div class="section-heading answer-heading">
            <div>
              <p class="eyebrow">Agent Answer</p>
              <h2>调试结果</h2>
            </div>
            <span v-if="result?.sessionId" class="session-badge" :title="result.sessionId">
              会话 {{ shortId(result.sessionId) }}
            </span>
          </div>

          <div v-if="!result" class="answer-empty">
            <strong>等待任务</strong>
            <p>运行任务后，此处显示回答、执行计划、质量指标和角色分工。</p>
          </div>

          <template v-else>
            <div class="answer-meta">
              <span class="status-chip">意图：{{ intentLabel(result.intent) }}</span>
              <span class="status-chip" :class="riskClass(result.plan?.riskLevel || result.eval?.riskLevel)">
                风险：{{ riskLabel(result.plan?.riskLevel || result.eval?.riskLevel) }}
              </span>
              <span class="status-chip">{{ result.steps?.length || 0 }} 次工具调用</span>
              <span v-if="agentIndexVersion" class="status-chip">索引：{{ agentIndexVersion }}</span>
            </div>

            <div class="answer-copy">
              <p>{{ result.answer }}</p>
              <small v-if="result.summary?.text">{{ result.summary.text }}</small>
            </div>

            <section v-if="agentDegradedReasons.length" class="degradation-notice" aria-label="检索降级原因">
              <strong>降级运行</strong>
              <ul>
                <li v-for="reason in agentDegradedReasons" :key="reason"><code>{{ reason }}</code></li>
              </ul>
            </section>

            <section v-if="normalizedPersonas.length" class="result-section">
              <div class="subsection-title">
                <h3>参与角色</h3>
                <span>{{ normalizedPersonas.length }} 个</span>
              </div>
              <div class="persona-list">
                <div v-for="persona in normalizedPersonas" :key="persona.key" class="persona-item">
                  <strong>{{ persona.title }}</strong>
                  <small v-if="persona.responsibility">{{ persona.responsibility }}</small>
                </div>
              </div>
            </section>

            <section v-if="result.plan" class="result-section plan-section">
              <div class="plan-summary">
                <div>
                  <span>执行目标</span>
                  <strong>{{ result.plan.goal }}</strong>
                </div>
                <span class="risk-badge" :class="riskClass(result.plan.riskLevel)">
                  {{ riskLabel(result.plan.riskLevel) }}风险
                </span>
              </div>
              <details v-if="result.plan.steps?.length || result.plan.guardrails?.length" class="detail-block">
                <summary>查看执行计划与安全约束</summary>
                <ol v-if="result.plan.steps?.length" class="plan-steps">
                  <li v-for="step in result.plan.steps" :key="step.tool">
                    <code>{{ step.tool }}</code>
                    <span>{{ step.reason || step.title }}</span>
                  </li>
                </ol>
                <ul v-if="result.plan.guardrails?.length" class="guardrail-list">
                  <li v-for="guardrail in result.plan.guardrails" :key="guardrail">{{ guardrail }}</li>
                </ul>
              </details>
            </section>

            <section v-if="mealPicks.length" class="result-section">
              <div class="subsection-title">
                <h3>推荐结果</h3>
                <span>{{ mealPicks.length }} 项</span>
              </div>
              <div class="pick-list">
                <div v-for="dish in mealPicks" :key="dish.id || dish.name" class="pick-row">
                  <span class="pick-image" aria-hidden="true">{{ dish.image || '餐' }}</span>
                  <div>
                    <strong>{{ dish.name }}</strong>
                    <small>{{ dishDescription(dish) }}</small>
                  </div>
                </div>
              </div>
            </section>

            <section class="metric-strip" aria-label="本次运行评测指标">
              <article v-for="metric in metricCards" :key="metric.label" class="metric-cell">
                <span>{{ metric.label }}</span>
                <strong>{{ metric.value }}</strong>
                <small>{{ metric.note }}</small>
              </article>
            </section>
          </template>
        </article>
      </section>

      <section v-if="result" class="observability-grid">
        <article v-if="result.steps?.length" class="card trace-panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Execution Trace</p>
              <h2>关键执行轨迹</h2>
            </div>
            <span class="section-count">{{ result.steps.length }} 步</span>
          </div>

          <div class="trace-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>工具</th>
                  <th>状态</th>
                  <th>风险</th>
                  <th>耗时</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(step, index) in visibleSteps" :key="`${step.tool}-${index}`">
                  <td>
                    <code>{{ step.tool }}</code>
                    <details v-if="step.title || step.category || step.error" class="step-detail">
                      <summary>步骤说明</summary>
                      <span v-if="step.title">{{ step.title }}</span>
                      <span v-if="step.category">类别：{{ step.category }}</span>
                      <span v-if="step.error" class="error-text">错误：{{ compactText(step.error, 80) }}</span>
                    </details>
                  </td>
                  <td><span class="status-chip" :class="statusClass(step.status)">{{ statusLabel(step.status) }}</span></td>
                  <td><span class="status-chip" :class="riskClass(step.riskLevel)">{{ riskLabel(step.riskLevel) }}</span></td>
                  <td class="numeric-cell">{{ formatLatency(step.latencyMs) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <button
            v-if="result.steps.length > collapsedStepCount"
            class="text-button"
            type="button"
            @click="isTraceExpanded = !isTraceExpanded"
          >
            {{ isTraceExpanded ? '收起轨迹' : `展开全部 ${result.steps.length} 步` }}
          </button>
        </article>

        <article v-if="toolSummaries.length" class="card tool-panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Tool Summary</p>
              <h2>脱敏工具摘要</h2>
            </div>
            <span class="privacy-badge">已脱敏</span>
          </div>
          <div class="tool-summary-list">
            <div v-for="item in visibleToolSummaries" :key="item.key" class="tool-summary-row">
              <div>
                <strong>{{ item.title }}</strong>
                <code>{{ item.tool }}</code>
              </div>
              <p>{{ item.summary }}</p>
            </div>
          </div>
          <button
            v-if="toolSummaries.length > collapsedToolCount"
            class="text-button"
            type="button"
            @click="isToolResultsExpanded = !isToolResultsExpanded"
          >
            {{ isToolResultsExpanded ? '收起摘要' : `展开全部 ${toolSummaries.length} 项` }}
          </button>
        </article>
      </section>

      <section ref="actionSection" class="card action-panel">
        <div class="section-heading action-heading">
          <div>
            <p class="eyebrow">Action Center</p>
            <h2>动作中心</h2>
          </div>
          <div class="action-toolbar">
            <select v-model="actionStatus" aria-label="动作状态" @change="loadActions()">
              <option value="pending">待确认</option>
              <option value="confirmed">已确认</option>
              <option value="rejected">已拒绝</option>
              <option value="expired">已过期</option>
              <option value="all">全部</option>
            </select>
            <button class="secondary" type="button" :disabled="loadingActions" @click="loadActions()">
              {{ loadingActions ? '刷新中' : '刷新' }}
            </button>
          </div>
        </div>

        <p v-if="actionMessage" class="console-message" :class="actionMessageTone" aria-live="polite">
          {{ actionMessage }}
        </p>
        <p v-if="loadingActions" class="panel-state">正在加载动作...</p>
        <p v-else-if="!actionCenter.length" class="panel-state">当前筛选条件下没有动作。</p>
        <div v-else class="action-list">
          <article v-for="action in actionCenter" :key="action.id" class="action-row">
            <div class="action-main">
              <div class="action-title-row">
                <strong>{{ actionTypeLabel(action.type) }}</strong>
                <span class="status-chip" :class="statusClass(action.status)">{{ actionStatusLabel(action.status) }}</span>
                <span class="status-chip" :class="riskClass(action.riskLevel)">{{ riskLabel(action.riskLevel) }}风险</span>
              </div>
              <p v-if="action.risk?.reason">{{ action.risk.reason }}</p>
              <small>
                会话 {{ shortId(action.sessionId) }}
                <template v-if="action.expiresAt"> · {{ expiryLabel(action.expiresAt) }}</template>
              </small>
            </div>
            <div v-if="action.status === 'pending' && action.requiresConfirmation" class="action-buttons">
              <button
                class="primary"
                type="button"
                :disabled="isActionProcessing(action.id)"
                @click="confirmAction(action)"
              >
                {{ isActionProcessing(action.id) ? '处理中' : '确认执行' }}
              </button>
              <button
                class="secondary reject-button"
                type="button"
                :disabled="isActionProcessing(action.id)"
                @click="rejectAction(action)"
              >
                拒绝
              </button>
            </div>
          </article>
        </div>
      </section>

      <section v-if="citations.length" class="card citation-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Sources</p>
            <h2>真实引用来源</h2>
          </div>
          <span class="section-count">{{ citations.length }} 条</span>
        </div>
        <div class="citation-list">
          <article v-for="(citation, index) in citations" :key="citation.id || `${citation.name}-${index}`" class="citation-row">
            <span class="citation-index">{{ index + 1 }}</span>
            <div>
              <div class="citation-title">
                <strong>{{ citation.name || citation.title || '未命名来源' }}</strong>
                <span>{{ relevanceLabel(citation.score) }}</span>
              </div>
              <p>{{ compactText(citation.snippet || citation.content || '暂无摘要', 180) }}</p>
            </div>
          </article>
        </div>
      </section>
    </template>
  </main>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { validateQuestion } from '../domain/validation.js';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const operationsAgentRoles = new Set(['operator', 'stall_admin', 'canteen_admin', 'tenant_admin', 'admin', 'super_admin']);
const collapsedStepCount = 5;
const collapsedToolCount = 5;

const taskExamples = [
  { label: '经营概况', description: '收入、热销与售罄', question: '统计今天营业收入、热销菜品和售罄数量' },
  { label: '今日午餐', description: '菜单与素食选项', question: '推荐今天午餐中的素食菜品' },
  { label: '营养筛选', description: '价格与高蛋白', question: '有哪些 15 元以下的高蛋白菜品？' },
  { label: '清真口味', description: '清真与偏辣推荐', question: '有没有清真选项？口味偏辣的推荐一下' },
  { label: '拥挤度', description: '食堂与档口客流', question: '北苑食堂现在人多吗？推荐个不拥挤的档口' },
  { label: '销售分析', description: '订单与热销菜品', question: '帮我看一下昨天的订单情况，哪些菜卖得最好？' },
  { label: '菜品概览', description: '数量与价格分布', question: '当前菜品库中有多少道菜？价格分布怎么样？' }
];

const canUseOperationsAgent = computed(() => Boolean(store.user && operationsAgentRoles.has(store.user.role)));
const question = ref(taskExamples[0].question);
const sessionId = ref('');
const result = ref(null);
const citations = ref([]);
const actionCenter = ref([]);
const actionStatus = ref('pending');
const actionSection = ref(null);
const loading = ref(false);
const loadingActions = ref(false);
const processingActionIds = ref([]);
const message = ref('');
const messageTone = ref('');
const actionMessage = ref('');
const actionMessageTone = ref('');
const isTraceExpanded = ref(false);
const isToolResultsExpanded = ref(false);

const totalLatency = computed(() => (result.value?.steps || []).reduce((sum, step) => sum + Number(step.latencyMs || 0), 0));

const normalizedPersonas = computed(() => {
  const personas = result.value?.personas;
  if (!personas) return [];
  const list = Array.isArray(personas) ? personas : [personas];
  return list.map((persona, index) => normalizePersona(persona, index));
});

const mealPicks = computed(() => result.value?.mealPlan?.picks || result.value?.plan?.picks || []);
const agentIndexVersion = computed(() => (
  result.value?.indexVersion
  || result.value?.plan?.indexVersion
  || result.value?.meta?.indexVersion
  || ''
));
const agentDegradedReasons = computed(() => {
  const value = result.value?.degradedReasons
    ?? result.value?.plan?.degradedReasons
    ?? result.value?.meta?.degradedReasons;
  const reasons = Array.isArray(value) ? value : (value ? [value] : []);
  return [...new Set(reasons.map((reason) => String(reason).trim()).filter(Boolean))];
});

const metricCards = computed(() => {
  if (!result.value) return [];
  const evaluation = result.value.eval || {};
  return [
    { label: '引用可信度', value: formatPercent(evaluation.groundednessScore), note: '回答与真实引用的一致性' },
    { label: '工具成功率', value: formatPercent(evaluation.toolSuccessRate), note: '本次工具执行成功比例' },
    { label: '安全性', value: formatPercent(evaluation.safetyScore), note: '高风险操作拦截情况' },
    { label: '总耗时', value: formatLatency(totalLatency.value), note: `${result.value.steps?.length || 0} 次工具调用` }
  ];
});

const visibleSteps = computed(() => {
  const steps = result.value?.steps || [];
  return isTraceExpanded.value ? steps : steps.slice(0, collapsedStepCount);
});

const toolSummaries = computed(() => {
  const steps = result.value?.steps || [];
  return steps.map((step, index) => ({
    key: `${step.tool}-${index}`,
    tool: step.tool,
    title: step.title || step.tool,
    summary: summarizeToolResult(step.tool, result.value?.toolResults?.[step.tool])
  }));
});

const visibleToolSummaries = computed(() => (
  isToolResultsExpanded.value ? toolSummaries.value : toolSummaries.value.slice(0, collapsedToolCount)
));

watch(canUseOperationsAgent, (allowed) => {
  if (allowed) loadActions();
}, { immediate: true });

function setExample(text) {
  question.value = text;
}

function startNewSession() {
  sessionId.value = '';
  result.value = null;
  citations.value = [];
  isTraceExpanded.value = false;
  isToolResultsExpanded.value = false;
  setMessage('已新建本地会话，下一次运行时将生成新的会话 ID。', 'success');
}

async function runAgent() {
  const text = question.value.trim();
  const validationError = validateQuestion(text);
  if (validationError) {
    setMessage(validationError, 'error');
    return;
  }

  loading.value = true;
  setMessage('', '');
  isTraceExpanded.value = false;
  isToolResultsExpanded.value = false;
  try {
    const response = await store.runAgent({ query: text, sessionId: sessionId.value || undefined });
    result.value = response;
    sessionId.value = response.sessionId || sessionId.value;
    citations.value = response.citations || [];
    setMessage('任务执行完成。', 'success');
    await loadActions();
  } catch (error) {
    setMessage(error.message || '智能体执行失败', 'error');
  } finally {
    loading.value = false;
  }
}

async function confirmAction(action) {
  if (!action?.id || isActionProcessing(action.id)) return;
  setActionProcessing(action.id, true);
  setActionMessage('', '');
  try {
    const response = await store.confirmAgentAction(action.id);
    await loadActions();
    setActionMessage(`动作已执行：${actionTypeLabel(response.action?.type || action.type)}`, 'success');
  } catch (error) {
    setActionMessage(error.message || '动作执行失败', 'error');
  } finally {
    setActionProcessing(action.id, false);
  }
}

async function rejectAction(action) {
  if (!action?.id || isActionProcessing(action.id)) return;
  setActionProcessing(action.id, true);
  setActionMessage('', '');
  try {
    const response = await store.rejectAgentAction(action.id);
    await loadActions();
    setActionMessage(`动作已拒绝：${actionTypeLabel(response.action?.type || action.type)}`, 'success');
  } catch (error) {
    setActionMessage(error.message || '动作拒绝失败', 'error');
  } finally {
    setActionProcessing(action.id, false);
  }
}

async function loadActions(status = actionStatus.value) {
  if (!canUseOperationsAgent.value || loadingActions.value) return;
  loadingActions.value = true;
  try {
    const data = await store.loadAgentActions(status);
    actionCenter.value = data.actions || [];
  } catch (error) {
    setActionMessage(error.message || '动作中心加载失败', 'error');
  } finally {
    loadingActions.value = false;
  }
}

async function scrollToActions() {
  await loadActions();
  await nextTick();
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  actionSection.value?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

function setActionProcessing(id, active) {
  processingActionIds.value = active
    ? [...new Set([...processingActionIds.value, id])]
    : processingActionIds.value.filter((item) => item !== id);
}

function isActionProcessing(id) {
  return processingActionIds.value.includes(id);
}

function setMessage(text, tone) {
  message.value = text;
  messageTone.value = tone;
}

function setActionMessage(text, tone) {
  actionMessage.value = text;
  actionMessageTone.value = tone;
}

function normalizePersona(persona, index) {
  if (typeof persona === 'string') {
    return { key: `${persona}-${index}`, title: personaTitle(persona), responsibility: '' };
  }
  const name = persona?.name || `persona-${index}`;
  return {
    key: `${name}-${index}`,
    title: persona?.title || personaTitle(name),
    responsibility: persona?.responsibility || ''
  };
}

function personaTitle(name) {
  const labels = {
    planner: '任务规划员',
    nutritionist: '营养顾问',
    order_operator: '订单专员',
    ops_analyst: '运营分析师',
    safety_reviewer: '安全审查员'
  };
  return labels[name] || name;
}

function summarizeToolResult(tool, rawValue) {
  const results = result.value?.toolResults || {};
  if (tool === 'session.load') {
    const count = Number(rawValue?.memoryCount || 0);
    return `会话上下文已载入，包含 ${count} 条历史消息。`;
  }
  if (tool === 'memory.long_term') return '长期记忆已读取，具体内容不在调试界面展示。';
  if (tool === 'profile.load') {
    const profile = results.profile || {};
    const parts = [profile.goal && `目标 ${profile.goal}`, profile.mealType && `餐次 ${mealTypeLabel(profile.mealType)}`, profile.taste && `口味 ${profile.taste}`, typeof profile.halalOnly === 'boolean' && `清真偏好 ${profile.halalOnly ? '是' : '否'}`].filter(Boolean);
    return parts.length ? parts.join('；') : '用户档案已载入，原始字段已隐藏。';
  }
  if (tool === 'menu.today') {
    const menu = results.todayMenu || rawValue || {};
    const count = Number(menu.dishCount || 0);
    return `${menu.date || '当前日期'} ${mealTypeLabel(menu.mealType)}菜单，共 ${count} 道菜，来源 ${sourceLabel(menu.source)}。`;
  }
  if (tool === 'meal.recommend' || tool === 'rag.meal_advisor') {
    const recommendation = results.recommendation || {};
    return `生成 ${Number(recommendation.pickCount || 0)} 项推荐，引用 ${Number(recommendation.citationCount || 0)} 条，回答来源 ${sourceLabel(recommendation.source || recommendation.answerSource)}。`;
  }
  if (tool === 'orders.mine') {
    return `读取 ${Array.isArray(rawValue) ? rawValue.length : 0} 条当前账号可访问订单，订单明细已隐藏。`;
  }
  if (tool === 'orders.analytics') {
    const analytics = rawValue || {};
    return `今日订单 ${Number(analytics.todayOrders || 0)} 单，热销菜品 ${Array.isArray(analytics.topDishes) ? analytics.topDishes.length : 0} 项，售罄 ${Array.isArray(analytics.soldOutItems) ? analytics.soldOutItems.length : 0} 项。`;
  }
  if (tool === 'order.create.propose') return `已生成包含 ${Number(rawValue?.itemCount || 0)} 项菜品的待确认动作，载荷已隐藏。`;
  if (tool === 'session.save') return '本轮回答、指标和动作状态已写入会话。';
  if (Array.isArray(rawValue)) return `工具返回 ${rawValue.length} 条记录，具体内容已隐藏。`;
  if (rawValue && typeof rawValue === 'object') return `工具返回 ${Object.keys(rawValue).length} 个字段，具体内容已隐藏。`;
  return '工具已完成执行，原始响应未展示。';
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${Math.round(Math.min(1, Math.max(0, number)) * 100)}%`;
}

function formatLatency(value) {
  const milliseconds = Number(value || 0);
  if (milliseconds >= 1000) return `${(milliseconds / 1000).toFixed(milliseconds >= 10000 ? 0 : 1)}s`;
  return `${Math.round(milliseconds)}ms`;
}

function compactText(value, limit) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function shortId(value) {
  const text = String(value || '—');
  return text.length > 12 ? `${text.slice(0, 8)}…` : text;
}

function intentLabel(intent) {
  const labels = {
    dish_search: '菜品检索',
    meal_planning: '餐食推荐',
    meal_recommendation: '餐食推荐',
    knowledge_qa: '知识问答',
    order_status: '订单查询',
    operations: '运营分析',
    general_canteen: '食堂咨询',
  };
  return labels[intent] || intent || '未识别';
}

function riskLabel(risk) {
  return { low: '低', medium: '中', high: '高' }[risk] || '未知';
}

function riskClass(risk) {
  return risk ? `risk-${risk}` : '';
}

function statusLabel(status) {
  return { success: '成功', error: '失败', pending: '待处理' }[status] || status || '未知';
}

function actionStatusLabel(status) {
  return { pending: '待确认', confirmed: '已确认', rejected: '已拒绝', expired: '已过期' }[status] || status || '未知';
}

function statusClass(status) {
  return status ? `status-${status}` : '';
}

function actionTypeLabel(type) {
  return { create_order: '创建订单', navigate: '页面跳转' }[type] || type || '未知动作';
}

function expiryLabel(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '有效期未知';
  if (timestamp <= Date.now()) return '已过期';
  return `有效至 ${new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(timestamp)}`;
}

function relevanceLabel(score) {
  const number = Number(score);
  return Number.isFinite(number) ? `相关度 ${Math.round(Math.min(1, Math.max(0, number)) * 100)}%` : '真实数据引用';
}

function mealTypeLabel(value) {
  return { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', supper: '夜宵' }[value] || value || '当前餐次';
}

function sourceLabel(value) {
  return { menu: '已发布菜单', fallback: '菜品库', local: '本地规则', ai: 'AI 模型', model: 'AI 模型' }[value] || value || '业务数据';
}

function dishDescription(dish) {
  const parts = [];
  const price = Number(dish.price);
  if (Number.isFinite(price)) parts.push(`¥${price.toFixed(2)}`);
  if (dish.taste) parts.push(dish.taste);
  const protein = Number(dish.nutrition?.protein);
  if (Number.isFinite(protein)) parts.push(`蛋白 ${protein}g`);
  return parts.join(' · ') || '菜品详情已载入';
}
</script>

<style scoped>
.agent-view {
  display: grid;
  gap: 1.25rem;
  letter-spacing: 0;
}

.agent-view :is(h1, h2, h3, p, span, strong, small, button, input, textarea, select, code) {
  letter-spacing: 0;
}

.agent-heading {
  margin-bottom: 0;
}

.agent-heading h1 {
  font-size: 2.75rem;
}

.agent-heading p:last-child {
  max-width: 48rem;
  margin-bottom: 0;
}

.agent-workspace {
  display: grid;
  grid-template-columns: minmax(18rem, 22rem) minmax(0, 1fr);
  gap: 1.25rem;
  align-items: start;
}

.task-console {
  position: sticky;
  top: 1rem;
  display: grid;
  gap: 1rem;
}

.section-heading,
.subsection-title,
.action-title-row,
.citation-title,
.plan-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.section-heading h2,
.subsection-title h3 {
  margin: 0;
}

.subsection-title h3 {
  font-size: 0.9375rem;
}

.subsection-title span,
.section-count {
  color: var(--muted);
  font-size: 0.75rem;
  font-weight: 700;
}

.run-state,
.session-badge,
.privacy-badge,
.status-chip,
.risk-badge {
  display: inline-flex;
  align-items: center;
  min-height: 1.75rem;
  border: 1px solid rgba(31, 122, 77, 0.15);
  border-radius: 999px;
  padding: 0.25rem 0.625rem;
  background: rgba(235, 247, 229, 0.78);
  color: var(--primary-dark);
  font-size: 0.75rem;
  font-weight: 750;
  line-height: 1.2;
  white-space: nowrap;
}

.run-state::before {
  width: 0.45rem;
  height: 0.45rem;
  margin-right: 0.375rem;
  border-radius: 50%;
  background: var(--primary);
  content: '';
}

.run-state.active::before {
  animation: agent-pulse 1.1s ease-in-out infinite;
}

.task-console textarea {
  min-height: 8rem;
}

.task-actions,
.action-toolbar,
.action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.625rem;
}

.task-actions button,
.action-toolbar button,
.action-buttons button {
  min-height: 2.75rem;
  border-radius: 0.75rem;
  padding: 0.625rem 0.875rem;
  font-weight: 750;
}

.task-actions button:first-child {
  flex: 1 1 9rem;
}

.console-message {
  margin: 0;
  border-radius: 0.625rem;
  padding: 0.625rem 0.75rem;
  background: rgba(49, 91, 220, 0.08);
  color: var(--info);
  font-weight: 700;
}

.console-message.success {
  background: rgba(31, 122, 77, 0.1);
  color: var(--primary-dark);
}

.console-message.error {
  background: rgba(196, 83, 60, 0.1);
  color: var(--danger);
}

.quick-task-section {
  display: grid;
  gap: 0.75rem;
  border-top: 1px solid var(--line);
  padding-top: 1rem;
}

.quick-task-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.quick-task {
  display: grid;
  min-width: 0;
  min-height: 4.5rem;
  align-content: center;
  gap: 0.125rem;
  border: 1px solid rgba(31, 122, 77, 0.12);
  border-radius: 0.625rem;
  padding: 0.625rem;
  background: rgba(255, 255, 255, 0.6);
  color: var(--text);
  text-align: left;
}

.quick-task:hover {
  border-color: rgba(31, 122, 77, 0.35);
  background: rgba(235, 247, 229, 0.88);
}

.quick-task small {
  overflow: hidden;
  color: var(--muted);
  font-size: 0.6875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.answer-console {
  display: grid;
  min-height: 34rem;
  align-content: start;
  gap: 1rem;
}

.answer-empty {
  display: grid;
  min-height: 25rem;
  place-content: center;
  text-align: center;
}

.answer-empty strong {
  font-size: 1.25rem;
}

.answer-empty p {
  max-width: 28rem;
  margin: 0.375rem 0 0;
  color: var(--muted);
}

.answer-meta,
.persona-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.answer-copy {
  border-left: 3px solid var(--primary);
  padding: 0.25rem 0 0.25rem 1rem;
}

.answer-copy p {
  margin: 0;
  color: var(--text);
  font-size: 1.0625rem;
  line-height: 1.8;
  white-space: pre-wrap;
}

.answer-copy small {
  display: block;
  margin-top: 0.625rem;
  color: var(--muted);
}

.degradation-notice {
  display: grid;
  gap: 0.5rem;
  border-left: 3px solid #c58a16;
  padding: 0.75rem 1rem;
  background: #fff8e6;
}

.degradation-notice strong {
  color: #795500;
}

.degradation-notice ul {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.degradation-notice code {
  overflow-wrap: anywhere;
}

.result-section {
  display: grid;
  gap: 0.75rem;
  border-top: 1px solid var(--line);
  padding-top: 1rem;
}

.persona-item {
  display: grid;
  max-width: 18rem;
  gap: 0.125rem;
  border: 1px solid rgba(31, 122, 77, 0.13);
  border-radius: 0.625rem;
  padding: 0.5rem 0.75rem;
  background: rgba(235, 247, 229, 0.58);
}

.persona-item small {
  color: var(--muted);
  line-height: 1.4;
}

.plan-summary > div {
  display: grid;
  gap: 0.125rem;
}

.plan-summary > div > span {
  color: var(--muted);
  font-size: 0.75rem;
}

.detail-block {
  border: 1px solid var(--line);
  border-radius: 0.625rem;
  padding: 0.625rem 0.75rem;
  background: rgba(255, 255, 255, 0.48);
}

.detail-block summary,
.step-detail summary {
  color: var(--primary-dark);
  font-weight: 750;
  cursor: pointer;
}

.plan-steps,
.guardrail-list {
  display: grid;
  gap: 0.5rem;
  margin: 0.75rem 0 0;
  padding-left: 1.25rem;
}

.plan-steps li {
  padding-left: 0.25rem;
}

.plan-steps code {
  margin-right: 0.5rem;
  color: var(--primary-dark);
}

.guardrail-list {
  border-top: 1px solid var(--line);
  padding-top: 0.75rem;
  color: var(--muted);
}

.pick-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.625rem;
}

.pick-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.625rem;
  border: 1px solid var(--line);
  border-radius: 0.625rem;
  padding: 0.625rem;
  background: rgba(255, 255, 255, 0.48);
}

.pick-image {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border-radius: 0.625rem;
  background: var(--primary-soft);
  font-weight: 800;
}

.pick-row div {
  min-width: 0;
}

.pick-row strong,
.pick-row small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pick-row small {
  color: var(--muted);
}

.metric-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 0.75rem;
}

.metric-cell {
  display: grid;
  min-width: 0;
  min-height: 7.25rem;
  align-content: center;
  gap: 0.125rem;
  border-right: 1px solid var(--line);
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.48);
}

.metric-cell:last-child {
  border-right: 0;
}

.metric-cell > span,
.metric-cell small {
  color: var(--muted);
  font-size: 0.75rem;
}

.metric-cell strong {
  color: var(--primary-dark);
  font-size: 1.5rem;
  font-variant-numeric: tabular-nums;
}

.metric-cell small {
  line-height: 1.35;
}

.observability-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.25rem;
}

.trace-panel,
.tool-panel,
.action-panel,
.citation-panel {
  display: grid;
  min-width: 0;
  align-content: start;
  gap: 1rem;
}

.trace-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: 0.625rem;
}

.trace-table-wrap table {
  min-width: 34rem;
  box-shadow: none;
}

.trace-table-wrap th,
.trace-table-wrap td {
  padding: 0.625rem 0.75rem;
}

.trace-table-wrap th:first-child {
  width: 52%;
}

.trace-table-wrap code,
.tool-summary-row code {
  color: var(--primary-dark);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}

.step-detail {
  margin-top: 0.375rem;
  color: var(--muted);
  font-size: 0.75rem;
}

.step-detail summary {
  font-size: 0.6875rem;
}

.step-detail span {
  display: block;
  margin-top: 0.25rem;
  line-height: 1.4;
}

.error-text {
  color: var(--danger);
}

.numeric-cell {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.text-button {
  justify-self: start;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--primary);
  font-weight: 750;
}

.tool-summary-list,
.action-list,
.citation-list {
  display: grid;
}

.tool-summary-row {
  display: grid;
  grid-template-columns: minmax(8rem, 0.7fr) minmax(0, 1.3fr);
  gap: 1rem;
  border-bottom: 1px solid var(--line);
  padding: 0.75rem 0;
}

.tool-summary-row:first-child {
  padding-top: 0;
}

.tool-summary-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.tool-summary-row > div {
  display: grid;
  align-content: start;
  gap: 0.125rem;
}

.tool-summary-row p {
  margin: 0;
  color: var(--muted);
  line-height: 1.65;
}

.privacy-badge {
  border-color: rgba(49, 91, 220, 0.16);
  background: rgba(49, 91, 220, 0.08);
  color: var(--info);
}

.action-heading {
  align-items: end;
}

.action-toolbar select {
  width: auto;
  min-width: 8rem;
}

.panel-state {
  margin: 0;
  padding: 1.5rem 0;
  color: var(--muted);
  text-align: center;
}

.action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid var(--line);
  padding: 0.875rem 0;
}

.action-row:first-child {
  padding-top: 0;
}

.action-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.action-main {
  display: grid;
  min-width: 0;
  gap: 0.25rem;
}

.action-title-row {
  justify-content: flex-start;
  flex-wrap: wrap;
}

.action-main p,
.action-main small {
  margin: 0;
  color: var(--muted);
}

.action-buttons {
  flex: 0 0 auto;
}

.reject-button {
  color: var(--danger);
}

.citation-row {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr);
  gap: 0.75rem;
  border-bottom: 1px solid var(--line);
  padding: 0.875rem 0;
}

.citation-row:first-child {
  padding-top: 0;
}

.citation-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.citation-index {
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border-radius: 0.5rem;
  background: var(--primary-soft);
  color: var(--primary-dark);
  font-weight: 800;
}

.citation-title {
  align-items: baseline;
}

.citation-title span {
  color: var(--primary-dark);
  font-size: 0.75rem;
  font-weight: 750;
  white-space: nowrap;
}

.citation-row p {
  margin: 0.25rem 0 0;
  color: var(--muted);
  line-height: 1.65;
}

.risk-low,
.status-success,
.status-confirmed {
  border-color: rgba(31, 122, 77, 0.18);
  background: rgba(31, 122, 77, 0.1);
  color: var(--primary-dark);
}

.risk-medium,
.status-pending {
  border-color: rgba(255, 180, 59, 0.28);
  background: rgba(255, 180, 59, 0.14);
  color: #76500f;
}

.risk-high,
.status-error,
.status-rejected,
.status-expired {
  border-color: rgba(196, 83, 60, 0.22);
  background: rgba(196, 83, 60, 0.1);
  color: var(--danger);
}

@keyframes agent-pulse {
  0%, 100% { opacity: 0.45; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1); }
}

@media (max-width: 68rem) {
  .agent-workspace,
  .observability-grid {
    grid-template-columns: 1fr;
  }

  .task-console {
    position: static;
  }
}

@media (max-width: 48rem) {
  .agent-heading h1 {
    font-size: 2rem;
  }

  .quick-task-grid,
  .pick-list {
    grid-template-columns: 1fr;
  }

  .metric-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .metric-cell:nth-child(2) {
    border-right: 0;
  }

  .metric-cell:nth-child(-n + 2) {
    border-bottom: 1px solid var(--line);
  }

  .section-heading.action-heading,
  .action-row,
  .tool-summary-row {
    align-items: stretch;
    grid-template-columns: 1fr;
  }

  .section-heading.action-heading,
  .action-row {
    display: grid;
  }

  .action-toolbar,
  .action-buttons {
    width: 100%;
  }

  .action-toolbar select,
  .action-toolbar button,
  .action-buttons button {
    flex: 1 1 7rem;
  }

  .citation-title {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-view *,
  .agent-view *::before,
  .agent-view *::after {
    scroll-behavior: auto !important;
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
