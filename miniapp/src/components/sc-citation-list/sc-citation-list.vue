<template>
  <view class="citation-panel">
    <view class="citation-head"><view><text class="citation-kicker">数据依据</text><text class="citation-title">真实引用</text></view><text class="count">{{ citations.length }} 条</text></view>
    <view v-if="citations.length" class="citation-list">
      <button v-for="item in visible" :key="item.id || item.sourceId || item.name" class="citation-row" @tap="$emit('select', item)">
        <view><text class="citation-name">{{ item.name || item.title || '菜品数据' }}</text><text class="citation-snippet">{{ compactCitationSnippet(item.snippet || item.reason || item.content) }}</text><sc-rag-trust-state :item="item" compact /></view><text class="citation-score">{{ scoreText(item.score ?? item.retrievalScore) }}</text>
      </button>
      <button v-if="citations.length > limit" class="toggle" @tap="$emit('toggle')">{{ expanded ? '收起引用' : `查看全部 ${citations.length} 条` }}</button>
    </view>
    <text v-else class="empty-copy">生成结果后显示可核验来源。</text>
  </view>
</template>

<script setup>
import { computed } from 'vue';
import { compactCitationSnippet, visibleCitations } from '../../domain/studentDiscovery.js';
const props = defineProps({ citations: { type: Array, default: () => [] }, expanded: Boolean, limit: { type: Number, default: 3 } });
defineEmits(['toggle', 'select']);
const visible = computed(() => visibleCitations(props.citations, props.expanded, props.limit));
function scoreText(value) { const number = Number(value); return Number.isFinite(number) ? (number <= 1 ? `${Math.round(number * 100)}%` : number.toFixed(1)) : '已验证'; }
</script>

<style scoped>
.citation-panel { margin:16px 0; padding:16px; border:1px solid var(--line); border-radius:var(--radius); background:var(--surface); }
.citation-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.citation-kicker,.citation-title { display:block; }
.citation-kicker { color:var(--muted); font-size:12px; font-weight:500; }
.citation-title { margin-top:3px; color:var(--ink); font-size:16px; font-weight:600; }
.count { min-height:24px; padding:0 8px; border-radius:999px; color:var(--ink-2); background:var(--surface-soft); font-size:12px; line-height:24px; }
.citation-list { margin-top:8px; }
.citation-row { display:flex; width:100%; min-height:56px; padding:10px 0; align-items:center; justify-content:space-between; gap:12px; border-bottom:1px solid var(--line); background:transparent; text-align:left; }
.citation-row view { flex:1; min-width:0; }
.citation-name,.citation-snippet { display:block; }
.citation-name { color:var(--ink); font-size:14px; font-weight:500; }
.citation-snippet { overflow:hidden; margin-top:4px; color:var(--muted); font-size:12px; white-space:nowrap; text-overflow:ellipsis; }
.citation-score { flex:0 0 auto; color:var(--ink-2); font-size:12px; }
.toggle { display:flex; width:100%; min-height:44px; align-items:center; justify-content:center; color:var(--ink); background:transparent; font-size:14px; font-weight:500; }
.empty-copy { display:block; margin-top:12px; color:var(--muted); font-size:14px; }
</style>
