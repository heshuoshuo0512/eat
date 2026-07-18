<template>
  <sc-page-shell back title="校园排行榜" subtitle="菜品 · 档口 · 食堂" status="实时评分">
    <view class="hero-panel ranking-hero">
      <text class="hero-kicker">CAMPUS RANKING</text>
      <text class="hero-title">先看口碑，再决定去哪吃。</text>
      <text class="hero-subtitle">综合评分、评价数量和真实供应数据，快速找到今天更值得去的菜与窗口。</text>
    </view>

    <sc-state-card v-if="store.loading.value" type="loading" title="正在更新排行榜" desc="评分与菜品数据正在同步。" />
    <sc-state-card v-else-if="store.error.value" type="error" title="排行榜加载失败" :desc="store.error.value" action-text="重试" @action="reload" />

    <template v-else>
      <!-- Three compact cards -->
      <view class="rank-compact-row">
        <view
          class="rank-compact-card"
          :class="{ active: activeTab === 'dishes' }"
          @tap="toggleTab('dishes')"
        >
          <view class="compact-header">
            <text class="compact-eyebrow">DISHES</text>
            <text class="compact-title">菜品乐榜</text>
          </view>
          <view class="compact-preview" v-if="topDish">
            <text class="compact-rankno">1</text>
            <view class="compact-info">
              <text class="compact-name">{{ topDish.name }}</text>
              <text class="compact-score">{{ topDish.rankScore }} 分</text>
            </view>
          </view>
          <view class="compact-footer">{{ activeTab === 'dishes' ? '收回 ▴' : '展开 ▾' }}</view>
        </view>

        <view
          class="rank-compact-card"
          :class="{ active: activeTab === 'stalls' }"
          @tap="toggleTab('stalls')"
        >
          <view class="compact-header">
            <text class="compact-eyebrow">STALLS</text>
            <text class="compact-title">档口口碑榜</text>
          </view>
          <view class="compact-preview" v-if="topStall">
            <text class="compact-rankno">1</text>
            <view class="compact-info">
              <text class="compact-name">{{ topStall.name }}</text>
              <text class="compact-score">{{ topStall.rankScore }} 分</text>
            </view>
          </view>
          <view class="compact-footer">{{ activeTab === 'stalls' ? '收回 ▴' : '展开 ▾' }}</view>
        </view>

        <view
          class="rank-compact-card"
          :class="{ active: activeTab === 'canteens' }"
          @tap="toggleTab('canteens')"
        >
          <view class="compact-header">
            <text class="compact-eyebrow">CANTEENS</text>
            <text class="compact-title">食堂综合榜</text>
          </view>
          <view class="compact-preview" v-if="topCanteen">
            <text class="compact-rankno">1</text>
            <view class="compact-info">
              <text class="compact-name">{{ topCanteen.name }}</text>
              <text class="compact-score">{{ topCanteen.rankScore }} 分</text>
            </view>
          </view>
          <view class="compact-footer">{{ activeTab === 'canteens' ? '收回 ▴' : '展开 ▾' }}</view>
        </view>
      </view>

      <!-- Detail: 菜品乐榜 -->
      <view v-if="activeTab === 'dishes'" class="rank-detail">
        <view class="detail-toolbar">
          <text class="detail-label">分类：</text>
          <scroll-view class="filter-scroll" scroll-x enable-flex>
            <view
              v-for="cuisine in cuisineOptions"
              :key="cuisine"
              class="filter-chip"
              :class="{ active: cuisineFilter === cuisine }"
              @tap="cuisineFilter = cuisine"
            >{{ cuisine }}</view>
          </scroll-view>
        </view>
        <view class="detail-list">
          <view
            v-for="(dish, index) in filteredDishes"
            :key="dish.id"
            class="detail-row"
            @tap="openDishDetail(dish.id)"
          >
            <text class="rank-no" :class="`rank-${index + 1}`">{{ index + 1 }}</text>
            <view class="flex-1">
              <text class="main-text">{{ dish.name }}</text>
              <text class="sub-text">{{ dish.cuisine }} · {{ dish.computedReviewCount || dish.reviewCount || 0 }} 条评价</text>
            </view>
            <view class="score">
              <text>{{ dish.computedRating || dish.rating || '—' }}</text>
              <text>分</text>
            </view>
          </view>
          <sc-state-card v-if="!filteredDishes.length" type="empty" title="暂无该类菜品排行" desc="试试其他分类。" />
        </view>
      </view>

      <!-- Detail: 档口口碑榜 -->
      <view v-if="activeTab === 'stalls'" class="rank-detail">
        <view class="detail-list">
          <view v-for="(stall, index) in store.rankings.value.stalls" :key="stall.id" class="detail-row">
            <text class="rank-no">{{ index + 1 }}</text>
            <view class="flex-1">
              <text class="main-text">{{ stall.name }}</text>
              <text class="sub-text">{{ stall.floor || '' }}{{ stall.floor ? ' · ' : '' }}{{ stall.dishCount || 0 }} 道菜 · {{ stall.computedReviewCount || stall.reviewCount || 0 }} 条评价</text>
            </view>
            <text class="pill orange">{{ stall.rankScore }}</text>
          </view>
          <sc-state-card v-if="!store.rankings.value.stalls.length" type="empty" title="暂无档口排行" />
        </view>
      </view>

      <!-- Detail: 食堂综合榜 -->
      <view v-if="activeTab === 'canteens'" class="rank-detail">
        <view class="detail-list">
          <view v-for="(canteen, index) in store.rankings.value.canteens" :key="canteen.id" class="detail-row">
            <text class="rank-no">{{ index + 1 }}</text>
            <view class="flex-1">
              <text class="main-text">{{ canteen.name }}</text>
              <text class="sub-text">{{ canteen.location || '' }}{{ canteen.location ? ' · ' : '' }}{{ canteen.stallCount || 0 }} 个档口</text>
            </view>
            <text class="pill">{{ canteen.rankScore }}</text>
          </view>
          <sc-state-card v-if="!store.rankings.value.canteens.length" type="empty" title="暂无食堂排行" />
        </view>
      </view>
    </template>
  </sc-page-shell>
</template>

<script setup>
import { ref, computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const activeTab = ref(null);
const cuisineFilter = ref('全部');

function toggleTab(tab) {
  activeTab.value = activeTab.value === tab ? null : tab;
  if (tab === 'dishes') cuisineFilter.value = '全部';
}

const topDish = computed(() => store.rankings.value.dishes?.[0] || null);
const topStall = computed(() => store.rankings.value.stalls?.[0] || null);
const topCanteen = computed(() => store.rankings.value.canteens?.[0] || null);

const cuisineOptions = computed(() => {
  const cuisines = new Set();
  cuisines.add('全部');
  for (const dish of store.rankings.value.dishes) {
    if (dish.cuisine) cuisines.add(dish.cuisine);
  }
  return [...cuisines];
});

const filteredDishes = computed(() => {
  const dishes = store.rankings.value.dishes;
  if (cuisineFilter.value === '全部') return dishes;
  return dishes.filter(d => d.cuisine === cuisineFilter.value);
});

function openDishDetail(id) {
  uni.navigateTo({ url: `/pages/dish-detail/dish-detail?id=${encodeURIComponent(id)}` });
}

onShow(async () => {
  if (!store.user.value) uni.redirectTo({ url: '/pages/login/login' });
  else if (!store.loaded.value) await store.load();
});
async function reload() { await store.load(); }
</script>

<style scoped>
.ranking-hero { margin-bottom: 20rpx; }

.rank-compact-row {
  display: flex;
  gap: 14rpx;
  margin-bottom: 20rpx;
}

.rank-compact-card {
  flex: 1;
  background: #fff;
  border-radius: 20rpx;
  padding: 18rpx 14rpx;
  box-shadow: 0 2rpx 8rpx rgba(0,0,0,0.04);
}

.rank-compact-card.active {
  box-shadow: 0 0 0 2rpx #167a5b, 0 2rpx 8rpx rgba(0,0,0,0.06);
}

.compact-header { margin-bottom: 12rpx; }
.compact-eyebrow { display: block; color: #00a874; font-size: 17rpx; font-weight: 900; letter-spacing: 1rpx; text-transform: uppercase; }
.compact-title { display: block; margin-top: 3rpx; color: #18232a; font-size: 24rpx; font-weight: 950; line-height: 1.15; }

.compact-preview {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 10rpx 8rpx;
  background: #f8fbf9;
  border-radius: 12rpx;
}

.compact-rankno {
  display: flex; align-items: center; justify-content: center;
  width: 34rpx; height: 34rpx; border-radius: 10rpx;
  color: #fff; background: #167a5b;
  font-size: 17rpx; font-weight: 900;
  flex-shrink: 0;
}

.compact-info { min-width: 0; }
.compact-name { display: block; font-size: 21rpx; font-weight: 800; color: #18251f; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.compact-score { display: block; margin-top: 1rpx; font-size: 18rpx; color: #167a5b; font-weight: 700; }

.compact-footer {
  margin-top: 10rpx;
  text-align: center;
  font-size: 18rpx;
  color: #84918a;
  font-weight: 600;
}

.rank-detail {
  background: #fff;
  border-radius: 20rpx;
  padding: 24rpx 20rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 2rpx 8rpx rgba(0,0,0,0.04);
}

.detail-toolbar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 20rpx;
}

.detail-label {
  font-size: 22rpx;
  color: #84918a;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

.filter-scroll {
  white-space: nowrap;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.filter-scroll::-webkit-scrollbar { display: none; }

.filter-chip {
  display: inline-flex;
  align-items: center;
  padding: 8rpx 20rpx;
  margin-right: 10rpx;
  border-radius: 999rpx;
  background: #f3f6f4;
  color: #495a56;
  font-size: 20rpx;
  font-weight: 700;
  white-space: nowrap;
}

.filter-chip.active {
  background: #167a5b;
  color: #fff;
}

.detail-list {
  display: flex;
  flex-direction: column;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 18rpx 0;
  border-bottom: 1rpx solid #edf1ee;
}

.detail-row:last-child { border-bottom: 0; }

.rank-no {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42rpx;
  height: 42rpx;
  border-radius: 13rpx;
  color: #167a5b;
  background: #edf7f1;
  font-size: 22rpx;
  font-weight: 900;
  flex-shrink: 0;
}

.rank-no.rank-1 { color: #fff; background: #167a5b; }
.rank-no.rank-2 { color: #fff; background: #56a887; }
.rank-no.rank-3 { color: #fff; background: #91bea8; }

.flex-1 { flex: 1; min-width: 0; }
.main-text { display: block; font-size: 26rpx; font-weight: 800; color: #18232a; }
.sub-text { display: block; margin-top: 4rpx; font-size: 20rpx; color: #84918a; }

.score { color: #167a5b; font-size: 24rpx; font-weight: 900; }
.score text:last-child { margin-left: 3rpx; color: #84918a; font-size: 18rpx; font-weight: 500; }
</style>
