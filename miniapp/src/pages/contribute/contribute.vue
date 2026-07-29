<template>
  <view class="collector-page">
    <web-view v-if="collectorUrl" :src="collectorUrl" />
    <view v-else class="missing"><text>采集站地址尚未配置</text></view>
  </view>
</template>

<script setup>
import { COLLECTOR_URL } from '../../config.js';

const collectorUrl = COLLECTOR_URL;
</script>

<style scoped>
.collector-page { min-height: 100vh; background: #f5f6f7; }
.missing { display: flex; min-height: 70vh; align-items: center; justify-content: center; color: #767d84; font-size: 14px; }
</style>
