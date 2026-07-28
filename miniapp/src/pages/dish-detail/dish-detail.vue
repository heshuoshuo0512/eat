<template>
  <sc-page-shell back title="菜品详情" :subtitle="locationLabel" tone="meal">
    <sc-state-card v-if="loading" type="loading" title="正在读取菜品详情" />
    <sc-state-card v-else-if="error&&!dish" type="error" title="菜品加载失败" :desc="error" action-text="重试" @action="loadDetail" />
    <template v-else-if="dish">
      <view class="detail-layout">
        <view class="detail-summary">
          <view class="dish-hero" :class="{ 'has-media':hasImage }"><sc-dish-media v-if="hasImage" :dish="dish" ratio="wide" /><view class="hero-copy"><text>{{ dish.cuisine||'校园风味' }} · {{ dish.taste||'口味待核验' }}</text><text class="ui-strong">{{ dish.name }}</text><view><text class="ui-bold">{{ priceText }}</text><text class="ui-bold">{{ ratingText }}</text><text class="ui-bold" :class="supply.className">{{ supply.label }}</text></view></view></view>
          <sc-catalog-introduction :entity="dish" />
          <view class="action-row"><button :class="{active:isFavorite}" :loading="favoriteLoading" @tap="toggleFavorite"><sc-icon name="heart" :size="16" /><text>{{ isFavorite?'已收藏':'收藏' }}</text></button><button :loading="eatenLoading" @tap="markEaten"><sc-icon name="check-circle" :size="16" /><text>吃过</text></button><button class="order-button" :disabled="!supply.canOrder" @tap="openOrder"><sc-icon name="store" :size="16" :tone="supply.canOrder?'inverted':'muted'" /><text>{{ supply.canOrder?'到店预约':'暂停预约' }}</text></button></view>
          <text v-if="message" class="message" :class="{error:isError}">{{ message }}</text>
        </view>

        <view class="detail-main">

      <view class="detail-section">
        <view class="section-head"><text>营养信息</text><text class="ui-strong">{{ nutrition.known ? '当前记录' : '待食堂核验' }}</text></view>
        <view v-if="nutrition.known" class="nutrition-grid"><view v-for="item in nutritionItems" :key="item.label"><text class="ui-strong">{{ item.value }}</text><text>{{ item.unit }}</text><text class="ui-small">{{ item.label }}</text></view></view>
        <text v-else class="fact-unverified">营养待核验，当前不会把数据库中的占位零值当作真实营养结论。</text>
      </view>

      <view class="detail-section">
        <view class="section-head"><text>菜品信息</text><text class="ui-strong">食材与安全</text></view>
        <view class="info-row"><text>所在位置</text><text class="ui-strong">{{ locationLabel||'档口信息待补充' }}</text></view><view class="info-row"><text>供应餐次</text><text class="ui-strong">{{ mealLabelsText }}</text></view><view class="info-row"><text>清真</text><text class="ui-strong">{{ halalLabel }}</text></view><view class="info-row"><text>过敏原</text><text class="ui-strong" :class="{warning:allergenUnknown||dish.allergens?.length}">{{ allergenLabel }}</text></view>
        <sc-rag-trust-state :item="dish" />
        <view class="tag-area"><text v-for="item in [...(dish.ingredients||[]),...(dish.tags||[])]" :key="item">{{ item }}</text></view>
      </view>

      <view class="detail-section review-section">
        <view class="section-head"><text>菜品评价</text><text class="ui-strong">{{ dish.reviews?.length||0 }} 条公开评价</text></view>
        <view class="review-form"><view class="score-buttons"><button v-for="score in 5" :key="score" :class="{active:review.rating===score}" @tap="review.rating=score"><view>{{ score }}分</view></button></view><textarea v-model="review.content" maxlength="240" placeholder="味道、份量、排队体验或搭配建议" /><button class="submit-review" :loading="reviewLoading" :disabled="reviewLoading" @tap="submitReview">提交审核</button></view>
        <view v-if="dish.reviews?.length" class="review-list"><view v-for="item in dish.reviews" :key="item.id" class="review-item"><view><text class="ui-strong">{{ item.user||'校园用户' }}</text><text>{{ item.rating }} 分</text></view><text class="ui-paragraph">{{ item.content }}</text><text class="ui-small">{{ formatDate(item.createdAt) }}</text></view></view>
        <sc-state-card v-else type="empty" title="暂无公开评价" desc="提交后需审核通过才会公开。" />
      </view>
        </view>
      </view>
    </template>
  </sc-page-shell>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { dishNutritionPresentation, dishPriceText, dishRatingText, dishSupplyPresentation, verifiedDishImageUrl } from '../../domain/dishPresentation.js';
import { triggerHaptic } from '../../composables/useInteractionFeedback.js';
import { validateReviewForm } from '../../domain/validation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';
const store=useCanteenStore();const dishId=ref('');const dish=ref(null);const loading=ref(true);const error=ref('');const message=ref('');const isError=ref(false);const favoriteLoading=ref(false);const eatenLoading=ref(false);const reviewLoading=ref(false);const review=reactive({rating:5,content:''});
const preference=computed(()=>store.dishPreferences.value.find((item)=>String(item.dishId)===dishId.value)||{});const isFavorite=computed(()=>Boolean(preference.value.favorite));const priceText=computed(()=>dishPriceText(dish.value||{}));const ratingText=computed(()=>dishRatingText(dish.value||{}));const nutrition=computed(()=>dishNutritionPresentation(dish.value||{}));
const hasImage=computed(()=>Boolean(verifiedDishImageUrl(dish.value||{})));
const locationLabel=computed(()=>[dish.value?.canteen?.name,dish.value?.stall?.name,dish.value?.stall?.floor].filter(Boolean).join(' · '));const mealLabels=computed(()=>({breakfast:'早餐',lunch:'午餐',dinner:'晚餐'}));
const mealLabelsText=computed(()=>((dish.value?.mealTypes||[]).map((item)=>mealLabels.value[item]||item).join('、')||'未标注'));
const nutritionItems=computed(()=>{if(!nutrition.value.known)return[];const n=dish.value?.nutrition||{};return[{label:'热量',value:Number(n.calories||0),unit:'kcal'},{label:'蛋白质',value:Number(n.protein||0),unit:'g'},{label:'碳水',value:Number(n.carbs||0),unit:'g'},{label:'脂肪',value:Number(n.fat||0),unit:'g'},{label:'膳食纤维',value:Number(dish.value?.fiber||0),unit:'g'},{label:'钠',value:Number(dish.value?.sodium||0),unit:'mg'},{label:'糖',value:Number(dish.value?.sugar||0),unit:'g'},{label:'钙',value:Number(dish.value?.calcium||0),unit:'mg'},{label:'铁',value:Number(dish.value?.iron||0),unit:'mg'}];});
const supply=computed(()=>dishSupplyPresentation(dish.value||{},store.todayMenu.value.dishes?.find((item)=>String(item.id)===dishId.value)||null));
const halalLabel=computed(()=>dish.value?.factStatus?.halal==='unknown'?'数据库尚未确认':dish.value?.halal?'是':'否');
const allergenUnknown=computed(()=>dish.value?.safety?.status==='unknown'||dish.value?.safetyDeclarations?.some((item)=>item.status==='unknown')||!dish.value?.allergens?.length);
const allergenLabel=computed(()=>dish.value?.allergens?.length?dish.value.allergens.join('、'):'数据库尚未确认');
onLoad(async(options)=>{dishId.value=String(options?.id||'');try{await store.refreshIfStale();if(!store.user.value){uni.reLaunch({url:'/pages/login/login'});return;}await loadDetail();}catch{}finally{loading.value=false;}});
async function loadDetail(){if(!dishId.value)return;loading.value=true;error.value='';try{dish.value=await store.fetchDishDetail(dishId.value);}catch(err){dish.value=store.getDishDetail(dishId.value);error.value=err.message||'菜品详情加载失败。';}finally{loading.value=false;}}
async function toggleFavorite(){favoriteLoading.value=true;message.value='';isError.value=false;try{await store.toggleFavorite(dishId.value);triggerHaptic('light');message.value=isFavorite.value?'已加入收藏。':'已取消收藏。';}catch(err){message.value=err.message;isError.value=true;}finally{favoriteLoading.value=false;}}
async function markEaten(){eatenLoading.value=true;message.value='';isError.value=false;try{await store.markDishEaten(dishId.value);triggerHaptic('light');message.value='已记录一次“吃过”。';}catch(err){message.value=err.message;isError.value=true;}finally{eatenLoading.value=false;}}
async function submitReview(){const validation=validateReviewForm({targetId:dishId.value,rating:review.rating,content:review.content});if(validation){message.value=validation;isError.value=true;return;}reviewLoading.value=true;message.value='';isError.value=false;try{const result=await store.addReview({targetType:'dish',targetId:dishId.value,rating:review.rating,content:review.content.trim()});if(result?.id)dish.value=result;review.content='';message.value='评价已提交，审核通过后会公开显示。';}catch(err){message.value=err.message||'评价提交失败。';isError.value=true;}finally{reviewLoading.value=false;}}
function openOrder(){if(supply.value.canOrder){triggerHaptic('light');uni.navigateTo({url:`/pages/orders/orders?dish=${encodeURIComponent(dishId.value)}`});}}function formatDate(value){return String(value||'').slice(0,10);}
</script>

<style scoped>
.detail-layout,.detail-summary,.detail-main { min-width:0; }
.detail-layout { padding-bottom:72px; }
.dish-hero { overflow:hidden; min-height:210px; padding:20px; border:1px solid var(--module-line); border-radius:var(--radius-large); color:var(--ink); background:var(--module-soft); box-sizing:border-box; }
.dish-hero.has-media { padding:0; color:var(--ink); background:var(--surface); }
.dish-hero.has-media .hero-copy { min-height:0; padding:16px; }
.hero-copy { display:flex; min-height:148px; flex-direction:column; justify-content:flex-end; }
.hero-copy>text,.hero-copy>.ui-strong,.hero-copy>.ui-small { display:block; }
.hero-copy>text { color:var(--module-dark); font-size:12px; }.hero-copy>.ui-strong { margin-top:4px; color:var(--ink); font-size:24px; font-weight:600; line-height:1.25; }.hero-copy>.ui-small { margin-top:6px; color:var(--ink-2); font-size:14px; line-height:1.5; }
.has-media .hero-copy>text,.has-media .hero-copy>.ui-small { color:var(--muted); }.has-media .hero-copy>.ui-strong { color:var(--ink); }
.hero-copy>view { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
.hero-copy .ui-bold { min-height:24px; padding:0 8px; border:1px solid var(--module-line); border-radius:999px; color:var(--module-dark); background:#fff; font-size:12px; font-weight:500; line-height:24px; }
.hero-copy .ui-bold:first-child { padding-left:0; border:0; color:var(--ink); background:transparent; font-size:16px; font-weight:600; }
.hero-copy .ui-bold.limited { color:var(--warning); border-color:var(--warning-line); background:var(--warning-soft); }.hero-copy .ui-bold.sold,.hero-copy .ui-bold.sold-out,.hero-copy .ui-bold.off,.hero-copy .ui-bold.off-menu { color:var(--danger); border-color:var(--danger-line); background:var(--danger-soft); }
.action-row { position:fixed; right:0; bottom:0; left:0; z-index:30; display:grid; grid-template-columns:1fr 1fr 1.2fr; gap:8px; padding:8px 16px calc(8px + env(safe-area-inset-bottom)); border-top:1px solid var(--line); background:rgba(255,255,255,.96); box-shadow:var(--shadow-functional); }
.action-row button { display:flex; min-height:44px; align-items:center; justify-content:center; gap:6px; padding:0 8px; border:1px solid var(--line); border-radius:var(--radius); color:var(--ink); background:var(--surface); font-size:12px; font-weight:500; }
.action-row button:active { transform:translateY(1px); background:var(--surface-soft); }.action-row button.active { color:var(--module-dark); border-color:var(--module-line); background:var(--module-soft); }.action-row .order-button { color:#fff; border-color:var(--module-accent); background:var(--module-accent); }.action-row .order-button:active { background:var(--module-dark); }.action-row .order-button:disabled { color:var(--muted); border-color:var(--line); background:var(--surface-soft); }
.action-row button.active :deep(.sc-icon) { animation:favorite-pop 360ms var(--ease-spring) both; }
.message { display:block; margin-top:8px; color:var(--success); font-size:12px; animation:feedback-in 260ms var(--ease-spring) both; }.message.error { color:var(--danger); }
.detail-section { margin-top:0; padding:20px 4px; border-bottom:1px solid var(--line); background:transparent; }.detail-section:last-child { border-bottom:0; }
.section-head { margin-bottom:12px; }.section-head text,.section-head .ui-strong { display:block; }.section-head text { color:var(--muted); font-size:12px; font-weight:500; }.section-head .ui-strong { margin-top:2px; color:var(--ink); font-size:16px; font-weight:600; }
.nutrition-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }.nutrition-grid view { min-width:0; padding:10px 4px; border-radius:var(--radius); background:var(--surface-soft); text-align:center; }
.nutrition-grid .ui-strong,.nutrition-grid text,.nutrition-grid .ui-small { display:block; }.nutrition-grid .ui-strong { color:var(--ink); font-size:14px; font-weight:600; }.nutrition-grid text { color:var(--muted); font-size:12px; }.nutrition-grid .ui-small { margin-top:2px; color:var(--ink-2); font-size:12px; }
.fact-unverified { display:block; padding:12px; border:1px solid var(--warning-line); border-radius:var(--radius); color:var(--warning); background:var(--warning-soft); font-size:12px; line-height:1.5; }
.info-row { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; padding:10px 0; border-bottom:1px solid var(--line); font-size:12px; }.info-row text { color:var(--muted); }.info-row .ui-strong { max-width:70%; color:var(--ink); font-weight:500; text-align:right; }.info-row .ui-strong.warning { color:var(--danger); }
.tag-area { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }.tag-area text { min-height:22px; padding:0 7px; border-radius:6px; color:var(--ink-2); background:var(--surface-soft); font-size:12px; line-height:22px; }
.review-form { padding-bottom:14px; border-bottom:1px solid var(--line); }.score-buttons { display:grid; grid-template-columns:repeat(5,1fr); gap:4px; }.score-buttons button { display:flex; min-height:44px; align-items:center; justify-content:center; padding:0 2px; color:var(--muted); font-size:12px; font-weight:500; }.score-buttons button>view { display:flex; width:100%; min-height:34px; align-items:center; justify-content:center; border:1px solid var(--line); border-radius:6px; background:var(--surface-soft); }.score-buttons button.active>view { color:#fff; border-color:var(--module-accent); background:var(--module-accent); }
.review-form textarea { width:100%; min-height:96px; margin-top:8px; padding:12px; border:1px solid var(--line); border-radius:var(--radius); color:var(--ink); background:var(--surface-soft); font-size:14px; line-height:1.5; box-sizing:border-box; }.submit-review { width:100%; min-height:44px; margin-top:8px; border-radius:var(--radius); color:#fff; background:var(--module-accent); font-size:14px; font-weight:600; }
.review-list { margin-top:6px; }.review-item { padding:12px 0; border-bottom:1px solid var(--line); }.review-item:last-child { border-bottom:0; }.review-item>view { display:flex; justify-content:space-between; gap:8px; }.review-item .ui-strong,.review-item>view text { color:var(--ink); font-size:12px; font-weight:600; }.review-item .ui-paragraph { margin:6px 0; color:var(--ink-2); font-size:12px; line-height:1.5; }.review-item .ui-small { font-size:12px; }
@keyframes favorite-pop { from { transform:scale(.72); } 60% { transform:scale(1.18); } to { transform:none; } }
@keyframes feedback-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
@media (min-width:768px) { .detail-layout { display:grid; grid-template-columns:320px minmax(0,1fr); gap:28px; padding-bottom:0; align-items:start; }.detail-summary { position:sticky; top:72px; }.action-row { position:static; margin-top:10px; padding:0; border-top:0; background:transparent; }.detail-section:first-child { margin-top:0; }.nutrition-grid { grid-template-columns:repeat(5,1fr); } }
</style>
