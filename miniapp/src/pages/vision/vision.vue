<template>
  <sc-page-shell back title="拍照识餐" subtitle="识别 · 营养 · 匹配" tone="blue">
    <view class="page-intro">
      <text class="intro-title">拍一下，知道怎么吃。</text>
      <text class="intro-desc">先识别餐盘，再匹配真实菜品和健康替代推荐。</text>
    </view>

    <sc-state-card v-if="store.error.value" type="error" title="视觉服务暂不可用" :desc="store.error.value" action-text="去菜单检索" @action="openDishes" />

    <view class="camera-card">
      <view class="camera-card__header">
        <text class="camera-card__eyebrow">CAMERA</text>
        <text class="camera-card__title">上传餐盘图片</text>
      </view>

      <image v-if="imagePath" class="camera-preview" :src="imagePath" mode="aspectFill" />
      <view v-else class="camera-placeholder">
        <image class="camera-placeholder__icon" src="/static/icons/camera.png" mode="aspectFit" />
        <text class="camera-placeholder__title">添加餐盘图片</text>
        <text class="camera-placeholder__desc">支持拍照或相册，建议光线充足。</text>
      </view>

      <view class="camera-card__actions">
        <button class="secondary-btn" @tap="chooseImage">选择图片</button>
        <button class="primary-btn" :loading="loading" :disabled="!imagePath" @tap="analyze">开始分析</button>
      </view>
      <text v-if="message" class="notice">{{ message }}</text>
    </view>

    <view v-if="result" class="panel-card result-card">
      <view class="result-card__header">
        <text class="result-card__eyebrow">RESULT</text>
        <text class="result-card__title">{{ result.detectedName || '餐食分析' }}</text>
        <text v-if="result.summary || result.advice" class="result-card__desc">{{ result.summary || result.advice }}</text>
      </view>
      <view v-if="result.nutrition" class="result-nutrition">
        <view class="nutrition-item">
          <text class="nutrition-num">{{ result.nutrition.calories || 0 }}</text>
          <text class="nutrition-unit">kcal</text>
        </view>
        <view class="nutrition-item">
          <text class="nutrition-num">{{ result.nutrition.protein || 0 }}g</text>
          <text class="nutrition-unit">蛋白</text>
        </view>
        <view class="nutrition-item">
          <text class="nutrition-num">{{ result.confidence || '—' }}</text>
          <text class="nutrition-unit">置信度</text>
        </view>
      </view>
    </view>

    <view v-if="matchedDishes.length" class="panel-card">
      <view class="matches-header">
        <text class="matches-eyebrow">MATCHED DISHES</text>
        <text class="matches-title">真实菜品匹配</text>
      </view>
      <view class="dish-stack">
        <sc-dish-card v-for="dish in matchedDishes" :key="dish.id" :dish="dish" badge="可买" @tap="openDishes" />
      </view>
    </view>

    <sc-state-card v-if="result && !matchedDishes.length" type="empty" title="未匹配到真实菜品" desc="可以去菜单检索相近菜品，或换一张更清晰的餐盘照片。" action-text="去菜单" @action="openDishes" />
  </sc-page-shell>
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
function openDishes() { uni.switchTab({ url: '/pages/dishes/dishes' }); }

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
.page-intro { margin-bottom: 24rpx; padding: 28rpx 30rpx; border-radius: 28rpx; background: linear-gradient(135deg, #f0f8ff, #e4f0fa); }
.intro-title { display: block; font-size: 34rpx; font-weight: 900; color: #18251f; line-height: 1.25; }
.intro-desc { display: block; margin-top: 10rpx; font-size: 23rpx; color: #70877b; line-height: 1.5; }

.camera-card { margin-bottom: 24rpx; border-radius: 28rpx; background: #fff; border: 1rpx solid #e5ece8; box-shadow: 0 4rpx 20rpx rgba(0,0,0,.04); overflow: hidden; }
.camera-card__header { padding: 28rpx 28rpx 0; }
.camera-card__eyebrow { display: block; font-size: 20rpx; font-weight: 800; color: #84918a; letter-spacing: 2rpx; }
.camera-card__title { display: block; margin-top: 4rpx; font-size: 28rpx; font-weight: 900; color: #18251f; }
.camera-preview { display: block; width: 100%; height: 420rpx; margin-top: 20rpx; }
.camera-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 420rpx; margin: 20rpx 28rpx 0; border-radius: 26rpx; background: linear-gradient(135deg, #eef7ff, #e9f8ef); color: #70877b; }
.camera-placeholder__icon { width: 72rpx; height: 72rpx; margin-bottom: 16rpx; }
.camera-placeholder__title { color: #20342b; font-size: 30rpx; font-weight: 950; }
.camera-placeholder__desc { margin-top: 8rpx; font-size: 23rpx; }
.camera-card__actions { display: grid; grid-template-columns: 1fr 1fr; gap: 16rpx; padding: 20rpx 28rpx 28rpx; }

.result-card { }
.result-card__header { margin-bottom: 18rpx; }
.result-card__eyebrow { display: block; font-size: 20rpx; font-weight: 800; color: #1f9f72; letter-spacing: 2rpx; }
.result-card__title { display: block; margin-top: 4rpx; font-size: 30rpx; font-weight: 900; color: #18251f; }
.result-card__desc { display: block; margin-top: 6rpx; font-size: 23rpx; color: #70877b; line-height: 1.5; }

.result-nutrition { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14rpx; }
.nutrition-item { padding: 22rpx; border-radius: 26rpx; background: #f4fbef; text-align: center; }
.nutrition-num { display: block; color: #1f9f72; font-size: 34rpx; font-weight: 950; }
.nutrition-unit { display: block; margin-top: 4rpx; color: #70877b; font-size: 22rpx; }

.matches-header { margin-bottom: 18rpx; }
.matches-eyebrow { display: block; font-size: 20rpx; font-weight: 800; color: #84918a; letter-spacing: 2rpx; }
.matches-title { display: block; margin-top: 4rpx; font-size: 28rpx; font-weight: 900; color: #18251f; }
.dish-stack { display: flex; flex-direction: column; gap: 18rpx; }
.notice { display: block; margin-top: 14rpx; padding: 0 28rpx 28rpx; color: #70877b; font-size: 23rpx; }
</style>
