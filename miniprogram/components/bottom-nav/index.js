const icons = require('../../assets/navigation-icons')
const coachIcons = require('../../assets/coach-icons')
const NAV = {
  student: [
    { key: 'home', path: '/pages/home/index', text: '课程' },
    { key: 'workout', path: '/pages/workout/index', text: '记录' },
    { key: 'growth', path: '/pages/growth/index', text: '进展' }
  ],
  coach: [
    { key: 'home', path: '/pages/home/index', text: '工作台' },
    { key: 'students', path: '/pages/students/index', text: '学员' },
    { key: 'booking', path: '/pages/booking/index', text: '日程' }
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
      this.setData({ role, items: NAV[role] || NAV.student, activeIcons: role === 'coach' ? Object.assign({}, icons.active, coachIcons.green) : icons.active })
    },

    onSwitch(e) {
      const path = e.currentTarget.dataset.path
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      const currentPath = '/' + (current ? current.route : '')
      if (currentPath === path) return
      if (current && typeof current.canLeave === 'function' && !current.canLeave()) return
      wx.redirectTo({ url: path })
    }
  }
})
