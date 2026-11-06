const { syncRoleBar } = require('../../utils/role')
const { requireCoachRole } = require('../../utils/guard')
const { canCoachReadStudent } = require('../../utils/permission')
const bindingApi = require('../../services/bindingApi')
const bookingApi = require('../../services/bookingApi')
const trainingApi = require('../../services/trainingApi')

function coachIdOf(app) {
  return (
    (app.globalData.session.user.coachProfile &&
      app.globalData.session.user.coachProfile.coachId) ||
    ''
  )
}

function scopeSummary(scopes) {
  const s = scopes || {}
  const keys = [
    ['workout_self', '自主训练'],
    ['meal', '饮食'],
    ['body_state', '身体'],
    ['special', '特殊']
  ]
  const on = keys.filter(([k]) => !!s[k]).map(([, label]) => label)
  return on.length ? '已授权 · ' + on.join('／') : '绑定中 · 按日共享可见'
}

Page({
  data: {
    role: 'coach',
    keyword: '',
    filterMode: 'all',
    all: [],
    filtered: [],
    todoCount: 0,
    probeId: '',
    probeResult: '',
    showDiagnostics: false,
    diagnosticsAllowed: false,
    loading: false,
    error: ''
  },

  onLoad(query) {
    let develop = false
    try {
      develop = wx.getAccountInfoSync().miniProgram.envVersion === 'develop'
    } catch (_) {}
    this.setData({ diagnosticsAllowed: develop && !!query && query.diagnostics === '1' })
  },

  onShow() {
    if (!requireCoachRole(this)) return
    syncRoleBar(this)
    this.reload()
  },

  presentStudent(base, extras) {
    const pendingBookings = (extras && extras.pendingBookings) || 0
    const pendingChanges = (extras && extras.pendingChanges) || 0
    const lastTrainDate = (extras && extras.lastTrainDate) || ''
    const draftOpen = !!(extras && extras.draftOpen)
    const needsAttention = pendingBookings > 0 || pendingChanges > 0 || draftOpen
    const attentionParts = []
    if (pendingBookings) attentionParts.push(pendingBookings + ' 待确认预约')
    if (pendingChanges) attentionParts.push(pendingChanges + ' 改期申请')
    if (draftOpen) attentionParts.push('有未同步草稿')
    return Object.assign({}, base, {
      avatar: (base.name || '?').slice(0, 1),
      lastTrainLabel: lastTrainDate ? '最近训练 ' + lastTrainDate : '尚无已同步训练',
      lastTrainEmpty: !lastTrainDate,
      scopeLabel: scopeSummary(base.scopes),
      pendingBookings,
      pendingChanges,
      draftOpen,
      needsAttention,
      attentionLabel: attentionParts.length ? attentionParts.join(' · ') : '',
      statusLabel: needsAttention ? '待处理' : lastTrainDate ? '近期有课' : '已绑定',
      statusTone: needsAttention ? 'warn' : lastTrainDate ? 'ok' : 'muted'
    })
  },

  applyFilter() {
    const keyword = (this.data.keyword || '').trim()
    const mode = this.data.filterMode
    const filtered = (this.data.all || []).filter((item) => {
      if (mode === 'todo' && !item.needsAttention) return false
      if (!keyword) return true
      return (item.name + item.studentId + item.attentionLabel + item.lastTrainLabel).indexOf(keyword) !== -1
    })
    this.setData({ filtered })
  },

  reload() {
    const app = getApp()
    const generation = (this._reloadGeneration = (this._reloadGeneration || 0) + 1)
    const coachId = coachIdOf(app)
    this.setData({ loading: true, error: '' })

    Promise.all([
      bindingApi.listBoundStudentsForCoachAsync(app),
      coachId
        ? bookingApi.listBookings(app, { coachId, status: ['pending'] }).catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
      coachId
        ? bookingApi.listPendingChanges(app, coachId).catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] })
    ])
      .then(([bound, pendingRes, changeRes]) => {
        if (generation !== this._reloadGeneration) return null
        const pendingByStudent = {}
        ;(pendingRes.data || []).forEach((b) => {
          const id = b.student_id || b.studentId
          if (!id) return
          pendingByStudent[id] = (pendingByStudent[id] || 0) + 1
        })
        const changeByStudent = {}
        ;(changeRes.data || []).forEach((c) => {
          const booking = c.booking || {}
          const id = booking.student_id || booking.studentId
          if (!id) return
          changeByStudent[id] = (changeByStudent[id] || 0) + 1
        })

        const list = bound || []
        return Promise.all(
          list.map((b) =>
            trainingApi
              .listSessions(app, { studentId: b.studentId })
              .then((res) => {
                const sessions = res.data || []
                const sharedOrDone = sessions
                  .filter((s) => s.status === 'completed' || !!s.shared_at)
                  .slice()
                  .sort((a, c) =>
                    String(c.business_date || '').localeCompare(String(a.business_date || ''))
                  )
                const draftOpen = sessions.some(
                  (s) => s.status !== 'completed' && !s.shared_at && s.status !== 'abandoned'
                )
                return this.presentStudent(b, {
                  pendingBookings: pendingByStudent[b.studentId] || 0,
                  pendingChanges: changeByStudent[b.studentId] || 0,
                  lastTrainDate: (sharedOrDone[0] && sharedOrDone[0].business_date) || '',
                  draftOpen
                })
              })
              .catch(() =>
                this.presentStudent(b, {
                  pendingBookings: pendingByStudent[b.studentId] || 0,
                  pendingChanges: changeByStudent[b.studentId] || 0,
                  lastTrainDate: '',
                  draftOpen: false
                })
              )
          )
        )
      })
      .then((all) => {
        if (generation !== this._reloadGeneration || !all) return
        const todoCount = all.filter((s) => s.needsAttention).length
        this.setData({
          all,
          todoCount,
          keyword: this.data.keyword,
          probeResult: '',
          loading: false,
          error: ''
        })
        this.applyFilter()
      })
      .catch((err) => {
        if (generation !== this._reloadGeneration) return
        this.setData({
          loading: false,
          error: (err && err.message) || '学员列表读取失败，请重试'
        })
      })
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value || '' })
    this.applyFilter()
  },

  onFilterMode(e) {
    const mode = e.currentTarget.dataset.mode
    if (!['all', 'todo'].includes(mode)) return
    this.setData({ filterMode: mode })
    this.applyFilter()
  },

  onToggleDiagnostics() {
    if (this.data.diagnosticsAllowed) this.setData({ showDiagnostics: !this.data.showDiagnostics })
  },

  goInvite() {
    wx.navigateTo({ url: '/pages/profile/index?invite=1' })
  },

  onOpenStudent(e) {
    const app = getApp()
    const studentId = e.currentTarget.dataset.id
    const check = canCoachReadStudent(app, app.globalData.session.user.userId, studentId)
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
    const check = canCoachReadStudent(app, app.globalData.session.user.userId, studentId)
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
