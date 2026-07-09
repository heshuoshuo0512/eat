<template>
  <section class="page-heading">
    <p class="eyebrow">健康档案 / 规则推荐</p>
    <h1>个性化餐单生成</h1>
    <p>企业级原则：推荐只能来自真实菜品库，AI 后续只负责解释，不凭空造菜。</p>
  </section>

  <section class="grid two-columns align-start">
    <form class="card profile-form" @submit.prevent="save">
      <div class="section-title">
        <p class="eyebrow">用户健康档案</p>
        <h2>推荐条件</h2>
      </div>
      <label>
        健康目标
        <select v-model="form.goal">
          <option value="fatLoss">减脂</option>
          <option value="muscleGain">增肌</option>
          <option value="maintain">维持体重</option>
          <option value="healthy">健康饮食</option>
        </select>
      </label>
      <label>
        就餐时间
        <select v-model="form.mealType">
          <option value="breakfast">早餐</option>
          <option value="lunch">午餐</option>
          <option value="dinner">晚餐</option>
        </select>
      </label>
      <label>
        预算上限 ¥{{ form.budgetMax }}
        <input v-model.number="form.budgetMax" type="range" min="8" max="35" />
      </label>
      <label>
        口味偏好
        <select v-model="form.taste">
          <option>不限</option>
          <option>黑椒</option>
          <option>酸甜</option>
          <option>咸鲜</option>
          <option>清爽</option>
          <option>麻辣</option>
        </select>
      </label>
      <label>
        忌口食材
        <input v-model="avoidText" placeholder="例如：香菜, 牛肉" />
      </label>
      <label class="check-label">
        <input v-model="form.halalOnly" type="checkbox" />
        只推荐清真菜品
      </label>
      <button class="primary" type="submit">保存并生成推荐</button>
      <p v-if="message" class="form-message">{{ message }}</p>
    </form>

    <article class="card recommendation-card">
      <div class="section-title">
        <p class="eyebrow">推荐结果</p>
        <h2>{{ store.recommendation.goalLabel }} · {{ mealTypeLabel }}</h2>
        <span class="pill">{{ menuSourceLabel }}</span>
      </div>
      <p class="muted">{{ store.todayMenu.dishes.length ? `本次优先从 ${store.todayMenu.date} 已发布且未售罄的今日菜单中筛选。` : store.recommendation.reason }}</p>

      <div v-if="store.recommendation.dishes.length" class="dish-list dense">
        <article v-for="dish in store.recommendation.dishes" :key="dish.id" class="dish-row rich">
          <span class="emoji large">{{ dish.image }}</span>
          <span>
            <strong>{{ dish.name }}</strong>
            <small>{{ dish.tags.join(' / ') }}</small>
            <small>{{ dish.nutrition.calories }} kcal · P {{ dish.nutrition.protein }}g · F {{ dish.nutrition.fat }}g · C {{ dish.nutrition.carbs }}g · ¥{{ dish.price }}</small>
          </span>
          <span class="pill">{{ dish.recommendationScore }}</span>
        </article>
      </div>
      <div class="nutrition-grid totals">
        <span><strong>{{ store.recommendation.totals.calories }}</strong><small>总 kcal</small></span>
        <span><strong>{{ store.recommendation.totals.protein }}g</strong><small>蛋白</small></span>
        <span><strong>¥{{ store.recommendation.totals.price }}</strong><small>合计</small></span>
      </div>
    </article>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { normalizeProfileInput } from '../domain/validation.js';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const form = reactive({ ...store.profile });
const avoidText = ref(store.profile.avoid.join(', '));
const message = ref('');

watch(() => store.profile, (profile) => {
  Object.assign(form, profile);
  avoidText.value = profile.avoid.join(', ');
}, { deep: true });

const mealTypeLabel = computed(() => ({ breakfast: '早餐', lunch: '午餐', dinner: '晚餐' }[store.profile.mealType] || '午餐'));
const menuSourceLabel = computed(() => (store.todayMenu.dishes.length ? '今日供应优先' : '菜品库兜底'));

async function save() {
  try {
    await store.saveProfile(normalizeProfileInput(form, avoidText.value));
    message.value = '健康档案已保存，推荐结果已更新。';
  } catch (error) {
    message.value = error.message;
  }
}
</script>
