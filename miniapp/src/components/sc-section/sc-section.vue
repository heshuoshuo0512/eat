<template>
  <view class="section-head">
    <view class="section-copy">
      <text v-if="eyebrow" class="section-eyebrow">{{ eyebrow }}</text>
      <text class="section-title">{{ title }}</text>
      <text v-if="desc" class="section-desc">{{ desc }}</text>
    </view>
    <slot name="right"></slot>
  </view>
</template>

<script setup>
defineProps({ eyebrow: { type: String, default: '' }, title: { type: String, required: true }, desc: { type: String, default: '' } });
</script>

<style scoped>
.section-head { display:flex; align-items:flex-end; justify-content:space-between; gap:20rpx; margin:12rpx 0 20rpx; }
.section-copy { min-width:0; }
.section-eyebrow,.section-title,.section-desc { display:block; }
.section-eyebrow { color:var(--brand); font-size:22rpx; font-weight:500; }
.section-title { margin-top:4rpx; color:var(--ink); font-size:30rpx; font-weight:600; line-height:1.35; }
.section-desc { margin-top:6rpx; color:var(--muted); font-size:24rpx; line-height:1.5; }
</style>
