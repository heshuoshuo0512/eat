<template>
  <!-- Student homepage -->
  <template v-if="!isAdmin">
    <section class="hero card">
      <div>
        <p class="eyebrow">校园智慧食堂</p>
        <h1>数据驱动选餐，吃得明白又健康</h1>
        <p class="hero-copy">今日点餐、热门排行、个性化推荐，一站搞定你的每一餐。</p>
        <div class="hero-actions">
          <RouterLink class="primary button-link" to="/orders">今日点餐</RouterLink>
          <RouterLink class="secondary button-link" to="/dishes">检索菜品</RouterLink>
        </div>
      </div>
      <div class="metric-grid compact">
        <article>
          <strong>{{ store.canteens.length }}</strong>
          <span>食堂</span>
        </article>
        <article>
          <strong>{{ store.stalls.length }}</strong>
          <span>档口</span>
        </article>
        <article>
          <strong>{{ store.dishes.length }}</strong>
          <span>菜品</span>
        </article>
        <article>
          <strong>{{ topDish?.computedRating?.toFixed(1) || '—' }}</strong>
          <span>最高评分</span>
        </article>
      </div>
    </section>

    <section class="card">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">热门排行</p>
          <h2>综合评分榜 Top 4</h2>
        </div>
        <RouterLink class="text-link" to="/rankings">查看完整排行榜</RouterLink>
      </div>
      <div class="cards-grid">
        <article v-for="dish in store.rankings.dishes.slice(0, 4)" :key="dish.id" class="mini-card">
          <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="dish.name" class="dish-thumb" />
          <span v-else class="emoji large">{{ dish.image }}</span>
          <strong>{{ dish.name }}</strong>
          <small>{{ dishStallLabel(dish) }}</small>
          <small>{{ dish.tags.join(' / ') }}</small>
          <span class="pill">综合分 {{ dish.rankScore }}</span>
        </article>
      </div>
    </section>

    <section class="region-preview">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">区域推荐</p>
          <h2>按风味找到想吃的</h2>
        </div>
        <RouterLink class="text-link" to="/regions">查看全部区域</RouterLink>
      </div>
      <div class="region-preview-grid">
        <RouterLink
          v-for="region in featuredRegions"
          :key="region.id"
          class="region-preview-card"
          :to="{ path: '/regions', query: { region: region.id, sort: 'forYou' } }"
        >
          <img v-if="region.heroDish?.imageUrl" :src="region.heroDish.imageUrl" :alt="region.name" />
          <span v-else class="emoji large">{{ region.icon }}</span>
          <span>
            <strong>{{ region.name }}</strong>
            <small>{{ region.count }} 道菜 · ⭐ {{ region.averageRating.toFixed(1) }}</small>
          </span>
        </RouterLink>
      </div>
    </section>

    <section class="card">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">智能推荐</p>
          <h2>{{ recommendationLabel }}</h2>
          <span v-if="recContext.source" class="pill">{{ recContext.source === 'today_menu' ? '来自今日菜单' : '菜品库推荐' }}</span>
        </div>
        <div class="table-actions">
          <button class="ghost" type="button" :disabled="recLoading" @click="loadRecommendation">{{ recLoading ? '加载中...' : '刷新推荐' }}</button>
          <RouterLink class="text-link" to="/recommend">定制推荐</RouterLink>
        </div>
      </div>
      <p v-if="contextSummary" class="hero-copy">{{ contextSummary }}</p>
      <p v-if="recContext.menu?.date" class="muted">菜单日期：{{ recContext.menu.date }} · {{ mealTypeLabel(recContext.menu.mealType) }}</p>
      <div v-if="recContext.ranked.length" class="dish-list dense">
        <RouterLink v-for="(dish, idx) in recContext.ranked" :key="dish.id" class="dish-row" :to="{ path: '/dishes', query: { dish: dish.id } }">
          <span class="rank-badge">{{ idx + 1 }}</span>
          <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="dish.name" class="dish-thumb-sm" />
          <span v-else class="emoji">{{ dish.image }}</span>
          <span>
            <strong>{{ dish.name }}</strong>
            <small>{{ dish.nutrition?.calories || 0 }} kcal · 蛋白 {{ dish.nutrition?.protein || 0 }}g · ¥{{ dish.price }}</small>
            <small v-if="formatWhy(dish.why)" class="rec-reason">{{ formatWhy(dish.why) }}</small>
          </span>
          <span v-if="dish.recommendationScore" class="pill">推荐分 {{ dish.recommendationScore.toFixed(1) }}</span>
        </RouterLink>
      </div>
      <p v-else class="muted">{{ recLoading ? '正在加载推荐...' : '暂无推荐，去今日点餐看看今天有什么好吃的吧！' }} <RouterLink v-if="!recLoading" class="text-link" to="/orders">查看今日供应</RouterLink></p>
      <div v-if="recContext.totals" class="metric-grid compact" style="margin-top:0.75rem;">
        <article><strong>{{ recContext.totals.calories || 0 }}</strong><span>kcal 合计</span></article>
        <article><strong>{{ recContext.totals.protein || 0 }}g</strong><span>蛋白</span></article>
        <article><strong>¥{{ recContext.totals.price || 0 }}</strong><span>总价</span></article>
      </div>
    </section>

    <section class="grid two-columns">
      <article class="card">
        <div class="section-title">
          <p class="eyebrow">今日推荐</p>
          <h2>{{ store.recommendation.goalLabel }}餐单</h2>
          <span class="pill">{{ menuSourceLabel }}</span>
        </div>
        <p class="muted">{{ store.todayMenu.dishes.length ? `优先来自 ${store.todayMenu.date} 已发布且未售罄的今日菜单。` : store.recommendation.reason }}</p>
        <div class="dish-list dense">
          <RouterLink v-for="dish in store.recommendation.dishes" :key="dish.id" class="dish-row" :to="{ path: '/dishes', query: { dish: dish.id } }">
            <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="dish.name" class="dish-thumb-sm" />
            <span v-else class="emoji">{{ dish.image }}</span>
            <span>
              <strong>{{ dish.name }}</strong>
              <small>{{ dish.nutrition.calories }} kcal · 蛋白 {{ dish.nutrition.protein }}g · ¥{{ dish.price }}</small>
            </span>
          </RouterLink>
        </div>
        <p v-if="!store.todayMenu.dishes.length" class="muted">今日菜单尚未更新，以下为根据历史数据为您推荐的菜品。</p>
      </article>

      <article class="card">
        <div class="section-title">
          <p class="eyebrow">快速入口</p>
          <h2>常用功能</h2>
        </div>
        <div class="quick-links">
          <RouterLink class="quick-link-item" to="/orders">
            <span class="emoji">🛒</span>
            <span>今日点餐</span>
          </RouterLink>
          <RouterLink class="quick-link-item" to="/orders">
            <span class="emoji">📋</span>
            <span>查看取餐码</span>
          </RouterLink>
          <RouterLink class="quick-link-item" to="/recommend">
            <span class="emoji">🍽️</span>
            <span>生成今日餐单</span>
          </RouterLink>
          <RouterLink class="quick-link-item" to="/canteens">
            <span class="emoji">🏫</span>
            <span>食堂导航</span>
          </RouterLink>
          <RouterLink class="quick-link-item" to="/rankings">
            <span class="emoji">🏆</span>
            <span>查看排行榜</span>
          </RouterLink>
          <RouterLink class="quick-link-item" to="/dishes">
            <span class="emoji">🔍</span>
            <span>检索菜品</span>
          </RouterLink>
        </div>
      </article>
    </section>
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
import { summarizeRegions } from '../domain/regionRecommendation.js';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();

const adminRoleSet = new Set(['operator', 'stall_admin', 'canteen_admin', 'auditor', 'finance', 'tenant_admin', 'admin', 'super_admin']);
const isAdmin = computed(() => store.user && adminRoleSet.has(store.user.role));

const topDish = computed(() => store.rankings.dishes[0]);
const regionSummaries = computed(() => summarizeRegions(store.dishes, {
  ratingById: new Map(store.rankings.dishes.map((dish) => [dish.id, dish])),
  preferences: store.dishPreferences
}));
const featuredRegions = computed(() => [...regionSummaries.value]
  .sort((left, right) => right.totalSales - left.totalSales)
  .slice(0, 4));
const menuSourceLabel = computed(() => (store.todayMenu.dishes.length ? '今日供应' : '菜品库兜底'));

const recContext = computed(() => store.contextualRecommendation);
const recLoading = ref(false);
const aiReadiness = ref(null);

const recommendationLabel = computed(() => recContext.value.goalLabel ? `${recContext.value.goalLabel}推荐` : '今日智能推荐');

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
  } finally {
    recLoading.value = false;
  }
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
}

@media (max-width: 560px) {
  .region-preview-grid { grid-template-columns: 1fr; }
}
</style>
