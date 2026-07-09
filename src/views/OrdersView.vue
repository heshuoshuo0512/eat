<template>
  <section class="page-heading">
    <p class="eyebrow">Order Flow</p>
    <h1>今日点餐与取餐码</h1>
    <p>从已发布今日菜单下单，系统实时扣减供应量，售罄后自动阻止继续购买。</p>
  </section>

  <section class="grid two-columns align-start">
    <article class="card">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">Today Menu</p>
          <h2>{{ store.todayMenu.date || '今日' }} 可点菜品</h2>
        </div>
        <button class="secondary" type="button" @click="refreshMenu">刷新菜单</button>
      </div>
      <div v-if="store.todayMenu.dishes.length" class="dish-list">
        <div v-for="dish in store.todayMenu.dishes" :key="dish.id" class="dish-row">
          <span class="emoji">{{ dish.image }}</span>
          <span>
            <strong>{{ dish.name }}</strong>
            <small>¥{{ dish.price }} · {{ dish.taste }} · {{ supplyText(dish) }}</small>
          </span>
          <button class="primary" type="button" :disabled="dish.supplyStatus === 'sold_out'" @click="addToCart(dish)">加入</button>
        </div>
      </div>
      <p v-else class="muted">今日暂未发布菜单，请先在管理端发布菜单。</p>
    </article>

    <article class="card detail-panel">
      <div class="section-title">
        <p class="eyebrow">Cart</p>
        <h2>购物车</h2>
      </div>
      <div v-if="cart.length" class="dish-list dense">
        <div v-for="item in cart" :key="item.dishId" class="dish-row">
          <span>
            <strong>{{ item.name }}</strong>
            <small>¥{{ item.price }} × {{ item.quantity }}</small>
          </span>
          <div class="table-actions">
            <button class="secondary" type="button" @click="decrement(item.dishId)">-</button>
            <button class="secondary" type="button" @click="increment(item.dishId)">+</button>
          </div>
        </div>
      </div>
      <p v-else class="muted">还没有选择菜品。</p>
      <label>
        备注
        <textarea v-model="note" placeholder="少辣、不要香菜等"></textarea>
      </label>
      <div class="metric-grid compact">
        <article><strong>¥{{ totalAmount }}</strong><span>合计</span></article>
        <article><strong>{{ cartCount }}</strong><span>份数</span></article>
      </div>
      <button class="primary" type="button" :disabled="!cart.length || loading" @click="submitOrder">提交订单</button>
      <p v-if="message" class="form-message">{{ message }}</p>
    </article>
  </section>

  <section class="card">
    <div class="section-title horizontal">
      <div>
        <p class="eyebrow">Pickup</p>
        <h2>我的订单</h2>
      </div>
      <button class="secondary" type="button" @click="store.loadOrders()">刷新订单</button>
    </div>
    <div v-if="store.orders.length" class="table-wrap">
      <table>
        <thead><tr><th>取餐码</th><th>状态</th><th>支付</th><th>金额</th><th>菜品</th><th>时间</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="order in store.orders" :key="order.id">
            <td><strong>{{ order.pickupCode }}</strong></td>
            <td>{{ statusLabel(order.status) }}</td>
            <td>{{ paymentLabel(order.paymentStatus) }}</td>
            <td>¥{{ order.totalAmount }}</td>
            <td>{{ order.items.map((item) => `${item.dishName}×${item.quantity}`).join('、') }}</td>
            <td>{{ order.createdAt?.slice(0, 16).replace('T', ' ') }}</td>
            <td>
              <div class="table-actions">
                <button v-if="order.paymentStatus === 'unpaid' && order.status !== 'cancelled'" class="primary" type="button" @click="pay(order)">模拟支付</button>
                <button v-if="order.paymentStatus === 'unpaid' && ['pending','preparing'].includes(order.status)" class="secondary" type="button" @click="cancel(order)">取消</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="muted">暂无订单。</p>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const cart = ref([]);
const note = ref('');
const message = ref('');
const loading = ref(false);

const totalAmount = computed(() => cart.value.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2));
const cartCount = computed(() => cart.value.reduce((sum, item) => sum + item.quantity, 0));

onMounted(async () => {
  await store.loadTodayMenu();
  await store.loadOrders();
});

function supplyText(dish) {
  const item = dish.menuItem;
  if (!item) return '未排入今日菜单';
  if (dish.supplyStatus === 'sold_out') return '已售罄';
  if (item.supplyLimit > 0) return `剩余 ${Math.max(0, item.supplyLimit - item.supplyCount)} 份`;
  return '供应中';
}

function addToCart(dish) {
  const existing = cart.value.find((item) => item.dishId === dish.id);
  if (existing) existing.quantity += 1;
  else cart.value.push({ dishId: dish.id, name: dish.name, price: Number(dish.price || 0), quantity: 1 });
}

function increment(dishId) {
  const item = cart.value.find((entry) => entry.dishId === dishId);
  if (item) item.quantity += 1;
}

function decrement(dishId) {
  const item = cart.value.find((entry) => entry.dishId === dishId);
  if (!item) return;
  item.quantity -= 1;
  if (item.quantity <= 0) cart.value = cart.value.filter((entry) => entry.dishId !== dishId);
}

async function refreshMenu() {
  await store.loadTodayMenu();
}

async function submitOrder() {
  loading.value = true;
  message.value = '';
  try {
    const order = await store.createOrder({ items: cart.value.map(({ dishId, quantity }) => ({ dishId, quantity })), note: note.value });
    cart.value = [];
    note.value = '';
    message.value = `下单成功，取餐码 ${order.pickupCode}`;
  } catch (error) {
    message.value = error.message;
  } finally {
    loading.value = false;
  }
}

async function pay(order) {
  message.value = '';
  try {
    const paid = await store.payOrder(order.id);
    message.value = `支付成功，取餐码 ${paid.pickupCode}`;
  } catch (error) {
    message.value = error.message;
  }
}

async function cancel(order) {
  message.value = '';
  try {
    await store.cancelOrder(order.id);
    message.value = '订单已取消，库存已回滚。';
  } catch (error) {
    message.value = error.message;
  }
}

function paymentLabel(status) {
  return { unpaid: '未支付', paid: '已支付', refunded: '已退款' }[status] || status;
}

function statusLabel(status) {
  return { pending: '待接单', preparing: '备餐中', ready: '待取餐', completed: '已完成', cancelled: '已取消' }[status] || status;
}
</script>
