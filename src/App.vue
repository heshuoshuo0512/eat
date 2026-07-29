<template>
  <a class="skip-link" href="#main-content">跳到主要内容</a>
  <div v-if="!store.user" class="login-landing">
    <section class="login-hero">
      <RouterLink class="brand" to="/">
        <img class="brand-mark" :src="appIcon" alt="" aria-hidden="true">
        <span>
          <strong>智慧食堂</strong>
          <small>Smart Canteen</small>
        </span>
      </RouterLink>
      <p class="eyebrow">Smart Canteen Platform</p>
      <h1>开启您的智慧食堂体验，轻松搞定每一餐</h1>
      <p class="hero-copy">档口菜品检索、每日热门排行、AI智能推荐、轻松点餐加购......解决您的吃饭难题！</p>
      <div class="metric-grid login-metrics">
        <article><strong>RBAC</strong><span>角色权限管控</span></article>
        <article><strong>RAG</strong><span>真实菜品检索</span></article>
        <article><strong>DB</strong><span>数据库持久化</span></article>
        <article><strong>API</strong><span>OpenAPI 合同</span></article>
      </div>
    </section>

    <section :class="['login-panel', `view-${currentView}`]">
      <!-- 左侧提示：去登录（注册 / 找回密码时可见） -->
      <div class="con-box left">
        <span class="con-icon">🍽️</span>
        <h2>欢迎来到<span>智慧食堂</span></h2>
        <p>已有<span>账号</span>？</p>
        <button @click="slideToLogin">去登录</button>
      </div>

      <!-- 右侧提示：去注册（登录时可见，找回密码时隐藏） -->
      <div class="con-box right" :class="{ 'con-hidden': currentView === 'forgot' }">
        <span class="con-icon">🥗</span>
        <h2>欢迎来到<span>智慧食堂</span></h2>
        <p>还没有<span>账号</span>？</p>
        <button @click="slideToRegister">去注册</button>
      </div>

      <!-- 滑动表单盒子 -->
      <div class="form-box" :class="{ 'slide-register': currentView === 'register' }">

        <!-- 登录 -->
        <form v-show="currentView === 'login'" class="form-inner" @submit.prevent="handleLogin">
          <h1>login</h1>
          <p class="form-subtitle">统一账号入口</p>
          <div class="input-group">
            <input v-model.trim="loginForm.identifier" placeholder="手机号或账号" autocomplete="username">
            <input v-model="loginForm.password" type="password" placeholder="密码" autocomplete="current-password">
          </div>
          <p v-if="authError || store.error" class="form-error">{{ authError || store.error }}</p>
          <button class="submit-btn" type="submit" :disabled="store.loading">{{ store.loading ? '登录中...' : '登录' }}</button>
          <p class="forgot-link" @click="showForgotPassword">忘记密码？</p>
        </form>

        <!-- 注册 -->
        <form v-show="currentView === 'register'" class="form-inner" @submit.prevent="handleRegister">
          <h1>register</h1>
          <p class="form-subtitle">创建新账号进入系统</p>
          <div class="input-group">
            <input v-model.trim="registerForm.phone" inputmode="numeric" maxlength="11" placeholder="手机号" autocomplete="tel">
            <div class="code-row">
              <input v-model.trim="registerForm.verificationCode" inputmode="numeric" maxlength="6" placeholder="验证码">
              <button type="button" :disabled="codeSending" @click="sendCode('register')">{{ codeSending ? '发送中' : '获取验证码' }}</button>
            </div>
            <input v-model.trim="registerForm.nickname" maxlength="32" placeholder="昵称（可选）">
            <input v-model="registerForm.password" type="password" placeholder="密码（8-72位，含字母和数字）" autocomplete="new-password">
            <input v-model="registerForm.confirmPassword" type="password" placeholder="确认密码" autocomplete="new-password">
          </div>
          <label class="auth-agreement"><input v-model="registerForm.agreementAccepted" type="checkbox"><span>我已阅读并同意 <button type="button" @click="legalDocument='privacy'">隐私保护指引</button> 与 <button type="button" @click="legalDocument='terms'">用户服务协议</button></span></label>
          <p v-if="authError" class="form-error">{{ authError }}</p>
          <button class="submit-btn" type="submit" :disabled="store.loading">{{ store.loading ? '注册中...' : '注册并登录' }}</button>
          <p class="back-link" @click="slideToLogin">← 返回登录</p>
        </form>

        <!-- 找回密码 -->
        <form v-show="currentView === 'forgot'" class="form-inner" @submit.prevent="handleResetPassword">
          <h1>reset</h1>
          <p class="form-subtitle">重设学生密码</p>
          <div class="input-group">
            <input v-model.trim="resetForm.phone" inputmode="numeric" maxlength="11" placeholder="手机号" autocomplete="tel">
            <div class="code-row">
              <input v-model.trim="resetForm.verificationCode" inputmode="numeric" maxlength="6" placeholder="验证码">
              <button type="button" :disabled="codeSending" @click="sendCode('reset_password')">{{ codeSending ? '发送中' : '获取验证码' }}</button>
            </div>
            <input v-model="resetForm.password" type="password" placeholder="新密码（8-72位，含字母和数字）" autocomplete="new-password">
            <input v-model="resetForm.confirmPassword" type="password" placeholder="确认新密码" autocomplete="new-password">
          </div>
          <p v-if="authError" class="form-error">{{ authError }}</p>
          <button class="submit-btn" type="submit" :disabled="store.loading">确认重设</button>
          <p class="back-link" @click="backToLogin">← 返回登录</p>
        </form>

      </div>
    </section>
  </div>

  <div v-else class="shell">
    <button class="mobile-nav-toggle" type="button" :aria-expanded="mobileNavOpen" aria-controls="app-sidebar" @click="mobileNavOpen = !mobileNavOpen">{{ mobileNavOpen ? '收起导航' : '打开导航' }}</button>
    <aside id="app-sidebar" :class="['sidebar', { open: mobileNavOpen }]">
      <RouterLink class="brand" to="/" @click="mobileNavOpen = false">
        <img class="brand-mark" :src="appIcon" alt="" aria-hidden="true">
        <span>
          <strong>智慧食堂</strong>
          <small>Smart Canteen</small>
        </span>
      </RouterLink>
      <nav class="nav-list" aria-label="主导航">
        <template v-for="group in visibleNavGroups" :key="group.label">
          <p class="nav-section-label">{{ group.label }}</p>
          <RouterLink v-for="item in group.items" :key="navKey(item)" :to="item.to" custom v-slot="{ href, navigate }">
            <a :href="href" :class="{ active: isNavActive(item) }" @click="handleNavClick(navigate, $event)"><span>{{ item.label }}</span><span v-if="navBadge(item)" class="nav-badge">{{ navBadge(item) }}</span></a>
          </RouterLink>
        </template>
      </nav>
      <section v-if="store.user" class="session-card compact">
        <p class="eyebrow">当前身份</p>
        <strong>{{ store.user.nickname }}</strong>
        <small>{{ isAdminFamily ? '管理员端已解锁' : '学生端' }}</small>
        <button class="ghost" type="button" @click="store.logout">退出登录</button>
      </section>
    </aside>

    <main id="main-content" class="main-panel" tabindex="-1">
      <RouterView />
    </main>
  </div>

  <div v-if="showOnboardingPrompt" class="onboarding-backdrop" role="presentation">
    <section class="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <p class="eyebrow">首次使用</p>
      <h2 id="onboarding-title">先确认饮食安全信息</h2>
      <p>完善过敏原、忌口和预算后，推荐才能使用你的真实偏好。暂时不填也可以继续浏览。</p>
      <div class="onboarding-actions">
        <button class="secondary" type="button" :disabled="onboardingSaving" @click="deferOnboarding">稍后填写</button>
        <button class="primary" type="button" @click="openHealthProfile">去填写</button>
      </div>
      <p v-if="onboardingError" class="form-error">{{ onboardingError }}</p>
    </section>
  </div>

  <div v-if="legalDocument" class="onboarding-backdrop" role="presentation" @click.self="legalDocument=''">
    <section class="onboarding-dialog legal-dialog" role="dialog" aria-modal="true" :aria-labelledby="`${legalDocument}-title`">
      <p class="eyebrow">{{ legalDocument === 'privacy' ? 'PRIVACY' : 'TERMS' }}</p>
      <h2 :id="`${legalDocument}-title`">{{ legalDocument === 'privacy' ? '隐私保护指引' : '用户服务协议' }}</h2>
      <template v-if="legalDocument === 'privacy'">
        <p>系统处理手机号、微信登录标识、健康偏好、忌口、收藏与评价，用于身份识别和校园餐饮推荐。手机号以加密值与不可逆哈希保存，接口仅返回脱敏号码。</p>
        <p>健康档案不采集年龄、身高、体重或疾病信息；智能推荐不能替代医生或营养师建议。</p>
      </template>
      <template v-else>
        <p>请使用本人账号，提交真实、合法且与校园餐饮相关的内容。菜单、库存、营养和推荐仅作为校园用餐辅助信息。</p>
        <p>学校或食堂运营方可按运营、合规和安全要求调整功能与数据。</p>
      </template>
      <button class="primary" type="button" @click="legalDocument=''">我知道了</button>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import appIcon from './assets/brand/app-icon.svg';
import { validateLoginForm, validateRegisterForm, validateResetPasswordForm } from './domain/validation.js';
import { useCanteenStore } from './stores/canteenStore.js';

const store = useCanteenStore();
const route = useRoute();
const router = useRouter();
const adminRoleSet = new Set(['operator', 'stall_admin', 'canteen_admin', 'auditor', 'finance', 'tenant_admin', 'admin', 'super_admin']);
const roleFeatures = {
  student: new Set(['student']),
  operator: new Set(['data_input', 'data_manage', 'agent']),
  stall_admin: new Set(['data_input', 'data_manage', 'agent']),
  canteen_admin: new Set(['data_input', 'data_manage', 'reviews', 'environment', 'agent']),
  auditor: new Set(['data_manage']),
  finance: new Set(),
  tenant_admin: new Set(['data_input', 'data_manage', 'reviews', 'environment', 'ai_config', 'agent']),
  admin: new Set(['data_input', 'data_manage', 'reviews', 'environment', 'ai_config', 'agent']),
  super_admin: new Set(['data_input', 'data_manage', 'reviews', 'environment', 'ai_config', 'agent'])
};
const navItems = [
  { to: '/', label: '学生首页', feature: 'student', group: '首页' },
  { to: '/dishes', label: '菜品检索', feature: 'student', group: '智能吃饭', featured: true },
  { to: '/recommend', label: '智能推荐', feature: 'student', group: '智能吃饭', featured: true },
  { to: '/reviews', label: '菜品评价', feature: 'student', group: '校园互动' },
  { to: '/community', label: '校园帖子', feature: 'student', group: '校园互动', featured: true },
  { to: '/canteens', label: '食堂导航', feature: 'student', group: '更多探索' },
  { to: '/rankings', label: '排行榜', feature: 'student', group: '更多探索' },
  { to: '/regions', label: '地区口味推荐', feature: 'student', group: '更多探索' },
  { to: '/profile', label: '我的', feature: 'student', group: '个人记录' },
  { to: '/saved', label: '收藏与用餐记录', feature: 'student', group: '个人记录' },
  { to: '/orders', label: '到店预约', feature: 'student', group: '用餐服务', badge: '' },
  { to: '/health-profile', label: '健康档案', feature: 'student', group: '健康档案' },
  { to: '/admin?panel=reviews&tab=reviews', label: '内容审核', feature: 'reviews', group: '数据中心' },
  { to: '/admin/catalog', label: '数据管理', feature: 'data_manage', group: '数据中心' },
  { to: '/admin/input', label: '数据录入', feature: 'data_input', group: '数据中心' },
  { to: '/agent', label: '运营智能体', feature: 'agent', group: '智能与配置' },
  { to: '/admin/ai', label: 'AI 配置', feature: 'ai_config', group: '智能与配置' }
];
const visibleNavGroups = computed(() => {
  const features = roleFeatures[store.user?.role] || roleFeatures.student;
  const groups = [];
  for (const item of navItems) {
    if (!features.has(item.feature)) continue;
    let group = groups.find((entry) => entry.label === item.group);
    if (!group) {
      group = { label: item.group, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
});

const isAdminFamily = computed(() => adminRoleSet.has(store.user?.role));
function landingPathForRole(role) {
  if (role === 'operator' || role === 'stall_admin') return '/admin/input';
  if (role === 'auditor') return '/admin/catalog';
  if (role === 'finance') return '/order-analytics';
  return adminRoleSet.has(role) ? '/admin' : '/';
}
function navKey(item) { return `${item.group}-${item.feature}-${item.to}`; }
function isNavActive(item) {
  const [path, queryString] = item.to.split('?');
  if (route.path !== path && !(path !== '/' && route.path.startsWith(`${path}/`))) return false;
  if (!queryString) {
    return route.path === path || (path !== '/' && route.path.startsWith(`${path}/`));
  }
  const params = new URLSearchParams(queryString);
  return [...params.entries()].every(([key, value]) => route.query[key] === value);
}
const currentView = ref('login');   // 'login' | 'register' | 'forgot'
const loginForm = reactive({ identifier: '', password: '' });
const registerForm = reactive({ phone: '', verificationCode: '', nickname: '', password: '', confirmPassword: '', agreementAccepted: false });
const resetForm = reactive({ phone: '', verificationCode: '', password: '', confirmPassword: '' });
const authError = ref('');
const codeSending = ref(false);
const onboardingPromptDismissed = ref(false);
const onboardingSaving = ref(false);
const onboardingError = ref('');
const legalDocument = ref('');
const mobileNavOpen = ref(false);
const profileIncomplete = computed(() => ['pending', 'deferred'].includes(store.profile?.onboardingStatus));
const showOnboardingPrompt = computed(() => store.user?.role === 'student' && store.profile?.onboardingStatus === 'pending' && !onboardingPromptDismissed.value);

onMounted(async () => {
  await store.load();
  const audience = route.meta.audience;
  const isAdmin = adminRoleSet.has(store.user?.role);
  if (route.path === '/' && isAdmin) {
    await router.replace(landingPathForRole(store.user.role));
    return;
  }
  if ((audience === 'admin' && !isAdmin) || (audience === 'student' && isAdmin)) {
    await router.replace(landingPathForRole(store.user?.role));
  }
});
function showView(view) { currentView.value = view; authError.value = ''; }
function slideToLogin() { showView('login'); }
function slideToRegister() { showView('register'); }
function showForgotPassword() { showView('forgot'); }
function backToLogin() { showView('login'); }
function navBadge(item) { return item.to === '/health-profile' && profileIncomplete.value ? '待完善' : (item.badge || (item.featured ? 'NEW' : '')); }
function handleNavClick(navigate, event) {
  navigate(event);
  mobileNavOpen.value = false;
}

async function handleLogin() {
  authError.value = validateLoginForm(loginForm);
  if (authError.value) return;
  try {
    const user = await store.login(loginForm);
    onboardingPromptDismissed.value = false;
    await router.push(landingPathForRole(user?.role));
  } catch (error) {
    authError.value = error.message;
  }
}

async function sendCode(purpose) {
  const phone = purpose === 'register' ? registerForm.phone : resetForm.phone;
  if (!/^1[3-9]\d{9}$/.test(phone)) { authError.value = '请输入有效的中国大陆手机号。'; return; }
  codeSending.value = true;
  authError.value = '';
  try { await store.sendVerificationCode({ phone, purpose }); }
  catch (error) { authError.value = error.message; }
  finally { codeSending.value = false; }
}

async function handleRegister() {
  authError.value = validateRegisterForm(registerForm);
  if (authError.value) return;
  try {
    const payload = { phone: registerForm.phone, verificationCode: registerForm.verificationCode, password: registerForm.password, nickname: registerForm.nickname || undefined, agreementVersion: '2026-07' };
    await store.register(payload);
    onboardingPromptDismissed.value = false;
    await router.push('/');
  } catch (error) {
    authError.value = error.message;
  }
}

async function handleResetPassword() {
  authError.value = validateResetPasswordForm(resetForm);
  if (authError.value) return;
  try {
    await store.resetPassword({ phone: resetForm.phone, verificationCode: resetForm.verificationCode, newPassword: resetForm.password });
    Object.assign(loginForm, { identifier: resetForm.phone, password: '' });
    backToLogin();
  } catch (error) { authError.value = error.message; }
}

function openHealthProfile() {
  onboardingPromptDismissed.value = true;
  router.push('/health-profile');
}

async function deferOnboarding() {
  onboardingSaving.value = true;
  onboardingError.value = '';
  try { await store.deferProfileOnboarding(); onboardingPromptDismissed.value = true; }
  catch (error) { onboardingError.value = error.message; }
  finally { onboardingSaving.value = false; }
}
</script>

<style scoped>
.onboarding-backdrop { position:fixed; inset:0; z-index:50; display:grid; place-items:center; padding:20px; background:rgba(17,31,22,.48); }
.onboarding-dialog { width:min(100%,440px); border-radius:16px; background:#fff; padding:28px; box-shadow:0 26px 80px rgba(0,0,0,.22); }
.onboarding-dialog h2 { margin:6px 0 10px; font-size:24px; }
.onboarding-dialog>p:not(.eyebrow):not(.form-error) { color:var(--muted); line-height:1.65; }
.onboarding-actions { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:22px; }
.legal-dialog { max-height:min(680px,86vh); overflow:auto; }.legal-dialog .primary { width:100%; margin-top:14px; }
</style>
