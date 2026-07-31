<template>
  <section class="page-heading">
    <p class="eyebrow">INVITATION CONTROL</p>
    <h1>邀请码管理</h1>
    <p>发放、统计和维护当前租户的邀请码。</p>
  </section>

  <section class="card invitation-settings-panel">
    <button class="settings-toggle" type="button" :aria-expanded="settingsOpen" @click="settingsOpen = !settingsOpen">
      <span>
        <strong>发放设置</strong>
        <small>{{ selectedDate }} · {{ settings.issueTime }} 发放 {{ settings.dailyQuota }} 个 · 有效期 {{ settings.expiresAfterDays }} 天</small>
      </span>
      <span class="settings-toggle-action">{{ settingsOpen ? '收起' : '配置' }}</span>
    </button>
    <form v-if="settingsOpen" class="invitation-settings-form" @submit.prevent="saveSettings">
      <label>发放日期<input v-model="selectedDate" type="date" required /></label>
      <label>发放时间<input v-model="settings.issueTime" type="time" required /></label>
      <label>本次发放数量<input v-model.number="settings.dailyQuota" type="number" min="0" max="5000" step="1" required /></label>
      <label>邀请码有效期（天）<input v-model.number="settings.expiresAfterDays" type="number" min="1" max="365" step="1" required /></label>
      <button class="primary" type="submit" :disabled="busy">保存设置</button>
    </form>
  </section>

  <section class="invitation-metrics">
    <article><span>本次发放数量</span><strong>{{ summary?.batch?.dailyQuota ?? settings.dailyQuota }}</strong></article>
    <article><span>已发放总数</span><strong>{{ summary?.counts?.generated ?? 0 }}</strong></article>
    <article><span>剩余额度</span><strong>{{ summary?.counts?.remainingQuota ?? 0 }}</strong></article>
    <article><span>可用邀请码</span><strong>{{ summary?.counts?.available ?? 0 }}</strong></article>
    <article><span>已使用总数</span><strong>{{ summary?.counts?.consumed ?? 0 }}</strong></article>
    <article><span>已撤销/过期</span><strong>{{ Number(summary?.counts?.revoked || 0) + Number(summary?.counts?.expired || 0) }}</strong></article>
  </section>

  <p v-if="message" class="form-message" role="status">{{ message }}</p>
  <p v-if="error" class="form-message danger" role="alert">{{ error }}</p>

  <section v-if="revealedCode || issuedCodes.length" class="card plaintext-panel">
    <div class="section-title horizontal">
      <div><p class="eyebrow">ONE-TIME DISPLAY</p><h2>本次生成的邀请码</h2></div>
      <button class="ghost" type="button" @click="hidePlaintext">隐藏明文</button>
    </div>
    <p class="muted">邀请码明文只在本次操作中显示，关闭或刷新后不能从数据库取回。</p>
    <div v-if="revealedCode" class="revealed-code-row">
      <code>{{ revealedCode }}</code>
      <button class="secondary" type="button" @click="copyCode(revealedCode)">复制并隐藏</button>
    </div>
    <div v-for="item in issuedCodes" :key="item.id" class="revealed-code-row">
      <code>{{ item.code }}</code>
      <button class="secondary" type="button" @click="copyCode(item.code)">复制并隐藏</button>
    </div>
  </section>

  <section class="card invitation-list-panel">
    <div class="section-title horizontal">
      <div><p class="eyebrow">{{ selectedDate }}</p><h2>邀请码统计</h2><small class="batch-progress">当前批次已发 {{ summary?.batch?.issuedCount ?? 0 }} / {{ summary?.batch?.dailyQuota ?? settings.dailyQuota }} 个{{ summary?.batch?.status === 'closed' ? ' · 已停止继续发放' : '' }}</small></div>
      <div class="button-row">
        <input v-model.number="issueCount" class="issue-count" type="number" min="1" max="500" :disabled="!remainingQuota" aria-label="发放数量" />
        <button class="primary" type="button" :disabled="busy || !remainingQuota" @click="issueBatch">发放邀请码</button>
        <button class="ghost danger" type="button" :disabled="busy || !summary?.batch || summary.batch.status !== 'active'" @click="stopBatch">停止继续发放</button>
        <button class="ghost" type="button" :disabled="loading" @click="refresh">刷新</button>
      </div>
    </div>
    <div v-if="loading && !invitations.length" class="invitation-empty">正在读取当前批次...</div>
    <div v-else-if="!invitations.length" class="invitation-empty">当前批次还没有发放邀请码。</div>
    <div v-else class="table-wrap invitation-table-wrap">
      <table>
        <thead><tr><th>尾号</th><th>发放日期</th><th>发放时间</th><th>状态</th><th>有效期</th><th>注册手机号</th><th>注册时间</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="item in invitations" :key="item.id">
            <td><strong>•••• {{ item.codeHint }}</strong></td>
            <td>{{ item.businessDate || '-' }}</td>
            <td>{{ formatDate(item.createdAt) }}</td>
            <td><span :class="['status-pill', `status-${item.status}`]">{{ statusLabel(item.status) }}</span></td>
            <td>{{ formatDate(item.expiresAt) }}</td>
            <td>{{ item.usedPhone || '-' }}</td>
            <td>{{ formatDate(item.usedAt) }}</td>
            <td>
              <div v-if="item.status === 'active' || item.status === 'claimed'" class="row-actions">
                <button class="ghost" type="button" :disabled="busy" @click="editExpiry(item)">修改有效期</button>
                <button class="ghost danger" type="button" :disabled="busy" @click="remove(item)">删除</button>
              </div>
              <span v-else class="muted">不可操作</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <footer v-if="page.total > page.limit" class="invitation-pagination">
      <button class="ghost" type="button" :disabled="page.offset === 0 || loading" @click="changePage(-1)">上一页</button>
      <span>{{ page.offset + 1 }}-{{ Math.min(page.offset + invitations.length, page.total) }} / {{ page.total }}</span>
      <button class="ghost" type="button" :disabled="page.offset + page.limit >= page.total || loading" @click="changePage(1)">下一页</button>
    </footer>
  </section>

  <section class="card registration-panel">
    <div class="section-title horizontal">
      <div><p class="eyebrow">REGISTRATION RECORDS</p><h2>邀请码注册手机号</h2></div>
      <strong class="registration-count">{{ summary?.registrations?.count ?? 0 }} 人</strong>
    </div>
    <p class="muted">仅统计同意提供手机号的注册记录，页面只显示脱敏号码。</p>
    <div v-if="!registrations.length" class="invitation-empty">当前批次还没有邀请码注册记录。</div>
    <div v-else class="table-wrap registration-table-wrap">
      <table>
        <thead><tr><th>手机号</th><th>邀请码尾号</th><th>授权状态</th><th>注册时间</th></tr></thead>
        <tbody>
          <tr v-for="item in registrations" :key="item.invitationId">
            <td><strong>{{ item.phone }}</strong></td>
            <td>•••• {{ item.codeHint }}</td>
            <td>{{ item.phoneVerified ? '已验证' : '已提供，待验证' }}</td>
            <td>{{ formatDate(item.registeredAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { apiClient } from '../services/apiClient.js';

function todayInChina() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

const selectedDate = ref(todayInChina());
const settingsOpen = ref(false);
const settings = reactive({ dailyQuota: 0, expiresAfterDays: 30, issueTime: '09:00' });
const summary = ref(null);
const invitations = ref([]);
const page = reactive({ limit: 50, offset: 0, total: 0 });
const issueCount = ref(1);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const message = ref('');
const revealedCode = ref('');
const issuedCodes = ref([]);
let timer = null;

const remainingQuota = computed(() => Number(summary.value?.counts?.remainingQuota || 0));
const registrations = computed(() => summary.value?.registrations?.items || []);

function applySummary(result) {
  summary.value = result;
  if (result.settings) {
    settings.dailyQuota = Number(result.settings.dailyQuota ?? settings.dailyQuota);
    settings.expiresAfterDays = Number(result.settings.expiresAfterDays ?? settings.expiresAfterDays);
    settings.issueTime = result.settings.issueTime || settings.issueTime;
  }
}

async function refresh({ silent = false } = {}) {
  if (!silent) loading.value = true;
  error.value = '';
  try {
    const [summaryResult, listResult] = await Promise.all([
      apiClient.getAdminInvitationSummary(selectedDate.value),
      apiClient.listAdminInvitations({ date: selectedDate.value, limit: page.limit, offset: page.offset })
    ]);
    applySummary(summaryResult);
    invitations.value = listResult.invitations || [];
    Object.assign(page, listResult.page || {});
  } catch (err) {
    if (!silent) error.value = err.message;
  } finally {
    if (!silent) loading.value = false;
  }
}

async function saveSettings() {
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    const result = await apiClient.saveAdminInvitationSettings({
      dailyQuota: settings.dailyQuota,
      expiresAfterDays: settings.expiresAfterDays,
      issueTime: settings.issueTime,
      autoIssue: true,
      businessDate: selectedDate.value
    });
    applySummary(result);
    message.value = '发放设置已保存。';
    settingsOpen.value = false;
    await refresh({ silent: true });
  } catch (err) { error.value = err.message; }
  finally { busy.value = false; }
}

async function issueBatch() {
  const max = Math.min(500, remainingQuota.value);
  const count = Number(issueCount.value);
  if (!Number.isInteger(count) || count < 1 || count > max) {
    error.value = `发放数量必须在 1-${max} 之间。`;
    return;
  }
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    const result = await apiClient.issueAdminInvitationBatch(selectedDate.value, count);
    issuedCodes.value = result.invitations || [];
    revealedCode.value = '';
    message.value = `已生成 ${issuedCodes.value.length} 个邀请码。`;
    await refresh({ silent: true });
  } catch (err) { error.value = err.message; }
  finally { busy.value = false; }
}

async function stopBatch() {
  const batchId = summary.value?.batch?.id;
  if (!batchId || !window.confirm('停止后将不再继续发放本批次，已发出的邀请码仍可注册。确认停止吗？')) return;
  busy.value = true;
  error.value = '';
  try {
    await apiClient.closeAdminInvitationBatch(batchId);
    message.value = '本批次已停止继续发放。';
    await refresh({ silent: true });
  } catch (err) { error.value = err.message; }
  finally { busy.value = false; }
}

function localDateTimeValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function editExpiry(item) {
  const value = window.prompt('请输入新的有效期，例如 2026-08-20T23:59', localDateTimeValue(item.expiresAt));
  if (!value) return;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    error.value = '请输入未来的有效期。';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    await apiClient.updateAdminInvitation(item.id, { expiresAt: date.toISOString() });
    message.value = '邀请码有效期已更新。';
    await refresh({ silent: true });
  } catch (err) { error.value = err.message; }
  finally { busy.value = false; }
}

async function remove(item) {
  if (!window.confirm(`确认删除尾号为 ${item.codeHint} 的邀请码？删除后将撤销且保留审计记录。`)) return;
  busy.value = true;
  error.value = '';
  try {
    await apiClient.deleteAdminInvitation(item.id);
    message.value = '邀请码已删除并撤销。';
    await refresh({ silent: true });
  } catch (err) { error.value = err.message; }
  finally { busy.value = false; }
}

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    if (revealedCode.value === code) revealedCode.value = '';
    issuedCodes.value = issuedCodes.value.filter((item) => item.code !== code);
    message.value = '邀请码已复制并隐藏。';
  } catch {
    error.value = '浏览器拒绝访问剪贴板，请手动复制后点击隐藏。';
  }
}

function hidePlaintext() {
  revealedCode.value = '';
  issuedCodes.value = [];
}

function statusLabel(status) {
  return ({ active: '可用', claimed: '已领取', consumed: '已使用', revoked: '已撤销', expired: '已过期' })[status] || status;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

async function changePage(direction) {
  page.offset = Math.max(0, page.offset + direction * page.limit);
  await refresh();
}

onMounted(async () => {
  await refresh();
  timer = window.setInterval(() => refresh({ silent: true }), 5000);
});

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});
</script>

<style scoped>
.invitation-settings-panel,.plaintext-panel,.invitation-list-panel,.registration-panel { display:grid; gap:18px; }
.settings-toggle { display:flex; align-items:center; justify-content:space-between; gap:16px; width:100%; padding:0; border:0; background:transparent; color:var(--ink); text-align:left; cursor:pointer; }
.settings-toggle > span:first-child { display:grid; gap:5px; }
.settings-toggle strong { font-family:var(--font-display); font-size:22px; }
.settings-toggle small { color:var(--muted); font-size:13px; }
.settings-toggle-action { color:var(--primary-dark); font-weight:800; }
.invitation-settings-form { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); align-items:end; gap:12px; padding-top:16px; border-top:1px solid #e3ebe0; }
.invitation-settings-form label { display:grid; gap:7px; color:var(--muted); font-size:13px; font-weight:700; }
.invitation-settings-form input,.issue-count { width:100%; min-height:42px; box-sizing:border-box; padding:9px 11px; border:1px solid #dce7d8; border-radius:8px; background:#fff; color:var(--ink); }
.invitation-actions,.button-row,.row-actions,.revealed-code-row,.invitation-pagination { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
.live-status { color:var(--muted); font-size:13px; font-weight:700; }
.live-status i { display:inline-block; width:8px; height:8px; margin-right:6px; border-radius:50%; background:var(--danger); }
.live-status.online i { background:#31a866; }
.invitation-metrics { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:12px; margin:18px 0; }
.invitation-metrics article { display:grid; gap:6px; padding:18px; border:1px solid rgba(31,122,77,.13); border-radius:8px; background:#fff; }
.invitation-metrics span { color:var(--muted); font-size:13px; font-weight:700; }
.invitation-metrics strong { color:var(--primary-dark); font-family:var(--font-display); font-size:27px; }
.plaintext-panel { border-color:rgba(31,122,77,.28); }
.revealed-code-row { justify-content:flex-start; padding:10px; border:1px solid #dce7d8; border-radius:8px; background:#f8fbf6; }
.revealed-code-row code { min-width:220px; color:var(--primary-dark); font-size:18px; font-weight:800; letter-spacing:1px; }
.issue-count { width:90px; }
.invitation-empty { padding:35px 12px; color:var(--muted); text-align:center; }
.invitation-table-wrap,.registration-table-wrap { max-height:520px; overflow:auto; }
.invitation-table-wrap table { min-width:1180px; }
.batch-progress { display:block; margin-top:6px; color:var(--muted); }
.registration-table-wrap table { min-width:620px; }
.row-actions { justify-content:flex-start; }
.registration-count { color:var(--primary-dark); font-family:var(--font-display); font-size:22px; }
.status-active { color:#257342; background:#e5f5e8; }
.status-claimed { color:#7a5b12; background:#fff3cc; }
.status-consumed { color:#49627b; background:#e8eef5; }
.status-revoked,.status-expired { color:#8b3d3d; background:#fbe7e7; }
.invitation-pagination { justify-content:center; padding-top:4px; }
@media (max-width:900px) { .invitation-metrics { grid-template-columns:repeat(3,minmax(0,1fr)); } }
@media (max-width:560px) { .invitation-settings-form { grid-template-columns:1fr; }.invitation-metrics { grid-template-columns:1fr 1fr; }.invitation-metrics article { padding:13px; }.revealed-code-row code { min-width:0; flex:1; font-size:15px; } }
</style>
