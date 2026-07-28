export const APP_TABS = Object.freeze([
  { id: 'home', label: '首页', route: '/pages/home/home', iconName: 'home', tone: 'meal' },
  { id: 'dishes', label: '找菜', route: '/pages/dishes/dishes', iconName: 'search-line', tone: 'discover' },
  { id: 'community', label: '社区', route: '/pages/community/community', iconName: 'message', tone: 'community' },
  { id: 'profile', label: '我的', route: '/pages/profile/profile', iconName: 'user', tone: 'records' }
]);

export function getAppTab(id) {
  return APP_TABS.find((item) => item.id === id) || null;
}
