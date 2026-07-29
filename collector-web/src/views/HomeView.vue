<template>
  <div class="page">
    <div class="home-intro">
      <div>
        <span class="eyebrow">第一期 · 200 道高频菜</span>
        <h1>拍一道菜，补全校园菜品图库</h1>
        <p>选择所在采集区，提交单道菜照片并确认真实档口。审核通过后计入数据集。</p>
      </div>
      <router-link class="score" to="/me" aria-label="查看我的积分">
        <Award :size="22" />
        <span><strong>{{ me.points ?? 0 }}</strong><small>匿名积分</small></span>
        <ChevronRight :size="18" />
      </router-link>
    </div>

    <div v-if="error" class="notice error"><CircleAlert :size="18" />{{ error }}</div>
    <div v-if="loading" class="loading-row"><span class="spinner"></span><span>正在读取采集进度</span></div>
    <div v-else class="group-grid">
      <article v-for="(group, index) in groups" :key="group.id" class="group-card">
        <div class="group-index">0{{ index + 1 }}</div>
        <div class="group-top">
          <div><h2>{{ group.name }}</h2><p>{{ group.description }}</p></div>
          <span class="percent">{{ group.progress.percent }}%</span>
        </div>
        <div class="venue-list"><MapPin :size="14" /><span>{{ group.venues.map((item) => item.name).join('、') || '待配置餐饮区' }}</span></div>
        <div class="progress" role="progressbar" :aria-valuenow="group.progress.percent" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: `${group.progress.percent}%` }"></i></div>
        <div class="progress-meta"><span>{{ group.progress.approved }} 张已通过</span><span>目标 {{ group.progress.goal }} 张</span></div>
        <div class="needed">
          <span class="field-label">当前缺图</span>
          <div><span v-for="dish in group.neededDishes.slice(0, 4)" :key="dish.id">{{ dish.name }} {{ dish.approved }}/{{ dish.goal }}</span></div>
        </div>
        <router-link class="button" :to="`/groups/${encodeURIComponent(group.id)}/contribute`"><Camera :size="18" />提交照片</router-link>
      </article>
    </div>

    <div class="section-title"><h2>照片标准</h2><span>原图会自动清除 EXIF/GPS</span></div>
    <div class="guide-grid">
      <figure><img src="/guides/photo-good.jpg" alt="单道菜清晰居中示例" /><figcaption><CheckCircle2 :size="18" /><span><strong>可用于训练</strong>单道菜、清晰、完整入镜</span></figcaption></figure>
      <figure><img src="/guides/photo-bad.jpg" alt="多道菜模糊反例" /><figcaption class="bad"><XCircle :size="18" /><span><strong>会被驳回</strong>多道菜、模糊或包含个人信息</span></figcaption></figure>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { Award, Camera, CheckCircle2, ChevronRight, CircleAlert, MapPin, XCircle } from '@lucide/vue';
import { collectorApi } from '../api.js';

const groups = ref([]);
const me = reactive({ points: 0 });
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    const [groupResult, meResult] = await Promise.all([collectorApi.groups(), collectorApi.me()]);
    groups.value = groupResult.groups;
    Object.assign(me, meResult);
  } catch (reason) { error.value = reason.message; }
  finally { loading.value = false; }
});
</script>

<style scoped>
.home-intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; padding: 22px 0 30px; border-bottom: 1px solid var(--line); }
.eyebrow { color: var(--brand); font-size: 12px; font-weight: 700; }
h1 { max-width: 700px; margin: 7px 0 8px; font-size: clamp(28px, 4vw, 44px); line-height: 1.12; letter-spacing: 0; }
.home-intro p { margin: 0; color: var(--muted); line-height: 1.65; }
.score { display: grid; grid-template-columns: 24px auto 18px; align-items: center; gap: 10px; min-width: 178px; padding: 15px; border: 1px solid #d9c38f; border-radius: 6px; color: #76500c; background: var(--amber-soft); }
.score strong, .score small { display: block; }.score strong { font-size: 22px; }.score small { margin-top: 2px; font-size: 11px; }
.loading-row { display: flex; align-items: center; justify-content: center; gap: 12px; min-height: 240px; color: var(--muted); }
.group-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-top: 24px; }
.group-card { position: relative; display: flex; min-width: 0; min-height: 390px; flex-direction: column; padding: 18px; overflow: hidden; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); box-shadow: var(--shadow); }
.group-index { position: absolute; right: 12px; top: 5px; color: #eef0f1; font-size: 52px; font-weight: 800; }
.group-top { position: relative; display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.group-top h2 { margin: 0; font-size: 17px; }.group-top p { min-height: 38px; margin: 5px 0 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
.percent { color: var(--green); font-size: 13px; font-weight: 700; }
.venue-list { display: flex; align-items: flex-start; gap: 6px; min-height: 48px; margin: 18px 0 11px; color: #50565c; font-size: 12px; line-height: 1.5; }
.venue-list svg { flex: 0 0 auto; margin-top: 2px; color: var(--brand); }
.progress { height: 7px; overflow: hidden; border-radius: 4px; background: #eceeef; }.progress i { display: block; height: 100%; border-radius: inherit; background: var(--green); }
.progress-meta { display: flex; justify-content: space-between; margin-top: 7px; color: var(--muted); font-size: 11px; }
.needed { flex: 1; margin: 18px 0; }.needed > div { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }.needed div span { padding: 4px 7px; border-radius: 4px; color: #6a4c14; background: var(--amber-soft); font-size: 10px; }
.guide-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
figure { margin: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 6px; background: white; } figure img { display: block; width: 100%; aspect-ratio: 16 / 7; object-fit: cover; }
figcaption { display: flex; align-items: center; gap: 10px; padding: 12px 14px; color: var(--green); } figcaption.bad { color: var(--brand); } figcaption span { color: var(--muted); font-size: 12px; } figcaption strong { display: block; margin-bottom: 2px; color: #24282c; font-size: 13px; }
@media (max-width: 930px) { .group-grid { grid-template-columns: 1fr 1fr; }.group-card { min-height: 350px; } }
@media (max-width: 620px) { .home-intro { align-items: stretch; flex-direction: column; padding-top: 8px; }.score { width: 100%; }.group-grid, .guide-grid { grid-template-columns: 1fr; }.group-card { min-height: 330px; } figure img { aspect-ratio: 16 / 8; } }
</style>
