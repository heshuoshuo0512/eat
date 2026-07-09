<template>
  <view class="screen">
    <view class="header">
      <view>
        <text class="eyebrow">Vision Meal</text>
        <text class="title">拍照识餐</text>
        <text class="subtitle">识别结果会回到真实菜品库匹配，不推荐买不到的菜。</text>
      </view>
    </view>

    <view class="card camera-card">
      <image v-if="imagePath" class="cover-image preview" :src="imagePath" mode="aspectFill" />
      <view v-else class="placeholder">
        <text class="camera-icon">📷</text>
        <text>拍照或从相册选择餐盘</text>
      </view>
      <view class="button-row">
        <button class="secondary-btn" @tap="chooseImage">选择图片</button>
        <button class="primary-btn" :loading="loading" :disabled="!imagePath" @tap="analyze">开始分析</button>
      </view>
      <text v-if="message" class="notice">{{ message }}</text>
    </view>

    <view v-if="result" class="card">
      <text class="eyebrow">分析结果</text>
      <text class="result-title">{{ result.detectedName || '餐食分析' }}</text>
      <text class="subtitle">{{ result.summary || result.advice }}</text>
      <view v-if="result.nutrition" class="summary-grid">
        <view><text class="num">{{ result.nutrition.calories || 0 }}</text><text>kcal</text></view>
        <view><text class="num">{{ result.nutrition.protein || 0 }}g</text><text>蛋白</text></view>
        <view><text class="num">{{ result.confidence || '—' }}</text><text>置信度</text></view>
      </view>
    </view>

    <view v-if="matchedDishes.length" class="card">
      <text class="eyebrow">真实菜品匹配</text>
      <view v-for="dish in matchedDishes" :key="dish.id" class="dish-row">
        <text class="emoji">{{ dish.image }}</text>
        <view class="flex-1">
          <text class="main-text">{{ dish.name }}</text>
          <text class="sub-text">{{ dish.nutrition.calories }} kcal · 蛋白 {{ dish.nutrition.protein }}g · ¥{{ dish.price }}</text>
        </view>
        <text class="pill">可购买</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { imageToBase64 } from '../../utils/format.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const imagePath = ref('');
const result = ref(null);
const message = ref('');
const loading = ref(false);
const matchedDishes = computed(() => result.value?.matches || result.value?.recommendations || result.value?.dishes || []);

onShow(() => {
  if (!store.user.value) uni.redirectTo({ url: '/pages/login/login' });
});

function chooseImage() {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['camera', 'album'],
    success(response) {
      const file = response.tempFiles?.[0];
      if (file?.size > 5 * 1024 * 1024) {
        message.value = '图片不能超过 5MB，请选择压缩图片。';
        return;
      }
      imagePath.value = response.tempFilePaths[0];
      result.value = null;
      message.value = '图片已选择，可以开始分析。';
    }
  });
}

async function analyze() {
  if (!imagePath.value) return;
  loading.value = true;
  message.value = '正在读取图片并调用视觉模型，请稍候。';
  try {
    result.value = await store.analyzeMealImage({
      filename: 'miniapp-meal.jpg',
      contentType: 'image/jpeg',
      dataBase64: await imageToBase64(imagePath.value)
    });
    message.value = '分析完成。';
  } catch (error) {
    message.value = error.message;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.preview { height: 420rpx; }
.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 420rpx;
  border-radius: 30rpx;
  background: linear-gradient(135deg, #eef8e8, #fff7e9);
  color: #708093;
  font-size: 28rpx;
}
.camera-icon { font-size: 82rpx; margin-bottom: 16rpx; }
.button-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16rpx; margin-top: 22rpx; }
.result-title { display: block; margin-top: 8rpx; font-size: 38rpx; font-weight: 900; }
.summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14rpx; margin-top: 22rpx; }
.summary-grid view { padding: 20rpx; border-radius: 24rpx; background: #f3faf0; text-align: center; color: #708093; font-size: 22rpx; }
.summary-grid .num { display: block; color: #08785c; font-size: 32rpx; font-weight: 900; }
.flex-1 { flex: 1; min-width: 0; }
</style>
