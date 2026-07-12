import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';


/* ------------------------------------------------------------------ */
/*  Helpers (same pattern as api.test.mjs / enterprise-api.test.mjs)  */
/* ------------------------------------------------------------------ */

/** Spin up a real HTTP server backed by an in-memory DB. */
function setup() {
  let _db;
  before(() => {
    _db = openDatabase(':memory:');
    const app = createApp({ db: _db });
    globalThis.__productOverhaulDb = _db;
    globalThis.__productOverhaulServer = createServer(app.handler);
    globalThis.__productOverhaulServer.listen(0);
    globalThis.__productOverhaulBaseUrl = `http://127.0.0.1:${globalThis.__productOverhaulServer.address().port}`;
  });
  after(() => globalThis.__productOverhaulServer.close());
}

/** Convenience fetch wrapper: returns { status, data } parsed JSON. */
async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${globalThis.__productOverhaulBaseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

/** Login as admin and return token. */
async function adminToken() {
  const { data } = await req('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' },
  });
  return data.token;
}

/** Login as student and return token. */
async function studentToken() {
  const { data } = await req('/api/auth/login', {
    method: 'POST',
    body: { username: '演示学生', password: 'student123' },
  });
  return data.token;
}

/* ================================================================== */
/*  1. Contextual recommendation: environment → reason/ranking        */
/* ================================================================== */
describe('Contextual recommendation — environment drives ranking', () => {
  setup();

  it('default hot environment favors cool-tagged dishes (消暑/冷食)', async () => {
    // Seed sets temperature=34, weatherLabel='晴热' — hot weather
    const { status, data } = await req('/api/recommend');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.ranked), 'ranked is array');
    assert.ok(data.ranked.length > 0, 'has ranked dishes');

    // At least one top-5 dish should have a positive weather score
    // because hot weather boosts 消暑/清爽/冷食/凉 tags
    const top5 = data.ranked.slice(0, 5);
    const hasWeatherBoost = top5.some((d) => d.scoreBreakdown?.weather > 0);
    assert.ok(hasWeatherBoost, 'hot weather should boost cool-tagged dishes in top 5');

    // The context should reflect the seeded environment
    assert.ok(data.context.environment.temperature >= 30, 'environment temperature is hot');
  });

  it('switching to cold environment boosts warm-tagged dishes instead', async () => {
    const token = await adminToken();

    // Set cold environment
    const putRes = await req('/api/admin/environment', {
      method: 'PUT',
      token,
      body: { temperature: 5, weatherLabel: '寒冷' },
    });
    assert.equal(putRes.status, 200);

    // Now recommend — cold weather should produce negative weather scores for cool dishes
    const { status, data } = await req('/api/recommend');
    assert.equal(status, 200);
    assert.equal(data.context.environment.temperature, 5);

    // With temp=5 (isCold=true), cool tags (冷食/消暑) get -4 penalty
    // and warm tags (热汤/暖胃/高碳水) get +6 boost
    // d-beef-noodle has tags ['清真','热汤','高碳水'] → should get weather boost
    const beefNoodle = data.ranked.find((d) => d.id === 'd-beef-noodle');
    assert.ok(beefNoodle, 'd-beef-noodle should be in ranked results');
    assert.ok(
      beefNoodle.scoreBreakdown.weather > 0,
      `beef noodle should get positive weather score in cold, got ${beefNoodle.scoreBreakdown.weather}`
    );
  });

  it('recommending after environment update returns updated context', async () => {
    const token = await adminToken();

    // Update environment
    await req('/api/admin/environment', {
      method: 'PUT',
      token,
      body: { temperature: 22, weatherLabel: '多云' },
    });

    const { data } = await req('/api/recommend');
    assert.equal(data.context.environment.temperature, 22);
    assert.equal(data.context.environment.weatherLabel, '多云');
    // At 22°C, neither isHot nor isCold → weather score should be 0 for all
    for (const dish of data.ranked) {
      assert.equal(dish.scoreBreakdown.weather, 0, `${dish.name} weather score should be 0 at 22°C`);
    }
  });
});

/* ================================================================== */
/*  2. Contextual recommendation: scoreBreakdown and why              */
/* ================================================================== */
describe('Contextual recommendation — score factors', () => {
  setup();

  it('every ranked dish has all scoreBreakdown keys and contextualScore', async () => {
    const { status, data } = await req('/api/recommend');
    assert.equal(status, 200);
    assert.ok(data.ranked.length > 0);

    const expectedKeys = [
      'goal', 'rating', 'budget', 'weather', 'crowd',
      'preference', 'nutritionFocus', 'spice', 'tags', 'timeBonus',
    ];

    for (const dish of data.ranked) {
      assert.ok(typeof dish.contextualScore === 'number', `${dish.name} has contextualScore`);
      assert.ok(dish.scoreBreakdown, `${dish.name} has scoreBreakdown`);
      for (const key of expectedKeys) {
        assert.ok(
          key in dish.scoreBreakdown,
          `${dish.name} missing scoreBreakdown.${key}`
        );
        assert.equal(typeof dish.scoreBreakdown[key], 'number', `${dish.name}.${key} is number`);
      }
      assert.ok(Array.isArray(dish.why), `${dish.name} has why array`);
    }
  });

  it('contextualScore equals sum of all breakdown factors', async () => {
    const { data } = await req('/api/recommend');
    for (const dish of data.ranked) {
      const sum = Object.values(dish.scoreBreakdown).reduce((a, b) => a + b, 0);
      assert.ok(
        Math.abs(dish.contextualScore - sum) < 0.2,
        `${dish.name}: contextualScore ${dish.contextualScore} ≈ sum ${sum.toFixed(1)}`
      );
    }
  });

  it('ranked dishes include canteen/stall location metadata', async () => {
    const { data } = await req('/api/recommend');
    for (const dish of data.ranked) {
      // contextualRankDishes enriches with canteenId, canteenName, stallName
      if (dish.stallId) {
        assert.ok(dish.canteenId !== undefined, `${dish.name} has canteenId`);
        assert.ok(dish.stallName !== undefined || dish.stallName === null, `${dish.name} has stallName`);
      }
    }
  });

  it('response includes plan, context, source, and menu', async () => {
    const { status, data } = await req('/api/recommend');
    assert.equal(status, 200);
    assert.ok(data.plan, 'has plan');
    assert.ok(data.plan.dishes, 'plan has dishes');
    assert.ok(data.plan.totals, 'plan has totals');
    assert.ok(data.context, 'has context');
    assert.ok(data.context.timeOfDay, 'context has timeOfDay');
    assert.ok(data.menu, 'has menu');
  });
});

/* ================================================================== */
/*  3. Contextual recommendation: user preferences boost              */
/* ================================================================== */
describe('Contextual recommendation — user preferences', () => {
  setup();

  it('logged-in user with favorite dish sees preference score boost', async () => {
    // Student has seeded favorites: d-chicken-bowl (favorite=1, eatenCount=8)
    const token = await studentToken();
    const { status, data } = await req('/api/recommend', { token });
    assert.equal(status, 200);

    const chickenBowl = data.ranked.find((d) => d.id === 'd-chicken-bowl');
    assert.ok(chickenBowl, 'd-chicken-bowl is in ranked results');
    // Favorite (+12) + eaten*0.5 (min(8,10)*0.5=4) = 16 pref score (minus fatigue if any)
    assert.ok(
      chickenBowl.scoreBreakdown.preference > 0,
      `favorite dish should have positive preference score, got ${chickenBowl.scoreBreakdown.preference}`
    );
    assert.ok(
      chickenBowl.why.includes('已收藏'),
      'why should mention 已收藏 for favorite dish'
    );
  });

  it('anonymous user gets no preference boost', async () => {
    const { data: withUser } = await req('/api/recommend', { token: await studentToken() });
    const { data: anon } = await req('/api/recommend');

    const withUserChicken = withUser.ranked.find((d) => d.id === 'd-chicken-bowl');
    const anonChicken = anon.ranked.find((d) => d.id === 'd-chicken-bowl');

    assert.ok(withUserChicken && anonChicken);
    assert.ok(
      withUserChicken.scoreBreakdown.preference > anonChicken.scoreBreakdown.preference,
      'authenticated user should have higher preference score than anonymous'
    );
  });
});

/* ================================================================== */
/*  4. Canteen hierarchy: primary/sub with parent_id                  */
/* ================================================================== */
describe('Canteen hierarchy — primary and sub types', () => {
  setup();

  it('seeded canteens have correct hierarchy (campus-main → north/central/south)', async () => {
    const { status, data } = await req('/api/canteens');
    assert.equal(status, 200);

    const main = data.find((c) => c.id === 'campus-main');
    assert.ok(main, 'campus-main exists');
    assert.equal(main.canteenType, 'primary');
    assert.equal(main.parentId, null);

    const north = data.find((c) => c.id === 'north');
    assert.ok(north, 'north exists');
    assert.equal(north.canteenType, 'sub');
    assert.equal(north.parentId, 'north-zone');

    const central = data.find((c) => c.id === 'central');
    assert.ok(central, 'central exists');
    assert.equal(central.parentId, 'campus-main');

    const south = data.find((c) => c.id === 'south');
    assert.ok(south, 'south exists');
    assert.equal(south.parentId, 'south-zone');
  });

  it('admin can create a sub-canteen with valid parentId', async () => {
    const token = await adminToken();
    const { status, data } = await req('/api/admin/canteens', {
      method: 'POST',
      token,
      body: {
        id: 'test-sub-canteen',
        name: '测试子食堂',
        location: '测试区域',
        hours: '08:00-20:00',
        description: '测试用子食堂',
        parentId: 'campus-main',
        canteenType: 'sub',
      },
    });
    assert.equal(status, 201);
    const created = data.canteens.find((c) => c.id === 'test-sub-canteen');
    assert.ok(created, 'sub-canteen created');
    assert.equal(created.parentId, 'campus-main');
    assert.equal(created.canteenType, 'sub');
  });

  it('creating canteen with nonexistent parent is rejected', async () => {
    const token = await adminToken();
    const { status, data } = await req('/api/admin/canteens', {
      method: 'POST',
      token,
      body: {
        id: 'bad-parent-canteen',
        name: '孤儿食堂',
        location: '无处',
        hours: '00:00-24:00',
        description: '无父级',
        parentId: 'nonexistent-parent-id',
        canteenType: 'sub',
      },
    });
    assert.equal(status, 400);
    assert.match(data.error, /父级/);
  });

  it('creating canteen with self as parent is rejected', async () => {
    const token = await adminToken();
    const { status, data } = await req('/api/admin/canteens', {
      method: 'POST',
      token,
      body: {
        id: 'self-parent-canteen',
        name: '自引用食堂',
        location: '无处',
        hours: '00:00-24:00',
        description: '自己是自己的父级',
        parentId: 'self-parent-canteen',
        canteenType: 'sub',
      },
    });
    assert.equal(status, 400);
    assert.match(data.error, /自己的父级/);
  });

  it('missing required canteen fields returns 400', async () => {
    const token = await adminToken();
    const { status } = await req('/api/admin/canteens', {
      method: 'POST',
      token,
      body: { name: '只有名字' },
    });
    assert.equal(status, 400);
  });
});

/* ================================================================== */
/*  5. Stall CRUD: create, update, delete, persistence                */
/* ================================================================== */
describe('Stall CRUD — admin creates, updates, deletes stalls', () => {
  setup();

  it('admin can create a stall under an existing canteen', async () => {
    const token = await adminToken();
    const { status, data } = await req('/api/admin/stalls', {
      method: 'POST',
      token,
      body: {
        id: 'test-stall-crud',
        canteenId: 'north',
        floor: '1F',
        name: '测试档口',
        category: '测试',
        description: 'CRUD 测试用',
      },
    });
    assert.equal(status, 201);
    const stall = data.stalls.find((s) => s.id === 'test-stall-crud');
    assert.ok(stall, 'stall persists in snapshot');
    assert.equal(stall.name, '测试档口');
    assert.equal(stall.canteenId, 'north');
    assert.equal(stall.floor, '1F');
  });

  it('creating stall under nonexistent canteen is rejected', async () => {
    const token = await adminToken();
    const { status, data } = await req('/api/admin/stalls', {
      method: 'POST',
      token,
      body: {
        canteenId: 'ghost-canteen',
        floor: '1F',
        name: '幽灵档口',
        category: '幽灵',
      },
    });
    assert.equal(status, 400);
    assert.match(data.error, /食堂不存在/);
  });

  it('creating stall with missing fields returns 400', async () => {
    const token = await adminToken();
    const { status } = await req('/api/admin/stalls', {
      method: 'POST',
      token,
      body: { canteenId: 'north', name: '不完整' },
    });
    assert.equal(status, 400);
  });

  it('admin can update stall fields', async () => {
    const token = await adminToken();
    const { status, data } = await req('/api/admin/stalls/test-stall-crud', {
      method: 'PUT',
      token,
      body: { name: '已修改档口', category: '修改后', floor: '2F' },
    });
    assert.equal(status, 200);
    const updated = data.stalls.find((s) => s.id === 'test-stall-crud');
    assert.equal(updated.name, '已修改档口');
    assert.equal(updated.category, '修改后');
    assert.equal(updated.floor, '2F');
  });

  it('admin can delete a stall', async () => {
    const token = await adminToken();
    const { status, data } = await req('/api/admin/stalls/test-stall-crud', {
      method: 'DELETE',
      token,
    });
    assert.equal(status, 200);
    const gone = data.stalls.find((s) => s.id === 'test-stall-crud');
    assert.equal(gone, undefined, 'deleted stall is gone');
  });

  it('updating nonexistent stall returns 404', async () => {
    const token = await adminToken();
    const { status } = await req('/api/admin/stalls/nonexistent-stall', {
      method: 'PUT',
      token,
      body: { name: '不存在' },
    });
    assert.equal(status, 404);
  });

  it('deleting nonexistent stall returns 404', async () => {
    const token = await adminToken();
    const { status } = await req('/api/admin/stalls/nonexistent-stall', {
      method: 'DELETE',
      token,
    });
    assert.equal(status, 404);
  });

  it('stall PUT rejects canteenId pointing to nonexistent canteen', async () => {
    const token = await adminToken();
    // Create a stall first
    await req('/api/admin/stalls', {
      method: 'POST',
      token,
      body: { id: 'stall-reparent-test', canteenId: 'north', floor: '1F', name: '移动测试', category: '测试' },
    });
    const { status, data } = await req('/api/admin/stalls/stall-reparent-test', {
      method: 'PUT',
      token,
      body: { canteenId: 'nonexistent-canteen' },
    });
    assert.equal(status, 400);
    assert.match(data.error, /食堂不存在/);
  });

  it('student cannot create or delete stalls', async () => {
    const token = await studentToken();
    const createRes = await req('/api/admin/stalls', {
      method: 'POST',
      token,
      body: { canteenId: 'north', floor: '1F', name: '学生档口', category: 'test' },
    });
    assert.equal(createRes.status, 403);

    const deleteRes = await req('/api/admin/stalls/n-protein', {
      method: 'DELETE',
      token,
    });
    assert.equal(deleteRes.status, 403);
  });
});

/* ================================================================== */
/*  6. User preferences: favorite toggle, eaten/drawn persist         */
/* ================================================================== */
describe('User dish preferences — favorite, eaten, drawn', () => {
  setup();

  it('GET /api/preferences/dishes returns seeded preferences', async () => {
    const token = await studentToken();
    const { status, data } = await req('/api/preferences/dishes', { token });
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.preferences));
    // Seeded: 5 preferences for u-demo-student
    assert.ok(data.preferences.length >= 5, 'has seeded preferences');

    const chicken = data.preferences.find((p) => p.dishId === 'd-chicken-bowl');
    assert.ok(chicken, 'd-chicken-bowl preference exists');
    assert.equal(chicken.favorite, true);
    assert.equal(chicken.eatenCount, 8);
    assert.equal(chicken.drawnCount, 12);
  });

  it('PUT /api/preferences/dishes toggles favorite', async () => {
    const token = await studentToken();

    // d-salad has favorite=0 in seed. Toggle to true.
    const { status, data } = await req('/api/preferences/dishes', {
      method: 'PUT',
      token,
      body: { dishId: 'd-salad', favorite: true },
    });
    assert.equal(status, 200);
    const salad = data.preferences.find((p) => p.dishId === 'd-salad');
    assert.equal(salad.favorite, true, 'favorite toggled to true');

    // Toggle back to false
    const { data: data2 } = await req('/api/preferences/dishes', {
      method: 'PUT',
      token,
      body: { dishId: 'd-salad', favorite: false },
    });
    const salad2 = data2.preferences.find((p) => p.dishId === 'd-salad');
    assert.equal(salad2.favorite, false, 'favorite toggled back to false');
  });

  it('POST /api/preferences/dishes/:id/eaten increments eaten_count', async () => {
    const token = await studentToken();

    // d-salad has eatenCount=2 in seed
    const { status, data } = await req('/api/preferences/dishes/d-salad/eaten', {
      method: 'POST',
      token,
    });
    assert.equal(status, 200);
    assert.equal(data.preference.eatenCount, 3, 'eatenCount incremented from 2 to 3');
    assert.ok(data.preference.lastEatenAt, 'lastEatenAt is set');
  });

  it('POST /api/preferences/dishes/:id/drawn increments drawn_count', async () => {
    const token = await studentToken();

    // d-salad has drawnCount=4 in seed
    const { status, data } = await req('/api/preferences/dishes/d-salad/drawn', {
      method: 'POST',
      token,
    });
    assert.equal(status, 200);
    assert.equal(data.preference.drawnCount, 5, 'drawnCount incremented from 4 to 5');
    assert.ok(data.preference.lastDrawnAt, 'lastDrawnAt is set');
  });

  it('preferences survive bootstrap snapshot', async () => {
    const token = await studentToken();

    // Modify a preference
    await req('/api/preferences/dishes', {
      method: 'PUT',
      token,
      body: { dishId: 'd-egg-tomato', favorite: true },
    });

    // Check bootstrap includes the preference
    const { data: bootstrap } = await req('/api/bootstrap', { token });
    const eggPref = bootstrap.dishPreferences.find((p) => p.dishId === 'd-egg-tomato');
    assert.ok(eggPref, 'preference appears in bootstrap');
    assert.equal(eggPref.favorite, true, 'favorite persisted in bootstrap');
  });

  it('eaten on a dish with no existing preference creates one', async () => {
    const token = await studentToken();

    // d-musubi has no seed preference for student
    const { status, data } = await req('/api/preferences/dishes/d-musubi/eaten', {
      method: 'POST',
      token,
    });
    assert.equal(status, 200);
    assert.equal(data.preference.eatenCount, 1, 'new preference starts at eatenCount=1');
    assert.equal(data.preference.dishId, 'd-musubi');
  });

  it('drawn on a dish with no existing preference creates one', async () => {
    const token = await studentToken();

    const { status, data } = await req('/api/preferences/dishes/d-bulk/drawn', {
      method: 'POST',
      token,
    });
    assert.equal(status, 200);
    assert.equal(data.preference.drawnCount, 1, 'new preference starts at drawnCount=1');
  });

  it('preference for nonexistent dish returns 404', async () => {
    const token = await studentToken();
    const { status } = await req('/api/preferences/dishes', {
      method: 'PUT',
      token,
      body: { dishId: 'nonexistent-dish', favorite: true },
    });
    assert.equal(status, 404);
  });

  it('preference write without auth returns 401', async () => {
    const { status } = await req('/api/preferences/dishes', {
      method: 'PUT',
      body: { dishId: 'd-salad', favorite: true },
    });
    assert.equal(status, 401);
  });
});

/* ================================================================== */
/*  7. Expanded profile/nutrition round-trip                           */
/* ================================================================== */
describe('Expanded health profile — round-trip all fields', () => {
  setup();

  it('POST /api/health/profile persists all expanded fields', async () => {
    const token = await studentToken();
    const profile = {
      goal: 'muscleGain',
      budgetMax: 25,
      mealType: 'dinner',
      taste: '辣',
      halalOnly: false,
      avoid: '香菜',
      dietaryPattern: 'keto',
      spiceLevel: 4,
      nutritionFocus: ['highProtein', 'highFiber', 'calcium'],
      preferLowCrowd: true,
      favoriteTags: ['高蛋白', '增肌推荐'],
    };

    const { status, data } = await req('/api/health/profile', {
      method: 'POST',
      token,
      body: profile,
    });
    assert.equal(status, 200);

    // Verify round-trip through bootstrap
    const { data: bootstrap } = await req('/api/bootstrap', { token });
    const p = bootstrap.profile;
    assert.equal(p.goal, 'muscleGain');
    assert.equal(p.budgetMax, 25);
    assert.equal(p.mealType, 'dinner');
    assert.equal(p.taste, '辣');
    assert.equal(p.halalOnly, false);
    assert.deepEqual(p.avoid, ['香菜']);
    assert.equal(p.dietaryPattern, 'keto');
    assert.equal(p.spiceLevel, 4);
    assert.deepEqual(p.nutritionFocus, ['highProtein', 'highFiber', 'calcium']);
    assert.equal(p.preferLowCrowd, true);
    assert.deepEqual(p.favoriteTags, ['高蛋白', '增肌推荐']);
  });

  it('nutrition focus affects recommendation scores', async () => {
    const token = await studentToken();

    // Set profile with highProtein focus
    await req('/api/health/profile', {
      method: 'POST',
      token,
      body: {
        goal: 'fatLoss',
        budgetMax: 30,
        mealType: 'lunch',
        nutritionFocus: ['highProtein'],
      },
    });

    const { data } = await req('/api/recommend', { token });
    // d-chicken-bowl has protein=38 (>=30), should get nutritionFocus boost
    const chicken = data.ranked.find((d) => d.id === 'd-chicken-bowl');
    assert.ok(chicken, 'd-chicken-bowl in results');
    assert.ok(
      chicken.scoreBreakdown.nutritionFocus > 0,
      `highProtein dish should get nutritionFocus boost, got ${chicken.scoreBreakdown.nutritionFocus}`
    );
    assert.ok(
      chicken.why.includes('高蛋白匹配'),
      'why mentions 高蛋白匹配'
    );
  });

  it('spice level mismatch penalizes dishes', async () => {
    const token = await studentToken();

    // Set spiceLevel=1 (not spicy at all)
    await req('/api/health/profile', {
      method: 'POST',
      token,
      body: { goal: 'healthy', budgetMax: 30, mealType: 'lunch', spiceLevel: 1 },
    });

    const { data } = await req('/api/recommend', { token });
    // d-tofu has taste='麻辣' → dishSpicy=5, spicePenalty=|1-5|=4, score=-10
    const tofu = data.ranked.find((d) => d.id === 'd-tofu');
    if (tofu) {
      assert.ok(
        tofu.scoreBreakdown.spice < 0,
        `麻辣 dish should be penalized with spiceLevel=1, got ${tofu.scoreBreakdown.spice}`
      );
    }
  });

  it('favoriteTags boost matching dishes', async () => {
    const token = await studentToken();

    await req('/api/health/profile', {
      method: 'POST',
      token,
      body: {
        goal: 'healthy',
        budgetMax: 30,
        mealType: 'lunch',
        favoriteTags: ['清真'],
      },
    });

    const { data } = await req('/api/recommend', { token });
    // d-beef-noodle has tags ['清真','热汤','高碳水'] — matches '清真'
    const beefNoodle = data.ranked.find((d) => d.id === 'd-beef-noodle');
    assert.ok(beefNoodle, 'd-beef-noodle in results');
    assert.ok(
      beefNoodle.scoreBreakdown.tags > 0,
      `清真-tagged dish should get tags boost, got ${beefNoodle.scoreBreakdown.tags}`
    );
    assert.ok(
      beefNoodle.why.some((r) => r.includes('匹配标签')),
      'why mentions matching tags'
    );
  });

  it('PUT /api/health/profile also works (not just POST)', async () => {
    const token = await studentToken();
    const { status } = await req('/api/health/profile', {
      method: 'PUT',
      token,
      body: { goal: 'maintain', budgetMax: 15, mealType: 'breakfast' },
    });
    assert.equal(status, 200);

    const { data: bootstrap } = await req('/api/bootstrap', { token });
    assert.equal(bootstrap.profile.goal, 'maintain');
    assert.equal(bootstrap.profile.budgetMax, 15);
    assert.equal(bootstrap.profile.mealType, 'breakfast');
  });
});

/* ================================================================== */
/*  8. Review status: RBAC + transitions                              */
/* ================================================================== */
describe('Review status moderation — RBAC and transitions', () => {
  setup();

  let student, admin;

  before(async () => {
    student = await studentToken();
    admin = await adminToken();
  });

  it('student review is forced to pending regardless of body.status', async () => {
    const { status } = await req('/api/reviews', {
      method: 'POST',
      token: student,
      body: { targetId: 'd-chicken-bowl', rating: 4, content: '不错很好吃' },
    });
    assert.equal(status, 201);

    // Verify the review appears in admin pending list — student cannot bypass moderation
    const { data: pending } = await req('/api/admin/reviews?status=pending', { token: admin });
    const myReview = pending.reviews.find((r) => r.content === '不错很好吃');
    assert.ok(myReview, 'student review forced to pending for admin moderation');
    assert.equal(myReview.status, 'pending');
  });

  it('explicit body.status=approved does not bypass pending for student', async () => {
    const { status } = await req('/api/reviews', {
      method: 'POST',
      token: student,
      body: { targetId: 'd-salad', rating: 5, content: '减脂神器推荐', status: 'approved' },
    });
    assert.equal(status, 201);

    // Must still appear as pending — student cannot self-approve
    const { data: pending } = await req('/api/admin/reviews?status=pending', { token: admin });
    const myReview = pending.reviews.find((r) => r.content === '减脂神器推荐');
    assert.ok(myReview, 'review with explicit approved still forced to pending');
    assert.equal(myReview.status, 'pending');
  });

  it('admin can list reviews filtered by status', async () => {
    const { status, data } = await req('/api/admin/reviews?status=pending', {
      token: admin,
    });
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.reviews));
    assert.ok(data.total >= 1, 'at least one pending review');
    for (const r of data.reviews) {
      assert.equal(r.status, 'pending', 'all listed reviews are pending');
    }
  });

  it('admin can approve a pending review', async () => {
    const { data: pending } = await req('/api/admin/reviews?status=pending', { token: admin });
    assert.ok(pending.reviews.length > 0, 'has pending reviews');
    const targetId = pending.reviews[0].id;

    const { status, data } = await req(`/api/admin/reviews/${targetId}/status`, {
      method: 'PATCH',
      token: admin,
      body: { status: 'approved' },
    });
    assert.equal(status, 200);
    assert.equal(data.status, 'approved');
    assert.equal(data.id, targetId);
  });

  it('admin can reject a review', async () => {
    // Create a review as student (forced to pending), then reject via admin
    await req('/api/reviews', {
      method: 'POST',
      token: student,
      body: { targetId: 'd-egg-tomato', rating: 1, content: '这个不好吃太咸了' },
    });
    // Find it in admin pending list
    const { data: pending } = await req('/api/admin/reviews?status=pending', { token: admin });
    const target = pending.reviews.find((r) => r.content === '这个不好吃太咸了');
    assert.ok(target, 'newly created review appears in admin pending list');

    const { status, data } = await req(`/api/admin/reviews/${target.id}/status`, {
      method: 'PATCH',
      token: admin,
      body: { status: 'rejected' },
    });
    assert.equal(status, 200);
    assert.equal(data.status, 'rejected');
  });

  it('admin can set review back to pending from approved', async () => {
    const { data: approved } = await req('/api/admin/reviews?status=approved', { token: admin });
    if (approved.reviews.length > 0) {
      const rid = approved.reviews[0].id;
      const { status, data } = await req(`/api/admin/reviews/${rid}/status`, {
        method: 'PATCH',
        token: admin,
        body: { status: 'pending' },
      });
      assert.equal(status, 200);
      assert.equal(data.status, 'pending');
    }
  });

  it('invalid review status is rejected', async () => {
    const { data: any } = await req('/api/admin/reviews', { token: admin });
    if (any.reviews.length > 0) {
      const rid = any.reviews[0].id;
      const { status, data } = await req(`/api/admin/reviews/${rid}/status`, {
        method: 'PATCH',
        token: admin,
        body: { status: 'spam' },
      });
      assert.equal(status, 400);
      assert.match(data.error, /approved|pending|rejected/);
    }
  });

  it('student cannot moderate reviews (RBAC)', async () => {
    const { data: any } = await req('/api/admin/reviews', { token: admin });
    if (any.reviews.length > 0) {
      const rid = any.reviews[0].id;
      const { status } = await req(`/api/admin/reviews/${rid}/status`, {
        method: 'PATCH',
        token: student,
        body: { status: 'rejected' },
      });
      assert.equal(status, 403);
    }
  });

  it('student cannot list admin reviews (RBAC)', async () => {
    const { status } = await req('/api/admin/reviews', { token: student });
    assert.equal(status, 403);
  });

  it('bootstrap only shows approved reviews', async () => {
    const { data: bootstrap } = await req('/api/bootstrap', { token: student });
    for (const r of bootstrap.reviews) {
      assert.equal(r.status, 'approved', `review ${r.id} should be approved in bootstrap`);
    }
  });

  it('moderating nonexistent review returns 404', async () => {
    const { status } = await req('/api/admin/reviews/nonexistent-review/status', {
      method: 'PATCH',
      token: admin,
      body: { status: 'approved' },
    });
    assert.equal(status, 404);
  });

  it('admin review analytics returns status distribution', async () => {
    const { status, data } = await req('/api/admin/reviews/analytics', { token: admin });
    assert.equal(status, 200);
    assert.ok(typeof data.total === 'number', 'has total');
    assert.ok(data.statusDistribution, 'has statusDistribution');
    assert.ok('approved' in data.statusDistribution, 'has approved count');
    assert.ok('pending' in data.statusDistribution, 'has pending count');
    assert.ok('rejected' in data.statusDistribution, 'has rejected count');
  });
});

/* ================================================================== */
/*  9. RAG search: citations ground in seeded dish data               */
/* ================================================================== */
describe('RAG search — citations reference real seeded dishes', () => {
  setup();

  it('search for 鸡胸肉 returns dish documents with real dish IDs', async () => {
    const { status, data } = await req('/api/rag/search?q=鸡胸肉');
    assert.equal(status, 200);
    assert.ok(data.results.length > 0, 'has results for 鸡胸肉');

    // Results should cite real dish IDs that exist in bootstrap
    const { data: bootstrap } = await req('/api/bootstrap');
    const realDishIds = new Set(bootstrap.dishes.map((d) => d.id));

    for (const result of data.results) {
      // result.sourceId should be a real dish
      if (result.sourceId) {
        assert.ok(
          realDishIds.has(result.sourceId),
          `result sourceId ${result.sourceId} should be a real dish`
        );
      }
      // result.content should mention actual ingredients/tags from the dish
      assert.ok(result.content || result.snippet, 'result has content or snippet');
    }
  });

  it('search for 清真 returns halal dish content', async () => {
    const { status, data } = await req('/api/rag/search?q=清真');
    assert.equal(status, 200);
    assert.ok(data.results.length > 0, 'has results for 清真');

    // d-beef-noodle is the seeded halal dish
    const beefResult = data.results.find((r) => r.sourceId === 'd-beef-noodle');
    assert.ok(beefResult, 'd-beef-noodle found in 清真 search results');
    assert.ok(beefResult.content.includes('清真'), 'content mentions 清真');
  });

  it('search for 凉皮 returns the liangpi dish with location hierarchy', async () => {
    const { status, data } = await req('/api/rag/search?q=凉皮');
    assert.equal(status, 200);
    assert.ok(data.results.length > 0, 'has results for 凉皮');

    const liangpi = data.results.find((r) => r.sourceId === 'd-liangpi');
    assert.ok(liangpi, 'd-liangpi found in results');
    // Content should include canteen hierarchy path (parent > canteen > stall)
    assert.ok(liangpi.content.includes('清凉小食坊') || liangpi.content.includes('北苑'), 'content includes location');
  });

  it('empty query is rejected', async () => {
    const { status } = await req('/api/rag/search');
    assert.ok(status >= 400, 'missing q returns error');
  });

  it('gibberish query returns empty results', async () => {
    const { status, data } = await req('/api/rag/search?q=zzznonexistent999');
    assert.equal(status, 200);
    assert.equal(data.results.length, 0);
  });
});
