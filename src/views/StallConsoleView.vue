<template>
  <section class="page-heading">
    <p class="eyebrow">实验性功能 · 模拟数据</p>
    <h1>档口订单工作台</h1>
    <p>此页面为实验性功能，当前展示模拟订单数据。订单流程和支付功能尚未正式上线，仅供内部测试使用。</p>
  </section>

  <section class="card">
    <div class="section-title horizontal">
      <div>
        <p class="eyebrow">Live Orders</p>
        <h2>订单队列</h2>
      </div>
      <div class="table-actions">
        <div class="filter-tabs">
          <button
            type="button"
            :class="['tab-btn', { active: statusFilter === '' }]"
            @click="statusFilter = ''; load()"
          >进行中</button>
          <button
            type="button"
            :class="['tab-btn', { active: statusFilter === 'all' }]"
            @click="statusFilter = 'all'; load()"
          >全部</button>
          <button
            type="button"
            :class="['tab-btn', { active: statusFilter === 'pending' }]"
            @click="statusFilter = 'pending'; load()"
          >待接单</button>
          <button
            type="button"
            :class="['tab-btn', { active: statusFilter === 'preparing' }]"
            @click="statusFilter = 'preparing'; load()"
          >备餐中</button>
          <button
            type="button"
            :class="['tab-btn', { active: statusFilter === 'ready' }]"
            @click="statusFilter = 'ready'; load()"
          >待取餐</button>
        </div>
        <button class="secondary" type="button" @click="load">刷新</button>
      </div>
    </div>

    <div class="metric-grid compact">
      <article class="metric-highlight"><strong>{{ pendingCount }}</strong><span>待接单</span></article>
      <article class="metric-highlight"><strong>{{ preparingCount }}</strong><span>备餐中</span></article>
      <article class="metric-highlight ready-metric"><strong>{{ readyCount }}</strong><span>待取餐</span></article>
      <article><strong>¥{{ revenue }}</strong><span>模拟金额</span></article>
    </div>

    <div v-if="filteredOrders.length" class="order-queue">
      <article v-for="order in filteredOrders" :key="order.id" class="queue-card" :class="'status-' + order.status">
        <div class="queue-card-header">
          <div class="pickup-code-badge">{{ order.pickupCode }}</div>
          <span class="status-tag" :class="order.status">{{ statusLabel(order.status) }}</span>
        </div>
        <div class="queue-card-body">
          <p class="queue-items">{{ order.items.map((item) => `${item.dishName}×${item.quantity}`).join('、') }}</p>
          <p class="queue-note" v-if="order.note">{{ order.note }}</p>
          <span class="queue-amount">¥{{ order.totalAmount }}</span>
        </div>
        <div class="queue-card-actions">
          <button v-if="order.status === 'pending'" class="primary" type="button" @click="next(order, 'preparing')">接单</button>
          <button v-if="order.status === 'preparing'" class="primary" type="button" @click="next(order, 'ready')">出餐</button>
          <button v-if="order.status === 'ready'" class="primary" type="button" @click="next(order, 'completed')">完成</button>
          <button v-if="['pending','preparing'].includes(order.status)" class="secondary" type="button" @click="next(order, 'cancelled')">取消</button>
        </div>
      </article>
    </div>
    <p v-else class="muted">当前没有订单。</p>
    <p v-if="message" class="form-message">{{ message }}</p>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const statusFilter = ref('');
const message = ref('');

const activeStatuses = ['pending', 'preparing', 'ready'];

const filteredOrders = computed(() => {
  if (statusFilter.value === 'all') {
    return store.adminOrders;
  }
  if (statusFilter.value === '') {
    return store.adminOrders.filter((order) => activeStatuses.includes(order.status));
  }
  return store.adminOrders.filter((order) => order.status === statusFilter.value);
});

const pendingCount = computed(() => store.adminOrders.filter((order) => order.status === 'pending').length);
const preparingCount = computed(() => store.adminOrders.filter((order) => order.status === 'preparing').length);
const readyCount = computed(() => store.adminOrders.filter((order) => order.status === 'ready').length);
const revenue = computed(() => {
  const active = store.adminOrders.filter((order) => activeStatuses.includes(order.status));
  return active.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0).toFixed(2);
});

onMounted(load);

async function load() {
  if (statusFilter.value === 'all') {
    await store.loadAdminOrders('');
  } else if (statusFilter.value === '') {
    await store.loadAdminOrders('');
  } else {
    await store.loadAdminOrders(statusFilter.value);
  }
}

async function next(order, status) {
  message.value = '';
  try {
    await store.updateOrderStatus(order.id, status);
    message.value = `订单 ${order.pickupCode} 已更新为 ${statusLabel(status)}。`;
    if (statusFilter.value === '' && (status === 'completed' || status === 'cancelled')) {
      // If viewing active orders and an order transitions to terminal, refresh
      await load();
    }
  } catch (error) {
    message.value = error.message;
  }
}

function statusLabel(status) {
  return { pending: '待接单', preparing: '备餐中', ready: '待取餐', completed: '已完成', cancelled: '已取消' }[status] || status;
}
</script>

<style scoped>
.filter-tabs {
  display: flex;
  gap: 0;
  border: 1px solid var(--border, #d0d5dd);
  border-radius: 8px;
  overflow: hidden;
}
.tab-btn {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  background: var(--surface, #fff);
  color: var(--text-secondary, #667085);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}
.tab-btn.active {
  background: var(--primary, #4f46e5);
  color: #fff;
}
.tab-btn:not(.active):hover {
  background: var(--hover-bg, #f2f4f7);
}
.metric-highlight {
  border-left: 3px solid var(--border, #eaecf0);
  padding-left: 8px;
}
.metric-highlight.ready-metric {
  border-left-color: #12b76a;
}
.order-queue {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  margin-top: 12px;
}
.queue-card {
  border: 1px solid var(--border, #eaecf0);
  border-radius: 10px;
  padding: 14px 16px;
  background: var(--surface, #fff);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.queue-card.status-pending {
  border-left: 4px solid #f79009;
}
.queue-card.status-preparing {
  border-left: 4px solid #f79009;
  background: #fffbeb;
}
.queue-card.status-ready {
  border-left: 4px solid #12b76a;
  background: #f0fdf4;
}
.queue-card.status-completed {
  opacity: 0.5;
}
.queue-card.status-cancelled {
  opacity: 0.35;
}
.queue-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pickup-code-badge {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 2px;
  font-family: 'Courier New', monospace;
  color: var(--primary, #4f46e5);
}
.status-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 20px;
  background: #f2f4f7;
  color: #344054;
}
.status-tag.pending { background: #fef3c7; color: #92400e; }
.status-tag.preparing { background: #fed7aa; color: #9a3412; }
.status-tag.ready { background: #bbf7d0; color: #166534; }
.status-tag.completed { background: #dbeafe; color: #1e40af; }
.status-tag.cancelled { background: #fee2e2; color: #991b1b; }
.queue-card-body {
  flex: 1;
}
.queue-items {
  font-size: 14px;
  margin: 0 0 4px;
}
.queue-note {
  font-size: 12px;
  color: var(--text-secondary, #667085);
  margin: 0 0 4px;
  font-style: italic;
}
.queue-amount {
  font-size: 13px;
  font-weight: 600;
  color: var(--text, #344054);
}
.queue-card-actions {
  display: flex;
  gap: 8px;
}
</style>
