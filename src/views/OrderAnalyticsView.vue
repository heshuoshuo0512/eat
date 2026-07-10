<template>
  <section class="page-heading">
    <p class="eyebrow">实验性功能 · 模拟数据</p>
    <h1>订单营业看板</h1>
    <p>此页面为实验性功能，当前展示模拟订单数据。所有收入和订单指标均为模拟值，不代表真实营收。仅供内部测试和流程验证使用。</p>
  </section>

  <section class="metric-grid">
    <article><strong>{{ analytics.todayOrders || 0 }}</strong><span>今日订单</span></article>
    <article><strong>¥{{ Number(analytics.todayRevenue || 0).toFixed(2) }}</strong><span>模拟收入</span></article>
    <article><strong>{{ analytics.statusCounts?.pending || 0 }}</strong><span>待接单</span></article>
    <article><strong>{{ analytics.soldOutItems?.length || 0 }}</strong><span>售罄菜品</span></article>
  </section>

  <section class="grid two-columns align-start">
    <article class="card">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">Status</p>
          <h2>状态分布</h2>
        </div>
        <button class="secondary" type="button" @click="load">刷新</button>
      </div>
      <div class="dish-list dense">
        <div v-for="status in statuses" :key="status.value" class="dish-row">
          <span><strong>{{ status.label }}</strong><small>{{ status.value }}</small></span>
          <strong>{{ analytics.statusCounts?.[status.value] || 0 }}</strong>
        </div>
      </div>
    </article>

    <article class="card">
      <div class="section-title">
        <p class="eyebrow">Top Dishes</p>
        <h2>热销菜品（模拟）</h2>
      </div>
      <div v-if="analytics.topDishes?.length" class="dish-list dense">
        <div v-for="dish in analytics.topDishes" :key="dish.dishId" class="dish-row">
          <span><strong>{{ dish.dishName }}</strong><small>{{ dish.dishId }}</small></span>
          <span>{{ dish.totalQuantity || dish.quantity }} 份 · ¥{{ Number(dish.totalRevenue || dish.amount || 0).toFixed(2) }}</span>
        </div>
      </div>
      <p v-else class="muted">暂无销售数据。</p>
    </article>
  </section>

  <section class="card">
    <div class="section-title">
      <p class="eyebrow">Sold Out</p>
      <h2>今日售罄</h2>
    </div>
    <div v-if="analytics.soldOutItems?.length" class="table-wrap">
      <table>
        <thead><tr><th>菜品</th><th>供应上限</th><th>已售</th></tr></thead>
        <tbody>
          <tr v-for="item in analytics.soldOutItems" :key="item.menuItemId">
            <td>{{ item.dishName }}</td>
            <td>{{ item.supplyLimit }}</td>
            <td>{{ item.supplyCount }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="muted">暂无售罄菜品。</p>
    <p v-if="message" class="form-message">{{ message }}</p>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const analytics = ref({ statusCounts: {}, topDishes: [], soldOutItems: [] });
const message = ref('');
const statuses = [
  { value: 'pending', label: '待接单' },
  { value: 'preparing', label: '备餐中' },
  { value: 'ready', label: '待取餐' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' }
];

onMounted(load);

async function load() {
  message.value = '';
  try {
    analytics.value = await store.loadOrderAnalytics();
  } catch (error) {
    message.value = error.message;
  }
}
</script>
