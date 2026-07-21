import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ------------------------------------------------------------------ */
/*  Source loading                                                     */
/* ------------------------------------------------------------------ */

const routerJs = readFileSync(resolve('src/router/index.js'), 'utf-8');
const appVue = readFileSync(resolve('src/App.vue'), 'utf-8');
const homeVue = readFileSync(resolve('src/views/HomeView.vue'), 'utf-8');
const dishesVue = readFileSync(resolve('src/views/DishesView.vue'), 'utf-8');
const recommendVue = readFileSync(resolve('src/views/RecommendView.vue'), 'utf-8');
const ordersVue = readFileSync(resolve('src/views/OrdersView.vue'), 'utf-8');

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Extract the <script setup> block from a Vue SFC source.
 */
function extractScriptSetup(source) {
  const start = source.indexOf('<script setup>');
  if (start === -1) return '';
  const end = source.indexOf('</script>', start);
  return end > -1 ? source.slice(start, end) : source.slice(start);
}

/**
 * Extract the <template> block from a Vue SFC source.
 */
function extractTemplate(source) {
  const start = source.indexOf('<template>');
  if (start === -1) return '';
  const end = source.lastIndexOf('</template>');
  return end > -1 ? source.slice(start, end + '</template>'.length) : source.slice(start);
}

/**
 * Parse the route definition block for a given path from router source.
 * Returns the full text between the opening { and closing } of that route object.
 */
function extractRouteBlock(source, routePath) {
  const escaped = routePath.replace(/\//g, '\\/');
  const re = new RegExp(`\\{\\s*path:\\s*'${escaped}'`);
  const match = re.exec(source);
  if (!match) return null;
  let depth = 0;
  let end = match.index;
  for (let i = match.index; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  return source.slice(match.index, end);
}

const ordersScript = extractScriptSetup(ordersVue);
const ordersTemplate = extractTemplate(ordersVue);
const homeTemplate = extractTemplate(homeVue);
const dishesTemplate = extractTemplate(dishesVue);
const dishesScript = extractScriptSetup(dishesVue);
const recommendTemplate = extractTemplate(recommendVue);
const recommendScript = extractScriptSetup(recommendVue);

/* ================================================================== */
/*  1. Router: /orders is student-public (not hidden)                 */
/* ================================================================== */
describe('/orders route is student-public', () => {
  it('router defines /orders with audience: student', () => {
    const re = /path:\s*'\/orders'[^}]*audience:\s*'student'/;
    assert.ok(re.test(routerJs), '/orders route must have meta.audience = student');
  });

  it('/orders route does NOT carry hidden: true', () => {
    const block = extractRouteBlock(routerJs, '/orders');
    assert.ok(block, 'route block for /orders found');
    assert.ok(
      !/\bhidden:\s*true\b/.test(block),
      '/orders must not be hidden from student navigation'
    );
  });
});

/* ================================================================== */
/*  2. App.vue: /orders in student nav items                          */
/* ================================================================== */
describe('App.vue exposes /orders in student navigation', () => {
  it('navItems contains an entry for /orders with feature "student"', () => {
    const re = /\{\s*to:\s*'\/orders'[^}]*feature:\s*'student'/;
    assert.ok(re.test(appVue), 'navItems must include /orders with feature: student');
  });

  it('/orders nav label is a Chinese ordering label, not generic', () => {
    const match = appVue.match(/to:\s*'\/orders'\s*,\s*label:\s*'([^']+)'/);
    assert.ok(match, '/orders nav item has a label');
    assert.ok(/点餐|下单|订购/.test(match[1]), `label "${match[1]}" should reference ordering`);
  });
});

/* ================================================================== */
/*  3. HomeView: student homepage has /orders entry points            */
/* ================================================================== */
describe('HomeView has /orders entry for students', () => {
  it('feature orbit contains the preview ordering entry', () => {
    assert.ok(
      /id:\s*'orders'[^\n]*to:\s*'\/orders'/.test(homeVue),
      'student feature list must contain /orders'
    );
    assert.match(homeVue, /待开发 · 可预览/);
  });
});

/* ================================================================== */
/*  4. DishesView: detail panel links to /orders with dish query      */
/* ================================================================== */
describe('DishesView links to /orders with dish query parameter', () => {
  it('detail panel RouterLink carries dish query to /orders', () => {
    assert.ok(
      dishesTemplate.includes("path: '/orders'") || dishesTemplate.includes("path:'/orders'"),
      'DishesView must link to /orders'
    );
    assert.ok(
      /query:\s*\{\s*dish:/.test(dishesTemplate),
      'DishesView /orders link must carry a dish query parameter'
    );
  });

  it('DishesView reads route.query.dish for deep-link selection', () => {
    assert.ok(
      /route\.query\.dish/.test(dishesScript),
      'DishesView script must access route.query.dish'
    );
  });
});

/* ================================================================== */
/*  5. RecommendView: reveals / panels link to /orders with dish      */
/* ================================================================== */
describe('RecommendView links picks to the shared dish detail', () => {
  it('recommended dishes point to /dishes with dish query', () => {
    assert.ok(
      recommendTemplate.includes("path: '/dishes'") || recommendTemplate.includes("path:'/dishes'"),
      'RecommendView must contain a link to /dishes'
    );
    assert.ok(
      /query:\s*\{\s*dish:/.test(recommendTemplate),
      'RecommendView detail links must carry a dish query parameter'
    );
  });
});

/* ================================================================== */
/*  6. OrdersView: reads dish query and auto-adds to cart              */
/* ================================================================== */
describe('OrdersView reads ?dish= query for auto-add-to-cart', () => {
  it('imports useRoute from vue-router', () => {
    assert.ok(
      /import\s*\{[^}]*useRoute[^}]*\}\s*from\s*'vue-router'/.test(ordersScript),
      'OrdersView must import useRoute from vue-router'
    );
  });

  it('initialises route via useRoute()', () => {
    assert.ok(
      /(?:const\s+)?route\s*=\s*useRoute\(\)/.test(ordersScript),
      'OrdersView must call useRoute() to obtain the current route'
    );
  });

  it('accesses route.query.dish to read the incoming dish parameter', () => {
    assert.ok(
      /route\.query\.dish/.test(ordersScript),
      'OrdersView must read route.query.dish'
    );
  });

  it('has an addToCart function for dish injection', () => {
    assert.ok(
      /function\s+addToCart\s*\(/.test(ordersScript),
      'OrdersView must define addToCart()'
    );
  });
});

/* ================================================================== */
/*  7. Empty-menu copy does not send students to the admin backend    */
/* ================================================================== */
describe('Empty menu copy is student-friendly', () => {
  it('empty-menu message does not mention 管理端', () => {
    const menuElseMatch = ordersTemplate.match(/<p[^>]*v-else[^>]*class="muted"[^>]*>[^<]*<\/p>/g);
    assert.ok(menuElseMatch, 'found v-else muted paragraphs');
    for (const el of menuElseMatch) {
      assert.ok(
        !el.includes('管理端'),
        `empty-menu text must not direct students to 管理端: "${el}"`
      );
    }
  });

  it('no instance of 请先在管理端 in the entire template', () => {
    assert.ok(
      !ordersTemplate.includes('请先在管理端'),
      'OrdersView template must not contain "请先在管理端"'
    );
  });
});
