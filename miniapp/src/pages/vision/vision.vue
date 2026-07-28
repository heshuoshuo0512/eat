<template>
  <sc-page-shell back title="拍照识餐" subtitle="识别 · 检索 · 确认" tone="discover">
    <sc-state-card v-if="store.error.value" type="error" title="视觉服务暂不可用" :desc="store.error.value" action-text="去菜单检索" @action="openDishes" />
    <view class="vision-steps"><view v-for="(label,index) in stageLabels" :key="label" :class="{ active:index<=stageIndex }"><text>{{ index+1 }}</text><text>{{ label }}</text></view></view>
    <view class="vision-workspace">
      <view class="vision-source">
        <view class="context-panel">
          <text class="panel-title">识别范围</text>
          <picker :range="canteenNames" @change="selectCanteen"><view class="picker-row"><text>食堂</text><text>{{ selectedCanteen?.name || '请选择' }} ›</text></view></picker>
          <picker :range="stallNames" @change="selectStall"><view class="picker-row"><text>档口</text><text>{{ selectedStall?.name || '整个食堂' }} ›</text></view></picker>
          <picker :range="portionLabels" @change="portionIndex=$event.detail.value"><view class="picker-row"><text>份量</text><text>{{ portionLabels[portionIndex] }} ›</text></view></picker>
        </view>
        <view class="camera-card">
          <image v-if="imagePath" class="camera-preview" :src="imagePath" mode="aspectFill" />
          <view v-if="imagePath&&loading" class="scan-line"></view>
          <button v-else class="camera-placeholder" @tap="chooseImage"><sc-illustration name="vision" size="medium" label="识餐扫描框" /><text class="camera-placeholder__title">添加单道菜照片</text><text class="camera-placeholder__desc">请让一道菜占据画面主体</text></button>
          <view class="camera-card__actions">
            <button class="secondary-btn" @tap="chooseImage"><sc-icon name="camera" :size="16" /><text>选择图片</text></button>
            <button class="primary-btn" :loading="loading" :disabled="!imagePath||!canteenId" @tap="analyze">开始分析</button>
          </view>
          <text v-if="message" class="notice">{{ message }}</text>
        </view>
      </view>

      <view class="vision-output">
        <view v-if="result" class="result-card">
          <text class="result-card__label">视觉观察</text>
          <text class="result-card__title">{{ result.detectedName || '未确认通用菜名' }}</text>
          <text class="result-card__desc">{{ result.observation.notes || result.observation.presentation || '已完成可见特征观察。' }}</text>
          <text class="result-meta">可见食材：{{ result.observation.visibleIngredients.join(' / ') || '无法确认' }}</text>
          <text class="result-meta">置信度：{{ result.confidenceLabel }}</text>
        </view>

        <view v-if="result?.warnings.length" class="warning-panel"><text v-for="item in result.warnings" :key="item.code">{{ item.message }}</text></view>

        <view v-if="candidates.length" class="matches-panel">
          <view class="matches-header"><text class="matches-title">请确认具体菜品</text><text>{{ candidates.length }} 项</text></view>
          <view v-for="candidate in candidates" :key="candidate.dishId" class="candidate-row">
            <image v-if="candidate.referenceImageUrl||candidate.imageUrl" :src="candidate.referenceImageUrl||candidate.imageUrl" mode="aspectFill" />
            <view class="candidate-body"><text class="candidate-name">{{ candidate.name }}</text><text>{{ candidate.canteen?.name || '未知食堂' }} · {{ candidate.stall?.name || '未知档口' }}</text><text>匹配 {{ Math.round(candidate.matchScore*100) }}%</text></view>
            <button class="candidate-action" :loading="confirmingId===candidate.dishId" :disabled="!!confirmingId" @tap="confirm(candidate.dishId)">确认</button>
          </view>
          <button class="secondary-btn unmatched-btn" :disabled="!!confirmingId" @tap="confirm(null)">都不是</button>
        </view>

        <view v-if="result?.selectedDish" class="nutrition-panel">
          <text class="result-card__label">已确认菜品</text><text class="result-card__title">{{ result.selectedDish.name }}</text>
          <view v-if="result.nutrition.status!=='unknown'" class="result-nutrition">
            <view class="nutrition-item"><text class="nutrition-num">{{ nutritionRangeText(result.nutrition.ranges?.calories) }}</text><text class="nutrition-unit">热量</text></view>
            <view class="nutrition-item"><text class="nutrition-num">{{ nutritionRangeText(result.nutrition.ranges?.protein) }}</text><text class="nutrition-unit">蛋白</text></view>
            <view class="nutrition-item"><text class="nutrition-num">{{ nutritionRangeText(result.nutrition.ranges?.fat) }}</text><text class="nutrition-unit">脂肪</text></view>
            <view class="nutrition-item"><text class="nutrition-num">{{ nutritionRangeText(result.nutrition.ranges?.carbs) }}</text><text class="nutrition-unit">碳水</text></view>
          </view>
          <text v-else class="unknown-note">该菜品尚无已审核营养资料，不展示默认数字。</text>
          <text class="result-meta">{{ result.nutrition.reason }}</text>
        </view>

        <sc-state-card v-if="result&&!candidates.length&&!result.selectedDish" type="empty" illustration="empty-search" title="没有可信候选" desc="请检查食堂、餐次和菜单，或换一张更清晰的单道菜照片。" action-text="去菜单" @action="openDishes" />
        <view v-if="!result" class="result-empty"><sc-icon name="bulb" :size="20" tone="muted" /><text>完成上传后，视觉观察和当餐候选会显示在这里。</text></view>
      </view>
    </view>
  </sc-page-shell>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { imageToBase64 } from '../../utils/format.js';
import { useCanteenStore } from '../../stores/canteenStore.js';
import { normalizeMealVisionResult, nutritionRangeText } from '../../../../shared/mealVisionContract.js';

const store = useCanteenStore();
const imagePath = ref('');
const imageContentType = ref('image/jpeg');
const result = ref(null);
const message = ref('');
const loading = ref(false);
const confirmingId = ref('');
const canteenId = ref('');
const stallId = ref('');
const portionIndex = ref(1);
const portionLabels = ['小份','常规','大份'];
const portionValues = ['small','regular','large'];
const canteens = computed(() => store.canteens.value || []);
const stalls = computed(() => (store.stalls.value || []).filter((item) => item.canteenId===canteenId.value));
const canteenNames = computed(() => canteens.value.map((item) => item.name));
const stallNames = computed(() => ['整个食堂',...stalls.value.map((item) => item.name)]);
const selectedCanteen = computed(() => canteens.value.find((item) => item.id===canteenId.value));
const selectedStall = computed(() => stalls.value.find((item) => item.id===stallId.value));
const candidates = computed(() => result.value?.match?.candidates || []);
const stageLabels = ['上传','分析中','确认'];
const stageIndex = computed(() => result.value ? 2 : loading.value ? 1 : 0);

onLoad((query) => { canteenId.value=String(query?.canteenId||''); stallId.value=String(query?.stallId||''); });
onShow(async () => { try { await store.refreshIfStale(); if(!store.user.value) uni.reLaunch({url:'/pages/login/login'}); } catch {} });
function openDishes(){uni.switchTab({url:'/pages/dishes/dishes'});}
function selectCanteen(event){canteenId.value=canteens.value[Number(event.detail.value)]?.id||'';stallId.value='';result.value=null;}
function selectStall(event){const index=Number(event.detail.value);stallId.value=index?stalls.value[index-1]?.id||'':'';result.value=null;}

function chooseImage(){uni.chooseImage({count:1,sizeType:['compressed'],sourceType:['camera','album'],success(response){const file=response.tempFiles?.[0];if(file?.size>5*1024*1024){message.value='图片不能超过 5MB。';return;}imagePath.value=response.tempFilePaths[0];imageContentType.value=file?.type||'image/jpeg';result.value=null;message.value='图片已选择，可以开始分析。';}});}

async function analyze(){
  if(!imagePath.value||!canteenId.value)return;
  loading.value=true;message.value='正在观察图片并检索当餐候选。';
  try{
    result.value=normalizeMealVisionResult(await store.analyzeMealImage({filename:'miniapp-meal.jpg',contentType:imageContentType.value,dataBase64:await imageToBase64(imagePath.value),mode:'single_dish',context:{canteenId:canteenId.value,stallId:stallId.value||null,mealType:'lunch',capturedAt:new Date().toISOString()},portion:{size:portionValues[portionIndex.value]}}));
    message.value=candidates.value.length?'分析完成，请确认具体菜品。':'没有找到可信的当餐候选。';
  }catch(error){message.value=error.message;}finally{loading.value=false;}
}

async function confirm(dishId){
  if(!result.value?.analysisId||confirmingId.value)return;
  confirmingId.value=dishId||'unresolved';
  try{const confirmed=await store.confirmMealVision(result.value.analysisId,{dishId,portion:{size:portionValues[portionIndex.value]}});result.value=normalizeMealVisionResult({...result.value,...confirmed,observation:result.value.observation});message.value=dishId?'已确认菜品并加载营养依据。':'已记录未匹配结果。';}catch(error){message.value=error.message;}finally{confirmingId.value='';}
}
</script>

<style scoped>
.vision-workspace{display:grid;gap:16px}.vision-steps{display:grid;grid-template-columns:repeat(3,1fr);margin-bottom:16px}.vision-steps view{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:12px}.vision-steps view::after{height:2px;flex:1;background:var(--line);content:''}.vision-steps view:last-child::after{display:none}.vision-steps view>text:first-child{display:flex;width:24px;height:24px;align-items:center;justify-content:center;border-radius:50%;background:var(--surface-strong)}.vision-steps view.active{color:var(--module-dark)}.vision-steps view.active>text:first-child{color:#fff;background:var(--module-accent)}
.context-panel,.camera-card,.result-card,.matches-panel,.nutrition-panel{border:1px solid var(--line);border-radius:var(--radius-large);background:var(--surface)}.context-panel{margin-bottom:12px;padding:16px}.panel-title{display:block;margin-bottom:8px;color:var(--ink);font-weight:600}.picker-row{display:flex;min-height:44px;align-items:center;justify-content:space-between;border-top:1px solid var(--line);font-size:14px}.picker-row text:last-child{color:var(--muted)}
.camera-card{position:relative;overflow:hidden}.camera-preview,.camera-placeholder{display:flex;width:100%;height:280px;align-items:center;justify-content:center;box-sizing:border-box}.camera-preview{display:block;background:var(--surface-soft)}.camera-placeholder{flex-direction:column;color:var(--muted);background:var(--module-soft)}.camera-placeholder__title{margin-top:8px;color:var(--ink);font-weight:600}.camera-placeholder__desc{margin-top:4px;font-size:12px}.scan-line{position:absolute;top:0;right:0;left:0;height:3px;background:var(--module-accent);animation:scan 1.8s ease-in-out infinite alternate}.camera-card__actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px 16px 16px}.notice{display:block;padding:0 16px 16px;color:var(--muted);font-size:12px}
.vision-output{display:flex;flex-direction:column;gap:12px}.result-card,.matches-panel,.nutrition-panel{padding:16px}.result-card__label,.result-card__title,.result-card__desc,.result-meta,.unknown-note,.warning-panel text{display:block}.result-card__label{color:var(--muted);font-size:12px;font-weight:600}.result-card__title{margin-top:4px;color:var(--ink);font-size:20px;font-weight:600}.result-card__desc,.result-meta{margin-top:6px;color:var(--muted);font-size:14px;line-height:1.55}.warning-panel{padding:12px;border-left:3px solid var(--warning);background:var(--warning-soft);color:var(--warning);font-size:12px}.warning-panel text+text{margin-top:6px}.matches-header{display:flex;justify-content:space-between;margin-bottom:8px;color:var(--muted);font-size:12px}.matches-title{color:var(--ink);font-size:14px;font-weight:600}.candidate-row{display:grid;grid-template-columns:56px minmax(0,1fr) 58px;gap:10px;align-items:center;padding:12px 0;border-top:1px solid var(--line)}.candidate-row image{width:56px;height:56px;border-radius:6px}.candidate-body text{display:block;color:var(--muted);font-size:12px}.candidate-name{color:var(--ink)!important;font-size:14px!important;font-weight:600}.candidate-action{width:58px;min-height:44px;padding:0;font-size:12px}.unmatched-btn{margin-top:8px}.result-nutrition{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:12px}.nutrition-item{padding:12px 4px;background:var(--surface-soft);text-align:center}.nutrition-num,.nutrition-unit{display:block}.nutrition-num{color:var(--ink);font-weight:600}.nutrition-unit{margin-top:3px;color:var(--muted);font-size:12px}.unknown-note{margin-top:12px;color:var(--warning);font-size:12px}.result-empty{display:flex;min-height:180px;padding:24px;align-items:center;justify-content:center;gap:10px;border:1px dashed var(--line);border-radius:var(--radius-large);color:var(--muted);font-size:14px;text-align:center}@keyframes scan{from{transform:translateY(0)}to{transform:translateY(276px)}}
@media(min-width:768px){.vision-workspace{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px;align-items:start}.vision-source{position:sticky;top:72px}.camera-preview,.camera-placeholder{height:auto;min-height:320px;aspect-ratio:4/3}}
</style>
