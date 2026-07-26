<template>
  <section class="page-heading">
    <p class="eyebrow">个人健康数据</p>
    <h1>健康档案</h1>
    <p>先确认饮食安全限制，再补充用餐偏好。保存后智能推荐会立即刷新。</p>
  </section>

  <form class="profile-form" @submit.prevent="saveProfile">
    <section class="card profile-section safety-section">
      <header><span>01</span><div><h2>安全与饮食限制</h2><p>过敏原、忌口、清真和饮食模式不会被系统自动放宽。</p></div></header>
      <fieldset class="allergy-choice">
        <legend>已知食物过敏情况 <b>必选</b></legend>
        <label><input v-model="form.allergyStatus" type="radio" value="none"><span><strong>暂无已知过敏</strong><small>我确认目前没有已知食物过敏</small></span></label>
        <label><input v-model="form.allergyStatus" type="radio" value="declared"><span><strong>有已知过敏原</strong><small>推荐时严格排除填写的食材</small></span></label>
      </fieldset>
      <div class="profile-grid">
        <label v-if="form.allergyStatus === 'declared'">
          <span>过敏原（逗号分隔）</span>
          <input v-model="allergiesText" placeholder="如：花生, 虾, 牛奶">
        </label>
        <label>
          <span>普通忌口（逗号分隔）</span>
          <input v-model="avoidText" placeholder="如：香菜, 动物内脏">
        </label>
        <label>
          <span>饮食模式</span>
          <select v-model="form.dietaryPattern">
            <option value="unrestricted">无特殊限制</option>
            <option value="pescatarian">鱼素</option>
            <option value="vegetarian">素食</option>
            <option value="vegan">纯素</option>
          </select>
        </label>
        <label class="switch-field"><input v-model="form.halalOnly" type="checkbox"><span><strong>仅清真</strong><small>筛除未标记为清真的菜品</small></span></label>
      </div>
    </section>

    <section class="card profile-section preference-section">
      <header><span>02</span><div><h2>用餐偏好</h2><p>除预算外均可保持中性值，之后可随时调整。</p></div></header>
      <div class="profile-grid">
        <label><span>饮食目标</span><select v-model="form.goal"><option value="healthy">健康饮食</option><option value="fatLoss">减脂</option><option value="muscleGain">增肌</option><option value="maintain">维持体重</option></select></label>
        <label><span>常用餐次</span><select v-model="form.mealType"><option value="breakfast">早餐</option><option value="lunch">午餐</option><option value="dinner">晚餐</option></select></label>
        <label class="range-field"><span>预算上限：¥{{ form.budgetMax }}</span><input v-model.number="form.budgetMax" type="range" min="8" max="80" step="1"></label>
        <label><span>口味偏好</span><select v-model="form.taste"><option v-for="taste in tasteOptions" :key="taste" :value="taste">{{ taste }}</option></select></label>
        <label><span>辣度偏好</span><select v-model.number="form.spiceLevel"><option :value="0">不限</option><option :value="1">不辣</option><option :value="2">微辣</option><option :value="3">中辣</option><option :value="4">重辣</option><option :value="5">极辣</option></select></label>
        <label><span>喜爱标签（逗号分隔）</span><input v-model="favoriteTagsText" placeholder="如：高蛋白, 低脂, 快手"></label>
      </div>

      <fieldset class="tag-fieldset">
        <legend>营养关注</legend>
        <div class="tag-toggle-row"><button v-for="item in nutritionFocusOptions" :key="item.value" type="button" class="pill-toggle" :class="{ active: form.nutritionFocus.includes(item.value) }" :aria-pressed="form.nutritionFocus.includes(item.value)" @click="toggleNutritionFocus(item.value)">{{ item.label }}</button></div>
      </fieldset>
      <label class="switch-field low-crowd"><input v-model="form.preferLowCrowd" type="checkbox"><span><strong>偏好低人流食堂</strong><small>排序时优先考虑排队压力</small></span></label>
    </section>

    <div class="profile-actions">
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
  { value: 'highProtein', label: '高蛋白' }, { value: 'lowFat', label: '低脂' },
  { value: 'lowCarb', label: '低碳水' }, { value: 'highFiber', label: '高纤维' },
  { value: 'lowSodium', label: '低钠' }, { value: 'lowSugar', label: '低糖' }
];
const form = reactive({ goal: 'healthy', mealType: 'lunch', budgetMax: 20, taste: '不限', halalOnly: false, dietaryPattern: 'unrestricted', spiceLevel: 0, nutritionFocus: [], preferLowCrowd: false, allergyStatus: 'unknown' });
const allergiesText = ref('');
const avoidText = ref('');
const favoriteTagsText = ref('');

watch(() => store.profile, syncProfile, { immediate: true, deep: true });

function syncProfile(profile = {}) {
  form.goal = profile.goal || 'healthy'; form.mealType = profile.mealType || 'lunch'; form.budgetMax = profile.budgetMax ?? 20;
  form.taste = profile.taste || '不限'; form.halalOnly = Boolean(profile.halalOnly); form.dietaryPattern = profile.dietaryPattern || 'unrestricted';
  form.spiceLevel = profile.spiceLevel ?? 0; form.nutritionFocus = Array.isArray(profile.nutritionFocus) ? [...profile.nutritionFocus] : [];
  form.preferLowCrowd = Boolean(profile.preferLowCrowd); form.allergyStatus = profile.allergyStatus || 'unknown';
  allergiesText.value = Array.isArray(profile.allergies) ? profile.allergies.join(', ') : '';
  avoidText.value = Array.isArray(profile.avoid) ? profile.avoid.join(', ') : '';
  favoriteTagsText.value = Array.isArray(profile.favoriteTags) ? profile.favoriteTags.join(', ') : '';
}
function parseList(value) { return String(value || '').split(/[，,]+/).map((item) => item.trim()).filter(Boolean); }
function toggleNutritionFocus(value) { const index = form.nutritionFocus.indexOf(value); if (index === -1) form.nutritionFocus.push(value); else form.nutritionFocus.splice(index, 1); }

async function saveProfile() {
  saving.value = true; message.value = ''; isError.value = false;
  try {
    const payload = normalizeProfileInput({ ...form, allergies: parseList(allergiesText.value), avoid: parseList(avoidText.value), favoriteTags: parseList(favoriteTagsText.value), nutritionFocus: [...form.nutritionFocus] });
    await store.saveProfile(payload);
    await store.loadRecommendation();
    message.value = '健康档案已保存，智能推荐已使用最新限制与偏好。';
  } catch (error) { isError.value = true; message.value = error.message || '健康档案保存失败'; }
  finally { saving.value = false; }
}
</script>

<style scoped>
.profile-form { max-width:980px; margin:0 auto; display:grid; gap:18px; }
.profile-section { display:grid; gap:22px; }
.profile-section>header { display:flex; align-items:flex-start; gap:14px; border-bottom:1px solid rgba(31,122,77,.12); padding-bottom:16px; }
.profile-section>header>span { display:grid; place-items:center; width:36px; height:36px; flex:0 0 36px; border-radius:8px; color:#fff; background:var(--primary); font-weight:800; }
.profile-section h2,.profile-section p { margin:0; }.profile-section h2 { font-size:20px; }.profile-section p { margin-top:5px; color:var(--muted); }
.profile-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px; }.profile-grid label,.range-field { display:grid; gap:8px; }
.allergy-choice,.tag-fieldset { margin:0; border:1px solid rgba(31,122,77,.16); border-radius:8px; padding:16px; }.allergy-choice legend,.tag-fieldset legend { padding:0 8px; font-weight:750; }.allergy-choice legend b { color:var(--danger); font-size:12px; }
.allergy-choice { display:grid; grid-template-columns:1fr 1fr; gap:12px; }.allergy-choice label,.switch-field { display:flex !important; align-items:flex-start; gap:10px !important; border:1px solid rgba(31,122,77,.12); border-radius:8px; padding:14px; background:#fbfdfb; }.allergy-choice input,.switch-field input { width:18px; height:18px; margin-top:2px; accent-color:var(--primary); }.allergy-choice strong,.allergy-choice small,.switch-field strong,.switch-field small { display:block; }.allergy-choice small,.switch-field small { margin-top:3px; color:var(--muted); font-weight:500; }
.tag-toggle-row { display:flex; flex-wrap:wrap; gap:10px; }.pill-toggle { border:1px solid rgba(31,122,77,.2); background:#fff; color:var(--text); }.pill-toggle.active { color:#fff; border-color:var(--primary); background:var(--primary); }.low-crowd { width:max-content; max-width:100%; }
.profile-actions { display:flex; gap:12px; justify-content:flex-end; }.profile-actions>* { min-width:180px; justify-content:center; }
@media (max-width:720px) { .profile-grid,.allergy-choice { grid-template-columns:1fr; }.profile-section { padding:18px; }.profile-actions { flex-direction:column; }.profile-actions>* { width:100%; }.low-crowd { width:100%; } }
</style>
