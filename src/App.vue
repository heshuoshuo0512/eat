<template>
  <a class="skip-link" href="#main-content">跳到主要内容</a>
  <div v-if="!store.user" class="login-landing">
    <section class="login-hero card">
      <RouterLink class="brand" to="/">
        <span class="brand-mark">食</span>
        <span>
          <strong>智慧食堂</strong>
          <small>Enterprise MVP</small>
        </span>
      </RouterLink>
      <p class="eyebrow">Smart Canteen Platform</p>
      <h1>先登录，再进入个性化食堂主页</h1>
      <p class="hero-copy">学生获取食堂导航、排行榜和健康推荐；管理员进入数据录入、评价管理、智能体实验和运营后台。</p>
      <div class="metric-grid login-metrics">
        <article><strong>RBAC</strong><span>角色权限管控</span></article>
        <article><strong>RAG</strong><span>真实菜品检索</span></article>
        <article><strong>DB</strong><span>数据库持久化</span></article>
        <article><strong>API</strong><span>OpenAPI 合同</span></article>
      </div>
    </section>

    <section class="login-panel card">
      <div class="section-title">
        <p class="eyebrow">{{ authMode === 'login' ? 'Login' : 'Register' }}</p>
        <h2>{{ authMode === 'login' ? '选择身份进入主页' : '注册新账号' }}</h2>
      </div>
      <div class="auth-mode-tabs" role="tablist" aria-label="认证模式">
        <button :class="['ghost', { active: authMode === 'login' }]" type="button" role="tab" :aria-selected="authMode === 'login'" @click="switchAuthMode('login')">登录</button>
        <button :class="['ghost', { active: authMode === 'register' }]" type="button" role="tab" :aria-selected="authMode === 'register'" @click="switchAuthMode('register')">注册</button>
      </div>

      <template v-if="authMode === 'login'">
        <div class="role-tabs" role="tablist" aria-label="登录身份">
          <button :class="['ghost', { active: loginForm.role === 'student' }]" type="button" @click="selectRole('student')">学生端</button>
          <button :class="['ghost', { active: loginForm.role === 'admin' }]" type="button" @click="selectRole('admin')">管理员端</button>
        </div>
        <form class="login-form" @submit.prevent="handleLogin">
          <label>用户名<input v-model.trim="loginForm.username" aria-label="用户名" autocomplete="username" placeholder="输入用户名" /></label>
          <label>密码<input v-model="loginForm.password" aria-label="密码" autocomplete="current-password" type="password" placeholder="输入密码" /></label>
          <button class="primary" type="submit" :disabled="store.loading">{{ store.loading ? '登录中...' : '进入系统' }}</button>
          <p v-if="loginError || store.error" class="form-message danger">{{ loginError || store.error }}</p>
        </form>
        <div class="demo-accounts">
          <button class="secondary" type="button" @click="useDemo('student')">使用学生演示账号</button>
          <button class="secondary" type="button" @click="useDemo('admin')">使用管理员演示账号</button>
        </div>
      </template>

      <template v-else>
        <form class="login-form" @submit.prevent="handleRegister">
          <label>用户名<input v-model.trim="registerForm.username" aria-label="用户名" autocomplete="username" placeholder="2-32 个字符" /></label>
          <label>昵称 <small class="field-hint">（选填）</small><input v-model.trim="registerForm.nickname" aria-label="昵称" autocomplete="nickname" placeholder="选填，默认同用户名" /></label>
          <label>密码<input v-model="registerForm.password" aria-label="密码" autocomplete="new-password" type="password" placeholder="至少 6 个字符" /></label>
          <label>确认密码<input v-model="registerForm.confirmPassword" aria-label="确认密码" autocomplete="new-password" type="password" placeholder="再次输入密码" /></label>
          <button class="primary" type="submit" :disabled="store.loading">{{ store.loading ? '注册中...' : '注册并进入' }}</button>
          <p v-if="registerError" class="form-message danger">{{ registerError }}</p>
        </form>
      </template>
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
      <section class="session-card compact">
        <p class="eyebrow">当前身份</p>
        <strong>{{ store.user.nickname }}</strong>
        <small>{{ isAdminFamily ? '管理员端已解锁' : '学生端体验' }}</small>
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
  { to: '/recommend', label: '健康推荐', feature: 'student', group: '健康与计划' },
  { to: '/recommend?panel=favorites', label: '收藏与吃过', feature: 'student', group: '个人记录' },
  { to: '/admin?panel=reviews', label: '评价管理', feature: 'reviews', group: '评价中心' },
  { to: '/admin?panel=data', label: '数据中心', feature: 'data_manage', group: '数据中心' },
  { to: '/admin/input?panel=data', label: '数据录入', feature: 'data_input', group: '数据中心' },
  { to: '/admin/environment', label: '校园环境展览', feature: 'environment', group: '校园环境' },
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
  if (!queryString) return route.path === path || (path !== '/' && route.path.startsWith(`${path}/`));
  const params = new URLSearchParams(queryString);
  return [...params.entries()].every(([key, value]) => route.query[key] === value);
}
const demoAccounts = {
  student: { username: '演示学生', password: 'student123', role: 'student' },
  admin: { username: 'admin', password: 'admin123', role: 'admin' }
};
const loginForm = reactive({ ...demoAccounts.student });
const loginError = ref('');
const authMode = ref('login');
const registerForm = reactive({ username: '', nickname: '', password: '', confirmPassword: '' });
const registerError = ref('');
const mobileNavOpen = ref(false);

onMounted(async () => {
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

function switchAuthMode(mode) {
  authMode.value = mode;
  loginError.value = '';
  registerError.value = '';
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
