<template>
  <section class="page-heading">
    <p class="eyebrow">平均评分 × 评论热度</p>
    <h1>校园食堂排行榜</h1>
    <p>MVP 使用综合分：评分权重 70% + 评论热度权重 30%。</p>
  </section>

  <section class="grid three-columns">
    <article class="card rank-column">
      <h2>菜品榜</h2>
      <div v-for="(dish, index) in store.rankings.dishes.slice(0, 6)" :key="dish.id" class="rank-row">
        <span class="rank-index">{{ index + 1 }}</span>
        <span class="emoji">{{ dish.image }}</span>
        <span>
          <strong>{{ dish.name }}</strong>
          <small>{{ dish.computedRating }} 分 · {{ dish.computedReviewCount }} 条评价</small>
        </span>
        <b>{{ dish.rankScore }}</b>
      </div>
    </article>

    <article class="card rank-column">
      <h2>档口榜</h2>
      <div v-for="(stall, index) in store.rankings.stalls" :key="stall.id" class="rank-row">
        <span class="rank-index">{{ index + 1 }}</span>
        <span>
          <strong>{{ stall.name }}</strong>
          <small>{{ stall.category }} · {{ stall.dishCount }} 个菜品</small>
        </span>
        <b>{{ stall.rankScore }}</b>
      </div>
    </article>

    <article class="card rank-column">
      <h2>食堂榜</h2>
      <div v-for="(canteen, index) in store.rankings.canteens" :key="canteen.id" class="rank-row">
        <span class="rank-index">{{ index + 1 }}</span>
        <span>
          <strong>{{ canteen.name }}</strong>
          <small>{{ canteen.location }} · {{ canteen.stallCount }} 个档口</small>
        </span>
        <b>{{ canteen.rankScore }}</b>
      </div>
    </article>
  </section>
</template>

<script setup>
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
</script>
