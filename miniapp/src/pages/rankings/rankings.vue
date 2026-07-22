<template>
  <sc-page-shell back title="校园排行榜" subtitle="评分与评价热度" tone="explore">
    <view class="podium" v-if="activeItems.length">
      <view v-for="item in podiumItems" :key="item.id" :class="`place-${item.place}`" @tap="openItem(item)"><text>{{ item.place }}</text><image :src="item.imageUrl||'/static/food/bowl.svg'" mode="aspectFill" /><text class="ui-strong">{{ item.name }}</text><text class="ui-small">{{ rating(item) }} 分</text></view>
    </view>
    <sc-segmented-control v-model="activeType" :options="typeOptions" block />
    <scroll-view v-if="activeType==='dishes'" class="filter-scroll" scroll-x enable-flex><view class="filter-row"><button v-for="option in cuisineOptions" :key="option" :class="{active:cuisine===option}" @tap="cuisine=option"><view>{{ option }}</view></button></view></scroll-view>
    <sc-state-card v-if="store.loading.value&&!store.loaded.value" type="loading" title="正在计算排行榜" />
    <view v-else class="rank-list">
      <button v-for="(item,index) in activeItems" :key="item.id" class="rank-row" :style="entryStyle(index)" @tap="openItem(item)">
        <text class="rank-number" :class="{top:index<3}">{{ index+1 }}</text>
        <image :src="item.imageUrl||itemHero(item)?.imageUrl||'/static/food/bowl.svg'" mode="aspectFill" />
        <view><text class="ui-strong">{{ item.name }}</text><text>{{ itemSubtitle(item) }}</text><text class="ui-small">{{ itemMeta(item) }}</text></view>
        <view class="rank-score"><text class="ui-strong">{{ rating(item) }}</text><text>综合分</text></view><text class="ui-bold">›</text>
      </button>
      <sc-state-card v-if="!activeItems.length" type="empty" title="暂无排行数据" desc="评价数据积累后会显示在这里。" />
    </view>
  </sc-page-shell>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { useCanteenStore } from '../../stores/canteenStore.js';
const store=useCanteenStore();const typeOptions=[{value:'dishes',label:'菜品'},{value:'stalls',label:'档口'},{value:'canteens',label:'食堂'}];const activeType=ref('dishes');const cuisine=ref('全部');
const cuisineOptions=computed(()=>['全部',...new Set((store.rankings.value.dishes||[]).map((item)=>item.cuisine).filter(Boolean))]);
const activeItems=computed(()=>{const list=store.rankings.value[activeType.value]||[];if(activeType.value!=='dishes'||cuisine.value==='全部')return list;return list.filter((item)=>item.cuisine===cuisine.value);});
const podiumItems=computed(()=>activeItems.value.slice(0,3).map((item,index)=>({...item,place:index+1})));onShow(async()=>{try{await store.refreshIfStale();if(!store.user.value)uni.reLaunch({url:'/pages/login/login'});}catch{}});onPullDownRefresh(async()=>{try{await store.load(true);}catch{}finally{uni.stopPullDownRefresh();}});
function rating(item){return Number(item.computedRating??item.rankScore??item.rating??0).toFixed(1);}function stallForDish(item){return store.stalls.value.find((stall)=>stall.id===item.stallId);}function canteenForStall(item){return store.canteens.value.find((canteen)=>canteen.id===item.canteenId);}function itemSubtitle(item){if(activeType.value==='dishes'){const stall=stallForDish(item);return[item.cuisine,stall?.name].filter(Boolean).join(' · ');}if(activeType.value==='stalls'){const canteen=canteenForStall(item);return[canteen?.name,item.floor,item.category].filter(Boolean).join(' · ');}const parent=store.canteens.value.find((canteen)=>canteen.id===item.parentId);return[parent?.name,item.location].filter(Boolean).join(' · ')||'校内食堂';}
function itemMeta(item){if(activeType.value==='dishes')return`${item.computedReviewCount??item.reviewCount??0} 条评价 · ¥${item.price}`;if(activeType.value==='stalls')return`${item.dishCount??store.dishes.value.filter((dish)=>dish.stallId===item.id).length} 道菜 · ¥${item.avgPrice||'-'} 人均`;return`${item.stallCount??store.stalls.value.filter((stall)=>stall.canteenId===item.id).length} 个档口`;}
function itemHero(item){if(activeType.value==='dishes')return item;let stallIds;if(activeType.value==='stalls')stallIds=new Set([item.id,...store.stalls.value.filter((stall)=>stall.parentId===item.id).map((stall)=>stall.id)]);else stallIds=new Set(store.stalls.value.filter((stall)=>stall.canteenId===item.id).map((stall)=>stall.id));return store.dishes.value.find((dish)=>stallIds.has(dish.stallId)&&dish.imageUrl);}
function entryStyle(index){return store.motionReduced.value?{}:{animationDelay:`${Math.min(index,8)*45}ms`};}function openItem(item){if(activeType.value==='dishes')uni.navigateTo({url:`/pages/dish-detail/dish-detail?id=${encodeURIComponent(item.id)}`});else if(activeType.value==='stalls')uni.navigateTo({url:`/pages/stall-detail/stall-detail?id=${encodeURIComponent(item.id)}`});else uni.navigateTo({url:`/pages/canteen-detail/canteen-detail?id=${encodeURIComponent(item.id)}`});}
</script>

<style scoped>
.podium { display:flex; align-items:flex-end; justify-content:center; gap:10rpx; min-height:246rpx; margin-bottom:20rpx; padding:20rpx 14rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); }
.podium>view { position:relative; display:flex; flex:1; min-width:0; flex-direction:column; align-items:center; justify-content:flex-end; padding:16rpx 8rpx; border-radius:12rpx; background:var(--surface-soft); }
.podium .place-1 { order:2; min-height:194rpx; background:var(--rating-soft); }
.podium .place-2 { order:1; min-height:168rpx; }
.podium .place-3 { order:3; min-height:150rpx; background:var(--danger-soft); }
.podium>view>text { position:absolute; top:8rpx; left:8rpx; display:flex; align-items:center; justify-content:center; width:38rpx; height:38rpx; border-radius:50%; color:#fff; background:var(--brand); font-size:22rpx; font-weight:600; }
.podium image { width:82rpx; height:82rpx; border-radius:50%; background:var(--surface-soft); }
.podium .ui-strong { max-width:100%; margin-top:8rpx; overflow:hidden; color:var(--ink); font-size:22rpx; font-weight:600; white-space:nowrap; text-overflow:ellipsis; }
.podium .ui-small { margin-top:3rpx; color:#966218; font-size:22rpx; }
.filter-scroll { width:100%; margin:4rpx 0 8rpx; white-space:nowrap; }
.filter-row { display:flex; align-items:center; gap:4rpx; width:max-content; padding-right:20rpx; }
.filter-row button { display:flex; align-items:center; justify-content:center; min-height:88rpx; padding:0 4rpx; color:var(--ink-2); background:transparent; font-size:24rpx; font-weight:500; }
.filter-row button>view { display:flex; align-items:center; justify-content:center; min-height:60rpx; padding:0 16rpx; border:1rpx solid var(--line); border-radius:10rpx; background:var(--surface); box-sizing:border-box; }
.filter-row button.active>view { color:#fff; border-color:var(--brand); background:var(--brand); }
.rank-list { display:flex; flex-direction:column; gap:10rpx; margin-top:18rpx; }
.rank-row { display:grid; grid-template-columns:44rpx 88rpx minmax(0,1fr) 70rpx 18rpx; align-items:center; gap:12rpx; width:100%; min-height:122rpx; padding:14rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); text-align:left; animation:rank-in 220ms ease both; }
.rank-row:active { transform:scale(.985); background:#fafcfa; }
.rank-number { display:flex; align-items:center; justify-content:center; width:40rpx; height:40rpx; border-radius:50%; color:var(--ink-2); background:var(--surface-soft); font-size:22rpx; font-weight:600; }
.rank-number.top { color:#fff; background:var(--rating); }
.rank-row>image { width:88rpx; height:88rpx; border-radius:12rpx; background:var(--surface-soft); }
.rank-row>view:nth-child(3) { min-width:0; }
.rank-row>view:nth-child(3) .ui-strong,.rank-row>view:nth-child(3) text,.rank-row>view:nth-child(3) .ui-small { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.rank-row>view:nth-child(3) .ui-strong { color:var(--ink); font-size:26rpx; font-weight:600; }
.rank-row>view:nth-child(3) text,.rank-row>view:nth-child(3) .ui-small { margin-top:3rpx; color:var(--muted); font-size:22rpx; }
.rank-score { text-align:center; }
.rank-score .ui-strong,.rank-score text { display:block; }
.rank-score .ui-strong { color:#966218; font-size:26rpx; font-weight:600; }
.rank-score text { color:var(--muted); font-size:22rpx; }
.rank-row>.ui-bold { color:#97a29b; font-size:30rpx; }
@keyframes rank-in { from { opacity:0; transform:translateY(8rpx); } to { opacity:1; transform:none; } }
</style>
