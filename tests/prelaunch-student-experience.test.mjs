import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(path), 'utf8');
const router = read('src/router/index.js');
const reviews = read('src/views/ReviewsView.vue');
const community = read('src/views/CommunityView.vue');
const canteens = read('src/views/CanteensView.vue');
const rankings = read('src/views/RankingsView.vue');
const saved = read('src/views/SavedView.vue');
const miniCommunity = read('miniapp/src/pages/community/community.vue');
const miniPublish = read('miniapp/src/pages/community-publish/community-publish.vue');

describe('prelaunch student experience', () => {
  it('provides a web personal center and searchable community selectors', () => {
    assert.match(router, /path:\s*'\/profile'/);
    assert.match(reviews, /SearchSelect/);
    assert.match(community, /SearchSelect/);
    assert.match(miniCommunity, /canteenFilterQuery/);
    assert.match(miniPublish, /dishQuery/);
  });

  it('opens exact canteen, stall and dish destinations', () => {
    assert.match(reviews, /query:\s*\{\s*canteen:/);
    assert.match(canteens, /route\.query\.canteen/);
    assert.match(canteens, /route\.query\.stall/);
    assert.match(rankings, /rankingLink\('dishes'/);
    assert.match(rankings, /rankingLink\('stalls'/);
    assert.match(rankings, /rankingLink\('canteens'/);
  });

  it('does not show a false favorites empty state and exposes community management', () => {
    assert.match(saved, /v-if="!favoriteEntries\.length" class="card empty-state"/);
    assert.match(community, /reactToCommunityContent/);
    assert.match(community, /createPostComment/);
    assert.match(community, /deleteCommunityContent/);
    assert.match(miniCommunity, /reactToContent/);
    assert.match(miniCommunity, /deleteCommunityContent/);
  });
});
