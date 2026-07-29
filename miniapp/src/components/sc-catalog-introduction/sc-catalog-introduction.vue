<template>
  <view v-if="summary" class="catalog-introduction" :class="{ compact, positioning:showPositioning }" @tap.stop>
    <text class="summary">{{ summary }}</text>
    <view v-if="showPositioning&&positioningStatement" class="positioning-copy">
      <text>目录定位</text><text>{{ positioningStatement }}</text>
    </view>
    <view v-else-if="positioningStatement" class="recommendation">
      <button class="toggle" @tap.stop="expanded=!expanded">
        <text>{{ introduction.provenanceLabel||'基于目录整理' }}</text>
        <text>{{ expanded?'收起':'展开' }}</text>
      </button>
      <text v-if="expanded" class="copy">{{ positioningStatement }}</text>
    </view>
    <text v-else-if="introduction" class="source">{{ introduction.provenanceLabel||'基于目录整理' }}</text>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue';
const props=defineProps({entity:{type:Object,default:()=>({})},compact:Boolean,positioning:Boolean});
const expanded=ref(false);
const introduction=computed(()=>props.entity?.introduction||null);
const summary=computed(()=>props.entity?.displayDescription||introduction.value?.factualSummary||props.entity?.description||'');
const positioningStatement=computed(()=>props.entity?.displayTagline||introduction.value?.positioningStatement||introduction.value?.recommendationCopy||'');
const showPositioning=computed(()=>props.positioning||['area','venue'].includes(introduction.value?.hierarchyLevel));
</script>

<style scoped>
.catalog-introduction { min-width:0; margin-top:10px; }
.summary { display:block; color:var(--ink-2); font-size:14px; line-height:1.55; overflow-wrap:anywhere; }
.catalog-introduction.compact .summary { display:-webkit-box; overflow:hidden; -webkit-box-orient:vertical; -webkit-line-clamp:3; font-size:12px; }
.catalog-introduction.compact.positioning .summary { -webkit-line-clamp:2; }
.positioning-copy { margin-top:6px; padding-left:8px; border-left:2px solid var(--module-line); }
.positioning-copy text { display:block; color:var(--ink-2); font-size:12px; line-height:1.55; }
.positioning-copy text:first-child { margin-bottom:2px; color:var(--module-dark); font-weight:600; }
.catalog-introduction.compact .positioning-copy text:last-child { display:-webkit-box; overflow:hidden; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
.recommendation { margin-top:6px; }
.toggle { display:flex; width:auto; min-height:28px; align-items:center; gap:8px; margin:0; padding:0; color:var(--module-dark); background:transparent; font-size:12px; line-height:28px; }
.toggle::after { border:0; }
.toggle text:last-child { color:var(--muted); }
.copy { display:block; margin-top:4px; padding-left:8px; border-left:2px solid var(--module-line); color:var(--muted); font-size:12px; line-height:1.55; }
.source { display:block; margin-top:5px; color:var(--muted); font-size:12px; }
</style>
