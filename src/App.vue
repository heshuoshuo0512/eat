<template>
  <a class="skip-link" href="#main-content">跳到主要内容</a>
  <div v-if="!store.user && !previewMode" class="login-landing">
    <section class="login-hero">
      <RouterLink class="brand" to="/">
        <span class="brand-mark">食</span>
        <span>
          <strong>智慧食堂</strong>
          <small>Enterprise MVP</small>
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

    <section class="login-panel">
      <!-- 左侧提示 -->
      <div class="con-box left">
        <span class="con-icon">🍽️</span>
        <h2>欢迎来到<span>智慧食堂</span></h2>
        <p>已有<span>账号</span>？</p>
        <button @click="slideToLogin">去登录</button>
      </div>

      <!-- 右侧提示 -->
      <div class="con-box right">
        <span class="con-icon">🥗</span>
        <h2>欢迎来到<span>智慧食堂</span></h2>
        <p>还没有<span>账号</span>？</p>
        <button @click="slideToRegister">去注册</button>
      </div>

      <!-- 滑动表单 -->
      <div :class="['form-box', { 'slide-register': !isLogin }]">
        <!-- 登录 -->
        <form :class="['login-form-content', { hidden: !isLogin }]" @submit.prevent="handleLogin">
          <h1>login</h1>
          <p class="form-subtitle">选择身份进入系统</p>
          <div class="role-tabs">
            <button :class="{ active: loginForm.role === 'student' }" type="button" @click="selectRole('student')">🎓 学生端</button>
            <button :class="{ active: loginForm.role === 'admin' }" type="button" @click="selectRole('admin')">⚙️ 管理员端</button>
          </div>
          <div class="input-group">
            <input v-model.trim="loginForm.username" placeholder="用户名" autocomplete="username">
            <input v-model="loginForm.password" type="password" placeholder="密码" autocomplete="current-password">
          </div>
          <p v-if="loginError || store.error" class="form-error">{{ loginError || store.error }}</p>
          <button class="submit-btn" type="submit" :disabled="store.loading">{{ store.loading ? '登录中...' : '进入系统' }}</button>
        </form>

        <!-- 注册 -->
        <form :class="['register-form-content', { hidden: isLogin }]" @submit.prevent="handleRegister">
          <h1>register</h1>
          <p class="form-subtitle">创建新账号进入系统</p>
          <div class="input-group">
            <input v-model.trim="registerForm.username" placeholder="用户名" autocomplete="username">
            <input v-model="registerForm.password" type="password" placeholder="密码" autocomplete="new-password">
            <input v-model="registerForm.confirmPassword" type="password" placeholder="确认密码" autocomplete="new-password">
          </div>
          <p v-if="registerError" class="form-error">{{ registerError }}</p>
          <button class="submit-btn" type="submit" :disabled="store.loading">{{ store.loading ? '注册中...' : '注册并进入' }}</button>
        </form>
      </div>
    </section>
  </div>

  <div v-else class="shell">
    <button class="mobile-nav-toggle" type="button" :aria-expanded="mobileNavOpen" aria-controls="app-sidebar" @click="mobileNavOpen = !mobileNavOpen">{{ mobileNavOpen ? '收起导航' : '打开导航' }}</button>
    <aside id="app-sidebar" :class="['sidebar', { open: mobileNavOpen }]">
      <RouterLink class="brand" to="/" @click="mobileNavOpen = false">
        <span class="brand-mark">食</span>
        <span>
          <strong>智慧食堂</strong>
          <small>Enterprise MVP</small>
        </span>
      </RouterLink>
      <nav class="nav-list" aria-label="主导航">
        <template v-for="group in visibleNavGroups" :key="group.label">
          <p class="nav-section-label">{{ group.label }}</p>
          <RouterLink v-for="item in group.items" :key="navKey(item)" :to="item.to" custom v-slot="{ href, navigate }">
            <a :href="href" :class="{ active: isNavActive(item) }" @click="handleNavClick(navigate, $event)"><span>{{ item.label }}</span><span v-if="item.featured" class="nav-badge">NEW</span></a>
          </RouterLink>
        </template>
      </nav>
      <section v-if="store.user" class="session-card compact">
        <p class="eyebrow">当前身份</p>
        <strong>{{ store.user.nickname }}</strong>
        <small>{{ previewMode ? '区域推荐预览模式' : (isAdminFamily ? '管理员端已解锁' : '学生端体验') }}</small>
        <button class="ghost" type="button" @click="store.logout">退出登录</button>
      </section>
    </aside>

    <main id="main-content" class="main-panel" tabindex="-1">
      <RouterView />
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { validateLoginForm, validateRegisterForm } from './domain/validation.js';
import { useCanteenStore } from './stores/canteenStore.js';

const store = useCanteenStore();
const route = useRoute();
const router = useRouter();
const previewMode = computed(() => route.query.preview === '1' || route.query.preview === 'regions');
const adminRoleSet = new Set(['operator', 'stall_admin', 'canteen_admin', 'auditor', 'finance', 'tenant_admin', 'admin', 'super_admin']);
const roleFeatures = {
  student: new Set(['student']),
  operator: new Set(['data_input', 'agent']),
  stall_admin: new Set(['data_input', 'agent']),
  canteen_admin: new Set(['data_input', 'data_manage', 'reviews', 'environment', 'agent']),
  auditor: new Set(['data_manage', 'agent']),
  finance: new Set(['agent']),
  tenant_admin: new Set(['data_input', 'data_manage', 'reviews', 'environment', 'ai_config', 'agent']),
  admin: new Set(['data_input', 'data_manage', 'reviews', 'environment', 'ai_config', 'agent']),
  super_admin: new Set(['data_input', 'data_manage', 'reviews', 'environment', 'ai_config', 'agent'])
};
const navItems = [
  { to: '/', label: '学生首页', feature: 'student', group: '发现与点餐' },
  { to: '/orders', label: '今日点餐', feature: 'student', group: '发现与点餐' },
  { to: '/canteens', label: '食堂导航', feature: 'student', group: '发现与点餐' },
  { to: '/dishes', label: '菜品检索', feature: 'student', group: '发现与点餐' },
  { to: '/rankings', label: '排行榜', feature: 'student', group: '发现与点餐' },
  { to: '/regions', label: '区域推荐', feature: 'student', group: '发现与点餐' },
  { to: '/recommend', label: '健康推荐', feature: 'student', group: '健康与计划' },
  { to: '/recommend?panel=favorites', label: '收藏与吃过', feature: 'student', group: '个人记录' },
  { to: '/admin?panel=reviews', label: '评价管理', feature: 'reviews', group: '数据中心' },
  { to: '/admin?panel=data', label: '数据管理', feature: 'data_manage', group: '数据中心' },
  { to: '/admin/input', label: '数据录入', feature: 'data_input', group: '数据中心' },
  { to: '/agent', label: '智能体实验室', feature: 'agent', group: '智能与配置' },
  { to: '/admin/ai', label: 'AI 配置（含租户管理）', feature: 'ai_config', group: '智能与配置' }
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
function navKey(item) { return `${item.group}-${item.feature}-${item.to}`; }
function isNavActive(item) {
  const [path, queryString] = item.to.split('?');
  if (route.path !== path && !(path !== '/' && route.path.startsWith(`${path}/`))) return false;
  if (!queryString) {
    if (item.to === '/recommend') return route.path === path && route.query.panel !== 'favorites';
    return route.path === path || (path !== '/' && route.path.startsWith(`${path}/`));
  }
  const params = new URLSearchParams(queryString);
  return [...params.entries()].every(([key, value]) => route.query[key] === value);
}
const demoAccounts = {
  student: { username: '演示学生', password: 'student123', role: 'student' },
  admin: { username: 'admin', password: 'admin123', role: 'admin' }
};
const loginForm = reactive({ ...demoAccounts.student });
const loginError = ref('');
const isLogin = ref(true);
const registerForm = reactive({ username: '', nickname: '', password: '', confirmPassword: '' });
const registerError = ref('');
const mobileNavOpen = ref(false);

onMounted(async () => {
  if (previewMode.value) {
    store.loadPreviewState();
    return;
  }
  await store.load();
  const audience = route.meta.audience;
  const isAdmin = adminRoleSet.has(store.user?.role);
  if ((audience === 'admin' && !isAdmin) || (audience === 'student' && isAdmin)) {
    await router.replace('/');
  }
});
function selectRole(role) {
  Object.assign(loginForm, demoAccounts[role]);
  loginError.value = '';
}

function useDemo(role) {
  Object.assign(loginForm, demoAccounts[role]);
  loginError.value = '';
}
function handleNavClick(navigate, event) {
  navigate(event);
  mobileNavOpen.value = false;
}

async function handleLogin() {
  loginError.value = validateLoginForm(loginForm);
  if (loginError.value) return;
  try {
    await store.login(loginForm);
    await router.push('/');
  } catch (error) {
    loginError.value = error.message;
  }
}

function slideToRegister() {
  if (!isLogin.value) return;
  isLogin.value = false;
  loginError.value = '';
  registerError.value = '';
  registerForm.username = '';
  registerForm.password = '';
  registerForm.confirmPassword = '';
}

function slideToLogin() {
  if (isLogin.value) return;
  isLogin.value = true;
  loginError.value = '';
  registerError.value = '';
  const role = loginForm.role || 'student';
  loginForm.username = demoAccounts[role].username;
  loginForm.password = demoAccounts[role].password;
}

async function handleRegister() {
  registerError.value = validateRegisterForm(registerForm);
  if (registerError.value) return;
  try {
    const payload = { username: registerForm.username, password: registerForm.password };
    if (registerForm.nickname.trim()) payload.nickname = registerForm.nickname.trim();
    await store.register(payload);
    await router.push('/');
  } catch (error) {
    registerError.value = error.message;
  }
}
</script>
