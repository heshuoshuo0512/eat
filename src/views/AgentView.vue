<template>
  <section class="page-heading">
    <p class="eyebrow">Admin Operations Agent</p>
    <h1>运营智能体</h1>
    <p>输入运营任务，智能体基于真实菜品库和订单数据给出操作建议与执行动作。</p>
  </section>

  <section v-if="store.user?.role !== 'admin'" class="card empty-state">
    <h2>仅限管理员</h2>
    <p>运营智能体面向管理员和运营人员。请在左侧身份卡选择"管理员"并登录后使用。</p>
  </section>

  <template v-if="store.user?.role === 'admin'">
    <section class="grid two-columns align-start">
      <form class="card admin-form" @submit.prevent="runAgent">
        <div class="section-title">
          <p class="eyebrow">Agent Console</p>
          <h2>发起运营任务</h2>
        </div>
        <label>会话 ID<input v-model="sessionId" placeholder="自动生成，可用于多轮追问" /></label>
        <label>任务<textarea v-model="question" placeholder="例：今天午餐有哪些菜？帮我看一下库存够不够。" required /></label>
        <div class="table-actions">
          <button class="primary" type="submit" :disabled="loading">{{ loading ? '执行中...' : '运行智能体' }}</button>
          <button class="secondary" type="button" @click="loadActions()">查看待处理动作</button>
        </div>
        <p v-if="message" class="form-message danger">{{ message }}</p>
        <div class="task-examples">
          <p class="muted">示例任务：</p>
          <button class="ghost" type="button" @click="setExample('今天午餐菜单是什么？有素食选项吗？')">今日午餐查询</button>
          <button class="ghost" type="button" @click="setExample('帮我看一下昨天的订单情况，哪些菜卖得最好？')">昨日销售分析</button>
          <button class="ghost" type="button" @click="setExample('当前菜品库中有多少道菜？价格分布怎么样？')">菜品库概览</button>
          <button class="ghost" type="button" @click="setExample('帮我下一份鸡腿饭，先给我确认动作')">代下单确认</button>
        </div>
      </form>

      <article class="card">
        <div class="section-title">
          <p class="eyebrow">Answer</p>
          <h2>智能体回答</h2>
        </div>
        <p class="hero-copy">{{ result?.answer || '提交任务后，智能体将基于真实菜品库、菜单和订单数据给出回答。' }}</p>
        <p v-if="result?.summary?.text" class="muted">{{ result.summary.text }}</p>
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
  </template>
</template>

<script setup>
import { ref } from 'vue';
import { validateQuestion } from '../domain/validation.js';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const question = ref('今天午餐菜单是什么？有素食选项吗？');
const sessionId = ref('');
const result = ref(null);
const citations = ref([]);
const actionCenter = ref([]);
const actionStatus = ref('pending');
const loading = ref(false);
const message = ref('');

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

function mealPicks() {
  return result.value?.mealPlan?.picks || result.value?.plan?.picks || [];
}
</script>
