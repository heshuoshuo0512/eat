<template>
  <section class="page-heading">
    <p class="eyebrow">食堂 / 楼层 / 档口</p>
    <h1>食堂全景导航</h1>
    <p>先解决“在哪吃、有什么、开没开、拥不拥挤”。</p>
  </section>

  <section class="canteen-grid">
    <article v-for="canteen in store.canteens" :key="canteen.id" class="card canteen-card">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">{{ canteen.location }}</p>
          <h2>{{ canteen.name }}</h2>
        </div>
        <span class="crowd" :class="crowdClass(canteen.crowdLevel)">{{ canteen.crowdLevel }}%</span>
      </div>
      <p class="muted">{{ canteen.description }}</p>
      <div class="meta-row">
        <span>营业 {{ canteen.hours }}</span>
        <span v-for="tag in canteen.tags" :key="tag" class="pill">{{ tag }}</span>
      </div>
      <div class="stall-list">
        <article v-for="stall in stallsByCanteen(canteen.id)" :key="stall.id" class="stall-row">
          <div>
            <strong>{{ stall.floor }} · {{ stall.name }}</strong>
            <small>{{ stall.category }} · 人均 ¥{{ stall.avgPrice }} · {{ stall.description }}</small>
          </div>
          <span class="rating">{{ stall.rating.toFixed(1) }}</span>
        </article>
      </div>
    </article>
  </section>
</template>

<script setup>
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();

function stallsByCanteen(canteenId) {
  return store.stalls.filter((stall) => stall.canteenId === canteenId);
}

function crowdClass(value) {
  if (value >= 70) return 'hot';
  if (value >= 50) return 'warm';
  return 'calm';
}
</script>
