<template>
  <view class="reveal" :class="[{ reduced: reducedMotion }, `phase-${visualPhase}`]" :data-motion-phase="visualPhase">
    <view class="reveal-head">
      <view><text class="heading">这一餐，替你认真选</text><text class="heading-note">结合健康档案与今日真实供应</text></view>
      <text class="progress">{{ dish ? `${index + 1} / ${total}` : '0 / 0' }}</text>
    </view>

    <view class="progress-track"><view :style="{ width: progressWidth }"></view></view>
    <sc-state-card v-if="!dish" type="empty" title="暂无推荐" desc="刷新后再看看今天适合吃什么。" />

    <view v-else class="reveal-panel">
      <view v-if="visualPhase === 'covered' || visualPhase === 'arming'" class="cover">
        <view class="cover-icon"><sc-icon name="bulb" :size="20" tone="brand" /></view>
        <text class="cover-title">答案已经准备好</text>
        <text class="cover-desc">不靠虚构图片，只按你的限制、口味和食堂供应挑选。</text>
        <button class="reveal-primary" :class="{ arming: visualPhase === 'arming' }" :aria-disabled="interactionLocked" @tap="handleReveal"><text>{{ visualPhase === 'arming' ? '准备揭晓' : '揭晓今天的推荐' }}</text><sc-icon name="arrow-right" :size="16" tone="inverted" /></button>
      </view>

      <view v-else class="answer" :class="{ 'has-media': hasImage }">
        <sc-dish-media v-if="hasImage" class="answer-media" :dish="dish" ratio="wide" />
        <view class="answer-content">
          <view class="answer-top"><text class="dish-location">{{ location }}</text><text class="dish-price">{{ priceText }}</text></view>
          <text class="dish-name">{{ dish.name }}</text>
          <text class="dish-reason">{{ reason }}</text>
          <view class="answer-facts"><text>{{ nutritionLabel }}</text><text :class="supplyTone">{{ supply }}</text></view>
          <view class="reveal-actions"><button class="reveal-secondary" @tap="$emit('action')"><sc-icon name="refresh" :size="16" tone="inverted" /><text>换一个</text></button><button class="reveal-detail" @tap="$emit('detail', dish.id)"><text>查看详情</text><sc-icon name="arrow-right" :size="16" tone="inverted" /></button></view>
          </view>
        </view>
        <view v-if="visualPhase === 'bursting'" class="burst-layer" aria-hidden="true">
          <view class="burst-core"></view>
          <view v-for="part in 8" :key="part" class="burst-shard" :class="`shard-${part}`"></view>
          <view class="burst-sentinel" @animationend.stop="finishReveal"></view>
        </view>
      </view>

    <text class="reveal-note">{{ visualPhase === 'covered' || visualPhase === 'arming' ? '推荐仅使用已同步的真实菜品' : '价格、供应和营养以当前数据为准' }}</text>
  </view>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { dishNutritionPresentation, dishPriceText, verifiedDishImageUrl } from '../../domain/dishPresentation.js';
import { triggerHaptic } from '../../composables/useInteractionFeedback.js';

const props = defineProps({ dish:{type:Object,default:null}, index:{type:Number,default:0}, total:{type:Number,default:0}, phase:{type:String,default:'covered'}, location:{type:String,default:''}, reason:{type:String,default:''}, supply:{type:String,default:''}, reducedMotion:Boolean });
const emit = defineEmits(['action','reset','detail']);
const visualPhase = ref(props.phase === 'covered' ? 'covered' : 'revealed');
const interactionLocked = ref(false);
let armTimer = 0;
let fallbackTimer = 0;
const priceText = computed(() => dishPriceText(props.dish || {}));
const nutritionLabel = computed(() => dishNutritionPresentation(props.dish || {}).label);
const hasImage = computed(() => Boolean(verifiedDishImageUrl(props.dish || {})));
const progressWidth = computed(() => props.phase === 'covered' ? '34%' : `${Math.max(12, ((props.index + 1) / Math.max(1, props.total)) * 100)}%`);
const supplyTone = computed(() => /可点|充足|供应中/.test(props.supply) ? 'success' : /紧张|限量/.test(props.supply) ? 'warning' : '');
watch(() => props.phase, (value) => {
  if (value === 'covered') {
    clearTimers();
    interactionLocked.value = false;
    visualPhase.value = 'covered';
  } else if (!interactionLocked.value) {
    visualPhase.value = 'revealed';
  }
});
function clearTimers() { clearTimeout(armTimer); clearTimeout(fallbackTimer); }
function handleReveal() {
  if (interactionLocked.value || props.phase !== 'covered') return;
  interactionLocked.value = true;
  triggerHaptic(props.reducedMotion ? 'light' : 'medium');
  if (props.reducedMotion) {
    emit('action');
    nextTick(() => { visualPhase.value = 'revealed'; interactionLocked.value = false; });
    return;
  }
  visualPhase.value = 'arming';
  fallbackTimer = setTimeout(finishReveal, 800);
  armTimer = setTimeout(() => {
    emit('action');
    visualPhase.value = 'bursting';
  }, 90);
}
function finishReveal() {
  if (visualPhase.value !== 'bursting') return;
  clearTimers();
  visualPhase.value = 'revealed';
  interactionLocked.value = false;
  triggerHaptic('light');
}
onBeforeUnmount(clearTimers);
</script>

<style scoped>
.reveal { min-width:0; }
.reveal-head { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin-bottom:10px; }
.heading,.heading-note { display:block; }
.heading { color:var(--ink); font-size:20px; font-weight:600; }
.heading-note { margin-top:4px; color:var(--muted); font-size:12px; }
.progress { color:var(--module-dark); font-size:12px; font-weight:600; font-variant-numeric:tabular-nums; }
.progress-track { overflow:hidden; height:3px; margin-bottom:12px; border-radius:3px; background:var(--brand-soft); }
.progress-track view { height:100%; border-radius:3px; background:var(--brand); transition:width 220ms var(--ease-standard); }
.reveal-panel { overflow:hidden; min-height:270px; border:1px solid var(--line); border-radius:var(--radius-large); background:var(--surface); box-shadow:none; }
.cover,.answer { display:flex; min-height:270px; flex-direction:column; padding:20px; box-sizing:border-box; }
.cover { align-items:flex-start; justify-content:center; }
.cover-icon { display:flex; width:42px; height:42px; align-items:center; justify-content:center; margin-bottom:18px; border-radius:10px; color:var(--brand); background:var(--brand-soft); }
.cover-title { color:var(--ink); font-size:24px; font-weight:600; line-height:1.25; }
.cover-desc { max-width:520px; margin-top:7px; color:var(--ink-2); font-size:14px; line-height:1.5; }
.reveal-primary { display:flex; width:100%; min-height:48px; align-items:center; justify-content:center; gap:7px; margin-top:20px; border-radius:8px; color:#fff; background:var(--brand); font-size:14px; font-weight:600; transition:transform 90ms var(--ease-standard),background-color 120ms ease; }
.reveal-primary:active,.reveal-primary.arming { transform:translateY(1px) scale(.985); background:var(--brand-dark); }
.answer { position:relative; justify-content:flex-end; gap:12px; overflow:hidden; border-radius:inherit; color:var(--ink); background:#fff; isolation:isolate; }
.phase-bursting .answer { animation:answer-in 400ms 130ms var(--ease-spring) both; }
.phase-bursting .answer-top { animation:detail-in 220ms 130ms var(--ease-standard) both; }
.phase-bursting .dish-name { animation:detail-in 220ms 180ms var(--ease-standard) both; }
.phase-bursting .dish-reason { animation:detail-in 220ms 230ms var(--ease-standard) both; }
.phase-bursting .answer-facts { animation:detail-in 200ms 290ms var(--ease-standard) both; }
.phase-bursting .reveal-actions { animation:detail-in 170ms 360ms var(--ease-standard) both; }
.phase-revealed .answer { animation:answer-settle 160ms var(--ease-standard) both; }
.answer-media { margin-bottom:4px; }
.answer-content { display:flex; min-width:0; flex-direction:column; gap:7px; }
.answer-top { display:flex; align-items:center; justify-content:space-between; gap:16px; }
.dish-location { overflow:hidden; color:var(--muted); font-size:12px; white-space:nowrap; text-overflow:ellipsis; }
.dish-price { flex:0 0 auto; color:var(--brand-dark); font-size:20px; font-weight:600; font-variant-numeric:tabular-nums; }
.dish-name { color:var(--ink); font-size:24px; font-weight:600; line-height:1.25; }
.dish-reason { color:var(--ink-2); font-size:14px; line-height:1.5; }
.answer-facts { display:flex; flex-wrap:wrap; gap:6px; margin-top:2px; }
.answer-facts text { min-height:24px; padding:0 8px; border-radius:999px; color:var(--ink-2); background:var(--surface-soft); font-size:12px; line-height:24px; }
.answer-facts .success { color:var(--success); background:var(--success-soft); }.answer-facts .warning { color:var(--warning); background:var(--warning-soft); }
.reveal-actions { display:grid; grid-template-columns:.85fr 1.15fr; gap:8px; margin-top:12px; }
.reveal-actions button { display:flex; width:100%; min-height:44px; align-items:center; justify-content:center; gap:6px; border-radius:8px; font-size:14px; font-weight:600; }
.reveal-secondary { color:#fff; background:var(--ink-2); }.reveal-secondary:active { background:var(--ink); transform:translateY(1px); }
.reveal-detail { color:#fff; background:var(--brand); }.reveal-detail:active { background:var(--brand-dark); transform:translateY(1px); }
.reveal-note { display:block; margin-top:8px; color:var(--muted); font-size:12px; }
.burst-layer { position:absolute; inset:0; z-index:5; overflow:hidden; border-radius:inherit; pointer-events:none; }
.burst-core { position:absolute; top:50%; left:50%; width:34px; height:34px; margin:-17px 0 0 -17px; border-radius:10px; background:var(--brand); animation:burst-core 240ms var(--ease-standard) both; }
.burst-shard { position:absolute; top:50%; left:50%; width:12px; height:5px; margin:-2px 0 0 -6px; border-radius:2px; background:var(--brand); animation:burst-shard 230ms 10ms var(--ease-standard) both; }
.burst-sentinel { position:absolute; width:1px; height:1px; opacity:0; animation:reveal-complete 530ms linear both; }
.shard-2,.shard-4,.shard-6,.shard-8 { background:#fff; }
.shard-1{--burst-x:-132px;--burst-y:-76px;--burst-r:-24deg}.shard-2{--burst-x:-28px;--burst-y:-112px;--burst-r:38deg}.shard-3{--burst-x:94px;--burst-y:-84px;--burst-r:72deg}.shard-4{--burst-x:142px;--burst-y:-8px;--burst-r:18deg}.shard-5{--burst-x:104px;--burst-y:82px;--burst-r:-34deg}.shard-6{--burst-x:8px;--burst-y:112px;--burst-r:64deg}.shard-7{--burst-x:-112px;--burst-y:76px;--burst-r:22deg}.shard-8{--burst-x:-148px;--burst-y:4px;--burst-r:-62deg}
@keyframes answer-in { from { opacity:0; transform:translateY(10px) scale(.96); } to { opacity:1; transform:none; } }
@keyframes answer-settle { from { opacity:.82; } to { opacity:1; } }
@keyframes detail-in { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
@keyframes burst-core { 0% { opacity:1; transform:scale(.2) rotate(0); } 62% { opacity:.96; transform:scale(19) rotate(8deg); } 100% { opacity:0; transform:scale(22) rotate(10deg); } }
@keyframes burst-shard { 0% { opacity:0; transform:translate(0,0) rotate(0) scale(.6); } 22% { opacity:1; } 100% { opacity:0; transform:translate(var(--burst-x),var(--burst-y)) rotate(var(--burst-r)) scale(1.25); } }
@keyframes reveal-complete { from { opacity:0; } to { opacity:0; } }
.reduced .answer { animation:answer-settle 160ms var(--ease-standard); }.reduced .progress-track view { transition:none; }
@media (min-width:768px) { .reveal-panel,.cover,.answer { min-height:320px; }.cover,.answer { padding:28px; }.cover-title,.dish-name { font-size:28px; }.answer.has-media { display:grid; grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr); align-items:center; }.answer:not(.has-media) .answer-content { max-width:720px; }.answer-media { margin:0; } }
@media (min-width:360px) and (max-width:479px) and (max-height:900px) { .reveal-panel,.cover,.answer { min-height:244px; }.cover,.answer { padding:16px; }.cover-icon { margin-bottom:12px; }.reveal-primary { margin-top:16px; } }
@media (max-height:700px) { .reveal-panel,.cover,.answer { min-height:224px; }.cover-icon { margin-bottom:10px; }.reveal-primary { margin-top:14px; } }
</style>
