<template>
  <sc-page-shell back title="收藏与用餐记录" subtitle="订单完成后自动统计" tone="records">
    <view class="saved-workspace">
      <view class="saved-aside">
        <view class="saved-stats">
          <view><text class="ui-strong">{{ favoritePage.total||saved.favorites.length }}</text><text>收藏菜品</text></view>
          <view><text class="ui-strong">{{ eatenDishTotal }}</text><text>吃过菜品</text></view>
          <view><text class="ui-strong">{{ saved.totalEaten }}</text><text>累计吃过</text></view>
        </view>
      </view>
      <view class="saved-main">
        <sc-segmented-control v-model="activePanel" :options="panelOptions" block />
        <text v-if="message" class="message" :class="{ error:isError }">{{ message }}</text>

        <view v-if="activePanel==='favorites'" class="favorites-panel">
          <template v-if="saved.favorites.length">
            <sc-segmented-control v-model="favoriteGroupMode" :options="favoriteGroupOptions" block density="compact" />
            <view class="saved-groups">
              <view v-for="group in favoriteGroups" :key="group.id" class="saved-group">
                <view class="group-heading"><text class="ui-strong">{{ group.label }}</text><text>{{ group.items.length }} 道</text></view>
                <view class="saved-list">
                  <view v-for="dish in group.items" :key="dish.id" class="saved-entry">
                    <sc-list-row :title="dish.name" :description="locationLabel(dish)" :meta="dishPriceText(dish)" badge="已收藏" @tap="openDish(dish.id)" />
                    <view class="entry-actions"><button @tap="toggleFavorite(dish.id)"><view>取消收藏</view></button><button class="order-preview" @tap="openOrder(dish.id)"><view>到店预约</view></button></view>
                  </view>
                </view>
              </view>
            </view>
            <text v-if="favoritePage.hasMore" class="page-progress">继续上拉加载更多收藏</text>
          </template>
          <sc-state-card v-else type="empty" illustration="empty-saved" title="还没有收藏菜品" desc="在菜品详情、地区口味推荐或智能推荐中加入收藏。" action-text="去找菜" @action="openDishes" />
        </view>

        <view v-else class="history-list">
          <view v-for="dish in saved.eaten" :key="dish.id" class="history-row">
            <sc-list-row :title="dish.name" :description="`最近记录 ${formatDate(dish.lastEatenAt)} · 揭晓 ${dish.drawnCount||0} 次`" :meta="`${dish.eatenCount} 次`" @tap="openDish(dish.id)" />
            <button class="again-button" @tap="markEaten(dish.id)">补录一次</button>
          </view>
          <sc-state-card v-if="!saved.eaten.length" type="empty" illustration="empty-saved" title="还没有用餐记录" desc="订单完成后，购买的菜品会自动记录在这里。" action-text="浏览菜品" @action="openDishes" />
          <text v-else-if="eatenPage.hasMore" class="page-progress">继续上拉加载更多记录</text>
        </view>
      </view>
    </view>
  </sc-page-shell>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { onLoad, onReachBottom, onShow } from '@dcloudio/uni-app';
import { dishPriceText } from '../../domain/dishPresentation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store=useCanteenStore();
const panelOptions=[{value:'favorites',label:'收藏菜品'},{value:'history',label:'吃过统计'}];
const favoriteGroupOptions=[{value:'canteen',label:'按食堂'},{value:'category',label:'按类型'}];
const activePanel=ref('favorites');const favoriteGroupMode=ref('canteen');const message=ref('');const isError=ref(false);const loadingMore=ref(false);
const favoritePage=computed(()=>store.savedCatalog.value.favorite.page||{});const eatenPage=computed(()=>store.savedCatalog.value.eaten.page||{});
const saved=computed(()=>({
  favorites:store.savedCatalog.value.favorite.items.map((dish)=>({...dish,...(dish.preference||{})})),
  eaten:store.savedCatalog.value.eaten.items.map((dish)=>({...dish,...(dish.preference||{})})).filter((dish)=>Number(dish.eatenCount||0)>0).sort((left,right)=>Number(right.eatenCount||0)-Number(left.eatenCount||0)),
  totalEaten:store.savedCatalog.value.eaten.items.reduce((sum,dish)=>sum+Number(dish.preference?.eatenCount||0),0)
}));
const eatenDishTotal=computed(()=>saved.value.eaten.length?Number(eatenPage.value.total||saved.value.eaten.length):0);
const favoriteGroups=computed(()=>{const groups=new Map();for(const dish of saved.value.favorites){const label=favoriteGroupMode.value==='canteen'?canteenLabel(dish):categoryLabel(dish);const id=`${favoriteGroupMode.value}:${label}`;if(!groups.has(id))groups.set(id,{id,label,items:[]});groups.get(id).items.push(dish);}return[...groups.values()].sort((left,right)=>left.label.localeCompare(right.label,'zh-CN'));});
onLoad((options)=>{if(options?.panel==='history')activePanel.value='history';});
onShow(async()=>{try{await store.refreshIfStale();if(!store.user.value){uni.reLaunch({url:'/pages/login/login'});return;}await Promise.all([store.loadSavedCatalog('favorite'),store.loadSavedCatalog('eaten')]);}catch{}});
watch(activePanel,(panel)=>store.loadSavedCatalog(panel==='favorites'?'favorite':'eaten').catch(()=>{}));
onReachBottom(loadMore);
function locationLabel(dish){const stall=store.stalls.value.find((item)=>item.id===dish.stallId);const canteen=store.canteens.value.find((item)=>item.id===stall?.canteenId);return[canteen?.name,stall?.name].filter(Boolean).join(' · ')||'校园档口';}
function canteenLabel(dish){const stall=store.stalls.value.find((item)=>item.id===dish.stallId);const canteen=store.canteens.value.find((item)=>item.id===stall?.canteenId);return canteen?.displayName||canteen?.name||dish.canteenName||'其他食堂';}
function categoryLabel(dish){if(dish.catalogItemType==='beverage')return'饮品';if(dish.catalogItemType==='snack')return'小吃';return dish.catalogCategory||dish.category||'其他餐食';}
function formatDate(value){return value?String(value).slice(0,10):'暂无时间';}
function openDish(id){uni.navigateTo({url:`/pages/dish-detail/dish-detail?id=${encodeURIComponent(id)}`});}function openOrder(id){uni.navigateTo({url:`/pages/orders/orders?dish=${encodeURIComponent(id)}`});}function openDishes(){uni.switchTab({url:'/pages/dishes/dishes'});}
async function runAction(action,success){message.value='';isError.value=false;try{await action();message.value=success;}catch(error){message.value=error.message||'操作失败。';isError.value=true;}}
function toggleFavorite(id){return runAction(async()=>{await store.toggleFavorite(id);await store.loadSavedCatalog('favorite');},'已取消收藏。');}function markEaten(id){return runAction(async()=>{await store.markDishEaten(id);await store.loadSavedCatalog('eaten');},'已记录一次“吃过”。');}
async function loadMore(){const kind=activePanel.value==='favorites'?'favorite':'eaten';const page=store.savedCatalog.value[kind].page;if(loadingMore.value||!page?.hasMore)return;loadingMore.value=true;try{await store.loadSavedCatalog(kind,{page:Number(page.page||1)+1,pageSize:page.pageSize||20});}finally{loadingMore.value=false;}}
</script>

<style scoped>
.saved-workspace { display:grid; gap:16px; }
.saved-stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); border:1px solid var(--module-line); border-radius:var(--radius-large); background:var(--module-soft); }
.saved-stats view { position:relative; min-width:0; padding:12px 4px; text-align:center; }
.saved-stats view+view::before { position:absolute; top:10px; bottom:10px; left:0; width:1px; background:var(--line); content:''; }
.saved-stats .ui-strong,.saved-stats text { display:block; }
.saved-stats .ui-strong { color:var(--module-dark); font-size:16px; }
.saved-stats text { margin-top:3px; color:var(--muted); font-size:12px; }
.message { display:block; margin:10px 0; color:var(--ink-2); font-size:14px; }
.message.error { color:var(--danger); }
.page-progress { display:block; min-height:44px; color:var(--muted); font-size:12px; line-height:44px; text-align:center; }
.favorites-panel,.saved-groups { display:flex; flex-direction:column; gap:12px; margin-top:12px; }
.saved-group { overflow:hidden; border:1px solid var(--line); border-radius:var(--radius-large); background:var(--surface); }
.group-heading { display:flex; min-height:44px; align-items:center; justify-content:space-between; gap:12px; padding:0 12px; border-bottom:1px solid var(--line); }.group-heading .ui-strong { color:var(--ink); font-size:14px; }.group-heading>text:last-child { color:var(--muted); font-size:12px; }
.saved-list,.history-list { display:flex; flex-direction:column; gap:0; margin-top:12px; padding:0 12px; border-radius:var(--radius-large); background:var(--surface); }
.saved-group .saved-list { margin-top:0; border-radius:0; }
.saved-entry,.history-row { overflow:hidden; padding:0 0 8px; border-bottom:1px solid var(--line); background:transparent; }.saved-entry:last-of-type,.history-row:last-of-type { border-bottom:0; }
.entry-actions { display:grid; grid-template-columns:1fr 1.15fr; gap:6px; border-top:1px solid var(--line); padding-top:8px; }
.entry-actions button,.again-button { display:flex; min-height:44px; padding:0 8px; align-items:center; justify-content:center; border-radius:var(--radius); color:var(--ink-2); background:var(--surface-soft); font-size:12px; font-weight:500; }
.entry-actions .order-preview { color:#fff; background:var(--module-accent); }
.history-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:8px; padding-bottom:0; }
.again-button { min-width:84px; }
@media (min-width:768px) {
  .saved-workspace { grid-template-columns:280px minmax(0,1fr); gap:24px; align-items:start; }
  .saved-aside { position:sticky; top:72px; }
  .saved-stats { grid-template-columns:1fr; }
  .saved-stats view { display:flex; min-height:56px; padding:0 16px; align-items:center; justify-content:space-between; text-align:left; }
  .saved-stats view+view::before { top:0; right:12px; bottom:auto; left:12px; width:auto; height:1px; }
  .saved-stats text { margin-top:0; }
}
</style>
