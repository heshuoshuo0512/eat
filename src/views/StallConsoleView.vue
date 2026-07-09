<template>
  <section class="page-heading">
    <p class="eyebrow">Stall Console</p>
    <h1>档口订单工作台</h1>
    <p>集中处理待接单、备餐中、待取餐订单，所有状态变更写入审计日志。</p>
  </section>

  <section class="card">
    <div class="section-title horizontal">
      <div>
        <p class="eyebrow">Live Orders</p>
        <h2>订单队列</h2>
      </div>
      <div class="table-actions">
        <select v-model="statusFilter" @change="load">
          <option value="">全部状态</option>
          <option value="pending">待接单</option>
          <option value="preparing">备餐中</option>
          <option value="ready">待取餐</option>
          <option value="completed">已完成</option>
          <option value="cancelled">已取消</option>
        </select>
        <button class="secondary" type="button" @click="load">刷新</button>
      </div>
    </div>

    <div class="metric-grid compact">
      <article><strong>{{ pendingCount }}</strong><span>待接单</span></article>
      <article><strong>{{ preparingCount }}</strong><span>备餐中</span></article>
      <article><strong>{{ readyCount }}</strong><span>待取餐</span></article>
      <article><strong>¥{{ revenue }}</strong><span>队列金额</span></article>
    </div>

    <div v-if="store.adminOrders.length" class="table-wrap">
      <table>
        <thead><tr><th>取餐码</th><th>状态</th><th>菜品</th><th>金额</th><th>备注</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="order in store.adminOrders" :key="order.id">
            <td><strong>{{ order.pickupCode }}</strong></td>
            <td>{{ statusLabel(order.status) }}</td>
            <td>{{ order.items.map((item) => `${item.dishName}×${item.quantity}`).join('、') }}</td>
            <td>¥{{ order.totalAmount }}</td>
            <td>{{ order.note || '-' }}</td>
            <td>
              <div class="table-actions">
                <button v-if="order.status === 'pending'" class="primary" type="button" @click="next(order, 'preparing')">接单</button>
                <button v-if="order.status === 'preparing'" class="primary" type="button" @click="next(order, 'ready')">出餐</button>
                <button v-if="order.status === 'ready'" class="primary" type="button" @click="next(order, 'completed')">完成</button>
                <button v-if="['pending','preparing'].includes(order.status)" class="secondary" type="button" @click="next(order, 'cancelled')">取消</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
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

const pendingCount = computed(() => store.adminOrders.filter((order) => order.status === 'pending').length);
const preparingCount = computed(() => store.adminOrders.filter((order) => order.status === 'preparing').length);
const readyCount = computed(() => store.adminOrders.filter((order) => order.status === 'ready').length);
const revenue = computed(() => store.adminOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0).toFixed(2));

onMounted(load);

async function load() {
  await store.loadAdminOrders(statusFilter.value);
}

async function next(order, status) {
  message.value = '';
  try {
    await store.updateOrderStatus(order.id, status);
    message.value = `订单 ${order.pickupCode} 已更新为 ${statusLabel(status)}。`;
  } catch (error) {
    message.value = error.message;
  }
}

function statusLabel(status) {
  return { pending: '待接单', preparing: '备餐中', ready: '待取餐', completed: '已完成', cancelled: '已取消' }[status] || status;
}
</script>
