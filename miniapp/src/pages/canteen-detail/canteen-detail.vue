<template>
  <sc-page-shell back :title="canteen?.name||'食堂详情'" subtitle="楼层与档口" tone="explore">
    <sc-state-card v-if="loading" type="loading" title="正在读取食堂信息" />
    <sc-state-card v-else-if="!canteen" type="error" title="食堂不存在" desc="该食堂可能已下线或目录尚未同步。" action-text="返回导航" @action="backToCanteens" />
    <template v-else>
      <view class="canteen-hero">
        <image :src="canteen.imageUrl||heroDish?.imageUrl||'/static/food/hero-meal.svg'" mode="aspectFill" />
        <view class="hero-shade"></view>
        <view class="hero-copy"><text>{{ canteen.location||'校内食堂' }}</text><text class="ui-strong">{{ canteen.name }}</text><text class="ui-small">{{ canteen.hours||'营业时间待更新' }}</text></view>
        <text class="crowd" :class="crowdState.className">{{ crowdState.label }}</text>
      </view>
      <text v-if="canteen.description" class="canteen-description">{{ canteen.description }}</text>
      <view v-if="canteen.tags?.length" class="tag-row"><text v-for="tag in canteen.tags" :key="tag">{{ tag }}</text></view>

      <view v-if="children.length" class="section-block">
        <view class="section-head"><view><text>分区导航</text><text class="ui-strong">{{ children.length }} 个子食堂</text></view></view>
        <view class="sub-list"><button v-for="item in children" :key="item.id" @tap="openCanteen(item.id)"><image :src="item.imageUrl||childHero(item)?.imageUrl||'/static/food/bowl.svg'" mode="aspectFill" /><view><text class="ui-strong">{{ item.name }}</text><text>{{ item.location||canteen.name }}</text><text class="ui-small">{{ stallCount(item.id) }} 个档口</text></view><text class="ui-bold">›</text></button></view>
      </view>

      <view v-if="directStalls.length" class="section-block">
        <view class="section-head"><view><text>档口目录</text><text class="ui-strong">{{ directStalls.length }} 个档口</text></view><button @tap="openReviews">查看评价</button></view>
        <view v-for="group in floorGroups" :key="group.floor" class="floor-group"><text class="floor-label">{{ group.floor }}</text><button v-for="stall in group.stalls" :key="stall.id" class="stall-row" @tap="openStall(stall.id)"><view class="stall-mark">{{ stall.name.slice(0,1) }}</view><view><text class="ui-strong">{{ stall.name }}</text><text>{{ stall.category||'综合档口' }} · ¥{{ stall.avgPrice||'-' }} 人均</text><text class="ui-small">{{ dishCount(stall.id) }} 道菜 · {{ stall.open===false?'暂停营业':'营业中' }}</text></view><view class="stall-score"><text class="ui-strong">{{ Number(stall.rating||0).toFixed(1) }}</text><text>评分</text></view><text class="ui-bold">›</text></button></view>
      </view>
      <sc-state-card v-if="!children.length&&!directStalls.length" type="empty" title="暂无档口" desc="等待档口目录同步。" />
    </template>
  </sc-page-shell>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useCanteenStore } from '../../stores/canteenStore.js';
const store=useCanteenStore();const canteenId=ref('');const loading=ref(true);
const canteen=computed(()=>store.canteens.value.find((item)=>String(item.id)===canteenId.value)||null);const children=computed(()=>store.canteens.value.filter((item)=>String(item.parentId)===canteenId.value));const directStalls=computed(()=>store.stalls.value.filter((item)=>String(item.canteenId)===canteenId.value&&!item.parentId));
const floorGroups=computed(()=>{const map=new Map();for(const stall of directStalls.value){const floor=stall.floor||'其他';map.set(floor,[...(map.get(floor)||[]),stall]);}return[...map.entries()].map(([floor,stalls])=>({floor,stalls}));});
const heroDish=computed(()=>{const stallIds=new Set(store.stalls.value.filter((item)=>String(item.canteenId)===canteenId.value).map((item)=>item.id));return store.dishes.value.find((dish)=>stallIds.has(dish.stallId)&&dish.imageUrl)||null;});
const crowdState=computed(()=>{const value=Number(canteen.value?.crowdLevel||0);if(value>=70)return{label:'当前人流较高',className:'hot'};if(value>=45)return{label:'当前人流适中',className:'medium'};return{label:'当前相对空闲',className:'calm'};});
onLoad(async(options)=>{canteenId.value=String(options?.id||'');try{await store.refreshIfStale();if(!store.user.value)uni.reLaunch({url:'/pages/login/login'});}catch{}finally{loading.value=false;}});
function stallCount(id){return store.stalls.value.filter((item)=>item.canteenId===id&&!item.parentId).length;}function dishCount(stallId){const ids=new Set([stallId,...store.stalls.value.filter((item)=>item.parentId===stallId).map((item)=>item.id)]);return store.dishes.value.filter((dish)=>ids.has(dish.stallId)).length;}
function childHero(item){const stallIds=new Set(store.stalls.value.filter((stall)=>stall.canteenId===item.id).map((stall)=>stall.id));return store.dishes.value.find((dish)=>stallIds.has(dish.stallId)&&dish.imageUrl);}
function openCanteen(id){uni.navigateTo({url:`/pages/canteen-detail/canteen-detail?id=${encodeURIComponent(id)}`});}function openStall(id){uni.navigateTo({url:`/pages/stall-detail/stall-detail?id=${encodeURIComponent(id)}`});}function backToCanteens(){uni.redirectTo({url:'/pages/canteens/canteens'});}function openReviews(){store.openCommunitySection('reviews');uni.switchTab({url:'/pages/community/community'});}
</script>

<style scoped>
.canteen-hero { position:relative; overflow:hidden; height:330rpx; border-radius:var(--radius-large); color:#fff; background:var(--surface-soft); box-shadow:var(--shadow); }
.canteen-hero image,.hero-shade { position:absolute; inset:0; width:100%; height:100%; }
.hero-shade { background:linear-gradient(180deg,rgba(8,25,17,.02),rgba(8,29,19,.86)); }
.hero-copy { position:absolute; right:0; bottom:0; left:0; padding:24rpx; }
.hero-copy text,.hero-copy .ui-strong,.hero-copy .ui-small { display:block; }
.hero-copy text { font-size:22rpx; opacity:.8; }
.hero-copy .ui-strong { margin-top:5rpx; font-size:36rpx; font-weight:600; }
.hero-copy .ui-small { margin-top:5rpx; font-size:24rpx; opacity:.88; }
.crowd { position:absolute; top:14rpx; left:14rpx; min-height:40rpx; padding:0 10rpx; border-radius:8rpx; font-size:22rpx; font-weight:500; line-height:40rpx; }
.crowd.calm { background:rgba(35,122,87,.92); }.crowd.medium { background:rgba(213,139,34,.94); }.crowd.hot { background:rgba(217,99,76,.94); }
.canteen-description { display:block; margin-top:16rpx; color:var(--ink-2); font-size:24rpx; line-height:1.55; }
.tag-row { display:flex; flex-wrap:wrap; gap:8rpx; margin-top:12rpx; }
.tag-row text { min-height:40rpx; padding:0 10rpx; border-radius:8rpx; color:var(--brand); background:var(--brand-soft); font-size:22rpx; line-height:40rpx; }
.section-block { margin-top:30rpx; }
.section-head { display:flex; align-items:flex-end; justify-content:space-between; gap:12rpx; margin-bottom:14rpx; }
.section-head view>text,.section-head .ui-strong { display:block; }
.section-head view>text { color:var(--brand); font-size:22rpx; font-weight:500; }
.section-head .ui-strong { margin-top:3rpx; color:var(--ink); font-size:30rpx; font-weight:600; }
.section-head button { display:flex; align-items:center; justify-content:center; min-height:60rpx; padding:0 8rpx; color:var(--brand); background:transparent; font-size:24rpx; font-weight:500; }
.sub-list { display:grid; grid-template-columns:1fr 1fr; gap:12rpx; }
.sub-list button { display:grid; grid-template-columns:84rpx minmax(0,1fr) auto; align-items:center; gap:10rpx; min-width:0; min-height:124rpx; padding:12rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); text-align:left; }
.sub-list button:active { transform:scale(.985); background:#fafcfa; }
.sub-list image { width:84rpx; height:84rpx; border-radius:12rpx; background:var(--surface-soft); }
.sub-list view { min-width:0; }
.sub-list .ui-strong,.sub-list text,.sub-list .ui-small { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.sub-list .ui-strong { color:var(--ink); font-size:24rpx; font-weight:600; }
.sub-list text,.sub-list .ui-small { margin-top:3rpx; color:var(--muted); font-size:22rpx; }
.sub-list .ui-bold,.stall-row>.ui-bold { color:#97a29b; font-size:30rpx; }
.floor-group { margin-bottom:18rpx; }
.floor-label { display:block; margin-bottom:8rpx; color:var(--muted); font-size:24rpx; font-weight:500; }
.stall-row { display:grid; grid-template-columns:58rpx minmax(0,1fr) 66rpx 20rpx; align-items:center; gap:12rpx; width:100%; min-height:116rpx; margin-bottom:10rpx; padding:14rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); text-align:left; }
.stall-row:active { transform:scale(.985); background:#fafcfa; }
.stall-mark { display:flex; align-items:center; justify-content:center; width:58rpx; height:58rpx; border-radius:12rpx; color:#fff; background:var(--brand); font-size:24rpx; font-weight:600; }
.stall-row>view:nth-child(2) { min-width:0; }
.stall-row>view:nth-child(2) .ui-strong,.stall-row>view:nth-child(2) text,.stall-row>view:nth-child(2) .ui-small { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.stall-row>view:nth-child(2) .ui-strong { color:var(--ink); font-size:26rpx; font-weight:600; }
.stall-row>view:nth-child(2) text,.stall-row>view:nth-child(2) .ui-small { margin-top:3rpx; color:var(--muted); font-size:22rpx; }
.stall-score { text-align:center; }
.stall-score .ui-strong,.stall-score text { display:block; }
.stall-score .ui-strong { color:#966218; font-size:24rpx; font-weight:600; }
.stall-score text { color:var(--muted); font-size:22rpx; }
</style>
