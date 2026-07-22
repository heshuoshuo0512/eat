<template>
  <Teleport to="body">
    <div v-if="open" class="catalog-drawer-layer" @keydown="handleDialogKeydown">
      <button class="catalog-drawer-backdrop" type="button" aria-label="关闭编辑抽屉" :disabled="busy" @click="requestClose"></button>
      <aside ref="dialogElement" class="catalog-drawer" role="dialog" aria-modal="true" :aria-labelledby="titleId" :aria-busy="busy" tabindex="-1">
        <header class="catalog-drawer-header">
          <div>
            <p class="catalog-drawer-path">{{ breadcrumb }}</p>
            <h2 :id="titleId">{{ drawerTitle }}</h2>
          </div>
          <button ref="closeButton" class="catalog-icon-button" type="button" title="关闭" aria-label="关闭" :disabled="busy" @click="requestClose">×</button>
        </header>

        <div v-if="mode === 'view'" class="catalog-drawer-body catalog-view-body">
          <dl class="catalog-view-list">
            <div v-for="field in viewFields" :key="field.label">
              <dt>{{ field.label }}</dt>
              <dd>{{ field.value || '未设置' }}</dd>
            </div>
          </dl>
          <div v-if="descriptor?.legacyHierarchy" class="catalog-inline-warning">
            这是历史父子档口。进入编辑并保存后，会迁移为当前餐饮分区直属档口。
          </div>
          <div v-else-if="descriptor?.needsClassification" class="catalog-inline-warning">
            该档口目前直属食堂，尚未归入餐厅或楼层餐区。进入编辑后请选择所属餐饮分区。
          </div>
        </div>

        <form v-else class="catalog-drawer-form" @submit.prevent="save">
          <fieldset class="catalog-drawer-body catalog-drawer-fieldset" :disabled="busy">
            <p v-if="errorMessage" :class="['catalog-form-message', 'error', `kind-${errorKind || 'unknown'}`]" role="alert" aria-live="assertive">
              <strong>{{ errorKindLabel }}</strong><span>{{ errorMessage }}</span>
              <small v-if="errorCode">错误码 {{ errorCode }}</small>
            </p>

            <template v-if="entityType === 'venue' || entityType === 'area'">
              <CatalogAreaFormFields :form="form" :entity-label="entityType === 'venue' ? '餐饮场所' : areaLabel" compact />
            </template>

            <template v-else-if="entityType === 'stall'">
              <CatalogStallFormFields :form="form" :areas="areaOptions" :area-label="areaLabel" compact />
              <p v-if="descriptor?.legacyHierarchy" class="catalog-inline-warning">
                保存后将移除旧的父档口关系，并迁移为所选餐饮分区直属档口。
              </p>
              <p v-else-if="descriptor?.needsClassification" class="catalog-inline-warning">
                保存前必须选择所属餐厅或楼层餐区；保存后档口将完成归类。
              </p>
            </template>

            <template v-else-if="entityType === 'dish'">
              <CatalogDishFormFields :form="form" :stalls="stallOptions" compact>
                <template #image-actions>
                  <label>上传展示图
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" :disabled="uploadingImage" @change="uploadDishImage" />
                  </label>
                  <p v-if="imageMessage" :class="['catalog-form-message', { error: imageError }]" role="status">{{ imageMessage }}</p>
                </template>
                <template #vision-actions>
                  <div class="catalog-vision-prefill">
                    <div class="catalog-form-section-title"><strong>AI 图片识别预填</strong><span>待管理员确认</span></div>
                    <label>识别图片
                      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" capture="environment" :disabled="visionLoading" @change="selectVisionImage" />
                    </label>
                    <div class="catalog-vision-actions">
                      <button class="secondary" type="button" :disabled="visionLoading || !visionFile" @click="identifyDishImage">{{ visionLoading ? '识别中...' : '识别并预填' }}</button>
                      <button class="ghost" type="button" :disabled="visionLoading || !visionFile" @click="clearVisionImage">清除</button>
                    </div>
                    <p v-if="visionMessage" :class="['catalog-form-message', { error: visionError }]" role="status">{{ visionMessage }}</p>
                  </div>
                </template>
              </CatalogDishFormFields>
            </template>
          </fieldset>

          <footer class="catalog-drawer-footer">
            <span class="catalog-save-state">{{ dirty ? '有未保存修改' : '内容已同步' }}</span>
            <button class="ghost" type="button" :disabled="busy" @click="requestClose">取消</button>
            <button class="primary" type="submit" :disabled="busy || !dirty">{{ saving ? '保存中...' : '保存' }}</button>
          </footer>
        </form>

        <footer v-if="mode === 'view'" class="catalog-drawer-footer">
          <button class="ghost" type="button" @click="requestClose">关闭</button>
          <button v-if="descriptor?.canEdit" class="primary" type="button" @click="$emit('edit')">编辑</button>
        </footer>
      </aside>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { validateImageFile } from '../domain/validation.js';
import CatalogAreaFormFields from './CatalogAreaFormFields.vue';
import CatalogDishFormFields from './CatalogDishFormFields.vue';
import CatalogStallFormFields from './CatalogStallFormFields.vue';
import { useCanteenStore } from '../stores/canteenStore.js';

const props = defineProps({
  open: { type: Boolean, default: false },
  descriptor: { type: Object, default: null },
  areas: { type: Array, default: () => [] },
  stalls: { type: Array, default: () => [] }
});
const emit = defineEmits(['close', 'saved', 'edit']);
const store = useCanteenStore();
const titleId = 'catalog-editor-title';
const form = reactive({});
const dialogElement = ref(null);
const closeButton = ref(null);
const initialSnapshot = ref('{}');
const saving = ref(false);
const errorMessage = ref('');
const errorKind = ref('');
const errorCode = ref('');
const uploadingImage = ref(false);
const imageMessage = ref('');
const imageError = ref(false);
const visionFile = ref(null);
const visionLoading = ref(false);
const visionMessage = ref('');
const visionError = ref(false);
const DEFAULT_MEAL_TYPES = ['lunch', 'dinner'];
let operationGeneration = 0;
let previouslyFocusedElement = null;

const mode = computed(() => props.descriptor?.mode || 'view');
const entityType = computed(() => props.descriptor?.type || 'area');
const venue = computed(() => props.descriptor?.venue || null);
const area = computed(() => props.descriptor?.area || null);
const stall = computed(() => props.descriptor?.stall || null);
const item = computed(() => props.descriptor?.item || null);
const areaLabel = computed(() => venue.value?.areaLabel || venue.value?.labels?.area || '餐饮分区');
const areaOptions = computed(() => props.areas.filter((entry) => entry.parentId === venue.value?.id));
const stallOptions = computed(() => {
  const areaIds = new Set(areaOptions.value.map((entry) => entry.id));
  const currentStallId = item.value?.stallId || stall.value?.id;
  return props.stalls.filter((entry) => (
    areaIds.has(entry.canteenId) || entry.canteenId === area.value?.id
  ) && (!entry.parentId || entry.id === currentStallId));
});
const dirty = computed(() => mode.value !== 'view' && JSON.stringify(form) !== initialSnapshot.value);
const busy = computed(() => saving.value || uploadingImage.value || visionLoading.value);
const errorKindLabel = computed(() => ({
  permission: '权限不足',
  validation: '请修正表单',
  conflict: '保存冲突',
  network: '网络异常',
  server: '服务异常'
}[errorKind.value] || '保存失败'));

const drawerTitle = computed(() => {
  if (mode.value === 'view') return item.value?.name || '节点详情';
  const action = mode.value === 'edit' ? '编辑' : '新增';
  const labels = { venue: '餐饮场所', area: areaLabel.value, stall: '档口', dish: '菜品' };
  return `${action}${labels[entityType.value] || '数据'}`;
});
const breadcrumb = computed(() => [venue.value?.name, area.value?.name, stall.value?.name, entityType.value === 'dish' ? item.value?.name : null].filter(Boolean).join(' / ') || '餐饮目录');
const viewFields = computed(() => {
  const value = item.value || {};
  if (entityType.value === 'venue' || entityType.value === 'area') return [
    { label: '位置', value: value.location },
    { label: '营业时间', value: value.hours },
    { label: '拥挤度', value: value.crowdLevel == null ? '' : `${value.crowdLevel}%` },
    { label: '标签', value: listText(value.tags).replace(/, /g, '、') },
    { label: '简介', value: value.description }
  ];
  if (entityType.value === 'stall') return [
    { label: `所属${areaLabel.value}`, value: area.value?.name },
    { label: '楼层', value: value.floor },
    { label: '品类', value: value.category },
    { label: '评分', value: value.rating },
    { label: '人均价格', value: value.avgPrice == null ? '' : `¥${value.avgPrice}` },
    { label: '营业状态', value: value.open ? '营业中' : '暂停营业' },
    { label: '简介', value: value.description }
  ];
  const nutrition = value.nutrition && typeof value.nutrition === 'object' ? value.nutrition : {};
  return [
    { label: '所属档口', value: stall.value?.name },
    { label: '价格', value: value.price == null ? '' : `¥${value.price}` },
    { label: '口味 / 菜系', value: [value.taste, value.cuisine].filter(Boolean).join(' / ') },
    { label: '食材', value: listText(value.ingredients).replace(/, /g, '、') },
    { label: '营养', value: `${nutrition.calories || 0} kcal · 蛋白质 ${nutrition.protein || 0}g` },
    { label: '状态', value: value.status === 'hidden' ? '已隐藏' : '上架中' },
    { label: '描述', value: value.description }
  ];
});

function listText(value) {
  return Array.isArray(value) ? value.join(', ') : String(value || '');
}

function resetForm() {
  errorMessage.value = '';
  errorKind.value = '';
  errorCode.value = '';
  imageMessage.value = '';
  imageError.value = false;
  clearVisionImage();
  const value = item.value || {};
  if (entityType.value === 'venue' || entityType.value === 'area') {
    Object.assign(form, {
      id: mode.value === 'edit' ? value.id || '' : props.descriptor?.fixedId || '',
      name: value.name || '', location: value.location || '', hours: value.hours || '07:00 - 21:00',
      crowdLevel: value.crowdLevel ?? 30, tags: listText(value.tags), description: value.description || '', imageUrl: value.imageUrl || ''
    });
  } else if (entityType.value === 'stall') {
    Object.assign(form, {
      id: mode.value === 'edit' ? value.id || '' : '', canteenId: value.canteenId || area.value?.id || '',
      name: value.name || '', floor: value.floor || '1F', category: value.category || '', rating: value.rating ?? 4.5,
      avgPrice: value.avgPrice ?? 15, open: value.open !== false, description: value.description || ''
    });
  } else {
    const nutrition = value.nutrition || {};
    Object.assign(form, {
      id: mode.value === 'edit' ? value.id || '' : '', stallId: value.stallId || stall.value?.id || '', name: value.name || '',
      price: value.price ?? 15, taste: value.taste || '', cuisine: value.cuisine || '', ingredients: listText(value.ingredients),
      tags: listText(value.tags), mealTypes: listText(value.mealTypes ?? DEFAULT_MEAL_TYPES), halal: Boolean(value.halal),
      allergens: listText(value.allergens), calories: nutrition.calories ?? 500, protein: nutrition.protein ?? 25,
      fat: nutrition.fat ?? 12, carbs: nutrition.carbs ?? 60, fiber: value.fiber ?? 0, sodium: value.sodium ?? 0,
      sugar: value.sugar ?? 0, calcium: value.calcium ?? 0, iron: value.iron ?? 0, image: value.image || '🍽️',
      imageUrl: value.imageUrl || '', description: value.description ?? '', status: value.status || 'active',
      rating: value.rating ?? 4.5, reviewCount: value.reviewCount ?? 0, sales: value.sales ?? 0
    });
  }
  initialSnapshot.value = JSON.stringify(form);
}

function focusErrorField(error) {
  const code = String(error?.code || '').toUpperCase();
  const fieldName = code.includes('STALL') || code.includes('DISH_STALL') ? (entityType.value === 'dish' ? 'stallId' : 'canteenId') : '';
  const selector = fieldName ? `[name="${fieldName}"]` : 'input:not([type="file"]), select, textarea';
  nextTick(() => dialogElement.value?.querySelector(selector)?.focus?.());
}

function describeSaveError(error) {
  const kind = error?.kind || (error?.status >= 500 ? 'server' : 'validation');
  errorKind.value = kind;
  errorCode.value = String(error?.code || '');
  if (kind === 'permission') return '当前账号没有执行此操作的权限，请联系管理员。';
  if (kind === 'conflict') return `${error?.message || '数据与现有记录冲突'}${error?.code ? `（${error.code}）` : ''}`;
  if (kind === 'validation') return error?.message || '请检查标记字段后再保存。';
  if (kind === 'network') return error?.message || '网络连接失败，表单内容已保留，请重试。';
  return error?.message || '保存失败，请稍后重试。';
}

function splitList(value) {
  return String(value || '').split(/[，,\s]+/).map((entry) => entry.trim()).filter(Boolean);
}

function text(value, label, min = 1) {
  const result = String(value || '').trim();
  if (result.length < min) throw new Error(`请填写${label}。`);
  return result;
}

function number(value, label, min = 0, max = 10000) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max) throw new Error(`${label}需要在 ${min}-${max} 之间。`);
  return result;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择。'));
    reader.readAsDataURL(file);
  });
}

async function uploadDishImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  imageMessage.value = '';
  imageError.value = false;
  const validationError = validateImageFile(file);
  if (validationError) {
    imageMessage.value = validationError;
    imageError.value = true;
    event.target.value = '';
    return;
  }
  uploadingImage.value = true;
  const generation = operationGeneration;
  try {
    const uploaded = await store.uploadImage({ filename: file.name, contentType: file.type, dataBase64: await fileToBase64(file) });
    if (generation !== operationGeneration) return;
    form.imageUrl = uploaded.url;
    imageMessage.value = '图片已上传。';
  } catch (error) {
    if (generation !== operationGeneration) return;
    imageMessage.value = error.message || '图片上传失败，请稍后重试。';
    imageError.value = true;
  } finally {
    if (generation === operationGeneration) uploadingImage.value = false;
    event.target.value = '';
  }
}

function selectVisionImage(event) {
  const file = event.target.files?.[0];
  visionMessage.value = '';
  visionError.value = false;
  if (!file) {
    visionFile.value = null;
    return;
  }
  const validationError = validateImageFile(file);
  if (validationError) {
    visionFile.value = null;
    visionMessage.value = validationError;
    visionError.value = true;
    event.target.value = '';
    return;
  }
  visionFile.value = file;
  visionMessage.value = '图片已选择。';
}

function clearVisionImage() {
  visionFile.value = null;
  visionMessage.value = '';
  visionError.value = false;
}

async function identifyDishImage() {
  if (!visionFile.value || visionLoading.value) return;
  visionLoading.value = true;
  visionMessage.value = '';
  visionError.value = false;
  const generation = operationGeneration;
  try {
    const file = visionFile.value;
    const result = await store.identifyDishImage({ filename: file.name, contentType: file.type, dataBase64: await fileToBase64(file) });
    if (generation !== operationGeneration) return;
    const suggestion = result.suggestion || {};
    const nutrition = suggestion.nutrition || {};
    Object.assign(form, {
      name: suggestion.name || form.name,
      taste: suggestion.taste || form.taste,
      cuisine: suggestion.cuisine || form.cuisine,
      ingredients: suggestion.ingredients?.length ? listText(suggestion.ingredients) : form.ingredients,
      tags: suggestion.tags?.length ? listText(suggestion.tags) : form.tags,
      calories: nutrition.calories ?? form.calories,
      protein: nutrition.protein ?? form.protein,
      fat: nutrition.fat ?? form.fat,
      carbs: nutrition.carbs ?? form.carbs
    });
    visionMessage.value = '识别结果已预填。';
  } catch (error) {
    if (generation !== operationGeneration) return;
    visionMessage.value = error.message || '图片识别失败，请稍后重试。';
    visionError.value = true;
  } finally {
    if (generation === operationGeneration) visionLoading.value = false;
  }
}

async function save() {
  if (saving.value) return;
  saving.value = true;
  errorMessage.value = '';
  try {
    const savedType = entityType.value;
    let saved = null;
    if (entityType.value === 'venue' || entityType.value === 'area') {
      const payload = {
        id: form.id || undefined, name: text(form.name, '名称', 2), location: text(form.location, '位置', 2),
        hours: text(form.hours, '营业时间', 5), crowdLevel: number(form.crowdLevel, '拥挤度', 0, 100),
        tags: splitList(form.tags), description: text(form.description, '简介', 5), imageUrl: form.imageUrl || undefined,
        canteenType: entityType.value === 'venue' ? 'primary' : 'sub', parentId: entityType.value === 'area' ? venue.value?.id : null
      };
      saved = await store.upsertCanteen(payload);
    } else if (entityType.value === 'stall') {
      saved = await store.upsertStall({
        id: form.id || undefined, canteenId: text(form.canteenId, `所属${areaLabel.value}`), parentId: null,
        name: text(form.name, '档口名称', 2), floor: text(form.floor, '楼层'), category: text(form.category, '品类', 2),
        rating: number(form.rating, '评分', 1, 5), avgPrice: number(form.avgPrice, '人均价格', 1, 200),
        open: Boolean(form.open), description: String(form.description || '').trim()
      });
    } else {
      const ingredients = splitList(form.ingredients);
      const tags = splitList(form.tags);
      const mealTypes = splitList(form.mealTypes);
      if (!ingredients.length || !tags.length) throw new Error('食材和标签至少各填写一项。');
      saved = await store.upsertDish({
        id: form.id || undefined, stallId: text(form.stallId, '所属档口'), name: text(form.name, '菜名', 2),
        price: number(form.price, '价格', 1, 200), taste: text(form.taste, '口味'), cuisine: text(form.cuisine, '菜系'),
        ingredients, tags, mealTypes: mealTypes.length ? mealTypes : (mode.value === 'edit' ? [] : [...DEFAULT_MEAL_TYPES]),
        halal: Boolean(form.halal), allergens: splitList(form.allergens), image: form.image || '🍽️', imageUrl: form.imageUrl || undefined,
        description: String(form.description ?? '').trim() || (mode.value === 'edit' ? '' : '管理员录入菜品。'),
        rating: number(form.rating, '评分', 0, 5), reviewCount: number(form.reviewCount, '评价数', 0, 1_000_000_000),
        sales: number(form.sales, '销量', 0, 1_000_000_000), status: form.status || 'active',
        nutrition: {
          calories: number(form.calories, '热量'), protein: number(form.protein, '蛋白质'), fat: number(form.fat, '脂肪'),
          carbs: number(form.carbs, '碳水'), fiber: number(form.fiber, '膳食纤维'), sodium: number(form.sodium, '钠'),
          sugar: number(form.sugar, '糖'), calcium: number(form.calcium, '钙'), iron: number(form.iron, '铁')
        }
      });
    }
    if (!saved?.id) throw new Error('数据已提交，但未能读取保存后的实体，请刷新目录后确认。');
    form.id = saved.id;
    initialSnapshot.value = JSON.stringify(form);
    const selectedStall = savedType === 'dish'
      ? props.stalls.find((entry) => entry.id === saved.stallId)
      : null;
    emit('saved', {
      type: savedType,
      item: saved,
      venueId: venue.value?.id || (savedType === 'venue' ? saved.id : saved.parentId),
      areaId: savedType === 'area'
        ? saved.id
        : (savedType === 'stall' ? saved.canteenId : (selectedStall?.canteenId || area.value?.id)),
      stallId: savedType === 'stall' ? saved.id : (savedType === 'dish' ? saved.stallId : undefined)
    });
  } catch (error) {
    errorMessage.value = describeSaveError(error);
    focusErrorField(error);
  } finally {
    saving.value = false;
  }
}

function confirmDiscard() {
  if (busy.value) return false;
  if (!dirty.value) return true;
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return true;
  return window.confirm('当前有未保存修改，确认关闭吗？');
}

function requestClose() {
  if (!confirmDiscard()) return false;
  emit('close');
  nextTick(() => previouslyFocusedElement?.focus?.());
  return true;
}

function handleDialogKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    requestClose();
    return;
  }
  if (event.key !== 'Tab' || !dialogElement.value) return;
  const focusable = [...dialogElement.value.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
    .filter((element) => element.offsetParent !== null);
  if (!focusable.length) {
    event.preventDefault();
    dialogElement.value.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function handleBeforeUnload(event) {
  if (!props.open || !dirty.value) return;
  event.preventDefault();
  event.returnValue = '';
}

watch(() => [
  props.open,
  mode.value,
  entityType.value,
  venue.value?.id,
  area.value?.id,
  stall.value?.id,
  item.value?.id
], () => {
  operationGeneration += 1;
  for (const key of Object.keys(form)) delete form[key];
  if (props.open) resetForm();
}, { immediate: true });

watch(() => props.open, async (isOpen) => {
  if (!isOpen) return;
  previouslyFocusedElement = typeof document !== 'undefined' ? document.activeElement : null;
  await nextTick();
  if (mode.value === 'view') closeButton.value?.focus?.();
  else dialogElement.value?.querySelector('input:not([type="file"]), select, textarea')?.focus?.();
});

if (typeof window !== 'undefined') window.addEventListener('beforeunload', handleBeforeUnload);
onBeforeUnmount(() => {
  operationGeneration += 1;
  if (typeof window !== 'undefined') window.removeEventListener('beforeunload', handleBeforeUnload);
});
defineExpose({ requestClose, confirmDiscard, dirty, saving, busy });
</script>

<style scoped>
.catalog-drawer-layer { position: fixed; inset: 0; z-index: 60; display: flex; justify-content: flex-end; }
.catalog-drawer-backdrop { position: absolute; inset: 0; width: 100%; background: rgba(18, 38, 27, .28); backdrop-filter: blur(3px); }
.catalog-drawer { position: relative; width: min(34rem, 94vw); height: 100dvh; display: flex; flex-direction: column; background: #f8fbf7; border-left: 1px solid rgba(31, 122, 77, .16); box-shadow: -1.5rem 0 3rem rgba(19, 62, 38, .18); }
.catalog-drawer-header { flex: 0 0 auto; display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 1.25rem 1.4rem 1rem; border-bottom: 1px solid rgba(31, 122, 77, .12); background: rgba(255,255,255,.94); }
.catalog-drawer-header h2 { margin: .25rem 0 0; font-size: 1.25rem; letter-spacing: 0; }
.catalog-drawer-path { margin: 0; color: #617064; font-size: .78rem; line-height: 1.4; overflow-wrap: anywhere; }
.catalog-icon-button { width: 2.5rem; height: 2.5rem; display: grid; place-items: center; border-radius: .4rem; background: #edf5ee; color: #24583a; font-size: 1.45rem; }
.catalog-drawer-form { min-height: 0; flex: 1; display: flex; flex-direction: column; }
.catalog-drawer-body { min-height: 0; flex: 1; overflow-y: auto; scrollbar-gutter: stable; padding: 1.15rem 1.4rem 2rem; display: grid; align-content: start; gap: 1rem; }
.catalog-drawer-fieldset { min-width: 0; margin: 0; border: 0; }
.catalog-form-section { display: grid; gap: .85rem; }
.catalog-form-section + .catalog-form-section { padding-top: 1rem; border-top: 1px solid rgba(31, 122, 77, .12); }
.catalog-form-section-title { display: grid; gap: .2rem; }
.catalog-form-section-title strong { font-size: .96rem; color: #173f2a; }
.catalog-form-section-title span { color: #6b776e; font-size: .78rem; }
.catalog-drawer label { display: grid; gap: .38rem; color: #344a3b; font-size: .82rem; font-weight: 650; }
.catalog-drawer input:not([type="checkbox"]), .catalog-drawer select, .catalog-drawer textarea { width: 100%; border: 1px solid rgba(31, 122, 77, .18); border-radius: .42rem; background: #fff; color: #183f2a; padding: .72rem .76rem; }
.catalog-drawer textarea { resize: vertical; }
.catalog-form-grid { display: grid; gap: .75rem; }
.catalog-form-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.catalog-form-grid.nutrition { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.catalog-switch-row { display: flex !important; align-items: center; gap: .55rem !important; }
.catalog-switch-row input { width: 1.1rem; height: 1.1rem; accent-color: #1f7a4d; }
.catalog-advanced-fields { border: 1px solid rgba(31, 122, 77, .13); border-radius: .45rem; background: #fff; padding: .85rem; }
.catalog-advanced-fields summary { cursor: pointer; color: #27593c; font-weight: 700; }
.catalog-advanced-fields[open] { display: grid; gap: .85rem; }
.catalog-drawer-footer { flex: 0 0 auto; min-height: 4.5rem; display: flex; justify-content: flex-end; align-items: center; gap: .65rem; padding: .85rem 1.4rem; border-top: 1px solid rgba(31, 122, 77, .12); background: rgba(255,255,255,.96); }
.catalog-drawer-footer button { min-height: 2.65rem; padding-inline: 1rem; }
.catalog-save-state { margin-right: auto; color: #69766c; font-size: .78rem; }
.catalog-inline-warning, .catalog-form-message { margin: 0; border-radius: .42rem; padding: .75rem .85rem; font-size: .82rem; line-height: 1.5; }
.catalog-inline-warning { background: #fff7dc; color: #72520a; border: 1px solid #eddc9a; }
.catalog-form-message.error { background: #fff0ef; color: #8a2f29; border: 1px solid #efcbc7; }
.catalog-image-preview { overflow: hidden; aspect-ratio: 16 / 9; border: 1px solid rgba(31, 122, 77, .14); border-radius: .45rem; background: #edf4ee; }
.catalog-image-preview img { width: 100%; height: 100%; display: block; object-fit: cover; }
.catalog-vision-prefill { display: grid; gap: .75rem; border-top: 1px solid rgba(31, 122, 77, .12); padding-top: .85rem; }
.catalog-vision-actions { display: flex; gap: .55rem; }
.catalog-vision-actions button { min-height: 2.5rem; padding-inline: .8rem; }
.catalog-view-list { margin: 0; display: grid; gap: .85rem; }
.catalog-view-list div { display: grid; grid-template-columns: 6rem 1fr; gap: .75rem; padding-bottom: .75rem; border-bottom: 1px solid rgba(31, 122, 77, .1); }
.catalog-view-list dt { color: #6a786d; font-size: .78rem; }
.catalog-view-list dd { margin: 0; color: #213d2c; overflow-wrap: anywhere; }
@media (max-width: 900px) {
  .catalog-drawer { width: 100vw; }
  .catalog-drawer-header, .catalog-drawer-body, .catalog-drawer-footer { padding-left: 1rem; padding-right: 1rem; }
  .catalog-form-grid.two, .catalog-form-grid.nutrition { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) { .catalog-drawer-layer * { transition: none !important; animation: none !important; } }
</style>
