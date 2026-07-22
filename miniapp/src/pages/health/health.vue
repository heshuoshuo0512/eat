<template><view class="redirect-page"><text>正在打开健康档案</text></view></template>
<script setup>
import { onLoad } from '@dcloudio/uni-app';
onLoad(() => { uni.redirectTo({ url: '/pages/health-profile/health-profile' }); });
</script>
<style scoped>.redirect-page{display:flex;align-items:center;justify-content:center;min-height:100vh;color:#167a5b;background:#f4f7f5;font-size:24rpx}</style>
