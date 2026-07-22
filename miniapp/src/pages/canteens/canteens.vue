<template>
  <sc-page-shell back title="食堂导航" subtitle="食堂 · 楼层 · 档口" tone="explore">
    <view class="navigation-summary">
      <view><text class="ui-strong">{{ primaryCanteens.length }}</text><text>主要食堂</text></view>
      <view><text class="ui-strong">{{ store.stalls.value.length }}</text><text>开放档口</text></view>
      <view><text class="ui-strong">{{ store.dishes.value.length }}</text><text>在库菜品</text></view>
    </view>
    <sc-state-card v-if="store.loading.value&&!store.loaded.value" type="loading" title="正在同步食堂目录" />
    <sc-state-card v-else-if="store.error.value&&!store.loaded.value" type="error" title="食堂目录加载失败" :desc="store.error.value" action-text="重试" @action="reload" />
    <view v-else class="canteen-grid">
      <button v-for="(canteen,index) in primaryCanteens" :key="canteen.id" class="canteen-card" :style="entryStyle(index)" @tap="openCanteen(canteen.id)">
        <image class="canteen-image" :src="canteen.imageUrl||heroDish(canteen)?.imageUrl||'/static/food/hero-meal.svg'" mode="aspectFill" />
        <view class="image-shade"></view>
        <view class="canteen-copy"><text>{{ canteen.location||'校内食堂' }}</text><text class="ui-strong">{{ canteen.name }}</text><text class="ui-small">{{ stallCount(canteen.id) }} 个档口 · {{ canteen.hours||'营业时间待更新' }}</text></view>
        <view class="crowd-badge" :class="crowdState(canteen.crowdLevel).className">{{ crowdState(canteen.crowdLevel).label }}</view>
      </button>
    </view>
    <sc-state-card v-if="store.loaded.value&&!primaryCanteens.length" type="empty" title="暂无食堂目录" desc="等待管理员录入食堂和档口。" />
  </sc-page-shell>
</template>

<script setup>
import { computed } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { useCanteenStore } from '../../stores/canteenStore.js';
const store=useCanteenStore();
const primaryCanteens=computed(()=>{const list=store.canteens.value;if(list.some((item)=>item.canteenType))return list.filter((item)=>item.canteenType==='primary');if(list.some((item)=>item.parentId))return list.filter((item)=>!item.parentId);return list;});
onShow(async()=>{try{await store.refreshIfStale();if(!store.user.value)uni.reLaunch({url:'/pages/login/login'});}catch{}});onPullDownRefresh(async()=>{await reload();uni.stopPullDownRefresh();});
async function reload(){try{await store.load(true);}catch{}}
function childCanteens(id){return store.canteens.value.filter((item)=>item.parentId===id);}function stallCount(id){const childIds=childCanteens(id).map((item)=>item.id);const ids=new Set(childIds.length?childIds:[id]);return store.stalls.value.filter((item)=>ids.has(item.canteenId)&&!item.parentId).length;}
function heroDish(canteen){const childIds=childCanteens(canteen.id).map((item)=>item.id);const ids=new Set(childIds.length?childIds:[canteen.id]);const stallIds=new Set(store.stalls.value.filter((item)=>ids.has(item.canteenId)).map((item)=>item.id));return store.dishes.value.find((dish)=>stallIds.has(dish.stallId)&&dish.imageUrl);}
function crowdState(value){const crowd=Number(value||0);if(crowd>=70)return{label:'人流较高',className:'hot'};if(crowd>=45)return{label:'人流适中',className:'medium'};return{label:'相对空闲',className:'calm'};}
function entryStyle(index){return store.motionReduced.value?{}:{animationDelay:`${Math.min(index,5)*70}ms`};}function openCanteen(id){uni.navigateTo({url:`/pages/canteen-detail/canteen-detail?id=${encodeURIComponent(id)}`});}
</script>

<style scoped>
.navigation-summary { display:grid; grid-template-columns:repeat(3,1fr); gap:10rpx; margin-bottom:22rpx; }
.navigation-summary view { min-width:0; padding:18rpx 8rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); text-align:center; }
.navigation-summary .ui-strong,.navigation-summary text { display:block; }
.navigation-summary .ui-strong { color:var(--ink); font-size:30rpx; font-weight:600; }
.navigation-summary text { margin-top:4rpx; color:var(--muted); font-size:22rpx; }
.canteen-grid { display:grid; grid-template-columns:1fr 1fr; gap:14rpx; }
.canteen-card { position:relative; overflow:hidden; width:100%; height:272rpx; padding:0; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface-soft); text-align:left; box-shadow:var(--shadow-soft); animation:canteen-in 220ms ease both; }
.canteen-card:active { transform:scale(.985); }
.canteen-image,.image-shade { position:absolute; inset:0; width:100%; height:100%; }
.canteen-image { transition:transform 200ms ease; }
.canteen-card:active .canteen-image { transform:scale(1.02); }
.image-shade { background:linear-gradient(180deg,rgba(10,28,19,.02),rgba(10,32,21,.84)); }
.canteen-copy { position:absolute; right:0; bottom:0; left:0; padding:18rpx; color:#fff; }
.canteen-copy text,.canteen-copy .ui-strong,.canteen-copy .ui-small { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.canteen-copy text { font-size:22rpx; opacity:.78; }
.canteen-copy .ui-strong { margin-top:4rpx; font-size:28rpx; font-weight:600; }
.canteen-copy .ui-small { margin-top:5rpx; font-size:22rpx; opacity:.86; }
.crowd-badge { position:absolute; top:12rpx; left:12rpx; min-height:40rpx; padding:0 9rpx; border-radius:8rpx; color:#fff; font-size:22rpx; font-weight:500; line-height:40rpx; }
.crowd-badge.calm { background:rgba(35,122,87,.92); }
.crowd-badge.medium { background:rgba(213,139,34,.94); }
.crowd-badge.hot { background:rgba(217,99,76,.94); }
@keyframes canteen-in { from { opacity:0; transform:translateY(8rpx); } to { opacity:1; transform:none; } }
</style>
