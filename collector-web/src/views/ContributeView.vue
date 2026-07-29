<template>
  <div class="page narrow">
    <div class="page-heading">
      <div><router-link class="back" to="/"><ArrowLeft :size="15" />返回采集区</router-link><h1>{{ group?.name || '提交菜品照片' }}</h1><p>{{ group?.venues?.map((item) => item.name).join('、') }}</p></div>
      <div class="step"><span :class="{ active: stage === 1 }">1</span><i></i><span :class="{ active: stage === 2 }">2</span><i></i><span :class="{ active: stage === 3 }">3</span></div>
    </div>

    <div v-if="error" class="notice error"><CircleAlert :size="18" />{{ error }}</div>
    <form v-if="stage === 1" class="upload-layout" @submit.prevent="upload(true)">
      <label class="dropzone" :class="{ filled: preview }">
        <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" @change="pickFile" />
        <img v-if="preview" :src="preview" alt="待提交菜品预览" />
        <template v-else><ImagePlus :size="38" /><strong>选择或拍摄照片</strong><span>JPEG、PNG、WebP，最大 5MB</span></template>
        <button v-if="preview" type="button" class="replace" @click.prevent="fileInput?.click()"><RefreshCw :size="15" />更换</button>
      </label>
      <div class="form-panel">
        <div class="field"><label for="claimed-name">你认为这道菜叫什么</label><input id="claimed-name" v-model.trim="claimedName" maxlength="120" placeholder="例如：番茄炒蛋" autocomplete="off" /></div>
        <div class="lookup-options">
          <button class="button" :disabled="uploading || !file || !claimedName">
            <LoaderCircle v-if="uploading && uploadMode === 'ai'" class="spin" :size="18" />
            <ScanSearch v-else :size="18" />
            {{ uploading && uploadMode === 'ai' ? '正在获取建议' : '上传并获取图片建议' }}
          </button>
          <button type="button" class="button secondary" :disabled="uploading || !file || !claimedName" @click="upload(false)">
            <LoaderCircle v-if="uploading && uploadMode === 'catalog'" class="spin" :size="18" />
            <Search v-else :size="18" />
            {{ uploading && uploadMode === 'catalog' ? '正在匹配目录' : '仅按菜名匹配目录' }}
          </button>
        </div>
        <div class="tip"><Database :size="18" /><span>图片建议可能使用视觉模型；菜名匹配只查询本站的校园菜品目录。最终标签以你的确认和人工审核为准。</span></div>
      </div>
    </form>

    <section v-else-if="stage === 2 && draft" class="confirm-layout">
      <div class="photo-column"><img :src="assetUrl(draft.imageUrl)" alt="提交图片" /><div v-if="draft.warning" class="notice"><TriangleAlert :size="18" />{{ draft.warning }}</div></div>
      <div class="candidate-panel">
        <div class="candidate-title"><div><span class="field-label">确认具体菜品</span><p v-if="draft.aiNames?.length">图片建议：{{ draft.aiNames.join('、') }}</p><p v-else-if="draft.aiSuggestionStatus === 'skipped'">本次未使用图片建议</p><p v-else>图片建议不可用，可继续匹配校园目录。</p></div><button class="button secondary small" @click="reset"><RefreshCw :size="14" />重选照片</button></div>
        <div class="catalog-heading"><Database :size="15" /><span>校园菜品目录</span></div>
        <div class="search-row"><input v-model.trim="searchTerm" placeholder="输入菜名或别名" @keyup.enter="search" /><button class="button icon secondary" title="匹配校园目录" aria-label="匹配校园目录" :disabled="searching || !searchTerm" @click="search"><LoaderCircle v-if="searching" class="spin" :size="18" /><Search v-else :size="18" /></button></div>
        <div class="candidates">
          <label v-for="candidate in candidates" :key="candidate.dishId" :class="{ selected: selectedDishId === candidate.dishId }">
            <input v-model="selectedDishId" type="radio" name="dish" :value="candidate.dishId" />
            <span><strong>{{ candidate.name }}</strong><small>{{ candidate.venue.name }} · {{ candidate.stall.name }}</small></span><CheckCircle2 :size="18" />
          </label>
          <label class="unmapped" :class="{ selected: selectedDishId === '' }"><input v-model="selectedDishId" type="radio" name="dish" value="" /><span><strong>目录中没有这道菜</strong><small>按“{{ draft.claimedName }}”提交，由审核员完成映射</small></span><HelpCircle :size="18" /></label>
        </div>
        <label class="consent"><input v-model="consent" type="checkbox" /><span>我同意将这张餐食图片用于校园菜品识别模型的训练与评测，图片最多保留 12 个月，并可在“我的”中撤回。</span></label>
        <button class="button submit" :disabled="confirming || !consent || selectedDishId === null" @click="confirm"><LoaderCircle v-if="confirming" class="spin" :size="18" /><Send v-else :size="18" />确认提交审核</button>
      </div>
    </section>

    <section v-else class="done">
      <div class="done-icon"><Check :size="34" /></div><h2>已进入审核队列</h2><p>{{ resultStatus === 'needs_mapping' ? '审核员会先把菜名映射到校园目录。' : '审核通过可获得 10 分，目标缺图菜额外获得 5 分。' }}</p>
      <div><button class="button" @click="reset"><Camera :size="18" />继续提交</button><router-link class="button secondary" to="/me"><Award :size="18" />查看记录</router-link></div>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeft, Award, Camera, Check, CheckCircle2, CircleAlert, Database, HelpCircle, ImagePlus, LoaderCircle, RefreshCw, ScanSearch, Search, Send, TriangleAlert } from '@lucide/vue';
import { assetUrl, collectorApi } from '../api.js';

const route = useRoute();
const groupId = computed(() => String(route.params.groupId));
const group = ref(null); const stage = ref(1); const file = ref(null); const fileInput = ref(null); const preview = ref('');
const claimedName = ref(''); const draft = ref(null); const candidates = ref([]); const selectedDishId = ref(null); const searchTerm = ref(''); const consent = ref(false);
const uploading = ref(false); const uploadMode = ref(''); const searching = ref(false); const confirming = ref(false); const error = ref(''); const resultStatus = ref('');

onMounted(async () => { try { group.value = (await collectorApi.groups()).groups.find((item) => item.id === groupId.value) || null; } catch (reason) { error.value = reason.message; } });
onBeforeUnmount(() => { if (preview.value) URL.revokeObjectURL(preview.value); });
function pickFile(event) { const next = event.target.files?.[0]; if (!next) return; if (preview.value) URL.revokeObjectURL(preview.value); file.value = next; preview.value = URL.createObjectURL(next); error.value = ''; }
async function upload(requestAiSuggestion) {
  error.value = ''; uploading.value = true; uploadMode.value = requestAiSuggestion ? 'ai' : 'catalog';
  try { const form = new FormData(); form.append('image', file.value); form.append('groupId', groupId.value); form.append('claimedName', claimedName.value); form.append('requestAiSuggestion', String(requestAiSuggestion)); draft.value = (await collectorApi.createDraft(form)).draft; candidates.value = draft.value.candidates || []; selectedDishId.value = candidates.value.length === 1 ? candidates.value[0].dishId : null; searchTerm.value = claimedName.value; stage.value = 2; }
  catch (reason) { error.value = reason.message; } finally { uploading.value = false; uploadMode.value = ''; }
}
async function search() { if (!searchTerm.value) return; error.value = ''; searching.value = true; try { candidates.value = (await collectorApi.search(groupId.value, searchTerm.value)).matches; selectedDishId.value = candidates.value.length === 1 ? candidates.value[0].dishId : null; } catch (reason) { error.value = reason.message; } finally { searching.value = false; } }
async function confirm() { confirming.value = true; error.value = ''; try { const result = await collectorApi.confirm(draft.value.id, { dishId: selectedDishId.value || null, consent: true, consentVersion: 'collector-training-v1' }); resultStatus.value = result.submission.status; stage.value = 3; } catch (reason) { error.value = reason.message; } finally { confirming.value = false; } }
function reset() { stage.value = 1; file.value = null; draft.value = null; candidates.value = []; selectedDishId.value = null; consent.value = false; error.value = ''; if (preview.value) URL.revokeObjectURL(preview.value); preview.value = ''; if (fileInput.value) fileInput.value.value = ''; }
</script>

<style scoped>
.narrow { max-width: 980px; }.back { display: inline-flex; align-items: center; gap: 4px; margin-bottom: 8px; color: var(--brand); font-size: 12px; }.step { display: flex; align-items: center; }.step span { display: grid; place-items: center; width: 27px; height: 27px; border: 1px solid #cfd3d6; border-radius: 50%; color: var(--muted); font-size: 12px; }.step span.active { border-color: var(--brand); color: white; background: var(--brand); }.step i { width: 28px; height: 1px; background: #cfd3d6; }
.upload-layout, .confirm-layout { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(320px, .92fr); gap: 22px; align-items: start; }
.dropzone { position: relative; display: grid; min-height: 420px; place-items: center; align-content: center; gap: 10px; overflow: hidden; border: 2px dashed #c4c9ce; border-radius: 6px; color: var(--muted); background: #fff; cursor: pointer; }.dropzone input { position: absolute; width: 1px; height: 1px; opacity: 0; }.dropzone svg { color: var(--brand); }.dropzone strong { color: #363b40; }.dropzone span { font-size: 12px; }.dropzone.filled { border-style: solid; }.dropzone img { position: absolute; width: 100%; height: 100%; object-fit: contain; background: #242629; }.replace { position: absolute; right: 12px; bottom: 12px; display: flex; align-items: center; gap: 5px; min-height: 34px; padding: 0 11px; border: 0; border-radius: 4px; background: white; cursor: pointer; }
.form-panel, .candidate-panel { display: grid; gap: 18px; padding: 22px; border: 1px solid var(--line); border-radius: 6px; background: white; box-shadow: var(--shadow); }.lookup-options { display: grid; gap: 9px; }.tip { display: flex; gap: 9px; padding: 12px; color: #43525c; background: #eef3f5; font-size: 12px; line-height: 1.55; }.tip svg { flex: 0 0 auto; }
.photo-column { display: grid; gap: 12px; }.photo-column > img { width: 100%; max-height: 520px; object-fit: contain; border-radius: 6px; background: #25282a; }.candidate-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }.candidate-title p { margin: 5px 0 0; color: var(--muted); font-size: 12px; }.catalog-heading { display: flex; align-items: center; gap: 6px; margin-bottom: -10px; color: #4f5d66; font-size: 12px; font-weight: 700; }.search-row { display: grid; grid-template-columns: 1fr 42px; gap: 7px; }.search-row input { min-width: 0; height: 42px; padding: 0 11px; border: 1px solid #cfd3d7; border-radius: 5px; }
.candidates { display: grid; max-height: 330px; gap: 7px; overflow-y: auto; }.candidates label { display: grid; grid-template-columns: 18px 1fr 18px; align-items: center; gap: 10px; min-height: 61px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 5px; cursor: pointer; }.candidates label.selected { border-color: var(--green); background: var(--green-soft); }.candidates input { accent-color: var(--green); }.candidates strong,.candidates small { display: block; }.candidates strong { font-size: 13px; }.candidates small { margin-top: 3px; color: var(--muted); font-size: 11px; }.candidates svg { color: var(--green); }.candidates .unmapped svg { color: var(--amber); }
.consent { display: grid; grid-template-columns: 18px 1fr; gap: 9px; color: #565d63; font-size: 12px; line-height: 1.6; cursor: pointer; }.consent input { margin-top: 3px; accent-color: var(--brand); }.submit { width: 100%; }
.done { display: grid; place-items: center; padding: 70px 20px; text-align: center; }.done-icon { display: grid; place-items: center; width: 66px; height: 66px; border-radius: 50%; color: white; background: var(--green); }.done h2 { margin: 16px 0 6px; }.done p { margin: 0 0 22px; color: var(--muted); }.done > div:last-child { display: flex; gap: 9px; }
.spin { animation: spin .8s linear infinite; }
@media(max-width: 760px) { .upload-layout,.confirm-layout { grid-template-columns: 1fr; }.dropzone { min-height: min(95vw, 410px); }.photo-column > img { max-height: 65vh; }.candidate-panel,.form-panel { padding: 16px; } }
</style>
