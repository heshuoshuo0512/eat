<template>
  <section class="page-heading"><p class="eyebrow">个人中心</p><h1>我的</h1><p>账号、健康设置和个人记录集中管理。</p></section>
  <div class="profile-layout">
    <aside class="profile-summary">
      <div class="avatar"><img v-if="store.user?.avatarUrl" :src="store.user.avatarUrl" alt=""><span v-else>{{ displayName.slice(0, 1) }}</span></div>
      <div><h2>{{ displayName }}</h2><p>{{ store.user?.username }} · 学生账号</p></div>
      <div class="profile-metrics"><RouterLink to="/saved?panel=favorites"><strong>{{ favoriteCount }}</strong><span>收藏</span></RouterLink><RouterLink to="/saved?panel=history"><strong>{{ eatenCount }}</strong><span>吃过</span></RouterLink><RouterLink to="/orders"><strong>{{ store.orders.length }}</strong><span>订单</span></RouterLink></div>
    </aside>
    <main class="profile-services">
      <section>
        <p class="eyebrow">公开资料</p><h2>头像与昵称</h2>
        <p class="profile-note">发布帖子、评价或评论前需要完成公开资料。</p>
        <div class="public-profile-form"><label><span>昵称</span><input v-model.trim="nickname" maxlength="32" placeholder="2-32 个字符"></label><label><span>头像</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="selectAvatar"></label><button class="primary" type="button" :disabled="profileSaving" @click="savePublicProfile">{{ profileSaving ? '保存中...' : '保存公开资料' }}</button></div>
        <p v-if="profileMessage" :class="['profile-message',{error:profileError}]">{{ profileMessage }}</p>
      </section>
      <section><p class="eyebrow">个人服务</p><div class="service-list"><RouterLink to="/health-profile"><span><strong>健康档案</strong><small>{{ profileSummary }}</small></span><b>›</b></RouterLink><RouterLink to="/saved"><span><strong>收藏与用餐记录</strong><small>查看收藏菜品和订单自动生成的吃过记录</small></span><b>›</b></RouterLink><RouterLink to="/orders"><span><strong>我的订单</strong><small>查看预约、取餐码与订单状态</small></span><b>›</b></RouterLink><RouterLink to="/community"><span><strong>我的帖子与评价</strong><small>在社区中修改或删除自己发布的内容</small></span><b>›</b></RouterLink></div></section>
      <section><p class="eyebrow">设置</p><div class="settings-row"><span><strong>减少动画</strong><small>降低转场与列表动画</small></span><input v-model="reducedMotion" type="checkbox" aria-label="减少动画" @change="saveMotion"></div><button class="secondary logout" type="button" @click="store.logout">退出登录</button></section>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useCanteenStore } from '../stores/canteenStore.js';
const store = useCanteenStore();
const route = useRoute();
const router = useRouter();
const reducedMotion = ref(localStorage.getItem('sc:web:reduced-motion') === '1');
const nickname = ref('');
const avatarReference = ref('');
const profileSaving = ref(false);
const profileMessage = ref('');
const profileError = ref(false);
const displayName = computed(() => store.user?.nickname || store.user?.username || '学生用户');
const favoriteCount = computed(() => Number(store.savedCatalog.favorite.page.total || store.savedCatalog.favorite.items.length));
const eatenCount = computed(() => Number(store.savedCatalog.eaten.page.total || store.savedCatalog.eaten.items.length));
const profileSummary = computed(() => ['pending', 'deferred'].includes(store.profile?.onboardingStatus) ? '待完善过敏信息与预算' : `预算 ¥${store.profile?.budgetMax || 20} 内`);
function saveMotion() { localStorage.setItem('sc:web:reduced-motion', reducedMotion.value ? '1' : '0'); document.documentElement.classList.toggle('reduce-motion', reducedMotion.value); }
async function selectAvatar(event) { const file=event.target.files?.[0]; if(!file)return; profileMessage.value=''; const dataBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=reject;reader.readAsDataURL(file);}); try{const upload=await store.uploadImage({filename:file.name,contentType:file.type,dataBase64});avatarReference.value=upload.reference;}catch(error){profileError.value=true;profileMessage.value=error.message;} }
async function savePublicProfile(){profileSaving.value=true;profileMessage.value='';profileError.value=false;try{await store.updatePublicProfile({nickname:nickname.value,avatarUrl:avatarReference.value||store.user?.avatarUrl});profileMessage.value='公开资料已保存。';const returnTo=String(route.query.returnTo||'').trim();if(returnTo.startsWith('/')&&returnTo!=='/profile'){await router.replace(returnTo);}}catch(error){profileError.value=true;profileMessage.value=error.message;}finally{profileSaving.value=false;}}
onMounted(async () => { saveMotion(); nickname.value=store.user?.nickname||''; await Promise.all([store.loadSavedCatalog('favorite'), store.loadSavedCatalog('eaten'), store.loadOrders()]); });
</script>

<style scoped>
.profile-layout { display:grid; grid-template-columns:300px minmax(0,1fr); gap:24px; align-items:start; }.profile-summary { display:grid; justify-items:center; gap:10px; padding:24px; border:1px solid rgba(31,122,77,.14); border-radius:8px; background:#fff; text-align:center; }.avatar { display:grid; width:72px; height:72px; overflow:hidden; place-items:center; border-radius:50%; color:#fff; background:var(--primary); font-size:28px; font-weight:700; }.avatar img{width:100%;height:100%;object-fit:cover}.profile-summary h2,.profile-summary p { margin:0; }.profile-summary p { color:var(--muted); }.profile-metrics { display:grid; grid-template-columns:repeat(3,1fr); width:100%; margin-top:10px; border-top:1px solid #e4ebe2; }.profile-metrics a { display:grid; gap:3px; padding:15px 4px 0; color:inherit; text-decoration:none; }.profile-metrics strong { color:var(--primary-dark); font-size:20px; }.profile-metrics span { color:var(--muted); font-size:12px; }.profile-services { display:grid; gap:24px; }.profile-services section { padding:20px; border:1px solid rgba(31,122,77,.14); border-radius:8px; background:#fff; }.profile-note{color:var(--muted)}.public-profile-form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:12px;align-items:end}.public-profile-form label{display:grid;gap:6px}.public-profile-form input{min-height:42px}.public-profile-form button{min-height:42px}.profile-message{margin:12px 0 0;color:var(--primary-dark)}.profile-message.error{color:var(--danger)}.service-list { display:grid; }.service-list a,.settings-row { display:flex; min-height:64px; align-items:center; justify-content:space-between; gap:16px; border-bottom:1px solid #e4ebe2; color:inherit; text-decoration:none; }.service-list span,.settings-row span { display:grid; gap:4px; }.service-list small,.settings-row small { color:var(--muted); }.service-list b { color:var(--muted); font-size:24px; }.settings-row input { width:20px; height:20px; }.logout { width:100%; margin-top:18px; }@media(max-width:760px){.profile-layout{grid-template-columns:1fr}.profile-summary{position:static}.public-profile-form{grid-template-columns:1fr}}
</style>
