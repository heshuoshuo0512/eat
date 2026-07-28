<template>
  <sc-page-shell back title="今日点餐" subtitle="菜单与取餐码预览" tone="meal">
    <view class="preview-banner"><text class="ui-strong">联调中</text><text>可浏览菜单、维护本地购物车和查看历史订单，暂不创建新订单。</text></view>
    <sc-segmented-control v-model="activePanel" :options="panelOptions" block />

    <template v-if="activePanel==='menu'">
      <view class="orders-workspace">
        <view class="orders-menu">
      <view class="menu-head"><view><text>{{ store.todayMenu.value.date||'今日' }}</text><text class="ui-strong">{{ mealLabel }}菜单</text></view><button :loading="menuLoading" @tap="reloadMenu">刷新</button></view>
      <sc-state-card v-if="menuLoading&&!menuDishes.length" type="loading" title="正在读取今日菜单" />
      <sc-state-card v-else-if="menuError&&!menuDishes.length" type="error" title="菜单加载失败" :desc="menuError" action-text="重试" @action="reloadMenu" />
      <view v-else class="menu-list">
        <view v-for="dish in menuDishes" :key="dish.id" class="menu-entry">
          <sc-list-row :title="dish.name" :description="locationLabel(dish)" :meta="dishPriceText(dish)" :badge="supplyState(dish).label" :badge-tone="supplyTone(dish)" :show-arrow="false" @tap="openDish(dish.id)" />
          <view class="cart-action" :class="{ 'just-added': String(cartPulseId)===String(dish.id) }">
            <button v-if="!quantity(dish.id)" class="add-button" :disabled="!supplyState(dish).canAdd" @tap="add(dish)">加入</button>
            <view v-else class="stepper"><button aria-label="减少" @tap="decrement(dish.id)">−</button><text>{{ quantity(dish.id) }}</text><button aria-label="增加" @tap="add(dish)">＋</button></view>
          </view>
        </view>
        <sc-state-card v-if="!menuDishes.length" type="empty" title="当前餐次暂无已发布菜单" desc="这里只展示后端发布的真实菜品。" />
      </view>
        </view>

      <view class="cart-panel">
        <view class="cart-title"><view><text>本地购物车</text><text class="ui-strong">{{ cartCount }} 份 · ¥{{ cartAmount }}</text></view><button v-if="cart.length" @tap="clearCart">清空</button></view>
        <view v-if="cart.length" class="cart-lines"><view v-for="item in cart" :key="item.dishId"><text>{{ item.name }} × {{ item.quantity }}</text><text class="ui-strong">¥{{ lineAmount(item) }}</text></view></view>
        <text v-else class="cart-empty">从今日菜单加入菜品后会显示在这里。</text>
        <button class="submit-disabled" disabled>联调中，暂不可提交</button>
      </view>
      </view>
    </template>

    <template v-else>
      <view class="order-head"><view><text>历史记录</text><text class="ui-strong">{{ orders.length }} 笔订单</text></view><button :loading="ordersLoading" @tap="loadOrders">刷新</button></view>
      <sc-state-card v-if="ordersLoading&&!orders.length" type="loading" title="正在读取历史订单" />
      <sc-state-card v-else-if="ordersError&&!orders.length" type="error" title="订单加载失败" :desc="ordersError" action-text="重试" @action="loadOrders" />
      <view v-else class="order-list">
        <view v-for="order in orders" :key="order.id" class="order-card">
          <view class="order-top"><view><text class="ui-strong">{{ statusLabel(order.status) }}</text><text>{{ formatTime(order.createdAt) }}</text></view><text>{{ paymentLabel(order.paymentStatus) }}</text></view>
          <view class="order-items"><text v-for="item in order.items" :key="item.id">{{ item.dishName }} × {{ item.quantity }}</text></view>
          <view class="pickup-row"><view><text>取餐码</text><text class="ui-strong">{{ order.pickupCode||'待生成' }}</text></view><button :disabled="!order.pickupCode" @tap="copyCode(order.pickupCode)">复制</button><text class="ui-bold">¥{{ Number(order.totalAmount||0).toFixed(2) }}</text></view>
        </view>
        <sc-state-card v-if="!orders.length" type="empty" illustration="order-complete" title="还没有历史订单" desc="当前页面不会创建订单，联调完成后再开放提交。" />
      </view>
    </template>
  </sc-page-shell>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { dishPriceText } from '../../domain/dishPresentation.js';
import { mealTypeLabel } from '../../utils/format.js';
import { triggerHaptic } from '../../composables/useInteractionFeedback.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const CART_KEY='smart-canteen-preview-cart';
const store=useCanteenStore();const panelOptions=[{value:'menu',label:'今日菜单'},{value:'history',label:'历史订单'}];
const activePanel=ref('menu');const cart=ref([]);const orders=ref([]);const cartPulseId=ref('');const menuLoading=ref(false);const menuError=ref('');const ordersLoading=ref(false);const ordersError=ref('');let requestedDishId='';let initialized=false;let cartPulseTimer=0;
const menuDishes=computed(()=>store.todayMenu.value.dishes||[]);const mealLabel=computed(()=>mealTypeLabel(store.todayMenu.value.mealType||store.profile.value.mealType));const cartCount=computed(()=>cart.value.reduce((sum,item)=>sum+Number(item.quantity||0),0));const cartAmount=computed(()=>cart.value.reduce((sum,item)=>sum+Number(item.price||0)*Number(item.quantity||0),0).toFixed(2));
onLoad((options)=>{requestedDishId=String(options?.dish||'');if(options?.panel==='history')activePanel.value='history';const saved=uni.getStorageSync(CART_KEY);if(Array.isArray(saved))cart.value=saved;});
onShow(async()=>{try{await store.refreshIfStale();if(!store.user.value){uni.reLaunch({url:'/pages/login/login'});return;}if(!initialized){initialized=true;await Promise.all([reloadMenu(),loadOrders()]);addRequestedDish();}}catch{}});
function persist(){uni.setStorageSync(CART_KEY,cart.value);}function quantity(id){return cart.value.find((item)=>String(item.dishId)===String(id))?.quantity||0;}function lineAmount(item){return(Number(item.price||0)*Number(item.quantity||0)).toFixed(2);}
function addRequestedDish(){if(!requestedDishId)return;const dish=menuDishes.value.find((item)=>String(item.id)===requestedDishId);if(dish&&supplyState(dish).canAdd){add(dish);uni.showToast({title:'已加入预览购物车',icon:'none'});}else uni.showToast({title:'该菜不在当前可点菜单',icon:'none'});requestedDishId='';}
function add(dish){if(!supplyState(dish).canAdd)return;const existing=cart.value.find((item)=>String(item.dishId)===String(dish.id));if(existing)existing.quantity+=1;else cart.value.push({dishId:dish.id,name:dish.name,price:Number(dish.price||0),quantity:1});persist();cartPulseId.value=String(dish.id);clearTimeout(cartPulseTimer);cartPulseTimer=setTimeout(()=>{cartPulseId.value='';},420);triggerHaptic('light');}
function decrement(id){const item=cart.value.find((entry)=>String(entry.dishId)===String(id));if(!item)return;item.quantity-=1;if(item.quantity<=0)cart.value=cart.value.filter((entry)=>String(entry.dishId)!==String(id));persist();}function clearCart(){cart.value=[];persist();}
function supplyState(dish){if(dish.supplyStatus==='sold_out'||dish.menuItem?.soldOut)return{label:'今日售罄',className:'sold',canAdd:false};if(dish.supplyStatus==='limited')return{label:'库存紧张',className:'limited',canAdd:true};return{label:'今日可点',className:'available',canAdd:true};}
function supplyTone(dish){const state=supplyState(dish);return state.className==='sold'?'danger':state.className==='limited'?'warning':'success';}
function locationLabel(dish){const stall=store.stalls.value.find((item)=>item.id===dish.stallId);const canteen=store.canteens.value.find((item)=>item.id===stall?.canteenId);return[canteen?.name,stall?.name].filter(Boolean).join(' · ')||'校园档口';}
async function reloadMenu(){menuLoading.value=true;menuError.value='';try{await store.loadTodayMenu();}catch(error){menuError.value=error.message||'今日菜单加载失败。';}finally{menuLoading.value=false;}}
async function loadOrders(){ordersLoading.value=true;ordersError.value='';try{const result=await store.listOrders();orders.value=result.orders||[];}catch(error){ordersError.value=error.message||'历史订单加载失败。';}finally{ordersLoading.value=false;}}
function openDish(id){uni.navigateTo({url:`/pages/dish-detail/dish-detail?id=${encodeURIComponent(id)}`});}function copyCode(code){if(!code)return;uni.setClipboardData({data:String(code),success:()=>uni.showToast({title:'取餐码已复制',icon:'none'})});}
function statusLabel(value){return{pending:'待接单',preparing:'备餐中',ready:'待取餐',completed:'已完成',cancelled:'已取消'}[value]||value||'处理中';}function paymentLabel(value){return{unpaid:'未支付',paid:'已支付',refunded:'已退款'}[value]||value||'';}function formatTime(value){return String(value||'').replace('T',' ').slice(0,16);}
onBeforeUnmount(()=>clearTimeout(cartPulseTimer));
</script>

<style scoped>
.preview-banner { display:flex; align-items:flex-start; gap:8px; margin-bottom:12px; padding:12px; border:1px solid var(--warning-line); border-radius:var(--radius); color:var(--warning); background:var(--warning-soft); }.preview-banner .ui-strong { flex:0 0 auto; min-height:22px; padding:0 7px; border-radius:6px; color:#fff; background:var(--warning); font-size:12px; line-height:22px; }.preview-banner text { font-size:12px; line-height:1.5; }
.orders-workspace,.orders-menu { min-width:0; }.menu-head,.order-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin:18px 0 10px; }.menu-head view>text,.menu-head .ui-strong,.order-head view>text,.order-head .ui-strong { display:block; }.menu-head view>text,.order-head view>text { color:var(--muted); font-size:12px; font-weight:500; }.menu-head .ui-strong,.order-head .ui-strong { margin-top:2px; color:var(--ink); font-size:16px; font-weight:600; }.menu-head button,.order-head button { min-height:34px; padding:0 10px; border-radius:6px; color:var(--ink-2); background:var(--surface-soft); font-size:12px; font-weight:500; }
.menu-list { display:flex; flex-direction:column; gap:0; padding:0 12px; border-radius:var(--radius-large); background:var(--surface); }.menu-entry { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:8px; padding:4px 0; border-bottom:1px solid var(--line); }.menu-entry:last-child { border-bottom:0; }.menu-entry :deep(.list-row) { border-bottom:0; }
.add-button { width:44px; min-height:44px; border-radius:var(--radius); color:#fff; background:var(--module-accent); font-size:12px; font-weight:500; }.add-button:active { background:var(--module-dark); transform:translateY(1px); }.add-button:disabled { color:var(--muted); background:var(--surface-soft); }.stepper { display:grid; grid-template-columns:44px 28px 44px; align-items:center; }.stepper button { width:44px; height:44px; border-radius:var(--radius); color:var(--module-dark); background:var(--module-soft); font-size:20px; }.stepper text { text-align:center; font-size:12px; font-weight:600; }
.just-added .stepper { animation:add-pop 360ms var(--ease-spring) both; }
.cart-panel { margin-top:14px; padding:16px; border:1px solid var(--module-line); border-radius:var(--radius-large); background:var(--module-soft); }.cart-title { display:flex; align-items:center; justify-content:space-between; gap:10px; }.cart-title text,.cart-title .ui-strong { display:block; }.cart-title text { color:var(--muted); font-size:12px; }.cart-title .ui-strong { margin-top:2px; color:var(--module-dark); font-size:16px; font-weight:600; }.cart-title button { min-height:34px; padding:0 6px; color:var(--danger); font-size:12px; font-weight:500; }.cart-lines { margin-top:10px; border-top:1px solid var(--module-line); }.cart-lines view { display:flex; justify-content:space-between; gap:8px; padding:10px 0; border-bottom:1px solid var(--module-line); color:var(--ink-2); font-size:12px; }.cart-empty { display:block; padding:18px 0; color:var(--muted); font-size:12px; }.submit-disabled { width:100%; min-height:44px; margin-top:10px; border-radius:var(--radius); color:var(--muted); background:rgba(255,255,255,.7); font-size:14px; font-weight:500; opacity:1; }
.order-list { display:flex; flex-direction:column; gap:10px; }.order-card { padding:14px; border:1px solid var(--line); border-radius:var(--radius-large); background:var(--surface); }.order-top { display:flex; justify-content:space-between; gap:10px; }.order-top view .ui-strong,.order-top view text { display:block; }.order-top .ui-strong { color:var(--ink); font-size:14px; font-weight:600; }.order-top view text { margin-top:3px; color:var(--muted); font-size:12px; }.order-top>text { align-self:flex-start; min-height:22px; padding:0 7px; border-radius:6px; color:var(--ink-2); background:var(--surface-soft); font-size:12px; line-height:22px; }.order-items { display:flex; flex-direction:column; gap:4px; margin:10px 0; padding:10px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); color:var(--ink-2); font-size:12px; }.pickup-row { display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:center; gap:10px; }.pickup-row view text,.pickup-row view .ui-strong { display:block; }.pickup-row view text { color:var(--muted); font-size:12px; }.pickup-row view .ui-strong { margin-top:2px; color:var(--ink); font-size:16px; font-weight:600; }.pickup-row button { min-height:34px; padding:0 9px; border-radius:6px; color:var(--ink); background:var(--surface-soft); font-size:12px; font-weight:500; }.pickup-row .ui-bold { color:var(--ink); font-size:14px; font-weight:600; }
.order-list { gap:0; padding:0 14px; border-radius:var(--radius-large); background:var(--surface); }.order-card { padding:16px 0; border:0; border-bottom:1px solid var(--line); border-radius:0; background:transparent; }.order-card:last-of-type { border-bottom:0; }
@keyframes add-pop { from { opacity:.5; transform:scale(.88); } 65% { transform:scale(1.05); } to { opacity:1; transform:none; } }
@media (min-width:600px) and (max-width:767px) { .menu-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); column-gap:16px; } }
@media (min-width:768px) { .orders-workspace { display:grid; grid-template-columns:minmax(0,1fr) 340px; gap:28px; align-items:start; }.cart-panel { position:sticky; top:72px; margin-top:18px; box-shadow:var(--shadow-soft); }.menu-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); column-gap:20px; }.order-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); column-gap:24px; } }
</style>
