<template>
  <view class="dish-card" :class="{ 'dish-unavailable': unavailable }" @tap="!unavailable && $emit('tap')">
    <view class="dish-visual">
      <image class="dish-cover" :src="coverSrc" mode="aspectFill" />
      <image class="dish-icon" :src="dishIconSrc" mode="aspectFit" />
      <text v-if="unavailable" class="dish-badge dish-badge-soldout">已售罄</text>
      <text v-else-if="supplyLabel" class="dish-badge dish-badge-supply">{{ supplyLabel }}</text>
      <text v-else-if="badge" class="dish-badge">{{ badge }}</text>
    </view>
    <view class="dish-body">
      <view class="dish-title-row">
        <text class="dish-name">{{ dish.name }}</text>
        <text class="dish-price">¥{{ dish.price }}</text>
      </view>
      <text class="dish-meta">{{ dish.taste }} · {{ dish.cuisine }} · {{ calories }} kcal</text>
      <view class="dish-score-row">
        <text class="score-pill">★ {{ rating }}</text>
        <text class="protein-pill">蛋白 {{ protein }}g</text>
        <text v-if="dish.halal" class="halal-pill">清真</text>
      </view>
      <view class="dish-tags">
        <text v-for="tag in (dish.tags || []).slice(0, 2)" :key="tag" class="dish-tag">{{ tag }}</text>
      </view>
    </view>
    <view class="buy-cta" :class="{ 'buy-disabled': unavailable }">{{ unavailable ? '售' : '选' }}</view>
  </view>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  dish: { type: Object, required: true },
  badge: { type: String, default: '' },
  unavailable: { type: Boolean, default: false },
  supplyStatus: { type: String, default: '' }
});
defineEmits(['tap']);

const covers = ['bowl', 'rice', 'noodle', 'protein', 'soup'];
const coverSrc = computed(() => `/static/food/${covers[Math.abs(hashCode(props.dish.id || props.dish.name)) % covers.length]}.svg`);
const iconNames = ['menu', 'meal-plan', 'order-dish'];
const dishIconSrc = computed(() => `/static/icons/${iconNames[Math.abs(hashCode(props.dish.id || props.dish.name)) % iconNames.length]}.png`);
const calories = computed(() => props.dish.nutrition?.calories || 0);
const supplyLabel = computed(() => props.supplyStatus || '');
const protein = computed(() => props.dish.nutrition?.protein || 0);
const rating = computed(() => Number(props.dish.rating || props.dish.rankScore || 4.8).toFixed(1));

function hashCode(value) {
  let hash = 0;
  const text = String(value || 'dish');
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) - hash) + text.charCodeAt(index);
  return hash;
}
</script>

<style scoped>
.dish-card {
  position: relative;
  display: flex;
  gap: 20rpx;
  padding: 18rpx 84rpx 18rpx 18rpx;
  border-radius: 36rpx;
  background: rgba(255, 255, 255, 0.84);
  border: 1rpx solid rgba(255, 255, 255, 0.58);
  box-shadow: 0 18rpx 46rpx rgba(21, 62, 43, 0.08);
  backdrop-filter: blur(22rpx) saturate(1.25);
}
.dish-visual {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 150rpx;
  height: 150rpx;
  flex: 0 0 150rpx;
  border-radius: 34rpx;
  background: linear-gradient(145deg, #fff7d8, #e9f8ef);
}
.dish-cover {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.dish-icon {
  position: relative;
  z-index: 1;
  width: 74rpx;
  height: 74rpx;
  filter: drop-shadow(0 8rpx 18rpx rgba(24, 35, 42, 0.12));
}
.dish-badge {
  position: absolute;
  z-index: 2;
  left: 10rpx;
  top: 10rpx;
  padding: 5rpx 12rpx;
  border-radius: 999rpx;
  color: #fff;
  background: linear-gradient(135deg, #ffd86b, #58cfa0);
  font-size: 18rpx;
  font-weight: 900;
}
.dish-body { flex: 1; min-width: 0; }
.dish-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14rpx;
}
.dish-name {
  color: #20342b;
  font-size: 30rpx;
  font-weight: 850;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dish-price {
  color: #58cfa0;
  font-size: 31rpx;
  font-weight: 850;
}
.dish-meta {
  display: block;
  margin-top: 10rpx;
  color: #70877b;
  font-size: 22rpx;
}
.dish-score-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  margin-top: 12rpx;
}
.score-pill,
.protein-pill,
.dish-unavailable { opacity: 0.65; }
.dish-unavailable .dish-cover { filter: grayscale(0.5); }
.dish-badge-soldout { background: linear-gradient(135deg, #d9544d, #b03a35) !important; }
.dish-badge-supply { background: linear-gradient(135deg, #4da6e0, #2f74c0) !important; }
.buy-disabled { background: linear-gradient(135deg, #c0c8cc, #a0aab0) !important; box-shadow: none !important; }
.halal-pill {
  padding: 5rpx 10rpx;
  border-radius: 999rpx;
  font-size: 19rpx;
  font-weight: 750;
}
.score-pill { color: #b66b00; background: #fff7d8; }
.protein-pill { color: #2f74c0; background: #eef7ff; }
.halal-pill { color: #1f9f72; background: #e9f8ef; }
.dish-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  margin-top: 12rpx;
}
.dish-tag {
  padding: 6rpx 12rpx;
  border-radius: 999rpx;
  color: #1f9f72;
  background: #e9f8ef;
  font-size: 20rpx;
  font-weight: 700;
}
.buy-cta {
  position: absolute;
  right: 18rpx;
  bottom: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 54rpx;
  height: 54rpx;
  border-radius: 999rpx;
  color: #fff;
  background: linear-gradient(135deg, #6cddb0, #1f9f72);
  box-shadow: 0 14rpx 28rpx rgba(88, 207, 160, 0.22);
  font-size: 22rpx;
  font-weight: 850;
}
.dish-card { animation: dish-rise 360ms ease-out both; }
.dish-card:active { transform: scale(0.985); }
.dish-cover { animation: dish-cover-float 4.6s ease-in-out infinite; }
@keyframes dish-rise {
  from { opacity: 0; transform: translateY(16rpx); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes dish-cover-float {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.035) translateY(-3rpx); }
}
</style>
