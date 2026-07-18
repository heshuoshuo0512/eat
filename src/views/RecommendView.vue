<template>
  <section class="page-heading">
    <p class="eyebrow">吃什么 · 怎么吃 · 食堂导航</p>
    <h1>个性化餐单推荐</h1>
    <p>基于你的健康档案、时段、预算与实时食堂供应，从真实菜品库中筛选排名，为你揭晓今日最佳选择。</p>
  </section>

  <!-- ── Server Context Banner ────────────────────────────── -->
  <section v-if="serverContext" class="card context-banner" aria-label="推荐上下文">
    <div class="context-chips">
      <span class="ctx-chip">
        <span class="ctx-icon" aria-hidden="true">🕐</span>
        {{ timeLabel }}
      </span>
      <span v-if="serverContext.environment" class="ctx-chip">
        <span class="ctx-icon" aria-hidden="true">{{ weatherIcon }}</span>
        {{ serverContext.environment.weatherLabel }}{{ serverContext.environment.temperature != null ? ` ${serverContext.environment.temperature}°C` : '' }}
      </span>
      <span class="ctx-chip">
        <span class="ctx-icon" aria-hidden="true">👥</span>
        {{ crowdStrategyLabel }}
      </span>
      <span v-if="sourceLabel" class="ctx-chip">
        <span class="ctx-icon" aria-hidden="true">📋</span>
        {{ sourceLabel }}
      </span>
    </div>
  </section>

  <!-- ── Loading / Error / Empty ──────────────────────────── -->
  <section v-if="pageLoading" class="card state-card" aria-live="polite">
    <div class="state-icon">⏳</div>
    <p>正在加载推荐数据…</p>
  </section>

  <section v-else-if="pageError" class="card state-card error" aria-live="assertive">
    <div class="state-icon">⚠️</div>
    <p>{{ pageError }}</p>
    <button class="primary" @click="reload">重新加载</button>
  </section>

  <!-- ── Main Two-Column Layout ──────────────────────────── -->
  <template v-else>
    <section class="grid two-columns align-start">
      <!-- Left: Profile Editor -->
      <form class="card profile-form" @submit.prevent="saveProfile" aria-label="健康档案编辑">
        <div class="section-title">
          <h2>健康档案</h2>
          <p class="muted">调整偏好后保存，推荐结果自动刷新。</p>
        </div>

        <label>
          <span>饮食目标</span>
          <select v-model="form.goal">
            <option value="fatLoss">减脂</option>
            <option value="muscleGain">增肌</option>
            <option value="maintain">维持体重</option>
            <option value="healthy">健康饮食</option>
          </select>
        </label>

        <label>
          <span>餐次</span>
          <select v-model="form.mealType">
            <option value="breakfast">早餐</option>
            <option value="lunch">午餐</option>
            <option value="dinner">晚餐</option>
          </select>
        </label>

        <label>
          <span>预算上限：¥{{ form.budgetMax }}</span>
          <input v-model.number="form.budgetMax" type="range" min="8" max="80" step="1" />
        </label>

        <label>
          <span>口味偏好</span>
          <select v-model="form.taste">
            <option v-for="t in tasteOptions" :key="t" :value="t">{{ t }}</option>
          </select>
        </label>

        <label>
          <span>饮食模式</span>
          <select v-model="form.dietaryPattern">
            <option value="balanced">均衡</option>
            <option value="omnivore">杂食</option>
            <option value="pescatarian">鱼素</option>
            <option value="vegetarian">素食</option>
            <option value="vegan">纯素</option>
            <option value="lowCarb">低碳水</option>
            <option value="keto">生酮</option>
          </select>
        </label>

        <label>
          <span>辣度偏好</span>
          <select v-model.number="form.spiceLevel">
            <option :value="1">不辣</option>
            <option :value="2">微辣</option>
            <option :value="3">中辣</option>
            <option :value="4">重辣</option>
            <option :value="5">极辣</option>
          </select>
        </label>

        <fieldset class="tag-fieldset">
          <legend>营养关注</legend>
          <div class="tag-toggle-row">
            <button
              v-for="nf in nutritionFocusOptions"
              :key="nf.value"
              type="button"
              class="pill-toggle"
              :class="{ active: form.nutritionFocus.includes(nf.value) }"
              :aria-pressed="form.nutritionFocus.includes(nf.value)"
              @click="toggleNutritionFocus(nf.value)"
            >
              {{ nf.label }}
            </button>
          </div>
        </fieldset>

        <label>
          <span>喜爱标签（逗号分隔）</span>
          <input v-model="favoriteTagsText" type="text" placeholder="如：高蛋白, 低脂, 快手" />
        </label>

        <label>
          <span>忌口 / 过敏食材（逗号分隔）</span>
          <input v-model="avoidText" type="text" placeholder="如：花生, 虾, 牛奶" />
        </label>

        <label class="check-label">
          <input v-model="form.halalOnly" type="checkbox" />
          <span>仅清真</span>
        </label>

        <label class="check-label">
          <input v-model="form.preferLowCrowd" type="checkbox" />
          <span>偏好低人流食堂</span>
        </label>

        <button class="primary" type="submit" :disabled="saving">
          {{ saving ? '保存中…' : '保存并刷新推荐' }}
        </button>

        <p v-if="profileMessage" class="form-message" :class="{ danger: profileIsError }">
          {{ profileMessage }}
        </p>
      </form>

      <!-- Right: Recommendation Result -->
      <article class="card recommendation-card">
        <div class="section-title">
          <h2>{{ goalLabel }} · 推荐结果</h2>
        </div>
        <p class="muted">{{ planReason }}</p>

        <!-- Top Recommendation with Score Breakdown -->
        <div v-if="rankedDishes.length" class="top-pick">
          <div class="top-pick-header">
            <span class="rank-badge">🏆 综合最佳</span>
            <span class="score-detail" :title="breakdownTitle(rankedDishes[0])">
              {{ rankedDishes[0].contextualScore?.toFixed(1) }} 分
            </span>
          </div>
          <div class="dish-row dense top-pick-row">
            <div class="dish-thumb">
              <img
                v-if="rankedDishes[0].imageUrl"
                :src="rankedDishes[0].imageUrl"
                :alt="rankedDishes[0].name"
                loading="lazy"
                @error="onImgError"
              />
              <span v-else class="dish-emoji">{{ rankedDishes[0].image || '🍽️' }}</span>
            </div>
            <div class="dish-info">
              <strong>{{ rankedDishes[0].name }}</strong>
              <small>{{ locationLabel(rankedDishes[0]) }} · ¥{{ rankedDishes[0].price }}</small>
              <div class="reason-text">{{ (rankedDishes[0].why || []).join(' · ') }}</div>
            </div>
            <div class="dish-actions">
              <button
                class="icon-btn"
                :aria-label="isFavorite(rankedDishes[0].id) ? '取消收藏' : '收藏'"
                :aria-pressed="isFavorite(rankedDishes[0].id)"
                @click="onToggleFavorite(rankedDishes[0].id)"
              >
                {{ isFavorite(rankedDishes[0].id) ? '★' : '☆' }}
              </button>
              <button
                class="icon-btn"
                aria-label="标记已吃"
                @click="onMarkEaten(rankedDishes[0].id)"
              >
                ✓
              </button>
              <RouterLink
                class="icon-btn order-link"
                :to="{ path: '/orders', query: { dish: rankedDishes[0].id } }"
                aria-label="去点这道菜"
              >🛒</RouterLink>
            </div>
          </div>
          <!-- Extended Nutrition for Top Pick -->
          <div class="nutrition-grid extended">
            <span><strong>{{ rankedDishes[0].nutrition.calories }}</strong><small>千卡</small></span>
            <span><strong>{{ rankedDishes[0].nutrition.protein }}g</strong><small>蛋白质</small></span>
            <span><strong>{{ rankedDishes[0].nutrition.fat }}g</strong><small>脂肪</small></span>
            <span><strong>{{ rankedDishes[0].nutrition.carbs }}g</strong><small>碳水</small></span>
            <span><strong>{{ rankedDishes[0].fiber ?? '—' }}{{ rankedDishes[0].fiber != null ? 'g' : '' }}</strong><small>膳食纤维</small></span>
            <span><strong>{{ rankedDishes[0].sodium ?? '—' }}{{ rankedDishes[0].sodium != null ? 'mg' : '' }}</strong><small>钠</small></span>
            <span><strong>{{ rankedDishes[0].sugar ?? '—' }}{{ rankedDishes[0].sugar != null ? 'g' : '' }}</strong><small>糖</small></span>
            <span><strong>{{ rankedDishes[0].calcium ?? '—' }}{{ rankedDishes[0].calcium != null ? 'mg' : '' }}</strong><small>钙</small></span>
            <span><strong>{{ rankedDishes[0].iron ?? '—' }}{{ rankedDishes[0].iron != null ? 'mg' : '' }}</strong><small>铁</small></span>
          </div>
          <!-- Score Breakdown -->
          <ul v-if="rankedDishes[0].why?.length" class="reason-chips">
            <li v-for="(reason, ri) in rankedDishes[0].why" :key="ri" class="reason-chip">
              {{ reason }}
            </li>
          </ul>
        </div>

        <!-- Totals -->
        <div v-if="planTotals" class="nutrition-grid totals">
          <span><strong>{{ planTotals.calories }}</strong><small>总热量 kcal</small></span>
          <span><strong>{{ planTotals.protein }}g</strong><small>总蛋白质</small></span>
          <span><strong>¥{{ planTotals.price?.toFixed(0) ?? '—' }}</strong><small>总价格</small></span>
        </div>

        <div v-if="!rankedDishes.length && !pageLoading" class="empty-state">
          <p>当前条件没有匹配菜品，你可以：</p>
          <div class="empty-actions">
            <RouterLink class="primary button-link" to="/orders">查看今日供应</RouterLink>
            <button class="secondary" type="button" @click="saveProfile">调整档案后重新生成</button>
          </div>
        </div>
      </article>
    </section>

    <!-- ── CS2-Inspired Reveal Track ──────────────────────── -->
    <section v-if="rankedDishes.length" class="card reveal-section" aria-label="逐张揭晓推荐">
      <div class="section-title horizontal">
        <div>
          <h2>🎯 逐张揭晓</h2>
          <p class="muted">按排名依次揭晓推荐菜品，第 {{ revealIndex + 1 }} / {{ rankedDishes.length }} 张</p>
        </div>
        <div class="reveal-controls">
          <button
            class="primary"
            :disabled="revealIndex >= rankedDishes.length"
            @click="revealNext"
            @keydown.enter="revealNext"
            @keydown.space.prevent="revealNext"
          >
            {{ revealIndex >= rankedDishes.length ? '已全部揭晓' : '揭晓下一张' }}
          </button>
          <button class="ghost" @click="resetReveal" @keydown.enter="resetReveal">重置</button>
        </div>
      </div>

      <div class="reveal-reel" role="region" aria-live="polite">
        <TransitionGroup name="card-reveal" tag="div" class="reveal-track">
          <div
            v-for="(dish, idx) in revealedDishes"
            :key="dish.id"
            class="reveal-card"
            :class="{
              'is-latest': idx === revealedDishes.length - 1,
              'rank-top': idx === 0,
              'rank-second': idx === 1,
              'rank-third': idx === 2
            }"
            :style="{ '--reveal-delay': `${idx * 0.06}s` }"
          >
            <div class="reveal-rank">
              <span class="rank-num">#{{ idx + 1 }}</span>
              <span class="rank-score">{{ dish.contextualScore?.toFixed(1) }}</span>
            </div>
            <div class="reveal-body">
              <div class="reveal-thumb">
                <img
                  v-if="dish.imageUrl"
                  :src="dish.imageUrl"
                  :alt="dish.name"
                  loading="lazy"
                  @error="onImgError"
                />
                <span v-else class="dish-emoji large">{{ dish.image || '🍽️' }}</span>
              </div>
              <div class="reveal-info">
                <strong>{{ dish.name }}</strong>
                <small>{{ locationLabel(dish) }} · ¥{{ dish.price }} · {{ dish.taste }}</small>
                <div class="reveal-nutrition">
                  <span>{{ dish.nutrition.calories }}kcal</span>
                  <span>P{{ dish.nutrition.protein }}g</span>
                  <span>F{{ dish.nutrition.fat }}g</span>
                  <span>C{{ dish.nutrition.carbs }}g</span>
                </div>
                <div class="reason-text">{{ (dish.why || []).join(' · ') }}</div>
              </div>
              <div class="reveal-actions">
                <button
                  class="icon-btn"
                  :aria-label="isFavorite(dish.id) ? '取消收藏' : '收藏'"
                  :aria-pressed="isFavorite(dish.id)"
                  @click="onToggleFavorite(dish.id)"
                >
                  {{ isFavorite(dish.id) ? '★' : '☆' }}
                </button>
                <button class="icon-btn" aria-label="标记已吃" @click="onMarkEaten(dish.id)">
                  ✓
                </button>
                <RouterLink class="icon-btn order-link" :to="{ path: '/orders', query: { dish: dish.id } }" aria-label="去点这道菜">🛒</RouterLink>
              </div>
            </div>
          </div>
        </TransitionGroup>

        <div v-if="unrevealedCount > 0" class="unrevealed-stack">
          <div v-for="n in Math.min(unrevealedCount, 3)" :key="n" class="unrevealed-card" :style="{ '--stack-i': n }">
            <span class="unrevealed-label">{{ unrevealedCount - n + 1 }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Favorites Panel ────────────────────────────────── -->
    <section v-if="route.query.panel === 'favorites'" class="card favorites-panel">
      <div class="section-title horizontal">
        <div>
          <h2>⭐ 收藏菜品</h2>
          <p class="muted">你收藏的常吃选择。</p>
        </div>
        <span class="pill">{{ favoriteEntries.length }} 项</span>
      </div>
      <p v-if="!favoriteEntries.length" class="muted">
        还没有收藏。点击菜品旁的 ☆ 即可添加。
      </p>
      <div v-else class="dish-list dense">
        <div v-for="entry in favoriteEntries" :key="entry.id" class="dish-row dense">
          <div class="dish-thumb">
            <img
              v-if="entry.imageUrl"
              :src="entry.imageUrl"
              :alt="entry.name"
              loading="lazy"
              @error="onImgError"
            />
            <span v-else class="dish-emoji">{{ entry.image || '🍽️' }}</span>
          </div>
          <div class="dish-info">
            <strong>{{ entry.name }}</strong>
            <small>¥{{ entry.price }} · {{ entry.taste }} · {{ entry.nutrition?.calories }}kcal</small>
          </div>
          <div class="dish-actions">
            <button class="icon-btn" aria-label="取消收藏" @click="onToggleFavorite(entry.id)">★</button>
            <button class="icon-btn" aria-label="标记已吃" @click="onMarkEaten(entry.id)">✓</button>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Frequent / Eaten Panel ─────────────────────────── -->
    <section v-if="route.query.panel === 'favorites'" class="card favorites-panel">
      <div class="section-title horizontal">
        <div>
          <h2>📊 吃过统计</h2>
          <p class="muted">你标记过的菜品与抽取次数。</p>
        </div>
        <span class="pill">{{ eatenEntries.length }} 项</span>
      </div>
      <p v-if="!eatenEntries.length" class="muted">
        还没有记录。点击菜品旁的 ✓ 标记已吃。
      </p>
      <div v-else class="dish-list dense">
        <div v-for="entry in eatenEntries" :key="entry.dishId" class="dish-row dense">
          <div class="dish-thumb">
            <img
              v-if="dishById(entry.dishId)?.imageUrl"
              :src="dishById(entry.dishId).imageUrl"
              :alt="dishById(entry.dishId)?.name || ''"
              loading="lazy"
              @error="onImgError"
            />
            <span v-else class="dish-emoji">{{ dishById(entry.dishId)?.image || '🍽️' }}</span>
          </div>
          <div class="dish-info">
            <strong>{{ dishById(entry.dishId)?.name || entry.dishId }}</strong>
            <small>
              吃过 <b>{{ entry.eatenCount }}</b> 次 · 抽取 <b>{{ entry.drawnCount }}</b> 次
            </small>
          </div>
          <div class="dish-actions">
            <button
              class="icon-btn"
              :aria-label="entry.favorite ? '取消收藏' : '收藏'"
              @click="onToggleFavorite(entry.dishId)"
            >
              {{ entry.favorite ? '★' : '☆' }}
            </button>
          </div>
        </div>
      </div>
    </section>
  </template>
</template>

<script setup>
import { computed, reactive, ref, watch, onMounted } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { normalizeProfileInput } from '../domain/validation.js';
import { useCanteenStore } from '../stores/canteenStore.js';
const route = useRoute();

/* ─── Store ──────────────────────────────────────────────── */
const store = useCanteenStore();

/* ─── Page State ─────────────────────────────────────────── */
const pageLoading = ref(false);
const pageError = ref('');
const saving = ref(false);
const profileMessage = ref('');
const profileIsError = ref(false);

const tasteOptions = ['不限', '咸鲜', '麻辣', '酸辣', '黑椒', '清淡', '甜味', '酱香'];

const nutritionFocusOptions = [
  { value: 'highProtein', label: '高蛋白' },
  { value: 'lowFat', label: '低脂' },
  { value: 'lowCarb', label: '低碳水' },
  { value: 'highFiber', label: '高纤维' },
  { value: 'lowSodium', label: '低钠' },
  { value: 'lowSugar', label: '低糖' }
];

/* ─── Profile Form ───────────────────────────────────────── */
const form = reactive({
  goal: store.profile.goal || 'healthy',
  mealType: store.profile.mealType || 'lunch',
  budgetMax: store.profile.budgetMax ?? 20,
  taste: store.profile.taste || '不限',
  halalOnly: Boolean(store.profile.halalOnly),
  dietaryPattern: store.profile.dietaryPattern || 'balanced',
  spiceLevel: store.profile.spiceLevel ?? 3,
  nutritionFocus: Array.isArray(store.profile.nutritionFocus) ? [...store.profile.nutritionFocus] : [],
  favoriteTags: Array.isArray(store.profile.favoriteTags) ? [...store.profile.favoriteTags] : [],
  preferLowCrowd: Boolean(store.profile.preferLowCrowd)
});

const avoidText = ref(Array.isArray(store.profile.avoid) ? store.profile.avoid.join(', ') : '');
const favoriteTagsText = ref(Array.isArray(store.profile.favoriteTags) ? store.profile.favoriteTags.join(', ') : '');

watch(() => store.profile, (p) => {
  form.goal = p.goal || 'healthy';
  form.mealType = p.mealType || 'lunch';
  form.budgetMax = p.budgetMax ?? 20;
  form.taste = p.taste || '不限';
  form.halalOnly = Boolean(p.halalOnly);
  form.dietaryPattern = p.dietaryPattern || 'balanced';
  form.spiceLevel = p.spiceLevel ?? 3;
  form.nutritionFocus = Array.isArray(p.nutritionFocus) ? [...p.nutritionFocus] : [];
  form.favoriteTags = Array.isArray(p.favoriteTags) ? [...p.favoriteTags] : [];
  form.preferLowCrowd = Boolean(p.preferLowCrowd);
  avoidText.value = Array.isArray(p.avoid) ? p.avoid.join(', ') : '';
  favoriteTagsText.value = Array.isArray(p.favoriteTags) ? p.favoriteTags.join(', ') : '';
}, { deep: true });

function toggleNutritionFocus(value) {
  const idx = form.nutritionFocus.indexOf(value);
  if (idx === -1) form.nutritionFocus.push(value);
  else form.nutritionFocus.splice(idx, 1);
}

/* ─── Recommendation Data (from store) ───────────────────── */
const rankedDishes = computed(() => store.contextualRecommendation.ranked || []);
const serverContext = computed(() => store.contextualRecommendation.context || null);
const planReason = computed(() => store.contextualRecommendation.plan?.reason || store.recommendation.reason || '');
const goalLabel = computed(() => store.contextualRecommendation.plan?.goalLabel || store.contextualRecommendation.goalLabel || store.recommendation.goalLabel || '健康饮食');
const planTotals = computed(() => store.contextualRecommendation.plan?.totals || store.contextualRecommendation.totals || store.recommendation.totals || null);

const sourceLabel = computed(() => {
  const src = store.contextualRecommendation.source;
  if (src === 'menu') return '今日供应优先';
  if (src === 'fallback') return '菜品库兜底';
  if (store.todayMenu.dishes.length) return '今日供应优先';
  return '';
});

const timeLabel = computed(() => {
  const timeOfDay = serverContext.value?.timeOfDay;
  const map = { breakfast: '早餐时段', lunch: '午餐时段', dinner: '晚餐时段' };
  const label = map[timeOfDay] || '午餐时段';
  const now = new Date();
  return `${label} · ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
});

const weatherIcon = computed(() => {
  const w = (serverContext.value?.environment?.weatherLabel || '').toLowerCase();
  if (w.includes('雨')) return '🌧️';
  if (w.includes('雪')) return '❄️';
  if (w.includes('晴')) return '☀️';
  if (w.includes('云') || w.includes('阴')) return '⛅';
  return '🌤️';
});

const crowdStrategyLabel = computed(() => {
  const pref = store.profile.preferLowCrowd;
  if (pref) return '低人流优先策略';
  const temp = serverContext.value?.environment?.temperature;
  if (temp != null) {
    if (temp >= 35) return '高温天气，建议清淡消暑';
    if (temp <= 5) return '低温天气，推荐暖胃热食';
  }
  return '综合评分排序';
});

/* ─── Dish Preferences (from store) ──────────────────────── */
const prefMap = computed(() => {
  const map = new Map();
  for (const p of store.dishPreferences) {
    map.set(p.dishId, p);
  }
  return map;
});

function isFavorite(dishId) {
  return prefMap.value.get(dishId)?.favorite === true;
}

const favoriteEntries = computed(() => {
  return store.dishPreferences
    .filter((p) => p.favorite)
    .map((p) => {
      const dish = dishById(p.dishId);
      return dish ? { ...dish, pref: p } : { id: p.dishId, name: p.dishId, image: '🍽️', imageUrl: '', price: 0, taste: '', nutrition: {}, pref: p };
    });
});

const eatenEntries = computed(() => {
  return store.dishPreferences
    .filter((p) => (p.eatenCount || 0) > 0 || (p.drawnCount || 0) > 0)
    .sort((a, b) => (b.eatenCount || 0) - (a.eatenCount || 0) || (b.drawnCount || 0) - (a.drawnCount || 0));
});

/* ─── Store Action Wrappers ──────────────────────────────── */
async function onToggleFavorite(dishId) {
  try {
    await store.toggleFavorite(dishId);
  } catch (err) {
    profileMessage.value = `收藏操作失败：${err.message}`;
    profileIsError.value = true;
  }
}

async function onMarkEaten(dishId) {
  try {
    await store.markDishEaten(dishId);
  } catch (err) {
    profileMessage.value = `标记失败：${err.message}`;
    profileIsError.value = true;
  }
}

/* ─── Reveal Track State ─────────────────────────────────── */
const revealIndex = ref(0);
const revealedIds = ref([]);

const revealedDishes = computed(() => {
  return revealedIds.value
    .map((id) => rankedDishes.value.find((d) => d.id === id))
    .filter(Boolean);
});

const unrevealedCount = computed(() => Math.max(0, rankedDishes.value.length - revealIndex.value));

async function revealNext() {
  if (revealIndex.value >= rankedDishes.value.length) return;
  const dish = rankedDishes.value[revealIndex.value];
  revealedIds.value.push(dish.id);
  revealIndex.value++;
  try {
    await store.recordDishDrawn(dish.id);
  } catch { /* non-blocking */ }
}

function resetReveal() {
  revealIndex.value = 0;
  revealedIds.value = [];
}

/* ─── Profile Save ───────────────────────────────────────── */
async function saveProfile() {
  saving.value = true;
  profileMessage.value = '';
  profileIsError.value = false;
  try {
    const payload = {
      goal: form.goal,
      mealType: form.mealType,
      budgetMax: Number(form.budgetMax),
      taste: form.taste,
      halalOnly: form.halalOnly,
      dietaryPattern: form.dietaryPattern,
      spiceLevel: form.spiceLevel,
      nutritionFocus: [...form.nutritionFocus],
      preferLowCrowd: form.preferLowCrowd,
      favoriteTags: favoriteTagsText.value.split(/[，,]+/).map((s) => s.trim()).filter(Boolean),
      avoid: avoidText.value.split(/[，,]+/).map((s) => s.trim()).filter(Boolean)
    };
    await store.saveProfile(normalizeProfileInput(payload, avoidText.value));
    await store.loadRecommendation();
    profileMessage.value = '健康档案已保存，推荐已刷新。';
    revealIndex.value = 0;
    revealedIds.value = [];
  } catch (err) {
    profileMessage.value = err.message || '保存失败';
    profileIsError.value = true;
  } finally {
    saving.value = false;
  }
}

/* ─── Helpers ────────────────────────────────────────────── */
function dishById(id) {
  return store.dishes.find((d) => d.id === id) || null;
}

function locationLabel(dish) {
  if (dish.canteenName && dish.stallName) return `${dish.canteenName} ${dish.stallName}`;
  const stall = store.stalls.find((s) => s.id === dish.stallId);
  if (!stall) return '';
  const canteen = store.canteens.find((c) => c.id === stall.canteenId);
  return canteen ? `${canteen.name} ${stall.name}` : stall.name;
}

function breakdownTitle(dish) {
  if (!dish.scoreBreakdown) return '';
  const b = dish.scoreBreakdown;
  const parts = [];
  if (b.goal != null) parts.push(`目标营养: ${b.goal}`);
  if (b.rating != null) parts.push(`评分热度: ${b.rating}`);
  if (b.budget != null) parts.push(`预算匹配: ${b.budget}`);
  if (b.weather != null) parts.push(`天气适配: ${b.weather}`);
  if (b.crowd != null) parts.push(`人流偏好: ${b.crowd}`);
  if (b.preference != null) parts.push(`个人偏好: ${b.preference}`);
  if (b.nutritionFocus != null) parts.push(`营养关注: ${b.nutritionFocus}`);
  if (b.spice != null) parts.push(`辣度匹配: ${b.spice}`);
  if (b.tags != null) parts.push(`标签匹配: ${b.tags}`);
  if (b.timeBonus != null) parts.push(`时段加分: ${b.timeBonus}`);
  return parts.join('\n');
}

function onImgError(event) {
  event.target.style.display = 'none';
  const sibling = event.target.nextElementSibling || event.target.parentElement.querySelector('.dish-emoji');
  if (sibling) sibling.style.display = '';
}

/* ─── Lifecycle ──────────────────────────────────────────── */
onMounted(async () => {
  pageLoading.value = true;
  pageError.value = '';
  try {
    if (!store.dishes.length) {
      await store.load();
    }
    await store.loadRecommendation();
  } catch (err) {
    pageError.value = err.message || '加载失败';
  } finally {
    pageLoading.value = false;
  }
});

async function reload() {
  pageLoading.value = true;
  pageError.value = '';
  try {
    await store.load();
    await store.loadRecommendation();
  } catch (err) {
    pageError.value = err.message || '加载失败';
  } finally {
    pageLoading.value = false;
  }
}
</script>

<style scoped>
/* ── Context Banner ──────────────────────────────────────── */
.context-banner {
  margin-bottom: 24px;
  padding: 16px 20px;
}
.context-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.ctx-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 6px 14px;
  background: linear-gradient(135deg, rgba(235, 247, 229, .86), rgba(255, 255, 255, .68));
  color: var(--primary-dark, #115b37);
  font-size: 13px;
  font-weight: 650;
  box-shadow: inset 0 0 0 1px rgba(31, 122, 77, .07);
}
.ctx-icon {
  font-size: 15px;
  line-height: 1;
}

/* ── State Cards ─────────────────────────────────────────── */
.state-card {
  text-align: center;
  padding: 52px 24px;
}
.state-icon {
  font-size: 42px;
  margin-bottom: 12px;
}
.state-card.error {
  border-color: rgba(196, 83, 60, .2);
}

/* ── Profile Form ────────────────────────────────────────── */
.profile-form {
  position: sticky;
  top: 24px;
}
.tag-fieldset {
  border: 1px solid rgba(191, 211, 181, .4);
  border-radius: 15px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, .42);
}
.tag-fieldset legend {
  font-weight: 650;
  color: var(--muted, #64705f);
  padding: 0 6px;
  font-size: 14px;
}
.tag-toggle-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pill-toggle {
  border-radius: 999px;
  padding: 5px 12px;
  border: 1px solid rgba(191, 211, 181, .5);
  background: rgba(255, 255, 255, .6);
  color: var(--muted, #64705f);
  font-size: 13px;
  font-weight: 620;
  cursor: pointer;
  transition: all .2s var(--ease, cubic-bezier(.2,.8,.2,1));
}
.pill-toggle.active {
  background: linear-gradient(135deg, var(--primary, #1f7a4d), #36a367);
  color: white;
  border-color: var(--primary, #1f7a4d);
  box-shadow: 0 4px 14px rgba(31, 122, 77, .22);
}
.pill-toggle:hover:not(.active) {
  border-color: rgba(31, 122, 77, .3);
  background: rgba(235, 247, 229, .6);
}
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(90deg, var(--primary, #1f7a4d) 0%, var(--accent, #ffb43b) 100%);
  border: none;
  padding: 0;
}
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: white;
  border: 2px solid var(--primary, #1f7a4d);
  box-shadow: 0 2px 8px rgba(31, 122, 77, .24);
  cursor: pointer;
}

/* ── Recommendation Card ─────────────────────────────────── */
.recommendation-card {
  min-height: 300px;
}
.top-pick {
  margin-top: 16px;
  border-radius: 20px;
  padding: 16px;
  background: linear-gradient(135deg, rgba(235, 247, 229, .72), rgba(255, 255, 255, .6));
  border: 1px solid rgba(31, 122, 77, .12);
}
.top-pick-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.rank-badge {
  font-weight: 760;
  color: var(--primary-dark, #115b37);
  font-size: 14px;
}
.score-detail {
  font-family: var(--font-display, sans-serif);
  font-weight: 780;
  font-size: 22px;
  color: var(--primary, #1f7a4d);
  cursor: help;
}
.top-pick-row {
  background: transparent;
  border: none;
  box-shadow: none;
  padding: 0;
}
.top-pick-row:hover {
  transform: none;
}

/* ── Dish Row ────────────────────────────────────────────── */
.dish-row.dense {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(238, 246, 232, .78), rgba(255, 255, 255, .64));
  border: 1px solid rgba(255, 255, 255, .62);
  transition: transform .22s var(--ease, cubic-bezier(.2,.8,.2,1)), box-shadow .22s var(--ease);
}
.dish-row.dense + .dish-row.dense {
  margin-top: 8px;
}
.dish-row.dense:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(24, 72, 43, .08);
}
.dish-thumb {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  overflow: hidden;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  background: rgba(244, 250, 239, .8);
}
.dish-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.dish-emoji {
  font-size: 24px;
  line-height: 1;
}
.dish-emoji.large {
  font-size: 42px;
}
.dish-info {
  flex: 1;
  min-width: 0;
}
.dish-info strong {
  display: block;
  font-weight: 720;
  letter-spacing: -.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dish-info small {
  color: var(--muted, #64705f);
  display: block;
  margin-top: 2px;
  font-size: 13px;
}
.reason-text {
  color: var(--primary, #1f7a4d);
  font-size: 12px;
  font-weight: 620;
  margin-top: 4px;
  line-height: 1.4;
}
.dish-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

/* ── Icon Button ─────────────────────────────────────────── */
.icon-btn {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  border: 1px solid rgba(191, 211, 181, .4);
  background: rgba(255, 255, 255, .7);
  display: grid;
  place-items: center;
  font-size: 16px;
  cursor: pointer;
  transition: all .18s var(--ease, cubic-bezier(.2,.8,.2,1));
  padding: 0;
}
.icon-btn:hover {
  background: rgba(235, 247, 229, .8);
  border-color: rgba(31, 122, 77, .24);
  transform: translateY(-1px);
}
.icon-btn[aria-pressed="true"] {
  background: linear-gradient(135deg, rgba(255, 180, 59, .2), rgba(255, 223, 130, .3));
  border-color: rgba(255, 180, 59, .3);
  color: #b87a00;
}

/* ── Extended Nutrition Grid ─────────────────────────────── */
.nutrition-grid.extended {
  grid-template-columns: repeat(3, 1fr);
  margin-top: 12px;
}
.nutrition-grid.extended span {
  border-radius: 14px;
  padding: 10px;
  background: linear-gradient(180deg, rgba(255, 255, 255, .78), rgba(245, 250, 239, .76));
  border: 1px solid rgba(255, 255, 255, .7);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .86);
  text-align: center;
}
.nutrition-grid.extended strong {
  display: block;
  font-family: var(--font-display, sans-serif);
  font-size: 16px;
  font-weight: 760;
  letter-spacing: -.02em;
}
.nutrition-grid.extended small {
  display: block;
  color: var(--muted, #64705f);
  font-size: 11px;
  margin-top: 2px;
}

/* ── Score Reasons ───────────────────────────────────────── */
.reason-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}
.reason-chip {
  border-radius: 999px;
  padding: 4px 10px;
  background: linear-gradient(135deg, rgba(235, 247, 229, .86), rgba(255, 255, 255, .68));
  color: var(--primary-dark, #115b37);
  font-size: 12px;
  font-weight: 620;
  box-shadow: inset 0 0 0 1px rgba(31, 122, 77, .07);
}

/* ── Totals ──────────────────────────────────────────────── */
.nutrition-grid.totals {
  grid-template-columns: repeat(3, 1fr);
}

/* ── Empty State ─────────────────────────────────────────── */
.empty-state {
  text-align: center;
  padding: 42px 20px;
  color: var(--muted, #64705f);
}

/* ── Reveal Section ──────────────────────────────────────── */
.reveal-section {
  margin-top: 24px;
}
.reveal-controls {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}
.reveal-reel {
  position: relative;
  min-height: 120px;
  margin-top: 16px;
  overflow: hidden;
  border-radius: 20px;
  padding: 16px;
  background: linear-gradient(145deg, rgba(235, 247, 229, .4), rgba(255, 255, 255, .3));
  border: 1px dashed rgba(31, 122, 77, .15);
}
.reveal-track {
  display: grid;
  gap: 12px;
  position: relative;
}

/* ── Reveal Card Animation ───────────────────────────────── */
.card-reveal-enter-active {
  transition: all .5s var(--ease, cubic-bezier(.2,.8,.2,1));
}
.card-reveal-enter-from {
  opacity: 0;
  transform: translateX(40px) scale(.92);
}

.reveal-card {
  display: flex;
  align-items: stretch;
  gap: 14px;
  padding: 14px;
  border-radius: 20px;
  background: linear-gradient(145deg, rgba(255, 255, 255, .84), rgba(244, 250, 239, .68));
  border: 1px solid rgba(255, 255, 255, .72);
  box-shadow: var(--shadow-soft, 0 16px 42px rgba(24, 72, 43, .1));
  animation: card-slide-in .5s var(--ease, cubic-bezier(.2,.8,.2,1)) both;
  animation-delay: var(--reveal-delay, 0s);
}
.reveal-card.rank-top {
  border-color: rgba(31, 122, 77, .28);
  box-shadow: 0 12px 32px rgba(31, 122, 77, .12);
}
.reveal-card.rank-second {
  border-color: rgba(255, 180, 59, .2);
}
.reveal-card.rank-third {
  border-color: rgba(255, 180, 59, .12);
}
.reveal-card.is-latest {
  animation: card-pop .55s var(--ease, cubic-bezier(.2,.8,.2,1)) both;
}

.reveal-rank {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 52px;
  padding: 8px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--primary, #1f7a4d), #36a367);
  color: white;
  flex-shrink: 0;
}
.rank-num {
  font-family: var(--font-display, sans-serif);
  font-weight: 780;
  font-size: 18px;
  letter-spacing: -.02em;
}
.rank-score {
  font-size: 11px;
  font-weight: 650;
  opacity: .85;
}

.reveal-body {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}
.reveal-thumb {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  overflow: hidden;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  background: rgba(244, 250, 239, .8);
}
.reveal-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.reveal-info {
  flex: 1;
  min-width: 0;
}
.reveal-info strong {
  display: block;
  font-weight: 730;
  letter-spacing: -.01em;
}
.reveal-info small {
  display: block;
  color: var(--muted, #64705f);
  font-size: 13px;
  margin-top: 2px;
}
.reveal-nutrition {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.reveal-nutrition span {
  font-size: 11px;
  font-weight: 620;
  color: var(--primary-dark, #115b37);
  background: rgba(235, 247, 229, .6);
  padding: 2px 7px;
  border-radius: 8px;
}
.reveal-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}

/* ── Unrevealed Stack ────────────────────────────────────── */
.unrevealed-stack {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  justify-content: center;
}
.unrevealed-card {
  width: 64px;
  height: 80px;
  border-radius: 16px;
  background: linear-gradient(145deg, rgba(31, 122, 77, .18), rgba(255, 180, 59, .14));
  border: 2px dashed rgba(31, 122, 77, .2);
  display: grid;
  place-items: center;
  transform: translateY(calc(var(--stack-i, 0) * -4px));
  transition: transform .2s var(--ease, cubic-bezier(.2,.8,.2,1));
}
.unrevealed-card:hover {
  transform: translateY(calc(var(--stack-i, 0) * -4px - 3px));
}
.unrevealed-label {
  font-family: var(--font-display, sans-serif);
  font-weight: 780;
  font-size: 20px;
  color: var(--primary, #1f7a4d);
  opacity: .5;
}

/* ── Favorites / Eaten Panel ─────────────────────────────── */
.favorites-panel {
  margin-top: 24px;
}

/* ── Keyframes ───────────────────────────────────────────── */
@keyframes card-slide-in {
  from {
    opacity: 0;
    transform: translateX(32px) scale(.95);
  }
  to {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}
@keyframes card-pop {
  0% {
    opacity: 0;
    transform: translateX(48px) scale(.88) rotateY(8deg);
  }
  60% {
    opacity: 1;
    transform: translateX(-4px) scale(1.02) rotateY(-1deg);
  }
  100% {
    opacity: 1;
    transform: translateX(0) scale(1) rotateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .reveal-card,
  .card-reveal-enter-active {
    animation: none !important;
    transition: none !important;
  }
}

.order-link { text-decoration: none; display: inline-flex; align-items: center; justify-content: center; font-size: 16px; }
.empty-actions { display: flex; gap: 12px; margin-top: 12px; flex-wrap: wrap; }

/* ── Responsive ──────────────────────────────────────────── */
@media (max-width: 900px) {
  .grid.two-columns {
    grid-template-columns: 1fr;
  }
  .profile-form {
    position: static;
  }
  .nutrition-grid.extended {
    grid-template-columns: repeat(3, 1fr);
  }
  .reveal-body {
    flex-wrap: wrap;
  }
}
@media (max-width: 640px) {
  .context-chips {
    gap: 6px;
  }
  .ctx-chip {
    font-size: 12px;
    padding: 4px 10px;
  }
  .reveal-card {
    flex-direction: column;
  }
  .reveal-rank {
    flex-direction: row;
    min-width: auto;
    padding: 6px 12px;
    gap: 8px;
  }
  .nutrition-grid.extended {
    grid-template-columns: repeat(2, 1fr);
  }
  .reveal-controls {
    flex-direction: column;
    width: 100%;
  }
  .reveal-controls button {
    width: 100%;
  }
  .dish-row.dense {
    flex-wrap: wrap;
  }
  .dish-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
