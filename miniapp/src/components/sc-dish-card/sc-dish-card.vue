<template>
  <button class="dish-card" :class="[`variant-${normalizedVariant}`, { unavailable, compact }]" :disabled="disabled" @tap="$emit('tap')">
    <sc-dish-media v-if="showMedia" class="dish-card-media" :dish="dish" ratio="wide" />
    <view class="dish-body">
      <view class="dish-title-row"><text class="dish-name">{{ dish.name }}</text><text class="dish-price">{{ priceText }}</text></view>
      <text v-if="location" class="dish-location">{{ location }}</text>
      <view class="dish-meta-row">
        <text v-if="catalogLabel" class="catalog-label">{{ catalogLabel }}</text>
        <text :class="{ rating: hasRating }">{{ ratingText }}</text>
        <text class="meta-divider">·</text>
        <text>{{ nutrition.label }}</text>
        <text v-if="statusLabel" class="status-badge" :class="statusClass">{{ statusLabel }}</text>
      </view>
      <sc-rag-trust-state v-if="hasTrustWarning" :item="dish" compact />
    </view>
    <sc-icon name="arrow-right" :size="16" tone="muted" />
  </button>
</template>

<script setup>
import { computed } from 'vue';
import { dishNutritionPresentation, dishPriceText, dishRatingText } from '../../domain/dishPresentation.js';
import { ragPresentation } from '../../domain/ragPresentation.js';

const props = defineProps({ dish: { type: Object, required: true }, location: { type: String, default: '' }, badge: { type: String, default: '' }, supplyStatus: { type: String, default: '' }, unavailable: Boolean, disabled: Boolean, compact: Boolean, variant: { type: String, default: 'compact' }, media: { type: String, default: 'none' } });
defineEmits(['tap']);
const priceText = computed(() => dishPriceText(props.dish));
const ratingText = computed(() => dishRatingText(props.dish));
const hasRating = computed(() => ratingText.value !== '暂无评分');
const normalizedVariant = computed(() => props.variant === 'featured' ? 'featured' : 'compact');
const showMedia = computed(() => normalizedVariant.value === 'featured' && props.media === 'auto');
const nutrition = computed(() => dishNutritionPresentation(props.dish));
const catalogLabel = computed(() => {
  const type = ({ meal: '餐食', snack: '小吃', beverage: '饮品', addon: '加购项', fee: '费用项' })[props.dish.catalogItemType] || '';
  return props.dish.catalogCategory && props.dish.catalogCategory !== type ? `${type} · ${props.dish.catalogCategory}` : type;
});
const statusLabel = computed(() => props.supplyStatus || props.badge || '');
const statusClass = computed(() => props.unavailable || /售罄|不可|非今日|未确认/.test(statusLabel.value) ? 'sold' : /紧张|限量/.test(statusLabel.value) ? 'limited' : 'available');
const hasTrustWarning = computed(() => {
  const model = ragPresentation(props.dish || {});
  return [model.confidence?.tone, model.safety?.tone].some((tone) => ['caution', 'warning', 'danger'].includes(tone));
});
</script>

<style scoped>
.dish-card { display:flex; width:100%; min-height:88px; align-items:center; gap:12px; padding:14px 4px; border-bottom:1px solid var(--line); background:transparent; text-align:left; transition:background-color 160ms ease,transform 160ms ease; }
.dish-card:active { transform:translateY(1px); background:var(--surface-soft); }
.dish-card.unavailable { opacity:.58; }
.dish-card.compact { min-height:88px; }
.dish-card:last-child { border-bottom:0; }
.dish-card-media { width:112px; flex:0 0 112px; }
.dish-body { display:flex; flex:1; min-width:0; flex-direction:column; justify-content:center; }
.dish-title-row { display:flex; align-items:flex-start; gap:12px; }
.dish-name { flex:1; min-width:0; overflow:hidden; color:var(--ink); font-size:16px; font-weight:600; white-space:nowrap; text-overflow:ellipsis; }
.dish-price { flex:0 0 auto; color:var(--ink); font-size:16px; font-weight:600; font-variant-numeric:tabular-nums; }
.dish-location { display:block; overflow:hidden; margin-top:4px; color:var(--muted); font-size:12px; white-space:nowrap; text-overflow:ellipsis; }
.dish-meta-row { display:flex; min-width:0; flex-wrap:wrap; align-items:center; gap:6px; margin-top:9px; color:var(--muted); font-size:12px; line-height:22px; }
.dish-meta-row .rating { color:var(--ink-2); font-weight:500; }
.catalog-label { color:var(--module-dark); font-weight:600; }
.meta-divider { color:#a1a1aa; }
.status-badge { margin-left:auto; min-height:22px; padding:0 7px; border-radius:999px; color:var(--ink-2); background:var(--surface-soft); font-size:12px; line-height:22px; }
.status-badge.available { color:var(--success); background:var(--success-soft); }
.status-badge.limited { color:var(--warning); border-color:var(--warning-line); background:var(--warning-soft); }
.status-badge.sold { color:var(--danger); border-color:var(--danger-line); background:var(--danger-soft); }
.variant-featured { min-height:132px; padding:12px; border:1px solid var(--module-line); border-radius:var(--radius-large); background:var(--surface); }
@media (max-width:359px) { .dish-card-media { width:92px; flex-basis:92px; } }
</style>
