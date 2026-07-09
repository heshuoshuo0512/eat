<template>
  <section class="page-heading">
    <p class="eyebrow">Visual Meal Assistant</p>
    <h1>拍照识餐</h1>
    <p>上传或拍摄一张餐食照片，AI 先识别菜品，再匹配校内真实菜品库，给出可买到的替代选择和健康建议。</p>
  </section>

  <section class="grid two-columns align-start">
    <article class="card admin-form">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">Camera</p>
          <h2>上传餐食照片</h2>
        </div>
        <span class="pill">多模态识别</span>
      </div>
      <label>拍照/上传图片<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" capture="environment" @change="handleFile" /></label>
      <div v-if="preview" class="vision-preview"><img :src="preview" alt="待分析餐食" /></div>
      <div class="table-actions">
        <button class="primary" type="button" :disabled="loading || !file" @click="analyze">{{ loading ? '分析中...' : '分析餐食' }}</button>
        <button class="ghost" type="button" @click="reset">清空</button>
      </div>
      <p class="muted">识别结果为 AI 估算；推荐只来自当前食堂真实菜品库，不会编造不存在的菜。</p>
      <p v-if="message" :class="['form-message', { danger: messageType === 'error' }]">{{ message }}</p>
    </article>

    <Transition name="surface-fade">
      <article v-if="result" class="card admin-form">
        <div class="section-title horizontal">
          <div>
            <p class="eyebrow">Recognition</p>
            <h2>{{ result.suggestion.name || '识别结果' }}</h2>
          </div>
          <span class="pill">置信度 {{ Math.round(result.suggestion.confidence * 100) }}%</span>
        </div>
        <p>{{ result.suggestion.notes }}</p>
        <div class="nutrition-grid">
          <span>{{ result.suggestion.nutrition.calories }} kcal</span>
          <span>蛋白 {{ result.suggestion.nutrition.protein }}g</span>
          <span>脂肪 {{ result.suggestion.nutrition.fat }}g</span>
          <span>碳水 {{ result.suggestion.nutrition.carbs }}g</span>
        </div>
        <div v-if="result.assessment" class="meal-score">
          <strong>{{ result.assessment.score }}</strong>
          <span>{{ result.assessment.level }} · {{ result.assessment.summary }}</span>
        </div>
        <ul v-if="result.assessment" class="insight-list compact">
          <li v-for="item in result.assessment.positives" :key="`p-${item}`"><strong>亮点</strong><span>{{ item }}</span></li>
          <li v-for="item in result.assessment.cautions" :key="`c-${item}`"><strong>注意</strong><span>{{ item }}</span></li>
        </ul>
        <p class="muted">食材：{{ result.suggestion.ingredients.join(' / ') || '待确认' }}</p>
        <p class="muted">标签：{{ result.suggestion.tags.join(' / ') || '待确认' }}</p>
      </article>
    </Transition>
  </section>

  <section v-if="result" class="card">
    <div class="section-title horizontal">
      <div>
        <p class="eyebrow">Grounded Picks</p>
        <h2>校内可买到的相似/替代选择</h2>
      </div>
      <span class="pill">{{ result.matches.length }} 个匹配</span>
    </div>
    <p>{{ result.guidance }}</p>
    <div class="cards-grid" v-if="result.matches?.length">
      <article v-for="dish in result.matches" :key="dish.id" class="mini-card match-card">
        <strong>{{ dish.image }} {{ dish.name }}</strong>
        <span>¥{{ dish.price }} · {{ dish.taste }}</span>
        <small v-if="dish.canteen || dish.stall">{{ dish.canteen?.name || '未知食堂' }} · {{ dish.stall?.name || '未知档口' }}</small>
        <small>{{ dish.tags.join(' / ') }}</small>
        <small>{{ dish.nutrition.calories }} kcal · 蛋白 {{ dish.nutrition.protein }}g</small>
        <span class="pill">匹配 {{ Math.round((dish.matchScore || 0) * 100) }}%</span>
        <small v-if="dish.matchReasons?.length">{{ dish.matchReasons.join('；') }}</small>
      </article>
    </div>
    <div class="cards-grid" v-else-if="result.plan?.picks?.length">
      <article v-for="dish in result.plan.picks" :key="dish.id" class="mini-card">
        <strong>{{ dish.image }} {{ dish.name }}</strong>
        <span>¥{{ dish.price }} · {{ dish.taste }}</span>
        <small v-if="dish.canteen || dish.stall">{{ dish.canteen?.name || '未知食堂' }} · {{ dish.stall?.name || '未知档口' }}</small>
        <small>{{ dish.tags.join(' / ') }}</small>
        <small>{{ dish.nutrition.calories }} kcal · 蛋白 {{ dish.nutrition.protein }}g</small>
      </article>
    </div>
  </section>
</template>

<script setup>
import { onBeforeUnmount, ref } from 'vue';
import { validateImageFile } from '../domain/validation.js';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const file = ref(null);
const preview = ref('');
const result = ref(null);
const message = ref('');
const messageType = ref('info');
const loading = ref(false);
let activeController = null;

function fileToBase64(input) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(input);
  });
}

function revokePreview() {
  if (preview.value) URL.revokeObjectURL(preview.value);
}

function reset() {
  if (activeController) activeController.abort();
  activeController = null;
  revokePreview();
  file.value = null;
  preview.value = '';
  result.value = null;
  message.value = '';
  messageType.value = 'info';
}

function handleFile(event) {
  const selected = event.target.files?.[0];
  reset();
  if (!selected) return;
  const error = validateImageFile(selected);
  if (error) {
    message.value = error;
    messageType.value = 'error';
    return;
  }
  file.value = selected;
  preview.value = URL.createObjectURL(selected);
  message.value = '图片已选择，可以开始分析。';
  messageType.value = 'info';
}

async function analyze() {
  if (!file.value) return;
  loading.value = true;
  message.value = '正在读取图片并调用视觉模型，请稍候。';
  messageType.value = 'info';
  activeController = new AbortController();
  try {
    const selected = file.value;
    result.value = await store.analyzeMealImage({ filename: selected.name, contentType: selected.type, dataBase64: await fileToBase64(selected) }, { signal: activeController.signal });
    message.value = '分析完成。';
  } catch (error) {
    message.value = error.message;
    messageType.value = 'error';
  } finally {
    loading.value = false;
    activeController = null;
  }
}

onBeforeUnmount(reset);
</script>
