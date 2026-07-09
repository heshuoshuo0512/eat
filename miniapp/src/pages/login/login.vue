<template>
  <sc-page-shell tone="orange">
    <view class="login-hero">
      <view class="logo-orb">食</view>
      <text class="hero-kicker">SMART CANTEEN</text>
      <text class="hero-title">把校园每一餐，做成你的专属推荐。</text>
      <text class="hero-subtitle">今日菜单、健康餐单、拍照识餐、AI 顾问，一个小程序完成。</text>
    </view>

    <view class="login-card panel-card">
      <sc-section eyebrow="LOGIN" title="学生端入口" desc="微信登录用于正式小程序，账号密码保留给本地演示。" />
      <label class="consent-row">
        <checkbox :checked="privacyAccepted" color="#58cfa0" @tap="privacyAccepted = !privacyAccepted" />
        <view class="consent-copy">
          <text>我已阅读并同意</text>
          <text class="legal-link" @tap.stop="openPrivacy">《隐私保护指引》</text>
          <text>和</text>
          <text class="legal-link" @tap.stop="openTerms">《用户服务协议》</text>
        </view>
      </label>
      <button class="wechat-btn" :loading="wechatLoading" @tap="submitWechat">微信一键登录</button>
      <view class="divider"><text>或使用演示账号</text></view>
      <view class="form-item">
        <text class="label">用户名</text>
        <input class="input" v-model="form.username" placeholder="请输入用户名" />
      </view>
      <view class="form-item">
        <text class="label">密码</text>
        <input class="input" v-model="form.password" password placeholder="请输入密码" />
      </view>
      <button class="primary-btn" :loading="loading" @tap="submit">进入智慧食堂</button>
      <button class="secondary-btn demo-btn" @tap="fillDemo">填入学生演示账号</button>
      <text v-if="message" class="notice">{{ message }}</text>
    </view>

    <view class="module-grid promise-grid">
      <view class="module-card"><image class="module-icon" src="/static/icons/menu.png" mode="aspectFit" /><text class="module-title">真实菜单</text><text class="module-desc">只推荐可买到的菜</text></view>
      <view class="module-card"><image class="module-icon" src="/static/icons/meal-plan.png" mode="aspectFit" /><text class="module-title">健康档案</text><text class="module-desc">预算和目标可配置</text></view>
    </view>
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
const wechatLoading = ref(false);
const message = ref('');
const privacyAccepted = ref(false);

function ensureConsent() {
  if (privacyAccepted.value) return true;
  message.value = '请先阅读并同意隐私保护指引和用户服务协议。';
  return false;
}

function requestPlatformPrivacyAuthorize() {
  if (typeof uni.requirePrivacyAuthorize !== 'function') return Promise.resolve();
  return new Promise((resolve, reject) => {
    uni.requirePrivacyAuthorize({
      success: resolve,
      fail: () => reject(new Error('请先完成微信隐私授权后再登录。'))
    });
  });
}

function fillDemo() {
  Object.assign(form, DEMO_STUDENT);
  message.value = '';
}

async function submit() {
  if (!ensureConsent()) return;
  try {
    await requestPlatformPrivacyAuthorize();
  } catch (error) {
    message.value = error.message;
    return;
  }
  message.value = validateLoginForm(form);
  if (message.value) return;
  loading.value = true;
  try {
    await store.login(form);
    uni.switchTab({ url: '/pages/home/home' });
  } catch (error) {
    message.value = error.message;
  } finally {
    loading.value = false;
  }
}

async function submitWechat() {
  if (!ensureConsent()) return;
  try {
    await requestPlatformPrivacyAuthorize();
  } catch (error) {
    message.value = error.message;
    return;
  }
  wechatLoading.value = true;
  message.value = '';
  try {
    await store.wechatLogin();
    uni.switchTab({ url: '/pages/home/home' });
  } catch (error) {
    message.value = error.message;
  } finally {
    wechatLoading.value = false;
  }
}

function openPrivacy() { uni.navigateTo({ url: '/pages/privacy/privacy' }); }
function openTerms() { uni.navigateTo({ url: '/pages/terms/terms' }); }
</script>

<style scoped>
.login-hero {
  overflow: hidden;
  margin-bottom: 24rpx;
  padding: 44rpx 34rpx;
  border-radius: 44rpx;
  color: #fff;
  background: linear-gradient(140deg, #b7efd2 0%, #6cddb0 46%, #1f9f72 100%);
  box-shadow: 0 30rpx 76rpx rgba(88,207,160,.22);
}
.logo-orb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 92rpx;
  height: 92rpx;
  margin-bottom: 28rpx;
  border-radius: 30rpx;
  color: #58cfa0;
  background: #fff;
  font-size: 46rpx;
  font-weight: 950;
}
.login-card { margin-bottom: 22rpx; }
.wechat-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 92rpx;
  border-radius: 999rpx;
  color: #fff;
  background: linear-gradient(135deg, #6cddb0, #1f9f72);
  font-size: 29rpx;
  font-weight: 950;
  box-shadow: 0 18rpx 36rpx rgba(18, 200, 111, 0.24);
}
.divider {
  display: flex;
  justify-content: center;
  margin: 28rpx 0;
  color: #94a1aa;
  font-size: 23rpx;
}
.consent-row {
  display: flex;
  align-items: flex-start;
  gap: 10rpx;
  margin-bottom: 22rpx;
  color: #426052;
  font-size: 23rpx;
  line-height: 1.5;
}
.consent-copy { flex: 1; min-width: 0; }
.legal-link { color: #1f9f72; font-weight: 750; }
.demo-btn { margin-top: 18rpx; }
.promise-grid { margin-bottom: 40rpx; }
</style>
