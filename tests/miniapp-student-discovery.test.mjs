import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProfilePrompts,
  nextRevealState,
  resetRevealState,
  savedDishEntries,
  sortDishesByRating,
  visibleCitations
} from '../miniapp/src/domain/studentDiscovery.js';
import { DEFAULT_DATA_MAX_AGE_MS, isDataCacheStale } from '../miniapp/src/domain/cachePolicy.js';

describe('miniapp student discovery domain', () => {
  it('builds profile-aware quick prompts', () => {
    const prompts = buildProfilePrompts({ goal:'fatLoss', mealType:'lunch', budgetMax:35, taste:'麻辣', avoid:['花生'], preferLowCrowd:true }, 'search');
    assert.equal(prompts.length, 5);
    assert.ok(prompts.some((item) => item.query.includes('35')));
    assert.ok(prompts.some((item) => item.query.includes('花生')));
    assert.ok(prompts.some((item) => item.label === '轻松少排队'));
  });

  it('sorts by computed rating in both directions', () => {
    const ratingMap = new Map([['a',{computedRating:4.9}],['b',{computedRating:3.8}]]);
    const source = [{id:'a',name:'A'},{id:'b',name:'B'}];
    assert.deepEqual(sortDishesByRating(source,ratingMap,'desc').map((item)=>item.id),['a','b']);
    assert.deepEqual(sortDishesByRating(source,ratingMap,'asc').map((item)=>item.id),['b','a']);
  });

  it('implements the two-step reveal state machine', () => {
    const initial = resetRevealState();
    assert.deepEqual(nextRevealState(initial, 3), { index:0, phase:'revealed' });
    assert.deepEqual(nextRevealState({index:0,phase:'revealed'},3), { index:1, phase:'covered' });
    assert.deepEqual(nextRevealState({index:2,phase:'revealed'},3), { index:0, phase:'covered' });
  });

  it('preserves dish ids while joining favorite and eaten statistics', () => {
    const result = savedDishEntries([{id:'dish-1',name:'菜品'}],[{id:'pref-1',dishId:'dish-1',favorite:true,eatenCount:2}]);
    assert.equal(result.favorites[0].id,'dish-1');
    assert.equal(result.favorites[0].preferenceId,'pref-1');
    assert.equal(result.totalEaten,2);
  });

  it('collapses citations to three until expanded', () => {
    const citations = [1,2,3,4,5];
    assert.deepEqual(visibleCitations(citations,false),[1,2,3]);
    assert.deepEqual(visibleCitations(citations,true),citations);
  });
});

describe('miniapp shared data cache policy', () => {
  it('refreshes at the 15 second boundary and treats missing timestamps as stale', () => {
    assert.equal(DEFAULT_DATA_MAX_AGE_MS, 15_000);
    assert.equal(isDataCacheStale(1_000, 15_999), false);
    assert.equal(isDataCacheStale(1_000, 16_000), true);
    assert.equal(isDataCacheStale(0, 16_000), true);
  });
});
