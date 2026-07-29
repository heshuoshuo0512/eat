<template>
  <section
    class="feature-orbit"
    aria-roledescription="carousel"
    aria-label="学生功能转盘"
    tabindex="0"
    @mouseenter="paused = true"
    @mouseleave="paused = false"
    @focusin="paused = true"
    @focusout="paused = false"
    @keydown.left.prevent="previous"
    @keydown.right.prevent="next"
  >
    <div class="orbit-heading">
      <div><p class="eyebrow">功能转盘</p><h2>从现在最需要的事情开始</h2></div>
      <div class="orbit-controls">
        <button class="ghost orbit-arrow" type="button" aria-label="上一个功能" @click="previous">←</button>
        <span>{{ activeIndex + 1 }} / {{ items.length }}</span>
        <button class="ghost orbit-arrow" type="button" aria-label="下一个功能" @click="next">→</button>
      </div>
    </div>

    <div class="orbit-stage" :class="{ dragging }" aria-live="polite" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="cancelDrag" @wheel="onWheel">
      <button class="orbit-side-arrow orbit-side-previous" type="button" aria-label="上一个功能" @pointerdown.stop @click.stop="previous">‹</button>
      <RouterLink
        v-for="(item, index) in items"
        :key="item.id"
        :to="item.to"
        :class="['orbit-card', `feature-${item.id}`, `offset-${Math.abs(offsetFor(index))}`, { active: index === activeIndex, hidden: Math.abs(offsetFor(index)) > 2, 'has-image': item.imageUrl }]"
        :style="cardStyle(index)"
        :aria-hidden="Math.abs(offsetFor(index)) > 2"
        :tabindex="index === activeIndex ? 0 : -1"
        @click="onCardClick($event, index)"
      >
        <img v-if="item.imageUrl" :src="item.imageUrl" alt="" />
        <span v-else class="orbit-fallback" aria-hidden="true"><component :is="iconFor(item.icon)" :size="64" :stroke-width="1.7" /></span>
        <span v-if="item.imageUrl" class="orbit-scrim"></span>
        <span class="orbit-copy">
          <small>{{ item.eyebrow }}</small>
          <strong>{{ item.label }}</strong>
          <span>{{ item.description }}</span>
          <b v-if="item.badge">{{ item.badge }}</b>
        </span>
      </RouterLink>
      <button class="orbit-side-arrow orbit-side-next" type="button" aria-label="下一个功能" @pointerdown.stop @click.stop="next">›</button>
    </div>

    <div class="orbit-mobile" ref="mobileTrack" @scroll.passive="syncMobileIndex">
      <RouterLink v-for="item in items" :key="`mobile-${item.id}`" :to="item.to" :class="['orbit-mobile-card', `feature-${item.id}`, { 'has-image': item.imageUrl }]">
        <img v-if="item.imageUrl" :src="item.imageUrl" alt="" />
        <span v-else class="orbit-fallback" aria-hidden="true"><component :is="iconFor(item.icon)" :size="38" :stroke-width="1.8" /></span>
        <span><small>{{ item.eyebrow }}</small><strong>{{ item.label }}</strong><span>{{ item.description }}</span><b v-if="item.badge">{{ item.badge }}</b></span>
      </RouterLink>
    </div>

    <div class="orbit-dots" aria-label="选择功能">
      <button v-for="(item, index) in items" :key="`dot-${item.id}`" type="button" :class="{ active: index === activeIndex }" :aria-label="`查看${item.label}`" @click="goTo(index)"></button>
    </div>
  </section>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { CalendarCheck, Heart, Map, MapPinned, MessageSquareText, MessagesSquare, Search, Sparkles, Trophy } from '@lucide/vue';

const props = defineProps({ items: { type: Array, default: () => [] } });
const iconComponents = { CalendarCheck, Heart, Map, MapPinned, MessageSquareText, MessagesSquare, Search, Sparkles, Trophy };
function iconFor(name) { return iconComponents[name] || Search; }
const activeIndex = ref(0);
const paused = ref(false);
const mobileTrack = ref(null);
const dragging = ref(false);
let timer = null;
let reducedMotion = false;
let dragStartX = 0;
let dragDistance = 0;
let suppressClick = false;
let wheelLocked = false;

function offsetFor(index) {
  const length = props.items.length || 1;
  let offset = index - activeIndex.value;
  if (offset > length / 2) offset -= length;
  if (offset < -length / 2) offset += length;
  return offset;
}

function cardStyle(index) {
  const offset = offsetFor(index);
  const abs = Math.abs(offset);
  return {
    '--orbit-x': `${offset * 58}%`,
    '--orbit-y': `${abs * 24}px`,
    '--orbit-scale': String(1 - abs * .16),
    '--orbit-rotate': `${offset * -8}deg`,
    '--orbit-z': String(10 - abs)
  };
}

function next() { if (props.items.length) goTo((activeIndex.value + 1) % props.items.length); }
function previous() { if (props.items.length) goTo((activeIndex.value - 1 + props.items.length) % props.items.length); }
function goTo(index) {
  activeIndex.value = index;
  const card = mobileTrack.value?.children?.[index];
  card?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
}

function syncMobileIndex() {
  const track = mobileTrack.value;
  if (!track?.children?.length) return;
  const center = track.scrollLeft + track.clientWidth / 2;
  let closest = 0;
  let distance = Infinity;
  [...track.children].forEach((card, index) => {
    const cardCenter = card.offsetLeft + card.clientWidth / 2;
    const nextDistance = Math.abs(cardCenter - center);
    if (nextDistance < distance) { distance = nextDistance; closest = index; }
  });
  activeIndex.value = closest;
}

function startDrag(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  dragging.value = true;
  paused.value = true;
  dragStartX = event.clientX;
  dragDistance = 0;
  event.currentTarget.setPointerCapture?.(event.pointerId);
}
function moveDrag(event) {
  if (!dragging.value) return;
  dragDistance = event.clientX - dragStartX;
  if (Math.abs(dragDistance) > 8) event.preventDefault();
}
function endDrag() {
  if (!dragging.value) return;
  if (Math.abs(dragDistance) >= 45) {
    dragDistance < 0 ? next() : previous();
    suppressClick = true;
    window.setTimeout(() => { suppressClick = false; }, 80);
  }
  dragging.value = false;
  paused.value = false;
}
function cancelDrag() { dragging.value = false; paused.value = false; dragDistance = 0; }
function onCardClick(event, index) {
  if (suppressClick) { event.preventDefault(); return; }
  activeIndex.value = index;
}
function onWheel(event) {
  if (wheelLocked || Math.abs(event.deltaX) + Math.abs(event.deltaY) < 24) return;
  event.preventDefault();
  wheelLocked = true;
  (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) > 0 ? next() : previous();
  window.setTimeout(() => { wheelLocked = false; }, 320);
}

onMounted(() => {
  reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
  if (!reducedMotion) timer = window.setInterval(() => { if (!paused.value) next(); }, 5000);
});

onBeforeUnmount(() => { if (timer) window.clearInterval(timer); });
</script>

<style scoped>
.feature-orbit { min-width: 0; max-width: 100%; display: grid; gap: 16px; margin-top: 34px; outline: none; }
.orbit-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; }
.orbit-heading h2 { margin: 0; font-size: 22px; }
.orbit-controls { display: flex; align-items: center; gap: 9px; color: var(--muted); font-size: 12px; }
.orbit-arrow { width: 40px; height: 40px; padding: 0; display: grid; place-items: center; font-size: 18px; }
.orbit-stage { position: relative; min-height: 330px; overflow: hidden; perspective: 1200px; cursor:grab; touch-action:pan-y; user-select:none; }
.orbit-stage.dragging { cursor:grabbing; }
.orbit-side-arrow { position:absolute; z-index:30; top:50%; width:56px; height:72px; padding:0; transform:translateY(-50%); border:1px solid rgba(31,122,77,.2); border-radius:6px; color:var(--primary-dark); background:rgba(255,255,255,.94); box-shadow:0 10px 24px rgba(20,53,36,.14); font-size:44px; line-height:1; }
.orbit-side-arrow:hover { background:#fff; transform:translateY(-50%) scale(1.04); }
.orbit-side-previous { left:12px; }.orbit-side-next { right:12px; }
.orbit-card { position: absolute; left: 50%; top: 8px; width: min(360px, 34vw); height: 286px; overflow: hidden; border: 1px solid rgba(31,122,77,.16); border-radius: 8px; background: #eef6eb; color: #173a26; text-decoration: none; box-shadow: 0 14px 36px rgba(20, 53, 36, .13); transform: translateX(calc(-50% + var(--orbit-x))) translateY(var(--orbit-y)) scale(var(--orbit-scale)) rotateZ(var(--orbit-rotate)); z-index: var(--orbit-z); opacity: .72; transition: transform .55s cubic-bezier(.22,.8,.24,1), opacity .35s ease, box-shadow .35s ease; }
.orbit-card.has-image { color:#fff; border-color:rgba(255,255,255,.72); }
.orbit-card.active { opacity: 1; box-shadow: 0 24px 54px rgba(20, 53, 36, .2); }
.orbit-card.hidden { opacity: 0; pointer-events: none; }
.orbit-card img, .orbit-fallback { width: 100%; height: 100%; object-fit: cover; display: grid; place-items: center; background: #dcebd6; color: var(--primary-dark); transition: transform .55s ease; }
.orbit-card:not(.has-image) .orbit-fallback { place-items:start center; padding-top:45px; box-sizing:border-box; }
.feature-recommend .orbit-fallback,.feature-orders .orbit-fallback { background:#fff0c8; color:#77530d; }
.feature-canteens .orbit-fallback,.feature-regions .orbit-fallback { background:#dceef4; color:#205b6d; }
.feature-reviews .orbit-fallback,.feature-community .orbit-fallback { background:#f7e3df; color:#8a4034; }
.feature-rankings .orbit-fallback,.feature-saved .orbit-fallback { background:#eee7f6; color:#614681; }
.orbit-card.active:hover img { transform: scale(1.035); }
.orbit-scrim { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(12,30,20,.03) 28%, rgba(12,30,20,.88) 100%); }
.orbit-copy { position: absolute; inset: auto 0 0; display: grid; gap: 5px; padding: 22px; }
.orbit-copy small { font-size: 11px; font-weight: 800; text-transform: uppercase; opacity: .76; }
.orbit-copy strong { font-size: 24px; }
.orbit-copy > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .86; }
.orbit-card:not(.has-image) .orbit-copy small { color:var(--primary-dark); }
.orbit-copy b, .orbit-mobile-card b { width: max-content; margin-top: 5px; padding: 4px 8px; border-radius: 999px; background: #fff2bf; color: #6d4a00; font-size: 11px; }
.orbit-dots { display: flex; justify-content: center; gap: 7px; }
.orbit-dots button { width: 8px; height: 8px; min-height: 0; padding: 0; border: 0; border-radius: 50%; background: rgba(31,122,77,.2); transition: width .2s ease, background .2s ease; }
.orbit-dots button.active { width: 24px; border-radius: 999px; background: var(--primary); }
.orbit-mobile { display: none; }
@media (max-width: 760px) {
  .feature-orbit { margin-top: 26px; }
  .orbit-heading { align-items: stretch; flex-direction: column; }
  .orbit-controls { justify-content: space-between; }
  .orbit-stage { display: none; }
  .orbit-mobile { min-width: 0; max-width: 100%; display: flex; gap: 12px; overflow-x: auto; margin-inline: -4px; padding: 4px 4px 12px; scroll-snap-type: x mandatory; scrollbar-width: none; }
  .orbit-mobile::-webkit-scrollbar { display: none; }
  .orbit-mobile-card { flex: 0 0 min(82vw, 330px); min-height: 158px; display: grid; grid-template-columns: 118px minmax(0, 1fr); overflow: hidden; border: 1px solid rgba(31,122,77,.14); border-radius: 8px; background: #fff; color: inherit; text-decoration: none; scroll-snap-align: center; box-shadow: 0 10px 24px rgba(20,53,36,.08); }
  .orbit-mobile-card > img, .orbit-mobile-card > .orbit-fallback { width: 118px; height: 100%; min-height: 158px; object-fit: cover; }
  .orbit-mobile-card > span:last-child { display: grid; align-content: center; gap: 6px; min-width: 0; padding: 16px; }
  .orbit-mobile-card small { color: var(--primary-dark); font-weight: 800; }
  .orbit-mobile-card strong { font-size: 19px; }
  .orbit-mobile-card span span { color: var(--muted); line-height: 1.45; }
}
@media (prefers-reduced-motion: reduce) {
  .orbit-card, .orbit-card img, .orbit-dots button { transition: none; }
}
</style>
