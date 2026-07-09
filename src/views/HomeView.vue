<template>
  <section class="hero card">
    <div>
      <p class="eyebrow">Web first · 小程序后迁移</p>
      <h1>把校园食堂从“靠经验找饭”升级为“数据驱动选餐”。</h1>
      <p class="hero-copy">MVP 已覆盖学生端查询、筛选、评价、排行榜、健康档案、规则推荐，以及管理员基础数据维护。领域逻辑独立在 domain/services 层，后续可替换为后端 API 或迁移到 uni-app。</p>
      <div class="hero-actions">
        <RouterLink class="primary button-link" to="/recommend">生成今日餐单</RouterLink>
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
        <strong>{{ topDish?.rating.toFixed(1) }}</strong>
        <span>最高评分</span>
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
        <RouterLink v-for="dish in store.recommendation.dishes" :key="dish.id" class="dish-row" to="/recommend">
          <span class="emoji">{{ dish.image }}</span>
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
        <p class="eyebrow">运营信号</p>
        <h2>用户调研验证的核心需求</h2>
      </div>
      <ul class="insight-list">
        <li><strong>81.54%</strong><span>最感兴趣食堂排行榜。</span></li>
        <li><strong>64.62%</strong><span>需要食堂 / 楼层 / 档口 / 菜品导航。</span></li>
        <li><strong>60%</strong><span>希望获得 AI 个性化营养餐推荐。</span></li>
        <li><strong>56.92%</strong><span>痛点是外部 App 推荐的菜学校买不到。</span></li>
      </ul>
    </article>
  </section>

  <section class="card">
    <div class="section-title horizontal">
      <div>
        <p class="eyebrow">热门菜品</p>
        <h2>综合评分榜 Top 4</h2>
      </div>
      <RouterLink class="text-link" to="/rankings">查看完整排行榜</RouterLink>
    </div>
    <div class="cards-grid">
      <article v-for="dish in store.rankings.dishes.slice(0, 4)" :key="dish.id" class="mini-card">
        <span class="emoji large">{{ dish.image }}</span>
        <strong>{{ dish.name }}</strong>
        <small>{{ dish.tags.join(' / ') }}</small>
        <span class="pill">综合分 {{ dish.rankScore }}</span>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const topDish = computed(() => store.rankings.dishes[0]);
const menuSourceLabel = computed(() => (store.todayMenu.dishes.length ? '今日供应' : '菜品库兜底'));
</script>
