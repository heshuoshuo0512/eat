export const STUDENT_ENTRIES = Object.freeze([
  { id: 'dishes', label: '菜品检索', shortLabel: '找菜', description: '按评分、营养和供应快速找菜', eyebrow: '智能吃饭', route: '/pages/dishes/dishes', navigationType: 'switchTab', icon: '/static/icons/search.png', group: 'core', tone: 'core', discoveryMode: 'search' },
  { id: 'recommend', label: '智能推荐', shortLabel: '推荐', description: '结合档案与今日供应生成建议', eyebrow: '智能吃饭', route: '/pages/dishes/dishes', navigationType: 'switchTab', icon: '/static/icons/sparkles.png', group: 'core', tone: 'core', discoveryMode: 'recommend' },
  { id: 'canteens', label: '食堂导航', shortLabel: '食堂', description: '找到食堂、楼层和真实档口', eyebrow: '更多探索', route: '/pages/canteens/canteens', navigationType: 'navigateTo', icon: '/static/icons/map-pin.png', group: 'explore', tone: 'explore' },
  { id: 'rankings', label: '校园排行榜', shortLabel: '排行', description: '看看真实评分与校园热度', eyebrow: '更多探索', route: '/pages/rankings/rankings', navigationType: 'navigateTo', icon: '/static/icons/trophy.png', group: 'explore', tone: 'explore' },
  { id: 'regions', label: '区域推荐', shortLabel: '风味', description: '从六种风味里发现下一餐', eyebrow: '更多探索', route: '/pages/regions/regions', navigationType: 'navigateTo', icon: '/static/icons/compass.png', group: 'explore', tone: 'explore' },
  { id: 'reviews', label: '菜品评价', shortLabel: '评价', description: '汇总各食堂审核通过的口碑', eyebrow: '校园互动', route: '/pages/community/community', navigationType: 'switchTab', icon: '/static/icons/star.png', group: 'community', tone: 'community', communitySection: 'reviews' },
  { id: 'community', label: '校园帖子', shortLabel: '帖子', description: '分享真实菜品与食堂体验', eyebrow: '校园互动', route: '/pages/community/community', navigationType: 'switchTab', icon: '/static/icons/message-square.png', group: 'community', tone: 'community', communitySection: 'posts' },
  { id: 'saved', label: '收藏与吃过', shortLabel: '收藏', description: '把喜欢与吃过的菜统一收好', eyebrow: '个人记录', route: '/pages/saved/saved', navigationType: 'navigateTo', icon: '/static/icons/bookmark.png', group: 'records', tone: 'records' },
  { id: 'orders', label: '今日点餐', shortLabel: '点餐', description: '浏览菜单、购物车和取餐码', eyebrow: '个人记录', route: '/pages/orders/orders', navigationType: 'navigateTo', icon: '/static/icons/utensils.png', group: 'records', tone: 'records', badge: '联调中' },
  { id: 'health', label: '健康档案', shortLabel: '档案', description: '长期影响每一次智能推荐', eyebrow: '健康管理', route: '/pages/health-profile/health-profile', navigationType: 'navigateTo', icon: '/static/icons/heart-pulse.png', group: 'profile', tone: 'profile' },
  { id: 'vision', label: '拍照识餐', shortLabel: '识餐', description: '拍照分析菜品与营养信息', eyebrow: '智能吃饭', route: '/pages/vision/vision', navigationType: 'navigateTo', icon: '/static/icons/camera-line.png', group: 'core', tone: 'core' }
]);

const ENTRY_BY_ID = new Map(STUDENT_ENTRIES.map((entry) => [entry.id, entry]));

export const CORE_ENTRY_IDS = Object.freeze(['dishes', 'recommend']);
export const EXPLORE_ENTRY_IDS = Object.freeze(['canteens', 'rankings', 'regions']);
export const COMMUNITY_ENTRY_IDS = Object.freeze(['reviews', 'community']);

export function getStudentEntry(id) {
  return ENTRY_BY_ID.get(id) || null;
}

export function getStudentEntries(ids) {
  return ids.map((id) => getStudentEntry(id)).filter(Boolean);
}
