const authApi = require('../../services/authApi')
const { loginMock, loginWithWeChat } = require('../../utils/session')
const { isLoggedIn } = require('../../utils/permission')

Page({
  data: {
    privacyOk: false,
    wechatConfigured: false
  },

  onShow() {
    const app = getApp()
    if (isLoggedIn(app)) {
      wx.redirectTo({ url: '/pages/home/index' })
      return
    }
    this.setData({
      privacyOk: !!app.globalData.privacyAcceptedAt
    })
    authApi
      .wechatStatus()
      .then((st) => {
        this.setData({ wechatConfigured: !!(st && st.configured) })
      })
      .catch(() => {
        this.setData({ wechatConfigured: false })
      })
  },

  togglePrivacy() {
    const next = !this.data.privacyOk
    this.setData({ privacyOk: next })
    const app = getApp()
    app.globalData.privacyAcceptedAt = next ? Date.now() : null
    app.persist()
  },

  ensurePrivacy() {
    if (!this.data.privacyOk) {
      getApp().toast('请先同意隐私说明')
      return false
    }
    return true
  },

  onMockLogin(e) {
    if (!this.ensurePrivacy()) return
    const app = getApp()
    const accountKey = e.currentTarget.dataset.key
    const claimRole = e.currentTarget.dataset.claim || undefined

    loginMock(app, accountKey, claimRole)
      .then(() => {
        app.toast('登录成功')
        wx.redirectTo({ url: '/pages/home/index' })
      })
      .catch((err) => {
        const code = err && err.code
        const msg = (err && err.message) || '登录失败'
        if (code === 'NETWORK') {
          wx.showModal({
            title: '连不上 API',
            content:
              msg +
              '\n\n请在项目 server 目录执行 npm start，并在开发者工具勾选「不校验合法域名」。',
            showCancel: false
          })
          return
        }
        wx.showModal({
          title: code === 'ROLE_NOT_GRANTED' ? '无法获取角色' : '登录失败',
          content:
            msg +
            (err && err.grantedRoles
              ? '\n已授予：' + err.grantedRoles.join('、')
              : ''),
          showCancel: false
        })
      })
  },

  onWeChatLogin() {
    if (!this.ensurePrivacy()) return
    const app = getApp()
    loginWithWeChat(app)
      .then(() => {
        app.toast('登录成功')
        wx.redirectTo({ url: '/pages/home/index' })
      })
      .catch((err) => {
        const code = (err && err.code) || ''
        if (code === 'WECHAT_LOGIN_NOT_CONFIGURED') {
          wx.showModal({
            title: '微信登录未配置',
            content:
              '请在 server/.env 填写 WECHAT_APPID 与 WECHAT_APPSECRET（与小程序 AppID 一致），重启 API 后再试。当前可用上方演示账号。',
            showCancel: false
          })
          return
        }
        if (code === 'NETWORK') {
          wx.showModal({
            title: '连不上 API',
            content:
              (err && err.message) ||
              '请启动 API（npm start），开发者工具勾选「不校验合法域名」。',
            showCancel: false
          })
          return
        }
        app.toast((err && err.message) || '微信登录失败')
      })
  }
})
