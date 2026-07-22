<template>
  <sc-page-shell back :title="region?.name||'区域推荐'" :subtitle="region?.subtitle||'风味分区'" tone="explore">
    <sc-state-card v-if="!region" type="error" title="区域不存在" desc="返回区域列表重新选择。" />
    <template v-else>
      <view class="region-head" :class="region.tone">
        <image :src="summary?.heroDish?.imageUrl||'/static/food/hero-meal.svg'" mode="aspectFill" />
        <view class="head-copy"><text>{{ region.subtitle }}</text><text class="ui-strong">{{ region.name }}</text><text class="ui-small">{{ region.description }}</text></view>
        <view class="region-metrics"><view><text class="ui-strong">{{ summary?.count||0 }}</text><text>菜品</text></view><view><text class="ui-strong">{{ summary?.averageRating||'-' }}</text><text>均分</text></view><view><text class="ui-strong">{{ formatHeat(summary?.totalSales) }}</text><text>热度</text></view></view>
      </view>
      <view class="sort-block"><text>排序方式</text><sc-segmented-control v-model="sortBy" :options="sortOptions" block density="compact" /></view>
      <view class="dish-list"><sc-dish-card v-for="dish in dishes" :key="dish.id" :dish="dish" :location="locationLabel(dish)" :supply-status="supplyState(dish).label" :unavailable="!supplyState(dish).canOrder" @tap="openDish(dish.id)" /><sc-state-card v-if="!dishes.length" type="empty" title="该区域暂无菜品" desc="这里只显示数据库中的真实菜品，等待目录补充后会自动出现。" /></view>
    </template>
  </sc-page-shell>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getDishRegionIds, getRegionById, getRegionDishes, rankRegionDishes, summarizeRegions } from '../../domain/regionRecommendation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';
const store=useCanteenStore();const regionId=ref('');const sortBy=ref('forYou');const sortOptions=[{value:'forYou',label:'适合我'},{value:'rating',label:'评分'},{value:'hot',label:'热度'},{value:'price',label:'价格'}];const region=computed(()=>getRegionById(regionId.value));const ratingById=computed(()=>new Map((store.rankings.value.dishes||[]).map((dish)=>[String(dish.id),dish])));const summary=computed(()=>summarizeRegions(store.dishes.value,{ratingById:ratingById.value,preferences:store.dishPreferences.value}).find((item)=>item.id===regionId.value));const dishes=computed(()=>rankRegionDishes(getRegionDishes(regionId.value,store.dishes.value),{sortBy:sortBy.value,ratingById:ratingById.value,preferences:store.dishPreferences.value}));
onLoad(async(options)=>{regionId.value=String(options?.id||'');if(options?.sort&&sortOptions.some((item)=>item.value===options.sort))sortBy.value=options.sort;try{await store.refreshIfStale();if(!store.user.value)uni.reLaunch({url:'/pages/login/login'});}catch{}});
function formatHeat(value){const count=Number(value||0);return count>=1000?`${(count/1000).toFixed(1)}k`:String(count);}function locationLabel(dish){const stall=store.stalls.value.find((item)=>item.id===dish.stallId);const canteen=store.canteens.value.find((item)=>item.id===stall?.canteenId);return[canteen?.name,stall?.name].filter(Boolean).join(' · ')||'校园档口';}function supplyState(dish){const menu=store.todayMenu.value.dishes?.find((item)=>String(item.id)===String(dish.id));if(!menu)return{label:'非今日供应',canOrder:false};if(menu.supplyStatus==='sold_out')return{label:'今日售罄',canOrder:false};if(menu.supplyStatus==='limited')return{label:'库存紧张',canOrder:true};return{label:'今日可点',canOrder:true};}function openDish(id){uni.navigateTo({url:`/pages/dish-detail/dish-detail?id=${encodeURIComponent(id)}`});}
</script>

<style scoped>
.region-head { --flavor:#2f8a6a; position:relative; overflow:hidden; min-height:350rpx; border:3rpx solid var(--flavor); border-radius:var(--radius-large); color:#fff; background:var(--surface-soft); box-shadow:var(--shadow); }
.region-head.mint { --flavor:#27956e; }.region-head.coral { --flavor:#df624b; }.region-head.amber { --flavor:#d48a1d; }.region-head.sky { --flavor:#4386b7; }.region-head.lime { --flavor:#6e9835; }.region-head.violet { --flavor:#7a68a8; }
.region-head>image { position:absolute; inset:0; width:100%; height:100%; filter:brightness(.64); }
.head-copy { position:relative; z-index:1; padding:28rpx 24rpx 136rpx; }
.head-copy text,.head-copy .ui-strong,.head-copy .ui-small { display:block; }
.head-copy>text:first-child { display:inline-flex; align-items:center; width:max-content; min-height:40rpx; padding:0 10rpx; border-radius:8rpx; background:var(--flavor); font-size:22rpx; font-weight:600; opacity:1; }
.head-copy .ui-strong { margin-top:6rpx; font-size:38rpx; font-weight:600; }
.head-copy .ui-small { margin-top:8rpx; font-size:24rpx; line-height:1.5; opacity:.9; }
.region-metrics { position:absolute; right:0; bottom:0; left:0; z-index:2; display:grid; grid-template-columns:repeat(3,1fr); padding:16rpx; background:rgba(8,30,19,.72); }
.region-metrics view { text-align:center; }
.region-metrics .ui-strong,.region-metrics text { display:block; }
.region-metrics .ui-strong { font-size:28rpx; font-weight:600; }
.region-metrics text { margin-top:3rpx; font-size:22rpx; opacity:.78; }
.sort-block { margin:24rpx 0 16rpx; }
.sort-block>text { display:block; margin-bottom:8rpx; color:var(--ink-2); font-size:24rpx; font-weight:500; }
.dish-list { display:flex; flex-direction:column; gap:12rpx; }
</style>
