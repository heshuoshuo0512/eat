<template>
  <sc-page-shell title="找菜">
    <view class="mode-row">
      <sc-segmented-control :model-value="'search'" :options="modeOptions" block @update:model-value="changeMode" />
      <button class="camera-button" aria-label="拍照识餐" @tap="openVision"><image src="/static/icons/camera-line.png" mode="aspectFit" /></button>
    </view>

    <sc-smart-composer
      v-model="query" v-model:memory-draft="memoryDraft" title="帮我找菜"
      subtitle="快捷问题会随健康档案、预算和忌口变化。" :prompts="prompts" :loading="searching"
      :memory-open="memoryOpen" :memory-saving="memorySaving" @submit="submitSearch" @prompt="runPrompt"
      @toggle-memory="memoryOpen=!memoryOpen" @save-memory="saveMemory" @clear-memory="clearMemory"
    />

    <view class="explore-shortcuts">
      <button v-for="entry in exploreEntries" :key="entry.id" @tap="openExplore(entry)">
        <view><image :src="entry.icon" mode="aspectFit" /></view><text>{{ entry.shortLabel }}</text>
      </button>
    </view>

    <view v-if="searchResult" class="search-summary panel-card">
      <view class="summary-head"><text class="source-badge">{{ searchResult.meta?.semanticUsed ? '语义检索' : '规则检索' }}</text><text class="ui-strong">检索结论</text><button @tap="clearSearch">查看全部</button></view>
      <text class="summary-copy">{{ resultSummary }}</text>
      <view v-if="searchResult.suggestedRelaxations?.length" class="relaxations"><text v-for="item in searchResult.suggestedRelaxations" :key="relaxationLabel(item)">{{ relaxationLabel(item) }}</text></view>
    </view>
    <text v-if="message" class="page-message" :class="{ error:isError }">{{ message }}</text>

    <view class="result-head">
      <view><text class="result-eyebrow">{{ searchResult ? '检索结果' : '全部有效菜品' }}</text><text class="result-title">{{ sortedDishes.length }} 道菜</text></view>
      <sc-segmented-control v-model="sortDirection" :options="sortOptions" density="compact" />
    </view>
    <sc-state-card v-if="store.loading.value&&!store.loaded.value" type="loading" title="正在加载菜品" />
    <view v-else class="dish-list">
      <sc-dish-card v-for="dish in sortedDishes" :key="dish.id" :dish="dish" :location="dishLocation(dish)" :supply-status="supplyState(dish).label" :unavailable="!supplyState(dish).canOrder" @tap="openDish(dish.id)" />
      <sc-state-card v-if="!sortedDishes.length" type="empty" title="没有匹配菜品" desc="调整描述后重新搜索。" action-text="查看全部" @action="clearSearch" />
    </view>

    <sc-citation-list v-if="searchResult" :citations="searchResult.items||[]" :expanded="citationsExpanded" @toggle="citationsExpanded=!citationsExpanded" @select="selectCitation" />
  </sc-page-shell>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { buildProfilePrompts, createRatingMap, sortDishesByRating } from '../../domain/studentDiscovery.js';
import { EXPLORE_ENTRY_IDS, getStudentEntries } from '../../domain/studentNavigation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';
const store=useCanteenStore();
const exploreEntries=getStudentEntries(EXPLORE_ENTRY_IDS);
const modeOptions=[{value:'search',label:'菜品检索'},{value:'recommend',label:'智能推荐'}];
const sortOptions=[{value:'desc',label:'高分优先'},{value:'asc',label:'低分优先'}];
const query=ref(''); const searching=ref(false); const searchResult=ref(null); const sortDirection=ref('desc'); const message=ref(''); const isError=ref(false); const citationsExpanded=ref(false);
const memoryOpen=ref(false); const memoryDraft=ref(''); const memoryPreferences=ref({}); const memorySaving=ref(false); let memoryLoaded=false;
const prompts=computed(()=>buildProfilePrompts(store.profile.value,'search'));
const ratingMap=computed(()=>createRatingMap(store.rankings.value.dishes));
const sourceDishes=computed(()=>searchResult.value?.items || store.dishes.value.filter((dish)=>dish.status!=='archived'&&dish.status!=='inactive'));
const sortedDishes=computed(()=>sortDishesByRating(sourceDishes.value,ratingMap.value,sortDirection.value));
const resultSummary=computed(()=>{ const result=searchResult.value;if(!result)return'';const total=Number(result.availability?.totalCount??result.items?.length??0);const orderable=Number(result.availability?.orderableCount??result.items?.filter((dish)=>dish.availability?.orderable).length??0);return total?`找到 ${total} 道真实菜品，其中 ${orderable} 道当前可点。`:'没有满足全部条件的真实菜品，可参考放宽建议。'; });
  onShow(async()=>{ try{await store.refreshIfStale();if(!store.user.value){uni.reLaunch({url:'/pages/login/login'});return;}if(!memoryLoaded){memoryLoaded=true;await loadMemory();}}catch{} });
onPullDownRefresh(async()=>{try{await store.load(true);}catch{}finally{uni.stopPullDownRefresh();}});
function changeMode(value){if(value==='recommend')uni.navigateTo({url:'/pages/recommend/recommend'});}
function openVision(){uni.navigateTo({url:'/pages/vision/vision'});}
function openExplore(entry){uni.navigateTo({url:entry.route});}
function runPrompt(text){query.value=text;submitSearch();}
async function submitSearch(){const text=query.value.trim();if(!text)return;searching.value=true;message.value='';isError.value=false;citationsExpanded.value=false;try{searchResult.value=await store.searchDishes({query:text,filters:{budgetMax:store.profile.value.budgetMax,taste:store.profile.value.taste!=='不限'?store.profile.value.taste:undefined,halalOnly:store.profile.value.halalOnly,mealType:store.profile.value.mealType,avoidIngredients:[...(store.profile.value.allergies||[]),...(store.profile.value.avoid||[])]},sort:'relevance',limit:50,offset:0});}catch(error){isError.value=true;message.value=error.message||'检索失败，请稍后重试。';}finally{searching.value=false;}}
function clearSearch(){searchResult.value=null;query.value='';citationsExpanded.value=false;message.value='';}
function relaxationLabel(item){return typeof item==='string'?item:item?.label||item?.message||item?.field||'调整条件';}
function dishLocation(dish){const stall=store.stalls.value.find((item)=>item.id===dish.stallId);const canteen=store.canteens.value.find((item)=>item.id===stall?.canteenId);return[canteen?.name,stall?.name].filter(Boolean).join(' · ');}
function supplyState(dish){if(dish.availability){return{label:dish.availability.reason||({available:'今日可点',limited:'库存紧张',sold_out:'今日售罄',off_menu:'非今日供应'}[dish.availability.status]||'当前不可点'),canOrder:dish.availability.orderable===true};}const menu=store.todayMenu.value.dishes?.find((item)=>String(item.id)===String(dish.id));if(!menu)return{label:'非今日供应',canOrder:false};if(menu.supplyStatus==='sold_out')return{label:'今日售罄',canOrder:false};return{label:menu.supplyStatus==='limited'?'库存紧张':'今日可点',canOrder:true};}
function openDish(id){uni.navigateTo({url:`/pages/dish-detail/dish-detail?id=${encodeURIComponent(id)}`});}
function selectCitation(item){openDish(item.id||item.dishId||item.sourceId);}
async function loadMemory(){try{const result=await store.loadAgentMemory();const memory=result.memory||result;memoryDraft.value=memory.summary||'';memoryPreferences.value=memory.preferences||{};}catch{}}
async function saveMemory(){memorySaving.value=true;try{const result=await store.saveAgentMemory({summary:memoryDraft.value.trim(),preferences:memoryPreferences.value});const memory=result.memory||result;memoryDraft.value=memory.summary||'';message.value='饮食记忆已保存。';isError.value=false;}catch(error){message.value=error.message;isError.value=true;}finally{memorySaving.value=false;}}
async function clearMemory(){memorySaving.value=true;try{await store.clearAgentMemory();memoryDraft.value='';memoryPreferences.value={};message.value='饮食记忆已清除。';isError.value=false;}catch(error){message.value=error.message;isError.value=true;}finally{memorySaving.value=false;}}
</script>

<style scoped>
.mode-row { display:grid; grid-template-columns:minmax(0,1fr) 88rpx; gap:12rpx; margin-bottom:24rpx; }
.camera-button { display:flex; align-items:center; justify-content:center; width:88rpx; height:88rpx; padding:0; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); }
.camera-button image { width:38rpx; height:38rpx; }
.explore-shortcuts { display:grid; grid-template-columns:repeat(3,1fr); gap:12rpx; margin:-2rpx 0 28rpx; }
.explore-shortcuts button { display:flex; align-items:center; justify-content:center; gap:10rpx; min-width:0; min-height:88rpx; padding:0 10rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); }
.explore-shortcuts button:active { transform:scale(.98); background:var(--brand-soft); }
.explore-shortcuts view { display:flex; align-items:center; justify-content:center; width:40rpx; height:40rpx; flex:0 0 40rpx; }
.explore-shortcuts image { width:34rpx; height:34rpx; }
.explore-shortcuts text { overflow:hidden; color:var(--ink); font-size:24rpx; font-weight:500; white-space:nowrap; text-overflow:ellipsis; }
.search-summary { padding:22rpx; }
.summary-head { display:flex; align-items:center; gap:10rpx; }
.summary-head .ui-strong { flex:1; color:var(--ink); font-size:26rpx; font-weight:600; }
.summary-head button { display:flex; align-items:center; justify-content:center; min-height:60rpx; padding:0 10rpx; border-radius:10rpx; color:var(--brand); background:var(--brand-soft); font-size:24rpx; font-weight:500; }
.source-badge { min-height:40rpx; padding:0 9rpx; border-radius:8rpx; color:var(--info); background:var(--info-soft); font-size:22rpx; line-height:40rpx; }
.summary-copy { display:block; margin-top:10rpx; color:var(--ink-2); font-size:24rpx; line-height:1.55; }
.relaxations { display:flex; flex-wrap:wrap; gap:8rpx; margin-top:12rpx; }
.relaxations text { min-height:40rpx; padding:0 9rpx; border-radius:8rpx; color:#966218; background:var(--rating-soft); font-size:22rpx; line-height:40rpx; }
.page-message { display:block; margin:12rpx 0; color:var(--brand); font-size:24rpx; }
.page-message.error { color:var(--danger); }
.result-head { display:flex; align-items:flex-end; justify-content:space-between; gap:14rpx; margin:30rpx 0 16rpx; }
.result-eyebrow,.result-title { display:block; }
.result-eyebrow { color:var(--brand); font-size:22rpx; font-weight:500; }
.result-title { margin-top:4rpx; color:var(--ink); font-size:30rpx; font-weight:600; }
.dish-list { display:flex; flex-direction:column; gap:12rpx; margin-bottom:22rpx; }
</style>
