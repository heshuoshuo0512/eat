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
      <label><span>食堂</span><select v-model="selectedCanteenId" required @change="onCanteenChange"><option value="">请选择食堂</option><option v-for="canteen in store.canteens" :key="canteen.id" :value="canteen.id">{{ canteen.name }}</option></select></label>
      <label v-if="form.targetType === 'dish'"><span>档口</span><select v-model="selectedStallId" required @change="form.targetId = ''"><option value="">请选择档口</option><option v-for="stall in availableStalls" :key="stall.id" :value="stall.id">{{ stall.name }}</option></select></label>
      <label v-if="form.targetType === 'dish'"><span>菜品</span><select v-model="form.targetId" required><option value="">请选择菜品</option><option v-for="dish in availableDishes" :key="dish.id" :value="dish.id">{{ dish.name }}</option></select></label>
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

  <section class="feed-toolbar"><div class="segmented"><button type="button" :class="{ active: feedType === '' }" @click="changeFeed('')">全部</button><button type="button" :class="{ active: feedType === 'dish' }" @click="changeFeed('dish')">菜品</button><button type="button" :class="{ active: feedType === 'canteen' }" @click="changeFeed('canteen')">食堂</button></div><button class="ghost" type="button" :disabled="loading" @click="loadPosts">刷新</button></section>

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
    </article>
  </section>
  <section v-else class="card empty-state"><h2>还没有帖子</h2><p>发布第一条校园用餐分享。</p></section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
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
const imageFile = ref(null);
const imagePreview = ref('');
const form = reactive({ targetType: 'dish', targetId: '', content: '', rating: 0 });
const availableStalls = computed(() => store.stalls.filter((stall) => stall.canteenId === selectedCanteenId.value));
const availableDishes = computed(() => store.dishes.filter((dish) => dish.stallId === selectedStallId.value));

function setTargetType(type) { form.targetType = type; form.targetId = type === 'canteen' ? selectedCanteenId.value : ''; form.rating = 0; selectedStallId.value = ''; }
function onCanteenChange() { selectedStallId.value = ''; form.targetId = form.targetType === 'canteen' ? selectedCanteenId.value : ''; }
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
      imageUrl = upload.url;
    }
    await store.createCommunityPost({ targetType: form.targetType, targetId, content: form.content, imageUrl, rating: form.targetType === 'dish' && form.rating ? form.rating : null });
    composerMessage.value = '帖子已提交审核，你可以在动态中查看审核状态。';
    form.content = ''; form.rating = 0; form.targetId = ''; selectedCanteenId.value = ''; selectedStallId.value = ''; clearImage();
    await loadPosts();
  } catch (error) { composerError.value = true; composerMessage.value = error.message || '帖子发布失败'; }
  finally { submitting.value = false; }
}

async function loadPosts() { loading.value = true; loadError.value = ''; try { await store.loadCommunityPosts({ targetType: feedType.value, limit: 100 }); } catch (error) { loadError.value = error.message || '帖子加载失败'; } finally { loading.value = false; } }
function targetLink(post) { return post.dish ? { path: '/dishes', query: { dish: post.dish.id } } : '/canteens'; }
function formatDate(value) { return String(value || '').replace('T', ' ').slice(0, 16); }
function statusLabel(status) { return { pending: '审核中', approved: '已公开', rejected: '未通过' }[status] || status; }
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
@keyframes composer-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes post-enter { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: translateY(0); } }
@media (max-width: 760px) { .community-heading { align-items: stretch; flex-direction: column; }.community-heading button { width: 100%; }.target-grid { grid-template-columns: 1fr; }.post-feed { columns: 1; } }
@media (max-width: 480px) { .feed-toolbar { align-items: stretch; flex-direction: column; }.feed-toolbar .segmented, .feed-toolbar > button { width: 100%; }.post-item footer { align-items: flex-start; flex-direction: column; } }
@media (prefers-reduced-motion: reduce) { .post-composer, .post-item { animation: none; }.post-item, .star-button { transition: none; } }
</style>
