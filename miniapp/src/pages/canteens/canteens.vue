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
      <sc-list-row
        v-for="(canteen,index) in primaryCanteens"
        :key="canteen.id"
        class="canteen-card"
        icon-name="location"
        :title="canteen.name"
        :description="`${canteen.location||'校内食堂'} · ${stallCount(canteen.id)} 个档口 · ${canteen.hours||'营业时间待更新'}`"
        :badge="crowdState(canteen.crowdLevel).label"
        :badge-tone="crowdState(canteen.crowdLevel).tone"
        :style="entryStyle(index)"
        @tap="openCanteen(canteen.id)"
      />
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
function crowdState(value){const crowd=Number(value||0);if(crowd>=70)return{label:'人流较高',tone:'danger'};if(crowd>=45)return{label:'人流适中',tone:'warning'};return{label:'相对空闲',tone:'default'};}
function entryStyle(index){return store.motionReduced.value?{}:{animationDelay:`${Math.min(index,5)*70}ms`};}function openCanteen(id){uni.navigateTo({url:`/pages/canteen-detail/canteen-detail?id=${encodeURIComponent(id)}`});}
</script>

<style scoped>
.navigation-summary { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); margin-bottom:16px; border:1px solid var(--module-line); border-radius:var(--radius-large); background:var(--module-soft); }
.navigation-summary view { position:relative; min-width:0; padding:12px 6px; text-align:center; }
.navigation-summary view+view::before { position:absolute; top:10px; bottom:10px; left:0; width:1px; background:var(--line); content:''; }
.navigation-summary .ui-strong,.navigation-summary text { display:block; }
.navigation-summary .ui-strong { color:var(--module-dark); font-size:16px; }
.navigation-summary text { margin-top:3px; color:var(--muted); font-size:12px; }
.canteen-grid { padding:0 12px; border:1px solid var(--line); border-radius:var(--radius-large); background:var(--surface); }
.canteen-card { animation:canteen-in 200ms ease both; }
@keyframes canteen-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
@media (min-width:768px) {
  .canteen-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); column-gap:24px; }
  .canteen-card:nth-last-child(2):nth-child(odd) { border-bottom:0; }
}
</style>
