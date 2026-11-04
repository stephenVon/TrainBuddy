const { syncRoleBar } = require('../../utils/role')
const { requireLogin } = require('../../utils/guard')
const trainingApi = require('../../services/trainingApi')
const interaction = require('../../utils/interaction')
const time = require('../../utils/time')

Page({
  data: {
    role: 'student',
    plans: [],
    hasPublishedPlans: false,
    session: null,
    finishing: false, savingSet: false, activeSid: '', activeGroup: null, pending: {}, saveError: '', loadError: '', loading: false, reduced: false
  },

  onShow() {
    if (!requireLogin(this)) return
    syncRoleBar(this)
    this.setData({ reduced: interaction.reducedMotion() })
    this.reload()
  },
  onHide() { this.cacheDraft() },
  onUnload() { this.cacheDraft(); this._unloaded = true; this._reloadGeneration = (this._reloadGeneration || 0) + 1 },
  draftKey(session) { return [this.studentId(), getApp().globalData.role, 'workout-v2', session.session_id].join(':') },
  cacheDraft() {
    if (!this.data.session) return
    if (this._sessionOwner && this._sessionOwner !== this.studentId() + ':' + getApp().globalData.role) return
    const app = getApp(), drafts = app.globalData.drafts || {}
    drafts[this.draftKey(this.data.session)] = { userId: this.studentId(), payload: this.data.pending, updatedAt: Date.now() }
    app.globalData.drafts = drafts
    try { app.persist() } catch (_) { this.setData({ saveError: '本机暂存失败，请保持页面打开并保存至服务器' }) }
  },
  applySession(session, restore) {
    this._sessionOwner = this.studentId() + ':' + getApp().globalData.role
    const cached = (getApp().globalData.drafts || {})[this.draftKey(session)]
    const pending = restore ? ((cached && cached.payload) || {}) : this.data.pending
    let first = ''
    session.exercises.forEach(ex => ex.sets.forEach(set => {
      if (pending[set.id]) Object.assign(set, pending[set.id])
      if (!first && set.state !== 'done' && set.state !== 'skipped') first = set.id
    }))
    this.setData({ session, pending })
    this.selectActive(restore ? first : (this.data.activeSid || first))
  },
  selectActive(sid) {
    let activeGroup = null
    this.data.session.exercises.forEach(ex => ex.sets.forEach(set => {
      if (set.id === sid) activeGroup = Object.assign({ exerciseName: ex.name }, set)
    }))
    this.setData({ activeSid: activeGroup ? sid : '', activeGroup })
  },
  onMotion(e) { interaction.setReducedMotion(e.detail.value); this.setData({ reduced: !!e.detail.value }) },
  onSelectSet(e) { if (!this._writeBusy && !this.data.finishing) this.selectActive(e.currentTarget.dataset.sid) },
  onCopyPrevious(e) {
    if (this._writeBusy || this.data.finishing) return
    const sid = e.currentTarget.dataset.sid
    for (const ex of this.data.session.exercises) {
      const index = ex.sets.findIndex(set => set.id === sid)
      if (index < 1) continue
      const previous = ex.sets[index - 1]
      for (const field of ['actualWeight', 'actualReps']) this.onSetField({ currentTarget: { dataset: { sid, field } }, detail: { value: previous[field] == null ? '' : previous[field] } })
      interaction.feedback(); return
    }
    getApp().toast('这是第一个训练组')
  },

  studentId() {
    return getApp().globalData.session.user.userId
  },

  reload() {
    if (this._writeBusy || this.data.finishing) return Promise.resolve()
    this.setData({ loading: true, loadError: '' })
    const app = getApp()
    const studentId = this.studentId()
    const generation = this._reloadGeneration = (this._reloadGeneration || 0) + 1
    const owner = studentId + ':' + app.globalData.role
    const current = () => generation === this._reloadGeneration && owner === this.studentId() + ':' + app.globalData.role && !this._unloaded

    return trainingApi.listSessions(app, {
      studentId,
      status: ['in_progress', 'draft']
    }).then((res) => {
      if (!current()) return
      const active = (res.data || []).find((s) => s.source_type === 'from_plan') || (res.data || [])[0]
      if (active) {
        this.applySession(active, true); this.setData({ plans: [] })
        return
      }
      return Promise.all([
        trainingApi.listPlansForStudent(app, studentId),
        trainingApi.listSessions(app, { studentId, status: ['completed'] })
      ]).then(([pres, sres]) => {
        if (!current()) return
        const today = time.todayKey()
        const doneIds = {}
        ;(sres.data || []).forEach((row) => {
          if (
            row.status === 'completed' &&
            row.business_date === today &&
            row.source_type === 'from_plan' &&
            row.plan_id
          ) {
            doneIds[row.plan_id] = true
          }
        })
        const published = (pres.data || []).filter((p) => p.published)
        // 可执行：安排日为今天，且当日尚未完成
        const plans = published.filter(
          (p) => p.published.planned_date === today && !doneIds[p.plan_id]
        )
        this.setData({
          session: null,
          plans,
          hasPublishedPlans: published.length > 0
        })
      })
    }).catch(err => { if (current()) this.setData({ loadError: err.message || '训练加载失败，请重试' }) })
      .then(() => { if (current()) this.setData({ loading: false }) })
  },

  goPlans() {
    wx.navigateTo({ url: '/pages/plans/index' })
  },

  goExercises() {
    wx.navigateTo({ url: '/pages/exercises/index' })
  },

  goDiary() {
    wx.navigateTo({ url: '/pages/diary/index' })
  },

  onEnsureDefault() {
    if (this._starting) return
    this._starting = true
    const app = getApp()
    const user = app.globalData.session.user
    return trainingApi.ensureDefaultPublishedPlan(app, {
      studentId: user.userId,
      authorId: user.userId,
      authorRole: 'student'
    }).then(() => this.reload()).catch(err => app.toast(err.message || '模板创建失败')).then(() => { this._starting = false })
  },

  onStart(e) {
    if (this._starting) return
    const planId = e.currentTarget.dataset.id
    this._starting = true
    const app = getApp()
    const studentId = this.studentId()
    const owner = studentId + ':' + app.globalData.role
    this._startKeys = this._startKeys || {}
    const keyName = studentId + ':' + planId
    return trainingApi
      .startSessionFromPlan(app, planId, {
        studentId,
        idempotencyKey: this._startKeys[keyName] || (this._startKeys[keyName] = keyName + ':' + Date.now())
      })
      .then((res) => {
        if (owner !== this.studentId() + ':' + app.globalData.role || this._unloaded) return
        this.applySession(res.data, true); delete this._startKeys[keyName]
        if (res.resumed) app.toast('已恢复未完成训练')
      })
      .catch((err) => app.toast((err && err.message) || '无法开始')).then(() => { this._starting = false })
  },

  onSetField(e) {
    if (this._writeBusy || this.data.finishing || !this.data.session) return
    const setId = e.currentTarget.dataset.sid
    const field = e.currentTarget.dataset.field
    if (!['actualWeight', 'actualReps'].includes(field)) return
    const pending = Object.assign({}, this.data.pending)
    pending[setId] = Object.assign({}, pending[setId], { [field]: e.detail.value })
    const session = JSON.parse(JSON.stringify(this.data.session))
    const hit = session.exercises.reduce((all, ex) => all.concat(ex.sets), []).find(set => set.id === setId)
    if (!hit) return
    hit[field] = e.detail.value
    this.setData({ session, pending, saveError: '' }); this.selectActive(this.data.activeSid); this.cacheDraft()
  },

  async saveSet(setId, state) {
    const session = this.data.session
    const owner = this.studentId() + ':' + getApp().globalData.role
    const hit = session.exercises.reduce((all, ex) => all.concat(ex.sets), []).find(set => set.id === setId)
    if (!hit) throw Error('训练组不存在，请重新载入')
    const patch = {}
    for (const field of ['actualWeight', 'actualReps']) {
      const value = interaction.numberValue(hit[field], field === 'actualReps' ? 1 : 0, field === 'actualReps' ? 1000 : 2000, field === 'actualReps')
      if (value == null && state === 'done') throw Error('请填写本组实际重量与次数；自重训练重量可填 0')
      if (value == null && Object.prototype.hasOwnProperty.call(this.data.pending[setId] || {}, field)) throw Error('尚未填写完整，请输入数值后保存')
      if (value != null) patch[field] = value
    }
    if (state) patch.state = state
    const res = await trainingApi.updateActualSet(getApp(), session.session_id, setId, patch)
    if (owner !== this.studentId() + ':' + getApp().globalData.role) throw Error('身份已切换，请返回对应账号核对训练')
    const pending = Object.assign({}, this.data.pending); delete pending[setId]
    this.setData({ pending }); this.applySession(res.data, false); this.cacheDraft()
    return res.data
  },

  onSetState(e) {
    if (this._writeBusy || this.data.finishing || this._finishModal || this._abandonModal) return Promise.resolve()
    this._writeBusy = true
    this.setData({ savingSet: true, saveError: '' })
    const setId = e.currentTarget.dataset.sid
    const state = e.currentTarget.dataset.state
    return this.saveSet(setId, state)
      .then((session) => {
        interaction.feedback()
        if (state === 'done' || state === 'skipped') {
          const sets = session.exercises.reduce((all, ex) => all.concat(ex.sets), [])
          const index = sets.findIndex(set => set.id === setId)
          const next = sets.slice(index + 1).concat(sets.slice(0, index)).find(set => set.state !== 'done' && set.state !== 'skipped')
          this.selectActive(next ? next.id : '')
          if (next && !this._unloaded) wx.pageScrollTo({ selector: '#set-' + next.id, duration: this.data.reduced ? 0 : 200, fail() {} })
        }
      })
      .catch(err => this.setData({ saveError: (err.message || '保存失败') + '；本地输入仍保留，请重试。' }))
      .then(() => { this._writeBusy = false; this.setData({ savingSet: false }) })
  },

  onFinish() {
    if (this.data.finishing || this._writeBusy || this._finishModal) return
    const app = getApp()
    const session = this.data.session
    this._finishModal = true
    wx.showModal({
      title: '结束训练',
      content:
        '已完成 ' +
        session.done_sets +
        ' 组。未完成组将标为跳过。重复点击不会重复累计次数。',
      confirmText: '确认结束',
      success: (res) => {
        this._finishModal = false
        if (!res.confirm || this._writeBusy || this.data.finishing) return
        this.setData({ finishing: true })
        const completionKey = session.session_id + ':complete'
        this._writeBusy = true
        let flush = Promise.resolve()
        Object.keys(this.data.pending).forEach(sid => { flush = flush.then(() => this.saveSet(sid)) })
        flush.then(() => trainingApi.finalizeSession(app, session.session_id, {
            completionKey,
            baseRevision: this.data.session.revision,
            share: false,
            actorRole: 'student'
          }))
          .then((resp) => {
            this._writeBusy = false
            const drafts = app.globalData.drafts || {}; delete drafts[this.draftKey(session)]; app.persist()
            this.setData({ finishing: false, session: null, pending: {} })
            const idem = resp.data.idempotent ? '\n（幂等：未重复计数）' : ''
            wx.showModal({
              title: '训练已保存',
              content:
                '完成 ' +
                resp.data.session.done_sets +
                ' 组。' +
                idem +
                (resp.data.next_plan ? '\n已生成下次计划草稿（规则复制，未自动加量）。' : ''),
              showCancel: false,
              success: () => this.reload()
            })
          })
          .catch((err) => {
            this._writeBusy = false
            this.setData({ finishing: false })
            app.toast((err && err.message) || '结束失败')
          })
      }, fail: () => { this._finishModal = false }
    })
  },

  onAbandon() {
    if (this._writeBusy || this.data.finishing || this._abandonModal) return
    this._abandonModal = true
    const app = getApp()
    wx.showModal({
      title: '放弃本次',
      content: '不计训练次数，可重新从计划开始。',
      confirmText: '放弃',
      success: (res) => {
        this._abandonModal = false
        if (!res.confirm || this._writeBusy || this.data.finishing) return
        this._writeBusy = true
        this.setData({ savingSet: true })
        trainingApi
          .abandonSession(app, this.data.session.session_id)
          .then(() => {
            const drafts = app.globalData.drafts || {}; delete drafts[this.draftKey(this.data.session)]; app.persist()
            this._writeBusy = false
            this.setData({ session: null, pending: {}, savingSet: false })
            this.reload()
          }).catch(err => { this._writeBusy = false; this.setData({ savingSet: false, saveError: err.message || '放弃失败' }) })
      }, fail: () => { this._abandonModal = false }
    })
  }
})
