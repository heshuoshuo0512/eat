<template>
  <sc-page-shell back :title="region?.name||'地区口味推荐'" :subtitle="region?.subtitle||'地区风味'" tone="explore">
    <sc-state-card v-if="loading" type="loading" title="正在加载区域菜品" />
    <sc-state-card v-else-if="error" type="error" title="区域数据加载失败" :desc="error" />
    <sc-state-card v-else-if="!region" type="error" title="区域不存在" desc="返回区域列表重新选择。" />
    <template v-else>
      <view class="region-workspace">
        <view class="region-aside">
          <view class="region-head" :class="region.tone">
            <view class="head-copy"><text>{{ region.subtitle }}</text><text class="ui-strong">{{ region.name }}</text><text class="ui-small">{{ region.description }}</text></view>
            <view class="region-metrics"><view><text class="ui-strong">{{ summary?.count||0 }}</text><text>菜品</text></view><view><text class="ui-strong">{{ summary?.averageRating>0?summary.averageRating:'暂无评分' }}</text><text>均分</text></view><view><text class="ui-strong">{{ formatHeat(summary?.totalSales) }}</text><text>热度</text></view></view>
          </view>
          <view class="sort-block"><text>排序方式</text><sc-segmented-control v-model="sortBy" :options="sortOptions" block density="compact" /></view>
        </view>
        <view v-if="dishGroups.length" class="dish-groups">
          <view v-for="group in dishGroups" :key="group.id" class="dish-group">
            <view class="dish-group-heading"><view><text class="ui-strong">{{ group.label }}</text><text>{{ group.description }}</text></view><text>{{ group.items.length }} 道</text></view>
            <view class="dish-list"><sc-dish-card v-for="dish in group.items" :key="dish.id" :dish="dish" :location="locationLabel(dish)" :supply-status="supplyState(dish).label" :unavailable="!supplyState(dish).canOrder" @tap="openDish(dish.id)" /></view>
          </view>
        </view>
        <sc-state-card v-else type="empty" title="该区域暂无菜品" desc="这里只显示数据库中的真实菜品，等待目录补充后会自动出现。" />
      </view>
    </template>
  </sc-page-shell>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { dishSupplyPresentation } from '../../domain/dishPresentation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';
const store=useCanteenStore();const regionId=ref('');const itemType=ref('meal');const sortBy=ref('rating');const region=ref(null);const dishes=ref([]);const loading=ref(false);const error=ref('');const sortOptions=[{value:'rating',label:'评分'},{value:'hot',label:'热度'},{value:'price',label:'价格'}];const summary=computed(()=>region.value);
const dishGroups=computed(()=>{const groups=new Map();for(const dish of dishes.value){const label=String(dish.catalogCategory||'其他');if(!groups.has(label))groups.set(label,{id:label,label,description:'数据库中的原始分类',items:[]});groups.get(label).items.push(dish);}return [...groups.values()];});
async function loadDetail(){if(!regionId.value)return;loading.value=true;error.value='';try{const result=await store.loadCatalogRegionDishes(regionId.value,{itemType:itemType.value,page:1,pageSize:50,sort:sortBy.value});region.value=result.region||null;dishes.value=result.items||[];}catch(err){region.value=null;dishes.value=[];error.value=err.message||'请稍后重试';}finally{loading.value=false;}}
onLoad(async (options) => {
  regionId.value = String(options?.id || '');
  itemType.value = String(options?.itemType || 'meal');
  if (options?.sort && sortOptions.some((item) => item.value === options.sort)) sortBy.value = options.sort;
  try {
    await store.refreshIfStale();
    if (!store.user.value) {
      uni.reLaunch({ url: '/pages/login/login' });
      return;
    }
    await loadDetail();
  } catch (err) {
    error.value = err.message || '请稍后重试';
  }
});
watch(sortBy,loadDetail);
function formatHeat(value){const count=Number(value||0);return count>=1000?`${(count/1000).toFixed(1)}k`:String(count);}function locationLabel(dish){const stall=store.stalls.value.find((item)=>item.id===dish.stallId);const canteen=store.canteens.value.find((item)=>item.id===stall?.canteenId);return[canteen?.name,stall?.name].filter(Boolean).join(' · ')||'校园档口';}function supplyState(dish){const menu=store.todayMenu.value.dishes?.find((item)=>String(item.id)===String(dish.id));return dishSupplyPresentation(dish,menu||null);}function openDish(id){uni.navigateTo({url:`/pages/dish-detail/dish-detail?id=${encodeURIComponent(id)}`});}
</script>

<style scoped>
.region-workspace { display:grid; gap:16px; }
.region-head { padding:20px 16px; border:1px solid var(--module-line); border-radius:var(--radius-large); color:var(--ink); background:var(--module-soft); box-sizing:border-box; }
.head-copy text,.head-copy .ui-strong,.head-copy .ui-small { display:block; }
.head-copy>text:first-child { color:var(--muted); font-size:12px; font-weight:600; }
.head-copy .ui-strong { margin-top:4px; font-size:20px; }
.head-copy .ui-small { margin-top:6px; font-size:14px; line-height:1.5; }
.region-metrics { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); margin-top:16px; padding-top:12px; border-top:1px solid var(--line); }
.region-metrics view { text-align:center; }
.region-metrics .ui-strong,.region-metrics text { display:block; }
.region-metrics .ui-strong { font-size:14px; }
.region-metrics text { margin-top:3px; color:var(--muted); font-size:12px; }
.sort-block { margin-top:16px; }
.sort-block>text { display:block; margin:0 4px 7px; color:var(--ink-2); font-size:14px; font-weight:500; }
.dish-groups { display:flex; min-width:0; flex-direction:column; gap:14px; }
.dish-group { overflow:hidden; border:1px solid var(--line); border-radius:var(--radius-large); background:var(--surface); }
.dish-group-heading { display:flex; min-height:58px; align-items:center; justify-content:space-between; gap:12px; padding:8px 14px; border-bottom:1px solid var(--line); box-sizing:border-box; }.dish-group-heading view text { display:block; }.dish-group-heading .ui-strong { color:var(--ink); font-size:14px; }.dish-group-heading view text:last-child,.dish-group-heading>text { margin-top:3px; color:var(--muted); font-size:12px; }
.dish-list { display:grid; gap:0; padding:0 12px; background:var(--surface); }
@media (min-width:768px) {
  .region-workspace { grid-template-columns:300px minmax(0,1fr); gap:24px; align-items:start; }
  .region-aside { position:sticky; top:72px; }
  .dish-list { grid-template-columns:repeat(2,minmax(0,1fr)); column-gap:20px; }
}
</style>
