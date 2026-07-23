<template>
  <sc-page-shell back title="智能推荐" subtitle="档案 · 供应 · 引用" tone="core">
    <view class="recommend-top"><sc-segmented-control :model-value="'recommend'" :options="modeOptions" block @update:model-value="changeMode" /><button class="profile-button" @tap="openProfile"><view>调整档案</view></button></view>
    <sc-smart-composer
      v-model="question" v-model:memory-draft="memoryDraft" title="帮我规划这一餐" subtitle="结合健康档案、今日供应与校园评价。"
      :prompts="prompts" :loading="loading" :memory-open="memoryOpen" :memory-saving="memorySaving" action-text="生成推荐"
      @submit="runPrompt(question)" @prompt="runPrompt" @toggle-memory="memoryOpen=!memoryOpen" @save-memory="saveMemory" @clear-memory="clearMemory"
    />
    <sc-trust-bar v-if="result" :evaluation="result.eval||{}" />

    <view class="conversation-panel panel-card">
      <view class="conversation-head"><view><text>RECOMMENDATION</text><text class="ui-strong">你的用餐建议</text></view><text class="live"><text class="ui-dot"></text>{{ loading?'分析中':'数据已连接' }}</text></view>
      <view class="conversation">
        <view v-if="!conversation.length&&loading" class="thinking"><text></text><text></text><text></text><text class="ui-paragraph">正在读取健康档案与今日供应</text></view>
        <view v-for="(item,index) in conversation" :key="`${item.role}-${index}`" class="message" :class="item.role"><text>{{ item.role==='user'?'你':'智能推荐' }}</text><text class="ui-paragraph">{{ item.content }}</text></view>
      </view>
      <text v-if="message" class="notice" :class="{ error:isError }">{{ message }}</text>
    </view>

    <view v-if="mealPicks.length" class="recommend-list">
      <view class="list-head"><text>推荐菜品</text><sc-segmented-control v-model="sortDirection" :options="sortOptions" density="compact" /></view>
      <sc-dish-card v-for="dish in visibleMealPicks" :key="dish.id" :dish="dish" :location="dishLocation(dish)" badge="推荐" @tap="openDish(dish.id)" />
      <button v-if="mealPicks.length > 1" class="result-toggle" type="button" @tap="resultsExpanded = !resultsExpanded">
        {{ resultsExpanded ? '收起排名菜品' : `查看全部 ${mealPicks.length} 道排名菜品` }}
      </button>
    </view>
    <sc-state-card v-else-if="result&&!loading" type="empty" title="暂无推荐结果" desc="调整健康档案或换一种描述。" />

    <sc-citation-list :citations="citations" :expanded="citationsExpanded" @toggle="citationsExpanded=!citationsExpanded" @select="openCitation" />

    <view v-if="pendingActions.length" class="action-panel panel-card">
      <text class="action-title">待确认操作</text>
      <view v-for="action in pendingActions" :key="action.id" class="pending-action"><view><text class="ui-strong">{{ action.label||action.type }}</text><text>{{ action.riskLevel||'low' }} 风险</text></view><view class="action-buttons"><button v-if="isOrderAction(action)" disabled>联调中，暂不可确认</button><button v-else class="primary-btn" @tap="confirmAction(action)">确认</button><button class="ghost-btn" @tap="rejectAction(action)">拒绝</button></view></view>
    </view>
  </sc-page-shell>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { buildProfilePrompts, createRatingMap, sortDishesByRating } from '../../domain/studentDiscovery.js';
import { validateQuestion } from '../../domain/validation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';
const store=useCanteenStore();const modeOptions=[{value:'search',label:'菜品检索'},{value:'recommend',label:'智能推荐'}];const sortOptions=[{value:'desc',label:'高分优先'},{value:'asc',label:'低分优先'}];
const question=ref('');const loading=ref(false);const result=ref(null);const conversation=ref([]);const citations=ref([]);const pendingActions=ref([]);const sessionId=ref('');const message=ref('');const isError=ref(false);const sortDirection=ref('desc');const citationsExpanded=ref(false);const resultsExpanded=ref(false);
const memoryOpen=ref(false);const memoryDraft=ref('');const memoryPreferences=ref({});const memorySaving=ref(false);let initialized=false;
const prompts=computed(()=>buildProfilePrompts(store.profile.value,'recommend'));const ratingMap=computed(()=>createRatingMap(store.rankings.value.dishes));
const mealPicks=computed(()=>{const raw=result.value?.recommendations||result.value?.mealPlan?.dishes||result.value?.mealPlan?.picks||result.value?.ranked||[];const catalog=new Map(store.dishes.value.map((dish)=>[String(dish.id),dish]));const hydrated=raw.map((pick)=>{const id=pick.id||pick.dishId;return{...(catalog.get(String(id))||{}),...pick,id};}).filter((dish)=>dish.id);return sortDishesByRating(hydrated,ratingMap.value,sortDirection.value);});
const visibleMealPicks=computed(()=>resultsExpanded.value ? mealPicks.value : mealPicks.value.slice(0,1));
onLoad(()=>{});onShow(async()=>{try{await store.refreshIfStale();if(!store.user.value){uni.reLaunch({url:'/pages/login/login'});return;}if(!initialized){initialized=true;await Promise.all([loadMemory(),loadInitial()]);}}catch{}});
function changeMode(value){if(value==='search')uni.switchTab({url:'/pages/dishes/dishes'});}function openProfile(){uni.navigateTo({url:'/pages/health-profile/health-profile'});}function openDish(id){uni.navigateTo({url:`/pages/dish-detail/dish-detail?id=${encodeURIComponent(id)}`});}
function deterministicSummary(data){const picks=data.recommendations||data.ranked||[];if(!picks.length)return'当前没有满足全部条件且可点的菜品，请调整条件。';return`已根据健康档案与今日真实供应找到 ${picks.length} 个选择：${picks.slice(0,3).map((dish)=>dish.name).join('、')}。`;}
function recommendationCitations(data){const evidence=data.evidence?.dishes||[];if(evidence.length)return evidence;return(data.recommendations||data.ranked||[]).map((dish)=>({id:dish.id,name:dish.name,score:dish.recommendationScore,snippet:Array.isArray(dish.why)?dish.why.slice(0,2).join(' · '):'来源于当前校园菜品库与已发布菜单。'}));}
async function loadInitial(){loading.value=true;message.value='';resultsExpanded.value=false;try{const data=await store.loadRecommendation();result.value=data;citations.value=recommendationCitations(data);conversation.value=[{role:'assistant',content:deterministicSummary(data)}];}catch(error){isError.value=true;message.value=error.message||'推荐加载失败。';}finally{loading.value=false;}}
async function runPrompt(raw){const text=String(raw||'').trim();const validation=validateQuestion(text);if(validation){message.value=validation;isError.value=true;return;}loading.value=true;message.value='';isError.value=false;resultsExpanded.value=false;conversation.value.push({role:'user',content:text});question.value='';await nextTick();try{const data=await store.runAgent({query:text,sessionId:sessionId.value||undefined});result.value=data;sessionId.value=data.sessionId||sessionId.value;citations.value=data.citations||recommendationCitations(data);pendingActions.value=(data.actions||[]).filter((item)=>item.requiresConfirmation);conversation.value.push({role:'assistant',content:data.answer||data.summary?.text||'推荐已生成。'});}catch(error){isError.value=true;message.value=error.message||'智能推荐暂时不可用。';conversation.value.push({role:'assistant',content:'本次推荐没有完成，请稍后重试。'});}finally{loading.value=false;}}
function dishLocation(dish){const stall=store.stalls.value.find((item)=>item.id===dish.stallId);const canteen=store.canteens.value.find((item)=>item.id===stall?.canteenId);return[canteen?.name,stall?.name].filter(Boolean).join(' · ');}
function openCitation(source){const id=source.sourceId||source.dishId||source.id;if(id)openDish(id);}function isOrderAction(action){return String(action.type||'').includes('order')||String(action.actionType||'').includes('order');}
async function confirmAction(action){try{await store.confirmAgentAction(action.id);pendingActions.value=pendingActions.value.filter((item)=>item.id!==action.id);message.value='操作已确认。';isError.value=false;}catch(error){message.value=error.message;isError.value=true;}}
async function rejectAction(action){try{await store.rejectAgentAction(action.id);pendingActions.value=pendingActions.value.filter((item)=>item.id!==action.id);message.value='操作已拒绝。';isError.value=false;}catch(error){message.value=error.message;isError.value=true;}}
async function loadMemory(){try{const data=await store.loadAgentMemory();const memory=data.memory||data;memoryDraft.value=memory.summary||'';memoryPreferences.value=memory.preferences||{};}catch{}}
async function saveMemory(){memorySaving.value=true;try{const data=await store.saveAgentMemory({summary:memoryDraft.value.trim(),preferences:memoryPreferences.value});const memory=data.memory||data;memoryDraft.value=memory.summary||'';message.value='推荐记忆已保存。';isError.value=false;}catch(error){message.value=error.message;isError.value=true;}finally{memorySaving.value=false;}}
async function clearMemory(){memorySaving.value=true;try{await store.clearAgentMemory();memoryDraft.value='';memoryPreferences.value={};message.value='推荐记忆已清除。';isError.value=false;}catch(error){message.value=error.message;isError.value=true;}finally{memorySaving.value=false;}}
</script>

<style scoped>
.recommend-top { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:12rpx; align-items:center; margin-bottom:22rpx; }
.profile-button { display:flex; align-items:center; justify-content:center; min-height:88rpx; padding:0 8rpx; background:transparent; }
.profile-button>view { display:flex; align-items:center; justify-content:center; min-height:56rpx; padding:0 14rpx; border-radius:10rpx; color:var(--brand); background:var(--brand-soft); font-size:24rpx; font-weight:500; white-space:nowrap; }
.profile-button:active>view { transform:scale(.97); }
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
.result-toggle { display:flex; align-items:center; justify-content:center; width:100%; min-height:76rpx; margin-top:2rpx; border:1rpx solid var(--line); border-radius:var(--radius); color:var(--brand); background:var(--surface); font-size:24rpx; font-weight:500; }
.result-toggle:active { background:var(--brand-soft); transform:scale(.985); }
</style>
