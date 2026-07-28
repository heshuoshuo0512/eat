<template>
  <div v-if="summary" class="catalog-introduction" :class="{ compact }" @click.stop>
    <p class="catalog-introduction-summary">{{ summary }}</p>
    <details v-if="introduction?.recommendationCopy" class="catalog-introduction-details">
      <summary>
        <span>{{ introduction.provenanceLabel || '基于目录整理' }}</span>
        <span aria-hidden="true">展开</span>
      </summary>
      <p>{{ introduction.recommendationCopy }}</p>
    </details>
    <span v-else-if="introduction" class="catalog-introduction-source">{{ introduction.provenanceLabel || '基于目录整理' }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  entity: { type: Object, default: () => ({}) },
  compact: Boolean
});

const introduction = computed(() => props.entity?.introduction || null);
const summary = computed(() => props.entity?.displayDescription || introduction.value?.factualSummary || props.entity?.description || '');
</script>

<style scoped>
.catalog-introduction { min-width: 0; margin-top: .55rem; color: var(--text-secondary, #5f6d64); }
.catalog-introduction-summary { margin: 0; overflow-wrap: anywhere; font-size: .84rem; line-height: 1.55; }
.catalog-introduction-details { margin-top: .3rem; }
.catalog-introduction-details summary { display: inline-flex; align-items: center; gap: .45rem; cursor: pointer; color: var(--primary-dark, #245c3b); font-size: .72rem; font-weight: 650; list-style: none; }
.catalog-introduction-details summary::-webkit-details-marker { display: none; }
.catalog-introduction-details summary span:last-child { color: #78867c; font-weight: 500; }
.catalog-introduction-details[open] summary span:last-child { font-size: 0; }
.catalog-introduction-details[open] summary span:last-child::after { content: '收起'; font-size: .72rem; }
.catalog-introduction-details p { margin: .35rem 0 0; border-left: 2px solid #c9ddcd; padding-left: .55rem; color: #637168; font-size: .78rem; line-height: 1.55; }
.catalog-introduction-source { display: inline-block; margin-top: .28rem; color: #718077; font-size: .68rem; }
.catalog-introduction.compact { margin-top: .35rem; }
.catalog-introduction.compact .catalog-introduction-summary { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; font-size: .78rem; }
</style>
