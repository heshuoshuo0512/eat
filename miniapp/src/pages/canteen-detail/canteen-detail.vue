<template>
  <sc-page-shell back :title="canteen?.name||'食堂详情'" subtitle="楼层与档口" tone="explore">
    <sc-state-card v-if="loading" type="loading" title="正在读取食堂信息" />
    <sc-state-card v-else-if="!canteen" type="error" title="食堂不存在" desc="该食堂可能已下线或目录尚未同步。" action-text="返回导航" @action="backToCanteens" />
    <template v-else>
      <view class="detail-workspace">
        <view class="canteen-aside">
          <view class="canteen-hero">
            <text class="crowd" :class="crowdState.className">{{ crowdState.label }}</text>
            <view class="hero-copy"><text>{{ canteen.location||'校内食堂' }}</text><text class="ui-strong">{{ canteen.name }}</text><text class="ui-small">{{ canteen.hours||'营业时间待更新' }}</text></view>
          </view>
          <text v-if="canteen.description" class="canteen-description">{{ canteen.description }}</text>
          <view v-if="canteen.tags?.length" class="tag-row"><text v-for="tag in canteen.tags" :key="tag">{{ tag }}</text></view>
        </view>

        <view class="canteen-main">
          <view v-if="children.length" class="section-block">
            <view class="section-head"><text class="ui-strong">分区导航</text><text>{{ children.length }} 个子食堂</text></view>
            <view class="sub-list"><sc-list-row v-for="item in children" :key="item.id" icon-name="location" :title="item.name" :description="item.location||canteen.name" :badge="`${stallCount(item.id)} 个档口`" @tap="openCanteen(item.id)" /></view>
          </view>

          <view v-if="directStalls.length" class="section-block">
            <view class="section-head"><view><text class="ui-strong">档口目录</text><text>{{ directStalls.length }} 个档口</text></view><button @tap="openReviews">查看评价</button></view>
            <view v-for="group in floorGroups" :key="group.floor" class="floor-group"><text class="floor-label">{{ group.floor }}</text><view class="floor-list"><sc-list-row v-for="stall in group.stalls" :key="stall.id" icon-name="store" :title="stall.name" :description="`${stall.category||'综合档口'} · ${stall.avgPrice?`${stall.avgPrice}元人均`:'人均待核验'} · ${dishCount(stall.id)} 道菜`" :meta="Number(stall.rating)>0?Number(stall.rating).toFixed(1):'暂无评分'" :badge="stall.open===false?'暂停营业':'营业中'" :badge-tone="stall.open===false?'warning':'default'" @tap="openStall(stall.id)" /></view></view>
          </view>
          <sc-state-card v-if="!children.length&&!directStalls.length" type="empty" title="暂无档口" desc="等待档口目录同步。" />
        </view>
      </view>
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
const crowdState=computed(()=>{const value=Number(canteen.value?.crowdLevel||0);if(value>=70)return{label:'当前人流较高',className:'hot'};if(value>=45)return{label:'当前人流适中',className:'medium'};return{label:'当前相对空闲',className:'calm'};});
onLoad(async(options)=>{canteenId.value=String(options?.id||'');try{await store.refreshIfStale();if(!store.user.value)uni.reLaunch({url:'/pages/login/login'});}catch{}finally{loading.value=false;}});
function stallCount(id){return store.stalls.value.filter((item)=>item.canteenId===id&&!item.parentId).length;}function dishCount(stallId){const stalls=[store.stalls.value.find((item)=>String(item.id)===String(stallId)),...store.stalls.value.filter((item)=>String(item.parentId)===String(stallId))].filter(Boolean);return stalls.reduce((sum,item)=>sum+Number(item.dishCount||0),0);}
function openCanteen(id){uni.navigateTo({url:`/pages/canteen-detail/canteen-detail?id=${encodeURIComponent(id)}`});}function openStall(id){uni.navigateTo({url:`/pages/stall-detail/stall-detail?id=${encodeURIComponent(id)}`});}function backToCanteens(){uni.redirectTo({url:'/pages/canteens/canteens'});}function openReviews(){store.openCommunitySection('reviews');uni.switchTab({url:'/pages/community/community'});}
</script>

<style scoped>
.detail-workspace { display:grid; gap:20px; }
.canteen-hero { padding:20px 16px; border:1px solid var(--module-line); border-radius:var(--radius-large); color:var(--ink); background:var(--module-soft); box-sizing:border-box; }
.hero-copy { margin-top:20px; }
.hero-copy text,.hero-copy .ui-strong,.hero-copy .ui-small { display:block; }
.hero-copy text { color:var(--muted); font-size:12px; }
.hero-copy .ui-strong { margin-top:4px; font-size:20px; }
.hero-copy .ui-small { margin-top:4px; font-size:14px; }
.crowd { display:inline-flex; min-height:24px; padding:0 8px; align-items:center; border:1px solid var(--line); border-radius:999px; color:var(--ink-2); background:var(--surface); font-size:12px; font-weight:500; }
.crowd.medium { color:var(--warning); border-color:var(--warning-line); background:var(--warning-soft); }.crowd.hot { color:var(--danger); border-color:var(--danger-line); background:var(--danger-soft); }
.crowd.calm { color:var(--success); border-color:var(--success-line); background:var(--success-soft); }
.canteen-description { display:block; margin-top:12px; color:var(--ink-2); font-size:14px; line-height:1.55; }
.tag-row { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
.tag-row text { min-height:24px; padding:0 8px; border:1px solid var(--line); border-radius:999px; color:var(--ink-2); background:var(--surface-soft); font-size:12px; line-height:22px; }
.section-block+.section-block { margin-top:24px; }
.section-head { display:flex; min-height:44px; align-items:center; justify-content:space-between; gap:12px; margin-bottom:8px; }
.section-head view>text,.section-head .ui-strong,.section-head>text { display:block; }
.section-head .ui-strong { color:var(--ink); font-size:16px; }
.section-head view>text:not(.ui-strong),.section-head>text:not(.ui-strong) { margin-top:3px; color:var(--muted); font-size:12px; }
.section-head button { display:flex; min-height:44px; padding:0 8px; align-items:center; justify-content:center; color:var(--ink); font-size:14px; font-weight:500; }
.sub-list,.floor-list { padding:0 12px; border:1px solid var(--line); border-radius:var(--radius-large); background:var(--surface); }
.floor-group { margin-bottom:16px; }
.floor-label { display:block; margin:0 4px 7px; color:var(--muted); font-size:12px; font-weight:600; }
@media (min-width:768px) {
  .detail-workspace { grid-template-columns:320px minmax(0,1fr); gap:24px; align-items:start; }
  .canteen-aside { position:sticky; top:72px; }
  .sub-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); column-gap:20px; }
}
</style>
