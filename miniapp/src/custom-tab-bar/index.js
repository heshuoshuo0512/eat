Component({
  data: {
    selected: 0,
    list: [
      { id:'home', label:'首页', route:'/pages/home/home', icon:'/static/tab/home-normal.png', activeIcon:'/static/tab/home-active.png' },
      { id:'dishes', label:'找菜', route:'/pages/dishes/dishes', icon:'/static/tab/dishes-normal.png', activeIcon:'/static/tab/dishes-active.png' },
      { id:'community', label:'社区', route:'/pages/community/community', icon:'/static/tab/community-normal.png', activeIcon:'/static/tab/community-active.png' },
      { id:'profile', label:'我的', route:'/pages/profile/profile', icon:'/static/tab/profile-normal.png', activeIcon:'/static/tab/profile-active.png' }
    ]
  },
  lifetimes: {
    attached() { this.syncSelected(); },
    detached() { clearTimeout(this.navigationTimer); }
  },
  pageLifetimes: { show() { this.syncSelected(); } },
  methods: {
    syncSelected() {
      const pages = getCurrentPages();
      const route = `/${pages[pages.length - 1]?.route || ''}`;
      const selected = this.data.list.findIndex((item) => item.route === route);
      if (selected >= 0) this.setData({ selected });
    },
    switchTab(event) {
      const route = event.currentTarget.dataset.route;
      const selected = Number(event.currentTarget.dataset.index || 0);
      if (!route || selected === this.data.selected) return;
      clearTimeout(this.navigationTimer);
      this.setData({ selected }, () => {
        this.navigationTimer = setTimeout(() => wx.switchTab({ url: route }), 220);
      });
    }
  }
});
