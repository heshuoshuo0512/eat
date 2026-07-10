<template>
  <!-- Student homepage -->
  <template v-if="!isAdmin">
    <section class="hero card">
      <div>
        <p class="eyebrow">校园智慧食堂</p>
        <h1>数据驱动选餐，吃得明白又健康</h1>
        <p class="hero-copy">查看热门排行榜、获取个性化推荐，再也不用靠运气找饭。</p>
        <div class="hero-actions">
          <RouterLink class="primary button-link" to="/rankings">查看排行榜</RouterLink>
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
          <strong>{{ topDish?.computedRating.toFixed(1) }}</strong>
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
        <p v-if="!store.todayMenu.dishes.length" class="muted">今日暂未发布菜单，已自动回退到完整菜品库推荐。</p>
      </article>

      <article class="card">
        <div class="section-title">
          <p class="eyebrow">快速入口</p>
          <h2>常用功能</h2>
        </div>
        <div class="quick-links">
          <RouterLink class="quick-link-item" to="/recommend">
            <span class="emoji">🍽️</span>
            <span>生成今日餐单</span>
          </RouterLink>
          <RouterLink class="quick-link-item" to="/canteens">
            <span class="emoji">🏫</span>
            <span>食堂导航</span>
          </RouterLink>
          <RouterLink class="quick-link-item" to="/visual-meal">
            <span class="emoji">📸</span>
            <span>拍照识别</span>
          </RouterLink>
          <RouterLink class="quick-link-item" to="/orders">
            <span class="emoji">📋</span>
            <span>我的订单</span>
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
        <p class="hero-copy">管理菜单、处理订单、审核评价、查看数据分析，一站式运营工具。</p>
      </div>
      <div class="metric-grid compact">
        <article>
          <strong>{{ store.dishes.length }}</strong>
          <span>菜品总数</span>
        </article>
        <article>
          <strong>{{ store.stalls.length }}</strong>
          <span>档口数量</span>
        </article>
        <article>
          <strong>{{ store.canteens.length }}</strong>
          <span>食堂数量</span>
        </article>
        <article>
          <strong>{{ store.rankings.dishes.length }}</strong>
          <span>已评分菜品</span>
        </article>
      </div>
    </section>

    <section class="grid two-columns">
      <RouterLink class="card admin-card" to="/stall-console">
        <div class="admin-card-icon">📦</div>
        <h2>订单队列</h2>
        <p>查看并处理待完成、已支付的订单，更新订单状态。</p>
      </RouterLink>

      <RouterLink class="card admin-card" to="/admin/input">
        <div class="admin-card-icon">📝</div>
        <h2>菜单发布</h2>
        <p>管理菜品数据、发布今日菜单、导入导出菜品信息。</p>
      </RouterLink>

      <RouterLink class="card admin-card" to="/admin">
        <div class="admin-card-icon">⭐</div>
        <h2>评价与数据管理</h2>
        <p>审核用户评价、管理用户角色、查看审计日志。</p>
      </RouterLink>

      <RouterLink class="card admin-card" to="/order-analytics">
        <div class="admin-card-icon">📊</div>
        <h2>数据分析</h2>
        <p>查看销售趋势、菜品热度、营业统计等运营数据。</p>
      </RouterLink>

      <RouterLink class="card admin-card" to="/agent">
        <div class="admin-card-icon">🤖</div>
        <h2>AI 顾问</h2>
        <p>智能运营助手，数据分析建议、菜品推荐策略。</p>
      </RouterLink>
    </section>
  </template>
</template>

<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();

const adminRoles = ['operator', 'stall_admin', 'canteen_admin', 'auditor', 'finance', 'tenant_admin', 'admin', 'super_admin'];
const isAdmin = computed(() => store.user && adminRoles.includes(store.user.role));

const topDish = computed(() => store.rankings.dishes[0]);
const menuSourceLabel = computed(() => (store.todayMenu.dishes.length ? '今日供应' : '菜品库兜底'));

function dishStallLabel(dish) {
  const stall = store.stalls.find(s => s.id === dish.stallId);
  if (!stall) return '';
  const canteen = store.canteens.find(c => c.id === stall.canteenId);
  return canteen ? `${stall.name} · ${canteen.name}` : stall.name;
}
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
</style>
