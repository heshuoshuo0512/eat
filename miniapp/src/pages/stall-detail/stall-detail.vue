<template>
  <sc-page-shell back :title="stall?.name||'档口详情'" :subtitle="location" tone="explore">
    <sc-state-card v-if="loading" type="loading" title="正在读取档口菜品" />
    <sc-state-card v-else-if="!stall" type="error" title="档口不存在" desc="档口可能已调整或目录尚未同步。" />
    <template v-else>
      <view class="detail-workspace">
        <view class="stall-aside">
          <view class="stall-summary">
            <view class="stall-symbol">{{ stall.name.slice(0,1) }}</view>
            <view><text>{{ stall.category||'综合档口' }}</text><text class="ui-strong">{{ stall.name }}</text><text class="ui-small">{{ stall.floor||'楼层待补' }} · {{ stall.avgPrice?`${stall.avgPrice}元人均`:'人均待核验' }} · {{ stall.open===false?'暂停营业':'营业中' }}</text></view>
            <view class="score"><text class="ui-strong">{{ Number(stall.rating)>0?Number(stall.rating).toFixed(1):'暂无评分' }}</text><text>评分</text></view>
          </view>
          <text v-if="stall.description" class="description">{{ stall.description }}</text>
          <view v-if="childStalls.length" class="child-section"><view class="section-head"><text class="ui-strong">子档口</text><text>{{ childStalls.length }} 个窗口</text></view><view class="child-list"><sc-list-row v-for="item in childStalls" :key="item.id" icon-name="store" :title="item.name" :description="`${item.category||'综合档口'} · ${item.floor||stall.floor}`" :badge="`${dishesFor(item.id).length} 道菜`" @tap="openStall(item.id)" /></view></view>
        </view>
        <view class="dish-section"><view class="section-head"><text class="ui-strong">菜品目录</text><text>{{ displayedDishes.length }} 道菜</text></view><view class="dish-list"><sc-dish-card v-for="dish in displayedDishes" :key="dish.id" :dish="dish" :location="location" :supply-status="supplyState(dish).label" :unavailable="!supplyState(dish).canOrder" @tap="openDish(dish.id)" /><sc-state-card v-if="!displayedDishes.length" type="empty" title="暂无菜品" desc="等待该档口补充菜品信息。" /></view></view>
      </view>
    </template>
  </sc-page-shell>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { dishSupplyPresentation } from '../../domain/dishPresentation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';
const store=useCanteenStore();const stallId=ref('');const loading=ref(true);
const stall=computed(()=>store.stalls.value.find((item)=>String(item.id)===stallId.value)||null);const canteen=computed(()=>store.canteens.value.find((item)=>item.id===stall.value?.canteenId)||null);const parentCanteen=computed(()=>store.canteens.value.find((item)=>item.id===canteen.value?.parentId)||null);const childStalls=computed(()=>store.stalls.value.filter((item)=>String(item.parentId)===stallId.value));const displayedDishes=computed(()=>{const ids=new Set([stallId.value,...childStalls.value.map((item)=>item.id)]);return store.dishes.value.filter((dish)=>ids.has(String(dish.stallId)));});const location=computed(()=>[parentCanteen.value?.name,canteen.value?.name,stall.value?.floor].filter(Boolean).join(' · '));
onLoad(async(options)=>{stallId.value=String(options?.id||'');try{await store.refreshIfStale();if(!store.user.value)uni.reLaunch({url:'/pages/login/login'});}catch{}finally{loading.value=false;}});
function dishesFor(id){return store.dishes.value.filter((dish)=>dish.stallId===id);}function supplyState(dish){const menu=store.todayMenu.value.dishes?.find((item)=>String(item.id)===String(dish.id));return dishSupplyPresentation(dish,menu||null);}
function openStall(id){uni.navigateTo({url:`/pages/stall-detail/stall-detail?id=${encodeURIComponent(id)}`});}function openDish(id){uni.navigateTo({url:`/pages/dish-detail/dish-detail?id=${encodeURIComponent(id)}`});}
</script>

<style scoped>
.detail-workspace { display:grid; gap:24px; }
.stall-summary { display:grid; grid-template-columns:44px minmax(0,1fr) 64px; padding:16px; align-items:center; gap:12px; border:1px solid var(--module-line); border-radius:var(--radius-large); background:var(--module-soft); }
.stall-symbol { display:flex; width:44px; height:44px; align-items:center; justify-content:center; border-radius:var(--radius); color:#fff; background:var(--module-accent); font-size:16px; font-weight:600; }
.stall-summary>view:nth-child(2) { min-width:0; }
.stall-summary>view:nth-child(2) text,.stall-summary>view:nth-child(2) .ui-strong,.stall-summary>view:nth-child(2) .ui-small { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.stall-summary>view:nth-child(2) text { color:var(--muted); font-size:12px; font-weight:500; }
.stall-summary>view:nth-child(2) .ui-strong { margin-top:3px; color:var(--ink); font-size:16px; }
.stall-summary>view:nth-child(2) .ui-small { margin-top:3px; font-size:12px; }
.score { text-align:center; }
.score .ui-strong,.score text { display:block; }
.score .ui-strong { color:var(--ink); font-size:14px; }
.score text { color:var(--muted); font-size:12px; }
.description { display:block; margin-top:12px; color:var(--ink-2); font-size:14px; line-height:1.55; }
.child-section { margin-top:20px; }
.section-head { display:flex; min-height:44px; align-items:center; justify-content:space-between; gap:12px; margin-bottom:8px; }
.section-head text,.section-head .ui-strong { display:block; }
.section-head text { color:var(--muted); font-size:12px; }
.section-head .ui-strong { color:var(--ink); font-size:16px; }
.child-list { padding:0 12px; border:1px solid var(--line); border-radius:var(--radius-large); background:var(--surface); }
.dish-list { display:grid; gap:0; padding:0 12px; border-radius:var(--radius-large); background:var(--surface); }
@media (min-width:768px) {
  .detail-workspace { grid-template-columns:320px minmax(0,1fr); align-items:start; }
  .stall-aside { position:sticky; top:72px; }
  .dish-list { grid-template-columns:repeat(2,minmax(0,1fr)); column-gap:20px; }
}
</style>
