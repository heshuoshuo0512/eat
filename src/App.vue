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
      <p class="hero-copy">学生获取健康推荐、排行榜和智能顾问；管理员进入数据管理、上传、批量导入和审计后台。</p>
      <div class="metric-grid login-metrics">
        <article><strong>RBAC</strong><span>角色权限管控</span></article>
        <article><strong>RAG</strong><span>真实菜品检索</span></article>
        <article><strong>DB</strong><span>数据库持久化</span></article>
        <article><strong>API</strong><span>OpenAPI 合同</span></article>
      </div>
    </section>

    <section class="login-panel card">
      <div class="section-title">
        <p class="eyebrow">Login</p>
        <h2>选择身份进入主页</h2>
      </div>
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
        <RouterLink v-for="item in visibleNavItems" :key="navKey(item)" :to="item.to" custom v-slot="{ href, navigate }">
          <a :href="href" :class="{ active: isNavActive(item) }" @click="handleNavClick(navigate, $event)"><span>{{ item.label }}</span><span v-if="item.featured" class="nav-badge">NEW</span></a>
        </RouterLink>
      </nav>
      <section class="session-card compact">
        <p class="eyebrow">当前身份</p>
        <strong>{{ store.user.nickname }}</strong>
        <small>{{ store.user.role === 'admin' ? '管理员端已解锁' : '学生端体验' }}</small>
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
import { validateLoginForm } from './domain/validation.js';
import { useCanteenStore } from './stores/canteenStore.js';

const store = useCanteenStore();
const route = useRoute();
const router = useRouter();
const roleFeatures = {
  student: new Set(['student']),
  operator: new Set(['student', 'orders_console', 'order_analytics', 'data_input', 'data_manage']),
  stall_admin: new Set(['student', 'orders_console', 'order_analytics', 'data_input', 'data_manage']),
  canteen_admin: new Set(['student', 'orders_console', 'order_analytics', 'data_input', 'data_manage']),
  auditor: new Set(['student', 'order_analytics', 'data_manage']),
  finance: new Set(['student', 'order_analytics', 'data_manage']),
  tenant_admin: new Set(['student', 'orders_console', 'order_analytics', 'data_input', 'data_manage', 'ai_config']),
  admin: new Set(['student', 'orders_console', 'order_analytics', 'data_input', 'data_manage', 'ai_config']),
  super_admin: new Set(['student', 'orders_console', 'order_analytics', 'data_input', 'data_manage', 'ai_config'])
};
const navItems = [
  { to: '/', label: '运营首页' },
  { to: '/canteens', label: '食堂导航' },
  { to: '/dishes', label: '菜品检索' },
  { to: '/rankings', label: '排行榜' },
  { to: '/recommend', label: '健康推荐' },
  { to: '/agent', label: '智能顾问' },
  { to: '/visual-meal', label: '拍照识餐', featured: true },
  { to: '/orders', label: '点餐取餐', featured: true },
  { to: '/stall-console', label: '档口工作台', feature: 'orders_console' },
  { to: '/order-analytics', label: '营业看板', feature: 'order_analytics' },
  { to: '/admin/input', label: '数据录入', feature: 'data_input' },
  { to: '/admin', label: '数据管理', feature: 'data_manage' },
  { to: '/admin/ai', label: 'AI 配置', feature: 'ai_config' }
];
const visibleNavItems = computed(() => {
  const features = roleFeatures[store.user?.role] || roleFeatures.student;
  return navItems.filter((item) => !item.feature || features.has(item.feature));
});

function navKey(item) {
  return item.to;
}

function isNavActive(item) {
  return route.path === item.to;
}
const demoAccounts = {
  student: { username: '演示学生', password: 'student123', role: 'student' },
  admin: { username: 'admin', password: 'admin123', role: 'admin' }
};
const loginForm = reactive({ ...demoAccounts.student });
const loginError = ref('');
const mobileNavOpen = ref(false);

onMounted(() => {
  store.load();
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
</script>
