<template>
  <div class="page">
    <div v-if="!staff" class="login-wrap">
      <form class="login-panel" @submit.prevent="login"><div class="login-icon"><ShieldCheck :size="28" /></div><h1>采集审核工作台</h1><p>仅限 collector_reviewer 与 collector_admin。</p><div class="field"><label for="username">用户名</label><input id="username" v-model="credentials.username" autocomplete="username" /></div><div class="field"><label for="password">密码</label><input id="password" v-model="credentials.password" type="password" autocomplete="current-password" /></div><div v-if="error" class="notice error">{{ error }}</div><button class="button" :disabled="busy"><LogIn :size="17" />登录</button></form>
    </div>
    <template v-else>
      <div class="page-heading"><div><h1>匿名图片审核</h1><p>不展示贡献者身份。通过或改标时必须确认当前分组内的具体目录菜品。</p></div><div class="staff-actions"><router-link v-if="staff.role === 'collector_admin'" class="button secondary" to="/admin"><Settings2 :size="17" />分组管理</router-link><button class="button secondary icon" title="退出登录" aria-label="退出登录" @click="logout"><LogOut :size="18" /></button></div></div>
      <div class="tabs"><button v-for="tab in tabs" :key="tab.value" :class="{active: status===tab.value}" @click="status=tab.value;loadQueue()">{{ tab.label }}</button></div>
      <div v-if="error" class="notice error">{{ error }}</div>
      <div v-if="loading" class="empty"><span class="spinner"></span></div>
      <div v-else-if="!queue.length" class="empty"><Inbox :size="32" /><p>当前队列没有待处理图片</p></div>
      <div v-else class="review-list">
        <article v-for="item in queue" :key="item.id">
          <div class="review-image"><img :src="assetUrl(item.imageUrl)" alt="待审核餐食图片" /><span v-if="item.duplicateFlag"><Copy :size="13" />近似重复</span></div>
          <div class="review-info"><div class="meta"><span>{{ item.group }}</span><span>第 {{ item.reviewStage }} 阶段</span><span v-if="item.needsSecondReview">抽样复审</span></div><h2>{{ item.claimedName }}</h2><p v-if="item.aiNames.length">AI 建议：{{ item.aiNames.join('、') }}</p><div v-if="item.selectedDish" class="selected-dish"><Utensils :size="17" /><span><strong>{{ item.selectedDish.name }}</strong>{{ item.selectedDish.venue }} · {{ item.selectedDish.stall }}</span></div><div class="review-controls"><div class="field"><label>目录菜品</label><div class="search-row"><input v-model="forms[item.id].term" placeholder="搜索菜名" @keyup.enter="search(item)" /><button class="button secondary icon small" @click="search(item)"><Search :size="16" /></button></div></div><select v-if="forms[item.id].matches.length" v-model="forms[item.id].dishId"><option value="">请选择搜索结果</option><option v-for="dish in forms[item.id].matches" :key="dish.dishId" :value="dish.dishId">{{ dish.name }}｜{{ dish.venue.name }} · {{ dish.stall.name }}</option></select><div class="decision-row"><button class="button approve" @click="decide(item, item.status==='needs_mapping' ? 'map' : forms[item.id].dishId && forms[item.id].dishId !== item.selectedDish?.id ? 'relabel' : 'approve')"><Check :size="16" />通过</button><select v-model="forms[item.id].reason"><option value="">选择驳回原因</option><option v-for="reason in rejectReasons" :key="reason" :value="reason">{{ reason }}</option></select><button class="button danger" :disabled="!forms[item.id].reason" @click="decide(item,'reject')"><X :size="16" />驳回</button></div></div></div>
        </article>
      </div>
    </template>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { Check, Copy, Inbox, LogIn, LogOut, Search, Settings2, ShieldCheck, Utensils, X } from '@lucide/vue';
import { assetUrl, collectorApi } from '../api.js';
const staff=ref(null), queue=ref([]), loading=ref(false), busy=ref(false), error=ref(''), status=ref('pending_review');
const credentials=reactive({username:'',password:''}); const forms=reactive({});
const tabs=[{value:'pending_review',label:'待审核'},{value:'needs_mapping',label:'待映射'}];
const rejectReasons=['多道菜','画面模糊','非餐食','错误标签','重复图片','包含人脸或个人信息'];
async function probe(){ try { staff.value=(await collectorApi.staffMe()).staff; if(staff.value) await loadQueue(); } catch{} }
async function login(){ busy.value=true;error.value='';try{staff.value=(await collectorApi.login(credentials.username,credentials.password)).staff;await loadQueue();}catch(reason){error.value=reason.message;}finally{busy.value=false;} }
async function logout(){ await collectorApi.logout();staff.value=null;queue.value=[]; }
async function loadQueue(){ loading.value=true;error.value='';try{queue.value=(await collectorApi.reviewQueue(status.value)).submissions;for(const item of queue.value)forms[item.id]={term:item.selectedDish?.name||item.claimedName,dishId:item.selectedDish?.id||'',reason:'',matches:[]};}catch(reason){if(reason.status===401)staff.value=null;else error.value=reason.message;}finally{loading.value=false;} }
async function search(item){try{forms[item.id].matches=(await collectorApi.search(item.groupId,forms[item.id].term)).matches;if(forms[item.id].matches.length===1)forms[item.id].dishId=forms[item.id].matches[0].dishId;}catch(reason){error.value=reason.message;} }
async function decide(item,action){const form=forms[item.id];const dishId=form.dishId||item.selectedDish?.id||null;if(action!=='reject'&&!dishId){error.value='请先选择目录菜品';return;}try{await collectorApi.review(item.id,{action,dishId,reason:form.reason});await loadQueue();}catch(reason){error.value=reason.message;} }
onMounted(probe);
</script>

<style scoped>
.login-wrap { display:grid; min-height:calc(100vh - 190px); place-items:center; }.login-panel { display:grid; width:min(400px,100%); gap:16px; padding:28px; border:1px solid var(--line); border-radius:6px; background:white; box-shadow:var(--shadow); }.login-panel h1,.login-panel p{text-align:center}.login-panel h1{margin:0;font-size:22px}.login-panel p{margin:-8px 0 4px;color:var(--muted);font-size:12px}.login-icon{display:grid;width:54px;height:54px;margin:auto;place-items:center;border-radius:50%;color:white;background:var(--brand)}
.staff-actions,.tabs,.decision-row,.search-row{display:flex;gap:8px}.tabs{margin-bottom:16px;border-bottom:1px solid var(--line)}.tabs button{padding:10px 16px;border:0;border-bottom:2px solid transparent;color:var(--muted);background:transparent;cursor:pointer}.tabs button.active{border-bottom-color:var(--brand);color:var(--brand);font-weight:700}
.review-list{display:grid;gap:14px}.review-list article{display:grid;grid-template-columns:280px minmax(0,1fr);overflow:hidden;border:1px solid var(--line);border-radius:6px;background:white;box-shadow:var(--shadow)}.review-image{position:relative;min-height:330px;background:#24272a}.review-image img{width:100%;height:100%;object-fit:contain}.review-image span{position:absolute;left:10px;top:10px;display:flex;align-items:center;gap:5px;padding:5px 7px;border-radius:4px;color:#754d07;background:var(--amber-soft);font-size:11px}.review-info{min-width:0;padding:20px}.meta{display:flex;flex-wrap:wrap;gap:6px}.meta span{padding:3px 6px;border-radius:3px;color:#536170;background:#eef2f5;font-size:10px}.review-info h2{margin:10px 0 5px;font-size:20px}.review-info>p{margin:0;color:var(--muted);font-size:12px}.selected-dish{display:flex;gap:8px;margin:14px 0;padding:11px;color:var(--green);background:var(--green-soft)}.selected-dish strong,.selected-dish span{display:block}.selected-dish span{color:#4b5550;font-size:11px}.selected-dish strong{margin-bottom:3px;color:#1b5b45;font-size:13px}.review-controls{display:grid;gap:10px}.search-row input{flex:1;min-width:0;height:36px;padding:0 10px;border:1px solid #cfd3d7;border-radius:4px}.review-controls>select,.decision-row select{min-width:0;height:38px;padding:0 8px;border:1px solid #cfd3d7;border-radius:4px;background:white}.decision-row{display:grid;grid-template-columns:auto minmax(150px,1fr) auto}.approve{background:var(--green)}.approve:hover{background:#0e6446}
@media(max-width:760px){.review-list article{grid-template-columns:1fr}.review-image{min-height:280px}.decision-row{grid-template-columns:1fr 1fr}.decision-row select{grid-column:1/-1;grid-row:1}.staff-actions .button.secondary:first-child{font-size:0}.staff-actions .button.secondary:first-child svg{margin:0}}
</style>
