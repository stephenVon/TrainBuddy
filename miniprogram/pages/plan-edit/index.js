const { requireLogin } = require('../../utils/guard')
const trainingApi = require('../../services/trainingApi')
const interaction = require('../../utils/interaction')
const clone = value => JSON.parse(JSON.stringify(value))
const uid = prefix => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

Page({
  data: { plan: null, draft: null, loading: true, error: '', saving: false, changed: false, conflict: false, title: '', goal: '', plannedDate: '', reason: '', exercises: [], missingNotesText: '', today: '', bases: ['总重量（含杆）', '单侧重量', '自重', '待确认'], library: trainingApi.EXERCISE_LIBRARY },
  onLoad(q) { this.planId = q.id; this.setData({ sheetIndex: -1, reduced: interaction.reducedMotion(), dragIndex: -1, dragOffset: 0, saveError: '' }) },
  onShow() { if (requireLogin(this) && !this.loaded) this.reload() },
  onHide() { this.cache() },
  onUnload() { this.cache() },
  cacheKey() {
    const app = getApp(), user = app.globalData.session.user
    return [user.userId, app.globalData.role, this.data.plan.student_id, 'plan', this.planId].join(':')
  },
  cache() {
    if (!this.data.plan || !this.data.changed || !getApp().globalData.session) return
    if (this._owner && this._owner !== getApp().globalData.session.user.userId + ':' + getApp().globalData.role) return
    const app = getApp(), drafts = app.globalData.drafts || {}
    drafts[this.cacheKey()] = { userId: app.globalData.session.user.userId, payload: this.snapshot(), updatedAt: Date.now() }
    app.globalData.drafts = drafts
    try { app.persist() } catch (_) { app.toast('本地草稿暂存失败，请尽快保存到服务器') }
  },
  clearCache() {
    const app = getApp()
    if (app.globalData.drafts) delete app.globalData.drafts[this.cacheKey()]
    app.persist()
  },
  snapshot() {
    return { title: this.data.title, goal: this.data.goal, plannedDate: this.data.plannedDate, reason: this.data.reason, exercises: clone(this.data.exercises), version: this.data.draft ? this.data.draft.version : this.data.plan.current_published_revision, base_revision: this.data.draft ? this.data.draft.revision : null }
  },
  reload(ignoreCache) {
    this.setData({ loading: true, error: '' })
    return trainingApi.getPlan(getApp(), this.planId).then(res => {
      this.loaded = true
      this.applyPlan(res.data)
      const cached = (getApp().globalData.drafts || {})[this.cacheKey()]
      if (!ignoreCache && cached) {
        const current = this.snapshot(), local = cached.payload
        const conflict = current.base_revision !== local.base_revision || current.version !== local.version
        this.setData({ title: local.title, goal: local.goal, plannedDate: local.plannedDate, reason: local.reason, exercises: local.exercises, changed: true, conflict })
        getApp().toast(conflict ? '云端已更新，本地内容保留，请核对后重新载入' : '已恢复本地未保存内容')
      }
    }).catch(err => this.setData({ error: err.message || '计划读取失败，请重试' }))
      .then(() => this.setData({ loading: false }))
  },
  applyPlan(plan) {
    this._owner = getApp().globalData.session.user.userId + ':' + getApp().globalData.role
    const draft = plan.latest_draft, content = draft || plan.published || {}
    this.setData({ plan, draft, title: content.title || '', goal: content.goal || '', plannedDate: content.planned_date || '', reason: content.reason || '', exercises: clone(content.exercises || []), changed: false, conflict: false, missingNotesText: ((draft && draft.missing_notes) || []).join('；') })
  },
  editable() { return this.data.plan && this.data.plan.can_edit && this.data.draft && !this.data.saving && !this.data.conflict },
  change(values) {
    if (!this.editable()) return
    this.setData(Object.assign({ changed: true, saveError: '' }, values)); this.cache()
    if (typeof wx.enableAlertBeforeUnload === 'function') wx.enableAlertBeforeUnload({ message: '训练计划有未保存修改，已暂存在本机。', fail() {} })
  },
  onMotion(e) { interaction.setReducedMotion(e.detail.value); this.setData({ reduced: !!e.detail.value }) },
  onOpenExercise(e) { if (this.editable()) this.setData({ sheetIndex: Number(e.currentTarget.dataset.ei) }) },
  onCloseSheet() { this.setData({ sheetIndex: -1 }); this.cache() },
  swallow() {},
  onDuplicateExercise(e) {
    if (!this.editable()) return
    const exercises = clone(this.data.exercises), index = Number(e.currentTarget.dataset.ei), copy = clone(exercises[index])
    copy.id = uid('pex_'); copy.sets.forEach(set => { set.id = uid('pset_') })
    exercises.splice(index + 1, 0, copy); this.change({ exercises }); interaction.feedback()
  },
  onDuplicateSet(e) {
    if (!this.editable()) return
    const exercises = clone(this.data.exercises), { ei, si } = e.currentTarget.dataset, sets = exercises[Number(ei)].sets
    if (sets.length >= 30) return getApp().toast('每个动作最多 30 组')
    const copy = clone(sets[Number(si)]); copy.id = uid('pset_'); sets.splice(Number(si) + 1, 0, copy)
    sets.forEach((set, index) => { set.setNo = index + 1 }); this.change({ exercises })
  },
  onGroupCount(e) {
    if (!this.editable()) return
    const ei = Number(e.currentTarget.dataset.ei), count = Number(e.detail.value), sets = this.data.exercises[ei].sets
    if (!Number.isInteger(count) || count < 1 || count > 30 || count === sets.length) return
    if (count < sets.length) {
      wx.showModal({ title: '减少训练组？', content: '将移除最后 ' + (sets.length - count) + ' 组目标。取消会保留原组数。', success: res => {
        if (!res.confirm || !this.editable()) {
          const control = this.selectComponent && this.selectComponent('#group-count')
          if (control) control.reset()
          return
        }
        const exercises = clone(this.data.exercises); exercises[ei].sets = exercises[ei].sets.slice(0, count); this.change({ exercises })
      } }); return
    }
    const exercises = clone(this.data.exercises), next = exercises[ei].sets
    while (next.length < count) {
      const last = next[next.length - 1] || {}
      next.push({ id: uid('pset_'), setNo: next.length + 1, targetWeight: last.targetWeight == null ? null : last.targetWeight, targetReps: last.targetReps == null ? null : last.targetReps, required: true })
    }
    this.change({ exercises })
  },
  onDragStart(e) {
    if (!this.editable()) return
    const index = Number(e.currentTarget.dataset.ei), y = e.touches[0].clientY
    this._drag = { index, y, currentY: y, id: this.data.exercises[index].id, rects: [] }
    this.setData({ dragIndex: index, dragOffset: 0 })
    const drag = this._drag
    wx.createSelectorQuery().selectAll('.ix-sort-row').boundingClientRect(rects => { if (this._drag === drag) drag.rects = rects || [] }).exec()
  },
  onDragMove(e) {
    if (!this._drag) return
    this._drag.currentY = e.touches[0].clientY
    this.setData({ dragOffset: this._drag.currentY - this._drag.y })
  },
  onDragEnd() {
    const drag = this._drag; this._drag = null
    this.setData({ dragIndex: -1, dragOffset: 0 })
    if (!drag || !this.editable() || Math.abs(drag.currentY - drag.y) < 8 || !drag.rects.length) return
    const exercises = clone(this.data.exercises), from = exercises.findIndex(ex => ex.id === drag.id)
    const to = drag.rects.reduce((index, rect, i, rects) => Math.abs(drag.currentY - rect.top - rect.height / 2) < Math.abs(drag.currentY - rects[index].top - rects[index].height / 2) ? i : index, 0)
    if (from < 0 || from === to) return
    const item = exercises.splice(from, 1)[0]; exercises.splice(to, 0, item)
    this.change({ exercises }); interaction.feedback()
  },
  onDragCancel() { this._drag = null; this.setData({ dragIndex: -1, dragOffset: 0 }) },
  onField(e) { const key = e.currentTarget.dataset.field; if (['title', 'goal', 'plannedDate', 'reason'].includes(key)) this.change({ [key]: e.detail.value }) },
  onSet(e) {
    if (!this.editable()) return
    const { ei, si, field } = e.currentTarget.dataset
    if (!['targetWeight', 'targetReps'].includes(field)) return
    const exercises = clone(this.data.exercises)
    exercises[Number(ei)].sets[Number(si)][field] = e.detail.value
    this.change({ exercises })
  },
  onName(e) { const exercises = clone(this.data.exercises); exercises[Number(e.currentTarget.dataset.ei)].name = e.detail.value; this.change({ exercises }) },
  onBasis(e) { const exercises = clone(this.data.exercises); exercises[Number(e.currentTarget.dataset.ei)].loadBasis = ['total', 'per_side', 'bodyweight', 'unknown'][Number(e.detail.value)]; this.change({ exercises }) },
  onAddExercise(e) {
    const library = trainingApi.EXERCISE_LIBRARY[Number(e.currentTarget.dataset.index)]
    this.change({ exercises: this.data.exercises.concat({ id: uid('pex_'), exerciseId: library ? library.id : null, name: library ? library.name : '自定义动作', icon: library ? library.icon : '🏋️', loadBasis: 'unknown', sets: [{ id: uid('pset_'), setNo: 1, targetWeight: null, targetReps: null, required: true }] }) })
  },
  onRemoveExercise(e) { this.change({ exercises: this.data.exercises.filter((_, i) => i !== Number(e.currentTarget.dataset.ei)) }) },
  onMove(e) {
    const from = Number(e.currentTarget.dataset.ei), to = from + Number(e.currentTarget.dataset.step)
    if (to < 0 || to >= this.data.exercises.length) return
    const exercises = clone(this.data.exercises), item = exercises.splice(from, 1)[0]
    exercises.splice(to, 0, item); this.change({ exercises })
  },
  onAddSet(e) {
    const exercises = clone(this.data.exercises), sets = exercises[Number(e.currentTarget.dataset.ei)].sets
    if (sets.length >= 30) return getApp().toast('每个动作最多 30 组')
    const last = sets[sets.length - 1] || {}
    sets.push({ id: uid('pset_'), setNo: sets.length + 1, targetWeight: last.targetWeight == null ? null : last.targetWeight, targetReps: last.targetReps == null ? null : last.targetReps, required: true })
    this.change({ exercises })
  },
  onRemoveSet(e) {
    const exercises = clone(this.data.exercises), ex = exercises[Number(e.currentTarget.dataset.ei)]
    if (ex.sets.length <= 1) return getApp().toast('至少保留一组，或移除整个动作')
    ex.sets.splice(Number(e.currentTarget.dataset.si), 1)
    ex.sets.forEach((set, index) => { set.setNo = index + 1 }); this.change({ exercises })
  },
  onCreateDraft() {
    if (this.data.saving) return
    this.setData({ saving: true })
    trainingApi.updatePlanDraft(getApp(), this.planId, { version: this.data.plan.current_published_revision })
      .then(res => { this.applyPlan(res.data); getApp().toast('新草稿已创建，原发布版保持不变') })
      .catch(err => getApp().toast(err.message || '创建失败')).then(() => this.setData({ saving: false }))
  },
  normalized() {
    const payload = this.snapshot()
    payload.exercises.forEach(ex => ex.sets.forEach(set => {
      for (const field of ['targetWeight', 'targetReps']) {
        const value = set[field]
        if (value === '' || value == null) set[field] = null
        else { const integer = field === 'targetReps'; set[field] = interaction.numberValue(value, integer ? 1 : 0, integer ? 1000 : 2000, integer) }
      }
    }))
    return payload
  },
  save(publish) {
    if (!this.editable()) return Promise.resolve()
    let payload
    try { payload = this.normalized() } catch (err) { getApp().toast(err.message); return Promise.resolve() }
    this.setData({ saving: true, saveError: '', sheetIndex: -1 })
    return trainingApi.updatePlanDraft(getApp(), this.planId, payload).then(res => {
      const saved = res.data
      this.applyPlan(saved); this.clearCache()
      if (typeof wx.disableAlertBeforeUnload === 'function') wx.disableAlertBeforeUnload({ fail() {} })
      if (!publish) { getApp().toast('草稿已保存'); return }
      return trainingApi.publishPlan(getApp(), this.planId, { version: saved.latest_draft.version, baseRevision: saved.latest_draft.revision, reviewConfirmation: true }).then(result => { this.applyPlan(result.data); getApp().toast('计划已发布') })
    }).catch(err => {
      if (err.code === 'REVISION_CONFLICT') this.setData({ conflict: true })
      this.setData({ saveError: err.message || '保存失败，编辑内容仍保留，请重试' })
      getApp().toast(err.message || '保存失败，编辑内容仍保留')
    }).then(() => this.setData({ saving: false }))
  },
  onSaveMeta() { return this.save(false) },
  onPublish() {
    if (!this.editable()) return
    wx.showModal({ title: '确认发布计划', content: '将保存全部动作与组参数，再发布新版本。已开始的训练仍保留旧快照。', success: result => { if (result.confirm) this.save(true) } })
  },
  onReload() { wx.showModal({ title: '重新载入云端版本？', content: '本页尚未保存的修改将被放弃。', success: result => { if (result.confirm) { this.setData({ changed: false }); if (this.data.plan) this.clearCache(); this.reload(true) } } }) }
})
