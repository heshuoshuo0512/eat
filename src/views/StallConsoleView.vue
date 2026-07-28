<template>
  <section class="page-heading">
    <p class="eyebrow">预约运营</p>
    <h1>档口预约工作台</h1>
    <p>管理到店预约、确认最终金额，并按档口或菜品临时暂停预约。</p>
  </section>

  <section class="card reservation-settings">
    <div class="section-title horizontal">
      <div><p class="eyebrow">Reservation Settings</p><h2>预约开关</h2></div>
      <select v-model="managedStallId" aria-label="选择档口" @change="loadManagedDishes">
        <option value="">选择档口</option>
        <option v-for="stall in store.stalls" :key="stall.id" :value="stall.id">{{ stall.name }}</option>
      </select>
    </div>
    <template v-if="managedStall">
      <div class="reservation-master-row">
        <div><strong>{{ managedStall.name }}</strong><span>{{ managedStall.reservationEnabled===false?'当前暂停预约':'当前可预约' }}</span></div>
        <button class="secondary" type="button" :disabled="switchingId===managedStall.id" @click="toggleStallReservation">{{ managedStall.reservationEnabled===false?'开启档口预约':'暂停档口预约' }}</button>
      </div>
      <div class="reservation-dish-list">
        <div v-for="dish in managedDishes" :key="dish.id" class="reservation-dish-row">
          <span><strong>{{ dish.name }}</strong><small>{{ dish.priceDisplay||'价格待核验' }}</small></span>
          <button class="ghost" type="button" :disabled="switchingId===dish.id" @click="toggleDishReservation(dish)">{{ dish.reservationEnabled===false?'开启':'暂停' }}</button>
        </div>
      </div>
      <p v-if="managedDishPage.hasMore" class="muted">该档口菜品超过 100 道，请在目录管理中继续维护。</p>
    </template>
    <p v-else class="muted">选择档口后可维护预约状态。</p>
  </section>

  <section class="card">
    <div class="section-title horizontal">
      <div>
        <p class="eyebrow">Live Reservations</p>
        <h2>预约队列</h2>
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
      <article><strong>¥{{ revenue }}</strong><span>已完成金额</span></article>
    </div>

    <div v-if="filteredOrders.length" class="order-queue">
      <article v-for="order in filteredOrders" :key="order.id" class="queue-card" :class="'status-' + order.status">
        <div class="queue-card-header">
          <div class="pickup-code-badge">{{ order.pickupCode }}</div>
          <span class="status-tag" :class="order.status">{{ statusLabel(order.status) }}</span>
        </div>
        <div class="queue-card-body">
          <p class="queue-stall">{{ order.stallName||stallName(order.stallId) }}</p>
          <p class="queue-items">{{ order.items.map((item) => `${item.dishName}×${item.quantity}`).join('、') }}</p>
          <p class="queue-note" v-if="order.note">{{ order.note }}</p>
          <span class="queue-amount">{{ order.pricingStatus==='pending_confirmation'?`预计 ¥${order.estimatedAmount}`:`最终 ¥${order.finalAmount??order.estimatedAmount}` }} · 到店支付</span>
          <div v-if="order.pricingStatus==='pending_confirmation'&&!['completed','cancelled'].includes(order.status)" class="price-confirmation">
            <label :for="`final-${order.id}`">最终金额</label>
            <input :id="`final-${order.id}`" v-model="finalAmounts[order.id]" type="number" min="0" step="0.01" inputmode="decimal" placeholder="到店称重/选规格后填写" />
            <button class="secondary" type="button" @click="confirmPrice(order)">确认金额</button>
          </div>
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
import { computed, onMounted, reactive, ref } from 'vue';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const statusFilter = ref('');
const message = ref('');
const finalAmounts = reactive({});
const managedStallId = ref('');
const managedDishes = ref([]);
const managedDishPage = ref({ page: 1, pageSize: 100, total: 0, hasMore: false });
const switchingId = ref('');
const managedStall = computed(() => store.stalls.find((stall) => stall.id === managedStallId.value) || null);

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
  const completed = store.adminOrders.filter((order) => order.status === 'completed');
  return completed.reduce((sum, order) => sum + Number(order.finalAmount ?? order.estimatedAmount ?? 0), 0).toFixed(2);
});

onMounted(async () => {
  await load();
  managedStallId.value = store.stalls[0]?.id || '';
  if (managedStallId.value) await loadManagedDishes();
});

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

async function loadManagedDishes() {
  if (!managedStallId.value) { managedDishes.value = []; return; }
  try {
    const result = await store.searchDishes({ stallId: managedStallId.value, page: 1, pageSize: 100, sort: 'name' });
    managedDishes.value = result.items || [];
    managedDishPage.value = result.page || managedDishPage.value;
  } catch (error) { message.value = error.message; }
}

async function toggleStallReservation() {
  if (!managedStall.value) return;
  switchingId.value = managedStall.value.id;
  try {
    await store.updateStallReservation(managedStall.value.id, managedStall.value.reservationEnabled === false);
    message.value = `${managedStall.value.name}预约状态已更新。`;
  } catch (error) { message.value = error.message; } finally { switchingId.value = ''; }
}

async function toggleDishReservation(dish) {
  switchingId.value = dish.id;
  try {
    const reservation = await store.updateDishReservation(dish.id, dish.reservationEnabled === false);
    managedDishes.value = managedDishes.value.map((item) => item.id === dish.id ? { ...item, reservationEnabled: reservation.reservationEnabled } : item);
    message.value = `${dish.name}预约状态已更新。`;
  } catch (error) { message.value = error.message; } finally { switchingId.value = ''; }
}

async function confirmPrice(order) {
  const amount = Number(finalAmounts[order.id]);
  if (!Number.isFinite(amount) || amount < 0) { message.value = '请输入有效的最终金额。'; return; }
  try {
    await store.confirmReservationPrice(order.id, amount);
    delete finalAmounts[order.id];
    message.value = `预约 ${order.pickupCode} 的最终金额已确认。`;
  } catch (error) { message.value = error.message; }
}

function stallName(id) { return store.stalls.find((stall) => stall.id === id)?.name || '档口待同步'; }

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
.reservation-settings { margin-bottom: 18px; }
.reservation-settings select { min-width: min(280px, 100%); }
.reservation-master-row { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:12px 0; border-bottom:1px solid var(--border, #eaecf0); }
.reservation-master-row div,.reservation-master-row span,.reservation-dish-row span,.reservation-dish-row small { display:grid; gap:3px; }
.reservation-master-row span,.reservation-dish-row small,.queue-stall { color:var(--muted); font-size:12px; }
.reservation-dish-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0 18px; }
.reservation-dish-row { min-width:0; min-height:56px; display:flex; align-items:center; justify-content:space-between; gap:12px; border-bottom:1px solid var(--border, #eaecf0); }
.reservation-dish-row span { min-width:0; }.reservation-dish-row strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
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
.price-confirmation { display:grid; grid-template-columns:auto minmax(110px,1fr) auto; align-items:center; gap:8px; margin-top:10px; }
.price-confirmation label { color:var(--muted); font-size:12px; }.price-confirmation input { min-height:40px; }
.queue-amount {
  font-size: 13px;
  font-weight: 600;
  color: var(--text, #344054);
}
.queue-card-actions {
  display: flex;
  gap: 8px;
}
@media (max-width:720px) { .reservation-settings .section-title,.reservation-master-row { align-items:stretch; flex-direction:column; }.reservation-settings select { width:100%; }.reservation-dish-list { grid-template-columns:1fr; }.price-confirmation { grid-template-columns:1fr; }.filter-tabs { width:100%; overflow-x:auto; }.table-actions { align-items:stretch; flex-direction:column; } }
</style>
