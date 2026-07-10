<template>
  <section class="page-heading">
    <p class="eyebrow">食堂 / 楼层 / 档口</p>
    <h1>食堂全景导航</h1>
    <p>先解决"在哪吃、有什么、开没开、拥不拥挤"。</p>
  </section>

  <section class="canteen-grid">
    <article v-for="canteen in store.canteens" :key="canteen.id" class="card canteen-card">
      <div class="canteen-visual">
        <img :src="canteenImage(canteen)" :alt="`${canteen.name}环境`" class="canteen-hero-img" />
      </div>
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
      <div class="meta-row">
        <span class="pill">⭐ {{ avgRating(canteen.id).toFixed(1) }}</span>
        <span class="pill">📝 {{ canteenReviews(canteen.id).length }} 条食堂评价</span>
      </div>
      <div v-for="(group, floor) in groupedStalls(canteen.id)" :key="floor" class="floor-group">
        <h3 class="floor-label">{{ floor }}</h3>
        <div class="stall-list">
          <RouterLink v-for="stall in group" :key="stall.id" class="stall-row" :to="{ path: '/dishes', query: { stall: stall.id } }">
            <div>
              <strong>{{ stall.name }}</strong>
              <small>{{ stall.category }} · 人均 ¥{{ stall.avgPrice }} · {{ stall.description }}</small>
            </div>
            <span class="rating">{{ stall.rating.toFixed(1) }}</span>
          </RouterLink>
        </div>
      </div>
      <section class="canteen-reviews">
        <h3>食堂评价</h3>
        <div v-if="canteenReviews(canteen.id).length" class="reviews">
          <article v-for="item in canteenReviews(canteen.id).slice(0, 3)" :key="item.id" class="review-row">
            <div><strong>{{ item.user }} · {{ item.rating }} 分</strong><small>{{ item.content }} · {{ item.createdAt }}</small></div>
          </article>
        </div>
        <p v-else class="muted">暂无食堂评价，欢迎分享环境、服务和整体体验。</p>
        <form class="review-form compact-review" @submit.prevent="submitCanteenReview(canteen.id)">
          <label>评分
            <select v-model.number="reviewForm(canteen.id).rating">
              <option :value="5">5 分</option><option :value="4">4 分</option><option :value="3">3 分</option><option :value="2">2 分</option><option :value="1">1 分</option>
            </select>
          </label>
          <label>评价内容<textarea v-model.trim="reviewForm(canteen.id).content" maxlength="240" placeholder="说说环境、服务或分区体验" /></label>
          <button class="secondary" type="submit">发布食堂评价</button>
          <p v-if="messages[canteen.id]" class="form-message">{{ messages[canteen.id] }}</p>
        </form>
      </section>
    </article>
  </section>
</template>

<script setup>
import { reactive } from 'vue';
import { RouterLink } from 'vue-router';
import { validateReviewForm } from '../domain/validation.js';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const reviewForms = reactive({});
const messages = reactive({});

function stallsByCanteen(canteenId) {
  return store.stalls.filter((stall) => stall.canteenId === canteenId);
}

function groupedStalls(canteenId) {
  const map = {};
  for (const stall of stallsByCanteen(canteenId)) {
    const floor = stall.floor || '其他';
    if (!map[floor]) map[floor] = [];
    map[floor].push(stall);
  }
  return map;
}

const canteenImages = {
  north: 'https://images.unsplash.com/photo-1567521464027-f127ff144326?auto=format&fit=crop&w=1200&q=80',
  central: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80',
  south: 'https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1200&q=80'
};

function canteenImage(canteen) {
  return canteen.imageUrl || canteenImages[canteen.id] || canteenImages.central;
}

function canteenReviews(canteenId) {
  return store.state.reviews.filter((review) => review.targetType === 'canteen' && review.targetId === canteenId);
}

function reviewForm(canteenId) {
  if (!reviewForms[canteenId]) reviewForms[canteenId] = { rating: 5, content: '' };
  return reviewForms[canteenId];
}

async function submitCanteenReview(canteenId) {
  const form = reviewForm(canteenId);
  messages[canteenId] = validateReviewForm({ targetId: canteenId, rating: form.rating, content: form.content });
  if (messages[canteenId]) return;
  try {
    await store.addReview({ targetType: 'canteen', targetId: canteenId, rating: form.rating, content: form.content });
    form.content = '';
    messages[canteenId] = '食堂评价已发布。';
  } catch (error) {
    messages[canteenId] = error.message;
  }
}

function avgRating(canteenId) {
  const ratings = [
    ...stallsByCanteen(canteenId).map((stall) => Number(stall.rating || 0)),
    ...canteenReviews(canteenId).map((review) => Number(review.rating || 0))
  ].filter((rating) => rating > 0);
  if (!ratings.length) return 0;
  return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
}

function crowdClass(value) {
  if (value >= 70) return 'hot';
  if (value >= 50) return 'warm';
  return 'calm';
}
</script>

<style scoped>
.canteen-visual { overflow: hidden; border-radius: 22px; margin-bottom: 16px; background: linear-gradient(135deg, rgba(235,247,229,.52), rgba(255,255,255,.42)); border: 1px solid rgba(255,255,255,.6); }
.canteen-hero-img { display: block; width: 100%; height: 160px; object-fit: cover; }
.canteen-fallback-hero { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; height: 160px; }
.floor-group { margin-top: 14px; }
.floor-label { font-size: 13px; font-weight: 720; color: var(--primary-dark, #155f3b); margin: 0 0 8px; letter-spacing: -.01em; }
.canteen-reviews { margin-top: 18px; padding-top: 16px; border-top: 1px solid rgba(31,122,77,.12); }
.canteen-reviews h3 { margin: 0 0 12px; }
.compact-review { margin-top: 14px; }
.compact-review textarea { min-height: 72px; }
</style>
