<template>
  <sc-page-shell title="找菜">
    <sc-state-card type="loading" title="正在打开智能推荐" desc="推荐已并入找菜工作区。" />
  </sc-page-shell>
</template>

<script setup>
import { onLoad } from '@dcloudio/uni-app';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();

onLoad(() => {
  store.openDiscoveryMode('recommend');
  uni.switchTab({ url: '/pages/dishes/dishes' });
});
</script>
