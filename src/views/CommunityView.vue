<template>
  <section class="page-heading community-heading">
    <div><p class="eyebrow">Campus Community</p><h1>校园帖子</h1><p>分享真实用餐体验，关联食堂或菜品后提交审核。</p></div>
    <button class="primary" type="button" @click="composerOpen = !composerOpen">{{ composerOpen ? '收起发布' : '发布帖子' }}</button>
  </section>

  <form v-if="composerOpen" class="card post-composer" @submit.prevent="submitPost">
    <div class="segmented" aria-label="帖子归属">
      <button type="button" :class="{ active: form.targetType === 'canteen' }" @click="setTargetType('canteen')">关联食堂</button>
      <button type="button" :class="{ active: form.targetType === 'dish' }" @click="setTargetType('dish')">关联菜品</button>
    </div>
    <div class="target-grid">
      <label><span>食堂</span><SearchSelect v-model="selectedCanteenId" :options="canteenOptions" placeholder="输入食堂名称" @change="onCanteenChange" /></label>
      <label v-if="form.targetType === 'dish'"><span>档口</span><SearchSelect v-model="selectedStallId" :options="stallOptions" placeholder="输入档口名称" @change="onStallChange" /></label>
      <label v-if="form.targetType === 'dish'"><span>菜品</span><SearchSelect v-model="form.targetId" :options="dishOptions" placeholder="输入菜品名称" @search="searchDishOptions" /></label>
    </div>
    <label class="content-field"><span>帖子内容</span><textarea v-model.trim="form.content" minlength="2" maxlength="600" required placeholder="说说味道、份量、排队体验，或者分享你的搭配建议…" /><small>{{ form.content.length }} / 600</small></label>
    <div v-if="form.targetType === 'dish'" class="rating-picker"><span>菜品评分（可选）</span><div><button v-for="score in 5" :key="score" type="button" class="star-button" :class="{ active: score <= form.rating }" :aria-label="`${score} 分`" @click="form.rating = form.rating === score ? 0 : score">★</button></div></div>
    <div class="image-upload">
      <label class="secondary upload-button"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="selectImage" />选择图片</label>
      <span class="muted">可选，最多 1 张，4MB 以内</span>
      <img v-if="imagePreview" :src="imagePreview" alt="帖子图片预览" />
      <button v-if="imageFile" class="ghost" type="button" @click="clearImage">移除图片</button>
    </div>
    <div class="composer-actions"><button class="primary" type="submit" :disabled="submitting">{{ submitting ? '提交中…' : '提交审核' }}</button><span class="muted">审核通过后会出现在公开动态中。</span></div>
    <p v-if="composerMessage" class="form-message" :class="{ danger: composerError }">{{ composerMessage }}</p>
  </form>

  <section class="feed-toolbar"><div class="segmented"><button type="button" :class="{ active: feedType === '' }" @click="changeFeed('')">全部</button><button type="button" :class="{ active: feedType === 'dish' }" @click="changeFeed('dish')">菜品</button><button type="button" :class="{ active: feedType === 'canteen' }" @click="changeFeed('canteen')">食堂</button><button type="button" :class="{ active: feedType === 'mine' }" @click="changeFeed('mine')">我的</button></div><button class="ghost" type="button" :disabled="loading" @click="loadPosts">刷新</button></section>

  <section v-if="loading" class="card empty-state"><p>正在加载校园动态…</p></section>
  <section v-else-if="loadError" class="card empty-state"><p>{{ loadError }}</p><button class="primary" type="button" @click="loadPosts">重试</button></section>
  <section v-else-if="store.communityPosts.length" class="post-feed">
    <article v-for="post in store.communityPosts" :key="post.id" class="post-item">
      <header><div class="avatar">{{ post.user?.slice(0, 1) || '同' }}</div><div><strong>{{ post.user }}</strong><small>{{ formatDate(post.createdAt) }}</small></div><span v-if="post.isOwn" class="status-badge" :class="post.status">{{ statusLabel(post.status) }}</span></header>
      <p class="post-content">{{ post.content }}</p>
      <img v-if="post.imageUrl" class="post-image" :src="post.imageUrl" :alt="`${post.user} 发布的用餐图片`" />
      <footer>
        <RouterLink :to="targetLink(post)" class="post-target"><span>{{ post.targetType === 'dish' ? '菜' : '堂' }}</span><strong>{{ post.dish?.name || post.canteen?.name }}</strong><small>{{ [post.canteen?.name, post.stall?.name].filter(Boolean).join(' · ') }}</small></RouterLink>
        <div v-if="post.rating" class="post-rating"><span v-for="score in 5" :key="score" :class="{ active: score <= post.rating }">★</span></div>
      </footer>
      <div class="post-actions">
        <button type="button" :class="{ active: post.viewerReaction === 'like' }" :disabled="post.status !== 'approved'" @click="react(post, 'like')">赞 {{ post.engagement?.likes || 0 }}</button>
        <button type="button" :class="{ active: post.viewerReaction === 'dislike' }" :disabled="post.status !== 'approved'" @click="react(post, 'dislike')">踩 {{ post.engagement?.dislikes || 0 }}</button>
        <button type="button" :disabled="post.status !== 'approved'" @click="toggleComments(post)">评论 {{ post.engagement?.comments || 0 }}</button>
        <button v-if="!post.isOwn" type="button" :disabled="post.status !== 'approved' || post.viewerReported" @click="report(post)">{{ post.viewerReported ? '已举报' : '举报' }}</button>
        <button v-if="post.canEdit" type="button" @click="editPost(post)">修改</button>
        <button v-if="post.canDelete" type="button" class="danger-text" @click="deletePost(post)">删除</button>
      </div>
      <section v-if="openCommentsId === post.id" class="comment-panel">
        <p v-if="commentsLoading">正在加载评论…</p>
        <div v-for="comment in commentsByPost[post.id] || []" :key="comment.id" class="comment-row"><strong>{{ comment.user }}</strong><span>{{ comment.content }}</span><time>{{ formatDate(comment.createdAt) }}</time></div>
        <form class="comment-form" @submit.prevent="submitComment(post)"><input v-model.trim="commentDrafts[post.id]" maxlength="300" placeholder="写评论"><button class="primary" type="submit">发布</button></form>
      </section>
    </article>
  </section>
  <section v-else class="card empty-state"><h2>还没有帖子</h2><p>发布第一条校园用餐分享。</p></section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import SearchSelect from '../components/SearchSelect.vue';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const composerOpen = ref(false);
const submitting = ref(false);
const composerMessage = ref('');
const composerError = ref(false);
const loading = ref(false);
const loadError = ref('');
const feedType = ref('');
const selectedCanteenId = ref('');
const selectedStallId = ref('');
const availableDishes = ref([]);
const imageFile = ref(null);
const imagePreview = ref('');
const form = reactive({ targetType: 'dish', targetId: '', content: '', rating: 0 });
const availableStalls = computed(() => store.stalls.filter((stall) => stall.canteenId === selectedCanteenId.value));
const selectableDishCanteens = computed(() => store.canteens.filter((canteen) => store.stalls.some((stall) => stall.canteenId === canteen.id)));
const selectableCanteens = computed(() => form.targetType === 'dish' ? selectableDishCanteens.value : store.canteens);
const canteenOptions = computed(() => selectableCanteens.value.map((item) => ({ id: item.id, label: item.name, description: item.location })));
const stallOptions = computed(() => {
  const nameCounts = new Map();
  for (const item of availableStalls.value) nameCounts.set(item.name, Number(nameCounts.get(item.name) || 0) + 1);
  return availableStalls.value.map((item) => {
    const canteen = store.canteens.find((entry) => entry.id === item.canteenId);
    const location = [canteen?.displayName || canteen?.name, item.floor].filter(Boolean).join(' · ');
    return {
      id: item.id,
      label: nameCounts.get(item.name) > 1 && location ? `${item.name}（${location}）` : item.name,
      description: location
    };
  });
});
const dishOptions = computed(() => availableDishes.value.map((item) => ({
  id: item.id,
  label: item.name,
  group: item.category || '其他',
  description: [item.canteenName, item.stallName, item.priceDisplay].filter(Boolean).join(' · ')
})));
const commentsByPost = reactive({});
const commentDrafts = reactive({});
const openCommentsId = ref('');
const commentsLoading = ref(false);
let dishSearchTimer;

function setTargetType(type) { form.targetType = type; form.targetId = ''; form.rating = 0; selectedCanteenId.value = ''; selectedStallId.value = ''; availableDishes.value = []; }
function onCanteenChange() { selectedStallId.value = ''; availableDishes.value = []; form.targetId = form.targetType === 'canteen' ? selectedCanteenId.value : ''; }
async function onStallChange() {
  form.targetId = '';
  if (!selectedStallId.value) { availableDishes.value = []; return; }
  try {
    const result = await store.loadCommunityDishOptions({ stallId: selectedStallId.value, page: 1, pageSize: 100 });
    availableDishes.value = result.options || [];
  } catch (error) {
    availableDishes.value = [];
    composerMessage.value = error.message || '菜品目录读取失败。';
    composerError.value = true;
  }
}
function searchDishOptions(query) { clearTimeout(dishSearchTimer); dishSearchTimer = setTimeout(() => loadDishOptions(query), 250); }
async function loadDishOptions(query = '') {
  if (!selectedStallId.value) return;
  const result = await store.loadCommunityDishOptions({ query, stallId: selectedStallId.value, page: 1, pageSize: 100 });
  availableDishes.value = result.options || [];
}
function changeFeed(type) { feedType.value = type; loadPosts(); }

function selectImage(event) {
  const file = event.target.files?.[0];
  composerMessage.value = '';
  composerError.value = false;
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 4 * 1024 * 1024) {
    composerMessage.value = '请选择 4MB 以内的 PNG、JPEG、WebP 或 GIF 图片。';
    composerError.value = true;
    event.target.value = '';
    return;
  }
  clearImage();
  imageFile.value = file;
  imagePreview.value = URL.createObjectURL(file);
}

function clearImage() { if (imagePreview.value) URL.revokeObjectURL(imagePreview.value); imagePreview.value = ''; imageFile.value = null; }
function fileToBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '').split(',')[1] || ''); reader.onerror = reject; reader.readAsDataURL(file); }); }

async function submitPost() {
  const targetId = form.targetType === 'canteen' ? selectedCanteenId.value : form.targetId;
  if (!targetId || form.content.length < 2) { composerMessage.value = '请选择关联对象并填写帖子内容。'; composerError.value = true; return; }
  submitting.value = true; composerMessage.value = ''; composerError.value = false;
  try {
    let imageUrl = '';
    if (imageFile.value) {
      const upload = await store.uploadImage({ filename: imageFile.value.name, contentType: imageFile.value.type, dataBase64: await fileToBase64(imageFile.value) });
      imageUrl = upload.reference || upload.url;
    }
    await store.createCommunityPost({ targetType: form.targetType, targetId, content: form.content, imageUrl, rating: form.targetType === 'dish' && form.rating ? form.rating : null });
    composerMessage.value = '帖子已提交审核，你可以在动态中查看审核状态。';
    form.content = ''; form.rating = 0; form.targetId = ''; selectedCanteenId.value = ''; selectedStallId.value = ''; clearImage();
    await loadPosts();
  } catch (error) { composerError.value = true; composerMessage.value = error.message || '帖子发布失败'; }
  finally { submitting.value = false; }
}

async function loadPosts() { loading.value = true; loadError.value = ''; try { await store.loadCommunityPosts({ targetType: feedType.value === 'mine' ? '' : feedType.value, mine: feedType.value === 'mine', limit: 100 }); } catch (error) { loadError.value = error.message || '帖子加载失败'; } finally { loading.value = false; } }
function targetLink(post) { return post.dish ? { name: 'dish-detail', params: { id: post.dish.id } } : { path: '/canteens', query: { canteen: post.canteen?.id } }; }
function formatDate(value) { return String(value || '').replace('T', ' ').slice(0, 16); }
function statusLabel(status) { return { pending: '审核中', approved: '已公开', rejected: '未通过' }[status] || status; }
async function react(post, reaction) { await store.reactToCommunityContent('post', post.id, post.viewerReaction === reaction ? null : reaction); }
async function report(post) { if (window.confirm('确认举报这条帖子？')) await store.reportCommunityContent('post', post.id, { reason: 'inappropriate' }); }
async function toggleComments(post) {
  openCommentsId.value = openCommentsId.value === post.id ? '' : post.id;
  if (!openCommentsId.value || commentsByPost[post.id]) return;
  commentsLoading.value = true;
  try { commentsByPost[post.id] = (await store.listPostComments(post.id)).comments || []; } finally { commentsLoading.value = false; }
}
async function submitComment(post) {
  const content = commentDrafts[post.id]?.trim();
  if (!content) return;
  const result = await store.createPostComment(post.id, content);
  commentsByPost[post.id] = [...(commentsByPost[post.id] || []), result.comment];
  commentDrafts[post.id] = '';
  post.engagement = { ...(post.engagement || {}), comments: Number(post.engagement?.comments || 0) + 1 };
}
async function editPost(post) {
  const content = window.prompt('修改帖子内容，提交后将重新审核', post.content);
  if (content === null) return;
  let rating = post.rating;
  if (post.targetType === 'dish') {
    const ratingText = window.prompt('评分（1-5，留空取消评分）', post.rating == null ? '' : String(post.rating));
    if (ratingText === null) return;
    rating = ratingText.trim() ? Number(ratingText) : null;
  }
  try { await store.updateCommunityContent('post', post.id, { content, rating }); }
  catch (editError) { window.alert(editError.message || '帖子修改失败'); }
}
async function deletePost(post) { if (window.confirm('删除后无法恢复，确认删除这条帖子？')) await store.deleteCommunityContent('post', post.id); }
onMounted(loadPosts);
onBeforeUnmount(clearImage);
</script>

<style scoped>
.community-heading { display: flex; justify-content: space-between; gap: 20px; align-items: flex-end; }
.post-composer { display: grid; gap: 18px; margin-bottom: 24px; animation: composer-in .24s ease both; }
.segmented { display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr; width: fit-content; padding: 4px; border: 1px solid rgba(31, 122, 77, .16); border-radius: 8px; background: #eef5eb; }
.segmented button { border: 0; background: transparent; color: var(--muted); }.segmented button.active { background: #fff; color: var(--primary-dark); box-shadow: 0 3px 10px rgba(21, 95, 59, .1); }
.target-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }.target-grid label, .content-field { display: grid; gap: 6px; }.content-field textarea { min-height: 120px; resize: vertical; }.content-field small { text-align: right; color: var(--muted); }
.rating-picker { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }.star-button { width: 36px; height: 36px; padding: 0; border: 0; background: transparent; color: #c9cec7; font-size: 24px; transition: color .18s ease, transform .18s ease; }.star-button.active { color: #e0a11a; transform: scale(1.08); }.star-button:active { transform: scale(.9); }
.image-upload { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }.upload-button input { display: none; }.image-upload img { width: 120px; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 6px; }
.composer-actions { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }.feed-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 14px; margin-bottom: 16px; }
.post-feed { columns: 2; column-gap: 16px; }.post-item { break-inside: avoid; display: grid; gap: 14px; margin-bottom: 16px; padding: 18px; border: 1px solid rgba(31, 122, 77, .14); border-radius: 8px; background: #fff; animation: post-enter .34s ease both; transition: transform .22s ease, box-shadow .22s ease; }.post-item:hover { transform: translateY(-3px); box-shadow: 0 14px 28px rgba(21, 95, 59, .09); }.post-item:active { transform: scale(.99); }
.post-item header { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: 10px; }.post-item header > div:nth-child(2) { display: grid; gap: 2px; }.avatar { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 50%; background: var(--primary); color: #fff; font-weight: 800; }.status-badge { padding: 4px 8px; border-radius: 10px; font-size: 11px; background: #eef2ed; }.status-badge.pending { color: #956400; background: #fff5d9; }.status-badge.approved { color: var(--primary-dark); background: #e8f4e5; }.status-badge.rejected { color: #a33737; background: #fdeaea; }
.post-content { margin: 0; line-height: 1.75; white-space: pre-wrap; }.post-image { width: 100%; max-height: 440px; object-fit: cover; border-radius: 6px; }.post-item footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid rgba(31, 122, 77, .1); padding-top: 12px; }.post-target { display: grid; grid-template-columns: 30px minmax(0, 1fr); color: inherit; text-decoration: none; min-width: 0; }.post-target > span { grid-row: 1 / 3; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%; background: #edf6e9; color: var(--primary-dark); font-size: 11px; }.post-target small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.post-rating { white-space: nowrap; color: #c9cec7; }.post-rating .active { color: #e0a11a; }
.post-actions { display:flex; gap:6px; flex-wrap:wrap; }.post-actions button { min-height:32px; padding:0 9px; border:1px solid #dce5da; border-radius:5px; color:var(--muted); background:#fff; }.post-actions button.active { color:var(--primary-dark); border-color:#a9c9a4; background:#eef6eb; }.post-actions .danger-text { color:#a33737; }
.comment-panel { display:grid; gap:8px; padding:12px; border-top:1px solid rgba(31,122,77,.1); background:#f8faf7; }.comment-row { display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:8px; align-items:start; font-size:13px; }.comment-row time { color:var(--muted); font-size:11px; }.comment-form { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; }.comment-form input { min-height:38px; }
@keyframes composer-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes post-enter { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: translateY(0); } }
@media (max-width: 760px) { .community-heading { align-items: stretch; flex-direction: column; }.community-heading button { width: 100%; }.target-grid { grid-template-columns: 1fr; }.post-feed { columns: 1; } }
@media (max-width: 480px) { .feed-toolbar { align-items: stretch; flex-direction: column; }.feed-toolbar .segmented, .feed-toolbar > button { width: 100%; }.post-item footer { align-items: flex-start; flex-direction: column; } }
@media (prefers-reduced-motion: reduce) { .post-composer, .post-item { animation: none; }.post-item, .star-button { transition: none; } }
</style>
