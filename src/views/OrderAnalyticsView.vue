<template>
  <section class="page-heading">
    <p class="eyebrow">预约经营数据</p>
    <h1>到店预约看板</h1>
    <p>仅统计真实预约；收入与销量在档口完成预约后计入，取消预约不计入。</p>
  </section>

  <section class="metric-grid">
    <article><strong>{{ analytics.todayOrders || 0 }}</strong><span>今日预约</span></article>
    <article><strong>¥{{ Number(analytics.todayRevenue || 0).toFixed(2) }}</strong><span>已完成金额</span></article>
    <article><strong>{{ analytics.statusCounts?.pending || 0 }}</strong><span>待接单</span></article>
    <article><strong>{{ analytics.statusCounts?.completed || 0 }}</strong><span>已完成</span></article>
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
        <h2>已完成预约菜品</h2>
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

  <p v-if="message" class="form-message">{{ message }}</p>
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
