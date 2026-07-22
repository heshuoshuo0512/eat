<template>
  <sc-page-shell back title="收藏与吃过" subtitle="个人记录" tone="records">
    <view class="saved-stats">
      <view><text class="ui-strong">{{ saved.favorites.length }}</text><text>收藏菜品</text></view>
      <view><text class="ui-strong">{{ saved.eaten.length }}</text><text>吃过菜品</text></view>
      <view><text class="ui-strong">{{ saved.totalEaten }}</text><text>累计吃过</text></view>
    </view>
    <sc-segmented-control v-model="activePanel" :options="panelOptions" block />
    <text v-if="message" class="message" :class="{ error:isError }">{{ message }}</text>

    <view v-if="activePanel==='favorites'" class="saved-list">
      <view v-for="dish in saved.favorites" :key="dish.id" class="saved-entry">
        <sc-dish-card :dish="dish" :location="locationLabel(dish)" compact @tap="openDish(dish.id)" />
        <view class="entry-actions"><button @tap="toggleFavorite(dish.id)"><view>取消收藏</view></button><button @tap="markEaten(dish.id)"><view>记录吃过</view></button><button class="order-preview" @tap="openOrder(dish.id)"><view>点餐预览</view></button></view>
      </view>
      <sc-state-card v-if="!saved.favorites.length" type="empty" title="还没有收藏菜品" desc="在菜品详情、区域推荐或智能推荐中加入收藏。" action-text="去找菜" @action="openDishes" />
    </view>

    <view v-else class="history-list">
      <view v-for="dish in saved.eaten" :key="dish.id" class="history-row">
        <button class="history-main" @tap="openDish(dish.id)"><image :src="dish.imageUrl||'/static/food/bowl.svg'" mode="aspectFill" /><view><text class="ui-strong">{{ dish.name }}</text><text>最近记录 {{ formatDate(dish.lastEatenAt) }}</text><text class="ui-small">揭晓 {{ dish.drawnCount||0 }} 次</text></view><text class="ui-bold">{{ dish.eatenCount }}</text></button>
        <button class="again-button" @tap="markEaten(dish.id)"><view>再记一次</view></button>
      </view>
      <sc-state-card v-if="!saved.eaten.length" type="empty" title="还没有吃过记录" desc="在菜品详情中记录真实用餐，统计会出现在这里。" action-text="浏览菜品" @action="openDishes" />
    </view>
  </sc-page-shell>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { savedDishEntries } from '../../domain/studentDiscovery.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store=useCanteenStore();
const panelOptions=[{value:'favorites',label:'收藏菜品'},{value:'history',label:'吃过统计'}];
const activePanel=ref('favorites');const message=ref('');const isError=ref(false);
const saved=computed(()=>savedDishEntries(store.dishes.value,store.dishPreferences.value));
onLoad((options)=>{if(options?.panel==='history')activePanel.value='history';});
onShow(async()=>{try{await store.refreshIfStale();if(!store.user.value)uni.reLaunch({url:'/pages/login/login'});}catch{}});
function locationLabel(dish){const stall=store.stalls.value.find((item)=>item.id===dish.stallId);const canteen=store.canteens.value.find((item)=>item.id===stall?.canteenId);return[canteen?.name,stall?.name].filter(Boolean).join(' · ')||'校园档口';}
function formatDate(value){return value?String(value).slice(0,10):'暂无时间';}
function openDish(id){uni.navigateTo({url:`/pages/dish-detail/dish-detail?id=${encodeURIComponent(id)}`});}function openOrder(id){uni.navigateTo({url:`/pages/orders/orders?dish=${encodeURIComponent(id)}`});}function openDishes(){uni.switchTab({url:'/pages/dishes/dishes'});}
async function runAction(action,success){message.value='';isError.value=false;try{await action();message.value=success;}catch(error){message.value=error.message||'操作失败。';isError.value=true;}}
function toggleFavorite(id){return runAction(()=>store.toggleFavorite(id),'已取消收藏。');}function markEaten(id){return runAction(()=>store.markDishEaten(id),'已记录一次“吃过”。');}
</script>

<style scoped>
.saved-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:10rpx; margin-bottom:18rpx; }
.saved-stats view { min-width:0; padding:18rpx 6rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); text-align:center; }
.saved-stats .ui-strong,.saved-stats text { display:block; }
.saved-stats .ui-strong { color:var(--ink); font-size:32rpx; font-weight:600; }
.saved-stats text { margin-top:4rpx; color:var(--muted); font-size:22rpx; }
.message { display:block; margin:12rpx 0; color:var(--brand); font-size:24rpx; }
.message.error { color:var(--danger); }
.saved-list,.history-list { display:flex; flex-direction:column; gap:14rpx; margin-top:18rpx; }
.saved-entry { overflow:hidden; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); }
.saved-entry :deep(.dish-card) { border:0; border-bottom:1rpx solid var(--line); border-radius:0; }
.entry-actions { display:grid; grid-template-columns:1fr 1fr 1.15fr; gap:2rpx; padding:4rpx 8rpx; }
.entry-actions button { display:flex; align-items:center; justify-content:center; min-height:88rpx; padding:0 4rpx; color:var(--brand); background:transparent; font-size:22rpx; font-weight:500; }
.entry-actions button>view { display:flex; align-items:center; justify-content:center; width:100%; min-height:64rpx; padding:0 6rpx; border-radius:10rpx; background:var(--brand-soft); line-height:1.2; box-sizing:border-box; }
.entry-actions button:active>view { transform:scale(.98); }
.entry-actions .order-preview { color:#8b5d18; }
.entry-actions .order-preview>view { background:var(--rating-soft); }
.history-row { display:grid; grid-template-columns:minmax(0,1fr) 96rpx; gap:10rpx; padding:14rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); }
.history-main { display:grid; grid-template-columns:108rpx minmax(0,1fr) 58rpx; align-items:center; gap:14rpx; min-width:0; padding:0; background:transparent; text-align:left; }
.history-main image { width:108rpx; height:108rpx; border-radius:12rpx; background:var(--surface-soft); }
.history-main view { min-width:0; }
.history-main .ui-strong,.history-main text,.history-main .ui-small { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.history-main .ui-strong { color:var(--ink); font-size:26rpx; font-weight:600; }
.history-main text { margin-top:5rpx; color:var(--muted); font-size:22rpx; }
.history-main .ui-small { margin-top:3rpx; color:var(--ink-2); font-size:22rpx; }
.history-main .ui-bold { display:flex; align-items:center; justify-content:center; width:54rpx; height:54rpx; border-radius:50%; color:#fff; background:var(--brand); font-size:24rpx; font-weight:600; }
.again-button { display:flex; align-items:center; justify-content:center; align-self:center; min-width:104rpx; min-height:88rpx; padding:0 4rpx; color:var(--brand); background:transparent; font-size:22rpx; font-weight:500; }
.again-button>view { display:flex; align-items:center; justify-content:center; min-width:96rpx; min-height:64rpx; padding:0 8rpx; border-radius:10rpx; background:var(--brand-soft); box-sizing:border-box; }
</style>
