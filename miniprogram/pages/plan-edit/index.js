const { requireLogin } = require('../../utils/guard')
const trainingApi = require('../../services/trainingApi')
const interaction = require('../../utils/interaction')
const clone = value => JSON.parse(JSON.stringify(value))
const uid = prefix => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

const PRESET_LIBRARY_IDS = new Set(['squat', 'rdl', 'hip_thrust', 'bench', 'core'].concat((trainingApi.EXERCISE_LIBRARY || []).map((item) => item.id)))
const WEEKDAYS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' }
]
const MONTH_DAYS = []
for (let day = 1; day <= 31; day++) MONTH_DAYS.push(day)
const BASIS_OPTIONS = [
  { key: 'total', label: '总重量' },
  { key: 'per_side', label: '单侧' },
  { key: 'bodyweight', label: '自重' }
]

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function pick(obj, camel, snake, fallback) {
  if (!obj) return fallback
  if (obj[camel] != null && obj[camel] !== '') return obj[camel]
  if (snake && obj[snake] != null && obj[snake] !== '') return obj[snake]
  return fallback
}

function titleHistory(plans) {
  const seen = new Set()
  const names = []
  ;(plans || []).forEach((plan) => {
    ;[plan.published && plan.published.title, plan.latest_draft && plan.latest_draft.title].forEach((title) => {
      const name = String(title || '').trim()
      if (!name || seen.has(name)) return
      seen.add(name)
      names.push(name)
    })
  })
  return names.slice(0, 8)
}

function titleChipState(title, presets, titleCustom) {
  const list = presets || []
  const inPreset = list.indexOf(title) >= 0
  const custom = !!(titleCustom || !list.length || (title && !inPreset))
  return {
    titlePresets: list,
    titleCustom: custom,
    titleChips: list.map((label) => ({ label, on: !custom && title === label })).concat([{ label: '自定义', on: custom }])
  }
}

function scheduleFromContent(content) {
  const type = pick(content, 'scheduleType', 'schedule_type', 'once') || 'once'
  const plannedDate = pick(content, 'plannedDate', 'planned_date', '') || ''
  const scheduleEnd = pick(content, 'scheduleEnd', 'schedule_end', '') || ''
  const weekdays = (pick(content, 'weekdays', 'weekdays', []) || []).slice()
  const monthDays = (pick(content, 'monthDays', 'month_days', []) || []).slice()
  if (type === 'permanent') {
    return { scheduleType: 'permanent', scheduleMode: 'permanent', repeatKind: 'weekly', plannedDate: '', scheduleEnd: '', weekdays: [], monthDays: [] }
  }
  if (type === 'weekly') {
    return { scheduleType: 'weekly', scheduleMode: 'repeat', repeatKind: 'weekly', plannedDate: '', scheduleEnd: '', weekdays, monthDays: [] }
  }
  if (type === 'monthly') {
    return { scheduleType: 'monthly', scheduleMode: 'repeat', repeatKind: 'monthly', plannedDate: '', scheduleEnd: '', weekdays: [], monthDays }
  }
  if (type === 'range') {
    return { scheduleType: 'range', scheduleMode: 'range', repeatKind: 'weekly', plannedDate, scheduleEnd: scheduleEnd || plannedDate, weekdays: [], monthDays: [] }
  }
  return { scheduleType: 'once', scheduleMode: 'range', repeatKind: 'weekly', plannedDate, scheduleEnd: plannedDate, weekdays: [], monthDays: [] }
}

function scheduleChips(schedule) {
  const weekdays = schedule.weekdays || []
  const monthDays = schedule.monthDays || []
  return {
    scheduleTypeChips: [
      { key: 'permanent', label: '永久', on: schedule.scheduleMode === 'permanent' },
      { key: 'range', label: '长期', on: schedule.scheduleMode === 'range' },
      { key: 'repeat', label: '固定时间', on: schedule.scheduleMode === 'repeat' }
    ],
    repeatKindChips: [
      { key: 'weekly', label: '每周', on: schedule.repeatKind === 'weekly' },
      { key: 'monthly', label: '每月', on: schedule.repeatKind === 'monthly' }
    ],
    weekChips: WEEKDAYS.map((item) => Object.assign({}, item, { on: weekdays.indexOf(item.value) >= 0 })),
    monthChips: MONTH_DAYS.map((day) => ({ value: day, on: monthDays.indexOf(day) >= 0 }))
  }
}

function summarize(ex) {
  const sets = ex.sets || []
  const first = sets[0] || {}
  const same = sets.every((set) => set.targetWeight === first.targetWeight && set.targetReps === first.targetReps)
  const weight = first.targetWeight == null || first.targetWeight === '' ? '重量待设' : first.targetWeight + ' kg'
  const reps = first.targetReps == null || first.targetReps === '' ? '次数待设' : first.targetReps + ' 次'
  return sets.length + ' 组 · ' + (same ? weight + ' × ' + reps : '每组不同')
}

function decorateExercises(list) {
  return (list || []).map((ex, index) => Object.assign({}, ex, {
    indexLabel: index + 1,
    summary: summarize(ex),
    basisOptions: BASIS_OPTIONS.map((item) => Object.assign({}, item, { on: ex.loadBasis === item.key })),
    sets: (ex.sets || []).map((set) => Object.assign({}, set, {
      offset: set.offset || 0,
      swiping: !!set.swiping
    }))
  }))
}

function isCatalogExercise(ex) {
  const id = ex && (ex.exerciseId || ex.exercise_id || ex.id)
  return !!(id && typeof id === 'string' && !PRESET_LIBRARY_IDS.has(id))
}

function frequentFromUsage(sessions, plans) {
  const ranked = []
  const seen = new Set()
  function consider(ex) {
    const id = ex && (ex.exerciseId || ex.exercise_id)
    if (!id || PRESET_LIBRARY_IDS.has(id) || seen.has(id) || !isCatalogExercise(ex)) return
    seen.add(id)
    ranked.push({
      id,
      name: ex.nameSnapshot || ex.name,
      icon: ex.icon || '🏋️',
      loadBasis: ex.loadBasis,
      metricType: ex.loadBasis === 'bodyweight' ? 'reps' : 'weight_reps',
      equipment: ex.equipment
    })
  }
  ;(sessions || []).forEach((session) => { ;(session.exercises || []).forEach(consider) })
  ;(plans || []).forEach((plan) => {
    const content = plan.published || plan.latest_draft || {}
    ;(content.exercises || []).forEach(consider)
  })
  return ranked.slice(0, 5)
}

function isBodyweight(item) {
  if (!item) return false
  if (item.loadBasis === 'bodyweight' || item.metricType === 'reps') return true
  const equipment = String(item.equipment || item.equipmentLabel || '').toLowerCase()
  if (['body only', 'none', 'bodyweight', '自重', '徒手'].indexOf(equipment) >= 0) return true
  return String(item.name || '').indexOf('自重') >= 0
}

function toPlanExercise(item) {
  const bodyweight = isBodyweight(item)
  const setCount = Math.min(30, Math.max(1, Number(item.defaultSets) || 3))
  const reps = item.defaultReps != null ? item.defaultReps : 10
  const weight = bodyweight ? 0 : (item.defaultWeight != null ? item.defaultWeight : null)
  const sets = []
  for (let i = 0; i < setCount; i++) {
    sets.push({ id: uid('pset_'), setNo: i + 1, targetWeight: weight, targetReps: reps, required: true, offset: 0, swiping: false })
  }
  return {
    id: uid('pex_'),
    exerciseId: item.id || item.exerciseId || null,
    name: item.name,
    icon: item.icon || '🏋️',
    loadBasis: bodyweight ? 'bodyweight' : (item.loadBasis && item.loadBasis !== 'unknown' ? item.loadBasis : 'total'),
    sets
  }
}

Page({
  data: {
    plan: null, draft: null, loading: true, error: '', saving: false, changed: false, conflict: false,
    title: '', goal: '', plannedDate: '', scheduleEnd: '', reason: '', exercises: [], missingNotesText: '', today: '',
    scheduleType: 'permanent', scheduleMode: 'permanent', repeatKind: 'weekly', weekdays: [], monthDays: [],
    bases: ['总重量（含杆）', '单侧重量', '自重', '待确认'],
    library: trainingApi.EXERCISE_LIBRARY,
    frequent: [],
    titleChips: [],
    titleCustom: true,
    titlePresets: [],
    scheduleTypeChips: [],
    repeatKindChips: [],
    weekChips: [],
    monthChips: []
  },
  onLoad(q) {
    this.planId = q.id
    const windowWidth = ((typeof wx.getSystemInfoSync === 'function' && wx.getSystemInfoSync()) || {}).windowWidth || 375
    this._setActionWidth = Math.round((96 / 750) * windowWidth)
    this.setData({ sheetIndex: -1, reduced: interaction.reducedMotion(), dragIndex: -1, dragOffset: 0, saveError: '' })
  },
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
    const exercises = clone(this.data.exercises).map((ex) => {
      const copy = Object.assign({}, ex)
      delete copy.indexLabel
      delete copy.summary
      delete copy.basisOptions
      copy.sets = (copy.sets || []).map((set) => {
        const row = Object.assign({}, set)
        delete row.offset
        delete row.swiping
        return row
      })
      return copy
    })
    return {
      title: this.data.title,
      goal: this.data.goal || '',
      plannedDate: this.data.plannedDate || null,
      scheduleEnd: this.data.scheduleEnd || null,
      scheduleType: this.data.scheduleType || 'permanent',
      weekdays: this.data.weekdays || [],
      monthDays: this.data.monthDays || [],
      reason: this.data.reason || '',
      exercises,
      version: this.data.draft ? this.data.draft.version : this.data.plan.current_published_revision,
      base_revision: this.data.draft ? this.data.draft.revision : null
    }
  },
  scheduleView(content) {
    const schedule = scheduleFromContent(content || {})
    return Object.assign({}, schedule, scheduleChips(schedule))
  },
  titleView(title, titleCustom) {
    return titleChipState(title, this._titlePresets || this.data.titlePresets || [], titleCustom)
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
        this.setData(Object.assign({
          title: local.title, goal: local.goal || '', reason: local.reason || '',
          exercises: decorateExercises(local.exercises), changed: true, conflict
        }, this.scheduleView(local), this.titleView(local.title, local.titleCustom)))
        getApp().toast(conflict ? '云端已更新，本地内容保留，请核对后重新载入' : '已恢复本地未保存内容')
      }
    }).catch(err => this.setData({ error: err.message || '计划读取失败，请重试' }))
      .then(() => this.setData({ loading: false }))
  },
  applyPlan(plan) {
    this._owner = getApp().globalData.session.user.userId + ':' + getApp().globalData.role
    const draft = plan.latest_draft, content = draft || plan.published || {}
    const title = content.title || ''
    this.setData(Object.assign({
      plan, draft, title, goal: '', reason: '',
      today: todayKey(),
      exercises: decorateExercises(content.exercises || []), changed: false, conflict: false,
      missingNotesText: ((draft && draft.missing_notes) || []).join('；')
    }, this.scheduleView(content), this.titleView(title)))
    this.loadTitles()
    this.loadFrequent()
  },
  loadTitles() {
    const studentId = this.data.plan && this.data.plan.student_id
    if (!studentId || typeof trainingApi.listPlansForStudent !== 'function') {
      this.setData(this.titleView(this.data.title))
      return
    }
    trainingApi.listPlansForStudent(getApp(), studentId)
      .then((res) => {
        this._titlePresets = titleHistory(res.data || [])
        this.setData(this.titleView(this.data.title))
      })
      .catch(() => this.setData(this.titleView(this.data.title)))
  },
  loadFrequent() {
    const studentId = this.data.plan && this.data.plan.student_id
    const seq = this._frequentSeq = (this._frequentSeq || 0) + 1
    if (!studentId) {
      this.setData({ frequent: [] })
      return Promise.resolve()
    }
    const sessionsP = typeof trainingApi.listSessions === 'function'
      ? trainingApi.listSessions(getApp(), { studentId, status: 'completed' }).catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] })
    const plansP = typeof trainingApi.listPlansForStudent === 'function'
      ? trainingApi.listPlansForStudent(getApp(), studentId).catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] })
    return Promise.all([sessionsP, plansP]).then(([sessions, plans]) => {
      if (seq !== this._frequentSeq) return
      this.setData({ frequent: frequentFromUsage(sessions.data || [], plans.data || []) })
    }).catch(() => {
      if (seq !== this._frequentSeq) return
      this.setData({ frequent: [] })
    })
  },
  editable() { return this.data.plan && this.data.plan.can_edit && this.data.draft && !this.data.saving && !this.data.conflict },
  change(values) {
    if (!this.editable()) return
    const next = Object.assign({}, values)
    if (next.exercises) next.exercises = decorateExercises(next.exercises)
    const title = next.title != null ? next.title : this.data.title
    const titleCustom = next.titleCustom != null ? next.titleCustom : this.data.titleCustom
    Object.assign(next, this.titleView(title, titleCustom))
    const schedule = {
      scheduleType: next.scheduleType != null ? next.scheduleType : this.data.scheduleType,
      scheduleMode: next.scheduleMode != null ? next.scheduleMode : this.data.scheduleMode,
      repeatKind: next.repeatKind != null ? next.repeatKind : this.data.repeatKind,
      plannedDate: next.plannedDate != null ? next.plannedDate : this.data.plannedDate,
      scheduleEnd: next.scheduleEnd != null ? next.scheduleEnd : this.data.scheduleEnd,
      weekdays: next.weekdays != null ? next.weekdays : this.data.weekdays,
      monthDays: next.monthDays != null ? next.monthDays : this.data.monthDays
    }
    Object.assign(next, scheduleChips(schedule))
    this.setData(Object.assign({ changed: true, saveError: '' }, next)); this.cache()
    if (typeof wx.enableAlertBeforeUnload === 'function') wx.enableAlertBeforeUnload({ message: '训练计划有未保存修改，已暂存在本机。', fail() {} })
  },
  onMotion(e) { interaction.setReducedMotion(e.detail.value); this.setData({ reduced: !!e.detail.value }) },
  onPickTitle(e) {
    const label = e.currentTarget.dataset.label
    if (!label) return
    if (label === '自定义') return this.change({ titleCustom: true })
    this.change({ title: label, titleCustom: false })
  },
  onScheduleMode(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'permanent') return this.change({ scheduleType: 'permanent', scheduleMode: 'permanent', plannedDate: '', scheduleEnd: '', weekdays: [], monthDays: [] })
    if (key === 'range') {
      const start = this.data.plannedDate || todayKey()
      return this.change({ scheduleType: 'range', scheduleMode: 'range', plannedDate: start, scheduleEnd: this.data.scheduleEnd || start, weekdays: [], monthDays: [] })
    }
    if (key === 'repeat') {
      const kind = this.data.repeatKind === 'monthly' ? 'monthly' : 'weekly'
      return this.change({ scheduleType: kind, scheduleMode: 'repeat', plannedDate: '', scheduleEnd: '' })
    }
  },
  onRepeatKind(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'weekly') return this.change({ repeatKind: 'weekly', scheduleType: 'weekly', scheduleMode: 'repeat' })
    if (key === 'monthly') return this.change({ repeatKind: 'monthly', scheduleType: 'monthly', scheduleMode: 'repeat' })
  },
  onToggleWeekday(e) {
    const value = Number(e.currentTarget.dataset.value)
    const weekdays = (this.data.weekdays || []).slice()
    const index = weekdays.indexOf(value)
    if (index >= 0) weekdays.splice(index, 1)
    else weekdays.push(value)
    this.change({ weekdays, scheduleType: 'weekly', scheduleMode: 'repeat', repeatKind: 'weekly' })
  },
  onToggleMonthDay(e) {
    const value = Number(e.currentTarget.dataset.value)
    const monthDays = (this.data.monthDays || []).slice()
    const index = monthDays.indexOf(value)
    if (index >= 0) monthDays.splice(index, 1)
    else monthDays.push(value)
    this.change({ monthDays, scheduleType: 'monthly', scheduleMode: 'repeat', repeatKind: 'monthly' })
  },
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
    const first = next[0] || {}
    while (next.length < count) {
      next.push({
        id: uid('pset_'),
        setNo: next.length + 1,
        targetWeight: first.targetWeight == null ? null : first.targetWeight,
        targetReps: first.targetReps == null ? null : first.targetReps,
        required: true,
        offset: 0,
        swiping: false
      })
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
  onField(e) {
    const key = e.currentTarget.dataset.field
    if (['title', 'plannedDate', 'scheduleEnd'].includes(key)) this.change({ [key]: e.detail.value })
  },
  onSet(e) {
    if (!this.editable()) return
    const { ei, si, field } = e.currentTarget.dataset
    if (!['targetWeight', 'targetReps'].includes(field)) return
    const exercises = clone(this.data.exercises)
    const sets = exercises[Number(ei)].sets
    const index = Number(si)
    const previous = sets[0] ? sets[0][field] : null
    sets[index][field] = e.detail.value
    if (index === 0) {
      sets.slice(1).forEach((set) => {
        if (set[field] == null || set[field] === '' || set[field] === previous) set[field] = e.detail.value
      })
    }
    this.change({ exercises })
  },
  onName(e) { const exercises = clone(this.data.exercises); exercises[Number(e.currentTarget.dataset.ei)].name = e.detail.value; this.change({ exercises }) },
  onBasis(e) {
    const exercises = clone(this.data.exercises)
    const ei = Number(e.currentTarget.dataset.ei)
    const basis = e.currentTarget.dataset.basis || ['total', 'per_side', 'bodyweight', 'unknown'][Number(e.detail && e.detail.value)]
    if (!basis || !exercises[ei]) return
    exercises[ei].loadBasis = basis
    this.change({ exercises })
  },
  addLibraryExercises(items) {
    if (!this.editable() || !items || !items.length) return
    const exercises = clone(this.data.exercises).concat(items.map(toPlanExercise))
    this.change({ exercises })
    getApp().toast('已加入 ' + items.length + ' 个动作')
  },
  onAddExercise(e) {
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.frequent && this.data.frequent[index]
    if (!item) return
    this.addLibraryExercises([item])
  },
  onMoreExercises() {
    if (!this.editable()) return
    const self = this
    wx.navigateTo({
      url: '/pages/exercises/index?pick=1',
      events: {
        selectExercises(list) { self.addLibraryExercises(list) }
      }
    })
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
    const first = sets[0] || {}
    sets.push({
      id: uid('pset_'),
      setNo: sets.length + 1,
      targetWeight: first.targetWeight == null ? null : first.targetWeight,
      targetReps: first.targetReps == null ? null : first.targetReps,
      required: true,
      offset: 0,
      swiping: false
    })
    this.change({ exercises })
  },
  setActionWidth() {
    return this._setActionWidth || 48
  },
  closeOtherSetSwipes(keepIndex) {
    const ei = this.data.sheetIndex
    if (ei < 0 || !this.data.exercises[ei]) return
    const sets = this.data.exercises[ei].sets || []
    sets.forEach((set, index) => {
      if (index === keepIndex || !set.offset) return
      this.setData({
        ['exercises[' + ei + '].sets[' + index + '].offset']: 0,
        ['exercises[' + ei + '].sets[' + index + '].swiping']: false
      })
    })
  },
  onSetSwipeStart(e) {
    if (!Number(e.currentTarget.dataset.canDelete)) return
    const si = Number(e.currentTarget.dataset.si)
    const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0])
    if (!touch) return
    this.closeOtherSetSwipes(si)
    const current = ((this.data.exercises[this.data.sheetIndex] || {}).sets || [])[si] || {}
    this._setSwipe = {
      si,
      startX: touch.clientX,
      startY: touch.clientY,
      startOffset: current.offset || 0,
      axis: null
    }
  },
  onSetSwipeMove(e) {
    const swipe = this._setSwipe
    if (!swipe) return
    const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0])
    if (!touch) return
    const dx = touch.clientX - swipe.startX
    const dy = touch.clientY - swipe.startY
    if (!swipe.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      swipe.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }
    if (swipe.axis !== 'x') return
    const max = this.setActionWidth()
    let offset = swipe.startOffset + dx
    if (offset > 0) offset = 0
    if (offset < -max) offset = -max
    const ei = this.data.sheetIndex
    this.setData({
      ['exercises[' + ei + '].sets[' + swipe.si + '].offset']: offset,
      ['exercises[' + ei + '].sets[' + swipe.si + '].swiping']: true
    })
  },
  onSetSwipeEnd() {
    const swipe = this._setSwipe
    this._setSwipe = null
    if (!swipe || swipe.axis !== 'x') return
    const ei = this.data.sheetIndex
    const current = ((this.data.exercises[ei] || {}).sets || [])[swipe.si]
    if (!current) return
    const max = this.setActionWidth()
    const open = (current.offset || 0) < -max / 2
    this.setData({
      ['exercises[' + ei + '].sets[' + swipe.si + '].offset']: open ? -max : 0,
      ['exercises[' + ei + '].sets[' + swipe.si + '].swiping']: false
    })
  },
  onRemoveSet(e) {
    const exercises = clone(this.data.exercises), ex = exercises[Number(e.currentTarget.dataset.ei)]
    if (!ex || ex.sets.length <= 1) return getApp().toast('至少保留一组，或移除整个动作')
    ex.sets.splice(Number(e.currentTarget.dataset.si), 1)
    ex.sets.forEach((set, index) => { set.setNo = index + 1; set.offset = 0; set.swiping = false })
    this.change({ exercises })
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
