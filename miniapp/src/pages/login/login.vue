<template>
  <sc-page-shell tone="orange">
    <view class="login-hero"><image class="logo-orb" src="/static/brand/logo-mark-reversed.svg" mode="aspectFit" /><text class="hero-kicker">SMART CANTEEN</text><text class="hero-title">把校园每一餐，做成你的专属推荐。</text><text class="hero-subtitle">今日菜单、健康餐单、拍照识餐、AI 顾问，一个小程序完成。</text></view>
    <view class="login-card panel-card"><sc-section eyebrow="LOGIN" title="学生账号登录" desc="使用学生账号进入菜单、排行榜与健康中心。" /><view class="form-item"><text class="label">用户名</text><input class="input" v-model="form.username" placeholder="请输入用户名" /></view><view class="form-item"><text class="label">密码</text><input class="input" v-model="form.password" password placeholder="请输入密码" /></view><button class="primary-btn" :loading="loading" @tap="submit">进入智慧食堂</button><button class="secondary-btn demo-btn" @tap="fillDemo">填入学生演示账号</button><text v-if="message" class="notice">{{ message }}</text></view>
    <view class="module-grid promise-grid"><view class="module-card"><image class="module-icon" src="/static/icons/menu.png" mode="aspectFit" /><text class="module-title">真实菜单</text><text class="module-desc">只推荐可买到的菜</text></view><view class="module-card"><image class="module-icon" src="/static/icons/meal-plan.png" mode="aspectFit" /><text class="module-title">健康餐单</text><text class="module-desc">按你的目标规划每一餐</text></view></view>
  </sc-page-shell>
</template>
<script setup>
import { reactive, ref } from 'vue';
import { DEMO_STUDENT } from '../../config.js';
import { validateLoginForm } from '../../domain/validation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';
const store = useCanteenStore();
const form = reactive({ ...DEMO_STUDENT });
const loading = ref(false);
const message = ref('');
function fillDemo() { Object.assign(form, DEMO_STUDENT); }
async function submit() { message.value = validateLoginForm(form); if (message.value) return; loading.value = true; try { await store.login(form); uni.switchTab({ url: '/pages/home/home' }); } catch (error) { message.value = error?.message || '登录失败，请检查账号、密码和服务地址。'; } finally { loading.value = false; } }
</script>
<style scoped>
.login-hero { overflow:hidden; margin-bottom:24rpx; padding:44rpx 34rpx; border-radius:44rpx; color:#fff; background:linear-gradient(140deg,#b7efd2 0%,#6cddb0 46%,#1f9f72 100%); }.logo-orb { display:block; width:92rpx; height:92rpx; margin-bottom:28rpx; }.login-card { margin-bottom:22rpx; }.demo-btn { margin-top:18rpx; }.promise-grid { margin-bottom:40rpx; }
</style>
