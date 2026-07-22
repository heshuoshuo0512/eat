<template>
  <sc-page-shell back title="健康档案" subtitle="保存后用于下一次推荐" tone="profile">
    <view class="profile-lead">
      <text>本餐偏好</text>
      <text class="ui-strong">{{ selectedGoal.label }} · {{ selectedMeal.label }}</text>
      <text class="ui-small">预算 ¥{{ form.budgetMax }}，{{ selectedTaste.label }}口味</text>
    </view>

    <view class="form-section">
      <text class="section-title">基本选择</text>
      <view class="field-grid">
        <label><text>饮食目标</text><picker :range="goalOptions" range-key="label" :value="goalIndex" @change="pickGoal"><view class="picker-box">{{ selectedGoal.label }}<text>⌄</text></view></picker></label>
        <label><text>餐次</text><picker :range="mealOptions" range-key="label" :value="mealIndex" @change="pickMeal"><view class="picker-box">{{ selectedMeal.label }}<text>⌄</text></view></picker></label>
        <label><text>口味偏好</text><picker :range="tasteOptions" range-key="label" :value="tasteIndex" @change="pickTaste"><view class="picker-box">{{ selectedTaste.label }}<text>⌄</text></view></picker></label>
        <label><text>饮食模式</text><picker :range="patternOptions" range-key="label" :value="patternIndex" @change="pickPattern"><view class="picker-box">{{ selectedPattern.label }}<text>⌄</text></view></picker></label>
        <label class="wide"><text>辣度偏好</text><picker :range="spiceOptions" range-key="label" :value="spiceIndex" @change="pickSpice"><view class="picker-box">{{ selectedSpice.label }}<text>⌄</text></view></picker></label>
      </view>
      <view class="budget-field"><view><text>预算上限</text><text class="ui-strong">¥{{ form.budgetMax }}</text></view><slider :value="form.budgetMax" min="8" max="80" step="1" activeColor="#167a5b" backgroundColor="#dce7e1" block-size="22" @changing="setBudget" @change="setBudget" /></view>
    </view>

    <view class="form-section">
      <text class="section-title">营养关注</text>
      <view class="chip-grid"><button v-for="option in nutritionOptions" :key="option.value" :class="{ active:form.nutritionFocus.includes(option.value) }" @tap="toggleNutrition(option.value)"><view>{{ option.label }}</view></button></view>
    </view>

    <view class="form-section">
      <text class="section-title">标签与忌口</text>
      <label class="text-field"><text>喜爱标签</text><input v-model="favoriteTagsText" maxlength="120" placeholder="如：高蛋白, 低脂, 快手" /></label>
      <label class="text-field"><text>忌口 / 过敏食材</text><input v-model="avoidText" maxlength="120" placeholder="无，或填写花生、虾、牛奶" /></label>
      <view class="switch-row"><view><text class="ui-strong">仅清真</text><text>筛除非清真菜品</text></view><switch color="#167a5b" :checked="form.halalOnly" @change="form.halalOnly=Boolean($event.detail.value)" /></view>
      <view class="switch-row"><view><text class="ui-strong">偏好低人流食堂</text><text>推荐时优先考虑排队压力</text></view><switch color="#167a5b" :checked="form.preferLowCrowd" @change="form.preferLowCrowd=Boolean($event.detail.value)" /></view>
    </view>

    <button class="save-button" :loading="saving" :disabled="saving" @tap="save">{{ saving ? '正在保存' : '保存健康档案' }}</button>
    <text v-if="message" class="message" :class="{ error:isError }">{{ message }}</text>
  </sc-page-shell>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const goalOptions = [{value:'fatLoss',label:'减脂'},{value:'muscleGain',label:'增肌'},{value:'maintain',label:'维持体重'},{value:'healthy',label:'健康饮食'}];
const mealOptions = [{value:'breakfast',label:'早餐'},{value:'lunch',label:'午餐'},{value:'dinner',label:'晚餐'}];
const tasteOptions = ['不限','咸鲜','麻辣','酸辣','黑椒','清淡','甜味','酱香'].map((value)=>({value,label:value}));
const patternOptions = [{value:'balanced',label:'均衡'},{value:'omnivore',label:'杂食'},{value:'pescatarian',label:'鱼素'},{value:'vegetarian',label:'素食'},{value:'vegan',label:'纯素'},{value:'lowCarb',label:'低碳水'},{value:'keto',label:'生酮'}];
const spiceOptions = [{value:1,label:'不辣'},{value:2,label:'微辣'},{value:3,label:'中辣'},{value:4,label:'重辣'},{value:5,label:'极辣'}];
const nutritionOptions = [{value:'highProtein',label:'高蛋白'},{value:'lowFat',label:'低脂'},{value:'lowCarb',label:'低碳水'},{value:'highFiber',label:'高纤维'},{value:'lowSodium',label:'低钠'},{value:'lowSugar',label:'低糖'}];
const form = reactive({goal:'healthy',mealType:'lunch',budgetMax:20,taste:'不限',dietaryPattern:'balanced',spiceLevel:3,nutritionFocus:[],halalOnly:false,preferLowCrowd:false});
const favoriteTagsText = ref(''); const avoidText = ref(''); const saving = ref(false); const message = ref(''); const isError = ref(false);
const byValue=(options,value)=>options.find((option)=>option.value===value)||options[0];
const indexByValue=(options,value)=>Math.max(0,options.findIndex((option)=>option.value===value));
const selectedGoal=computed(()=>byValue(goalOptions,form.goal)); const goalIndex=computed(()=>indexByValue(goalOptions,form.goal));
const selectedMeal=computed(()=>byValue(mealOptions,form.mealType)); const mealIndex=computed(()=>indexByValue(mealOptions,form.mealType));
const selectedTaste=computed(()=>byValue(tasteOptions,form.taste)); const tasteIndex=computed(()=>indexByValue(tasteOptions,form.taste));
const selectedPattern=computed(()=>byValue(patternOptions,form.dietaryPattern)); const patternIndex=computed(()=>indexByValue(patternOptions,form.dietaryPattern));
const selectedSpice=computed(()=>byValue(spiceOptions,form.spiceLevel)); const spiceIndex=computed(()=>indexByValue(spiceOptions,form.spiceLevel));

onShow(async()=>{try{await store.refreshIfStale();if(!store.user.value){uni.reLaunch({url:'/pages/login/login'});return;}syncForm();}catch{}});
function syncForm(){const profile=store.profile.value;form.goal=profile.goal||'healthy';form.mealType=profile.mealType||'lunch';form.budgetMax=Number(profile.budgetMax||20);form.taste=profile.taste||'不限';form.dietaryPattern=profile.dietaryPattern||'balanced';form.spiceLevel=Number(profile.spiceLevel||3);form.nutritionFocus=[...(profile.nutritionFocus||[])];form.halalOnly=Boolean(profile.halalOnly);form.preferLowCrowd=Boolean(profile.preferLowCrowd);favoriteTagsText.value=(profile.favoriteTags||[]).join(', ');avoidText.value=(profile.avoid||[]).join(', ');}
function pickGoal(event){form.goal=goalOptions[Number(event.detail.value)]?.value||'healthy';} function pickMeal(event){form.mealType=mealOptions[Number(event.detail.value)]?.value||'lunch';} function pickTaste(event){form.taste=tasteOptions[Number(event.detail.value)]?.value||'不限';} function pickPattern(event){form.dietaryPattern=patternOptions[Number(event.detail.value)]?.value||'balanced';} function pickSpice(event){form.spiceLevel=spiceOptions[Number(event.detail.value)]?.value||3;}
function setBudget(event){form.budgetMax=Number(event.detail.value||20);} function toggleNutrition(value){const index=form.nutritionFocus.indexOf(value);if(index<0)form.nutritionFocus.push(value);else form.nutritionFocus.splice(index,1);}
function parseList(value){return String(value||'').split(/[，,]+/).map((item)=>item.trim()).filter(Boolean);}
async function save(){saving.value=true;message.value='';isError.value=false;try{await store.saveProfile({...form,nutritionFocus:[...form.nutritionFocus],favoriteTags:parseList(favoriteTagsText.value),avoid:parseList(avoidText.value)});await store.loadRecommendation().catch(()=>{});message.value='健康档案已保存，智能推荐会使用最新偏好。';}catch(error){message.value=error.message||'健康档案保存失败。';isError.value=true;}finally{saving.value=false;}}
</script>

<style scoped>
.profile-lead { margin-bottom:20rpx; padding:22rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); }
.profile-lead text,.profile-lead .ui-strong,.profile-lead .ui-small { display:block; }
.profile-lead text { color:var(--brand); font-size:22rpx; font-weight:500; }
.profile-lead .ui-strong { margin-top:6rpx; color:var(--ink); font-size:30rpx; font-weight:600; }
.profile-lead .ui-small { margin-top:5rpx; color:var(--muted); font-size:24rpx; line-height:1.45; }
.form-section { margin-bottom:18rpx; padding:22rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); }
.section-title { display:block; margin-bottom:18rpx; color:var(--ink); font-size:28rpx; font-weight:600; }
.field-grid { display:grid; grid-template-columns:1fr 1fr; gap:16rpx; }
.field-grid label.wide { grid-column:1/3; }
.field-grid label>text,.text-field>text { display:block; margin-bottom:8rpx; color:var(--ink-2); font-size:24rpx; font-weight:500; }
.picker-box { display:flex; align-items:center; justify-content:space-between; min-height:88rpx; padding:0 16rpx; border:1rpx solid var(--line); border-radius:12rpx; color:var(--ink); background:var(--surface-soft); font-size:26rpx; box-sizing:border-box; }
.budget-field { margin-top:22rpx; }
.budget-field>view { display:flex; justify-content:space-between; color:var(--ink-2); font-size:24rpx; font-weight:500; }
.budget-field .ui-strong { color:var(--brand); font-size:28rpx; font-weight:600; }
.budget-field slider { margin:14rpx 0 0; }
.chip-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:4rpx; }
.chip-grid button { display:flex; align-items:center; justify-content:center; min-height:88rpx; padding:0 4rpx; color:var(--ink-2); background:transparent; font-size:24rpx; font-weight:500; }
.chip-grid button>view { display:flex; align-items:center; justify-content:center; width:100%; min-height:64rpx; padding:0 8rpx; border:1rpx solid var(--line); border-radius:10rpx; background:var(--surface-soft); line-height:1.2; box-sizing:border-box; }
.chip-grid button.active>view { color:#fff; border-color:var(--brand); background:var(--brand); transform:scale(.98); }
.text-field { display:block; margin-bottom:18rpx; }
.text-field input { width:100%; height:88rpx; padding:0 16rpx; border:1rpx solid var(--line); border-radius:12rpx; background:var(--surface-soft); color:var(--ink); font-size:26rpx; box-sizing:border-box; }
.switch-row { display:flex; align-items:center; gap:16rpx; min-height:104rpx; border-top:1rpx solid var(--line); }
.switch-row view { flex:1; min-width:0; }
.switch-row .ui-strong,.switch-row text { display:block; }
.switch-row .ui-strong { color:var(--ink); font-size:26rpx; font-weight:500; }
.switch-row text { margin-top:3rpx; color:var(--muted); font-size:22rpx; }
.save-button { width:100%; min-height:88rpx; border-radius:var(--radius); color:#fff; background:var(--brand); font-size:28rpx; font-weight:500; }
.save-button:active { transform:scale(.985); }
.message { display:block; margin-top:14rpx; color:var(--brand); font-size:24rpx; text-align:center; }
.message.error { color:var(--danger); }
</style>
