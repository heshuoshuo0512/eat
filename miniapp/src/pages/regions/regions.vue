<template>
  <sc-page-shell back title="地区口味推荐" subtitle="逐条菜品证据归类" tone="explore">
    <view class="region-intro">
      <text class="ui-strong">按地域风味选择</text>
      <text class="ui-small">粤菜、川湘菜等分组来自每条菜品的名称、菜系、标签、档口和来源证据；餐食、面食只是辅助信息。</text>
    </view>
    <sc-state-card v-if="loading" type="loading" title="正在逐条分析菜品地域证据" />
    <sc-state-card v-else-if="error" type="error" title="区域数据加载失败" :desc="error" />
    <view v-else-if="regions.length" class="region-grid">
      <sc-list-row
        v-for="(region,index) in regions"
        :key="region.id"
        class="region-card"
        icon-name="location"
        :title="region.name"
        :description="regionDescription(region)"
        :meta="regionMeta(region)"
        :badge="`${region.count || 0} 道`"
        :style="entryStyle(index)"
        @tap="openRegion(region.id)"
      />
    </view>
    <sc-state-card v-else type="empty" title="暂无可展示的地域风味" desc="当前分区的菜品还没有足够地域证据，等待人工核验。" />
  </sc-page-shell>
</template>

<script setup>
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const regions = ref([]);
const loading = ref(false);
const error = ref('');

async function loadRegions() {
  loading.value = true;
  error.value = '';
  try {
    const result = await store.loadCatalogRegions('');
    regions.value = result.regions || [];
  } catch (err) {
    regions.value = [];
    error.value = err.message || '请稍后重试';
  } finally {
    loading.value = false;
  }
}

onShow(async () => {
  try {
    await store.refreshIfStale();
    if (!store.user.value) {
      uni.reLaunch({ url: '/pages/login/login' });
      return;
    }
    await loadRegions();
  } catch (err) {
    error.value = err.message || '请稍后重试';
  }
});

function regionDescription(region) {
  return [region.subtitle || '地域/风味', region.description || '逐条证据归类'].join(' · ');
}

function regionMeta(region) {
  const evidence = Number(region.evidenceCount || 0);
  const review = Number(region.needsReviewCount || 0);
  return `地域证据 ${evidence} 条${review ? ` · 待核验 ${review} 条` : ''}`;
}

function entryStyle(index) {
  return store.motionReduced.value ? {} : { animationDelay: `${index * 60}ms` };
}

function openRegion(id) {
  uni.navigateTo({ url: `/pages/region-detail/region-detail?id=${encodeURIComponent(id)}` });
}
</script>

<style scoped>
.region-intro { display: grid; gap: 4px; margin-bottom: 16px; }
.region-intro .ui-strong { color: var(--ink); font-size: 16px; }
.region-intro .ui-small { font-size: 14px; line-height: 1.5; }
.region-grid { padding: 0 12px; border: 1px solid var(--line); border-radius: var(--radius-large); background: var(--surface); }
.region-card { animation: region-in 200ms ease both; }
@keyframes region-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (min-width: 768px) {
  .region-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 24px; }
  .region-card:nth-last-child(2):nth-child(odd) { border-bottom: 0; }
}
</style>
