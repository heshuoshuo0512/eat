<template>
  <!-- Student homepage -->
  <template v-if="!isAdmin">
    <div class="student-home">
    <section class="hero card student-hero">
      <div>
        <p class="eyebrow">校园智慧食堂</p>
        <h1>数据驱动选菜，吃得明白，又健康</h1>
        <p class="hero-copy">先说出这一餐想怎么吃，再从真实菜品、评分和校园口碑中找到答案。</p>
        <div class="hero-actions">
          <RouterLink class="primary button-link" to="/dishes">菜品检索</RouterLink>
          <RouterLink class="secondary button-link" to="/recommend">智能推荐</RouterLink>
        </div>
      </div>
      <div class="metric-grid compact">
        <article><strong>{{ store.canteens.length }}</strong><span>食堂</span></article>
        <article><strong>{{ store.stalls.length }}</strong><span>档口</span></article>
        <article><strong>{{ store.dishes.length }}</strong><span>菜品</span></article>
        <article><strong>{{ topDish?.computedRating?.toFixed(1) || '—' }}</strong><span>最高评分</span></article>
      </div>
    </section>

    <section class="card reveal-home" :class="`phase-${revealPhase}`" aria-label="逐张揭晓推荐">
      <div class="reveal-copy">
        <p class="eyebrow">逐张揭晓</p>
        <h2>{{ revealPhase === 'covered' ? '点一下图片，再看看答案' : '这张推荐适合你' }}</h2>
        <p v-if="contextSummary" class="muted">{{ contextSummary }}</p>
        <p v-else class="muted">推荐会根据健康档案、今日供应和个人记录自动更新。</p>
        <div class="reveal-controls">
          <button class="primary" type="button" :disabled="recLoading || !revealDish" @click="handleRevealAction">{{ revealPhase === 'covered' ? '揭晓这一张' : '看下一张' }}</button>
          <button class="ghost" type="button" :disabled="!revealDish" @click="resetReveal">重置</button>
          <span>{{ revealDish ? `第 ${revealIndex + 1} / ${recContext.ranked.length} 张` : '等待推荐' }}</span>
        </div>
      </div>
      <article v-if="revealDish" :key="revealDish.id" class="reveal-dish">
        <button class="reveal-media reveal-media-button" type="button" :aria-label="revealPhase === 'covered' ? '点击揭晓当前推荐菜品' : '点击查看下一张推荐'" @click="handleRevealAction">
          <img v-if="revealDish.imageUrl" :src="revealDish.imageUrl" :alt="revealPhase === 'covered' ? '' : revealDish.name" />
          <span v-else class="emoji large">{{ revealDish.image || '🍽️' }}</span>
          <span class="rank-badge">{{ revealIndex + 1 }}</span>
          <span v-if="revealPhase === 'covered'" class="reveal-cover"><strong>点击揭晓</strong><small>答案还藏在图片后面</small></span>
          <span v-else class="reveal-next-hint">再点一次看下一张</span>
        </button>
        <div v-if="revealPhase === 'revealed'" class="reveal-info">
          <strong>{{ revealDish.name }}</strong>
          <small>{{ dishStallLabel(revealDish) }}</small>
          <p>{{ formatWhy(revealDish.why) || '结合你的健康档案与当前供应排序。' }}</p>
          <div><span class="pill">{{ revealDish.nutrition?.calories || 0 }} kcal</span><span class="pill">¥{{ revealDish.price }}</span></div>
        </div>
        <div v-else class="reveal-placeholder" aria-hidden="true"><span></span><span></span><span></span></div>
        <RouterLink v-if="revealPhase === 'revealed'" class="primary button-link" :to="{ path: '/dishes', query: { dish: revealDish.id } }">查看菜品</RouterLink>
      </article>
      <div v-else class="reveal-empty"><p>{{ recLoading ? '正在加载推荐…' : '暂时没有推荐结果' }}</p><button v-if="!recLoading" class="secondary" type="button" @click="loadRecommendation">重新加载</button></div>
    </section>

    <StudentFeatureOrbit :items="studentFeatures" />

    <section class="health-profile-entry">
      <div><p class="eyebrow">健康档案</p><h2>低频设置，长期影响每一次推荐</h2><p>当前目标：{{ profileSummary }}</p></div>
      <RouterLink class="secondary button-link" to="/health-profile">管理档案</RouterLink>
    </section>
    </div>
  </template>

  <!-- Admin homepage -->
  <template v-else>
    <section class="hero card">
      <div>
        <p class="eyebrow">管理后台</p>
        <h1>食堂运营管理中心</h1>
        <p class="hero-copy">数据录入、评价审核、AI 智能体实验，一站式运营工具。</p>
      </div>
      <div class="metric-grid compact">
        <article>
          <strong>{{ store.canteens.length }}</strong>
          <span>食堂数</span>
        </article>
        <article>
          <strong>{{ store.stalls.length }}</strong>
          <span>档口数</span>
        </article>
        <article>
          <strong>{{ store.dishes.length }}</strong>
          <span>菜品总数</span>
        </article>
        <article>
          <strong>{{ store.adminReviewTotal }}</strong>
          <span>评价总数</span>
        </article>
      </div>
    </section>

    <section class="card">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">数据概览</p>
          <h2>运营核心指标</h2>
        </div>
        <button class="ghost" type="button" @click="refreshAdminMetrics">刷新</button>
      </div>
      <div class="metric-grid">
        <article>
          <strong>{{ store.adminAnalytics.dishes }}</strong>
          <span>活跃菜品</span>
        </article>
        <article>
          <strong>{{ store.adminAnalytics.menus }}</strong>
          <span>菜单总数</span>
        </article>
        <article>
          <strong>{{ store.adminAnalytics.todayPublished }}</strong>
          <span>今日已发布</span>
        </article>
        <article>
          <strong>{{ store.adminAnalytics.reviews }}</strong>
          <span>评价总数</span>
        </article>
        <article>
          <strong>{{ store.adminAnalytics.users }}</strong>
          <span>注册用户</span>
        </article>
        <article>
          <strong>{{ store.adminAnalytics.avgRating }}</strong>
          <span>平均评分</span>
        </article>
      </div>
      <div v-if="store.adminAnalytics.recentDishes?.length" class="table-wrap">
        <table>
          <thead><tr><th>最近新增菜品</th><th>档口</th><th>价格</th><th>热量</th></tr></thead>
          <tbody>
            <tr v-for="dish in store.adminAnalytics.recentDishes" :key="dish.id">
              <td>{{ dish.name }}</td>
              <td>{{ stallName(dish.stallId) }}</td>
              <td>¥{{ dish.price }}</td>
              <td>{{ dish.nutrition?.calories || 0 }} kcal</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <div class="section-title">
        <p class="eyebrow">数据完整度</p>
        <h2>数据资产健康度</h2>
      </div>
      <div class="metric-grid">
        <article>
          <strong>{{ dataCompleteness.canteens }}%</strong>
          <span>食堂信息</span>
        </article>
        <article>
          <strong>{{ dataCompleteness.stalls }}%</strong>
          <span>档口信息</span>
        </article>
        <article>
          <strong>{{ dataCompleteness.dishes }}%</strong>
          <span>菜品营养</span>
        </article>
        <article>
          <strong>{{ dataCompleteness.profiles }}%</strong>
          <span>用户画像</span>
        </article>
      </div>
      <p class="muted">基于已录入数据的完整度评估；食堂需要名称、位置、营业时间，菜品需要价格、营养和档口关联。</p>
    </section>

    <section v-if="aiReadiness" class="card">
      <div class="section-title">
        <p class="eyebrow">AI Readiness</p>
        <h2>AI 部署就绪度</h2>
      </div>
      <div class="metric-grid">
        <article>
          <strong>{{ aiReadiness.enabled ? '已启用' : '未启用' }}</strong>
          <span>AI 提供商</span>
        </article>
        <article>
          <strong>{{ aiReadiness.source || '无' }}</strong>
          <span>来源</span>
        </article>
        <article>
          <strong>{{ aiReadiness.chatModel || '—' }}</strong>
          <span>对话模型</span>
        </article>
        <article>
          <strong>{{ aiReadiness.embeddingModel || '—' }}</strong>
          <span>嵌入模型</span>
        </article>
      </div>
    </section>

    <section class="grid two-columns">
      <RouterLink class="card admin-card" to="/admin/input">
        <div class="admin-card-icon">📝</div>
        <h2>数据录入与维护</h2>
        <p>管理食堂、档口、菜品数据，CSV 批量导入，视觉拍照识别，今日菜单发布。</p>
      </RouterLink>

      <RouterLink class="card admin-card" to="/admin">
        <div class="admin-card-icon">⭐</div>
        <h2>评价管理</h2>
        <p>审核用户评价，批准/拒绝/删除，查看评价分析和数据资产。</p>
      </RouterLink>

      <RouterLink class="card admin-card" to="/agent">
        <div class="admin-card-icon">🤖</div>
        <h2>RAG 智能体实验室</h2>
        <p>基于真实菜品库的 RAG 检索增强生成，测试推荐迭代和运营建议。</p>
      </RouterLink>

      <RouterLink class="card admin-card" to="/admin/ai">
        <div class="admin-card-icon">⚙️</div>
        <h2>AI 配置</h2>
        <p>配置 AI 提供商、模型、密钥、测试连接、查看用量和部署就绪状态。</p>
      </RouterLink>
    </section>
  </template>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import StudentFeatureOrbit from '../components/StudentFeatureOrbit.vue';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();

const adminRoleSet = new Set(['operator', 'stall_admin', 'canteen_admin', 'auditor', 'finance', 'tenant_admin', 'admin', 'super_admin']);
const isAdmin = computed(() => store.user && adminRoleSet.has(store.user.role));

const topDish = computed(() => store.rankings.dishes[0]);

const recContext = computed(() => store.contextualRecommendation);
const recLoading = ref(false);
const aiReadiness = ref(null);
const revealIndex = ref(0);
const revealPhase = ref('covered');
const revealDish = computed(() => recContext.value.ranked[revealIndex.value] || recContext.value.ranked[0] || null);

const profileSummary = computed(() => {
  const profile = store.profile || {};
  const goals = { fatLoss: '减脂', muscleGain: '增肌', maintain: '均衡', healthy: '健康' };
  const meals = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };
  const parts = [goals[profile.goal] || '健康', meals[profile.mealType] || '午餐'];
  if (profile.budgetMax) parts.push(`¥${profile.budgetMax} 内`);
  if (profile.taste && profile.taste !== '不限') parts.push(profile.taste);
  return parts.join(' · ');
});

function featureImage(dishIndex, canteenIndex = 0) {
  return store.dishes[dishIndex]?.imageUrl || store.canteens[canteenIndex]?.imageUrl || '';
}

const studentFeatures = computed(() => [
  { id: 'dishes', to: '/dishes', eyebrow: '智能吃饭', label: '菜品检索', description: '从真实菜品中按综合评分挑选', imageUrl: featureImage(0), icon: '检' },
  { id: 'recommend', to: '/recommend', eyebrow: '智能吃饭', label: '智能推荐', description: '结合健康档案和今日供应生成建议', imageUrl: featureImage(1), icon: '荐' },
  { id: 'canteens', to: '/canteens', eyebrow: '更多探索', label: '食堂导航', description: '快速找到食堂、楼层与档口', imageUrl: featureImage(2, 0), icon: '导' },
  { id: 'rankings', to: '/rankings', eyebrow: '更多探索', label: '排行榜', description: '查看校园真实评分与热度', imageUrl: featureImage(3), icon: '榜' },
  { id: 'regions', to: '/regions', eyebrow: '更多探索', label: '区域推荐', description: '按风味区域发现下一餐', imageUrl: featureImage(4), icon: '味' },
  { id: 'reviews', to: '/reviews', eyebrow: '校园互动', label: '菜品评价', description: '汇总各食堂审核通过的评价', imageUrl: featureImage(5), icon: '评' },
  { id: 'community', to: '/community', eyebrow: '校园互动', label: '校园帖子', description: '分享菜品体验与校园口碑', imageUrl: featureImage(6), icon: '帖' },
  { id: 'saved', to: '/saved', eyebrow: '个人记录', label: '收藏与吃过', description: '把喜欢和吃过的菜统一收好', imageUrl: featureImage(7), icon: '藏' },
  { id: 'orders', to: '/orders', eyebrow: '今日菜单', label: '今日点餐', description: '浏览菜单、购物车和历史取餐码', imageUrl: featureImage(8), icon: '餐', badge: '待开发 · 可预览' }
]);

const contextSummary = computed(() => {
  const ctx = recContext.value.context;
  if (!ctx || typeof ctx !== 'object') return typeof ctx === 'string' ? ctx : '';
  const parts = [];
  if (ctx.timeOfDay) {
    const timeMap = { breakfast: '当前早餐', lunch: '当前午餐', dinner: '当前晚餐' };
    parts.push(timeMap[ctx.timeOfDay] || ctx.timeOfDay);
  }
  if (ctx.environment) {
    const env = ctx.environment;
    const temp = env.temperature ?? 25;
    const weather = env.weatherLabel || '晴';
    parts.push(`${temp}°C ${weather}`);
  }
  const prof = ctx.profile;
  if (prof) {
    if (prof.preferLowCrowd) parts.push('低拥挤偏好');
    if (prof.halalOnly) parts.push('清真限定');
    if (prof.dietaryPattern && prof.dietaryPattern !== 'regular') {
      const dietMap = { vegetarian: '素食', vegan: '纯素', lowCarb: '低碳水' };
      parts.push(dietMap[prof.dietaryPattern] || prof.dietaryPattern);
    }
  }
  return parts.length ? parts.join(' · ') : '';
});

function formatWhy(why) {
  if (!why) return '';
  if (typeof why === 'string') return why;
  if (!Array.isArray(why) || !why.length) return '';
  return why.slice(0, 2).join(' · ');
}

function mealTypeLabel(mt) {
  return { lunch: '午餐', dinner: '晚餐', breakfast: '早餐' }[mt] || mt || '';
}

const dataCompleteness = computed(() => {
  const canteens = store.canteens;
  const stalls = store.stalls;
  const dishes = store.dishes;
  const canteenScore = canteens.length ? Math.round(canteens.filter(c => c.name && c.location && c.hours).length / canteens.length * 100) : 0;
  const stallScore = stalls.length ? Math.round(stalls.filter(s => s.name && s.canteenId).length / stalls.length * 100) : 0;
  const dishScore = dishes.length ? Math.round(dishes.filter(d => d.name && d.price && d.nutrition?.calories && d.stallId).length / dishes.length * 100) : 0;
  const profileScore = store.adminAnalytics.users ? Math.min(100, Math.round((store.adminAnalytics.users > 0 ? 60 : 0) + (store.adminAnalytics.reviews > 0 ? 40 : 0))) : 0;
  return { canteens: canteenScore, stalls: stallScore, dishes: dishScore, profiles: profileScore };
});

function dishStallLabel(dish) {
  const stall = store.stalls.find(s => s.id === dish.stallId);
  if (!stall) return '';
  const canteen = store.canteens.find(c => c.id === stall.canteenId);
  return canteen ? `${stall.name} · ${canteen.name}` : stall.name;
}

function stallName(id) {
  return store.stalls.find((stall) => stall.id === id)?.name || '未绑定';
}

async function loadRecommendation() {
  recLoading.value = true;
  try {
    await store.fetchRecommendation();
    revealIndex.value = 0;
    revealPhase.value = 'covered';
  } finally {
    recLoading.value = false;
  }
}

async function advanceReveal() {
  const dishes = recContext.value.ranked;
  if (!dishes.length) return;
  revealIndex.value = (revealIndex.value + 1) % dishes.length;
  revealPhase.value = 'covered';
}

async function handleRevealAction() {
  if (!revealDish.value) return;
  if (revealPhase.value === 'covered') {
    revealPhase.value = 'revealed';
    try { await store.recordDishDrawn(revealDish.value.id); } catch { /* recommendation remains usable */ }
    return;
  }
  await advanceReveal();
}

function resetReveal() {
  revealIndex.value = 0;
  revealPhase.value = 'covered';
}

async function refreshAdminMetrics() {
  try {
    await Promise.all([
      store.loadAnalytics(),
      store.loadReviewsAdmin(50, 0)
    ]);
  } catch { /* silent */ }
}

onMounted(async () => {
  if (isAdmin.value) {
    await refreshAdminMetrics();
    try {
      const result = await store.loadDeploymentReadiness();
      aiReadiness.value = result;
    } catch { /* silent */ }
  } else {
    await loadRecommendation();
  }
});
</script>

<style scoped>
.student-home { min-width: 0; width: 100%; max-width: 100%; overflow-x: hidden; }
.dish-thumb {
  width: 80px;
  height: 80px;
  object-fit: cover;
  border-radius: 8px;
}

.dish-thumb-sm {
  width: 36px;
  height: 36px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
}

.quick-links {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.reveal-home {
  display: grid;
  grid-template-columns: minmax(240px, .85fr) minmax(420px, 1.55fr);
  gap: 24px;
  align-items: center;
  overflow: hidden;
  background: linear-gradient(120deg, #ffffff 0 52%, #eef7ea 52% 100%);
}
.student-hero, .student-hero > *, .reveal-home, .reveal-home > *, .health-profile-entry { min-width: 0; max-width: 100%; }

.reveal-copy { display: grid; gap: 8px; }
.reveal-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
.reveal-controls span { color: var(--muted); font-size: 12px; }
.reveal-dish { display: grid; grid-template-columns: 176px minmax(0, 1fr) auto; align-items: center; gap: 18px; animation: reveal-in .38s ease both; }
.reveal-media { position: relative; width: 176px; aspect-ratio: 1; overflow: hidden; border-radius: 8px; background: #dfeeda; display: grid; place-items: center; }
.reveal-media-button { min-height: 0; padding: 0; border: 0; color: #fff; cursor: pointer; box-shadow: 0 14px 30px rgba(20,53,36,.18); transform-style: preserve-3d; transition: transform .48s cubic-bezier(.22,.8,.24,1), box-shadow .25s ease; }
.phase-covered .reveal-media-button:hover { transform: translateY(-4px) rotateY(-5deg); box-shadow: 0 20px 38px rgba(20,53,36,.24); }
.phase-revealed .reveal-media-button { transform: rotateY(360deg); }
.reveal-media img { width: 100%; height: 100%; object-fit: cover; transition: transform .45s ease, filter .3s ease; }
.phase-covered .reveal-media img { transform: scale(1.06); filter: saturate(.7) brightness(.72); }
.reveal-media .rank-badge { position: absolute; left: 10px; top: 10px; }
.reveal-cover { position: absolute; inset: 0; display: grid; place-content: center; gap: 6px; padding: 18px; text-align: center; background: linear-gradient(180deg, rgba(18,50,32,.18), rgba(18,50,32,.78)); }
.reveal-cover strong { font-size: 20px; }.reveal-cover small { opacity: .8; }
.reveal-next-hint { position: absolute; right: 9px; bottom: 9px; padding: 5px 8px; border-radius: 999px; background: rgba(12,31,20,.72); font-size: 11px; }
.reveal-info { display: grid; gap: 7px; min-width: 0; }
.reveal-info > strong { font-size: 22px; }.reveal-info p { margin: 0; color: var(--muted); line-height: 1.55; }.reveal-info > div { display: flex; gap: 7px; flex-wrap: wrap; }
.reveal-placeholder { display: grid; gap: 10px; min-width: 0; }.reveal-placeholder span { display: block; height: 11px; border-radius: 6px; background: linear-gradient(90deg, #e5eee1, #f4f8f2, #e5eee1); background-size: 200% 100%; animation: placeholder-flow 1.8s ease infinite; }.reveal-placeholder span:nth-child(2) { width: 78%; }.reveal-placeholder span:nth-child(3) { width: 52%; }
.reveal-empty { min-height: 156px; display: grid; place-items: center; align-content: center; gap: 8px; }

.health-profile-entry { margin-top: 34px; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 20px 22px; border-top: 1px solid rgba(31,122,77,.16); border-bottom: 1px solid rgba(31,122,77,.16); background: rgba(249,252,248,.7); }
.health-profile-entry h2 { margin: 0; font-size: 18px; }.health-profile-entry p:last-child { margin: 6px 0 0; color: var(--muted); }

.student-dashboard-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.dashboard-module { min-height: 330px; display: flex; flex-direction: column; }
.module-list { display: grid; gap: 9px; }
.module-row { display: grid; grid-template-columns: 48px minmax(0, 1fr); align-items: center; gap: 10px; padding: 9px; border-radius: 7px; color: inherit; text-decoration: none; border: 1px solid transparent; transition: transform .2s ease, background .2s ease, border-color .2s ease; }
.module-row:hover { transform: translateX(3px); background: #f4f9f1; border-color: rgba(31, 122, 77, .12); }
.module-row img, .module-row > .emoji { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; display: grid; place-items: center; background: #edf6e9; }
.module-row > span:nth-child(2) { display: grid; gap: 3px; min-width: 0; }.module-row strong, .module-row small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rank-row { grid-template-columns: 30px minmax(0, 1fr) auto; }.rank-row .rank-badge { width: 28px; height: 28px; }
.quick-links-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
.quick-links-grid a { min-height: 92px; display: grid; place-items: center; align-content: center; gap: 7px; border: 1px solid rgba(31, 122, 77, .13); border-radius: 7px; color: inherit; text-decoration: none; background: #fafcf9; transition: transform .2s ease, background .2s ease; }
.quick-links-grid a:hover { transform: translateY(-2px); background: #eff7eb; }.quick-links-grid span { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; background: var(--primary); color: #fff; font-weight: 800; }

@keyframes reveal-in { from { opacity: 0; transform: translateX(14px) rotate(.3deg); } to { opacity: 1; transform: translateX(0) rotate(0); } }
@keyframes placeholder-flow { to { background-position: -200% 0; } }

.region-preview { display: grid; gap: 1rem; }

.region-preview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: .875rem;
}

.region-preview-card {
  display: grid;
  grid-template-columns: 4.25rem minmax(0, 1fr);
  align-items: center;
  gap: .75rem;
  min-width: 0;
  padding: .75rem;
  border: 1px solid rgba(255,255,255,.72);
  border-radius: 1.125rem;
  background: linear-gradient(135deg, rgba(255,255,255,.78), rgba(244,250,239,.7));
  color: inherit;
  text-decoration: none;
  box-shadow: var(--shadow-soft);
  transition: transform .22s var(--ease), box-shadow .22s var(--ease), border-color .22s var(--ease);
}

.region-preview-card:hover {
  transform: translateY(-2px);
  border-color: rgba(31,122,77,.16);
  box-shadow: var(--shadow-hover);
}

.region-preview-card img,
.region-preview-card > .emoji {
  display: grid;
  place-items: center;
  width: 4.25rem;
  height: 4.25rem;
  object-fit: cover;
  border-radius: .875rem;
  background: rgba(235,247,229,.72);
}

.region-preview-card span:last-child { display: grid; gap: .25rem; min-width: 0; }
.region-preview-card strong, .region-preview-card small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.region-preview-card small { color: var(--muted); font-size: .75rem; }

.quick-link-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--bg-secondary, #f5f5f5);
  text-decoration: none;
  color: inherit;
  transition: background 0.2s;
}

.quick-link-item:hover {
  background: var(--bg-hover, #e8e8e8);
}

.quick-link-item .emoji {
  font-size: 1.5rem;
}

.admin-card {
  display: flex;
  flex-direction: column;
  text-decoration: none;
  color: inherit;
  transition: transform 0.2s, box-shadow 0.2s;
}

.admin-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.admin-card-icon {
  font-size: 2rem;
  margin-bottom: 8px;
}

.admin-card h2 {
  margin: 0 0 8px;
  font-size: 1.1rem;
}

.admin-card p {
  margin: 0;
  color: var(--text-secondary, #666);
  font-size: 0.9rem;
}

.rank-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--primary, #4f46e5);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.rec-reason {
  color: var(--primary, #4f46e5);
  font-style: italic;
}

@media (max-width: 1020px) {
  .region-preview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .reveal-home { grid-template-columns: 1fr; background: #fff; }
  .reveal-dish { background: #eef7ea; padding: 14px; border-radius: 8px; }
}

@media (max-width: 560px) {
  .student-dashboard-grid { grid-template-columns: 1fr; }
  .dashboard-module { min-height: auto; }
  .reveal-home { padding: 18px; }
  .student-hero { grid-template-columns: minmax(0, 1fr); }
  .student-hero .metric-grid { width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .reveal-dish { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .reveal-media { width: 100%; aspect-ratio: 16 / 9; }
  .reveal-placeholder { display: none; }
  .reveal-dish .button-link { grid-column: 1; width: 100%; justify-content: center; }
  .reveal-controls button { flex: 1; }
  .health-profile-entry { align-items: stretch; flex-direction: column; margin-top: 26px; padding: 18px 4px; }
  .health-profile-entry .button-link { width: 100%; justify-content: center; }
  .region-preview { gap: .75rem; }
  .region-preview-grid { grid-template-columns: 1fr; gap: .75rem; }
  .region-preview-card {
    grid-template-columns: 5rem minmax(0, 1fr);
    gap: .875rem;
    min-height: 6.25rem;
    padding: .625rem;
    border-radius: 1rem;
  }
  .region-preview-card img,
  .region-preview-card > .emoji {
    width: 5rem;
    height: 5rem;
    border-radius: .75rem;
  }
  .region-preview-card:active { transform: scale(.985); }
}

@media (max-width: 360px) {
  .region-preview-card { grid-template-columns: 4.5rem minmax(0, 1fr); min-height: 5.75rem; }
  .region-preview-card img,
  .region-preview-card > .emoji { width: 4.5rem; height: 4.5rem; }
}

@media (prefers-reduced-motion: reduce) {
  .reveal-dish { animation: none; }
  .reveal-media-button, .reveal-media img, .reveal-placeholder span { transition: none; animation: none; }
  .phase-revealed .reveal-media-button, .phase-covered .reveal-media-button:hover { transform: none; }
  .module-row, .quick-links-grid a { transition: none; }
}
</style>
