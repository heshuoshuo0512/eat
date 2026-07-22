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
import {
  REGION_DEFINITIONS,
  getDishRegionIds,
  getRegionDishes,
  rankRegionDishes,
  summarizeRegions
} from '../miniapp/src/domain/regionRecommendation.js';
import { DEFAULT_DATA_MAX_AGE_MS, isDataCacheStale } from '../miniapp/src/domain/cachePolicy.js';

const dishes = [
  { id:'c', name:'清蒸鱼鲜', regionalTaste:'粤菜清鲜', price:20, rating:4.7, reviewCount:10, sales:50, status:'active', ingredients:['鱼'], tags:['清淡'] },
  { id:'s', name:'湘味小炒', cuisine:'川湘', taste:'麻辣', price:16, rating:4.8, reviewCount:20, sales:120, status:'active', ingredients:['辣椒'], tags:['下饭'] },
  { id:'n', name:'牛肉拉面', cuisine:'西北', taste:'咸鲜', price:14, rating:4.6, reviewCount:30, sales:180, status:'active', ingredients:['面'], tags:['清真'] },
  { id:'e', name:'日式饭团', cuisine:'日式', taste:'清爽', price:10, rating:4.3, reviewCount:8, sales:40, status:'active', ingredients:['米饭'], tags:['早餐'] },
  { id:'l', name:'高纤沙拉', cuisine:'轻食', taste:'清爽', price:18, rating:4.5, reviewCount:12, sales:60, status:'active', ingredients:['生菜'], tags:['高纤维'] },
  { id:'x', name:'一号套餐', cuisine:'未知', taste:'普通', price:9, rating:4.0, reviewCount:3, sales:300, status:'active', ingredients:[], tags:[] }
];

describe('miniapp student discovery domain', () => {
  it('builds profile-aware quick prompts', () => {
    const prompts = buildProfilePrompts({ goal:'fatLoss', mealType:'lunch', budgetMax:35, taste:'麻辣', avoid:['花生'], preferLowCrowd:true }, 'search');
    assert.equal(prompts.length, 4);
    assert.ok(prompts.some((item) => item.query.includes('35')));
    assert.ok(prompts.some((item) => item.query.includes('花生')));
    assert.ok(prompts.some((item) => item.query.includes('低人流')));
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

describe('miniapp regional recommendation domain', () => {
  it('defines six regions and can populate all six with real fixtures', () => {
    assert.equal(REGION_DEFINITIONS.length,6);
    const summaries = summarizeRegions(dishes);
    assert.ok(summaries.every((item)=>item.count>0));
  });

  it('prioritizes regionalTaste and falls unknown dishes back to campus food', () => {
    assert.deepEqual(getDishRegionIds(dishes[0]),['cantonese']);
    assert.deepEqual(getDishRegionIds(dishes[5]),['campus']);
    assert.equal(getRegionDishes('campus',dishes)[0].id,'x');
  });

  it('supports price, rating, heat, and personalized ordering', () => {
    const candidates = [
      {id:'a',name:'A',price:18,rating:4.9,reviewCount:20,sales:20,status:'active'},
      {id:'b',name:'B',price:9,rating:4.2,reviewCount:5,sales:500,status:'active'}
    ];
    assert.equal(rankRegionDishes(candidates,{sortBy:'price'})[0].id,'b');
    assert.equal(rankRegionDishes(candidates,{sortBy:'rating'})[0].id,'a');
    assert.equal(rankRegionDishes(candidates,{sortBy:'hot'})[0].id,'b');
    assert.equal(rankRegionDishes(candidates,{sortBy:'forYou',preferences:[{dishId:'b',favorite:true,eatenCount:4}]})[0].id,'b');
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
