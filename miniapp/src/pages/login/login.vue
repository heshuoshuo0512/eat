<template>
  <sc-page-shell hide-nav>
    <view class="login-hero">
      <view class="login-brandline"><image class="login-logo" src="/static/brand/logo-mark-reversed.svg" mode="aspectFit" /><view><text class="login-kicker">SMART CANTEEN</text><text class="login-brand-name">智慧食堂</text></view></view>
      <text class="login-title">校园每一餐，都有真实依据。</text>
      <text class="login-subtitle">菜单、评分、营养与校园口碑统一在这里。</text>
      <view class="login-benefits"><view><text class="benefit-value">真实</text><text>菜品数据</text></view><view><text class="benefit-value">可查</text><text>评价与引用</text></view><view><text class="benefit-value">更懂</text><text>个人偏好</text></view></view>
    </view>

    <view class="login-card panel-card">
      <view class="login-card-head"><text class="section-eyebrow">学生端入口</text><text class="section-title">进入智慧食堂</text><text class="login-card-hint">登录后同步你的健康档案、收藏和用餐记录。</text></view>
      <button class="wechat-btn" :loading="loadingMode === 'wechat'" :disabled="Boolean(loadingMode)" @tap="loginWithWechat">
        <text class="wechat-mark">微</text><text>微信一键登录</text>
      </button>
      <button class="demo-btn" :loading="loadingMode === 'demo'" :disabled="Boolean(loadingMode)" @tap="loginWithDemo">演示账号登录</button>
      <button class="account-toggle" @tap="accountOpen = !accountOpen">{{ accountOpen ? '收起账号登录' : '使用账号密码登录' }} ›</button>
      <view v-if="accountOpen" class="account-panel">
        <label><text>用户名</text><input v-model="form.username" class="input" maxlength="32" placeholder="请输入用户名" /></label>
        <label><text>密码</text><input v-model="form.password" class="input" password maxlength="72" placeholder="请输入密码" /></label>
        <button class="secondary-btn" :loading="loadingMode === 'account'" :disabled="Boolean(loadingMode)" @tap="loginWithAccount">账号登录</button>
      </view>
      <checkbox-group class="consent" @change="consentAccepted = $event.detail.value.includes('accepted')">
        <label><checkbox value="accepted" :checked="consentAccepted" color="#167a5b" /><text>我已阅读并同意</text></label>
        <button @tap="openPrivacy">《隐私保护指引》</button><text>与</text><button @tap="openTerms">《用户服务协议》</button>
      </checkbox-group>
      <text v-if="message" class="login-message" :class="{ error: isError }">{{ message }}</text>
    </view>
  </sc-page-shell>
</template>

<script setup>
import { onShow } from '@dcloudio/uni-app';
import { reactive, ref } from 'vue';
import { DEMO_STUDENT } from '../../config.js';
import { validateLoginForm } from '../../domain/validation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';
const store = useCanteenStore();
const form = reactive({ username:'', password:'' });
const accountOpen = ref(false); const consentAccepted = ref(false); const loadingMode = ref(''); const message = ref(''); const isError = ref(false);
onShow(async () => { try { await store.refreshIfStale(); if (store.user.value) uni.switchTab({ url:'/pages/home/home' }); } catch {} });
function requireConsent() { if (consentAccepted.value) return true; isError.value = true; message.value = '请先同意隐私保护指引和用户服务协议。'; return false; }
async function runLogin(mode, action) { if (!requireConsent()) return; loadingMode.value = mode; message.value = ''; isError.value = false; try { await action(); uni.switchTab({ url:'/pages/home/home' }); } catch (error) { isError.value = true; message.value = error?.message || '登录失败，请稍后重试。'; } finally { loadingMode.value = ''; } }
function loginWithWechat() { return runLogin('wechat', () => store.wechatLogin({})); }
function loginWithDemo() { Object.assign(form, DEMO_STUDENT); return runLogin('demo', () => store.login({ ...DEMO_STUDENT })); }
function loginWithAccount() { const error = validateLoginForm(form); if (error) { isError.value = true; message.value = error; return; } return runLogin('account', () => store.login(form)); }
function openPrivacy() { uni.navigateTo({ url:'/pages/privacy/privacy' }); }
function openTerms() { uni.navigateTo({ url:'/pages/terms/terms' }); }
</script>

<style scoped>
.login-hero { min-height:350rpx; margin:0 calc(var(--page-gutter) * -1) 24rpx; padding:64rpx var(--page-gutter) 42rpx; color:#fff; background:#245f48; box-sizing:border-box; }
.login-logo { width:76rpx; height:76rpx; }
.login-kicker,.login-title,.login-subtitle { display:block; }
.login-kicker { margin-top:30rpx; font-size:22rpx; font-weight:500; opacity:.76; }
.login-title { max-width:590rpx; margin-top:10rpx; font-size:40rpx; font-weight:600; line-height:1.25; }
.login-subtitle { margin-top:12rpx; font-size:24rpx; line-height:1.5; opacity:.86; }
.login-card { padding:26rpx; }
.section-eyebrow,.section-title { display:block; }
.section-eyebrow { color:var(--brand); font-size:22rpx; font-weight:500; }
.section-title { margin-top:5rpx; color:var(--ink); font-size:32rpx; font-weight:600; }
.wechat-btn { display:flex; align-items:center; justify-content:center; gap:12rpx; min-height:88rpx; margin-top:24rpx; border-radius:var(--radius); color:#fff; background:var(--brand); font-size:28rpx; font-weight:500; }
.wechat-mark { display:flex; align-items:center; justify-content:center; width:42rpx; height:42rpx; border-radius:12rpx; color:var(--brand); background:#fff; font-size:22rpx; font-weight:600; }
.demo-btn { width:100%; min-height:88rpx; margin-top:12rpx; border-radius:var(--radius); color:var(--brand-dark); background:var(--brand-soft); font-size:28rpx; font-weight:500; }
.demo-btn:active { transform:scale(.985); }
.account-toggle { display:flex; align-items:center; justify-content:center; width:100%; min-height:64rpx; color:var(--brand); background:transparent; font-size:24rpx; font-weight:500; }
.account-panel { display:flex; flex-direction:column; gap:16rpx; padding:18rpx 0; border-top:1rpx solid var(--line); animation:account-in 200ms ease both; }
.account-panel label>text { display:block; margin-bottom:8rpx; color:var(--ink-2); font-size:24rpx; font-weight:500; }
.consent { display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:2rpx; margin-top:20rpx; color:var(--muted); font-size:22rpx; line-height:1.6; }
.consent label { display:flex; align-items:center; }
.consent checkbox { transform:scale(.82); }
.consent button { display:inline-flex; align-items:center; min-height:48rpx; padding:0 2rpx; color:var(--brand); background:transparent; font-size:22rpx; line-height:1.35; }
.login-message { display:block; margin-top:18rpx; color:var(--brand); font-size:24rpx; text-align:center; }
.login-message.error { color:var(--danger); }
.login-hero { min-height:0; margin:0 calc(var(--page-gutter) * -1) 18rpx; padding:42rpx var(--page-gutter) 34rpx; border-radius:0 0 28rpx 28rpx; background:#215f48; box-shadow:0 14rpx 28rpx rgba(24,72,43,.12); }
.login-brandline { display:flex; align-items:center; gap:16rpx; }
.login-brandline .login-logo { width:64rpx; height:64rpx; }
.login-brand-name { display:block; margin-top:4rpx; color:#fff; font-size:28rpx; font-weight:600; }
.login-brandline .login-kicker { margin-top:0; color:rgba(255,255,255,.72); font-size:22rpx; letter-spacing:2rpx; }
.login-title { margin-top:28rpx; font-size:38rpx; line-height:1.28; }
.login-subtitle { max-width:620rpx; margin-top:10rpx; color:rgba(255,255,255,.82); }
.login-benefits { display:grid; grid-template-columns:repeat(3,1fr); gap:10rpx; margin-top:26rpx; }
.login-benefits view { display:grid; gap:4rpx; padding:14rpx 10rpx; border:1rpx solid rgba(255,255,255,.18); border-radius:14rpx; background:rgba(255,255,255,.1); text-align:center; }
.login-benefits text { color:rgba(255,255,255,.72); font-size:22rpx; }
.login-benefits .benefit-value { color:#fff; font-size:25rpx; font-weight:600; }
.login-card { position:relative; z-index:1; margin:0 4rpx; padding:28rpx; border:1rpx solid rgba(31,122,77,.12); box-shadow:0 12rpx 30rpx rgba(24,72,43,.08); }
.login-card-head { display:grid; gap:4rpx; }
.login-card-hint { margin-top:6rpx; color:var(--muted); font-size:22rpx; line-height:1.5; }
@keyframes account-in { from { opacity:0; transform:translateY(-6rpx); } to { opacity:1; transform:none; } }
</style>
