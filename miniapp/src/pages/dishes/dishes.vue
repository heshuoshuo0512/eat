<template>
  <sc-page-shell title="找菜">
    <view class="mode-row">
      <sc-segmented-control v-model="mode" :options="modeOptions" block @update:model-value="changeMode" />
      <button v-if="mode === 'search'" class="camera-button" aria-label="拍照识餐" @tap="openVision"><image src="/static/icons/camera-line.png" mode="aspectFit" /></button>
      <button v-else class="profile-button" aria-label="打开健康档案" @tap="openProfile"><view>档案</view></button>
    </view>

    <template v-if="mode === 'search'">
      <sc-smart-composer
        v-model="query" v-model:memory-draft="memoryDraft" title="帮我找菜"
        subtitle="快捷问题会随健康档案、预算和忌口变化。" :prompts="searchPrompts" :loading="searching"
        :memory-open="memoryOpen" :memory-saving="memorySaving" @submit="submitSearch" @prompt="runSearchPrompt"
        @toggle-memory="memoryOpen=!memoryOpen" @save-memory="saveMemory" @clear-memory="clearMemory"
      />

      <view class="explore-shortcuts">
        <button v-for="entry in exploreEntries" :key="entry.id" @tap="openExplore(entry)">
          <view><image :src="entry.icon" mode="aspectFit" /></view><text>{{ entry.shortLabel }}</text>
        </button>
      </view>

      <view v-if="searchResult" class="search-summary panel-card">
        <view class="summary-head"><text class="source-badge">{{ searchResult.meta?.semanticUsed ? '语义检索' : '规则检索' }}</text><text class="ui-strong">检索结论</text><button @tap="clearSearch">清除条件</button></view>
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
        <sc-dish-card v-for="dish in visibleDishes" :key="dish.id" :dish="dish" :location="dishLocation(dish)" :supply-status="supplyState(dish).label" :unavailable="!supplyState(dish).canOrder" @tap="openDish(dish.id)" />
        <sc-state-card v-if="!sortedDishes.length" type="empty" title="没有匹配菜品" desc="调整描述后重新搜索。" action-text="查看全部" @action="clearSearch" />
        <button v-if="searchResult && sortedDishes.length > 1" class="result-toggle" type="button" @tap="resultsExpanded = !resultsExpanded">
          {{ resultsExpanded ? '收起排名菜品' : `查看全部 ${sortedDishes.length} 道排名菜品` }}
        </button>
      </view>

      <sc-citation-list v-if="searchResult" :citations="searchResult.items||[]" :expanded="citationsExpanded" @toggle="citationsExpanded=!citationsExpanded" @select="selectCitation" />
    </template>

    <template v-else>
      <sc-smart-composer
        v-model="question" v-model:memory-draft="memoryDraft" title="帮我规划这一餐" subtitle="结合健康档案、今日供应与校园评价。"
        :prompts="recommendPrompts" :loading="recommendLoading" :memory-open="memoryOpen" :memory-saving="memorySaving" action-text="生成推荐"
        @submit="runPrompt(question)" @prompt="runPrompt" @toggle-memory="memoryOpen=!memoryOpen" @save-memory="saveMemory" @clear-memory="clearMemory"
      />
      <sc-trust-bar v-if="recommendationResult" :evaluation="recommendationResult.eval||{}" />

      <view class="conversation-panel panel-card">
        <view class="conversation-head"><view><text>RECOMMENDATION</text><text class="ui-strong">你的用餐建议</text></view><text class="live"><text class="ui-dot"></text>{{ recommendLoading?'分析中':'数据已连接' }}</text></view>
        <view class="conversation">
          <view v-if="!conversation.length&&recommendLoading" class="thinking"><text></text><text></text><text></text><text class="ui-paragraph">正在读取健康档案与今日供应</text></view>
          <view v-for="(item,index) in conversation" :key="`${item.role}-${index}`" class="message" :class="item.role"><text>{{ item.role==='user'?'你':'智能推荐' }}</text><text class="ui-paragraph">{{ item.content }}</text></view>
        </view>
        <text v-if="recommendMessage" class="notice" :class="{ error:recommendError }">{{ recommendMessage }}</text>
      </view>

      <view v-if="mealPicks.length" class="recommend-list">
        <view class="list-head"><text>推荐菜品</text><sc-segmented-control v-model="recommendSort" :options="sortOptions" density="compact" /></view>
        <sc-dish-card v-for="dish in visibleMealPicks" :key="dish.id" :dish="dish" :location="dishLocation(dish)" badge="推荐" @tap="openDish(dish.id)" />
        <button v-if="mealPicks.length > 1" class="result-toggle" type="button" @tap="recommendExpanded = !recommendExpanded">
          {{ recommendExpanded ? '收起排名菜品' : `查看全部 ${mealPicks.length} 道排名菜品` }}
        </button>
      </view>
      <sc-state-card v-else-if="recommendationResult&&!recommendLoading" type="empty" title="暂无推荐结果" desc="调整健康档案或换一种描述。" />

      <sc-citation-list :citations="recommendCitations" :expanded="recommendCitationsExpanded" @toggle="recommendCitationsExpanded=!recommendCitationsExpanded" @select="openCitation" />

      <view v-if="pendingActions.length" class="action-panel panel-card">
        <text class="action-title">待确认操作</text>
        <view v-for="action in pendingActions" :key="action.id" class="pending-action"><view><text class="ui-strong">{{ action.label||action.type }}</text><text>{{ action.riskLevel||'low' }} 风险</text></view><view class="action-buttons"><button v-if="isOrderAction(action)" disabled>联调中，暂不可确认</button><button v-else class="primary-btn" @tap="confirmAction(action)">确认</button><button class="ghost-btn" @tap="rejectAction(action)">拒绝</button></view></view>
      </view>
    </template>
  </sc-page-shell>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { buildProfilePrompts, createRatingMap, sortDishesByRating } from '../../domain/studentDiscovery.js';
import { validateQuestion } from '../../domain/validation.js';
import { EXPLORE_ENTRY_IDS, getStudentEntries } from '../../domain/studentNavigation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store=useCanteenStore();
const exploreEntries=getStudentEntries(EXPLORE_ENTRY_IDS);
const modeOptions=[{value:'search',label:'菜品检索'},{value:'recommend',label:'智能推荐'}];
const sortOptions=[{value:'desc',label:'高分优先'},{value:'asc',label:'低分优先'}];
const mode=ref(store.discoveryMode.value || 'search');
const query=ref(''); const searching=ref(false); const searchResult=ref(null); const sortDirection=ref('desc'); const message=ref(''); const isError=ref(false); const citationsExpanded=ref(false); const resultsExpanded=ref(false);
const question=ref(''); const recommendLoading=ref(false); const recommendationResult=ref(null); const conversation=ref([]); const recommendCitations=ref([]); const pendingActions=ref([]); const sessionId=ref(''); const recommendMessage=ref(''); const recommendError=ref(false); const recommendSort=ref('desc'); const recommendCitationsExpanded=ref(false); const recommendExpanded=ref(false); let recommendationLoaded=false;
const memoryOpen=ref(false); const memoryDraft=ref(''); const memoryPreferences=ref({}); const memorySaving=ref(false); let memoryLoaded=false;
const searchPrompts=computed(()=>buildProfilePrompts(store.profile.value,'search'));
const recommendPrompts=computed(()=>buildProfilePrompts(store.profile.value,'recommend'));
const ratingMap=computed(()=>createRatingMap(store.rankings.value.dishes));
const sourceDishes=computed(()=>searchResult.value?.items || store.dishes.value.filter((dish)=>dish.status!=='archived'&&dish.status!=='inactive'));
const sortedDishes=computed(()=>sortDishesByRating(sourceDishes.value,ratingMap.value,sortDirection.value));
const visibleDishes=computed(()=>!searchResult.value || resultsExpanded.value ? sortedDishes.value : sortedDishes.value.slice(0,1));
const resultSummary=computed(()=>{ const result=searchResult.value;if(!result)return'';const total=Number(result.availability?.totalCount??result.items?.length??0);const orderable=Number(result.availability?.orderableCount??result.items?.filter((dish)=>dish.availability?.orderable).length??0);return total?`找到 ${total} 道真实菜品，其中 ${orderable} 道当前可点。`:'没有满足全部条件的真实菜品，可参考放宽建议。'; });
const mealPicks=computed(()=>{const raw=recommendationResult.value?.recommendations||recommendationResult.value?.mealPlan?.dishes||recommendationResult.value?.mealPlan?.picks||recommendationResult.value?.ranked||[];const catalog=new Map(store.dishes.value.map((dish)=>[String(dish.id),dish]));const hydrated=raw.map((pick)=>{const id=pick.id||pick.dishId;return{...(catalog.get(String(id))||{}),...pick,id};}).filter((dish)=>dish.id);return sortDishesByRating(hydrated,ratingMap.value,recommendSort.value);});
const visibleMealPicks=computed(()=>recommendExpanded.value ? mealPicks.value : mealPicks.value.slice(0,1));

onShow(async()=>{ try{await store.refreshIfStale();if(!store.user.value){uni.reLaunch({url:'/pages/login/login'});return;}mode.value=store.discoveryMode.value||mode.value;if(!memoryLoaded){memoryLoaded=true;await loadMemory();}if(mode.value==='recommend'&&!recommendationLoaded)await loadInitialRecommendation();}catch{} });
onPullDownRefresh(async()=>{try{await store.load(true);if(mode.value==='recommend'){recommendationLoaded=false;await loadInitialRecommendation();}}catch{}finally{uni.stopPullDownRefresh();}});

function changeMode(value){mode.value=value==='recommend'?'recommend':'search';store.openDiscoveryMode(mode.value);if(mode.value==='recommend'&&!recommendationLoaded)loadInitialRecommendation();}
function openVision(){uni.navigateTo({url:'/pages/vision/vision'});}
function openProfile(){uni.navigateTo({url:'/pages/health-profile/health-profile'});}
function openExplore(entry){uni.navigateTo({url:entry.route});}
function runSearchPrompt(text){query.value=text;submitSearch();}
async function submitSearch(){const text=query.value.trim();if(!text)return;searching.value=true;message.value='';isError.value=false;citationsExpanded.value=false;resultsExpanded.value=false;try{searchResult.value=await store.searchDishes({query:text,filters:{budgetMax:store.profile.value.budgetMax,taste:store.profile.value.taste!=='不限'?store.profile.value.taste:undefined,halalOnly:store.profile.value.halalOnly,mealType:store.profile.value.mealType,avoidIngredients:[...(store.profile.value.allergies||[]),...(store.profile.value.avoid||[])]},sort:'relevance',limit:50,offset:0});}catch(error){isError.value=true;message.value=error.message||'检索失败，请稍后重试。';}finally{searching.value=false;}}
function clearSearch(){searchResult.value=null;query.value='';citationsExpanded.value=false;resultsExpanded.value=false;message.value='';}
function relaxationLabel(item){return typeof item==='string'?item:item?.label||item?.message||item?.field||'调整条件';}
function dishLocation(dish){const stall=store.stalls.value.find((item)=>item.id===dish.stallId);const canteen=store.canteens.value.find((item)=>item.id===stall?.canteenId);return[canteen?.name,stall?.name].filter(Boolean).join(' · ');}
function supplyState(dish){if(dish.availability){return{label:dish.availability.reason||({available:'今日可点',limited:'库存紧张',sold_out:'今日售罄',off_menu:'非今日供应'}[dish.availability.status]||'当前不可点'),canOrder:dish.availability.orderable===true};}const menu=store.todayMenu.value.dishes?.find((item)=>String(item.id)===String(dish.id));if(!menu)return{label:'非今日供应',canOrder:false};if(menu.supplyStatus==='sold_out')return{label:'今日售罄',canOrder:false};return{label:menu.supplyStatus==='limited'?'库存紧张':'今日可点',canOrder:true};}
function openDish(id){uni.navigateTo({url:`/pages/dish-detail/dish-detail?id=${encodeURIComponent(id)}`});}
function selectCitation(item){openDish(item.id||item.dishId||item.sourceId);}
async function loadMemory(){try{const result=await store.loadAgentMemory();const memory=result.memory||result;memoryDraft.value=memory.summary||'';memoryPreferences.value=memory.preferences||{};}catch{}}
async function saveMemory(){memorySaving.value=true;try{const result=await store.saveAgentMemory({summary:memoryDraft.value.trim(),preferences:memoryPreferences.value});const memory=result.memory||result;memoryDraft.value=memory.summary||'';message.value='饮食记忆已保存。';recommendMessage.value='饮食记忆已保存。';isError.value=false;recommendError.value=false;}catch(error){message.value=error.message;recommendMessage.value=error.message;isError.value=true;recommendError.value=true;}finally{memorySaving.value=false;}}
async function clearMemory(){memorySaving.value=true;try{await store.clearAgentMemory();memoryDraft.value='';memoryPreferences.value={};message.value='饮食记忆已清除。';recommendMessage.value='饮食记忆已清除。';isError.value=false;recommendError.value=false;}catch(error){message.value=error.message;recommendMessage.value=error.message;isError.value=true;recommendError.value=true;}finally{memorySaving.value=false;}}

function deterministicSummary(data){const picks=data.recommendations||data.ranked||[];if(!picks.length)return'当前没有满足全部条件且可点的菜品，请调整条件。';return`已根据健康档案与今日真实供应找到 ${picks.length} 个选择：${picks.slice(0,3).map((dish)=>dish.name).join('、')}。`;}
function recommendationCitations(data){const evidence=data.evidence?.dishes||[];if(evidence.length)return evidence;return(data.recommendations||data.ranked||[]).map((dish)=>({id:dish.id,name:dish.name,score:dish.recommendationScore,snippet:Array.isArray(dish.why)?dish.why.slice(0,2).join(' · '):'来源于当前校园菜品库与已发布菜单。'}));}
async function loadInitialRecommendation(){recommendLoading.value=true;recommendMessage.value='';recommendError.value=false;recommendExpanded.value=false;try{const data=await store.loadRecommendation();recommendationResult.value=data;recommendCitations.value=recommendationCitations(data);conversation.value=[{role:'assistant',content:deterministicSummary(data)}];recommendationLoaded=true;}catch(error){recommendError.value=true;recommendMessage.value=error.message||'推荐加载失败。';}finally{recommendLoading.value=false;}}
async function runPrompt(raw){const text=String(raw||'').trim();const validation=validateQuestion(text);if(validation){recommendMessage.value=validation;recommendError.value=true;return;}recommendLoading.value=true;recommendMessage.value='';recommendError.value=false;recommendExpanded.value=false;conversation.value.push({role:'user',content:text});question.value='';await nextTick();try{const data=await store.runAgent({query:text,sessionId:sessionId.value||undefined});recommendationResult.value=data;sessionId.value=data.sessionId||sessionId.value;recommendCitations.value=data.citations||recommendationCitations(data);pendingActions.value=(data.actions||[]).filter((item)=>item.requiresConfirmation);conversation.value.push({role:'assistant',content:data.answer||data.summary?.text||'推荐已生成。'});recommendationLoaded=true;}catch(error){recommendError.value=true;recommendMessage.value=error.message||'智能推荐暂时不可用。';conversation.value.push({role:'assistant',content:'本次推荐没有完成，请稍后重试。'});}finally{recommendLoading.value=false;}}
function openCitation(source){const id=source.sourceId||source.dishId||source.id;if(id)openDish(id);}
function isOrderAction(action){return String(action.type||'').includes('order')||String(action.actionType||'').includes('order');}
async function confirmAction(action){try{await store.confirmAgentAction(action.id);pendingActions.value=pendingActions.value.filter((item)=>item.id!==action.id);recommendMessage.value='操作已确认。';recommendError.value=false;}catch(error){recommendMessage.value=error.message;recommendError.value=true;}}
async function rejectAction(action){try{await store.rejectAgentAction(action.id);pendingActions.value=pendingActions.value.filter((item)=>item.id!==action.id);recommendMessage.value='操作已拒绝。';recommendError.value=false;}catch(error){recommendMessage.value=error.message;recommendError.value=true;}}
</script>

<style scoped>
.mode-row { display:grid; grid-template-columns:minmax(0,1fr) 88rpx; gap:12rpx; margin-bottom:24rpx; }
.camera-button { display:flex; align-items:center; justify-content:center; width:88rpx; height:88rpx; padding:0; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); }
.camera-button image { width:38rpx; height:38rpx; }
.profile-button { display:flex; align-items:center; justify-content:center; width:88rpx; height:88rpx; padding:0; background:transparent; }
.profile-button>view { display:flex; align-items:center; justify-content:center; min-height:56rpx; padding:0 12rpx; border-radius:10rpx; color:var(--brand); background:var(--brand-soft); font-size:22rpx; font-weight:500; white-space:nowrap; }
.profile-button:active>view { transform:scale(.97); }
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
.result-toggle { display:flex; align-items:center; justify-content:center; width:100%; min-height:76rpx; margin-top:2rpx; border:1rpx solid var(--line); border-radius:var(--radius); color:var(--brand); background:var(--surface); font-size:24rpx; font-weight:500; }
.result-toggle:active { background:var(--brand-soft); transform:scale(.985); }
.conversation-panel { padding:22rpx; }
.conversation-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12rpx; }
.conversation-head view>text,.conversation-head .ui-strong { display:block; }
.conversation-head view>text { color:var(--brand); font-size:22rpx; font-weight:500; }
.conversation-head .ui-strong { margin-top:4rpx; color:var(--ink); font-size:30rpx; font-weight:600; }
.live { display:flex; align-items:center; gap:7rpx; color:var(--brand); font-size:22rpx; }
.live .ui-dot { width:9rpx; height:9rpx; border-radius:50%; background:var(--brand); }
.conversation { display:flex; flex-direction:column; gap:12rpx; min-height:180rpx; max-height:560rpx; margin-top:18rpx; overflow-y:auto; }
.message { align-self:flex-start; max-width:88%; padding:16rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface-soft); }
.message.user { align-self:flex-end; color:#fff; border-color:var(--brand); background:var(--brand); }
.message>text { font-size:22rpx; font-weight:500; opacity:.76; }
.message .ui-paragraph { margin:6rpx 0 0; font-size:26rpx; line-height:1.58; white-space:pre-wrap; }
.thinking { display:flex; align-items:center; justify-content:center; gap:7rpx; min-height:160rpx; flex-wrap:wrap; color:var(--muted); }
.thinking text { width:10rpx; height:10rpx; border-radius:50%; background:var(--brand); opacity:.6; }
.thinking .ui-paragraph { flex-basis:100%; text-align:center; font-size:24rpx; }
.notice { display:block; margin-top:14rpx; color:var(--brand); font-size:24rpx; }
.notice.error { color:var(--danger); }
.recommend-list { display:flex; flex-direction:column; gap:12rpx; margin-bottom:22rpx; }
.list-head { display:flex; align-items:center; justify-content:space-between; gap:12rpx; }
.list-head>text { color:var(--ink); font-size:30rpx; font-weight:600; }
.action-panel { padding:22rpx; }
.action-title { display:block; color:var(--ink); font-size:28rpx; font-weight:600; }
.pending-action { padding:18rpx 0; border-bottom:1rpx solid var(--line); }
.pending-action>view:first-child { display:flex; justify-content:space-between; gap:12rpx; }
.pending-action .ui-strong { color:var(--ink); font-size:26rpx; font-weight:600; }
.pending-action text { color:#966218; font-size:22rpx; }
.action-buttons { display:grid; grid-template-columns:1fr 1fr; gap:10rpx; margin-top:12rpx; }
.action-buttons button:disabled { grid-column:1/3; min-height:88rpx; border-radius:var(--radius); color:var(--muted); background:var(--surface-soft); font-size:24rpx; }
</style>
