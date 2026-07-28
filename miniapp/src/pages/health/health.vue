<template><view class="redirect-page"><text>正在打开健康档案</text></view></template>
<script setup>
import { onLoad } from '@dcloudio/uni-app';
onLoad(() => { uni.redirectTo({ url: '/pages/health-profile/health-profile' }); });
</script>
<style scoped>.redirect-page{display:flex;align-items:center;justify-content:center;min-height:100vh;color:#171717;background:#f6f7f9;font-size:14px}</style>
