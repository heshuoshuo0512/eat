<template>
  <sc-page-shell back title="菜品详情" :subtitle="locationLabel" tone="core">
    <sc-state-card v-if="loading" type="loading" title="正在读取菜品详情" />
    <sc-state-card v-else-if="error&&!dish" type="error" title="菜品加载失败" :desc="error" action-text="重试" @action="loadDetail" />
    <template v-else-if="dish">
      <view class="dish-hero">
        <image :src="imageSrc" mode="aspectFill" @error="imageFailed=true" />
        <view class="hero-shade"></view>
        <view class="hero-copy"><text>{{ dish.cuisine||'校园风味' }} · {{ dish.taste||'口味待补' }}</text><text class="ui-strong">{{ dish.name }}</text><text class="ui-small">{{ dish.description||'菜品介绍待补充。' }}</text><view><text class="ui-bold">¥{{ dish.price }}</text><text class="ui-bold">评分 {{ displayRating }}</text><text class="ui-bold" :class="supply.className">{{ supply.label }}</text></view></view>
      </view>

      <view class="action-row"><button :class="{active:isFavorite}" :loading="favoriteLoading" @tap="toggleFavorite">{{ isFavorite?'已收藏':'收藏' }}</button><button :loading="eatenLoading" @tap="markEaten">记录吃过</button><button class="order-button" :disabled="!supply.canOrder" @tap="openOrder">{{ supply.canOrder?'点餐预览':'当前不可点' }}</button></view>
      <text v-if="message" class="message" :class="{error:isError}">{{ message }}</text>

      <view class="detail-section">
        <view class="section-head"><text>营养信息</text><text class="ui-strong">每份估算</text></view>
        <view class="nutrition-grid"><view v-for="item in nutritionItems" :key="item.label"><text class="ui-strong">{{ item.value }}</text><text>{{ item.unit }}</text><text class="ui-small">{{ item.label }}</text></view></view>
      </view>

      <view class="detail-section">
        <view class="section-head"><text>菜品信息</text><text class="ui-strong">食材与安全</text></view>
        <view class="info-row"><text>所在位置</text><text class="ui-strong">{{ locationLabel||'档口信息待补充' }}</text></view><view class="info-row"><text>供应餐次</text><text class="ui-strong">{{ mealLabelsText }}</text></view><view class="info-row"><text>清真</text><text class="ui-strong">{{ dish.halal?'是':'否' }}</text></view><view class="info-row"><text>过敏原</text><text class="ui-strong" :class="{warning:dish.allergens?.length}">{{ dish.allergens?.join('、')||'未标注' }}</text></view>
        <view class="tag-area"><text v-for="item in [...(dish.ingredients||[]),...(dish.tags||[])]" :key="item">{{ item }}</text></view>
      </view>

      <view class="detail-section review-section">
        <view class="section-head"><text>菜品评价</text><text class="ui-strong">{{ dish.reviews?.length||0 }} 条公开评价</text></view>
        <view class="review-form"><view class="score-buttons"><button v-for="score in 5" :key="score" :class="{active:review.rating===score}" @tap="review.rating=score"><view>{{ score }}分</view></button></view><textarea v-model="review.content" maxlength="240" placeholder="味道、份量、排队体验或搭配建议" /><button class="submit-review" :loading="reviewLoading" :disabled="reviewLoading" @tap="submitReview">提交审核</button></view>
        <view v-if="dish.reviews?.length" class="review-list"><view v-for="item in dish.reviews" :key="item.id" class="review-item"><view><text class="ui-strong">{{ item.user||'校园用户' }}</text><text>{{ item.rating }} 分</text></view><text class="ui-paragraph">{{ item.content }}</text><text class="ui-small">{{ formatDate(item.createdAt) }}</text></view></view>
        <sc-state-card v-else type="empty" title="暂无公开评价" desc="提交后需审核通过才会公开。" />
      </view>
    </template>
  </sc-page-shell>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { validateReviewForm } from '../../domain/validation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';
const store=useCanteenStore();const dishId=ref('');const dish=ref(null);const loading=ref(true);const error=ref('');const message=ref('');const isError=ref(false);const imageFailed=ref(false);const favoriteLoading=ref(false);const eatenLoading=ref(false);const reviewLoading=ref(false);const review=reactive({rating:5,content:''});
const preference=computed(()=>store.dishPreferences.value.find((item)=>String(item.dishId)===dishId.value)||{});const isFavorite=computed(()=>Boolean(preference.value.favorite));const imageSrc=computed(()=>!imageFailed.value&&dish.value?.imageUrl?dish.value.imageUrl:'/static/food/hero-meal.svg');const displayRating=computed(()=>Number(dish.value?.computedRating??dish.value?.rating??0).toFixed(1));
const locationLabel=computed(()=>[dish.value?.canteen?.name,dish.value?.stall?.name,dish.value?.stall?.floor].filter(Boolean).join(' · '));const mealLabels=computed(()=>({breakfast:'早餐',lunch:'午餐',dinner:'晚餐'}));
const mealLabelsText=computed(()=>((dish.value?.mealTypes||[]).map((item)=>mealLabels.value[item]||item).join('、')||'未标注'));
const nutritionItems=computed(()=>{const n=dish.value?.nutrition||{};return[{label:'热量',value:Number(n.calories||0),unit:'kcal'},{label:'蛋白质',value:Number(n.protein||0),unit:'g'},{label:'碳水',value:Number(n.carbs||0),unit:'g'},{label:'脂肪',value:Number(n.fat||0),unit:'g'},{label:'膳食纤维',value:Number(dish.value?.fiber||0),unit:'g'},{label:'钠',value:Number(dish.value?.sodium||0),unit:'mg'},{label:'糖',value:Number(dish.value?.sugar||0),unit:'g'},{label:'钙',value:Number(dish.value?.calcium||0),unit:'mg'},{label:'铁',value:Number(dish.value?.iron||0),unit:'mg'}];});
const supply=computed(()=>{const menu=store.todayMenu.value.dishes?.find((item)=>String(item.id)===dishId.value);if(!menu)return{label:'非今日供应',className:'off',canOrder:false};if(menu.supplyStatus==='sold_out')return{label:'今日售罄',className:'sold',canOrder:false};if(menu.supplyStatus==='limited')return{label:'库存紧张',className:'limited',canOrder:true};return{label:'今日可点',className:'available',canOrder:true};});
onLoad(async(options)=>{dishId.value=String(options?.id||'');try{await store.refreshIfStale();if(!store.user.value){uni.reLaunch({url:'/pages/login/login'});return;}await loadDetail();}catch{}finally{loading.value=false;}});
async function loadDetail(){if(!dishId.value)return;loading.value=true;error.value='';imageFailed.value=false;try{dish.value=await store.fetchDishDetail(dishId.value);}catch(err){dish.value=store.getDishDetail(dishId.value);error.value=err.message||'菜品详情加载失败。';}finally{loading.value=false;}}
async function toggleFavorite(){favoriteLoading.value=true;message.value='';isError.value=false;try{await store.toggleFavorite(dishId.value);message.value=isFavorite.value?'已加入收藏。':'已取消收藏。';}catch(err){message.value=err.message;isError.value=true;}finally{favoriteLoading.value=false;}}
async function markEaten(){eatenLoading.value=true;message.value='';isError.value=false;try{await store.markDishEaten(dishId.value);message.value='已记录一次“吃过”。';}catch(err){message.value=err.message;isError.value=true;}finally{eatenLoading.value=false;}}
async function submitReview(){const validation=validateReviewForm({targetId:dishId.value,rating:review.rating,content:review.content});if(validation){message.value=validation;isError.value=true;return;}reviewLoading.value=true;message.value='';isError.value=false;try{const result=await store.addReview({targetType:'dish',targetId:dishId.value,rating:review.rating,content:review.content.trim()});if(result?.id)dish.value=result;review.content='';message.value='评价已提交，审核通过后会公开显示。';}catch(err){message.value=err.message||'评价提交失败。';isError.value=true;}finally{reviewLoading.value=false;}}
function openOrder(){if(supply.value.canOrder)uni.navigateTo({url:`/pages/orders/orders?dish=${encodeURIComponent(dishId.value)}`});}function formatDate(value){return String(value||'').slice(0,10);}
</script>

<style scoped>
.dish-hero { position:relative; overflow:hidden; min-height:440rpx; border-radius:var(--radius-large); color:#fff; background:var(--surface-soft); box-shadow:var(--shadow); }
.dish-hero>image,.hero-shade { position:absolute; inset:0; width:100%; height:100%; }
.hero-shade { background:linear-gradient(180deg,rgba(8,24,16,.02),rgba(8,30,20,.9)); }
.hero-copy { position:absolute; right:0; bottom:0; left:0; padding:26rpx; }
.hero-copy>text,.hero-copy>.ui-strong,.hero-copy>.ui-small { display:block; }
.hero-copy>text { font-size:22rpx; opacity:.8; }
.hero-copy>.ui-strong { margin-top:5rpx; font-size:38rpx; font-weight:600; }
.hero-copy>.ui-small { margin-top:7rpx; font-size:24rpx; line-height:1.5; opacity:.88; }
.hero-copy>view { display:flex; flex-wrap:wrap; gap:8rpx; margin-top:12rpx; }
.hero-copy .ui-bold { min-height:40rpx; padding:0 10rpx; border-radius:8rpx; background:rgba(255,255,255,.18); font-size:22rpx; font-weight:500; line-height:40rpx; }
.hero-copy .ui-bold.limited { background:var(--rating); }.hero-copy .ui-bold.sold,.hero-copy .ui-bold.off { background:var(--danger); }.hero-copy .ui-bold.available { background:var(--brand); }
.action-row { display:grid; grid-template-columns:1fr 1fr 1.2fr; gap:10rpx; margin-top:14rpx; }
.action-row button { min-height:88rpx; padding:0 8rpx; border:1rpx solid var(--line); border-radius:12rpx; color:var(--brand); background:var(--surface); font-size:24rpx; font-weight:500; }
.action-row button.active { background:var(--brand-soft); }
.action-row .order-button { color:#fff; border-color:var(--brand); background:var(--brand); }
.action-row .order-button:disabled { color:var(--muted); border-color:var(--line); background:var(--surface-soft); }
.message { display:block; margin-top:12rpx; color:var(--brand); font-size:24rpx; }
.message.error { color:var(--danger); }
.detail-section { margin-top:22rpx; padding:22rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); }
.section-head { margin-bottom:16rpx; }
.section-head text,.section-head .ui-strong { display:block; }
.section-head text { color:var(--brand); font-size:22rpx; font-weight:500; }
.section-head .ui-strong { margin-top:3rpx; color:var(--ink); font-size:28rpx; font-weight:600; }
.nutrition-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8rpx; }
.nutrition-grid view { min-width:0; padding:16rpx 6rpx; border-radius:12rpx; background:var(--surface-soft); text-align:center; }
.nutrition-grid .ui-strong,.nutrition-grid text,.nutrition-grid .ui-small { display:block; }
.nutrition-grid .ui-strong { color:var(--ink); font-size:26rpx; font-weight:600; }
.nutrition-grid text { color:var(--muted); font-size:22rpx; }
.nutrition-grid .ui-small { margin-top:4rpx; color:var(--ink-2); font-size:22rpx; }
.info-row { display:flex; align-items:flex-start; justify-content:space-between; gap:18rpx; padding:14rpx 0; border-bottom:1rpx solid var(--line); font-size:24rpx; }
.info-row text { color:var(--muted); }
.info-row .ui-strong { max-width:70%; color:var(--ink); font-weight:500; text-align:right; }
.info-row .ui-strong.warning { color:var(--danger); }
.tag-area { display:flex; flex-wrap:wrap; gap:8rpx; margin-top:14rpx; }
.tag-area text { min-height:40rpx; padding:0 9rpx; border-radius:8rpx; color:var(--brand); background:var(--brand-soft); font-size:22rpx; line-height:40rpx; }
.review-form { padding-bottom:18rpx; border-bottom:1rpx solid var(--line); }
.score-buttons { display:grid; grid-template-columns:repeat(5,1fr); gap:2rpx; }
.score-buttons button { display:flex; align-items:center; justify-content:center; min-height:88rpx; padding:0 3rpx; color:var(--muted); background:transparent; font-size:24rpx; font-weight:500; }
.score-buttons button>view { display:flex; align-items:center; justify-content:center; width:100%; min-height:64rpx; border:1rpx solid var(--line); border-radius:10rpx; background:var(--surface-soft); line-height:1; box-sizing:border-box; }
.score-buttons button.active>view { color:#fff; border-color:var(--rating); background:var(--rating); }
.review-form textarea { width:100%; min-height:156rpx; margin-top:12rpx; padding:16rpx; border:1rpx solid var(--line); border-radius:12rpx; background:var(--surface-soft); color:var(--ink); font-size:26rpx; line-height:1.55; box-sizing:border-box; }
.submit-review { width:100%; min-height:88rpx; margin-top:12rpx; border-radius:12rpx; color:#fff; background:var(--brand); font-size:26rpx; font-weight:500; }
.review-list { margin-top:8rpx; }
.review-item { padding:16rpx 0; border-bottom:1rpx solid var(--line); }
.review-item:last-child { border-bottom:0; }
.review-item>view { display:flex; justify-content:space-between; gap:10rpx; }
.review-item .ui-strong { color:var(--ink); font-size:24rpx; font-weight:600; }
.review-item>view text { color:#966218; font-size:24rpx; font-weight:500; }
.review-item .ui-paragraph { margin:8rpx 0; color:var(--ink-2); font-size:24rpx; line-height:1.55; }
.review-item .ui-small { color:var(--muted); font-size:22rpx; }
</style>
