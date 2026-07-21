<template>
  <section class="page-heading">
    <p class="eyebrow">Order Flow</p>
    <h1>今日点餐预览与取餐码</h1>
    <p>可浏览今日菜单、体验加购并查看已有订单；新订单提交正在联调。</p>
  </section>

  <p class="preview-banner"><strong>预览模式</strong><span>菜单与购物车可操作，新订单暂不提交到服务器。</span></p>
  <p v-if="dishNotice" class="form-message dish-notice" :class="dishNoticeType">{{ dishNotice }}</p>
  <p v-if="menuError" class="form-message error">{{ menuError }}</p>

  <section class="grid two-columns align-start">
    <article class="card">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">Today Menu</p>
          <h2>{{ store.todayMenu.date || '今日' }} 可点菜品</h2>
        </div>
        <button class="secondary" type="button" :disabled="menuLoading" @click="refreshMenu">{{ menuLoading ? '刷新中…' : '刷新菜单' }}</button>
      </div>
      <p v-if="menuLoading" class="muted">正在加载今日菜单…</p>
      <div v-else-if="store.todayMenu.dishes.length" class="dish-list">
        <div v-for="dish in store.todayMenu.dishes" :key="dish.id" class="dish-row rich">
          <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="dish.name" class="dish-thumb" />
          <span v-else class="emoji">{{ dish.image }}</span>
          <span>
            <strong>{{ dish.name }}</strong>
            <small>
              ¥{{ dish.price }} · {{ dish.taste }}
              <template v-if="stallInfo(dish.stallId)"> · {{ stallInfo(dish.stallId) }}</template>
            </small>
            <small class="muted">{{ supplyText(dish) }}</small>
          </span>
          <button
            class="add-dish-button"
            :class="{ added: cartQuantity(dish.id) > 0 }"
            type="button"
            :disabled="dish.supplyStatus === 'sold_out'"
            :aria-label="dish.supplyStatus === 'sold_out' ? `${dish.name} 已售罄` : `加入 ${dish.name}`"
            @click="addToCart(dish)"
          >
            <span>{{ cartQuantity(dish.id) > 0 ? '✓' : '+' }}</span>
            <strong>{{ dish.supplyStatus === 'sold_out' ? '售罄' : cartQuantity(dish.id) > 0 ? `已加 ${cartQuantity(dish.id)}` : '加入' }}</strong>
          </button>
        </div>
      </div>
      <p v-else class="muted">当前餐次暂无可点菜品，可
        <button class="text-link-btn" type="button" @click="refreshMenu">刷新菜单</button>或查看
        <RouterLink class="text-link" to="/dishes">菜品库</RouterLink> /
        <RouterLink class="text-link" to="/recommend">推荐</RouterLink>
      </p>
    </article>

    <article class="card detail-panel">
      <div class="section-title">
        <p class="eyebrow">Cart</p>
        <h2>购物车</h2>
      </div>
      <div v-if="cart.length" class="dish-list dense">
        <div v-for="item in cart" :key="item.dishId" class="dish-row">
          <img v-if="item.imageUrl" :src="item.imageUrl" :alt="item.name" class="dish-thumb small" />
          <span v-else class="emoji">{{ item.image }}</span>
          <span>
            <strong>{{ item.name }}</strong>
            <small v-if="item.stallName">{{ item.stallName }} · ¥{{ item.price }} × {{ item.quantity }}</small>
            <small v-else>¥{{ item.price }} × {{ item.quantity }}</small>
          </span>
          <div class="qty-controls">
            <button class="ghost" type="button" @click="decrement(item.dishId)">−</button>
            <span class="qty-badge">{{ item.quantity }}</span>
            <button class="ghost" type="button" @click="increment(item.dishId)">+</button>
          </div>
        </div>
      </div>
      <p v-else class="muted">购物车为空 — 从左侧今日菜单点击「加入」即可开始点餐。</p>

      <div class="delivery-section">
        <label class="delivery-label">配送方式</label>
        <div class="delivery-toggle">
          <button
            type="button"
            :class="['toggle-btn', { active: deliveryMode === 'pickup' }]"
            @click="deliveryMode = 'pickup'"
          >到店自取</button>
          <button
            type="button"
            :class="['toggle-btn', { active: deliveryMode === 'dorm' }]"
            @click="deliveryMode = 'dorm'"
          >宿舍配送</button>
        </div>
        <div v-if="deliveryMode === 'dorm'" class="dorm-fields">
          <label>
            宿舍楼栋
            <input v-model="dormBuilding" type="text" placeholder="如：7号宿舍楼" />
          </label>
          <label>
            房间号
            <input v-model="dormRoom" type="text" placeholder="如：302" />
          </label>
          <p class="muted small">宿舍配送费 ¥{{ DELIVERY_FEE.toFixed(2) }}，将在订单总额中体现。</p>
        </div>
      </div>

      <label>
        备注
        <textarea v-model="note" placeholder="少辣、不要香菜等"></textarea>
      </label>
      <div class="metric-grid compact">
        <article><strong>¥{{ subtotalAmount }}</strong><span>菜品小计</span></article>
        <article v-if="deliveryMode === 'dorm'"><strong>¥{{ DELIVERY_FEE.toFixed(2) }}</strong><span>配送费</span></article>
        <article><strong>¥{{ totalAmount }}</strong><span>合计</span></article>
        <article><strong>{{ cartCount }}</strong><span>份数</span></article>
      </div>
      <button class="primary submit-preview" type="button" disabled>联调中，暂不可提交</button>
      <p v-if="message" class="form-message" :class="{ error: isError }">{{ message }}</p>
    </article>
  </section>

  <section class="card">
    <div class="section-title horizontal">
      <div>
        <p class="eyebrow">Pickup</p>
        <h2>我的订单</h2>
      </div>
      <button class="secondary" type="button" :disabled="ordersLoading" @click="refreshOrders">{{ ordersLoading ? '刷新中…' : '刷新订单' }}</button>
    </div>
    <p v-if="ordersError" class="form-message error">{{ ordersError }}</p>
    <p v-if="ordersLoading && !store.orders.length" class="muted">正在加载订单…</p>
    <div v-else-if="store.orders.length" class="order-cards">
      <article v-for="order in store.orders" :key="order.id" class="order-card" :class="'status-' + order.status">
        <div class="order-card-header">
          <div class="pickup-code-panel">
            <span>取餐码</span>
            <strong>{{ order.pickupCode }}</strong>
            <button class="copy-code-button" type="button" :aria-label="`复制取餐码 ${order.pickupCode}`" :title="copiedOrderId === order.id ? '已复制' : '复制取餐码'" @click="copyPickupCode(order)">{{ copiedOrderId === order.id ? '✓' : '▣' }}</button>
          </div>
          <span class="status-tag" :class="order.status">{{ statusLabel(order.status) }}</span>
        </div>
        <div class="order-card-body">
          <p class="order-items">{{ order.items.map((item) => `${item.dishName}×${item.quantity}`).join('、') }}</p>
          <p class="order-note" v-if="order.note">{{ order.note }}</p>
          <div class="order-meta">
            <span>¥{{ order.totalAmount }}</span>
            <span>{{ paymentLabel(order.paymentStatus) }}</span>
            <span>{{ order.createdAt?.slice(0, 16).replace('T', ' ') }}</span>
          </div>
        </div>
        <div class="order-card-actions">
          <button v-if="order.paymentStatus === 'unpaid' && order.status !== 'cancelled'" class="primary" type="button" :disabled="payingOrderId === order.id" @click="pay(order)">{{ payingOrderId === order.id ? '支付中…' : '模拟支付' }}</button>
          <button v-if="order.paymentStatus === 'unpaid' && ['pending','preparing'].includes(order.status)" class="secondary" type="button" :disabled="cancellingOrderId === order.id" @click="cancel(order)">{{ cancellingOrderId === order.id ? '取消中…' : '取消' }}</button>
        </div>
      </article>
    </div>
    <p v-else class="muted">暂无历史订单。联调完成后，新订单和取餐码会显示在此处。</p>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const route = useRoute();
const cart = ref([]);
const note = ref('');
const message = ref('');
const isError = ref(false);
const menuLoading = ref(false);
const menuError = ref('');
const ordersLoading = ref(false);
const ordersError = ref('');
const dishNotice = ref('');
const dishNoticeType = ref('');
const payingOrderId = ref(null);
const cancellingOrderId = ref(null);
const copiedOrderId = ref(null);
const deliveryMode = ref('pickup');
const dormBuilding = ref('');
const dormRoom = ref('');
const DELIVERY_FEE = 3;

const subtotalAmount = computed(() => cart.value.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2));
const totalAmount = computed(() => {
  const sub = cart.value.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return (sub + (deliveryMode.value === 'dorm' ? DELIVERY_FEE : 0)).toFixed(2);
});
const cartCount = computed(() => cart.value.reduce((sum, item) => sum + item.quantity, 0));

onMounted(async () => {
  menuLoading.value = true;
  menuError.value = '';
  try {
    await store.loadTodayMenu();
  } catch (err) {
    menuError.value = `菜单加载失败：${err.message}`;
  } finally {
    menuLoading.value = false;
  }

  ordersLoading.value = true;
  ordersError.value = '';
  try {
    await store.loadOrders();
  } catch (err) {
    ordersError.value = `订单加载失败：${err.message}`;
  } finally {
    ordersLoading.value = false;
  }

  handleDishParam();
});

function handleDishParam() {
  const dishId = route.query.dish;
  if (!dishId) return;

  const dish = store.todayMenu.dishes.find((d) => String(d.id) === String(dishId));
  if (!dish) {
    dishNotice.value = `菜品 ${dishId} 不在今日菜单中，请从左侧菜单选择其他菜品，或查看菜品库和推荐。`;
    dishNoticeType.value = 'error';
    return;
  }
  if (dish.supplyStatus === 'sold_out') {
    dishNotice.value = `「${dish.name}」今日已售罄，请选择其他菜品。`;
    dishNoticeType.value = 'error';
    return;
  }
  addToCart(dish);
  dishNotice.value = `已将「${dish.name}」加入购物车，可继续选菜或提交订单。`;
  dishNoticeType.value = 'success';
}

function stallInfo(stallId) {
  const stall = store.stalls.find((s) => s.id === stallId);
  if (!stall) return '';
  const canteen = store.canteens.find((c) => c.id === stall.canteenId);
  return canteen ? `${stall.name} · ${canteen.name}` : stall.name;
}

function supplyText(dish) {
  const item = dish.menuItem;
  if (!item) return '未排入今日菜单';
  if (dish.supplyStatus === 'sold_out') return '已售罄';
  if (item.supplyLimit > 0) return `剩余 ${Math.max(0, item.supplyLimit - item.supplyCount)} 份`;
  return '供应中';
}

function addToCart(dish) {
  const stall = store.stalls.find((s) => s.id === dish.stallId);
  const existing = cart.value.find((item) => item.dishId === dish.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.value.push({
      dishId: dish.id,
      name: dish.name,
      price: Number(dish.price || 0),
      quantity: 1,
      imageUrl: dish.imageUrl || '',
      image: dish.image || '🍽️',
      stallId: dish.stallId || '',
      stallName: stall?.name || ''
    });
  }
}

function cartQuantity(dishId) {
  return cart.value.find((item) => item.dishId === dishId)?.quantity || 0;
}

async function copyPickupCode(order) {
  try {
    await navigator.clipboard.writeText(String(order.pickupCode));
  } catch {
    const input = document.createElement('textarea');
    input.value = String(order.pickupCode);
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  copiedOrderId.value = order.id;
  window.setTimeout(() => { if (copiedOrderId.value === order.id) copiedOrderId.value = null; }, 1600);
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
  menuLoading.value = true;
  menuError.value = '';
  try {
    await store.loadTodayMenu();
  } catch (err) {
    menuError.value = `菜单刷新失败：${err.message}`;
  } finally {
    menuLoading.value = false;
  }
}

async function refreshOrders() {
  ordersLoading.value = true;
  ordersError.value = '';
  try {
    await store.loadOrders();
  } catch (err) {
    ordersError.value = `订单刷新失败：${err.message}`;
  } finally {
    ordersLoading.value = false;
  }
}

async function pay(order) {
  payingOrderId.value = order.id;
  message.value = '';
  isError.value = false;
  try {
    const paid = await store.payOrder(order.id);
    message.value = `支付成功，取餐码 ${paid.pickupCode}`;
  } catch (error) {
    message.value = error.message;
    isError.value = true;
  } finally {
    payingOrderId.value = null;
  }
}

async function cancel(order) {
  cancellingOrderId.value = order.id;
  message.value = '';
  isError.value = false;
  try {
    await store.cancelOrder(order.id);
    message.value = '订单已取消，库存已回滚。';
  } catch (error) {
    message.value = error.message;
    isError.value = true;
  } finally {
    cancellingOrderId.value = null;
  }
}

function paymentLabel(status) {
  return { unpaid: '未支付', paid: '已支付', refunded: '已退款' }[status] || status;
}

function statusLabel(status) {
  return { pending: '待接单', preparing: '备餐中', ready: '待取餐', completed: '已完成', cancelled: '已取消' }[status] || status;
}
</script>

<style scoped>
.preview-banner { display: flex; align-items: center; gap: 10px; margin: 0 0 16px; padding: 11px 14px; border: 1px solid #ead48b; background: #fff8dc; color: #6d5200; }.preview-banner strong { flex: 0 0 auto; }.preview-banner span { font-size: 13px; }
.submit-preview:disabled { opacity: 1; cursor: not-allowed; background: #dfe8dc; color: #5d6b59; box-shadow: none; }
.dish-thumb {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 8px;
  flex-shrink: 0;
}
.dish-thumb.small {
  width: 36px;
  height: 36px;
  border-radius: 6px;
}
.dish-row.rich {
  align-items: flex-start;
}
.add-dish-button {
  width: 74px;
  min-height: 48px;
  padding: 6px 8px;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
  gap: 5px;
  border: 1px solid rgba(31, 122, 77, .22);
  border-radius: 8px;
  background: #eff7eb;
  color: var(--primary-dark, #155f3b);
  transition: transform .18s ease, background .18s ease, color .18s ease;
}
.add-dish-button > span { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; background: var(--primary, #1f7a4d); color: #fff; font-size: 17px; line-height: 1; }
.add-dish-button strong { font-size: 12px; white-space: nowrap; }
.add-dish-button:hover:not(:disabled) { transform: translateY(-2px) scale(1.02); background: #e1f1db; }
.add-dish-button:active:not(:disabled) { transform: scale(.96); }
.add-dish-button.added { background: var(--primary, #1f7a4d); color: #fff; }
.add-dish-button.added > span { background: #fff; color: var(--primary-dark, #155f3b); }
.qty-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.qty-controls .ghost {
  width: 28px;
  height: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
  border: 1px solid var(--border, #d0d5dd);
  border-radius: 6px;
  background: var(--surface, #fff);
  color: var(--text, #344054);
  cursor: pointer;
}
.qty-controls .ghost:hover {
  background: var(--hover-bg, #f2f4f7);
}
.qty-badge {
  min-width: 24px;
  text-align: center;
  font-weight: 600;
  font-size: 14px;
}
.delivery-section {
  margin: 12px 0 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border, #eaecf0);
}
.delivery-label {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 6px;
  display: block;
}
.delivery-toggle {
  display: flex;
  gap: 0;
  border: 1px solid var(--border, #d0d5dd);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 8px;
}
.toggle-btn {
  flex: 1;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  background: var(--surface, #fff);
  color: var(--text-secondary, #667085);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.toggle-btn.active {
  background: var(--primary, #4f46e5);
  color: #fff;
}
.toggle-btn:not(.active):hover {
  background: var(--hover-bg, #f2f4f7);
}
.dorm-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 0;
}
.dorm-fields label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
}
.dorm-fields input {
  padding: 8px 10px;
  border: 1px solid var(--border, #d0d5dd);
  border-radius: 6px;
  font-size: 14px;
}
.dorm-fields .muted.small {
  font-size: 12px;
  margin: 0;
}
.order-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.order-card {
  border: 1px solid var(--border, #eaecf0);
  border-radius: 10px;
  padding: 14px 16px;
  background: var(--surface, #fff);
}
.order-card.status-ready {
  border-color: #12b76a;
  background: #f0fdf4;
}
.order-card.status-preparing {
  border-color: #f79009;
  background: #fffbeb;
}
.order-card.status-cancelled {
  opacity: 0.6;
}
.order-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.pickup-code-panel { display: grid; grid-template-columns: auto auto 34px; align-items: center; gap: 9px; padding: 8px 10px; border: 1px solid rgba(31, 122, 77, .18); border-radius: 8px; background: #eff7eb; }
.pickup-code-panel > span { font-size: 11px; color: var(--muted); }
.pickup-code-panel > strong { font-size: 21px; letter-spacing: 2px; font-family: 'Courier New', monospace; color: var(--primary-dark, #155f3b); }
.copy-code-button { width: 34px; height: 34px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 50%; background: #fff; color: var(--primary-dark, #155f3b); font-size: 16px; box-shadow: 0 3px 9px rgba(21, 95, 59, .1); }
.copy-code-button:hover { transform: translateY(-1px); }
.status-tag {
  font-size: 12px;
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
.order-card-body {
  margin-bottom: 10px;
}
.order-items {
  font-size: 14px;
  margin: 0 0 4px;
}
.order-note {
  font-size: 12px;
  color: var(--text-secondary, #667085);
  margin: 0 0 4px;
  font-style: italic;
}
.order-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text-secondary, #667085);
}
.order-card-actions {
  display: flex;
  gap: 8px;
}
.form-message.error {
  color: #b42318;
}
.dish-notice.success {
  color: #065f46;
}
.text-link-btn {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--primary, #4f46e5);
  text-decoration: underline;
  cursor: pointer;
}
.text-link-btn:hover {
  opacity: 0.8;
}
@media (max-width: 560px) {
  .dish-row.rich { display: grid; grid-template-columns: 56px minmax(0, 1fr) 70px; }
  .add-dish-button { width: 70px; }
  .order-card-header { align-items: flex-start; gap: 10px; }
  .pickup-code-panel { grid-template-columns: auto auto 32px; }
  .pickup-code-panel > strong { font-size: 18px; }
}
@media (prefers-reduced-motion: reduce) {
  .add-dish-button, .copy-code-button { transition: none; }
}
</style>
