<template>
  <section class="page-heading">
    <p class="eyebrow">个人健康数据</p>
    <h1>健康档案</h1>
    <p>维护饮食目标与忌口信息，保存后智能推荐会立即使用最新档案。</p>
  </section>

  <form class="card profile-form" @submit.prevent="saveProfile">
    <div class="profile-grid">
      <label>
        <span>饮食目标</span>
        <select v-model="form.goal">
          <option value="fatLoss">减脂</option>
          <option value="muscleGain">增肌</option>
          <option value="maintain">维持体重</option>
          <option value="healthy">健康饮食</option>
        </select>
      </label>

      <label>
        <span>餐次</span>
        <select v-model="form.mealType">
          <option value="breakfast">早餐</option>
          <option value="lunch">午餐</option>
          <option value="dinner">晚餐</option>
        </select>
      </label>

      <label class="range-field">
        <span>预算上限：¥{{ form.budgetMax }}</span>
        <input v-model.number="form.budgetMax" type="range" min="8" max="80" step="1" />
      </label>

      <label>
        <span>口味偏好</span>
        <select v-model="form.taste">
          <option v-for="taste in tasteOptions" :key="taste" :value="taste">{{ taste }}</option>
        </select>
      </label>

      <label>
        <span>饮食模式</span>
        <select v-model="form.dietaryPattern">
          <option value="balanced">均衡</option>
          <option value="omnivore">杂食</option>
          <option value="pescatarian">鱼素</option>
          <option value="vegetarian">素食</option>
          <option value="vegan">纯素</option>
          <option value="lowCarb">低碳水</option>
          <option value="keto">生酮</option>
        </select>
      </label>

      <label>
        <span>辣度偏好</span>
        <select v-model.number="form.spiceLevel">
          <option :value="1">不辣</option>
          <option :value="2">微辣</option>
          <option :value="3">中辣</option>
          <option :value="4">重辣</option>
          <option :value="5">极辣</option>
        </select>
      </label>
    </div>

    <fieldset class="tag-fieldset">
      <legend>营养关注</legend>
      <div class="tag-toggle-row">
        <button
          v-for="item in nutritionFocusOptions"
          :key="item.value"
          type="button"
          class="pill-toggle"
          :class="{ active: form.nutritionFocus.includes(item.value) }"
          :aria-pressed="form.nutritionFocus.includes(item.value)"
          @click="toggleNutritionFocus(item.value)"
        >
          {{ item.label }}
        </button>
      </div>
    </fieldset>

    <div class="profile-grid text-fields">
      <label>
        <span>喜爱标签（逗号分隔）</span>
        <input v-model="favoriteTagsText" placeholder="如：高蛋白, 低脂, 快手" />
      </label>
      <label>
        <span>忌口 / 过敏食材（逗号分隔）</span>
        <input v-model="avoidText" placeholder="如：花生, 虾, 牛奶" />
      </label>
    </div>

    <div class="binary-options">
      <label class="check-label"><input v-model="form.halalOnly" type="checkbox" /><span>仅清真</span></label>
      <label class="check-label"><input v-model="form.preferLowCrowd" type="checkbox" /><span>偏好低人流食堂</span></label>
    </div>

    <div class="form-actions">
      <button class="primary" type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存健康档案' }}</button>
      <RouterLink class="secondary button-link" to="/recommend">进入智能推荐</RouterLink>
    </div>
    <p v-if="message" class="form-message" :class="{ danger: isError }" aria-live="polite">{{ message }}</p>
  </form>
</template>

<script setup>
import { reactive, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { normalizeProfileInput } from '../domain/validation.js';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const saving = ref(false);
const message = ref('');
const isError = ref(false);
const tasteOptions = ['不限', '咸鲜', '麻辣', '酸辣', '黑椒', '清淡', '甜味', '酱香'];
const nutritionFocusOptions = [
  { value: 'highProtein', label: '高蛋白' },
  { value: 'lowFat', label: '低脂' },
  { value: 'lowCarb', label: '低碳水' },
  { value: 'highFiber', label: '高纤维' },
  { value: 'lowSodium', label: '低钠' },
  { value: 'lowSugar', label: '低糖' }
];

const form = reactive({
  goal: 'healthy', mealType: 'lunch', budgetMax: 20, taste: '不限', halalOnly: false,
  dietaryPattern: 'balanced', spiceLevel: 3, nutritionFocus: [], preferLowCrowd: false
});
const avoidText = ref('');
const favoriteTagsText = ref('');

watch(() => store.profile, syncProfile, { immediate: true, deep: true });

function syncProfile(profile = {}) {
  form.goal = profile.goal || 'healthy';
  form.mealType = profile.mealType || 'lunch';
  form.budgetMax = profile.budgetMax ?? 20;
  form.taste = profile.taste || '不限';
  form.halalOnly = Boolean(profile.halalOnly);
  form.dietaryPattern = profile.dietaryPattern || 'balanced';
  form.spiceLevel = profile.spiceLevel ?? 3;
  form.nutritionFocus = Array.isArray(profile.nutritionFocus) ? [...profile.nutritionFocus] : [];
  form.preferLowCrowd = Boolean(profile.preferLowCrowd);
  avoidText.value = Array.isArray(profile.avoid) ? profile.avoid.join(', ') : '';
  favoriteTagsText.value = Array.isArray(profile.favoriteTags) ? profile.favoriteTags.join(', ') : '';
}

function toggleNutritionFocus(value) {
  const index = form.nutritionFocus.indexOf(value);
  if (index === -1) form.nutritionFocus.push(value);
  else form.nutritionFocus.splice(index, 1);
}

async function saveProfile() {
  saving.value = true;
  message.value = '';
  isError.value = false;
  try {
    const payload = {
      ...form,
      favoriteTags: favoriteTagsText.value.split(/[，,]+/).map((item) => item.trim()).filter(Boolean),
      avoid: avoidText.value.split(/[，,]+/).map((item) => item.trim()).filter(Boolean)
    };
    await store.saveProfile(normalizeProfileInput(payload, avoidText.value));
    await store.loadRecommendation();
    message.value = '健康档案已保存，智能推荐已使用最新偏好。';
  } catch (error) {
    isError.value = true;
    message.value = error.message || '健康档案保存失败';
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.profile-form { max-width: 980px; margin: 0 auto; display: grid; gap: 22px; }
.profile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.profile-grid label, .range-field { display: grid; gap: 8px; }
.tag-fieldset { border: 1px solid rgba(31, 122, 77, .18); padding: 16px; border-radius: 8px; }
.tag-fieldset legend { padding: 0 8px; font-weight: 700; }
.tag-toggle-row { display: flex; flex-wrap: wrap; gap: 10px; }
.pill-toggle { border: 1px solid rgba(31, 122, 77, .2); background: #fff; color: var(--text); }
.pill-toggle.active { background: var(--primary); border-color: var(--primary); color: #fff; transform: translateY(-1px); }
.binary-options, .form-actions { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }
.check-label { display: inline-flex; align-items: center; gap: 8px; }
.check-label input { width: 18px; height: 18px; }
@media (max-width: 720px) {
  .profile-grid { grid-template-columns: 1fr; }
  .profile-form { padding: 18px; }
  .form-actions > * { width: 100%; justify-content: center; }
}
@media (prefers-reduced-motion: reduce) { .pill-toggle { transition: none; } }
</style>
