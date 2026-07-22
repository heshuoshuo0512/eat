<template>
  <sc-page-shell back :title="stall?.name||'档口详情'" :subtitle="location" tone="explore">
    <sc-state-card v-if="loading" type="loading" title="正在读取档口菜品" />
    <sc-state-card v-else-if="!stall" type="error" title="档口不存在" desc="档口可能已调整或目录尚未同步。" />
    <template v-else>
      <view class="stall-summary">
        <view class="stall-symbol">{{ stall.name.slice(0,1) }}</view>
        <view><text>{{ stall.category||'综合档口' }}</text><text class="ui-strong">{{ stall.name }}</text><text class="ui-small">{{ stall.floor||'楼层待补' }} · ¥{{ stall.avgPrice||'-' }} 人均 · {{ stall.open===false?'暂停营业':'营业中' }}</text></view>
        <view class="score"><text class="ui-strong">{{ Number(stall.rating||0).toFixed(1) }}</text><text>评分</text></view>
      </view>
      <text v-if="stall.description" class="description">{{ stall.description }}</text>

      <view v-if="childStalls.length" class="child-section"><view class="section-head"><text>子档口</text><text class="ui-strong">{{ childStalls.length }} 个窗口</text></view><view class="child-list"><button v-for="item in childStalls" :key="item.id" @tap="openStall(item.id)"><view><text class="ui-strong">{{ item.name }}</text><text>{{ item.category||'综合档口' }} · {{ item.floor||stall.floor }}</text><text class="ui-small">{{ dishesFor(item.id).length }} 道菜</text></view><text class="ui-bold">›</text></button></view></view>

      <view class="dish-section"><view class="section-head"><text>菜品目录</text><text class="ui-strong">{{ displayedDishes.length }} 道菜</text></view><view class="dish-list"><sc-dish-card v-for="dish in displayedDishes" :key="dish.id" :dish="dish" :location="location" :supply-status="supplyState(dish).label" :unavailable="!supplyState(dish).canOrder" @tap="openDish(dish.id)" /><sc-state-card v-if="!displayedDishes.length" type="empty" title="暂无菜品" desc="等待该档口补充菜品信息。" /></view></view>
    </template>
  </sc-page-shell>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useCanteenStore } from '../../stores/canteenStore.js';
const store=useCanteenStore();const stallId=ref('');const loading=ref(true);
const stall=computed(()=>store.stalls.value.find((item)=>String(item.id)===stallId.value)||null);const canteen=computed(()=>store.canteens.value.find((item)=>item.id===stall.value?.canteenId)||null);const parentCanteen=computed(()=>store.canteens.value.find((item)=>item.id===canteen.value?.parentId)||null);const childStalls=computed(()=>store.stalls.value.filter((item)=>String(item.parentId)===stallId.value));const displayedDishes=computed(()=>{const ids=new Set([stallId.value,...childStalls.value.map((item)=>item.id)]);return store.dishes.value.filter((dish)=>ids.has(String(dish.stallId)));});const location=computed(()=>[parentCanteen.value?.name,canteen.value?.name,stall.value?.floor].filter(Boolean).join(' · '));
onLoad(async(options)=>{stallId.value=String(options?.id||'');try{await store.refreshIfStale();if(!store.user.value)uni.reLaunch({url:'/pages/login/login'});}catch{}finally{loading.value=false;}});
function dishesFor(id){return store.dishes.value.filter((dish)=>dish.stallId===id);}function supplyState(dish){const menu=store.todayMenu.value.dishes?.find((item)=>String(item.id)===String(dish.id));if(!menu)return{label:'非今日供应',canOrder:false};if(menu.supplyStatus==='sold_out')return{label:'今日售罄',canOrder:false};if(menu.supplyStatus==='limited')return{label:'库存紧张',canOrder:true};return{label:'今日可点',canOrder:true};}
function openStall(id){uni.navigateTo({url:`/pages/stall-detail/stall-detail?id=${encodeURIComponent(id)}`});}function openDish(id){uni.navigateTo({url:`/pages/dish-detail/dish-detail?id=${encodeURIComponent(id)}`});}
</script>

<style scoped>
.stall-summary { display:grid; grid-template-columns:80rpx minmax(0,1fr) 72rpx; align-items:center; gap:16rpx; padding:22rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); }
.stall-symbol { display:flex; align-items:center; justify-content:center; width:80rpx; height:80rpx; border-radius:var(--radius); color:#fff; background:var(--brand); font-size:30rpx; font-weight:600; }
.stall-summary>view:nth-child(2) { min-width:0; }
.stall-summary>view:nth-child(2) text,.stall-summary>view:nth-child(2) .ui-strong,.stall-summary>view:nth-child(2) .ui-small { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.stall-summary>view:nth-child(2) text { color:var(--brand); font-size:22rpx; font-weight:500; }
.stall-summary>view:nth-child(2) .ui-strong { margin-top:4rpx; color:var(--ink); font-size:30rpx; font-weight:600; }
.stall-summary>view:nth-child(2) .ui-small { margin-top:4rpx; color:var(--muted); font-size:22rpx; }
.score { text-align:center; }
.score .ui-strong,.score text { display:block; }
.score .ui-strong { color:#966218; font-size:28rpx; font-weight:600; }
.score text { color:var(--muted); font-size:22rpx; }
.description { display:block; margin-top:14rpx; color:var(--ink-2); font-size:24rpx; line-height:1.55; }
.child-section,.dish-section { margin-top:30rpx; }
.section-head { margin-bottom:14rpx; }
.section-head text,.section-head .ui-strong { display:block; }
.section-head text { color:var(--brand); font-size:22rpx; font-weight:500; }
.section-head .ui-strong { margin-top:3rpx; color:var(--ink); font-size:30rpx; font-weight:600; }
.child-list { display:grid; grid-template-columns:1fr 1fr; gap:12rpx; }
.child-list button { display:flex; align-items:center; gap:10rpx; min-width:0; min-height:116rpx; padding:14rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); text-align:left; }
.child-list button:active { transform:scale(.985); background:#fafcfa; }
.child-list view { flex:1; min-width:0; }
.child-list .ui-strong,.child-list text,.child-list .ui-small { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.child-list .ui-strong { color:var(--ink); font-size:24rpx; font-weight:600; }
.child-list text,.child-list .ui-small { margin-top:4rpx; color:var(--muted); font-size:22rpx; }
.child-list .ui-bold { color:#97a29b; font-size:30rpx; }
.dish-list { display:flex; flex-direction:column; gap:12rpx; }
</style>
