<template>
  <section class="page-heading">
    <p class="eyebrow">Visual Meal Assistant</p>
    <h1>拍照识餐</h1>
    <p>先限定食堂和当餐菜单，再用实拍参考图识别。食堂与档口信息只来自数据库，模型不会猜位置。</p>
  </section>

  <section class="grid two-columns align-start">
    <article class="card admin-form">
      <div class="section-title horizontal">
        <div><p class="eyebrow">Context</p><h2>拍摄范围</h2></div>
        <span class="pill">单道菜</span>
      </div>
      <label>食堂
        <select v-model="canteenId" @change="stallId = ''">
          <option value="">请选择食堂</option>
          <option v-for="canteen in canteens" :key="canteen.id" :value="canteen.id">{{ canteen.name }}</option>
        </select>
      </label>
      <label>档口（可选）
        <select v-model="stallId" :disabled="!canteenId">
          <option value="">整个食堂</option>
          <option v-for="stall in scopedStalls" :key="stall.id" :value="stall.id">{{ stall.name }} · {{ stall.floor }}</option>
        </select>
      </label>
      <div class="form-grid two">
        <label>餐次
          <select v-model="mealType"><option value="breakfast">早餐</option><option value="lunch">午餐</option><option value="dinner">晚餐</option></select>
        </label>
        <label>份量
          <select v-model="portionSize"><option value="small">小份</option><option value="regular">常规</option><option value="large">大份</option></select>
        </label>
      </div>
      <label>拍照/上传图片<input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" @change="handleFile" /></label>
      <div v-if="preview" class="vision-preview"><img :src="preview" alt="待分析餐食" /></div>
      <div class="table-actions">
        <button class="primary" type="button" :disabled="loading || !file || !canteenId" @click="analyze">{{ loading ? '分析中...' : '分析餐食' }}</button>
        <button class="ghost" type="button" @click="reset">清空</button>
      </div>
      <p class="muted">没有已发布菜单时只返回通用视觉观察；原始照片不会被长期保存。</p>
      <p v-if="message" :class="['form-message', { danger: messageType === 'error' }]">{{ message }}</p>
    </article>

    <article v-if="result" class="card admin-form">
      <div class="section-title horizontal">
        <div><p class="eyebrow">Observation</p><h2>{{ result.detectedName || '未识别出通用菜名' }}</h2></div>
        <span class="pill">视觉置信度 {{ result.confidenceLabel }}</span>
      </div>
      <p>{{ result.observation.notes || result.observation.presentation || '已完成可见特征观察。' }}</p>
      <p class="muted">可见食材：{{ result.observation.visibleIngredients.join(' / ') || '无法确认' }}</p>
      <p class="muted">烹饪特征：{{ result.observation.cookingMethods.join(' / ') || '无法确认' }}</p>
      <div v-if="result.observation.multipleItems" class="inline-warning">检测到多道独立菜品，请对准一道菜重新拍摄。</div>
      <ul v-if="result.warnings.length" class="insight-list compact">
        <li v-for="item in result.warnings" :key="item.code"><strong>{{ item.code }}</strong><span>{{ item.message }}</span></li>
      </ul>
    </article>
  </section>

  <section v-if="result?.match.candidates.length" class="card">
    <div class="section-title horizontal">
      <div><p class="eyebrow">Candidate Check</p><h2>请确认具体菜品</h2></div>
      <span class="pill">{{ result.match.candidates.length }} 个候选</span>
    </div>
    <p>候选来自所选食堂的已发布菜单。确认前不会把模型结果当作事实。</p>
    <div class="cards-grid vision-candidate-grid">
      <article v-for="candidate in result.match.candidates" :key="candidate.dishId" class="mini-card vision-candidate">
        <img v-if="candidate.referenceImageUrl || candidate.imageUrl" :src="candidate.referenceImageUrl || candidate.imageUrl" :alt="candidate.name" class="match-card-img" />
        <strong>{{ candidate.name }}</strong>
        <span class="meta-row"><span class="pill">{{ candidate.canteen?.name || '未知食堂' }}</span><span class="pill">{{ candidate.stall?.name || '未知档口' }}</span></span>
        <span>{{ dishPriceText(candidate) }}</span>
        <small>综合匹配 {{ Math.round(candidate.matchScore * 100) }}%</small>
        <small v-if="candidate.matchReasons.length">{{ candidate.matchReasons.join('；') }}</small>
        <button class="secondary" type="button" :disabled="Boolean(confirmingId)" @click="confirmCandidate(candidate.dishId)">{{ confirmingId === candidate.dishId ? '确认中...' : '这是我拍的菜' }}</button>
      </article>
    </div>
    <button class="ghost" type="button" :disabled="Boolean(confirmingId)" @click="confirmCandidate(null)">都不是这些菜</button>
  </section>

  <section v-if="result?.selectedDish" class="card admin-form">
    <div class="section-title horizontal">
      <div><p class="eyebrow">Confirmed</p><h2>{{ result.selectedDish.name }}</h2></div>
      <span class="pill">已确认</span>
    </div>
    <p>{{ pathText(result.selectedDish.canteenPath) }} · {{ pathText(result.selectedDish.stallPath) }}</p>
    <div v-if="result.nutrition.status !== 'unknown'" class="nutrition-grid">
      <span>{{ nutritionRangeText(result.nutrition.ranges?.calories) }}</span>
      <span>蛋白 {{ nutritionRangeText(result.nutrition.ranges?.protein) }}</span>
      <span>脂肪 {{ nutritionRangeText(result.nutrition.ranges?.fat) }}</span>
      <span>碳水 {{ nutritionRangeText(result.nutrition.ranges?.carbs) }}</span>
    </div>
    <div v-else class="inline-warning">该菜品尚无已审核营养资料，不展示默认数字。</div>
    <p class="muted">{{ result.nutrition.reason }} <template v-if="result.nutrition.sourceIds?.length">依据：{{ result.nutrition.sourceIds.join(' / ') }}</template></p>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { useRoute } from 'vue-router';
import { dishPriceText } from '../domain/dishPresentation.js';
import { validateImageFile } from '../domain/validation.js';
import { useCanteenStore } from '../stores/canteenStore.js';
import { normalizeMealVisionResult, nutritionRangeText } from '../../shared/mealVisionContract.js';

const store = useCanteenStore();
const route = useRoute();
const file = ref(null);
const preview = ref('');
const result = ref(null);
const message = ref('');
const messageType = ref('info');
const loading = ref(false);
const confirmingId = ref('');
const canteenId = ref(String(route.query.canteenId || ''));
const stallId = ref(String(route.query.stallId || ''));
const mealType = ref('lunch');
const portionSize = ref('regular');
let activeController = null;

const canteens = computed(() => store.canteens || []);
const scopedStalls = computed(() => (store.stalls || []).filter((item) => item.canteenId === canteenId.value));

function fileToBase64(input) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(input);
  });
}

function revokePreview() { if (preview.value) URL.revokeObjectURL(preview.value); }

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
  if (error) { message.value = error; messageType.value = 'error'; return; }
  file.value = selected;
  preview.value = URL.createObjectURL(selected);
  message.value = '图片已选择，可以开始分析。';
}

async function analyze() {
  if (!file.value || !canteenId.value) return;
  loading.value = true;
  message.value = '正在观察图片并检索当餐候选，请稍候。';
  messageType.value = 'info';
  activeController = new AbortController();
  try {
    const selected = file.value;
    result.value = normalizeMealVisionResult(await store.analyzeMealImage({
      filename: selected.name,
      contentType: selected.type,
      dataBase64: await fileToBase64(selected),
      mode: 'single_dish',
      context: { canteenId: canteenId.value, stallId: stallId.value || null, mealType: mealType.value, capturedAt: new Date().toISOString() },
      portion: { size: portionSize.value },
    }, { signal: activeController.signal }));
    message.value = result.value.match.candidates.length ? '分析完成，请确认具体菜品。' : '完成视觉观察，但没有可信的校内菜品候选。';
  } catch (error) {
    message.value = error.message;
    messageType.value = 'error';
  } finally {
    loading.value = false;
    activeController = null;
  }
}

async function confirmCandidate(dishId) {
  if (!result.value?.analysisId || confirmingId.value) return;
  confirmingId.value = dishId || 'unresolved';
  try {
    const confirmation = await store.confirmMealVision(result.value.analysisId, { dishId, portion: { size: portionSize.value } });
    result.value = normalizeMealVisionResult({ ...result.value, ...confirmation, observation: result.value.observation });
    message.value = dishId ? '菜品已确认，营养结果已按可信来源加载。' : '已记录未匹配结果。';
  } catch (error) {
    message.value = error.message;
    messageType.value = 'error';
  } finally {
    confirmingId.value = '';
  }
}

function pathText(path) { return (path || []).map((item) => item.name).join(' / ') || '位置待确认'; }

onBeforeUnmount(reset);
</script>

<style scoped>
.form-grid.two { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.75rem; }
.vision-candidate-grid { align-items:stretch; }
.vision-candidate { display:flex; flex-direction:column; gap:.65rem; }
.vision-candidate button { margin-top:auto; }
.match-card-img { width:100%; aspect-ratio:4/3; object-fit:cover; border-radius:.4rem; }
.inline-warning { padding:.8rem; border-left:3px solid #b7791f; background:#fff8e6; color:#6b4f16; }
@media (max-width:720px) { .form-grid.two { grid-template-columns:1fr; } }
</style>
