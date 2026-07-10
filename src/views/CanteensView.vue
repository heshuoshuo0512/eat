<template>
  <section class="page-heading">
    <p class="eyebrow">食堂 / 楼层 / 档口</p>
    <h1>食堂全景导航</h1>
    <p>先解决"在哪吃、有什么、开没开、拥不拥挤"。</p>
  </section>

  <nav v-if="level !== 'primary'" class="breadcrumb">
    <button class="text-link crumb" type="button" @click="goToPrimary">食堂总览</button>
    <span class="crumb-sep">›</span>
    <button v-if="level === 'stalls' || level === 'stall-dishes'" class="text-link crumb" type="button" @click="goToSubCanteen">
      {{ selectedSubCanteen?.name }}
    </button>
    <template v-if="level === 'stall-dishes'">
      <span class="crumb-sep">›</span>
      <span class="crumb current">{{ selectedStall?.name }}</span>
    </template>
  </nav>

  <p v-if="level !== 'primary'" class="back-row">
    <button class="pill back-btn" type="button" @click="goBack">← 返回</button>
  </p>

  <!-- Level 1: Primary canteen cards -->
  <section v-if="level === 'primary'" class="canteen-grid">
    <article
      v-for="canteen in primaryCanteens"
      :key="canteen.id"
      class="card canteen-card"
      role="button"
      tabindex="0"
      @click="selectPrimary(canteen.id)"
      @keydown.enter="selectPrimary(canteen.id)"
    >
      <div class="canteen-visual">
        <img v-if="canteenImage(canteen)" :src="canteenImage(canteen)" :alt="`${canteen.name}环境`" class="canteen-hero-img" />
        <div v-else class="canteen-fallback-hero"><span class="emoji hero-emoji">🏫</span><span class="muted">{{ canteen.name }}</span></div>
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
        <span class="pill">{{ subCanteensOf(canteen.id).length }} 个分区</span>
        <span class="pill">{{ stallCountOf(canteen.id) }} 个档口</span>
      </div>
      <p class="muted enter-hint">点击进入 →</p>
    </article>

    <p v-if="!primaryCanteens.length" class="muted empty-state">暂无食堂数据，请等待管理员添加。</p>
  </section>

  <!-- Level 2: Sub-canteen overview (selected primary's children, or primary itself if no children) -->
  <section v-if="level === 'stalls'" class="sub-canteen-area">
    <header class="sub-canteen-header card">
      <div class="canteen-visual">
        <img v-if="canteenImage(selectedSubCanteen)" :src="canteenImage(selectedSubCanteen)" :alt="`${selectedSubCanteen?.name}环境`" class="canteen-hero-img" />
        <div v-else class="canteen-fallback-hero"><span class="emoji hero-emoji">🏫</span></div>
      </div>
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">{{ selectedSubCanteen?.location }}</p>
          <h2>{{ selectedSubCanteen?.name }}</h2>
        </div>
        <span class="crowd" :class="crowdClass(selectedSubCanteen?.crowdLevel || 0)">{{ selectedSubCanteen?.crowdLevel || 0 }}%</span>
      </div>
      <p class="muted">{{ selectedSubCanteen?.description }}</p>
      <div class="meta-row">
        <span>营业 {{ selectedSubCanteen?.hours }}</span>
        <span v-for="tag in (selectedSubCanteen?.tags || [])" :key="tag" class="pill">{{ tag }}</span>
      </div>
      <div class="meta-row">
        <span class="pill">⭐ {{ avgRating(selectedSubCanteen?.id).toFixed(1) }}</span>
        <span class="pill">{{ canteenStalls.length }} 个档口</span>
      </div>
    </header>

    <div v-for="(group, floor) in groupedCanteenStalls" :key="floor" class="floor-group">
      <h3 class="floor-label">{{ floor }}</h3>
      <div class="stall-cards">
        <article
          v-for="stall in group"
          :key="stall.id"
          class="card stall-card"
          role="button"
          tabindex="0"
          @click="selectStall(stall.id)"
          @keydown.enter="selectStall(stall.id)"
        >
          <div class="stall-card-head">
            <strong>{{ stall.name }}</strong>
            <span class="rating">{{ stall.rating.toFixed(1) }}</span>
          </div>
          <small class="muted">{{ stall.category }} · 人均 ¥{{ stall.avgPrice }}</small>
          <p class="muted">{{ stall.description }}</p>
          <div class="meta-row">
            <span class="pill" :class="stall.open ? 'open-tag' : 'closed-tag'">{{ stall.open ? '营业中' : '已关闭' }}</span>
            <span class="pill">{{ dishCountForStall(stall.id) }} 个菜品</span>
          </div>
          <p class="muted enter-hint">查看菜品 →</p>
        </article>
      </div>
    </div>

    <p v-if="!canteenStalls.length" class="muted empty-state">该食堂暂无档口数据。</p>

    <!-- Review form for the selected sub-canteen -->
    <section class="canteen-reviews card">
      <h3>食堂评价</h3>
      <div v-if="canteenReviews(selectedSubCanteen?.id).length" class="reviews">
        <article v-for="item in canteenReviews(selectedSubCanteen?.id).slice(0, 5)" :key="item.id" class="review-row">
          <div>
            <strong>{{ item.user }} · {{ item.rating }} 分</strong>
            <small>{{ item.content }} · {{ item.createdAt }}</small>
          </div>
        </article>
      </div>
      <p v-else class="muted">暂无食堂评价，欢迎分享环境、服务和整体体验。</p>
      <form class="review-form compact-review" @submit.prevent="submitCanteenReview(selectedSubCanteen?.id)">
        <label>评分
          <select v-model.number="reviewFormObj.rating">
            <option :value="5">5 分</option>
            <option :value="4">4 分</option>
            <option :value="3">3 分</option>
            <option :value="2">2 分</option>
            <option :value="1">1 分</option>
          </select>
        </label>
        <label>评价内容<textarea v-model.trim="reviewFormObj.content" maxlength="240" placeholder="说说环境、服务或分区体验" /></label>
        <button class="secondary" type="submit">发布食堂评价</button>
        <p v-if="reviewMessage" class="form-message">{{ reviewMessage }}</p>
      </form>
    </section>
  </section>

  <!-- Level 3: Stall dish preview -->
  <section v-if="level === 'stall-dishes'" class="stall-dishes-area">
    <header class="card stall-detail-header">
      <h2>{{ selectedStall?.name }}</h2>
      <p class="muted">{{ selectedStall?.category }} · 人均 ¥{{ selectedStall?.avgPrice }} · {{ selectedStall?.description }}</p>
      <div class="meta-row">
        <span class="pill" :class="selectedStall?.open ? 'open-tag' : 'closed-tag'">{{ selectedStall?.open ? '营业中' : '已关闭' }}</span>
        <span class="pill">⭐ {{ selectedStall?.rating?.toFixed(1) }}</span>
        <span class="pill">{{ stallDishes.length }} 个菜品</span>
      </div>
      <RouterLink class="primary go-dishes-btn" :to="{ path: '/dishes', query: { stall: selectedStallId } }">
        在菜品页查看全部 →
      </RouterLink>
    </header>

    <div v-if="stallDishes.length" class="dish-preview-grid">
      <article v-for="dish in stallDishes" :key="dish.id" class="card dish-preview-card">
        <div class="dish-preview-visual">
          <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="dish.name" class="dish-preview-img" />
          <span v-else class="emoji large">{{ dish.image }}</span>
        </div>
        <div class="dish-preview-info">
          <strong>{{ dish.name }}</strong>
          <small class="muted">{{ dish.cuisine }} · {{ dish.taste }} · ¥{{ dish.price }}</small>
          <small class="muted">{{ dish.nutrition?.calories || 0 }} kcal · 蛋白 {{ dish.nutrition?.protein || 0 }}g</small>
          <div class="meta-row">
            <span class="pill">⭐ {{ (dish.rating || 0).toFixed(1) }}</span>
            <span v-for="tag in (dish.tags || []).slice(0, 2)" :key="tag" class="pill">{{ tag }}</span>
          </div>
        </div>
      </article>
    </div>
    <p v-else class="muted empty-state">该档口暂无菜品。</p>
  </section>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { validateReviewForm } from '../domain/validation.js';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();

/* ── Navigation state ── */
const level = ref('primary'); // 'primary' | 'stalls' | 'stall-dishes'
const selectedPrimaryId = ref('');
const selectedSubCanteenId = ref('');
const selectedStallId = ref('');

/* ── Review form (only for selected sub-canteen) ── */
const reviewFormObj = reactive({ rating: 5, content: '' });
const reviewMessage = ref('');

/* ── Derived data ── */

const primaryCanteens = computed(() => {
  // If canteens have canteenType, filter by it; otherwise group by parentId
  const all = store.canteens;
  const hasType = all.some((c) => c.canteenType);
  if (hasType) return all.filter((c) => c.canteenType === 'primary');
  // No explicit hierarchy: treat canteens with no parentId as primary
  const hasParent = all.some((c) => c.parentId);
  if (hasParent) return all.filter((c) => !c.parentId);
  // Flat list: all are primary
  return all;
});

function subCanteensOf(primaryId) {
  const all = store.canteens;
  const hasType = all.some((c) => c.canteenType);
  if (hasType) return all.filter((c) => c.parentId === primaryId && c.canteenType === 'sub');
  const hasParent = all.some((c) => c.parentId);
  if (hasParent) return all.filter((c) => c.parentId === primaryId);
  // Flat: no children
  return [];
}

function stallCountOf(canteenId) {
  const subs = subCanteensOf(canteenId);
  if (subs.length) {
    return subs.reduce((sum, sub) => sum + store.stalls.filter((s) => s.canteenId === sub.id).length, 0);
  }
  return store.stalls.filter((s) => s.canteenId === canteenId).length;
}

const selectedSubCanteen = computed(() => store.canteens.find((c) => c.id === selectedSubCanteenId.value) || null);
const selectedStall = computed(() => store.stalls.find((s) => s.id === selectedStallId.value) || null);

const canteenStalls = computed(() => store.stalls.filter((s) => s.canteenId === selectedSubCanteenId.value));

const groupedCanteenStalls = computed(() => {
  const map = {};
  for (const stall of canteenStalls.value) {
    const floor = stall.floor || '其他';
    if (!map[floor]) map[floor] = [];
    map[floor].push(stall);
  }
  return map;
});

const stallDishes = computed(() => store.dishes.filter((d) => d.stallId === selectedStallId.value));

function dishCountForStall(stallId) {
  return store.dishes.filter((d) => d.stallId === stallId).length;
}

/* ── Navigation actions ── */

function selectPrimary(id) {
  const subs = subCanteensOf(id);
  selectedPrimaryId.value = id;
  if (subs.length === 1) {
    // Only one sub-canteen: jump directly to stalls
    selectedSubCanteenId.value = subs[0].id;
    level.value = 'stalls';
  } else if (subs.length > 1) {
    // Multiple sub-canteens: show first one (could show picker; for now go to first)
    selectedSubCanteenId.value = subs[0].id;
    level.value = 'stalls';
  } else {
    // No children: this canteen IS the sub-canteen
    selectedSubCanteenId.value = id;
    level.value = 'stalls';
  }
}

function selectStall(stallId) {
  selectedStallId.value = stallId;
  level.value = 'stall-dishes';
}

function goToPrimary() {
  level.value = 'primary';
  selectedPrimaryId.value = '';
  selectedSubCanteenId.value = '';
  selectedStallId.value = '';
}

function goToSubCanteen() {
  level.value = 'stalls';
  selectedStallId.value = '';
}

function goBack() {
  if (level.value === 'stall-dishes') {
    goToSubCanteen();
  } else if (level.value === 'stalls') {
    goToPrimary();
  }
}

/* ── Image helpers ── */

function canteenImage(canteen) {
  return canteen?.imageUrl || '';
}

/* ── Review helpers ── */

function canteenReviews(canteenId) {
  if (!canteenId) return [];
  return store.state.reviews.filter((r) => r.targetType === 'canteen' && r.targetId === canteenId);
}

function avgRating(canteenId) {
  if (!canteenId) return 0;
  const canteenStallRatings = store.stalls
    .filter((s) => s.canteenId === canteenId)
    .map((s) => Number(s.rating || 0));
  const reviewRatings = canteenReviews(canteenId).map((r) => Number(r.rating || 0));
  const all = [...canteenStallRatings, ...reviewRatings].filter((r) => r > 0);
  if (!all.length) return 0;
  return all.reduce((sum, r) => sum + r, 0) / all.length;
}

async function submitCanteenReview(canteenId) {
  if (!canteenId) return;
  reviewMessage.value = validateReviewForm({ targetId: canteenId, rating: reviewFormObj.rating, content: reviewFormObj.content });
  if (reviewMessage.value) return;
  try {
    await store.addReview({ targetType: 'canteen', targetId: canteenId, rating: reviewFormObj.rating, content: reviewFormObj.content });
    reviewFormObj.content = '';
    reviewMessage.value = '食堂评价已发布。';
  } catch (error) {
    reviewMessage.value = error.message;
  }
}

function crowdClass(value) {
  if (value >= 70) return 'hot';
  if (value >= 50) return 'warm';
  return 'calm';
}
</script>

<style scoped>
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 14px;
}
.crumb { background: none; border: none; cursor: pointer; font-size: 14px; }
.crumb.current { color: var(--text-secondary, #666); cursor: default; }
.crumb-sep { color: var(--text-secondary, #999); }
.back-row { margin-bottom: 14px; }
.back-btn { cursor: pointer; border: 1px solid rgba(255,255,255,.6); background: linear-gradient(135deg, rgba(255,255,255,.78), rgba(255,255,255,.56)); }

.canteen-grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
.canteen-card { cursor: pointer; transition: transform .16s, box-shadow .16s; }
.canteen-card:hover { transform: translateY(-2px); box-shadow: 0 6px 24px rgba(0,0,0,.08); }

.canteen-visual { overflow: hidden; border-radius: 22px; margin-bottom: 16px; background: linear-gradient(135deg, rgba(235,247,229,.52), rgba(255,255,255,.42)); border: 1px solid rgba(255,255,255,.6); }
.canteen-hero-img { display: block; width: 100%; height: 160px; object-fit: cover; }
.canteen-fallback-hero { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; height: 160px; }
.hero-emoji { font-size: 48px; }

.enter-hint { font-size: 12px; color: var(--accent, #1f7a4d); margin-top: 8px; }

.sub-canteen-area { display: flex; flex-direction: column; gap: 20px; }
.sub-canteen-header { padding-bottom: 20px; }

.floor-group { margin-top: 14px; }
.floor-label { font-size: 13px; font-weight: 720; color: var(--primary-dark, #155f3b); margin: 0 0 10px; letter-spacing: -.01em; }
.stall-cards { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.stall-card { cursor: pointer; transition: transform .16s, box-shadow .16s; }
.stall-card:hover { transform: translateY(-2px); box-shadow: 0 6px 24px rgba(0,0,0,.08); }
.stall-card-head { display: flex; justify-content: space-between; align-items: center; }

.open-tag { background: rgba(31,122,77,.12); color: var(--primary-dark, #155f3b); }
.closed-tag { background: rgba(200,60,60,.1); color: #a33; }

.canteen-reviews { margin-top: 0; }
.canteen-reviews h3 { margin: 0 0 12px; }
.compact-review { margin-top: 14px; }
.compact-review textarea { min-height: 72px; }

.stall-dishes-area { display: flex; flex-direction: column; gap: 20px; }
.stall-detail-header { padding-bottom: 20px; }
.go-dishes-btn { display: inline-block; margin-top: 12px; text-decoration: none; text-align: center; padding: 10px 24px; border-radius: 18px; }

.dish-preview-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.dish-preview-card { display: flex; gap: 14px; align-items: flex-start; }
.dish-preview-visual { flex-shrink: 0; }
.dish-preview-img { width: 72px; height: 72px; border-radius: 16px; object-fit: cover; border: 1px solid rgba(255,255,255,.6); }
.dish-preview-info { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }

.empty-state { padding: 32px; text-align: center; }

/* Mobile */
@media (max-width: 640px) {
  .canteen-grid { grid-template-columns: 1fr; }
  .stall-cards { grid-template-columns: 1fr; }
  .dish-preview-grid { grid-template-columns: 1fr; }
  .dish-preview-card { flex-direction: column; align-items: stretch; }
  .dish-preview-img { width: 100%; height: 140px; }
}
</style>
