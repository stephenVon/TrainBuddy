const icons = require('../../assets/navigation-icons')
const NAV = {
  student: [
    { key: 'home', path: '/pages/home/index', text: '首页' },
    { key: 'booking', path: '/pages/booking/index', text: '约课' },
    { key: 'workout', path: '/pages/workout/index', text: '训练' },
    { key: 'growth', path: '/pages/growth/index', text: '成长' },
    { key: 'profile', path: '/pages/profile/index', text: '个人' }
  ],
  coach: [
    { key: 'home', path: '/pages/home/index', text: '首页' },
    { key: 'booking', path: '/pages/booking/index', text: '排课' },
    { key: 'students', path: '/pages/students/index', text: '学员' },
    { key: 'growth', path: '/pages/growth/index', text: '成长' },
    { key: 'profile', path: '/pages/profile/index', text: '个人' }
  ]
}

Component({
  properties: {
    active: {
      type: String,
      value: 'home'
    }
  },

  data: {
    icons,
    activeIcons: icons.active,
    items: NAV.student
  },

  lifetimes: {
    attached() {
      this.refresh()
    }
  },

  pageLifetimes: {
    show() {
      this.refresh()
    }
  },

  methods: {
    refresh() {
      const app = getApp()
      const role = (app && app.globalData && app.globalData.role) || 'student'
      this.setData({ items: NAV[role] || NAV.student })
    },

    onSwitch(e) {
      const path = e.currentTarget.dataset.path
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      const currentPath = '/' + (current ? current.route : '')
      if (currentPath === path) return
      wx.redirectTo({ url: path })
    }
  }
})
