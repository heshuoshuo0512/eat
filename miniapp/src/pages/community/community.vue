<template>
  <sc-page-shell title="社区">
    <sc-segmented-control v-model="section" :options="sectionOptions" block />

    <template v-if="section==='posts'">
      <view class="community-toolbar">
        <view class="post-filter"><sc-segmented-control v-model="postType" :options="postTypeOptions" density="compact" block /></view>
        <button class="publish-button" aria-label="发布帖子" @tap="openPublish"><view class="publish-visual"><image src="/static/icons/message-square.png" mode="aspectFit" /><text>发布帖子</text></view></button>
      </view>
      <view class="keyword-search"><input v-model="postQuery" confirm-type="search" placeholder="搜索帖子内容、菜品或食堂" /><button v-if="postQuery" type="button" @tap="postQuery=''">清除</button></view>
      <sc-state-card v-if="loading" type="loading" title="正在加载校园动态" />
      <sc-state-card v-else-if="error" type="error" title="动态加载失败" :desc="error" action-text="重试" @action="loadPosts(true)" />
      <view v-else-if="posts.length" class="post-list">
        <view v-for="post in posts" :key="post.id" class="post-card">
          <view class="post-head"><view class="avatar">{{ String(post.user||'同').slice(0,1) }}</view><view class="author"><text class="ui-strong">{{ post.user||'校园同学' }}</text><text>{{ formatDate(post.createdAt) }}</text></view><text v-if="post.isOwn" class="status" :class="post.status">{{ statusLabel(post.status) }}</text></view>
          <text class="post-content">{{ post.content }}</text>
          <image v-if="post.imageUrl" class="post-image" :src="post.imageUrl" mode="widthFix" />
          <button class="post-target" @tap="openPostTarget(post)"><text>{{ post.targetType==='dish'?'菜品':'食堂' }}</text><view><text class="ui-strong">{{ post.dish?.name||post.canteen?.name||'校园食堂' }}</text><text class="ui-small">{{ [post.canteen?.name,post.stall?.name].filter(Boolean).join(' · ') }}</text></view><text>›</text></button>
          <view v-if="post.rating" class="post-rating"><text>菜品评分</text><text class="ui-strong">{{ post.rating }}.0</text></view>
        </view>
        <button v-if="posts.length<postTotal" class="load-more" :disabled="loadingMore" @tap="loadMorePosts"><view>{{ loadingMore ? '加载中…' : '加载更多' }}</view></button>
      </view>
      <sc-state-card v-else type="empty" title="还没有校园帖子" desc="分享第一条真实用餐体验。" action-text="发布帖子" @action="openPublish" />
    </template>

    <template v-else>
      <view class="keyword-search"><input v-model="reviewQuery" confirm-type="search" placeholder="搜索评价内容、菜品或食堂" /><button v-if="reviewQuery" type="button" @tap="reviewQuery=''">清除</button></view>
      <view class="review-controls">
        <sc-segmented-control v-model="reviewFilters.targetType" :options="reviewTypeOptions" block density="compact" />
        <view class="picker-grid">
          <picker class="picker-touch" :range="canteenOptions" range-key="name" :value="canteenIndex" @change="selectCanteen"><view class="picker-box"><text class="picker-label">{{ selectedCanteen?.name||'全部食堂' }}</text><text>⌄</text></view></picker>
          <picker v-if="reviewFilters.targetType==='dish'" class="picker-touch" :range="stallOptions" range-key="name" :value="stallIndex" @change="selectStall"><view class="picker-box"><text class="picker-label">{{ selectedStall?.name||'全部档口' }}</text><text>⌄</text></view></picker>
          <picker v-if="reviewFilters.targetType==='dish'" class="picker-touch" :range="dishOptions" range-key="name" :value="dishIndex" @change="selectDish"><view class="picker-box"><text class="picker-label">{{ selectedDish?.name||'全部菜品' }}</text><text>⌄</text></view></picker>
          <picker class="picker-touch" :range="sortOptions" range-key="label" :value="sortIndex" @change="selectSort"><view class="picker-box"><text class="picker-label">{{ selectedSort.label }}</text><text>⌄</text></view></picker>
        </view>
      </view>
      <view class="review-summary"><view><text class="ui-strong">{{ reviewSummary.averageRating||'-' }}</text><text>平均评分</text></view><view><text class="ui-strong">{{ reviewTotal }}</text><text>当前评价</text></view><view><text class="ui-strong">{{ reviewSummary.dishReviews||0 }}</text><text>菜品评价</text></view><view><text class="ui-strong">{{ reviewSummary.canteenReviews||0 }}</text><text>食堂评价</text></view></view>
      <sc-state-card v-if="loading" type="loading" title="正在加载评价" />
      <sc-state-card v-else-if="error" type="error" title="评价加载失败" :desc="error" action-text="重试" @action="loadReviews(true)" />
      <view v-else-if="reviews.length" class="review-list">
        <button v-for="review in reviews" :key="review.id" class="review-card" @tap="openReviewTarget(review)"><view class="review-score"><text class="ui-strong">{{ review.rating }}</text><text>分</text></view><view class="review-copy"><view><text class="ui-strong">{{ review.dish?.name||review.canteen?.name||'校园评价' }}</text><text>{{ review.targetType==='dish'?'菜品':'食堂' }}</text></view><text class="ui-small">{{ [review.canteen?.name,review.stall?.name].filter(Boolean).join(' · ') }}</text><text class="ui-paragraph">{{ review.content }}</text><view class="ui-footer"><text>{{ review.user }}</text><text>{{ formatDate(review.createdAt) }}</text></view></view><text class="arrow">›</text></button>
        <button v-if="reviews.length<reviewTotal" class="load-more" :disabled="loadingMore" @tap="loadMoreReviews"><view>{{ loadingMore ? '加载中…' : '加载更多' }}</view></button>
      </view>
      <sc-state-card v-else type="empty" title="没有符合条件的评价" desc="调整筛选条件后再试。" />
    </template>
  </sc-page-shell>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app';
import { useCanteenStore } from '../../stores/canteenStore.js';
const store=useCanteenStore();const sectionOptions=[{value:'posts',label:'校园帖子'},{value:'reviews',label:'菜品评价'}];const postTypeOptions=[{value:'',label:'全部'},{value:'dish',label:'菜品'},{value:'canteen',label:'食堂'}];const reviewTypeOptions=[{value:'dish',label:'菜品评价'},{value:'canteen',label:'食堂评价'}];const sortOptions=[{value:'rating_desc',label:'评分优先'},{value:'rating_asc',label:'低分优先'},{value:'latest',label:'最新评价'}];
const section=ref('posts');const postType=ref('');const postQuery=ref('');const posts=ref([]);const postTotal=ref(0);const reviews=ref([]);const reviewQuery=ref('');const reviewTotal=ref(0);const reviewSummary=ref({});const loading=ref(false);const loadingMore=ref(false);const error=ref('');const pageSize=20;
const reviewFilters=reactive({targetType:'dish',canteenId:'',stallId:'',dishId:'',sort:'rating_desc'});
const canteenOptions=computed(()=>[{id:'',name:'全部食堂'},...store.canteens.value]);const selectedCanteen=computed(()=>store.canteens.value.find((item)=>item.id===reviewFilters.canteenId));const canteenIndex=computed(()=>Math.max(0,canteenOptions.value.findIndex((item)=>item.id===reviewFilters.canteenId)));
const stallOptions=computed(()=>[{id:'',name:'全部档口'},...store.stalls.value.filter((item)=>!reviewFilters.canteenId||item.canteenId===reviewFilters.canteenId)]);const selectedStall=computed(()=>store.stalls.value.find((item)=>item.id===reviewFilters.stallId));const stallIndex=computed(()=>Math.max(0,stallOptions.value.findIndex((item)=>item.id===reviewFilters.stallId)));
const dishOptions=computed(()=>[{id:'',name:'全部菜品'},...store.dishes.value.filter((dish)=>reviewFilters.stallId?dish.stallId===reviewFilters.stallId:!reviewFilters.canteenId||stallOptions.value.some((stall)=>stall.id===dish.stallId))]);const selectedDish=computed(()=>store.dishes.value.find((item)=>item.id===reviewFilters.dishId));const dishIndex=computed(()=>Math.max(0,dishOptions.value.findIndex((item)=>item.id===reviewFilters.dishId)));
const selectedSort=computed(()=>sortOptions.find((item)=>item.value===reviewFilters.sort)||sortOptions[0]);const sortIndex=computed(()=>sortOptions.findIndex((item)=>item.value===reviewFilters.sort));
let ready=false;let postSearchTimer=0;let reviewSearchTimer=0;let lastLoadedAt=0;let syncingSection=false;
  onShow(async()=>{try{await store.refreshIfStale();if(!store.user.value){uni.reLaunch({url:'/pages/login/login'});return;}const requested=store.communitySection.value;if(!ready){syncingSection=true;section.value=requested;ready=true;await loadCurrent(true);syncingSection=false;return;}if(section.value!==requested){syncingSection=true;section.value=requested;await loadCurrent(true);syncingSection=false;return;}if(Date.now()-lastLoadedAt>15000)await loadCurrent(true);}catch{syncingSection=false;}});
  onPullDownRefresh(async()=>{try{await store.load(true);await loadCurrent(true);}catch{}finally{uni.stopPullDownRefresh();}});onReachBottom(()=>{if(section.value==='posts')loadMorePosts();else loadMoreReviews();});
watch(section,(value)=>{store.openCommunitySection(value);if(ready&&!syncingSection)loadCurrent(true);});watch(postType,()=>{if(ready)loadPosts(true);});watch(postQuery,()=>{if(!ready)return;clearTimeout(postSearchTimer);postSearchTimer=setTimeout(()=>loadPosts(true),280);});watch(reviewQuery,()=>{if(!ready)return;clearTimeout(reviewSearchTimer);reviewSearchTimer=setTimeout(()=>{if(section.value==='reviews')loadReviews(true);},280);});watch(()=>[reviewFilters.targetType,reviewFilters.canteenId,reviewFilters.stallId,reviewFilters.dishId,reviewFilters.sort],()=>{if(ready&&section.value==='reviews')loadReviews(true);},{deep:true});
async function loadCurrent(reset){return section.value==='posts'?loadPosts(reset):loadReviews(reset);}async function loadPosts(reset=false){if(reset){loading.value=true;posts.value=[];}else loadingMore.value=true;error.value='';try{const data=await store.listPosts({targetType:postType.value,q:postQuery.value.trim(),limit:pageSize,offset:reset?0:posts.value.length});posts.value=reset?(data.posts||[]):[...posts.value,...(data.posts||[])];postTotal.value=Number(data.total||0);lastLoadedAt=Date.now();}catch(err){error.value=err.message||'帖子加载失败';}finally{loading.value=false;loadingMore.value=false;}}
async function loadReviews(reset=false){if(reset){loading.value=true;reviews.value=[];}else loadingMore.value=true;error.value='';try{const data=await store.listReviews({...reviewFilters,q:reviewQuery.value.trim(),limit:pageSize,offset:reset?0:reviews.value.length});reviews.value=reset?(data.reviews||[]):[...reviews.value,...(data.reviews||[])];reviewTotal.value=Number(data.total||0);reviewSummary.value=data.summary||{};lastLoadedAt=Date.now();}catch(err){error.value=err.message||'评价加载失败';}finally{loading.value=false;loadingMore.value=false;}}
function loadMorePosts(){if(!loadingMore.value&&posts.value.length<postTotal.value)return loadPosts(false);}function loadMoreReviews(){if(!loadingMore.value&&reviews.value.length<reviewTotal.value)return loadReviews(false);}function openPublish(){uni.navigateTo({url:'/pages/community-publish/community-publish'});}
function selectCanteen(event){reviewFilters.canteenId=canteenOptions.value[Number(event.detail.value)]?.id||'';reviewFilters.stallId='';reviewFilters.dishId='';}function selectStall(event){reviewFilters.stallId=stallOptions.value[Number(event.detail.value)]?.id||'';reviewFilters.dishId='';}function selectDish(event){reviewFilters.dishId=dishOptions.value[Number(event.detail.value)]?.id||'';}function selectSort(event){reviewFilters.sort=sortOptions[Number(event.detail.value)]?.value||'rating_desc';}
function openPostTarget(post){if(post.dish?.id)uni.navigateTo({url:`/pages/dish-detail/dish-detail?id=${encodeURIComponent(post.dish.id)}`});else if(post.canteen?.id)uni.navigateTo({url:`/pages/canteen-detail/canteen-detail?id=${encodeURIComponent(post.canteen.id)}`});}function openReviewTarget(review){openPostTarget(review);}
function statusLabel(status){return{pending:'审核中',approved:'已公开',rejected:'未通过'}[status]||status;}function formatDate(value){return String(value||'').replace('T',' ').slice(0,16);}
</script>

<style scoped>
.community-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12rpx; margin:18rpx 0; }
.post-filter { flex:1; min-width:0; }
.keyword-search { display:flex; align-items:center; gap:8rpx; min-height:76rpx; margin:0 0 14rpx; padding:0 14rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); }
.keyword-search input { flex:1; min-width:0; height:64rpx; color:var(--ink); font-size:24rpx; }
.keyword-search button { flex:0 0 auto; min-height:52rpx; padding:0 10rpx; border-radius:8rpx; color:var(--brand); background:var(--brand-soft); font-size:22rpx; }
.publish-button { display:flex; align-items:center; justify-content:center; min-height:88rpx; flex:0 0 auto; padding:0; background:transparent; }
.publish-visual { display:flex; align-items:center; justify-content:center; gap:8rpx; height:64rpx; padding:0 16rpx; border-radius:10rpx; color:#fff; background:var(--brand); font-size:24rpx; font-weight:500; box-sizing:border-box; }
.publish-visual image { width:28rpx; height:28rpx; filter:brightness(0) invert(1); }
.publish-button:active .publish-visual { transform:scale(.97); opacity:.9; }
.post-list,.review-list { display:flex; flex-direction:column; gap:14rpx; margin-top:18rpx; }
.post-card { padding:22rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); animation:list-in 220ms ease both; }
.post-head { display:flex; align-items:center; gap:12rpx; }
.avatar { display:flex; align-items:center; justify-content:center; width:64rpx; height:64rpx; border-radius:50%; color:#fff; background:var(--brand); font-size:26rpx; font-weight:600; }
.author { flex:1; min-width:0; }
.author .ui-strong,.author text { display:block; }
.author .ui-strong { color:var(--ink); font-size:26rpx; font-weight:600; }
.author text { margin-top:3rpx; color:var(--muted); font-size:22rpx; }
.status { min-height:40rpx; padding:0 9rpx; border-radius:8rpx; font-size:22rpx; line-height:40rpx; }
.status.pending { color:#8d5d16; background:var(--rating-soft); }.status.approved { color:var(--brand); background:var(--brand-soft); }.status.rejected { color:var(--danger); background:var(--danger-soft); }
.post-content { display:block; margin:18rpx 0; color:var(--ink); font-size:26rpx; line-height:1.62; white-space:pre-wrap; }
.post-image { display:block; width:100%; max-height:620rpx; border-radius:var(--radius); background:var(--surface-soft); }
.post-target { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:12rpx; width:100%; min-height:88rpx; margin-top:14rpx; padding:12rpx 0 0; border-top:1rpx solid var(--line); border-radius:0; background:transparent; text-align:left; }
.post-target>text:first-child { min-height:38rpx; padding:0 8rpx; border-radius:8rpx; color:var(--brand); background:var(--brand-soft); font-size:22rpx; font-weight:500; line-height:38rpx; }
.post-target .ui-strong,.post-target .ui-small { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.post-target .ui-strong { color:var(--ink); font-size:24rpx; font-weight:600; }
.post-target .ui-small { margin-top:3rpx; color:var(--muted); font-size:22rpx; }
.post-target>text:last-child { color:var(--muted); font-size:32rpx; }
.post-rating { display:flex; justify-content:space-between; margin-top:12rpx; color:var(--muted); font-size:22rpx; }
.post-rating .ui-strong { color:#966218; font-size:24rpx; font-weight:600; }
.load-more { display:flex; align-items:center; justify-content:center; min-height:88rpx; padding:0; background:transparent; }
.load-more>view { display:flex; align-items:center; justify-content:center; min-width:180rpx; height:60rpx; padding:0 18rpx; border:1rpx solid var(--line); border-radius:10rpx; color:var(--brand); background:var(--surface); font-size:24rpx; font-weight:500; box-sizing:border-box; }
.load-more:active>view { transform:scale(.97); background:var(--brand-soft); }
.review-controls { margin-top:18rpx; padding:18rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); }
.picker-grid { display:grid; grid-template-columns:1fr 1fr; gap:10rpx; margin-top:14rpx; }
.picker-touch { display:flex; align-items:center; min-width:0; min-height:88rpx; }
.picker-box { display:flex; align-items:center; justify-content:space-between; width:100%; height:64rpx; min-width:0; padding:0 14rpx; border:1rpx solid var(--line); border-radius:10rpx; color:var(--ink-2); background:var(--surface-soft); font-size:24rpx; box-sizing:border-box; }
.picker-label { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.review-summary { display:grid; grid-template-columns:repeat(4,1fr); margin:14rpx 0; padding:10rpx 0; border-top:1rpx solid var(--line); border-bottom:1rpx solid var(--line); }
.review-summary view { position:relative; min-width:0; padding:4rpx; text-align:center; }
.review-summary view+view::before { position:absolute; top:8rpx; bottom:8rpx; left:0; width:1rpx; background:var(--line); content:''; }
.review-summary .ui-strong,.review-summary text { display:block; }
.review-summary .ui-strong { color:var(--ink); font-size:26rpx; font-weight:600; }
.review-summary text { margin-top:3rpx; color:var(--muted); font-size:22rpx; }
.review-card { position:relative; display:grid; grid-template-columns:62rpx minmax(0,1fr) 24rpx; gap:14rpx; align-items:start; width:100%; padding:18rpx; border:1rpx solid var(--line); border-radius:var(--radius); background:var(--surface); text-align:left; }
.review-score { display:flex; flex-direction:column; align-items:center; justify-content:center; width:62rpx; height:62rpx; border-radius:50%; color:#966218; background:var(--rating-soft); }
.review-score .ui-strong { font-size:24rpx; font-weight:600; line-height:1; }
.review-score text { font-size:22rpx; }
.review-copy { min-width:0; }
.review-copy>view { display:flex; align-items:center; gap:8rpx; }
.review-copy>view .ui-strong { overflow:hidden; color:var(--ink); font-size:26rpx; font-weight:600; white-space:nowrap; text-overflow:ellipsis; }
.review-copy>view text { flex:0 0 auto; min-height:36rpx; padding:0 7rpx; border-radius:7rpx; color:var(--brand); background:var(--brand-soft); font-size:22rpx; line-height:36rpx; }
.review-copy .ui-small { display:block; margin-top:4rpx; color:var(--muted); font-size:22rpx; }
.review-copy .ui-paragraph { margin:9rpx 0; color:var(--ink-2); font-size:24rpx; line-height:1.55; }
.review-copy .ui-footer { display:flex; flex-wrap:wrap; gap:12rpx; color:var(--muted); font-size:22rpx; }
.arrow { align-self:center; color:var(--muted); font-size:30rpx; }
@keyframes list-in { from { opacity:0; transform:translateY(8rpx); } to { opacity:1; transform:none; } }
</style>
