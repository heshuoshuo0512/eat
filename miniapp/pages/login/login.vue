<template>
  <view class="screen login-screen">
    <view class="hero-card card glass">
      <text class="eyebrow">Smart Canteen</text>
      <text class="title">今天吃什么，交给数据。</text>
      <text class="subtitle">登录后查看今日菜单、健康推荐、拍照识餐和智能顾问。</text>
    </view>

    <view class="card">
      <view class="form-item">
        <text class="label">用户名</text>
        <input class="input" v-model="form.username" placeholder="请输入用户名" />
      </view>
      <view class="form-item">
        <text class="label">密码</text>
        <input class="input" v-model="form.password" password placeholder="请输入密码" />
      </view>
      <button class="primary-btn" :loading="loading" @tap="submit">进入智慧食堂</button>
      <button class="secondary-btn demo-btn" @tap="fillDemo">使用学生演示账号</button>
      <text v-if="message" class="notice">{{ message }}</text>
    </view>
  </view>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { DEMO_STUDENT } from '../../config.js';
import { validateLoginForm } from '../../../src/domain/validation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const form = reactive({ ...DEMO_STUDENT });
const loading = ref(false);
const message = ref('');

function fillDemo() {
  Object.assign(form, DEMO_STUDENT);
  message.value = '';
}

async function submit() {
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
</script>

<style scoped>
.login-screen {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.hero-card {
  padding: 44rpx 34rpx;
}

.demo-btn {
  margin-top: 18rpx;
}
</style>
