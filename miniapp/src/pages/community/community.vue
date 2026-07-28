<template>
  <sc-page-shell title="社区" subtitle="真实用餐体验与校园评价" tone="community" tab-id="community">
    <sc-segmented-control v-model="section" :options="sectionOptions" block />

    <template v-if="section==='posts'">
      <view class="community-toolbar">
        <view class="post-filter"><sc-segmented-control v-model="postType" :options="postTypeOptions" density="compact" block /></view>
        <button class="publish-button" aria-label="发布帖子" @tap="openPublish"><view class="publish-visual"><sc-icon name="plus" :size="16" tone="inverted" /><text>发布</text></view></button>
      </view>
      <view class="keyword-search"><sc-icon name="search-line" :size="16" tone="muted" /><input v-model="postQuery" confirm-type="search" placeholder="搜索帖子内容、菜品或食堂" /><button v-if="postQuery" type="button" @tap="postQuery=''">清除</button></view>
      <sc-state-card v-if="loading" type="loading" title="正在加载校园动态" />
      <sc-state-card v-else-if="error" type="error" title="动态加载失败" :desc="error" action-text="重试" @action="loadPosts(true)" />
      <view v-else-if="posts.length" class="post-list">
        <view v-for="(post,index) in posts" :key="post.id" class="post-card" :style="entryStyle(index)">
          <view class="post-head"><view class="avatar">{{ String(post.user||'同').slice(0,1) }}</view><view class="author"><text class="ui-strong">{{ post.user||'校园同学' }}</text><text>{{ formatDate(post.createdAt) }}</text></view><text v-if="post.isOwn" class="status" :class="post.status">{{ statusLabel(post.status) }}</text></view>
          <text class="post-content">{{ post.content }}</text>
          <image v-if="post.imageUrl" class="post-image" :src="post.imageUrl" mode="aspectFill" lazy-load />
          <button class="post-target" @tap="openPostTarget(post)"><text>{{ post.targetType==='dish'?'菜品':'食堂' }}</text><view><text class="ui-strong">{{ post.dish?.name||post.canteen?.name||'校园食堂' }}</text><text class="ui-small">{{ [post.canteen?.name,post.stall?.name].filter(Boolean).join(' · ') }}</text></view><sc-icon name="arrow-right" :size="16" tone="muted" /></button>
          <view v-if="post.rating" class="post-rating"><text>菜品评分</text><text class="ui-strong">{{ post.rating }}.0</text></view>
        </view>
        <button v-if="posts.length<postTotal" class="load-more" :disabled="loadingMore" @tap="loadMorePosts"><view>{{ loadingMore ? '加载中…' : '加载更多' }}</view></button>
      </view>
      <sc-state-card v-else type="empty" illustration="empty-community" title="还没有校园帖子" desc="分享第一条真实用餐体验。" action-text="发布帖子" @action="openPublish" />
    </template>

    <template v-else>
      <view class="keyword-search"><sc-icon name="search-line" :size="16" tone="muted" /><input v-model="reviewQuery" confirm-type="search" placeholder="搜索评价内容、菜品或食堂" /><button v-if="reviewQuery" type="button" @tap="reviewQuery=''">清除</button></view>
      <view class="community-workspace">
        <view class="review-sidebar">
          <sc-responsive-panel v-model="filtersOpen" title="评价筛选" :active-count="reviewFilterCount">
            <view class="review-controls"><sc-segmented-control v-model="reviewFilters.targetType" :options="reviewTypeOptions" block density="compact" /><view class="picker-grid"><picker class="picker-touch" :range="canteenOptions" range-key="name" :value="canteenIndex" @change="selectCanteen"><view class="picker-box"><text class="picker-label">{{ selectedCanteen?.name||'全部食堂' }}</text><sc-icon name="arrow-down" :size="16" tone="muted" /></view></picker><picker v-if="reviewFilters.targetType==='dish'" class="picker-touch" :range="stallOptions" range-key="name" :value="stallIndex" @change="selectStall"><view class="picker-box"><text class="picker-label">{{ selectedStall?.name||'全部档口' }}</text><sc-icon name="arrow-down" :size="16" tone="muted" /></view></picker><picker v-if="reviewFilters.targetType==='dish'" class="picker-touch" :range="dishOptions" range-key="name" :value="dishIndex" @change="selectDish"><view class="picker-box"><text class="picker-label">{{ selectedDish?.name||'全部菜品' }}</text><sc-icon name="arrow-down" :size="16" tone="muted" /></view></picker><picker class="picker-touch" :range="sortOptions" range-key="label" :value="sortIndex" @change="selectSort"><view class="picker-box"><text class="picker-label">{{ selectedSort.label }}</text><sc-icon name="arrow-down" :size="16" tone="muted" /></view></picker></view></view>
          </sc-responsive-panel>
          <view class="review-summary"><view><text class="ui-strong">{{ reviewSummary.averageRating||'-' }}</text><text>平均评分</text></view><view><text class="ui-strong">{{ reviewTotal }}</text><text>当前评价</text></view><view><text class="ui-strong">{{ reviewSummary.dishReviews||0 }}</text><text>菜品评价</text></view><view><text class="ui-strong">{{ reviewSummary.canteenReviews||0 }}</text><text>食堂评价</text></view></view>
        </view>
        <view class="review-main">
          <sc-state-card v-if="loading" type="loading" title="正在加载评价" />
          <sc-state-card v-else-if="error" type="error" title="评价加载失败" :desc="error" action-text="重试" @action="loadReviews(true)" />
          <view v-else-if="reviews.length" class="review-list"><button v-for="(review,index) in reviews" :key="review.id" class="review-card" :style="entryStyle(index)" @tap="openReviewTarget(review)"><view class="review-score"><text class="ui-strong">{{ review.rating }}</text><text>分</text></view><view class="review-copy"><view><text class="ui-strong">{{ review.dish?.name||review.canteen?.name||'校园评价' }}</text><text>{{ review.targetType==='dish'?'菜品':'食堂' }}</text></view><text class="ui-small">{{ [review.canteen?.name,review.stall?.name].filter(Boolean).join(' · ') }}</text><text class="ui-paragraph">{{ review.content }}</text><view class="ui-footer"><text>{{ review.user }}</text><text>{{ formatDate(review.createdAt) }}</text></view></view><sc-icon name="arrow-right" :size="16" tone="muted" /></button><button v-if="reviews.length<reviewTotal" class="load-more" :disabled="loadingMore" @tap="loadMoreReviews"><view>{{ loadingMore ? '加载中…' : '加载更多' }}</view></button></view>
          <sc-state-card v-else type="empty" title="没有符合条件的评价" desc="调整筛选条件后再试。" />
        </view>
      </view>
    </template>
  </sc-page-shell>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app';
import { useCanteenStore } from '../../stores/canteenStore.js';
const store=useCanteenStore();const sectionOptions=[{value:'posts',label:'校园帖子'},{value:'reviews',label:'菜品评价'}];const postTypeOptions=[{value:'',label:'全部'},{value:'dish',label:'菜品'},{value:'canteen',label:'食堂'}];const reviewTypeOptions=[{value:'dish',label:'菜品评价'},{value:'canteen',label:'食堂评价'}];const sortOptions=[{value:'rating_desc',label:'评分优先'},{value:'rating_asc',label:'低分优先'},{value:'latest',label:'最新评价'}];
const section=ref('posts');const postType=ref('');const postQuery=ref('');const posts=ref([]);const postTotal=ref(0);const reviews=ref([]);const reviewQuery=ref('');const reviewTotal=ref(0);const reviewSummary=ref({});const loading=ref(false);const loadingMore=ref(false);const error=ref('');const filtersOpen=ref(false);const pageSize=20;const dishOptionItems=ref([]);
const reviewFilters=reactive({targetType:'dish',canteenId:'',stallId:'',dishId:'',sort:'rating_desc'});
const reviewFilterCount=computed(()=>[reviewFilters.canteenId,reviewFilters.stallId,reviewFilters.dishId].filter(Boolean).length+(reviewFilters.sort!=='rating_desc'?1:0));
const canteenOptions=computed(()=>[{id:'',name:'全部食堂'},...store.canteens.value]);const selectedCanteen=computed(()=>store.canteens.value.find((item)=>item.id===reviewFilters.canteenId));const canteenIndex=computed(()=>Math.max(0,canteenOptions.value.findIndex((item)=>item.id===reviewFilters.canteenId)));
const stallOptions=computed(()=>[{id:'',name:'全部档口'},...store.stalls.value.filter((item)=>!reviewFilters.canteenId||item.canteenId===reviewFilters.canteenId)]);const selectedStall=computed(()=>store.stalls.value.find((item)=>item.id===reviewFilters.stallId));const stallIndex=computed(()=>Math.max(0,stallOptions.value.findIndex((item)=>item.id===reviewFilters.stallId)));
const dishOptions=computed(()=>[{id:'',name:'全部菜品'},...dishOptionItems.value]);const selectedDish=computed(()=>dishOptionItems.value.find((item)=>item.id===reviewFilters.dishId));const dishIndex=computed(()=>Math.max(0,dishOptions.value.findIndex((item)=>item.id===reviewFilters.dishId)));
const selectedSort=computed(()=>sortOptions.find((item)=>item.value===reviewFilters.sort)||sortOptions[0]);const sortIndex=computed(()=>sortOptions.findIndex((item)=>item.value===reviewFilters.sort));
let ready=false;let postSearchTimer=0;let reviewSearchTimer=0;let lastLoadedAt=0;let syncingSection=false;
  onShow(async()=>{try{await store.refreshIfStale();if(!store.user.value){uni.reLaunch({url:'/pages/login/login'});return;}await loadDishOptions();const requested=store.communitySection.value;if(!ready){syncingSection=true;section.value=requested;ready=true;await loadCurrent(true);syncingSection=false;return;}if(section.value!==requested){syncingSection=true;section.value=requested;await loadCurrent(true);syncingSection=false;return;}if(Date.now()-lastLoadedAt>15000)await loadCurrent(true);}catch{syncingSection=false;}});
  onPullDownRefresh(async()=>{try{await store.load(true);await loadCurrent(true);}catch{}finally{uni.stopPullDownRefresh();}});onReachBottom(()=>{if(section.value==='posts')loadMorePosts();else loadMoreReviews();});
watch(section,(value)=>{store.openCommunitySection(value);if(ready&&!syncingSection)loadCurrent(true);});watch(postType,()=>{if(ready)loadPosts(true);});watch(postQuery,()=>{if(!ready)return;clearTimeout(postSearchTimer);postSearchTimer=setTimeout(()=>loadPosts(true),280);});watch(reviewQuery,()=>{if(!ready)return;clearTimeout(reviewSearchTimer);reviewSearchTimer=setTimeout(()=>{if(section.value==='reviews')loadReviews(true);},280);});watch(()=>[reviewFilters.targetType,reviewFilters.canteenId,reviewFilters.stallId],()=>{reviewFilters.dishId='';loadDishOptions();});watch(()=>[reviewFilters.targetType,reviewFilters.canteenId,reviewFilters.stallId,reviewFilters.dishId,reviewFilters.sort],()=>{if(ready&&section.value==='reviews')loadReviews(true);},{deep:true});
async function loadCurrent(reset){return section.value==='posts'?loadPosts(reset):loadReviews(reset);}async function loadPosts(reset=false){if(reset){loading.value=true;posts.value=[];}else loadingMore.value=true;error.value='';try{const data=await store.listPosts({targetType:postType.value,q:postQuery.value.trim(),limit:pageSize,offset:reset?0:posts.value.length});posts.value=reset?(data.posts||[]):[...posts.value,...(data.posts||[])];postTotal.value=Number(data.total||0);lastLoadedAt=Date.now();}catch(err){error.value=err.message||'帖子加载失败';}finally{loading.value=false;loadingMore.value=false;}}
async function loadReviews(reset=false){if(reset){loading.value=true;reviews.value=[];}else loadingMore.value=true;error.value='';try{const data=await store.listReviews({...reviewFilters,q:reviewQuery.value.trim(),limit:pageSize,offset:reset?0:reviews.value.length});reviews.value=reset?(data.reviews||[]):[...reviews.value,...(data.reviews||[])];reviewTotal.value=Number(data.total||0);reviewSummary.value=data.summary||{};lastLoadedAt=Date.now();}catch(err){error.value=err.message||'评价加载失败';}finally{loading.value=false;loadingMore.value=false;}}
function loadMorePosts(){if(!loadingMore.value&&posts.value.length<postTotal.value)return loadPosts(false);}function loadMoreReviews(){if(!loadingMore.value&&reviews.value.length<reviewTotal.value)return loadReviews(false);}function openPublish(){uni.navigateTo({url:'/pages/community-publish/community-publish'});}
function selectCanteen(event){reviewFilters.canteenId=canteenOptions.value[Number(event.detail.value)]?.id||'';reviewFilters.stallId='';reviewFilters.dishId='';}function selectStall(event){reviewFilters.stallId=stallOptions.value[Number(event.detail.value)]?.id||'';reviewFilters.dishId='';}function selectDish(event){reviewFilters.dishId=dishOptions.value[Number(event.detail.value)]?.id||'';}function selectSort(event){reviewFilters.sort=sortOptions[Number(event.detail.value)]?.value||'rating_desc';}
async function loadDishOptions(){if(reviewFilters.targetType!=='dish'){dishOptionItems.value=[];return;}try{const result=await store.communityDishOptions({venueId:reviewFilters.canteenId,stallId:reviewFilters.stallId,page:1,pageSize:100});dishOptionItems.value=result.options||[];}catch{dishOptionItems.value=[];}}
function openPostTarget(post){if(post.dish?.id)uni.navigateTo({url:`/pages/dish-detail/dish-detail?id=${encodeURIComponent(post.dish.id)}`});else if(post.canteen?.id)uni.navigateTo({url:`/pages/canteen-detail/canteen-detail?id=${encodeURIComponent(post.canteen.id)}`});}function openReviewTarget(review){openPostTarget(review);}
function entryStyle(index){return store.motionReduced.value?{}:{animationDelay:`${Math.min(index,7)*35}ms`};}
function statusLabel(status){return{pending:'审核中',approved:'已公开',rejected:'未通过'}[status]||status;}function formatDate(value){return String(value||'').replace('T',' ').slice(0,16);}
</script>

<style scoped>
.community-toolbar { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:12px 0; }
.post-filter { flex:1; min-width:0; }
.keyword-search { display:flex; min-height:44px; align-items:center; gap:8px; margin-bottom:12px; padding:0 12px; border:1px solid var(--line); border-radius:var(--radius); background:var(--surface); }
.keyword-search input { flex:1; min-width:0; height:42px; color:var(--ink); font-size:14px; }
.keyword-search button { flex:0 0 auto; min-height:32px; padding:0 7px; border-radius:6px; color:var(--ink-2); background:var(--surface-soft); font-size:12px; }
.publish-button { display:flex; min-height:44px; flex:0 0 auto; align-items:center; justify-content:center; }
.publish-visual { display:flex; height:36px; align-items:center; justify-content:center; gap:6px; padding:0 12px; border-radius:var(--radius); color:#fff; background:var(--module-accent); font-size:12px; font-weight:600; }
.publish-button:active .publish-visual { transform:translateY(1px); opacity:.82; }
.post-list,.review-list { display:flex; flex-direction:column; gap:0; margin-top:12px; border-radius:var(--radius-large); background:var(--surface); }
.post-list { max-width:760px; margin-right:auto; margin-left:auto; }
.post-card { padding:18px 16px; border-bottom:1px solid var(--line); background:transparent; animation:list-in var(--motion-base) var(--ease-standard) both; }.post-card:last-of-type { border-bottom:0; }
.post-head { display:flex; align-items:center; gap:10px; }
.avatar { display:flex; width:36px; height:36px; flex:0 0 36px; align-items:center; justify-content:center; border-radius:50%; color:#fff; background:var(--module-accent); font-size:14px; font-weight:600; }
.author { flex:1; min-width:0; }
.author .ui-strong,.author text { display:block; }
.author .ui-strong { color:var(--ink); font-size:14px; font-weight:600; }
.author text { margin-top:2px; color:var(--muted); font-size:12px; }
.status { min-height:22px; padding:0 7px; border-radius:6px; font-size:12px; line-height:22px; }
.status.pending { color:var(--warning); background:var(--warning-soft); }.status.approved { color:var(--success); background:var(--success-soft); }.status.rejected { color:var(--danger); background:var(--danger-soft); }
.post-content { display:block; margin:14px 0; color:var(--ink); font-size:14px; line-height:1.6; white-space:pre-wrap; }
.post-image { display:block; width:100%; height:clamp(220px,56vw,360px); border-radius:var(--radius); background:var(--surface-soft); }
.post-target { display:grid; grid-template-columns:auto minmax(0,1fr) auto; width:100%; min-height:48px; align-items:center; gap:10px; margin-top:10px; padding-top:10px; border-top:1px solid var(--line); text-align:left; }
.post-target>text:first-child { min-height:22px; padding:0 7px; border-radius:6px; color:var(--ink-2); background:var(--surface-soft); font-size:12px; font-weight:500; line-height:22px; }
.post-target .ui-strong,.post-target .ui-small { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.post-target .ui-strong { color:var(--ink); font-size:14px; font-weight:600; }
.post-target .ui-small { margin-top:2px; color:var(--muted); font-size:12px; }
.post-rating { display:flex; justify-content:space-between; margin-top:8px; color:var(--muted); font-size:12px; }
.post-rating .ui-strong { color:var(--ink); font-size:12px; font-weight:600; }
.load-more { display:flex; min-height:44px; align-items:center; justify-content:center; }
.load-more>view { display:flex; min-width:112px; height:36px; align-items:center; justify-content:center; padding:0 12px; border:1px solid var(--line); border-radius:var(--radius); color:var(--ink); background:var(--surface); font-size:12px; font-weight:500; }
.load-more:active>view { transform:translateY(1px); background:var(--surface-soft); }
.community-workspace,.review-sidebar,.review-main { min-width:0; }
.review-controls { padding:2px 0; }
.picker-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px; }
.picker-touch { display:flex; min-width:0; min-height:44px; align-items:center; }
.picker-box { display:flex; width:100%; height:40px; min-width:0; align-items:center; justify-content:space-between; padding:0 10px; border:1px solid var(--line); border-radius:var(--radius); color:var(--ink-2); background:var(--surface-soft); font-size:12px; box-sizing:border-box; }
.picker-label { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.review-summary { display:grid; grid-template-columns:repeat(4,1fr); margin:12px 0; border:1px solid var(--line); border-radius:var(--radius-large); background:var(--surface); }
.review-summary view { position:relative; min-width:0; padding:10px 4px; text-align:center; }
.review-summary view+view::before { position:absolute; top:10px; bottom:10px; left:0; width:1px; background:var(--line); content:''; }
.review-summary .ui-strong,.review-summary text { display:block; }
.review-summary .ui-strong { color:var(--ink); font-size:14px; font-weight:600; font-variant-numeric:tabular-nums; }
.review-summary text { margin-top:2px; color:var(--muted); font-size:12px; }
.review-card { display:grid; grid-template-columns:36px minmax(0,1fr) 20px; width:100%; align-items:start; gap:10px; padding:16px; border-bottom:1px solid var(--line); background:transparent; text-align:left; animation:list-in var(--motion-base) var(--ease-standard) both; }.review-card:last-of-type { border-bottom:0; }
.review-score { display:flex; width:36px; height:36px; flex-direction:column; align-items:center; justify-content:center; border-radius:8px; color:var(--module-dark); background:var(--module-soft); }
.review-score .ui-strong { font-size:14px; font-weight:600; line-height:1; }.review-score text { font-size:12px; }
.review-copy { min-width:0; }.review-copy>view { display:flex; align-items:center; gap:6px; }
.review-copy>view .ui-strong { overflow:hidden; color:var(--ink); font-size:14px; font-weight:600; white-space:nowrap; text-overflow:ellipsis; }
.review-copy>view text { flex:0 0 auto; min-height:20px; padding:0 6px; border-radius:5px; color:var(--ink-2); background:var(--surface-soft); font-size:12px; line-height:20px; }
.review-copy .ui-small { margin-top:3px; font-size:12px; }.review-copy .ui-paragraph { margin:7px 0; color:var(--ink-2); font-size:14px; line-height:1.5; }
.review-copy .ui-footer { display:flex; flex-wrap:wrap; gap:10px; color:var(--muted); font-size:12px; }
@keyframes list-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
@media (max-width:359px) { .review-summary { grid-template-columns:repeat(2,1fr); }.review-summary view:nth-child(3)::before { display:none; }.review-summary view:nth-child(n+3) { border-top:1px solid var(--line); } }
@media (min-width:768px) { .community-workspace { display:grid; grid-template-columns:280px minmax(0,1fr); gap:28px; align-items:start; }.review-sidebar { position:sticky; top:72px; }.review-summary { grid-template-columns:repeat(2,1fr); }.review-summary view:nth-child(3)::before { display:none; }.review-summary view:nth-child(n+3) { border-top:1px solid var(--line); }.post-card { padding:20px; } }
</style>
