<template>
  <sc-page-shell back title="健康档案" subtitle="保存后立即刷新推荐">
    <view class="profile-status" :class="{ complete:form.allergyStatus!=='unknown' }"><view><text>档案状态</text><text class="ui-strong">{{ statusLabel }}</text></view><text>{{ form.allergyStatus==='unknown'?'先确认饮食安全信息':'可继续补充用餐偏好' }}</text></view>

    <view class="form-section safety-section">
      <view class="section-head"><text class="section-index">01</text><view><text class="section-title">安全与饮食限制</text><text class="section-desc">以下限制不会被推荐自动放宽</text></view></view>
      <text class="field-label">已知食物过敏情况 <text class="required">必选</text></text>
      <radio-group class="allergy-options" @change="form.allergyStatus=$event.detail.value">
        <label :class="{ active:form.allergyStatus==='none' }"><radio value="none" :checked="form.allergyStatus==='none'" color="#237A57" /><view><text class="ui-strong">暂无已知过敏</text><text>我确认目前没有已知食物过敏</text></view></label>
        <label :class="{ active:form.allergyStatus==='declared' }"><radio value="declared" :checked="form.allergyStatus==='declared'" color="#237A57" /><view><text class="ui-strong">有已知过敏原</text><text>严格排除填写的食材</text></view></label>
      </radio-group>
      <label v-if="form.allergyStatus==='declared'" class="text-field"><text>过敏原</text><input v-model="allergiesText" maxlength="120" placeholder="如：花生, 虾, 牛奶" /></label>
      <label class="text-field"><text>普通忌口</text><input v-model="avoidText" maxlength="120" placeholder="如：香菜, 动物内脏" /></label>
      <label class="text-field"><text>饮食模式</text><picker :range="patternOptions" range-key="label" :value="patternIndex" @change="pickPattern"><view class="picker-box">{{ selectedPattern.label }}<text>⌄</text></view></picker></label>
      <view class="switch-row"><view><text class="ui-strong">仅清真</text><text>筛除未标记为清真的菜品</text></view><switch color="#237A57" :checked="form.halalOnly" @change="form.halalOnly=Boolean($event.detail.value)" /></view>
    </view>

    <view class="form-section">
      <view class="section-head"><text class="section-index">02</text><view><text class="section-title">用餐偏好</text><text class="section-desc">除预算外都可以保持不限</text></view></view>
      <view class="field-grid">
        <label><text>饮食目标</text><picker :range="goalOptions" range-key="label" :value="goalIndex" @change="pickGoal"><view class="picker-box">{{ selectedGoal.label }}<text>⌄</text></view></picker></label>
        <label><text>常用餐次</text><picker :range="mealOptions" range-key="label" :value="mealIndex" @change="pickMeal"><view class="picker-box">{{ selectedMeal.label }}<text>⌄</text></view></picker></label>
        <label><text>口味偏好</text><picker :range="tasteOptions" range-key="label" :value="tasteIndex" @change="pickTaste"><view class="picker-box">{{ selectedTaste.label }}<text>⌄</text></view></picker></label>
        <label><text>辣度偏好</text><picker :range="spiceOptions" range-key="label" :value="spiceIndex" @change="pickSpice"><view class="picker-box">{{ selectedSpice.label }}<text>⌄</text></view></picker></label>
      </view>
      <view class="budget-field"><view><text>预算上限</text><text class="ui-strong">¥{{ form.budgetMax }}</text></view><slider :value="form.budgetMax" min="8" max="80" step="1" activeColor="#237A57" backgroundColor="#DCE7E1" block-size="22" @changing="setBudget" @change="setBudget" /></view>
      <text class="field-label nutrition-label">营养关注</text>
      <view class="chip-grid"><button v-for="option in nutritionOptions" :key="option.value" :class="{ active:form.nutritionFocus.includes(option.value) }" @tap="toggleNutrition(option.value)"><view>{{ option.label }}</view></button></view>
      <label class="text-field"><text>喜爱标签</text><input v-model="favoriteTagsText" maxlength="120" placeholder="如：高蛋白, 低脂, 快手" /></label>
      <view class="switch-row"><view><text class="ui-strong">偏好低人流食堂</text><text>排序时优先考虑排队压力</text></view><switch color="#237A57" :checked="form.preferLowCrowd" @change="form.preferLowCrowd=Boolean($event.detail.value)" /></view>
    </view>

    <button class="save-button" :loading="saving" :disabled="saving" @tap="save">{{ saving?'正在保存':'保存健康档案' }}</button>
    <text v-if="message" class="message" :class="{ error:isError }">{{ message }}</text>
  </sc-page-shell>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
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
async function save(){saving.value=true;message.value='';isError.value=false;try{const payload=normalizeProfileInput({...form,nutritionFocus:[...form.nutritionFocus],favoriteTags:parseList(favoriteTagsText.value),avoid:parseList(avoidText.value),allergies:parseList(allergiesText.value)});await store.saveProfile(payload);await store.loadRecommendation().catch(()=>{});message.value='健康档案已保存，推荐结果已刷新。';}catch(error){message.value=error.message||'健康档案保存失败。';isError.value=true;}finally{saving.value=false;}}
</script>

<style scoped>
.profile-status{display:flex;align-items:center;justify-content:space-between;gap:16rpx;margin-bottom:18rpx;padding:18rpx 20rpx;border:1rpx solid #eadfbe;border-radius:var(--radius);background:#fffaf0}.profile-status view text{display:block}.profile-status view>text:first-child,.profile-status>text{color:var(--muted);font-size:22rpx}.profile-status .ui-strong{margin-top:3rpx;color:#936016;font-size:27rpx;font-weight:600}.profile-status.complete{border-color:var(--line);background:var(--brand-soft)}.profile-status.complete .ui-strong{color:var(--brand)}
.form-section{margin-bottom:18rpx;padding:22rpx;border:1rpx solid var(--line);border-radius:var(--radius);background:var(--surface)}.section-head{display:flex;align-items:flex-start;gap:12rpx;margin-bottom:20rpx;padding-bottom:16rpx;border-bottom:1rpx solid var(--line)}.section-index{display:flex;align-items:center;justify-content:center;width:54rpx;height:54rpx;flex:0 0 54rpx;border-radius:12rpx;color:#fff;background:var(--brand);font-size:22rpx;font-weight:600}.section-title,.section-desc{display:block}.section-title{color:var(--ink);font-size:28rpx;font-weight:600}.section-desc{margin-top:3rpx;color:var(--muted);font-size:22rpx}.field-label,.field-grid label>text,.text-field>text{display:block;margin-bottom:8rpx;color:var(--ink-2);font-size:24rpx;font-weight:500}.required{color:var(--danger);font-size:22rpx}
.allergy-options{display:grid;gap:10rpx;margin-bottom:18rpx}.allergy-options label{display:flex;align-items:flex-start;gap:10rpx;padding:16rpx;border:1rpx solid var(--line);border-radius:12rpx;background:var(--surface-soft)}.allergy-options label.active{border-color:var(--brand);background:var(--brand-soft)}.allergy-options radio{transform:scale(.82)}.allergy-options view{flex:1}.allergy-options text{display:block;color:var(--muted);font-size:22rpx}.allergy-options .ui-strong{color:var(--ink);font-size:25rpx;font-weight:600}
.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:14rpx}.picker-box{display:flex;align-items:center;justify-content:space-between;min-height:82rpx;padding:0 14rpx;border:1rpx solid var(--line);border-radius:12rpx;color:var(--ink);background:var(--surface-soft);font-size:25rpx;box-sizing:border-box}.text-field{display:block;margin:16rpx 0}.text-field input{width:100%;height:84rpx;padding:0 14rpx;border:1rpx solid var(--line);border-radius:12rpx;background:var(--surface-soft);color:var(--ink);font-size:25rpx;box-sizing:border-box}.budget-field{margin-top:20rpx}.budget-field>view{display:flex;justify-content:space-between;color:var(--ink-2);font-size:24rpx}.budget-field .ui-strong{color:var(--brand);font-size:28rpx;font-weight:600}.nutrition-label{margin-top:14rpx}.chip-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4rpx}.chip-grid button{display:flex;align-items:center;min-height:88rpx;padding:0 3rpx;background:transparent}.chip-grid button>view{display:flex;align-items:center;justify-content:center;width:100%;min-height:64rpx;border:1rpx solid var(--line);border-radius:10rpx;color:var(--ink-2);background:var(--surface-soft);font-size:23rpx;box-sizing:border-box}.chip-grid button.active view{color:#fff;border-color:var(--brand);background:var(--brand)}.switch-row{display:flex;align-items:center;justify-content:space-between;gap:18rpx;padding:16rpx 0;border-top:1rpx solid var(--line)}.switch-row view{flex:1}.switch-row text{display:block;color:var(--muted);font-size:22rpx}.switch-row .ui-strong{color:var(--ink);font-size:25rpx;font-weight:500}.save-button{width:100%;min-height:88rpx;border-radius:var(--radius);color:#fff;background:var(--brand);font-size:28rpx;font-weight:500}.message{display:block;margin-top:12rpx;color:var(--brand);font-size:24rpx;text-align:center}.message.error{color:var(--danger)}
</style>
