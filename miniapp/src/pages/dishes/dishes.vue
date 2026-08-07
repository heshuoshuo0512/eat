<template>
  <sc-page-shell title="找菜" subtitle="按校园稳定目录筛选" tone="discover" tab-id="dishes">
    <view class="mode-row">
      <sc-segmented-control v-model="mode" :options="modeOptions" block @update:model-value="changeMode" />
      <button v-if="mode === 'search'" class="camera-button" aria-label="拍照识餐" @tap="openVision"><sc-icon name="camera" :size="18" /></button>
      <button v-else class="profile-button" aria-label="打开健康档案" @tap="openProfile"><sc-icon name="safe" :size="18" /></button>
    </view>

    <template v-if="mode === 'search'">
      <view class="discovery-workspace">
        <view class="control-column">
          <sc-smart-composer v-model="query" v-model:memory-draft="memoryDraft" title="帮我找菜" subtitle="快捷问题会随健康档案、预算和忌口变化。" :prompts="searchPrompts" :loading="searching" :memory-open="memoryOpen" :memory-saving="memorySaving" @submit="submitSearch" @prompt="runSearchPrompt" @toggle-memory="memoryOpen=!memoryOpen" @save-memory="saveMemory" @clear-memory="clearMemory" />
          <scroll-view class="shortcut-track" scroll-x enable-flex show-scrollbar="false"><view class="explore-shortcuts"><button v-for="entry in exploreEntries" :key="entry.id" @tap="openExplore(entry)"><sc-icon :name="entry.iconName" :size="16" /><text>{{ entry.shortLabel }}</text></button></view></scroll-view>
          <view v-if="searchResult" class="search-summary">
            <view class="summary-head"><text class="source-badge">{{ searchResult.meta?.semanticUsed ? '语义检索' : '规则检索' }}</text><text class="ui-strong">检索结论</text><button @tap="clearSearch">清除</button></view>
            <text class="summary-copy">{{ resultSummary }}</text><sc-rag-trust-state :item="searchResult" />
            <view v-if="searchResult.warnings?.length" class="rag-warnings"><text v-for="warning in searchResult.warnings" :key="`${warning.code}-${warning.dishId||''}`">{{ warning.message }}</text></view>
            <view v-if="searchResult.suggestedRelaxations?.length" class="relaxations"><text v-for="item in searchResult.suggestedRelaxations" :key="relaxationLabel(item)">{{ relaxationLabel(item) }}</text></view>
          </view>
          <text v-if="message" class="page-message" :class="{ error:isError }">{{ message }}</text>
        </view>
        <view id="dish-results-top" class="result-column">
          <sc-segmented-control v-if="!searchResult" :model-value="catalogItemType" :options="catalogItemTypeOptions" block density="compact" class="catalog-type-control" @update:model-value="selectCatalogItemType" />
          <scroll-view v-if="!searchResult" class="catalog-category-track" scroll-x enable-flex show-scrollbar="false"><view class="catalog-category-row"><button v-for="option in catalogCategoryOptions" :key="option.value||'all'" :class="{ active:catalogCategory===option.value }" :disabled="catalogLoadingMore" @tap="selectCatalogCategory(option.value)"><text>{{ option.label }}</text><text v-if="option.count!=null" class="category-count">{{ option.count }}</text></button></view></scroll-view>
          <view class="result-head"><view><text class="result-eyebrow">{{ searchResult ? '检索结果' : catalogItemTypeTitle }}</text><text class="result-title">{{ resultCountLabel }}</text></view><sc-segmented-control v-model="sortDirection" :options="sortOptions" density="compact" /></view>
          <sc-state-card v-if="store.loading.value&&!store.loaded.value" type="loading" title="正在加载菜品" />
          <view v-else class="dish-list"><sc-dish-card v-for="dish in visibleDishes" :key="dish.id" :dish="dish" :location="dishLocation(dish)" :supply-status="supplyState(dish).label" :unavailable="!supplyState(dish).canOrder" variant="compact" media="none" @tap="openDish(dish.id)" /><sc-state-card v-if="!sortedDishes.length" type="empty" illustration="empty-search" title="没有匹配菜品" desc="调整描述后重新搜索。" action-text="查看全部" @action="clearSearch" /></view>
          <view v-if="searchResult && searchPageCount > 1" class="pagination"><button type="button" :disabled="searchLoadingMore || searchPage <= 1" @tap="changeSearchPage(searchPage - 1)">上一页</button><view class="pagination-pages"><template v-for="item in searchPaginationItems" :key="item.key"><text v-if="item.type === 'ellipsis'" class="pagination-ellipsis">…</text><button v-else type="button" class="pagination-page" :class="{ active:item.page===searchPage }" :disabled="searchLoadingMore || item.page===searchPage" @tap="changeSearchPage(item.page)">{{ item.page }}</button></template></view><button type="button" :disabled="searchLoadingMore || searchPage >= searchPageCount" @tap="changeSearchPage(searchPage + 1)">下一页</button></view>
          <view v-if="!searchResult && catalogPageCount > 1" class="pagination"><button type="button" :disabled="catalogLoadingMore || catalogPage <= 1" @tap="changeCatalogPage(catalogPage - 1)">上一页</button><view class="pagination-pages"><template v-for="item in catalogPaginationItems" :key="item.key"><text v-if="item.type === 'ellipsis'" class="pagination-ellipsis">…</text><button v-else type="button" class="pagination-page" :class="{ active:item.page===catalogPage }" :disabled="catalogLoadingMore || item.page===catalogPage" @tap="changeCatalogPage(item.page)">{{ item.page }}</button></template></view><button type="button" :disabled="catalogLoadingMore || catalogPage >= catalogPageCount" @tap="changeCatalogPage(catalogPage + 1)">下一页</button></view>
          <sc-citation-list v-if="searchResult" :citations="searchResult.items||[]" :expanded="citationsExpanded" @toggle="citationsExpanded=!citationsExpanded" @select="selectCitation" />
        </view>
      </view>
    </template>

    <template v-else>
      <view class="discovery-workspace">
        <view class="control-column">
          <sc-smart-composer v-model="question" v-model:memory-draft="memoryDraft" title="帮我规划这一餐" subtitle="结合健康档案、校园目录与评价。" :prompts="recommendPrompts" :loading="recommendLoading" :memory-open="memoryOpen" :memory-saving="memorySaving" action-text="生成推荐" @submit="runPrompt(question)" @prompt="runPrompt" @toggle-memory="memoryOpen=!memoryOpen" @save-memory="saveMemory" @clear-memory="clearMemory" />
          <sc-trust-bar v-if="recommendationResult" :evaluation="recommendationResult.eval||{}" :confidence="recommendationResult.confidence||{}" />
          <view v-if="recommendationResult?.warnings?.length" class="rag-warnings"><text v-for="warning in recommendationResult.warnings" :key="`${warning.code}-${warning.dishId||''}`">{{ warning.message }}</text></view>
        </view>
        <view class="result-column">
          <view class="conversation-panel">
            <view class="conversation-head"><view><text>智能推荐</text><text class="ui-strong">你的用餐建议</text></view><text class="live"><text class="ui-dot"></text>{{ recommendLoading?'分析中':'数据已连接' }}</text></view>
            <view class="conversation"><view v-if="!conversation.length&&recommendLoading" class="thinking"><text></text><text></text><text></text><text class="ui-paragraph">正在读取健康档案与校园目录</text></view><view v-for="(item,index) in conversation" :key="`${item.role}-${index}`" class="message" :class="item.role"><text>{{ item.role==='user'?'你':'智能推荐' }}</text><text class="ui-paragraph">{{ item.content }}</text></view></view>
            <text v-if="recommendMessage" class="notice" :class="{ error:recommendError }">{{ recommendMessage }}</text>
          </view>
          <view v-if="mealPicks.length" class="recommend-list"><view class="list-head"><text>推荐菜品</text><sc-segmented-control v-model="recommendSort" :options="sortOptions" density="compact" /></view><sc-dish-card v-for="(dish,index) in visibleMealPicks" :key="dish.id" :dish="dish" :location="dishLocation(dish)" :supply-status="supplyState(dish).label" :unavailable="!supplyState(dish).canOrder" :variant="index===0?'featured':'compact'" :media="index===0?'auto':'none'" @tap="openDish(dish.id)" /><button v-if="mealPicks.length > 1" class="result-toggle" type="button" @tap="recommendExpanded = !recommendExpanded">{{ recommendExpanded ? '收起排名菜品' : `查看全部 ${mealPicks.length} 道排名菜品` }}</button></view>
          <sc-state-card v-else-if="recommendationResult&&!recommendLoading" type="empty" title="暂无推荐结果" desc="调整健康档案或换一种描述。" />
          <sc-citation-list :citations="recommendCitations" :expanded="recommendCitationsExpanded" @toggle="recommendCitationsExpanded=!recommendCitationsExpanded" @select="openCitation" />
          <view v-if="pendingActions.length" class="action-panel"><text class="action-title">待确认操作</text><view v-for="action in pendingActions" :key="action.id" class="pending-action"><view><text class="ui-strong">{{ action.label||action.type }}</text><text>{{ action.riskLevel||'low' }} 风险</text></view><view class="action-buttons"><button v-if="isOrderAction(action)" disabled>请在到店预约页提交</button><button v-else class="primary-btn" @tap="confirmAction(action)">确认</button><button class="ghost-btn" @tap="rejectAction(action)">拒绝</button></view></view></view>
        </view>
      </view>
    </template>
  </sc-page-shell>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { dishSupplyPresentation } from '../../domain/dishPresentation.js';
import { buildProfilePrompts, createRatingMap, sortDishesByRating } from '../../domain/studentDiscovery.js';
import { validateQuestion } from '../../domain/validation.js';
import { EXPLORE_ENTRY_IDS, getStudentEntries } from '../../domain/studentNavigation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store=useCanteenStore();
const exploreEntries=getStudentEntries(EXPLORE_ENTRY_IDS);
const modeOptions=[{value:'search',label:'菜品检索'},{value:'recommend',label:'智能推荐'}];
const sortOptions=[{value:'desc',label:'高分优先'},{value:'asc',label:'低分优先'}];
const catalogItemTypeOptions=[{value:'meal',label:'餐食'},{value:'snack',label:'小吃'},{value:'beverage',label:'饮品'}];
const mode=ref(store.discoveryMode.value || 'search');
const query=ref(''); const searching=ref(false); const searchResult=ref(null); const sortDirection=ref('desc'); const message=ref(''); const isError=ref(false); const citationsExpanded=ref(false);
const catalogItemType=ref('meal');
const catalogCategory=ref('');
const catalogLoadingMore=ref(false); const searchLoadingMore=ref(false); const searchPageSize=20; const catalogPageSize=20;
const question=ref(''); const recommendLoading=ref(false); const recommendationResult=ref(null); const conversation=ref([]); const recommendCitations=ref([]); const pendingActions=ref([]); const sessionId=ref(''); const recommendMessage=ref(''); const recommendError=ref(false); const recommendSort=ref('desc'); const recommendCitationsExpanded=ref(false); const recommendExpanded=ref(false); let recommendationLoaded=false;
const memoryOpen=ref(false); const memoryDraft=ref(''); const memoryPreferences=ref({}); const memorySaving=ref(false); let memoryLoaded=false;
let searchRequestId=0;
const searchPrompts=computed(()=>buildProfilePrompts(store.profile.value,'search'));
const recommendPrompts=computed(()=>buildProfilePrompts(store.profile.value,'recommend'));
const ratingMap=computed(()=>createRatingMap(store.rankings.value.dishes));
const sourceDishes=computed(()=>searchResult.value?.items || store.dishes.value.filter((dish)=>dish.status!=='archived'&&dish.status!=='inactive'));
const sortedDishes=computed(()=>sortDishesByRating(sourceDishes.value,ratingMap.value,sortDirection.value));
const visibleDishes=computed(()=>sortedDishes.value);
const searchTotal=computed(()=>Number(searchResult.value?.page?.total??searchResult.value?.availability?.totalCount??searchResult.value?.items?.length??0));
const searchPage=computed(()=>Number(searchResult.value?.page?.page||1));
const searchPageCount=computed(()=>Math.max(1,Math.ceil(searchTotal.value/Number(searchResult.value?.page?.pageSize||searchPageSize))));
const catalogPage=computed(()=>Number(store.catalogPage.value.page||1));
const catalogPageCount=computed(()=>Math.max(1,Math.ceil(Number(store.catalogPage.value.total||0)/Number(store.catalogPage.value.pageSize||catalogPageSize))));
const searchPaginationItems=computed(()=>buildPaginationItems(searchPage.value,searchPageCount.value));
const catalogPaginationItems=computed(()=>buildPaginationItems(catalogPage.value,catalogPageCount.value));
const catalogItemTypeTitle=computed(()=>({meal:'全部餐食',snack:'全部小吃',beverage:'全部饮品'})[catalogItemType.value]||'全部餐食');
const catalogCategoryOptions=computed(()=>{const items=store.catalogCategories.value[catalogItemType.value]||[];return[{value:'',label:'全部',count:items.reduce((sum,item)=>sum+Number(item.count||0),0)},...items];});
const resultCountLabel=computed(()=>searchResult.value?`第 ${searchPage.value} / ${searchPageCount.value} 页，共 ${searchTotal.value} 道菜`:`第 ${catalogPage.value} / ${catalogPageCount.value} 页，共 ${store.catalogPage.value.total} 项`);
const resultSummary=computed(()=>{ const result=searchResult.value;if(!result)return'';const total=searchTotal.value;const orderable=Number(result.availability?.orderableCount??result.items?.filter((dish)=>dish.availability?.orderable).length??0);return total?`共匹配 ${total} 道真实菜品，当前第 ${searchPage.value} 页，本页 ${orderable} 道当前可预约。请使用下方分页切换结果。`:'没有满足全部条件的真实菜品，可参考放宽建议。'; });
const mealPicks=computed(()=>{const raw=recommendationResult.value?.recommendations||recommendationResult.value?.mealPlan?.dishes||recommendationResult.value?.mealPlan?.picks||recommendationResult.value?.ranked||[];const catalog=new Map(store.dishes.value.map((dish)=>[String(dish.id),dish]));const hydrated=raw.map((pick)=>{const id=pick.id||pick.dishId;return{...(catalog.get(String(id))||{}),...pick,id};}).filter((dish)=>dish.id);return sortDishesByRating(hydrated,ratingMap.value,recommendSort.value);});
const visibleMealPicks=computed(()=>recommendExpanded.value ? mealPicks.value : mealPicks.value.slice(0,1));

watch(sortDirection, async () => {
  if (mode.value !== 'search' || searchResult.value || catalogLoadingMore.value) return;
  catalogLoadingMore.value = true;
  message.value = '';
  isError.value = false;
  try { await store.loadCatalogDishes({ page: 1, pageSize: catalogPageSize, ...catalogBrowseFilters() }); }
  catch (error) { message.value = error.message || '菜品排序加载失败，请重试。'; isError.value = true; }
  finally { catalogLoadingMore.value = false; }
});

onShow(async()=>{ try{await store.refreshIfStale();if(!store.user.value){uni.reLaunch({url:'/pages/login/login'});return;}await store.loadCatalogCategories(catalogItemType.value);mode.value=store.discoveryMode.value||mode.value;if(!memoryLoaded){memoryLoaded=true;await loadMemory();}if(mode.value==='recommend'&&!recommendationLoaded)await loadInitialRecommendation();}catch{} });
onPullDownRefresh(async()=>{try{await store.load(true);await Promise.all([store.loadCatalogCategories(catalogItemType.value,{force:true}),store.loadCatalogDishes({page:1,pageSize:catalogPageSize,...catalogBrowseFilters()})]);if(mode.value==='recommend'){recommendationLoaded=false;await loadInitialRecommendation();}}catch{}finally{uni.stopPullDownRefresh();}});
function changeMode(value){mode.value=value==='recommend'?'recommend':'search';store.openDiscoveryMode(mode.value);if(mode.value==='recommend'&&!recommendationLoaded)loadInitialRecommendation();}
function openVision(){uni.navigateTo({url:'/pages/vision/vision'});}
function openProfile(){uni.navigateTo({url:'/pages/health-profile/health-profile'});}
function openExplore(entry){uni.navigateTo({url:entry.route});}
function runSearchPrompt(text){query.value=text;submitSearch();}
function catalogBrowseFilters(){return{sort:sortDirection.value==='asc'?'rating_asc':'rating_desc',itemType:catalogItemType.value,catalogCategory:catalogCategory.value||undefined};}
function buildPaginationItems(currentPage,pageCount){
  const total=Math.max(1,Number(pageCount)||1); const current=Math.min(total,Math.max(1,Number(currentPage)||1)); let pages;
  if(total<=7)pages=Array.from({length:total},(_,index)=>index+1);
  else if(current<=4)pages=[1,2,3,4,5,total];
  else if(current>=total-3)pages=[1,total-4,total-3,total-2,total-1,total];
  else pages=[1,current-1,current,current+1,total];
  const items=[]; let previousPage=0;
  for(const page of pages){if(page-previousPage>1)items.push({type:'ellipsis',key:`ellipsis-${previousPage}-${page}`});items.push({type:'page',page,key:`page-${page}`});previousPage=page;}
  return items;
}
async function scrollToTop(){await nextTick();uni.pageScrollTo({selector:'#dish-results-top',scrollTop:0,duration:0});}
async function selectCatalogItemType(value){if(catalogLoadingMore.value)return;catalogLoadingMore.value=true;catalogItemType.value=value;catalogCategory.value='';message.value='';isError.value=false;try{await Promise.all([store.loadCatalogCategories(value),store.loadCatalogDishes({page:1,pageSize:catalogPageSize,...catalogBrowseFilters()})]);await scrollToTop();}catch(error){message.value=error.message||'目录分类加载失败。';isError.value=true;}finally{catalogLoadingMore.value=false;}}
async function selectCatalogCategory(value){if(catalogLoadingMore.value||catalogCategory.value===value)return;catalogLoadingMore.value=true;catalogCategory.value=value;message.value='';isError.value=false;try{await store.loadCatalogDishes({page:1,pageSize:catalogPageSize,...catalogBrowseFilters()});await scrollToTop();}catch(error){message.value=error.message||'菜品分类加载失败。';isError.value=true;}finally{catalogLoadingMore.value=false;}}
function searchPayload(page=1){return{query:query.value.trim(),filters:{itemType:catalogItemType.value,catalogCategory:catalogCategory.value||undefined,halalOnly:store.profile.value.halalOnly,avoidIngredients:[...(store.profile.value.allergies||[]),...(store.profile.value.avoid||[])]},sort:sortDirection.value==='asc'?'rating_asc':'rating_desc',page,pageSize:searchPageSize};}
async function submitSearch(){const text=query.value.trim();if(!text)return;const requestId=++searchRequestId;searching.value=true;message.value='';isError.value=false;citationsExpanded.value=false;try{const result=await store.searchDishes(searchPayload(1));if(requestId===searchRequestId)searchResult.value=result;}catch(error){if(requestId!==searchRequestId)return;isError.value=true;message.value=error.message||'检索失败，请稍后重试。';}finally{if(requestId===searchRequestId)searching.value=false;}}
async function changeSearchPage(page){const targetPage=Number(page);if(searchLoadingMore.value||!searchResult.value||!Number.isInteger(targetPage)||targetPage<1||targetPage>searchPageCount.value||targetPage===searchPage.value)return;const requestId=++searchRequestId;searchLoadingMore.value=true;message.value='';try{const result=await store.searchDishes(searchPayload(targetPage));if(requestId!==searchRequestId)return;searchResult.value=result;citationsExpanded.value=false;await scrollToTop();}catch(error){if(requestId!==searchRequestId)return;message.value=error.message||'检索分页加载失败，请重试。';isError.value=true;}finally{if(requestId===searchRequestId)searchLoadingMore.value=false;}}
async function changeCatalogPage(page){const targetPage=Number(page);if(catalogLoadingMore.value||!Number.isInteger(targetPage)||targetPage<1||targetPage>catalogPageCount.value||targetPage===catalogPage.value)return;catalogLoadingMore.value=true;message.value='';isError.value=false;try{await store.loadCatalogDishes({page:targetPage,pageSize:catalogPageSize,...catalogBrowseFilters()});await scrollToTop();}catch(error){message.value=error.message||'目录分页加载失败，请重试。';isError.value=true;}finally{catalogLoadingMore.value=false;}}
function clearSearch(){searchRequestId+=1;searchResult.value=null;query.value='';citationsExpanded.value=false;message.value='';searching.value=false;searchLoadingMore.value=false;}
function relaxationLabel(item){return typeof item==='string'?item:item?.label||item?.message||item?.field||'调整条件';}
function dishLocation(dish){const stall=store.stalls.value.find((item)=>item.id===dish.stallId);const canteen=store.canteens.value.find((item)=>item.id===stall?.canteenId);return[canteen?.name,stall?.name].filter(Boolean).join(' · ');}
function supplyState(dish){const menu=store.todayMenu.value.dishes?.find((item)=>String(item.id)===String(dish.id));return dishSupplyPresentation(dish,menu||null);}
function openDish(id){uni.navigateTo({url:`/pages/dish-detail/dish-detail?id=${encodeURIComponent(id)}`});}
function selectCitation(item){openDish(item.id||item.dishId||item.sourceId);}
async function loadMemory(){try{const result=await store.loadAgentMemory();const memory=result.memory||result;memoryDraft.value=memory.summary||'';memoryPreferences.value=memory.preferences||{};}catch{}}
async function saveMemory(){memorySaving.value=true;try{const result=await store.saveAgentMemory({summary:memoryDraft.value.trim(),preferences:memoryPreferences.value});const memory=result.memory||result;memoryDraft.value=memory.summary||'';message.value='饮食记忆已保存。';recommendMessage.value='饮食记忆已保存。';isError.value=false;recommendError.value=false;}catch(error){message.value=error.message;recommendMessage.value=error.message;isError.value=true;recommendError.value=true;}finally{memorySaving.value=false;}}
async function clearMemory(){memorySaving.value=true;try{await store.clearAgentMemory();memoryDraft.value='';memoryPreferences.value={};message.value='饮食记忆已清除。';recommendMessage.value='饮食记忆已清除。';isError.value=false;recommendError.value=false;}catch(error){message.value=error.message;recommendMessage.value=error.message;isError.value=true;recommendError.value=true;}finally{memorySaving.value=false;}}

function deterministicSummary(data){const picks=data.recommendations||data.ranked||[];if(!picks.length)return'当前没有满足全部条件且可预约的菜品，请调整条件。';return`已根据健康档案与校园稳定目录找到 ${picks.length} 个选择：${picks.slice(0,3).map((dish)=>dish.name).join('、')}。`;}
function recommendationCitations(data){const evidence=data.evidence?.dishes||[];if(evidence.length)return evidence;return(data.recommendations||data.ranked||[]).map((dish)=>({id:dish.id,name:dish.name,score:dish.recommendationScore,snippet:Array.isArray(dish.why)?dish.why.slice(0,2).join(' · '):'来源于校园稳定菜品目录。'}));}
async function loadInitialRecommendation(){recommendLoading.value=true;recommendMessage.value='';recommendError.value=false;recommendExpanded.value=false;try{const data=await store.loadRecommendation();recommendationResult.value=data;recommendCitations.value=recommendationCitations(data);conversation.value=[{role:'assistant',content:deterministicSummary(data)}];recommendationLoaded=true;}catch(error){recommendError.value=true;recommendMessage.value=error.message||'推荐加载失败。';}finally{recommendLoading.value=false;}}
async function runPrompt(raw){const text=String(raw||'').trim();const validation=validateQuestion(text);if(validation){recommendMessage.value=validation;recommendError.value=true;return;}recommendLoading.value=true;recommendMessage.value='';recommendError.value=false;recommendExpanded.value=false;conversation.value.push({role:'user',content:text});question.value='';await nextTick();try{const data=await store.runAgent({query:text,sessionId:sessionId.value||undefined});recommendationResult.value=data;sessionId.value=data.sessionId||sessionId.value;recommendCitations.value=data.citations||recommendationCitations(data);pendingActions.value=(data.actions||[]).filter((item)=>item.requiresConfirmation);conversation.value.push({role:'assistant',content:data.answer||data.summary?.text||'推荐已生成。'});recommendationLoaded=true;}catch(error){recommendError.value=true;recommendMessage.value=error.message||'智能推荐暂时不可用。';conversation.value.push({role:'assistant',content:'本次推荐没有完成，请稍后重试。'});}finally{recommendLoading.value=false;}}
function openCitation(source){const id=source.sourceId||source.dishId||source.id;if(id)openDish(id);}
function isOrderAction(action){return String(action.type||'').includes('order')||String(action.actionType||'').includes('order');}
async function confirmAction(action){try{await store.confirmAgentAction(action.id);pendingActions.value=pendingActions.value.filter((item)=>item.id!==action.id);recommendMessage.value='操作已确认。';recommendError.value=false;}catch(error){recommendMessage.value=error.message;recommendError.value=true;}}
async function rejectAction(action){try{await store.rejectAgentAction(action.id);pendingActions.value=pendingActions.value.filter((item)=>item.id!==action.id);recommendMessage.value='操作已拒绝。';recommendError.value=false;}catch(error){recommendMessage.value=error.message;recommendError.value=true;}}
</script>

<style scoped>
.mode-row { position:sticky; top:48px; z-index:12; display:grid; grid-template-columns:minmax(0,1fr) 44px; gap:8px; margin:0 -4px 16px; padding:8px 4px; background:rgba(247,248,250,.96); }
.camera-button,.profile-button { display:flex; width:44px; height:44px; align-items:center; justify-content:center; border:1px solid var(--line); border-radius:var(--radius); background:var(--surface); }
.camera-button:active,.profile-button:active { transform:translateY(1px); background:var(--surface-soft); }
.discovery-workspace,.control-column,.result-column { min-width:0; }
.shortcut-track { width:100%; margin-bottom:18px; white-space:nowrap; }
.explore-shortcuts { display:flex; gap:8px; width:max-content; padding-right:16px; }
.explore-shortcuts button { display:flex; min-width:104px; min-height:40px; align-items:center; justify-content:center; gap:7px; padding:0 12px; border:1px solid var(--line); border-radius:var(--radius); background:var(--surface); }
.explore-shortcuts button:active { transform:translateY(1px); background:var(--surface-soft); }
.explore-shortcuts text { color:var(--ink); font-size:12px; font-weight:500; }
.search-summary,.conversation-panel,.action-panel { margin-bottom:16px; padding:14px; border:1px solid var(--line); border-radius:var(--radius-large); background:var(--surface); }
.search-summary { border-color:var(--module-line); background:var(--module-soft); }
.summary-head { display:flex; align-items:center; gap:8px; }
.summary-head .ui-strong { flex:1; color:var(--ink); font-size:14px; font-weight:600; }
.summary-head button { min-height:32px; padding:0 8px; border-radius:6px; color:var(--ink-2); background:var(--surface-soft); font-size:12px; }
.source-badge { min-height:22px; padding:0 7px; border-radius:6px; color:var(--module-dark); background:#fff; font-size:12px; line-height:22px; }
.summary-copy { display:block; margin-top:8px; color:var(--ink-2); font-size:14px; line-height:1.5; }
.relaxations { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.relaxations text { min-height:22px; padding:0 7px; border-radius:6px; color:var(--warning); background:var(--warning-soft); font-size:12px; line-height:22px; }
.page-message { display:block; margin:8px 0; color:var(--ink-2); font-size:12px; }
.page-message.error,.notice.error { color:var(--danger); }
.result-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:0 0 12px; }
.catalog-type-control { margin:0 0 12px; }
.catalog-category-track { width:100%; margin:-2px 0 12px; white-space:nowrap; }
.catalog-category-row { display:flex; width:max-content; gap:7px; padding-right:12px; }
.catalog-category-row button { display:flex; min-height:34px; align-items:center; gap:5px; padding:0 11px; border:1px solid var(--line); border-radius:8px; color:var(--ink-2); background:var(--surface); font-size:12px; }
.catalog-category-row button.active { color:#fff; border-color:var(--module-accent); background:var(--module-accent); }
.category-count { opacity:.72; }
.result-eyebrow,.result-title { display:block; }
.result-eyebrow { color:var(--muted); font-size:12px; font-weight:600; }
.result-title { margin-top:3px; color:var(--ink); font-size:16px; font-weight:600; }
.dish-list,.recommend-list { display:flex; flex-direction:column; gap:0; margin-bottom:16px; padding:0 12px; border-radius:var(--radius-large); background:var(--surface); }
.dish-list :deep(.dish-card),.recommend-list :deep(.dish-card) { animation:dish-enter var(--motion-base) var(--ease-standard) both; }
.dish-list :deep(.dish-card:nth-child(2)),.recommend-list :deep(.dish-card:nth-child(2)) { animation-delay:35ms; }.dish-list :deep(.dish-card:nth-child(3)),.recommend-list :deep(.dish-card:nth-child(3)) { animation-delay:70ms; }.dish-list :deep(.dish-card:nth-child(4)),.recommend-list :deep(.dish-card:nth-child(4)) { animation-delay:105ms; }.dish-list :deep(.dish-card:nth-child(5)),.recommend-list :deep(.dish-card:nth-child(5)) { animation-delay:140ms; }.dish-list :deep(.dish-card:nth-child(6)),.recommend-list :deep(.dish-card:nth-child(6)) { animation-delay:175ms; }.dish-list :deep(.dish-card:nth-child(7)),.recommend-list :deep(.dish-card:nth-child(7)) { animation-delay:210ms; }.dish-list :deep(.dish-card:nth-child(8)),.recommend-list :deep(.dish-card:nth-child(8)) { animation-delay:245ms; }
.recommend-list { gap:10px; padding:14px 12px; }
.result-toggle { display:flex; width:100%; min-height:40px; align-items:center; justify-content:center; border-radius:var(--radius); color:var(--ink); background:var(--surface-soft); font-size:12px; font-weight:600; }
.result-toggle:active { transform:translateY(1px); opacity:.8; }
.pagination { display:flex; align-items:center; justify-content:center; gap:6px; margin:0 0 16px; flex-wrap:wrap; }
.pagination-pages { display:flex; align-items:center; justify-content:center; gap:3px; flex-wrap:wrap; }
.pagination button { min-width:32px; min-height:38px; padding:0 8px; border:1px solid var(--line); border-radius:var(--radius); color:var(--ink); background:var(--surface); font-size:12px; font-weight:600; }
.pagination button:disabled { opacity:.45; }
.pagination .pagination-page.active { color:#fff; border-color:var(--discover); background:var(--discover); opacity:1; }
.pagination-ellipsis { display:inline-flex; min-width:18px; min-height:38px; align-items:center; justify-content:center; color:var(--muted); }
.conversation-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.conversation-head view>text,.conversation-head .ui-strong { display:block; }
.conversation-head view>text { color:var(--muted); font-size:12px; font-weight:500; }
.conversation-head .ui-strong { margin-top:3px; color:var(--ink); font-size:16px; font-weight:600; }
.live { display:flex; align-items:center; gap:5px; color:var(--ink-2); font-size:12px; }
.live .ui-dot { width:5px; height:5px; border-radius:50%; background:var(--success); }
.conversation { display:flex; min-height:112px; max-height:320px; flex-direction:column; gap:8px; margin-top:14px; overflow-y:auto; }
.message { align-self:flex-start; max-width:88%; padding:10px 12px; border-radius:var(--radius); background:var(--surface-soft); }
.message.user { align-self:flex-end; color:#fff; background:var(--module-accent); }
.message.assistant { background:var(--module-soft); }
.message>text { font-size:12px; font-weight:500; opacity:.7; }
.message .ui-paragraph { margin-top:4px; font-size:14px; line-height:1.55; }
.thinking { display:flex; min-height:100px; flex-wrap:wrap; align-items:center; justify-content:center; gap:5px; color:var(--muted); }
.thinking>text:not(.ui-paragraph) { width:5px; height:5px; border-radius:50%; background:var(--ink); opacity:.5; }
.thinking .ui-paragraph { flex-basis:100%; text-align:center; font-size:12px; }
.notice { display:block; margin-top:10px; color:var(--ink-2); font-size:12px; }
.list-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.list-head>text { color:var(--ink); font-size:16px; font-weight:600; }
.action-title { display:block; color:var(--ink); font-size:14px; font-weight:600; }
.pending-action { padding:12px 0; border-bottom:1px solid var(--line); }
.pending-action>view:first-child { display:flex; justify-content:space-between; gap:12px; }
.pending-action .ui-strong { color:var(--ink); font-size:14px; font-weight:600; }
.pending-action text { color:var(--warning); font-size:12px; }
.action-buttons { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px; }
.action-buttons button:disabled { grid-column:1/3; min-height:44px; border-radius:var(--radius); color:var(--muted); background:var(--surface-soft); font-size:12px; }
.rag-warnings { display:flex; flex-direction:column; gap:6px; margin:8px 0 12px; }
.rag-warnings text { display:block; padding:8px 10px; border:1px solid var(--warning-line); border-radius:6px; color:var(--warning); background:var(--warning-soft); font-size:12px; line-height:1.5; }
@keyframes dish-enter { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
@media (min-width:600px) and (max-width:767px) { .explore-shortcuts { display:grid; width:100%; grid-template-columns:repeat(3,minmax(0,1fr)); padding-right:0; }.explore-shortcuts button { min-width:0; } }
@media (min-width:768px) {
  .mode-row { max-width:420px; margin-bottom:24px; }
  .discovery-workspace { display:grid; grid-template-columns:280px minmax(0,1fr); gap:28px; align-items:start; }
  .control-column { position:sticky; top:72px; }
  .shortcut-track { white-space:normal; }
  .explore-shortcuts { display:grid; width:100%; grid-template-columns:repeat(3,1fr); padding-right:0; }
  .explore-shortcuts button { min-width:0; }
}
@media (min-width:1024px) {
  .discovery-workspace { grid-template-columns:320px minmax(0,1fr); }
  .dish-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); column-gap:20px; align-items:start; }
  .dish-list .result-toggle,.dish-list :deep(.state-card) { grid-column:1/-1; }
}
</style>
