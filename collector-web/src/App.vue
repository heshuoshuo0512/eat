<template>
  <div class="app-shell">
    <header class="topbar">
      <router-link class="brand" to="/" aria-label="返回采集首页">
        <span class="brand-mark"><Camera :size="20" /></span>
        <span><strong>校园菜品采集</strong><small>Campus Dish Dataset</small></span>
      </router-link>
      <nav aria-label="主导航">
        <router-link to="/"><LayoutGrid :size="17" />采集</router-link>
        <router-link to="/me"><Award :size="17" />我的</router-link>
        <router-link class="icon-link" to="/staff" title="审核工作台" aria-label="审核工作台"><ShieldCheck :size="19" /></router-link>
      </nav>
    </header>
    <main><router-view /></main>
    <footer>图片仅在授权后用于校园菜品识别模型，当前设备可随时撤回。</footer>
  </div>
</template>

<script setup>
import { Award, Camera, LayoutGrid, ShieldCheck } from '@lucide/vue';
</script>
