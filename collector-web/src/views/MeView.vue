<template>
  <div class="page">
    <div class="page-heading"><div><h1>我的采集记录</h1><p>积分和记录保存在当前浏览器匿名设备下，清除 Cookie 后无法找回。</p></div><div class="points"><Award :size="24" /><strong>{{ data.points }}</strong><span>积分</span></div></div>
    <div v-if="error" class="notice error"><CircleAlert :size="18" />{{ error }}</div>
    <div v-if="loading" class="empty"><span class="spinner"></span></div>
    <div v-else-if="!data.submissions.length" class="empty"><ImageOff :size="30" /><p>当前设备还没有提交记录</p><router-link class="button" to="/"><Camera :size="17" />开始采集</router-link></div>
    <div v-else class="records">
      <article v-for="item in data.submissions" :key="item.id">
        <img :src="assetUrl(item.imageUrl)" alt="已提交菜品" @error="hideBroken" />
        <div class="record-body"><div class="record-title"><strong>{{ item.dish?.name || item.claimedName }}</strong><span :class="`status-${item.status}`">{{ statusLabel[item.status] || item.status }}</span></div><p>{{ item.dish ? `${item.dish.venue} · ${item.dish.stall}` : '等待目录映射' }}</p><small>{{ formatTime(item.createdAt) }}</small><div v-if="item.rejectionReason" class="reason">{{ item.rejectionReason }}</div></div>
        <div class="record-side"><strong v-if="item.points > 0">+{{ item.points }}</strong><button v-if="!['withdrawn','expired'].includes(item.status)" class="button danger small" @click="withdraw(item)"><Trash2 :size="14" />撤回</button></div>
      </article>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { Award, Camera, CircleAlert, ImageOff, Trash2 } from '@lucide/vue';
import { assetUrl, collectorApi } from '../api.js';
const data = reactive({ points: 0, submissions: [] }); const loading = ref(true); const error = ref('');
const statusLabel = { draft:'草稿', pending_review:'待审核', needs_mapping:'待映射', approved:'已通过', rejected:'已驳回', withdrawn:'已撤回', expired:'已过期' };
async function load() { try { Object.assign(data, await collectorApi.me()); } catch (reason) { error.value = reason.message; } finally { loading.value = false; } }
async function withdraw(item) { if (!window.confirm('撤回后会删除原图，并从后续数据集中排除。确认撤回？')) return; try { await collectorApi.withdraw(item.id); await load(); } catch (reason) { error.value = reason.message; } }
function formatTime(value) { return new Intl.DateTimeFormat('zh-CN', { dateStyle:'medium', timeStyle:'short' }).format(new Date(value)); }
function hideBroken(event) { event.currentTarget.style.visibility = 'hidden'; }
onMounted(load);
</script>

<style scoped>
.points { display: grid; grid-template-columns: 28px auto auto; align-items: baseline; gap: 7px; min-width: 150px; padding: 12px 15px; border: 1px solid #d9c38f; border-radius: 6px; color: #77520f; background: var(--amber-soft); }.points svg { align-self: center; }.points strong { font-size: 26px; }.points span { font-size: 12px; }.empty .spinner { display: inline-block; }.empty svg { color: #9ba1a6; }.empty p { margin: 10px 0 18px; }
.records { display: grid; gap: 10px; }.records article { display: grid; grid-template-columns: 96px minmax(0,1fr) auto; gap: 15px; min-height: 110px; padding: 11px; border: 1px solid var(--line); border-radius: 6px; background: white; }.records img { width: 96px; height: 88px; object-fit: cover; border-radius: 4px; background: #e8eaec; }.record-body { min-width: 0; padding: 4px 0; }.record-title { display: flex; align-items: center; gap: 9px; }.record-title > strong { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }.record-title span { flex: 0 0 auto; padding: 3px 6px; border-radius: 3px; color: #5d6267; background: #eef0f1; font-size: 10px; }.record-title .status-approved { color: var(--green); background: var(--green-soft); }.record-title .status-rejected,.record-title .status-withdrawn { color: var(--brand); background: var(--brand-soft); }.record-body p { margin: 7px 0 4px; color: #545b61; font-size: 12px; }.record-body small { color: var(--muted); }.reason { margin-top: 6px; color: var(--brand); font-size: 11px; }.record-side { display: flex; align-items: flex-end; justify-content: space-between; flex-direction: column; padding: 4px 0; }.record-side > strong { color: var(--green); }
@media(max-width:600px) { .page-heading { flex-direction: row; align-items: flex-start; }.points { min-width: auto; grid-template-columns: auto auto; }.points svg { display:none; }.records article { grid-template-columns: 76px minmax(0,1fr); }.records img { width:76px;height:76px; }.record-side { grid-column: 2; flex-direction: row-reverse; align-items: center; }.record-title { align-items:flex-start; flex-direction:column; gap:5px; } }
</style>
