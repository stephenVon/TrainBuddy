const { switchDisplayRole } = require('./session')
const { canActivateRole } = require('./permission')
const { ROLE_LABEL } = require('./constants')

function syncRoleBar(page) {
  const app = getApp()
  const session = app.globalData.session
  const grantedRoles = (session && session.grantedRoles) || app.globalData.grantedRoles || []
  const role = app.globalData.role || 'student'
  const optionLabel = { student: '我是学员', coach: '我是教练', ops: '我是运营' }
  const roleOptions = grantedRoles.map((r) => ({
    role: r,
    label: optionLabel[r] || ROLE_LABEL[r] || r,
    short: ROLE_LABEL[r] || r
  }))

  page.setData({
    role,
    grantedRoles,
    roleOptions,
    canSwitchCoach: canActivateRole(app, 'coach'),
    displayName: (session && session.user && session.user.displayName) || '',
    isLoggedIn: !!(session && session.sessionToken)
  })
}

function setRole(page, role) {
  const app = getApp()
  const result = switchDisplayRole(app, role)
  if (!result.ok) {
    app.toast(result.message || '无法切换角色')
    return
  }
  page.setData({ role: result.role })
  if (page.route !== 'pages/home/index') {
    wx.redirectTo({ url: '/pages/home/index' })
  } else if (typeof page.refreshPage === 'function') {
    page.refreshPage()
  }
}

function goProfile() {
  wx.navigateTo({ url: '/pages/profile/index' })
}

module.exports = { syncRoleBar, setRole, goProfile }
