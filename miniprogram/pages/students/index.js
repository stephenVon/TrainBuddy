const { syncRoleBar } = require('../../utils/role')
const { requireCoachRole } = require('../../utils/guard')
const { canCoachReadStudent } = require('../../utils/permission')
const bindingApi = require('../../services/bindingApi')

Page({
  data: {
    role: 'coach',
    keyword: '',
    all: [],
    filtered: [],
    probeId: '',
    probeResult: '', showDiagnostics: false, diagnosticsAllowed: false, loading: false, error: ''
  },
  onLoad(query) {
    let develop = false
    try { develop = wx.getAccountInfoSync().miniProgram.envVersion === 'develop' } catch (_) {}
    this.setData({ diagnosticsAllowed: develop && !!query && query.diagnostics === '1' })
  },

  onShow() {
    if (!requireCoachRole(this)) return
    syncRoleBar(this)
    this.reload()
  },

  reload() {
    const app = getApp()
    this.setData({ loading: true, error: '' })
    return bindingApi.listBoundStudentsForCoachAsync(app).then((bound) => {
      const all = (bound || []).map((b) => ({
        name: b.name,
        studentId: b.studentId,
        avatar: (b.name || '?')[0],
        desc: '已绑定 · 按授权可见',
        progress: null,
        scopes: b.scopes
      }))
      this.setData({
        all,
        filtered: all,
        keyword: '',
        probeResult: ''
      })
    }).catch(err => this.setData({ error: err.message || '学员列表读取失败，请重试' }))
      .then(() => this.setData({ loading: false }))
  },

  onSearch(e) {
    const keyword = e.detail.value || ''
    // AC02：搜索仅在有权管理的学员集合内
    const filtered = this.data.all.filter((item) => {
      if (!keyword) return true
      return (item.name + item.desc + item.studentId).indexOf(keyword.trim()) !== -1
    })
    this.setData({ keyword, filtered })
  },
  onToggleDiagnostics() { if (this.data.diagnosticsAllowed) this.setData({ showDiagnostics: !this.data.showDiagnostics }) },
  goInvite() { wx.navigateTo({ url:'/pages/profile/index?invite=1' }) },

  onOpenStudent(e) {
    const app = getApp()
    const studentId = e.currentTarget.dataset.id
    const check = canCoachReadStudent(
      app,
      app.globalData.session.user.userId,
      studentId
    )
    if (!check.ok) {
      app.toast(check.message || '无权访问')
      return
    }
    app.globalData.activeSubjectId = studentId
    app.globalData.student = e.currentTarget.dataset.name
    app.persist()
    wx.navigateTo({
      url:
        '/pages/student-profile/index?studentId=' +
        studentId +
        '&name=' +
        encodeURIComponent(e.currentTarget.dataset.name || '')
    })
  },

  onContact() {
    getApp().toast('消息服务未接入，未实际发送')
  },

  /** AC02 测例：查询未绑定学员 ID */
  onProbe() {
    if (!this.data.diagnosticsAllowed) return
    const app = getApp()
    const studentId = (this.data.probeId || '').trim() || 'u_stu_unbound_999'
    const check = canCoachReadStudent(
      app,
      app.globalData.session.user.userId,
      studentId
    )
    this.setData({
      probeResult: check.ok
        ? '异常：不应可访问'
        : 'AC02 通过 · ' + check.code + ' · ' + check.message
    })
  },

  onProbeInput(e) {
    this.setData({ probeId: e.detail.value })
  }
})
