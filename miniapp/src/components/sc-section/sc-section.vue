<template>
  <view class="section-head">
    <view>
      <text v-if="eyebrow" class="section-eyebrow">{{ eyebrow }}</text>
      <text class="section-title">{{ title }}</text>
      <text v-if="desc" class="section-desc">{{ desc }}</text>
    </view>
    <slot name="right"></slot>
  </view>
</template>

<script setup>
defineProps({
  eyebrow: { type: String, default: '' },
  title: { type: String, required: true },
  desc: { type: String, default: '' }
});
</script>

<style scoped>
.section-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20rpx;
  margin: 8rpx 0 22rpx;
}
.section-eyebrow,
.section-title,
.section-desc { display: block; }
.section-eyebrow {
  color: #00a874;
  font-size: 21rpx;
  font-weight: 900;
  letter-spacing: 2rpx;
  text-transform: uppercase;
}
.section-title {
  margin-top: 6rpx;
  color: #18232a;
  font-size: 36rpx;
  font-weight: 950;
  line-height: 1.12;
}
.section-desc {
  margin-top: 8rpx;
  color: #72818c;
  font-size: 24rpx;
  line-height: 1.45;
}
</style>
