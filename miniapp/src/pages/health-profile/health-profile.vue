<template>
  <sc-page-shell back title="健康档案" subtitle="保存后立即刷新推荐" tone="health">
    <view class="profile-status" :class="{ complete:form.allergyStatus!=='unknown' }"><view><text>档案状态</text><text class="ui-strong">{{ statusLabel }}</text></view><text>{{ form.allergyStatus==='unknown'?'先确认饮食安全信息':'可继续补充用餐偏好' }}</text></view>
    <view class="profile-progress"><view class="active"><text>1</text><text>安全限制</text></view><view :class="{ active:form.allergyStatus!=='unknown' }"><text>2</text><text>用餐偏好</text></view></view>

    <view class="profile-grid">
    <view class="form-section safety-section">
      <view class="section-head"><text class="section-index">01</text><view><text class="section-title">安全与饮食限制</text><text class="section-desc">以下限制不会被推荐自动放宽</text></view></view>
      <text class="field-label">已知食物过敏情况 <text class="required">必选</text></text>
      <radio-group class="allergy-options" @change="form.allergyStatus=$event.detail.value">
        <label :class="{ active:form.allergyStatus==='none' }"><radio value="none" :checked="form.allergyStatus==='none'" color="#238460" /><view><text class="ui-strong">暂无已知过敏</text><text>我确认目前没有已知食物过敏</text></view></label>
        <label :class="{ active:form.allergyStatus==='declared' }"><radio value="declared" :checked="form.allergyStatus==='declared'" color="#238460" /><view><text class="ui-strong">有已知过敏原</text><text>严格排除填写的食材</text></view></label>
      </radio-group>
      <label v-if="form.allergyStatus==='declared'" class="text-field"><text>过敏原</text><input v-model="allergiesText" maxlength="120" placeholder="如：花生, 虾, 牛奶" /></label>
      <label class="text-field"><text>普通忌口</text><input v-model="avoidText" maxlength="120" placeholder="如：香菜, 动物内脏" /></label>
      <label class="text-field"><text>饮食模式</text><picker :range="patternOptions" range-key="label" :value="patternIndex" @change="pickPattern"><view class="picker-box">{{ selectedPattern.label }}<text>⌄</text></view></picker></label>
      <view class="switch-row"><view><text class="ui-strong">仅清真</text><text>筛除未标记为清真的菜品</text></view><wd-switch :model-value="form.halalOnly" size="24" @update:model-value="form.halalOnly=Boolean($event)" /></view>
    </view>

    <view class="form-section">
      <view class="section-head"><text class="section-index">02</text><view><text class="section-title">用餐偏好</text><text class="section-desc">除预算外都可以保持不限</text></view></view>
      <view class="field-grid">
        <label><text>饮食目标</text><picker :range="goalOptions" range-key="label" :value="goalIndex" @change="pickGoal"><view class="picker-box">{{ selectedGoal.label }}<text>⌄</text></view></picker></label>
        <label><text>常用餐次</text><picker :range="mealOptions" range-key="label" :value="mealIndex" @change="pickMeal"><view class="picker-box">{{ selectedMeal.label }}<text>⌄</text></view></picker></label>
        <label><text>口味偏好</text><picker :range="tasteOptions" range-key="label" :value="tasteIndex" @change="pickTaste"><view class="picker-box">{{ selectedTaste.label }}<text>⌄</text></view></picker></label>
        <label><text>辣度偏好</text><picker :range="spiceOptions" range-key="label" :value="spiceIndex" @change="pickSpice"><view class="picker-box">{{ selectedSpice.label }}<text>⌄</text></view></picker></label>
      </view>
      <view class="budget-field"><view><text>预算上限</text><text class="ui-strong">¥{{ form.budgetMax }}</text></view><slider :value="form.budgetMax" min="8" max="80" step="1" activeColor="#238460" backgroundColor="#E6E8EC" block-size="22" @changing="setBudget" @change="setBudget" /></view>
      <text class="field-label nutrition-label">营养关注</text>
      <view class="chip-grid"><button v-for="option in nutritionOptions" :key="option.value" :class="{ active:form.nutritionFocus.includes(option.value) }" @tap="toggleNutrition(option.value)"><view>{{ option.label }}</view></button></view>
      <label class="text-field"><text>喜爱标签</text><input v-model="favoriteTagsText" maxlength="120" placeholder="如：高蛋白, 低脂, 快手" /></label>
      <view class="switch-row"><view><text class="ui-strong">偏好低人流食堂</text><text>排序时优先考虑排队压力</text></view><wd-switch :model-value="form.preferLowCrowd" size="24" @update:model-value="form.preferLowCrowd=Boolean($event)" /></view>
    </view>
    </view>

    <button class="save-button" :loading="saving" :disabled="saving" @tap="save">{{ saving?'正在保存':'保存健康档案' }}</button>
    <text v-if="message" class="message" :class="{ error:isError }">{{ message }}</text>
  </sc-page-shell>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { triggerHaptic } from '../../composables/useInteractionFeedback.js';
import { normalizeProfileInput } from '../../domain/validation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store=useCanteenStore();
const goalOptions=[{value:'healthy',label:'健康饮食'},{value:'fatLoss',label:'减脂'},{value:'muscleGain',label:'增肌'},{value:'maintain',label:'维持体重'}];
const mealOptions=[{value:'breakfast',label:'早餐'},{value:'lunch',label:'午餐'},{value:'dinner',label:'晚餐'}];
const tasteOptions=['不限','咸鲜','麻辣','酸辣','黑椒','清淡','甜味','酱香'].map((value)=>({value,label:value}));
const patternOptions=[{value:'unrestricted',label:'无特殊限制'},{value:'pescatarian',label:'鱼素'},{value:'vegetarian',label:'素食'},{value:'vegan',label:'纯素'}];
const spiceOptions=[{value:0,label:'不限'},{value:1,label:'不辣'},{value:2,label:'微辣'},{value:3,label:'中辣'},{value:4,label:'重辣'},{value:5,label:'极辣'}];
const nutritionOptions=[{value:'highProtein',label:'高蛋白'},{value:'lowFat',label:'低脂'},{value:'lowCarb',label:'低碳水'},{value:'highFiber',label:'高纤维'},{value:'lowSodium',label:'低钠'},{value:'lowSugar',label:'低糖'}];
const form=reactive({goal:'healthy',mealType:'lunch',budgetMax:20,taste:'不限',dietaryPattern:'unrestricted',spiceLevel:0,nutritionFocus:[],halalOnly:false,preferLowCrowd:false,allergyStatus:'unknown'});
const allergiesText=ref('');const avoidText=ref('');const favoriteTagsText=ref('');const saving=ref(false);const message=ref('');const isError=ref(false);
const byValue=(options,value)=>options.find((option)=>option.value===value)||options[0];const indexByValue=(options,value)=>Math.max(0,options.findIndex((option)=>option.value===value));
const selectedGoal=computed(()=>byValue(goalOptions,form.goal));const goalIndex=computed(()=>indexByValue(goalOptions,form.goal));const selectedMeal=computed(()=>byValue(mealOptions,form.mealType));const mealIndex=computed(()=>indexByValue(mealOptions,form.mealType));const selectedTaste=computed(()=>byValue(tasteOptions,form.taste));const tasteIndex=computed(()=>indexByValue(tasteOptions,form.taste));const selectedPattern=computed(()=>byValue(patternOptions,form.dietaryPattern));const patternIndex=computed(()=>indexByValue(patternOptions,form.dietaryPattern));const selectedSpice=computed(()=>byValue(spiceOptions,form.spiceLevel));const spiceIndex=computed(()=>indexByValue(spiceOptions,form.spiceLevel));
const statusLabel=computed(()=>form.allergyStatus==='unknown'?'待完善':'安全信息已确认');
onShow(async()=>{try{await store.refreshIfStale();if(!store.user.value){uni.reLaunch({url:'/pages/login/login'});return;}syncForm();}catch{}});
function syncForm(){const p=store.profile.value;form.goal=p.goal||'healthy';form.mealType=p.mealType||'lunch';form.budgetMax=Number(p.budgetMax||20);form.taste=p.taste||'不限';form.dietaryPattern=p.dietaryPattern||'unrestricted';form.spiceLevel=Number.isFinite(Number(p.spiceLevel))?Number(p.spiceLevel):0;form.nutritionFocus=[...(p.nutritionFocus||[])];form.halalOnly=Boolean(p.halalOnly);form.preferLowCrowd=Boolean(p.preferLowCrowd);form.allergyStatus=p.allergyStatus||'unknown';allergiesText.value=(p.allergies||[]).join(', ');avoidText.value=(p.avoid||[]).join(', ');favoriteTagsText.value=(p.favoriteTags||[]).join(', ');}
function pickGoal(e){form.goal=goalOptions[Number(e.detail.value)]?.value||'healthy';}function pickMeal(e){form.mealType=mealOptions[Number(e.detail.value)]?.value||'lunch';}function pickTaste(e){form.taste=tasteOptions[Number(e.detail.value)]?.value||'不限';}function pickPattern(e){form.dietaryPattern=patternOptions[Number(e.detail.value)]?.value||'unrestricted';}function pickSpice(e){form.spiceLevel=spiceOptions[Number(e.detail.value)]?.value??0;}function setBudget(e){form.budgetMax=Number(e.detail.value||20);}function toggleNutrition(value){const index=form.nutritionFocus.indexOf(value);if(index<0)form.nutritionFocus.push(value);else form.nutritionFocus.splice(index,1);}function parseList(value){return String(value||'').split(/[，,]+/).map((item)=>item.trim()).filter(Boolean);}
async function save(){saving.value=true;message.value='';isError.value=false;try{const payload=normalizeProfileInput({...form,nutritionFocus:[...form.nutritionFocus],favoriteTags:parseList(favoriteTagsText.value),avoid:parseList(avoidText.value),allergies:parseList(allergiesText.value)});await store.saveProfile(payload);await store.loadRecommendation().catch(()=>{});triggerHaptic('light');message.value='健康档案已保存，推荐结果已刷新。';}catch(error){message.value=error.message||'健康档案保存失败。';isError.value=true;}finally{saving.value=false;}}
</script>

<style scoped>
.profile-status { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:16px; padding:12px 16px; border:1px solid var(--warning-line); border-radius:var(--radius); background:var(--warning-soft); }
.profile-status view text { display:block; }
.profile-status view>text:first-child,.profile-status>text { color:var(--muted); font-size:12px; }
.profile-status .ui-strong { margin-top:3px; color:var(--warning); font-size:14px; }
.profile-status.complete { border-color:var(--line); background:var(--surface-soft); }
.profile-status.complete { border-color:var(--success-line); background:var(--success-soft); }.profile-status.complete .ui-strong { color:var(--success); }
.profile-progress { display:grid; grid-template-columns:1fr 1fr; margin-bottom:16px; }
.profile-progress view { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:12px; }.profile-progress view::after { height:2px; flex:1; background:var(--line); content:''; }.profile-progress view:last-child::after { display:none; }
.profile-progress view>text:first-child { display:flex; width:24px; height:24px; align-items:center; justify-content:center; border-radius:50%; background:var(--surface-strong); font-weight:600; }.profile-progress view.active { color:var(--module-dark); }.profile-progress view.active>text:first-child { color:#fff; background:var(--module-accent); }.profile-progress view.active::after { background:var(--module-line); }
.profile-grid { display:grid; gap:16px; }
.form-section { padding:16px; border:1px solid var(--line); border-radius:var(--radius-large); background:var(--surface); }
.section-head { display:flex; align-items:flex-start; gap:12px; margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid var(--line); }
.section-index { display:flex; width:32px; height:32px; flex:0 0 32px; align-items:center; justify-content:center; border-radius:var(--radius); color:#fff; background:var(--module-accent); font-size:12px; font-weight:600; }
.section-title,.section-desc { display:block; }
.section-title { color:var(--ink); font-size:16px; font-weight:600; }
.section-desc { margin-top:3px; color:var(--muted); font-size:12px; }
.field-label,.field-grid label>text,.text-field>text { display:block; margin-bottom:7px; color:var(--ink-2); font-size:14px; font-weight:500; }
.required { color:var(--danger); font-size:12px; }
.allergy-options { display:grid; gap:8px; margin-bottom:16px; }
.allergy-options label { display:flex; min-height:56px; padding:10px 12px; align-items:flex-start; gap:8px; border:1px solid var(--line); border-radius:var(--radius); background:var(--surface-soft); box-sizing:border-box; }
.allergy-options label.active { border-color:var(--module-accent); background:var(--module-soft); }
.allergy-options radio { transform:scale(.82); }
.allergy-options view { flex:1; }
.allergy-options text { display:block; color:var(--muted); font-size:12px; }
.allergy-options .ui-strong { color:var(--ink); font-size:14px; }
.field-grid { display:grid; gap:12px; }
.picker-box { display:flex; min-height:44px; padding:0 12px; align-items:center; justify-content:space-between; border:1px solid var(--line); border-radius:var(--radius); color:var(--ink); background:var(--surface); font-size:14px; box-sizing:border-box; }
.text-field { display:block; margin:14px 0; }
.text-field input { width:100%; height:44px; padding:0 12px; border:1px solid var(--line); border-radius:var(--radius); color:var(--ink); background:var(--surface); font-size:14px; box-sizing:border-box; }
.budget-field { margin-top:16px; }
.budget-field>view { display:flex; justify-content:space-between; color:var(--ink-2); font-size:14px; }
.budget-field .ui-strong { color:var(--ink); font-size:16px; }
.nutrition-label { margin-top:12px; }
.chip-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; }
.chip-grid button { display:flex; min-height:44px; align-items:center; justify-content:center; padding:0 4px; border:1px solid var(--line); border-radius:var(--radius); color:var(--ink-2); background:var(--surface-soft); font-size:12px; }
.chip-grid button.active { color:#fff; border-color:var(--module-accent); background:var(--module-accent); }
.switch-row { display:flex; min-height:56px; padding:10px 0; align-items:center; justify-content:space-between; gap:16px; border-top:1px solid var(--line); box-sizing:border-box; }
.switch-row view { flex:1; }
.switch-row text { display:block; color:var(--muted); font-size:12px; }
.switch-row .ui-strong { color:var(--ink); font-size:14px; font-weight:500; }
.save-button { width:100%; min-height:44px; margin-top:16px; border-radius:var(--radius); color:#fff; background:var(--module-accent); font-size:14px; font-weight:600; }.save-button:active { background:var(--module-dark); transform:translateY(1px); }
.message { display:block; margin-top:12px; color:var(--success); font-size:14px; text-align:center; animation:save-in 260ms var(--ease-spring) both; }
.message.error { color:var(--danger); }
@keyframes save-in { from { opacity:0; transform:translateY(5px) scale(.98); } to { opacity:1; transform:none; } }
@media (min-width:600px) and (max-width:767px) { .field-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (min-width:768px) {
  .profile-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:24px; align-items:start; }
  .field-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .save-button { width:320px; margin-left:auto; }
}
</style>
