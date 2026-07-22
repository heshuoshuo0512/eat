<template>
  <button class="dish-card" :class="{ unavailable, compact }" :disabled="disabled" @tap="$emit('tap')">
    <view class="dish-visual">
      <image class="dish-cover" :src="coverSrc" mode="aspectFill" @error="imageFailed = true" />
      <text v-if="statusLabel" class="status-badge" :class="statusClass">{{ statusLabel }}</text>
    </view>
    <view class="dish-body">
      <view class="dish-title-row"><text class="dish-name">{{ dish.name }}</text><text class="dish-price">¥{{ dish.price }}</text></view>
      <text v-if="location" class="dish-location">{{ location }}</text>
      <text class="dish-meta">{{ dish.taste || '口味待补' }} · {{ dish.cuisine || '校园风味' }}</text>
      <view class="dish-facts"><text class="rating">★ {{ rating }}</text><text>{{ calories }} kcal</text><text v-if="protein">蛋白 {{ protein }}g</text></view>
      <view v-if="dish.tags?.length" class="dish-tags"><text v-for="tag in dish.tags.slice(0, 2)" :key="tag">{{ tag }}</text></view>
    </view>
    <text class="chevron">›</text>
  </button>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
const props = defineProps({ dish: { type: Object, required: true }, location: { type: String, default: '' }, badge: { type: String, default: '' }, supplyStatus: { type: String, default: '' }, unavailable: Boolean, disabled: Boolean, compact: Boolean });
defineEmits(['tap']);
const imageFailed = ref(false);
watch(() => props.dish.id, () => { imageFailed.value = false; });
const coverSrc = computed(() => !imageFailed.value && props.dish.imageUrl ? props.dish.imageUrl : '/static/food/bowl.svg');
const calories = computed(() => Number(props.dish.nutrition?.calories || 0));
const protein = computed(() => Number(props.dish.nutrition?.protein || 0));
const rating = computed(() => Number(props.dish.displayRating ?? props.dish.computedRating ?? props.dish.rating ?? 0).toFixed(1));
const statusLabel = computed(() => props.supplyStatus || props.badge || '');
const statusClass = computed(() => props.unavailable || /售罄|不可|非今日/.test(statusLabel.value) ? 'sold' : /紧张|限量/.test(statusLabel.value) ? 'limited' : 'available');
</script>

<style scoped>
.dish-card { position:relative; display:flex; align-items:stretch; gap:18rpx; width:100%; min-height:184rpx; padding:16rpx 46rpx 16rpx 16rpx; overflow:hidden; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); text-align:left; box-sizing:border-box; transition:transform 180ms ease,background-color 180ms ease; }
.dish-card:active { transform:scale(.985); background:#fafcfa; }
.dish-card.unavailable { opacity:.62; }
.dish-card.compact { min-height:156rpx; }
.dish-visual { position:relative; overflow:hidden; width:152rpx; min-height:152rpx; flex:0 0 152rpx; border-radius:12rpx; background:var(--surface-soft); }
.compact .dish-visual { width:124rpx; min-height:124rpx; flex-basis:124rpx; }
.dish-cover { width:100%; height:100%; }
.status-badge { position:absolute; top:8rpx; left:8rpx; max-width:126rpx; padding:5rpx 9rpx; overflow:hidden; border-radius:8rpx; color:#fff; font-size:22rpx; font-weight:500; white-space:nowrap; text-overflow:ellipsis; }
.status-badge.available { background:rgba(35,122,87,.92); }
.status-badge.limited { background:rgba(213,139,34,.94); }
.status-badge.sold { background:rgba(217,99,76,.94); }
.dish-body { display:flex; flex:1; min-width:0; flex-direction:column; justify-content:center; }
.dish-title-row { display:flex; align-items:flex-start; gap:10rpx; }
.dish-name { flex:1; min-width:0; overflow:hidden; color:var(--ink); font-size:28rpx; font-weight:600; white-space:nowrap; text-overflow:ellipsis; }
.dish-price { flex:0 0 auto; color:var(--brand); font-size:28rpx; font-weight:600; }
.dish-location,.dish-meta { display:block; overflow:hidden; margin-top:6rpx; color:var(--muted); font-size:22rpx; white-space:nowrap; text-overflow:ellipsis; }
.dish-facts,.dish-tags { display:flex; flex-wrap:wrap; gap:8rpx; margin-top:10rpx; }
.dish-facts text,.dish-tags text { min-height:36rpx; padding:0 8rpx; border-radius:8rpx; color:var(--ink-2); background:var(--surface-soft); font-size:22rpx; line-height:36rpx; }
.dish-facts .rating { color:#9a6316; background:var(--rating-soft); }
.dish-tags text { color:var(--brand); background:var(--brand-soft); }
.chevron { position:absolute; top:50%; right:16rpx; color:#9aa59f; font-size:36rpx; transform:translateY(-50%); }
</style>
