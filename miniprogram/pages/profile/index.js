const { requireLogin } = require('../../utils/guard')
const { syncRoleBar, setRole } = require('../../utils/role')
const { logout } = require('../../utils/session')
const { CONSENT_CATEGORIES } = require('../../utils/constants')
const { canActivateRole } = require('../../utils/permission')
const theme = require('../../utils/theme')
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
    inviteToken: '',
    skin: 'light'
  },

  onShow() {
    if (!requireLogin(this)) return
    this.setData({ skin: theme.getSkin() })
    this.refresh()
  },

  /**
   * V1.5：切换白色/黑色皮肤。
   * 动效参考 Web View Transitions 的 circle-blur 变体，用圆形扩散遮罩模拟：
   * 新皮肤底色圆从点击处扩散（带 blur 软边）→ 盖住全屏前一刻真正换肤 → 遮罩淡出。
   */
  onSkinChange(e) {
    if (this._revealBusy) return
    const target = e.currentTarget.dataset.skin === 'dark' ? 'dark' : 'light'
    if (target === theme.getSkin()) {
      this.setData({ skin: target })
      return
    }
    const touch = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0])
    let x = touch ? touch.clientX : null
    let y = touch ? touch.clientY : null
    const win = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {}
    const w = win.windowWidth || 375
    const h = win.windowHeight || 667
    const cx = typeof x === 'number' ? x : w / 2
    const cy = typeof y === 'number' ? y : h / 2
    // 圆需覆盖最远的屏幕角落；基础直径 50rpx ≈ 25px
    const maxDist = Math.max(
      Math.hypot(cx, cy),
      Math.hypot(w - cx, cy),
      Math.hypot(cx, h - cy),
      Math.hypot(w - cx, h - cy)
    )
    const revealScale = Math.ceil((maxDist / 25) * 1.1)
    this._revealBusy = true
    this.setData({
      revealActive: true,
      revealState: 'expand',
      revealX: cx,
      revealY: cy,
      // 半透明底色：扩散时透出旧页面，过渡更柔和（透明度可调）
      revealBg: target === 'dark' ? 'rgba(15, 21, 18, 0.55)' : 'rgba(243, 245, 247, 0.55)',
      revealScale: revealScale
    })
    setTimeout(() => {
      const skin = theme.setSkin(target)
      theme.applyToPage(this)
      this.setData({ skin, revealState: 'fade' })
      setTimeout(() => {
        this.setData({ revealActive: false, revealState: '' })
        this._revealBusy = false
      }, 90)
    }, 207)
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

  goPoints() {
    wx.navigateTo({ url: '/pages/points/index' })
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
