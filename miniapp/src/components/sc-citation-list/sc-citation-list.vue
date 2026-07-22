<template>
  <view class="citation-panel">
    <view class="citation-head"><view><text class="citation-kicker">数据依据</text><text class="citation-title">真实引用</text></view><text class="count">{{ citations.length }} 条</text></view>
    <view v-if="citations.length" class="citation-list">
      <button v-for="item in visible" :key="item.id || item.sourceId || item.name" class="citation-row" @tap="$emit('select', item)">
        <view><text class="citation-name">{{ item.name || item.title || '菜品数据' }}</text><text class="citation-snippet">{{ compactCitationSnippet(item.snippet || item.reason || item.content) }}</text></view><text class="citation-score">{{ scoreText(item.score ?? item.retrievalScore) }}</text>
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
.citation-panel { margin:24rpx 0; padding:22rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); }
.citation-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16rpx; }
.citation-kicker,.citation-title { display:block; }
.citation-kicker { color:var(--info); font-size:22rpx; font-weight:500; }
.citation-title { margin-top:3rpx; color:var(--ink); font-size:28rpx; font-weight:600; }
.count { min-height:42rpx; padding:0 10rpx; border-radius:10rpx; color:var(--info); background:var(--info-soft); font-size:22rpx; line-height:42rpx; }
.citation-list { margin-top:12rpx; }
.citation-row { display:flex; align-items:center; justify-content:space-between; gap:16rpx; width:100%; min-height:96rpx; padding:14rpx 0; border-bottom:1rpx solid var(--line); background:transparent; text-align:left; }
.citation-row view { flex:1; min-width:0; }
.citation-name,.citation-snippet { display:block; }
.citation-name { color:var(--ink); font-size:26rpx; font-weight:500; }
.citation-snippet { overflow:hidden; margin-top:5rpx; color:var(--muted); font-size:22rpx; white-space:nowrap; text-overflow:ellipsis; }
.citation-score { flex:0 0 auto; color:var(--info); font-size:22rpx; }
.toggle { display:flex; align-items:center; justify-content:center; width:100%; min-height:64rpx; color:var(--brand); background:transparent; font-size:24rpx; font-weight:500; }
.empty-copy { display:block; margin-top:16rpx; color:var(--muted); font-size:24rpx; }
</style>
