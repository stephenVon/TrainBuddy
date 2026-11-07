const store = require('./utils/store')
const theme = require('./utils/theme')
const { getDefaultSessionState } = require('./utils/session')
const bindingApi = require('./services/bindingApi')

/**
 * V1.5 皮肤系统：包装全局 Page()，在每个页面 onShow 前自动应用皮肤（注入 skinClass、同步导航栏颜色），
 * 各页面 JS 与 WXML 无需单独接入，仅需根节点 class 绑定 {{skinClass}}。
 */
const rawPage = Page
Page = function (config) {
  if (config && typeof config === 'object') {
    if (!config.data) config.data = {}
    // 预载皮肤类与页面背景到初始 data：首次渲染即为当前皮肤，避免跳转/启动瞬间露出浅色内容再切换
    const _skin = theme.getSkin()
    if (config.data.skinClass === undefined) {
      config.data.skinClass = _skin === 'dark' ? 'skin-dark' : ''
    }
    if (config.data.pageBg === undefined) {
      config.data.pageBg = _skin === 'dark' ? '#0f1512' : '#f3f5f7'
    }
    const rawOnShow = config.onShow
    config.onShow = function () {
      theme.applyToPage(this)
      let role = ''
      try {
        const app = getApp()
        role = (app && app.globalData && app.globalData.role) || ''
      } catch (_) {}
      const route = this.route || ''
      if (role === 'ops' && route !== 'pages/ops-hint/index' && route !== 'pages/login/index') {
        wx.redirectTo({ url: '/pages/ops-hint/index' })
        return
      }
      return rawOnShow ? rawOnShow.apply(this, arguments) : undefined
    }
  }
  return rawPage(config)
}

App({
  globalData: Object.assign(
    {
      student: '',
      drafts: {},
      _boundStudentsCache: [],
      _meCache: null
      // schedule / training / diary / bindings 不再本地持久化
    },
    getDefaultSessionState()
  ),

  onLaunch() {
    const cached = store.load()
    if (cached) {
      Object.assign(this.globalData, cached)
    }
  },

  persist() {
    store.save(this.globalData)
  },

  /** 登录后刷新 /me 与学员列表缓存 */
  refreshServerCaches() {
    return bindingApi.refreshMe(this).then((me) => {
      if (me && me.grantedRoles) {
        this.globalData.session.grantedRoles = me.grantedRoles
        this.globalData.grantedRoles = me.grantedRoles
      }
      if (this.globalData.role !== 'coach') return me
      return bindingApi.listBoundStudentsForCoachAsync(this)
    })
  },

  setRole(role) {
    const { switchDisplayRole } = require('./utils/session')
    const result = switchDisplayRole(this, role)
    if (!result.ok) {
      this.toast(result.message)
    }
    return result
  },

  toast(title) {
    wx.showToast({ title, icon: 'none', duration: 2000 })
  }
})
