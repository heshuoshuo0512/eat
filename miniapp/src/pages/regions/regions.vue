<template>
  <sc-page-shell back title="区域推荐" subtitle="六种风味分区" tone="explore">
    <view class="region-intro"><text class="ui-strong">从风味开始选</text><text class="ui-small">按区域风味、菜系、口味和食材整理校内菜品。</text></view>
    <sc-state-card v-if="store.loading.value&&!store.loaded.value" type="loading" title="正在整理区域菜品" />
    <view v-else class="region-grid">
      <sc-list-row
        v-for="(region,index) in regions"
        :key="region.id"
        class="region-card"
        icon-name="location"
        :title="region.name"
        :description="`${region.subtitle} · ${region.description}`"
        :meta="region.averageRating>0?`${region.averageRating} 分`:'暂无评分'"
        :badge="`${region.count} 道`"
        :style="entryStyle(index)"
        @tap="openRegion(region.id)"
      />
    </view>
  </sc-page-shell>
</template>

<script setup>
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { summarizeRegions } from '../../domain/regionRecommendation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';
const store=useCanteenStore();const ratingById=computed(()=>new Map((store.rankings.value.dishes||[]).map((dish)=>[String(dish.id),dish])));const regions=computed(()=>summarizeRegions(store.dishes.value,{ratingById:ratingById.value,preferences:store.dishPreferences.value}));
onShow(async()=>{try{await store.refreshIfStale();if(!store.user.value)uni.reLaunch({url:'/pages/login/login'});}catch{}});function entryStyle(index){return store.motionReduced.value?{}:{animationDelay:`${index*60}ms`};}function openRegion(id){uni.navigateTo({url:`/pages/region-detail/region-detail?id=${encodeURIComponent(id)}`});}
</script>

<style scoped>
.region-intro { margin-bottom:16px; }
.region-intro .ui-strong { color:var(--ink); font-size:16px; }
.region-intro .ui-small { margin-top:4px; font-size:14px; line-height:1.5; }
.region-grid { padding:0 12px; border:1px solid var(--line); border-radius:var(--radius-large); background:var(--surface); }
.region-card { animation:region-in 200ms ease both; }
@keyframes region-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
@media (min-width:768px) {
  .region-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); column-gap:24px; }
  .region-card:nth-last-child(2):nth-child(odd) { border-bottom:0; }
}
</style>
