<template>
  <view class="reveal" :class="[`phase-${phase}`, { reduced: reducedMotion }]">
    <view class="reveal-head"><view><text class="kicker">今日灵感</text><text class="heading">{{ phase === 'covered' ? '点开看看今天吃什么' : '这道菜为什么适合你' }}</text></view><text class="progress">{{ dish ? `${index + 1}/${total}` : '0/0' }}</text></view>
    <sc-state-card v-if="!dish" type="empty" title="暂无推荐" desc="刷新后再看看今天适合吃什么。" />
    <button v-else class="reveal-media" @tap="$emit('action')">
      <image class="reveal-image" :src="imageSrc" mode="aspectFill" @error="imageFailed = true" />
      <view v-if="phase === 'covered'" class="cover"><text>点击揭晓</text><text>依据档案与今日供应挑选</text></view>
      <view v-else class="answer"><text class="dish-name">{{ dish.name }}</text><text class="dish-meta">{{ location }}</text><text class="dish-reason">{{ reason }}</text><view><text>{{ dish.nutrition?.calories || 0 }} kcal</text><text>¥{{ dish.price }}</text><text>{{ supply }}</text></view></view>
    </button>
    <view class="reveal-footer"><text>{{ phase === 'covered' ? '轻触图片揭晓' : '再点一次切换下一张' }}</text><view><button aria-label="重置揭晓" @tap="$emit('reset')"><view>重置</view></button><button v-if="dish && phase === 'revealed'" @tap="$emit('detail', dish.id)"><view>查看详情</view></button></view></view>
  </view>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
const props = defineProps({ dish:{type:Object,default:null}, index:{type:Number,default:0}, total:{type:Number,default:0}, phase:{type:String,default:'covered'}, location:{type:String,default:''}, reason:{type:String,default:''}, supply:{type:String,default:''}, reducedMotion:Boolean });
defineEmits(['action','reset','detail']);
const imageFailed = ref(false);
watch(() => props.dish?.id, () => { imageFailed.value = false; });
const imageSrc = computed(() => !imageFailed.value && props.dish?.imageUrl ? props.dish.imageUrl : '/static/food/hero-meal.svg');
</script>

<style scoped>
.reveal { margin-bottom:36rpx; }
.reveal-head { display:flex; align-items:flex-end; justify-content:space-between; gap:16rpx; margin-bottom:16rpx; }
.kicker,.heading { display:block; }
.kicker { color:var(--brand); font-size:22rpx; font-weight:500; }
.heading { margin-top:4rpx; color:var(--ink); font-size:30rpx; font-weight:600; line-height:1.35; }
.progress { color:var(--muted); font-size:24rpx; }
.reveal-media { position:relative; overflow:hidden; width:100%; height:390rpx; padding:0; border-radius:var(--radius-large); background:var(--surface-soft); text-align:left; box-shadow:var(--shadow); transition:transform 180ms ease; }
.reveal-media:active { transform:scale(.99); }
.reveal-image { width:100%; height:100%; transition:transform 320ms ease,filter 320ms ease; }
.phase-covered .reveal-image { filter:saturate(.65) brightness(.66); transform:scale(1.025); }
.cover,.answer { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:flex-end; padding:28rpx; color:#fff; box-sizing:border-box; }
.cover { align-items:center; justify-content:center; background:rgba(10,31,21,.28); text-align:center; }
.cover text:first-child { font-size:38rpx; font-weight:600; }
.cover text:last-child { margin-top:8rpx; font-size:24rpx; opacity:.86; }
.answer { gap:7rpx; background:linear-gradient(180deg,rgba(9,24,16,0) 22%,rgba(9,28,18,.9) 100%); animation:answer-in 320ms ease both; }
.dish-name { font-size:40rpx; font-weight:600; }
.dish-meta,.dish-reason { font-size:24rpx; line-height:1.5; opacity:.9; }
.answer view { display:flex; flex-wrap:wrap; gap:8rpx; margin-top:5rpx; }
.answer view text { min-height:40rpx; padding:0 10rpx; border-radius:8rpx; background:rgba(255,255,255,.18); font-size:22rpx; line-height:40rpx; }
.reveal-footer { display:flex; align-items:center; justify-content:space-between; gap:12rpx; min-height:76rpx; padding:8rpx 2rpx 0; }
.reveal-footer>text { color:var(--muted); font-size:22rpx; }
.reveal-footer>view { display:flex; gap:8rpx; }
.reveal-footer button { display:flex; align-items:center; justify-content:center; min-height:88rpx; padding:0 3rpx; color:var(--brand); background:transparent; font-size:24rpx; font-weight:500; }
.reveal-footer button>view { display:flex; align-items:center; justify-content:center; min-height:60rpx; padding:0 16rpx; border-radius:10rpx; background:var(--brand-soft); line-height:1; box-sizing:border-box; }
@keyframes answer-in { from { opacity:0; transform:translateY(8rpx); } to { opacity:1; transform:none; } }
.reduced .answer { animation:none; }
.reduced .reveal-image { transition:none; }
.reduced.phase-covered .reveal-image { transform:none; }
</style>
