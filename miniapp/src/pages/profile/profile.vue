<template>
  <sc-page-shell title="我的" subtitle="饮食偏好与个人记录" tone="records" tab-id="profile">
    <view class="profile-layout">
      <view class="profile-summary">
        <view class="account-panel">
          <view class="avatar"><image v-if="store.user.value?.avatarUrl" :src="store.user.value.avatarUrl" mode="aspectFill" /><text v-else>{{ avatarText }}</text></view>
          <view class="account-copy"><text class="account-name">{{ displayName }}</text><text class="account-meta">学生账户 · 饮食数据已同步</text></view>
          <sc-icon name="user" :size="18" tone="muted" />
        </view>

        <view class="favorite-preview record-grid">
          <button @tap="open('/pages/saved/saved?panel=favorites')"><text class="favorite-count">{{ saved.favorites.length }}</text><text>收藏</text></button>
          <button @tap="open('/pages/saved/saved?panel=history')"><text class="record-count">{{ saved.eaten.length }}</text><text>吃过</text></button>
          <button @tap="open('/pages/orders/orders?panel=history')"><text class="record-count">{{ orderCount }}</text><text>订单</text></button>
        </view>
      </view>

      <view class="profile-menus">
        <view class="menu-section public-profile-section">
          <text class="section-label">公开资料</text>
          <view class="profile-editor"><input v-model="nickname" maxlength="32" placeholder="昵称（2-32 个字符）" /><button class="avatar-picker" @tap="chooseAvatar">选择头像</button><button class="profile-save" :loading="profileSaving" @tap="savePublicProfile">保存资料</button></view>
          <text class="profile-tip">发布帖子、评价或评论前需要完成头像和昵称。</text>
        </view>
        <view class="menu-section">
          <text class="section-label">个人服务</text>
          <view class="list-group">
            <sc-list-row icon-name="safe" title="健康档案" :description="profileSummary" :badge="profileIncomplete?'待完善':''" badge-tone="warning" @tap="open('/pages/health-profile/health-profile')" />
            <sc-list-row icon-name="store" title="到店预约" description="同档口预约、预约码与到店支付" @tap="open('/pages/orders/orders')" />
          </view>
        </view>

        <view class="menu-section">
          <text class="section-label">设置与协议</text>
          <view class="list-group settings-group">
            <view class="menu-row static-row"><sc-icon name="eye-invisible" :size="18" tone="muted" /><view class="row-copy"><text class="ui-strong">减少动画</text><text>保留淡入，关闭爆发与列表位移</text></view><wd-switch :model-value="store.motionReduced.value" size="22px" @update:model-value="toggleMotion" /></view>
            <sc-list-row icon-name="safe" title="隐私保护指引" @tap="open('/pages/privacy/privacy')" />
            <sc-list-row icon-name="file" title="用户服务协议" @tap="open('/pages/terms/terms')" />
          </view>
        </view>

        <button class="logout-button" @tap="logout"><sc-icon name="poweroff" :size="16" tone="danger" /><text>退出登录</text></button>
      </view>
    </view>
  </sc-page-shell>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { savedDishEntries } from '../../domain/studentDiscovery.js';
import { goalLabel, mealTypeLabel } from '../../utils/format.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const orderCount = ref(0);
const nickname = ref('');
const avatarReference = ref('');
const profileSaving = ref(false);
const displayName = computed(() => store.user.value?.nickname || store.user.value?.username || '学生用户');
const avatarText = computed(() => displayName.value.slice(0, 1));
const saved = computed(() => savedDishEntries(store.dishes.value, store.dishPreferences.value));
const profileIncomplete = computed(() => ['pending','deferred'].includes(store.profile.value.onboardingStatus));
const profileSummary = computed(() => profileIncomplete.value ? '确认过敏信息与预算后启用个性化推荐' : `${goalLabel(store.profile.value.goal)} · ${mealTypeLabel(store.profile.value.mealType)} · ¥${store.profile.value.budgetMax} 内`);

onShow(async () => {
  try {
    await store.refreshIfStale();
    if (!store.user.value) { uni.reLaunch({ url: '/pages/login/login' }); return; }
    nickname.value = store.user.value.nickname || '';
    const result = await store.listOrders().catch(() => ({ orders: [] }));
    orderCount.value = Array.isArray(result.orders) ? result.orders.length : 0;
  } catch {}
});

onPullDownRefresh(async () => {
  try {
    await store.load(true);
    const result = await store.listOrders().catch(() => ({ orders: [] }));
    orderCount.value = Array.isArray(result.orders) ? result.orders.length : 0;
  } catch {} finally {
    uni.stopPullDownRefresh();
  }
});

function open(url) { uni.navigateTo({ url }); }
async function chooseAvatar(){try{const chosen=await new Promise((resolve,reject)=>uni.chooseImage({count:1,sizeType:['compressed'],sourceType:['album','camera'],success:resolve,fail:reject}));const path=chosen.tempFilePaths?.[0];if(!path)return;const dataBase64=await new Promise((resolve,reject)=>uni.getFileSystemManager().readFile({filePath:path,encoding:'base64',success:(result)=>resolve(result.data),fail:reject}));const extension=(path.split('.').pop()||'jpg').toLowerCase();const contentType=extension==='png'?'image/png':extension==='webp'?'image/webp':extension==='gif'?'image/gif':'image/jpeg';const upload=await store.uploadImage({filename:`avatar.${extension}`,contentType,dataBase64});avatarReference.value=upload.reference;uni.showToast({title:'头像已选择',icon:'success'});}catch(error){if(!String(error?.errMsg||'').includes('cancel'))uni.showToast({title:error?.message||'头像上传失败',icon:'none'});}}
async function savePublicProfile(){profileSaving.value=true;try{await store.updatePublicProfile({nickname:nickname.value,avatarUrl:avatarReference.value||store.user.value?.avatarUrl});uni.showToast({title:'资料已保存',icon:'success'});}catch(error){uni.showToast({title:error?.message||'保存失败',icon:'none'});}finally{profileSaving.value=false;}}
function toggleMotion(value) { store.setMotionReduced(Boolean(value)); }
function logout() {
  uni.showModal({
    title: '退出登录', content: '确认退出当前账号？',
    success(result) { if (!result.confirm) return; store.logout(); uni.reLaunch({ url: '/pages/login/login' }); }
  });
}
</script>

<style scoped>
.profile-layout,.profile-summary,.profile-menus { min-width:0; }
.account-panel { display:flex; min-height:96px; align-items:center; gap:12px; padding:20px 16px; border:1px solid var(--module-line); border-radius:var(--radius-large); background:var(--module-soft); }
.avatar { display:flex; width:52px; height:52px; flex:0 0 52px; overflow:hidden; align-items:center; justify-content:center; border-radius:50%; color:#fff; background:var(--module-accent); font-size:20px; font-weight:600; }.avatar image{width:100%;height:100%}
.account-copy { flex:1; min-width:0; }
.account-name,.account-meta { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.account-name { color:var(--ink); font-size:16px; font-weight:600; }
.account-meta { margin-top:4px; color:var(--muted); font-size:12px; }
.record-grid { display:grid; grid-template-columns:repeat(3,1fr); margin:12px 0 24px; border-radius:var(--radius-large); background:var(--surface); }
.record-grid button { position:relative; min-height:74px; padding:12px 8px; text-align:center; }
.record-grid button+button::before { position:absolute; top:14px; bottom:14px; left:0; width:1px; background:var(--line); content:''; }
.record-grid button:active { transform:translateY(1px); background:var(--surface-soft); }
.record-grid text { display:block; color:var(--muted); font-size:12px; }
.record-grid .favorite-count,.record-grid .record-count { margin-bottom:4px; color:var(--module-dark); font-size:20px; font-weight:600; font-variant-numeric:tabular-nums; }
.record-grid .favorite-count,.record-grid .record-count { animation:metric-in 360ms var(--ease-spring) both; }
.menu-section { margin-bottom:18px; }
.profile-editor{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center}.profile-editor input{min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}.avatar-picker,.profile-save{min-height:44px;padding:0 12px;border-radius:var(--radius);font-size:14px}.avatar-picker{border:1px solid var(--line);background:var(--surface-soft)}.profile-save{color:#fff;background:var(--module-accent)}.profile-tip{display:block;margin-top:8px;color:var(--muted);font-size:12px;line-height:1.5}
.settings-group { padding-top:0; padding-bottom:0; }
.menu-row { display:flex; width:100%; min-height:56px; align-items:center; gap:12px; padding:10px 4px; border-bottom:1px solid var(--line); }
.row-copy { flex:1; min-width:0; }
.row-copy .ui-strong,.row-copy text { display:block; }
.row-copy .ui-strong { color:var(--ink); font-size:14px; font-weight:500; }
.row-copy text { margin-top:3px; overflow:hidden; color:var(--muted); font-size:12px; white-space:nowrap; text-overflow:ellipsis; }
.logout-button { display:flex; width:100%; min-height:44px; align-items:center; justify-content:center; gap:7px; border:1px solid var(--danger-line); border-radius:var(--radius); color:var(--danger); background:var(--surface); font-size:14px; font-weight:500; }
.logout-button:active { transform:translateY(1px); background:var(--danger-soft); }
@keyframes metric-in { from { opacity:0; transform:translateY(5px) scale(.94); } to { opacity:1; transform:none; } }
@media (min-width:768px) { .profile-layout { display:grid; grid-template-columns:320px minmax(0,1fr); gap:28px; align-items:start; }.profile-summary { position:sticky; top:72px; }.record-grid { margin-bottom:0; }.profile-menus { display:grid; grid-template-columns:minmax(0,1fr); gap:20px; }.profile-menus .logout-button { grid-column:1/-1; } }
@media (min-width:960px) { .profile-menus { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width:420px) { .profile-editor{grid-template-columns:1fr 1fr}.profile-editor input{grid-column:1/-1} }
</style>
