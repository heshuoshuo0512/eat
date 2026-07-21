import { createRouter, createWebHashHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import CanteensView from '../views/CanteensView.vue';
import DishesView from '../views/DishesView.vue';
import RankingsView from '../views/RankingsView.vue';
import RegionRecommendationsView from '../views/RegionRecommendationsView.vue';
import RecommendView from '../views/RecommendView.vue';
import AdminView from '../views/AdminView.vue';
import AgentView from '../views/AgentView.vue';
import VisualMealView from '../views/VisualMealView.vue';
import OrdersView from '../views/OrdersView.vue';
import StallConsoleView from '../views/StallConsoleView.vue';
import { useCanteenStore } from '../stores/canteenStore.js';
import OrderAnalyticsView from '../views/OrderAnalyticsView.vue';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/canteens', name: 'canteens', component: CanteensView, meta: { audience: 'student' } },
    { path: '/dishes', name: 'dishes', component: DishesView, meta: { audience: 'student' } },
    { path: '/rankings', name: 'rankings', component: RankingsView, meta: { audience: 'student' } },
    { path: '/regions', name: 'regions', component: RegionRecommendationsView, meta: { audience: 'student' } },
    { path: '/recommend', name: 'recommend', component: RecommendView, meta: { audience: 'student' } },
    { path: '/visual-meal', name: 'visual-meal', component: VisualMealView, meta: { audience: 'student', hidden: true } },
    { path: '/orders', name: 'orders', component: OrdersView, meta: { audience: 'student' } },
    { path: '/stall-console', name: 'stall-console', component: StallConsoleView, meta: { audience: 'admin', hidden: true } },
    { path: '/order-analytics', name: 'order-analytics', component: OrderAnalyticsView, meta: { audience: 'admin', hidden: true } },
    { path: '/admin', name: 'admin', component: AdminView, meta: { audience: 'admin' } },
    { path: '/admin/input', name: 'admin-input', component: AdminView, meta: { audience: 'admin' } },
    { path: '/admin/ai', name: 'admin-ai', component: AdminView, meta: { audience: 'admin' } },
    { path: '/agent', name: 'agent', component: AgentView, meta: { audience: 'admin' } }
  ],
  scrollBehavior() {
    return { top: 0 };
  }
});

const adminRoles = new Set(['operator', 'stall_admin', 'canteen_admin', 'auditor', 'finance', 'tenant_admin', 'admin', 'super_admin']);

router.beforeEach((to) => {
  const store = useCanteenStore();
  if (!store.user || !to.meta.audience) return true;
  const isAdmin = adminRoles.has(store.user.role);
  if (to.meta.audience === 'admin' && !isAdmin) return { name: 'home' };
  if (to.meta.audience === 'student' && isAdmin) return { name: 'home' };
  return true;
});
