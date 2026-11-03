const { requireLogin } = require('../../utils/guard')
const { syncRoleBar, setRole } = require('../../utils/role')
const { logout } = require('../../utils/session')
const { CONSENT_CATEGORIES } = require('../../utils/constants')
const { canActivateRole } = require('../../utils/permission')
const bindingApi = require('../../services/bindingApi')
const authApi = require('../../services/authApi')

Page({
  data: {
    displayName: '',
    userId: '',
    grantedRoles: [],
    canSwitchCoach: false,
    role: 'student',
    canSwitchRole: false,
    primaryBinding: null,
    boundAtText: '',
    activeScopeLabels: [],
    inviteToken: ''
  },

  onShow() {
    if (!requireLogin(this)) return
    this.refresh()
  },

  refresh() {
    const app = getApp()
    syncRoleBar(this)
    const session = app.globalData.session
    const user = session.user
    const apply = (primary) => {
      const labels = []
      if (primary && primary.scopes) {
        CONSENT_CATEGORIES.forEach((c) => {
          if (primary.scopes[c.key]) labels.push(c.label)
        })
      }
      this.setData({
        displayName: user.displayName,
        userId: user.userId,
        grantedRoles: session.grantedRoles || [],
        canSwitchCoach: canActivateRole(app, 'coach'),
        role: app.globalData.role || 'student',
        canSwitchRole: canActivateRole(app, app.globalData.role === 'coach' ? 'student' : 'coach'),
        primaryBinding: primary || null,
        boundAtText: primary ? formatDate(primary.boundAt) : '',
        activeScopeLabels: labels
      })
    }
    bindingApi.refreshMe(app).then((me) => {
      apply(me && me.primaryBinding)
    }).catch(() => apply(bindingApi.getActivePrimaryCoach(app, user.userId)))
  },

  goTools() { wx.navigateTo({ url: '/pages/ai/index' }) },
  goFriends() { wx.navigateTo({ url: '/pages/friends/index' }) },
  goBind() {
    wx.navigateTo({ url: '/pages/bind/index' })
  },

  onSwitchRole() {
    const target = getApp().globalData.role === 'coach' ? 'student' : 'coach'
    setRole(this, target)
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' })
  },

  goDiary() {
    wx.navigateTo({ url: '/pages/diary/index' })
  },

  goExercises() {
    wx.navigateTo({ url: '/pages/exercises/index' })
  },

  goGrowth() {
    wx.redirectTo({ url: '/pages/growth/index' })
  },

  onApplyCoach() {
    authApi.applyCoachRole().then((res) => {
      wx.showModal({
        title: '申请已提交',
        content: res.message,
        showCancel: false
      })
    })
  },

  onCreateInvite() {
    const app = getApp()
    const user = app.globalData.session.user
    bindingApi.createInvitation(app, user).then((res) => {
      this.setData({ inviteToken: res.token })
      wx.setClipboardData({ data: res.token })
      app.toast('邀请码已复制')
    })
  },

  onUnbind() {
    const app = getApp()
    const binding = this.data.primaryBinding
    if (!binding) return
    wx.showModal({
      title: '确认解绑',
      content:
        '解绑后教练将立即失去健康内容与照片访问权限。你仍保留本人历史记录。',
      confirmText: '解绑',
      success: (res) => {
        if (!res.confirm) return
        bindingApi
          .unbind(app, binding.id, app.globalData.session.user.userId)
          .then(() => {
            app.toast('已解绑')
            this.refresh()
          })
          .catch((err) => app.toast((err && err.message) || '解绑失败'))
      }
    })
  },

  /** AC33：解绑后请求签名 URL 应被拒绝 */
  onAc33Demo() {
    const app = getApp()
    const coachId = app.globalData.session.user.userId
    // 使用陈佳宁学员 ID（演示账号绑定后才有）；未绑定时用固定 subject
    const subjectId = 'u_stu_001'
    bindingApi
      .requestMediaAccess(app, {
        assetId: 'photo_demo_front',
        subjectId,
        viewerId: coachId,
        purpose: 'raw_photo'
      })
      .then((r) => {
        wx.showModal({
          title: '仍可访问（异常）',
          content: '拿到 URL：' + r.url,
          showCancel: false
        })
      })
      .catch((err) => {
        wx.showModal({
          title: 'AC33 通过',
          content: (err && err.code ? err.code + ' · ' : '') + ((err && err.message) || '拒绝访问'),
          showCancel: false
        })
      })
  },

  onLogout() {
    const app = getApp()
    logout(app)
    wx.redirectTo({ url: '/pages/login/index' })
  }
})

function formatDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()
}
