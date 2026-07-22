import { createRouter, createWebHashHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import CanteensView from '../views/CanteensView.vue';
import DishesView from '../views/DishesView.vue';
import RankingsView from '../views/RankingsView.vue';
import RegionRecommendationsView from '../views/RegionRecommendationsView.vue';
import AdminView from '../views/AdminView.vue';
import AgentView from '../views/AgentView.vue';
import VisualMealView from '../views/VisualMealView.vue';
import OrdersView from '../views/OrdersView.vue';
import StallConsoleView from '../views/StallConsoleView.vue';
import { useCanteenStore } from '../stores/canteenStore.js';
import OrderAnalyticsView from '../views/OrderAnalyticsView.vue';

const RecommendView = () => import('../views/RecommendView.vue');
const HealthProfileView = () => import('../views/HealthProfileView.vue');
const SavedView = () => import('../views/SavedView.vue');
const ReviewsView = () => import('../views/ReviewsView.vue');
const CommunityView = () => import('../views/CommunityView.vue');
const AdminCatalogView = () => import('../views/AdminCatalogView.vue');

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/canteens', name: 'canteens', component: CanteensView, meta: { audience: 'student' } },
    { path: '/dishes', name: 'dishes', component: DishesView, meta: { audience: 'student' } },
    { path: '/rankings', name: 'rankings', component: RankingsView, meta: { audience: 'student' } },
    { path: '/regions', name: 'regions', component: RegionRecommendationsView, meta: { audience: 'student' } },
    {
      path: '/recommend',
      name: 'recommend',
      component: RecommendView,
      meta: { audience: 'student' },
      beforeEnter: (to) => to.query.panel === 'favorites'
        ? { path: '/saved', query: Object.fromEntries(Object.entries(to.query).filter(([key]) => key !== 'panel')) }
        : true
    },
    { path: '/health-profile', name: 'health-profile', component: HealthProfileView, meta: { audience: 'student' } },
    { path: '/saved', name: 'saved', component: SavedView, meta: { audience: 'student' } },
    { path: '/reviews', name: 'reviews', component: ReviewsView, meta: { audience: 'student' } },
    { path: '/community', name: 'community', component: CommunityView, meta: { audience: 'student' } },
    { path: '/visual-meal', name: 'visual-meal', component: VisualMealView, meta: { audience: 'student', hidden: true } },
    { path: '/orders', name: 'orders', component: OrdersView, meta: { audience: 'student' } },
    { path: '/stall-console', name: 'stall-console', component: StallConsoleView, meta: { audience: 'admin', hidden: true } },
    { path: '/order-analytics', name: 'order-analytics', component: OrderAnalyticsView, meta: { audience: 'admin', hidden: true } },
    {
      path: '/admin',
      name: 'admin',
      component: AdminView,
      meta: { audience: 'admin' },
      beforeEnter: (to) => to.query.panel
        ? to.query.panel === 'data'
          ? { path: '/admin/catalog', query: Object.fromEntries(Object.entries(to.query).filter(([key]) => key !== 'panel')) }
          : true
        : { path: '/admin', query: { ...to.query, panel: 'reviews', tab: 'reviews' } }
    },
    { path: '/admin/catalog', name: 'admin-catalog', component: AdminCatalogView, meta: { audience: 'admin' } },
    { path: '/admin/input', name: 'admin-input', component: AdminView, meta: { audience: 'admin' } },
    { path: '/admin/ai', name: 'admin-ai', component: AdminView, meta: { audience: 'admin' } },
    { path: '/agent', name: 'agent', component: AgentView, meta: { audience: 'admin' } }
  ],
  scrollBehavior() {
    return { top: 0 };
  }
});

const adminRoles = new Set(['operator', 'stall_admin', 'canteen_admin', 'auditor', 'finance', 'tenant_admin', 'admin', 'super_admin']);
const moderationRoles = new Set(['canteen_admin', 'tenant_admin', 'admin', 'super_admin']);
const dataManageRoles = new Set(['operator', 'stall_admin', 'canteen_admin', 'auditor', 'tenant_admin', 'admin', 'super_admin']);
const dataInputRoles = new Set(['operator', 'stall_admin', 'canteen_admin', 'tenant_admin', 'admin', 'super_admin']);
const agentRoles = new Set(['operator', 'stall_admin', 'canteen_admin', 'tenant_admin', 'admin', 'super_admin']);
const aiConfigRoles = new Set(['tenant_admin', 'admin', 'super_admin']);

function canAccessAdminRoute(to, role) {
  if (to.path === '/admin/input') return dataInputRoles.has(role);
  if (to.path === '/agent') return agentRoles.has(role);
  if (to.path === '/admin/ai') return aiConfigRoles.has(role);
  if (to.path === '/admin' && to.query.panel === 'data') return dataManageRoles.has(role);
  if (to.path === '/admin/catalog') return dataManageRoles.has(role);
  if (to.path === '/admin') return moderationRoles.has(role);
  return true;
}

router.beforeEach((to) => {
  if (to.path === '/admin' && to.query.panel === 'data') {
    return { path: '/admin/catalog', query: Object.fromEntries(Object.entries(to.query).filter(([key]) => key !== 'panel')) };
  }
  const store = useCanteenStore();
  if (!store.user || !to.meta.audience) return true;
  const isAdmin = adminRoles.has(store.user.role);
  if (to.meta.audience === 'admin' && !isAdmin) return { name: 'home' };
  if (to.meta.audience === 'admin' && !canAccessAdminRoute(to, store.user.role)) return { name: 'home' };
  if (to.meta.audience === 'student' && isAdmin) return { name: 'home' };
  return true;
});
