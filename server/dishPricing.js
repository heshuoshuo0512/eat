export const PRICING_MODES = Object.freeze(['fixed', 'per_weight', 'per_unit', 'per_person', 'variants', 'tiered']);

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function formatAmount(value) {
  const number = finiteNumber(value);
  if (number == null) return '';
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function normalizeDishPricing(raw = {}, fallbackPrice = 0) {
  const source = parseObject(raw.pricing ?? raw.pricing_json);
  const requestedMode = String(raw.pricingMode ?? raw.pricing_mode ?? source.mode ?? 'fixed').trim();
  const mode = PRICING_MODES.includes(requestedMode) ? requestedMode : 'fixed';
  const variants = Array.isArray(source.variants)
    ? source.variants.map((item, index) => ({
        id: String(item.id || `variant-${index + 1}`).trim(),
        label: String(item.label || '').trim(),
        amount: finiteNumber(item.amount),
        quantity: finiteNumber(item.quantity),
        unit: String(item.unit || '').trim(),
      })).filter((item) => item.label && item.amount != null)
    : [];
  const modifiers = Array.isArray(source.modifiers)
    ? source.modifiers.map((item) => ({
        label: String(item.label || '').trim(),
        amount: finiteNumber(item.amount),
      })).filter((item) => item.label && item.amount != null)
    : [];
  const candidates = [
    finiteNumber(source.baseAmount),
    finiteNumber(source.minAmount),
    finiteNumber(fallbackPrice),
    ...variants.map((item) => item.amount),
  ].filter((value) => value != null);
  const minAmount = finiteNumber(source.minAmount) ?? (candidates.length ? Math.min(...candidates) : 0);
  const maxCandidates = [finiteNumber(source.maxAmount), ...variants.map((item) => item.amount)].filter((value) => value != null);
  const maxAmount = maxCandidates.length ? Math.max(...maxCandidates) : minAmount;
  const baseAmount = finiteNumber(source.baseAmount) ?? finiteNumber(fallbackPrice) ?? minAmount;
  const unit = String(source.unit || (mode === 'per_person' ? '位' : mode === 'fixed' ? '份' : '')).trim();
  const baseQuantity = finiteNumber(source.baseQuantity);
  const budgetComparable = typeof source.budgetComparable === 'boolean'
    ? source.budgetComparable
    : mode !== 'per_weight';
  let display = String(raw.priceDisplay ?? raw.price_display ?? source.display ?? '').trim();
  if (!display) {
    if (['per_weight', 'per_unit'].includes(mode) && baseQuantity && unit) display = `${formatAmount(baseAmount)}元/${formatAmount(baseQuantity)}${unit}`;
    else if (mode === 'per_person') display = `${formatAmount(baseAmount)}元/位`;
    else if (maxAmount > minAmount) display = `${formatAmount(minAmount)}-${formatAmount(maxAmount)}元`;
    else display = `${formatAmount(baseAmount)}元`;
  }
  return {
    mode,
    display,
    baseAmount,
    baseQuantity,
    unit,
    minAmount,
    maxAmount,
    budgetComparable,
    variants,
    modifiers,
    raw: String(source.raw || '').trim(),
  };
}

export function budgetPriceForDish(dish = {}) {
  const pricing = normalizeDishPricing(dish, dish.price);
  return pricing.budgetComparable ? pricing.minAmount : null;
}
