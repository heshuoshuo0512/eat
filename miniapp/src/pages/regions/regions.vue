<template>
  <sc-page-shell back title="区域推荐" subtitle="六种风味分区" tone="explore">
    <view class="region-intro"><text>从风味开始选</text><text class="ui-strong">换一种口味，也能贴合你的档案</text><text class="ui-small">优先读取菜品区域风味字段，缺失时再按菜系、口味、标签和食材归类。</text></view>
    <sc-state-card v-if="store.loading.value&&!store.loaded.value" type="loading" title="正在整理区域菜品" />
    <view v-else class="region-grid">
      <button v-for="(region,index) in regions" :key="region.id" class="region-card" :class="region.tone" :style="entryStyle(index)" @tap="openRegion(region.id)">
        <image :src="region.heroDish?.imageUrl||'/static/food/hero-meal.svg'" mode="aspectFill" />
        <view class="image-shade"></view>
        <view class="region-copy"><text>{{ region.subtitle }}</text><text class="ui-strong">{{ region.name }}</text><text class="ui-small">{{ region.description }}</text><view><text class="ui-bold">{{ region.count }} 道</text><text class="ui-bold">{{ region.averageRating||'-' }} 分</text></view></view>
      </button>
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
.region-intro { margin-bottom:20rpx; padding:22rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); }
.region-intro text,.region-intro .ui-strong,.region-intro .ui-small { display:block; }
.region-intro text { color:var(--brand); font-size:22rpx; font-weight:500; }
.region-intro .ui-strong { margin-top:5rpx; color:var(--ink); font-size:30rpx; font-weight:600; line-height:1.35; }
.region-intro .ui-small { margin-top:7rpx; color:var(--muted); font-size:24rpx; line-height:1.5; }
.region-grid { display:grid; grid-template-columns:1fr 1fr; gap:14rpx; }
.region-card { --flavor:#2f8a6a; --flavor-glow:rgba(47,138,106,.24); position:relative; overflow:hidden; width:100%; height:320rpx; padding:0; border:2rpx solid var(--flavor); border-radius:var(--radius); background:var(--surface-soft); text-align:left; box-shadow:var(--shadow-soft); animation:region-in 220ms ease both; }
.region-card::after { position:absolute; inset:8rpx; z-index:2; border:1rpx solid rgba(255,255,255,.34); border-radius:12rpx; pointer-events:none; content:''; }
.region-card.mint { --flavor:#27956e; --flavor-glow:rgba(39,149,110,.32); }
.region-card.coral { --flavor:#df624b; --flavor-glow:rgba(223,98,75,.38); }
.region-card.amber { --flavor:#d48a1d; --flavor-glow:rgba(212,138,29,.4); }
.region-card.sky { --flavor:#4386b7; --flavor-glow:rgba(67,134,183,.36); }
.region-card.lime { --flavor:#6e9835; --flavor-glow:rgba(110,152,53,.36); }
.region-card.violet { --flavor:#7a68a8; --flavor-glow:rgba(122,104,168,.36); }
.region-card:active { transform:scale(.985); }
.region-card image,.image-shade { position:absolute; inset:0; width:100%; height:100%; }
.region-card image { transition:transform 200ms ease; }
.region-card:active image { transform:scale(1.02); }
.image-shade { background:linear-gradient(145deg,var(--flavor-glow),rgba(9,24,16,.02) 42%),linear-gradient(180deg,rgba(9,24,16,.02),rgba(9,31,20,.9)); }
.region-copy { position:absolute; right:0; bottom:0; left:0; padding:18rpx; color:#fff; }
.region-copy>text,.region-copy>.ui-strong,.region-copy>.ui-small { display:block; }
.region-copy>text { display:inline-flex; align-items:center; width:max-content; min-height:38rpx; padding:0 9rpx; border-radius:8rpx; background:var(--flavor); font-size:22rpx; font-weight:600; opacity:1; }
.region-copy>.ui-strong { margin-top:4rpx; font-size:28rpx; font-weight:600; }
.region-copy>.ui-small { min-height:60rpx; margin-top:5rpx; overflow:hidden; font-size:22rpx; line-height:1.4; opacity:.88; }
.region-copy>view { display:flex; gap:8rpx; margin-top:8rpx; }
.region-copy .ui-bold { min-height:36rpx; padding:0 8rpx; border-radius:8rpx; background:rgba(255,255,255,.18); font-size:22rpx; font-weight:400; line-height:36rpx; }
@keyframes region-in { from { opacity:0; transform:translateY(8rpx); } to { opacity:1; transform:none; } }
</style>
