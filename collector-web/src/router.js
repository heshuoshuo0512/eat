import { createRouter, createWebHistory } from 'vue-router';
import HomeView from './views/HomeView.vue';
import ContributeView from './views/ContributeView.vue';
import MeView from './views/MeView.vue';
import StaffView from './views/StaffView.vue';
import AdminView from './views/AdminView.vue';

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/groups/:groupId/contribute', component: ContributeView },
    { path: '/me', component: MeView },
    { path: '/staff', component: StaffView },
    { path: '/admin', component: AdminView },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
