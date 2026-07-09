import { createRouter, createWebHashHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import CanteensView from '../views/CanteensView.vue';
import DishesView from '../views/DishesView.vue';
import RankingsView from '../views/RankingsView.vue';
import RecommendView from '../views/RecommendView.vue';
import AdminView from '../views/AdminView.vue';
import AgentView from '../views/AgentView.vue';
import VisualMealView from '../views/VisualMealView.vue';
import OrdersView from '../views/OrdersView.vue';
import StallConsoleView from '../views/StallConsoleView.vue';
import OrderAnalyticsView from '../views/OrderAnalyticsView.vue';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/canteens', name: 'canteens', component: CanteensView },
    { path: '/dishes', name: 'dishes', component: DishesView },
    { path: '/rankings', name: 'rankings', component: RankingsView },
    { path: '/recommend', name: 'recommend', component: RecommendView },
    { path: '/visual-meal', name: 'visual-meal', component: VisualMealView },
    { path: '/orders', name: 'orders', component: OrdersView },
    { path: '/stall-console', name: 'stall-console', component: StallConsoleView },
    { path: '/order-analytics', name: 'order-analytics', component: OrderAnalyticsView },
    { path: '/admin', name: 'admin', component: AdminView },
    { path: '/admin/input', name: 'admin-input', component: AdminView },
    { path: '/admin/ai', name: 'admin-ai', component: AdminView },
    { path: '/agent', name: 'agent', component: AgentView }
  ],
  scrollBehavior() {
    return { top: 0 };
  }
});
