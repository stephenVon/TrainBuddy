const config = require('../../config')
const { logout } = require('../../utils/session')
const { isLoggedIn } = require('../../utils/permission')

Page({
  data: {
    opsUrl: ''
  },

  onShow() {
    const app = getApp()
    if (!isLoggedIn(app)) {
      wx.redirectTo({ url: '/pages/login/index' })
      return
    }
    if (app.globalData.role !== 'ops') {
      wx.redirectTo({ url: '/pages/home/index' })
      return
    }
    this.setData({ opsUrl: opsConsoleUrl() })
  },

  onCopy() {
    const url = this.data.opsUrl
    if (!url) return
    wx.setClipboardData({ data: url })
  },

  onLogout() {
    logout(getApp())
    wx.redirectTo({ url: '/pages/login/index' })
  }
})

function opsConsoleUrl() {
  const raw = String(config.API_BASE_URL || '').replace(/\/$/, '')
  const origin = raw.replace(/\/api\/v1$/, '')
  if (!origin) return ''
  return origin + '/ops/'
}
