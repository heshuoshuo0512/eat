<template>
  <sc-page-shell back title="校园排行榜" subtitle="评分与评价热度" tone="ranking">
    <view class="ranking-workspace">
      <view v-if="activeItems.length" class="ranking-summary">
        <view class="summary-head"><text>排行概览</text><text>{{ activeItems.length }} 项</text></view>
        <sc-dish-media v-if="podiumImageDish" class="podium-media" :dish="podiumImageDish" ratio="wide" />
        <button v-for="item in podiumItems" :key="item.id" class="summary-row" @tap="openItem(item)"><text class="summary-place">0{{ item.place }}</text><view><text class="ui-strong">{{ item.name }}</text><text class="ui-small">{{ itemSubtitle(item) }}</text></view><text class="summary-score">{{ rating(item) }}</text></button>
      </view>
      <view class="ranking-main">
        <sc-segmented-control v-model="activeType" :options="typeOptions" block />
        <view v-if="activeType==='dishes'" class="filter-scroll"><view class="filter-row"><button v-for="type in itemTypeOptions" :key="type.value" :class="{active:rankingItemType===type.value}" @tap="selectItemType(type.value)">{{ type.label }}</button></view></view>
        <picker v-if="activeType==='dishes'" class="category-picker" :range="categoryOptions" range-key="label" :value="categoryIndex" @change="selectCategory"><view class="picker-box"><text>{{ selectedCategory?.label||'全部餐食分类' }}</text><text>⌄</text></view></picker>
        <sc-state-card v-if="store.loading.value&&!store.loaded.value" type="loading" title="正在计算排行榜" />
        <view v-else class="rank-list">
          <button v-for="(item,index) in activeItems" :key="item.id" class="rank-row" :class="{ podium:index<3 }" :style="entryStyle(index)" @tap="openItem(item)">
            <text class="rank-number" :class="{top:index<3}">{{ index+1 }}</text>
            <view><text class="ui-strong">{{ item.name }}</text><text>{{ itemSubtitle(item) }}</text><text class="ui-small">{{ itemMeta(item) }}</text></view>
            <view class="rank-score"><text class="ui-strong">{{ rating(item) }}</text><text>{{ activeType==='dishes'?'口碑':'综合分' }}</text></view><sc-icon name="arrow-right" :size="16" tone="muted" />
          </button>
          <text v-if="activePage.hasMore" class="page-progress">{{ loadingMore?'正在加载更多':'继续上拉加载更多' }}</text>
          <sc-state-card v-if="!activeItems.length" type="empty" :title="activeMeta?.available===false?'评价与热度数据积累中':'暂无排行数据'" :desc="activeMeta?.available===false?`当前有 ${activeMeta?.candidateCount||0} 项真实目录可评价。`:'这里仅展示真实评分、评价或销量信号。'" />
        </view>
      </view>
    </view>
  </sc-page-shell>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app';
import { dishPriceText, dishRatingText, verifiedDishImageUrl } from '../../domain/dishPresentation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';
const store=useCanteenStore();const typeOptions=[{value:'dishes',label:'菜品'},{value:'stalls',label:'档口'},{value:'canteens',label:'场所'}];const itemTypeOptions=[{value:'meal',label:'餐食'},{value:'snack',label:'小吃'},{value:'beverage',label:'饮品'}];const activeType=ref('dishes');const rankingItemType=ref('meal');const rankingCategories=ref([]);const rankingCategory=ref('');const loadingMore=ref(false);const rankingPages=reactive({dishes:{page:1,pageSize:20,total:0,hasMore:false},stalls:{page:1,pageSize:20,total:0,hasMore:false},canteens:{page:1,pageSize:20,total:0,hasMore:false}});
const activeItems=computed(()=>store.rankings.value[activeType.value]||[]);
const activeMeta=computed(()=>store.rankingMeta.value[activeType.value]);
const podiumItems=computed(()=>activeItems.value.slice(0,3).map((item,index)=>({...item,place:index+1})));
const podiumImageDish=computed(()=>activeType.value==='dishes'&&verifiedDishImageUrl(activeItems.value[0]||{})?activeItems.value[0]:null);
const activePage=computed(()=>rankingPages[activeType.value]);
const categoryOptions=computed(()=>[{value:'',label:'全部餐食分类',count:0},...rankingCategories.value]);const selectedCategory=computed(()=>categoryOptions.value.find(item=>item.value===rankingCategory.value));const categoryIndex=computed(()=>Math.max(0,categoryOptions.value.findIndex(item=>item.value===rankingCategory.value)));
onShow(async()=>{try{await store.refreshIfStale();if(!store.user.value){uni.reLaunch({url:'/pages/login/login'});return;}await refreshRankings();}catch{}});onPullDownRefresh(async()=>{try{await store.load(true);await refreshRankings();}catch{}finally{uni.stopPullDownRefresh();}});onReachBottom(loadMore);watch(activeType,()=>{if(!(store.rankings.value[activeType.value]||[]).length)loadRanking(activeType.value,1);});
 function apiType(type){return type==='canteens'?'venues':type;}async function loadRanking(type,page){const result=await store.loadCatalogRanking(apiType(type),{page,pageSize:20,itemType:rankingItemType.value,catalogCategory:rankingCategory.value});rankingPages[type]=result.page||rankingPages[type];return result;}async function loadCategories(){const result=await store.loadCatalogCategories(rankingItemType.value,{force:true});rankingCategories.value=result||[];}async function selectItemType(value){if(rankingItemType.value===value)return;rankingItemType.value=value;rankingCategory.value='';await loadCategories();await loadRanking('dishes',1);}function selectCategory(event){rankingCategory.value=categoryOptions.value[Number(event.detail.value)]?.value||'';loadRanking('dishes',1);}async function refreshRankings(){await loadCategories();await Promise.all(['dishes','stalls','canteens'].map((type)=>loadRanking(type,1)));}async function loadMore(){const page=activePage.value;if(loadingMore.value||!page.hasMore)return;loadingMore.value=true;try{await loadRanking(activeType.value,Number(page.page||1)+1);}finally{loadingMore.value=false;}}
function rating(item){if(activeType.value==='dishes')return dishRatingText(item);const value=Number(item.rankScore??item.rating);return Number.isFinite(value)&&value>0?value.toFixed(1):'暂无评分';}function stallForDish(item){return store.stalls.value.find((stall)=>stall.id===item.stallId);}function canteenForStall(item){return store.canteens.value.find((canteen)=>canteen.id===item.canteenId);}function itemSubtitle(item){if(activeType.value==='dishes'){const stall=stallForDish(item);return[item.cuisine,stall?.name].filter(Boolean).join(' · ');}if(activeType.value==='stalls'){const canteen=canteenForStall(item);return[canteen?.name,item.floor,item.category].filter(Boolean).join(' · ');}const parent=store.canteens.value.find((canteen)=>canteen.id===item.parentId);return[parent?.name,item.location].filter(Boolean).join(' · ')||'校内食堂';}
function itemMeta(item){if(activeType.value==='dishes')return`${item.computedReviewCount??item.reviewCount??0} 条评价 · ${dishPriceText(item)}`;if(activeType.value==='stalls')return`${item.dishCount??store.dishes.value.filter((dish)=>dish.stallId===item.id).length} 道菜 · ${item.avgPrice?`${item.avgPrice}元人均`:'人均待核验'}`;return`${item.stallCount??store.stalls.value.filter((stall)=>stall.canteenId===item.id).length} 个档口`;}
function entryStyle(index){return store.motionReduced.value?{}:{animationDelay:`${Math.min(index,8)*45}ms`};}function openItem(item){if(activeType.value==='dishes')uni.navigateTo({url:`/pages/dish-detail/dish-detail?id=${encodeURIComponent(item.id)}`});else if(activeType.value==='stalls')uni.navigateTo({url:`/pages/stall-detail/stall-detail?id=${encodeURIComponent(item.id)}`});else uni.navigateTo({url:`/pages/canteen-detail/canteen-detail?id=${encodeURIComponent(item.id)}`});}
</script>

<style scoped>
.ranking-workspace { display:grid; gap:16px; }
.ranking-summary { padding:0 12px; border:1px solid var(--line); border-radius:var(--radius-large); background:var(--surface); }
.summary-head { display:flex; min-height:44px; align-items:center; justify-content:space-between; border-bottom:1px solid var(--line); color:var(--muted); font-size:12px; }
.summary-head text:first-child { color:var(--ink); font-size:14px; font-weight:600; }
.podium-media { margin:12px 0 4px; }
.summary-row { display:grid; grid-template-columns:28px minmax(0,1fr) auto; width:100%; min-height:56px; padding:8px 0; align-items:center; gap:8px; border-bottom:1px solid var(--line); text-align:left; }
.summary-row:last-child { border-bottom:0; }
.summary-place { color:var(--muted); font-size:12px; font-weight:600; }
.summary-row view { min-width:0; }
.summary-row .ui-strong,.summary-row .ui-small { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.summary-row .ui-strong { color:var(--ink); font-size:14px; }
.summary-score { color:var(--ink); font-size:14px; font-weight:600; }
.ranking-main { min-width:0; }
.filter-scroll { width:100%; margin:4px 0 8px; white-space:nowrap; }
.filter-row { display:flex; width:max-content; padding-right:16px; align-items:center; gap:6px; }
.filter-row button { display:flex; min-height:44px; padding:0 12px; align-items:center; justify-content:center; border:1px solid var(--line); border-radius:var(--radius); color:var(--ink-2); background:var(--surface); font-size:14px; font-weight:500; }
.filter-row button.active { color:#fff; border-color:var(--module-accent); background:var(--module-accent); }
.category-picker { display:flex; min-height:44px; margin-top:8px; align-items:center; }
  .category-picker .picker-box { display:flex; width:100%; min-height:42px; align-items:center; justify-content:space-between; padding:0 12px; border:1px solid var(--line); border-radius:var(--radius); color:var(--ink-2); background:var(--surface); font-size:14px; }
.rank-list { margin-top:12px; padding:0 12px; border:1px solid var(--line); border-radius:var(--radius-large); background:var(--surface); }
.rank-row { display:grid; grid-template-columns:28px minmax(0,1fr) 64px 16px; width:100%; min-height:72px; padding:10px 0; align-items:center; gap:10px; border-bottom:1px solid var(--line); background:var(--surface); text-align:left; animation:rank-in 200ms ease both; }
.rank-row:last-child { border-bottom:0; }
.rank-row:active { transform:translateY(1px); background:var(--surface-soft); }
.rank-row.podium { margin:0 -12px; width:calc(100% + 24px); padding-right:12px; padding-left:12px; background:var(--module-soft); }
.rank-number { display:flex; width:26px; height:26px; align-items:center; justify-content:center; border-radius:50%; color:var(--ink-2); background:var(--surface-soft); font-size:12px; font-weight:600; }
.rank-number.top { color:var(--module-dark); background:var(--module-soft); }
.rank-row>view:nth-child(2) { min-width:0; }
.rank-row>view:nth-child(2) .ui-strong,.rank-row>view:nth-child(2) text,.rank-row>view:nth-child(2) .ui-small { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.rank-row>view:nth-child(2) .ui-strong { color:var(--ink); font-size:14px; font-weight:600; }
.rank-row>view:nth-child(2) text,.rank-row>view:nth-child(2) .ui-small { margin-top:3px; color:var(--muted); font-size:12px; }
.rank-score { text-align:center; }
.rank-score .ui-strong,.rank-score text { display:block; }
.rank-score .ui-strong { color:var(--ink); font-size:14px; font-weight:600; }
.rank-score text { color:var(--muted); font-size:12px; }
.page-progress { display:block; min-height:44px; color:var(--muted); font-size:12px; line-height:44px; text-align:center; }
@keyframes rank-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
@media (min-width:768px) {
  .ranking-workspace { grid-template-columns:280px minmax(0,1fr); gap:24px; align-items:start; }
  .ranking-summary { position:sticky; top:72px; }
}
</style>
