function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatAmount(value) {
  const number = finiteNumber(value);
  if (number == null) return '';
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function explicitNutritionStatus(dish = {}) {
  return String(
    dish.factStatus?.nutrition
      ?? dish.facts?.factStatus?.nutrition
      ?? dish.nutritionFactStatus
      ?? dish.nutrition_fact_status
      ?? '',
  ).trim().toLowerCase();
}

export function dishPriceText(dish = {}) {
  const availabilityDisplay = String(dish.availability?.priceDisplay || '').trim();
  if (availabilityDisplay) return availabilityDisplay;
  if (dish.menuItem) {
    const menuAmount = finiteNumber(dish.price);
    if (menuAmount != null) return `${formatAmount(menuAmount)}元`;
  }
  const explicit = String(
    dish.priceDisplay
      || dish.pricing?.display
      || '',
  ).trim();
  if (explicit) return explicit;
  const amount = finiteNumber(dish.availability?.price ?? dish.price);
  return amount == null ? '价格待核验' : `${formatAmount(amount)}元`;
}

export function dishRatingText(dish = {}) {
  const reviewCount = finiteNumber(
    dish.displayReviewCount
      ?? dish.computedReviewCount
      ?? dish.reviewCount
      ?? dish.review_count,
  ) ?? 0;
  const rating = finiteNumber(dish.displayRating ?? dish.computedRating ?? dish.rating);
  if (reviewCount <= 0 || rating == null || rating <= 0) return '暂无评分';
  return `${rating.toFixed(1)} 分`;
}

export function verifiedDishImageUrl(dish = {}) {
  const imageUrl = String(dish.imageUrl || dish.image_url || '').trim();
  if (!imageUrl || /(?:placeholder|default[-_]?food|fake[-_]?food)/i.test(imageUrl)) return '';
  const status = String(dish.imageStatus || dish.image_status || '').trim().toLowerCase();
  const verified = dish.imageVerified === true
    || dish.image_verified === true
    || ['verified', 'approved', 'active'].includes(status);
  if (!verified) return '';
  return imageUrl;
}

export function dishNutritionPresentation(dish = {}) {
  const nutrition = dish.nutrition || {};
  const values = ['calories', 'protein', 'fat', 'carbs']
    .map((key) => finiteNumber(nutrition[key] ?? dish[key]));
  const status = explicitNutritionStatus(dish);
  const known = status
    ? status !== 'unknown'
    : values.some((value) => value != null && value > 0);
  if (!known) return { known: false, status: status || 'unknown', label: '营养待核验', metrics: {} };
  const [calories, protein, fat, carbs] = values;
  const metrics = { calories, protein, fat, carbs };
  const parts = [
    calories != null ? `${formatAmount(calories)} kcal` : '',
    protein != null ? `蛋白 ${formatAmount(protein)}g` : '',
    fat != null ? `脂肪 ${formatAmount(fat)}g` : '',
    carbs != null ? `碳水 ${formatAmount(carbs)}g` : '',
  ].filter(Boolean);
  return { known: true, status: status || 'legacy', label: parts.join(' · ') || '营养待核验', metrics };
}

export function dishSupplyPresentation(dish = {}, menuDish = null) {
  const availability = dish.availability && typeof dish.availability === 'object' ? dish.availability : null;
  const status = String(availability?.status || menuDish?.supplyStatus || '').trim().toLowerCase();
  const orderable = availability ? availability.orderable === true : Boolean(menuDish && status !== 'sold_out');
  const labels = {
    reservable: '可预约',
    reservation_paused: '暂停预约',
    available: '可预约',
    limited: '可预约',
    sold_out: '暂停预约',
    catalog_only: '目录可查询',
    not_on_menu: '暂停预约',
    off_menu: '暂停预约',
    outside_serving_time: '暂停预约',
    outside_serving_hours: '暂停预约',
    stall_closed: '档口暂停营业',
    dish_inactive: '菜品已下架',
    unavailable: '当前不可点',
  };
  const label = status ? (labels[status] || availability?.reason || '暂停预约') : '目录信息待核验';
  const className = ['available', 'reservable'].includes(status)
    ? 'available'
    : status === 'limited'
      ? 'limited'
      : status === 'sold_out'
        ? 'sold-out'
        : 'off-menu';
  return { status: status || 'catalog_only', label, className, canOrder: orderable };
}
