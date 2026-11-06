const { syncRoleBar } = require('../../utils/role')
const { requireLogin } = require('../../utils/guard')
const trainingApi = require('../../services/trainingApi')
const interaction = require('../../utils/interaction')
const time = require('../../utils/time')

const REST_SECONDS = 90

function formatTarget(set) {
  const weight = set.targetWeight != null ? set.targetWeight + 'kg' : '—'
  const reps = set.targetReps != null ? set.targetReps + '次' : '—'
  return weight + ' × ' + reps
}

function formatWeight(value) {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10)
}

function loadBasisLabel(basis) {
  if (basis === 'total') return '总重量'
  if (basis === 'per_side') return '单侧重量'
  if (basis === 'bodyweight') return '自重'
  return '计划动作'
}

function restClock(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
}

function exerciseProgress(ex) {
  const sets = ex.sets || []
  const done = sets.filter((s) => s.state === 'done' || s.state === 'skipped').length
  return { done, total: sets.length, complete: sets.length > 0 && done >= sets.length }
}

function firstPendingSet(ex) {
  return (ex.sets || []).find((s) => s.state !== 'done' && s.state !== 'skipped') || null
}

function baselineOf(ex) {
  const set = (ex.sets || [])[0] || {}
  return {
    weight: set.targetWeight,
    reps: set.targetReps,
    label: formatTarget(set)
  }
}

Page({
  data: {
    role: 'student',
    plans: [],
    hasPublishedPlans: false,
    session: null,
    phase: 'picker',
    finishing: false,
    savingSet: false,
    activeSid: '',
    activeGroup: null,
    focusView: null,
    nextHint: null,
    wheelItems: [],
    selectedIndex: 0,
    selectedCard: null,
    planDots: [],
    exerciseDone: null,
    pending: {},
    lockedExerciseId: '',
    saveError: '',
    loadError: '',
    loading: false,
    reduced: false,
    justCompleted: false,
    restVisible: false,
    restSeconds: REST_SECONDS,
    restText: restClock(REST_SECONDS)
  },

  onShow() {
    if (!requireLogin(this)) return
    syncRoleBar(this)
    this.setData({ reduced: interaction.reducedMotion() })
    this.reload()
  },
  onHide() { this.cacheDraft(); this.closeRest(true) },
  onUnload() {
    this.cacheDraft()
    this.closeRest(true)
    this._unloaded = true
    this._reloadGeneration = (this._reloadGeneration || 0) + 1
  },
  noop() {},

  draftKey(session) {
    return [this.studentId(), getApp().globalData.role, 'workout-v2', session.session_id].join(':')
  },
  cacheDraft() {
    if (!this.data.session) return
    if (this._sessionOwner && this._sessionOwner !== this.studentId() + ':' + getApp().globalData.role) return
    const app = getApp()
    const drafts = app.globalData.drafts || {}
    drafts[this.draftKey(this.data.session)] = {
      userId: this.studentId(),
      payload: this.data.pending,
      lockedExerciseId: this.data.lockedExerciseId || '',
      phase: this.data.phase,
      selectedIndex: this.data.selectedIndex,
      updatedAt: Date.now()
    }
    app.globalData.drafts = drafts
    try { app.persist() } catch (_) { this.setData({ saveError: '本机暂存失败，请保持页面打开并保存至服务器' }) }
  },

  applySession(session, restore) {
    this._sessionOwner = this.studentId() + ':' + getApp().globalData.role
    const cached = (getApp().globalData.drafts || {})[this.draftKey(session)]
    const pending = restore ? ((cached && cached.payload) || {}) : this.data.pending
    session.exercises.forEach((ex) => ex.sets.forEach((set) => {
      if (pending[set.id]) Object.assign(set, pending[set.id])
    }))

    let lockedExerciseId = restore ? ((cached && cached.lockedExerciseId) || '') : this.data.lockedExerciseId
    let phase = restore ? ((cached && cached.phase) || '') : this.data.phase
    let selectedIndex = restore && cached && Number.isInteger(cached.selectedIndex) ? cached.selectedIndex : this.data.selectedIndex

    if (lockedExerciseId) {
      const locked = session.exercises.find((ex) => ex.id === lockedExerciseId)
      if (!locked || exerciseProgress(locked).complete) {
        lockedExerciseId = ''
        phase = 'picker'
      } else {
        phase = 'locked'
      }
    }

    if (!lockedExerciseId) {
      const partial = session.exercises.find((ex) => {
        const p = exerciseProgress(ex)
        return p.done > 0 && !p.complete
      })
      if (partial) {
        lockedExerciseId = partial.id
        phase = 'locked'
      } else {
        phase = 'picker'
      }
    }

    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= session.exercises.length) {
      selectedIndex = Math.max(0, session.exercises.findIndex((ex) => !exerciseProgress(ex).complete))
      if (selectedIndex < 0) selectedIndex = 0
    }

    this.setData({ session, pending, lockedExerciseId, phase: phase === 'exerciseDone' ? 'picker' : phase, selectedIndex, exerciseDone: null })
    this.refreshWheel(selectedIndex)

    if (phase === 'locked' && lockedExerciseId) {
      const locked = session.exercises.find((ex) => ex.id === lockedExerciseId)
      const pendingSet = firstPendingSet(locked) || (locked.sets && locked.sets[locked.sets.length - 1])
      this.selectActive(pendingSet ? pendingSet.id : '', lockedExerciseId)
    } else {
      this.selectActive('', '')
    }
  },

  refreshWheel(selectedIndex) {
    const session = this.data.session
    if (!session) {
      this.setData({ wheelItems: [], selectedCard: null, planDots: [] })
      return
    }
    const exercises = session.exercises || []
    const n = exercises.length
    const selected = Math.max(0, Math.min(selectedIndex, Math.max(0, n - 1)))
    const wheelItems = exercises.map((ex, i) => {
      let d = i - selected
      if (n > 0) {
        if (d > n / 2) d -= n
        if (d < -n / 2) d += n
      }
      const progress = exerciseProgress(ex)
      const baseline = baselineOf(ex)
      const abs = Math.abs(d)
      return {
        id: ex.id,
        name: ex.name,
        icon: ex.icon || '🏋️',
        exerciseId: ex.exerciseId || '',
        meta: loadBasisLabel(ex.loadBasis) + ' · ' + progress.total + '组',
        muscle: loadBasisLabel(ex.loadBasis),
        complete: progress.complete,
        done: progress.done,
        total: progress.total,
        baselineLabel: baseline.label,
        selected: d === 0,
        style:
          'transform:translate3d(' +
          d * 94 +
          'px,' +
          (abs * 16 + (d === 0 ? 0 : 10)) +
          'px,0) scale(' +
          (d === 0 ? 1.22 : abs === 1 ? 0.88 : 0.64) +
          ') rotate(' +
          d * 8 +
          'deg);opacity:' +
          (d === 0 ? 1 : abs === 1 ? 0.78 : 0.38) +
          ';z-index:' +
          (20 - abs) +
          ';'
      }
    })
    const selectedCard = wheelItems[selected] || null
    const planDots = exercises.map((_, i) => ({ active: i === selected }))
    this.setData({ selectedIndex: selected, wheelItems, selectedCard, planDots })
  },

  buildFocusView(session, activeSid, lockedExerciseId) {
    if (!session || !lockedExerciseId) {
      return { activeGroup: null, focusView: null, nextHint: null }
    }
    const exercise = session.exercises.find((ex) => ex.id === lockedExerciseId)
    if (!exercise) return { activeGroup: null, focusView: null, nextHint: null }

    const sets = exercise.sets || []
    const current = sets.find((s) => s.id === activeSid) || firstPendingSet(exercise) || sets[sets.length - 1]
    if (!current) return { activeGroup: null, focusView: null, nextHint: null }

    const progress = exerciseProgress(exercise)
    const baseline = baselineOf(exercise)
    const doneCount = sets.filter((s) => s.state === 'done').length
    const exerciseOrder = session.exercises.findIndex((ex) => ex.id === lockedExerciseId) + 1
    const activeGroup = Object.assign({ exerciseName: exercise.name }, current)
    const focusView = {
      exerciseId: exercise.exerciseId || '',
      exerciseName: exercise.name,
      icon: exercise.icon || '🏋️',
      muscle: loadBasisLabel(exercise.loadBasis),
      exerciseOrder,
      exerciseTotal: session.exercises.length,
      setId: current.id,
      setNo: current.setNo,
      setTotal: sets.length,
      doneInExercise: doneCount,
      progressPercent: sets.length ? Math.round((doneCount / sets.length) * 100) : 0,
      state: current.state,
      baselineLabel: baseline.label,
      targetLabel: formatTarget(current),
      actualWeight: current.actualWeight,
      actualReps: current.actualReps,
      weightText: formatWeight(current.actualWeight),
      repsText: current.actualReps == null || current.actualReps === '' ? '—' : String(current.actualReps),
      pendingLocal: !!this.data.pending[current.id]
    }

    const currentIndex = sets.findIndex((s) => s.id === current.id)
    const nextSet = sets.slice(currentIndex + 1).find((s) => s.state !== 'done' && s.state !== 'skipped')
    let nextHint = null
    if (nextSet) {
      nextHint = {
        title: '下一组：' + exercise.name,
        line: '目标 ' + formatTarget(nextSet) + ' · 完成后休息 90 秒'
      }
    } else if (!progress.complete) {
      nextHint = {
        title: '本动作即将完成',
        line: '完成后进入动作完成反馈'
      }
    } else {
      nextHint = {
        title: '本动作已完成',
        line: '可返回选择下一个动作'
      }
    }
    return { activeGroup, focusView, nextHint }
  },

  selectActive(sid, lockedExerciseId) {
    const locked = lockedExerciseId != null ? lockedExerciseId : this.data.lockedExerciseId
    const view = this.buildFocusView(this.data.session, sid, locked)
    this.setData({
      activeSid: view.activeGroup ? (sid || view.focusView.setId) : '',
      activeGroup: view.activeGroup,
      focusView: view.focusView,
      nextHint: view.nextHint
    })
  },

  onMotion(e) {
    interaction.setReducedMotion(e.detail.value)
    this.setData({ reduced: !!e.detail.value })
  },

  onWheelTouchStart(e) {
    if (this.data.phase !== 'picker' || this.data.reduced) return
    const t = e.changedTouches[0] || e.touches[0]
    this._wheelStartX = t ? t.clientX : null
  },
  onWheelTouchEnd(e) {
    if (this.data.phase !== 'picker' || this._wheelStartX == null) return
    const t = e.changedTouches[0] || e.touches[0]
    const dx = t ? t.clientX - this._wheelStartX : 0
    this._wheelStartX = null
    if (Math.abs(dx) < 28) return
    this.cycleWheel(dx < 0 ? 1 : -1)
  },
  cycleWheel(dir) {
    const n = (this.data.session && this.data.session.exercises.length) || 0
    if (!n) return
    const next = (this.data.selectedIndex + dir + n) % n
    this.refreshWheel(next)
    interaction.feedback()
  },
  onPickWheelCard(e) {
    if (this.data.phase !== 'picker') return
    const index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index)) return
    this.refreshWheel(index)
    interaction.feedback()
  },

  onStartSelectedExercise() {
    if (!this.data.session || this.data.phase !== 'picker') return
    const card = this.data.selectedCard
    if (!card) return
    if (card.complete) {
      getApp().toast('该动作已完成，可选择其他动作')
      return
    }
    const exercise = this.data.session.exercises.find((ex) => ex.id === card.id)
    const pendingSet = firstPendingSet(exercise)
    if (!pendingSet) {
      getApp().toast('该动作没有待完成组')
      return
    }
    this.setData({
      phase: 'locked',
      lockedExerciseId: card.id,
      justCompleted: false,
      exerciseDone: null
    })
    this.selectActive(pendingSet.id, card.id)
    this.cacheDraft()
    getApp().toast('动作已锁定 · 专注这一项')
    interaction.feedback()
  },

  onBackToPicker() {
    if (this.data.restVisible || this._writeBusy || this.data.finishing) return
    this.closeRest(true)
    this.setData({
      phase: 'picker',
      lockedExerciseId: '',
      justCompleted: false,
      exerciseDone: null,
      focusView: null,
      activeSid: '',
      activeGroup: null,
      nextHint: null
    })
    const incomplete = (this.data.session.exercises || []).findIndex((ex) => !exerciseProgress(ex).complete)
    this.refreshWheel(incomplete >= 0 ? incomplete : this.data.selectedIndex)
    this.cacheDraft()
  },

  onChooseNextExercise() {
    this.setData({ exerciseDone: null, phase: 'picker', lockedExerciseId: '', focusView: null, activeSid: '', activeGroup: null, nextHint: null })
    const exercises = this.data.session.exercises || []
    let next = (this.data.selectedIndex + 1) % Math.max(exercises.length, 1)
    for (let i = 0; i < exercises.length; i++) {
      const idx = (this.data.selectedIndex + 1 + i) % exercises.length
      if (!exerciseProgress(exercises[idx]).complete) {
        next = idx
        break
      }
    }
    this.refreshWheel(next)
    this.cacheDraft()
    getApp().toast('可以选择下一个动作了')
  },

  onCopyPrevious() {
    if (this._writeBusy || this.data.finishing || !this.data.focusView) return
    const sid = this.data.focusView.setId
    const locked = this.data.session.exercises.find((ex) => ex.id === this.data.lockedExerciseId)
    if (!locked) return
    const index = locked.sets.findIndex((set) => set.id === sid)
    if (index < 1) return getApp().toast('这是第一个训练组')
    const previous = locked.sets[index - 1]
    for (const field of ['actualWeight', 'actualReps']) {
      this.onSetField({
        currentTarget: { dataset: { sid, field } },
        detail: { value: previous[field] == null ? '' : previous[field] }
      })
    }
    interaction.feedback()
  },

  onStepValue(e) {
    if (this._writeBusy || this.data.finishing || !this.data.focusView) return
    const field = e.currentTarget.dataset.field
    const delta = Number(e.currentTarget.dataset.delta)
    const sid = this.data.focusView.setId
    const current = field === 'actualWeight' ? this.data.focusView.actualWeight : this.data.focusView.actualReps
    const base = current == null || current === ''
      ? (field === 'actualWeight' ? 0 : 1)
      : Number(current)
    if (!Number.isFinite(base)) return
    let next = base + delta
    if (field === 'actualWeight') next = Math.max(0, Math.round(next * 10) / 10)
    else next = Math.max(1, Math.round(next))
    this.onSetField({ currentTarget: { dataset: { sid, field } }, detail: { value: next } })
    getApp().toast('仅临时调整本组')
    interaction.feedback()
  },

  studentId() {
    return getApp().globalData.session.user.userId
  },

  openRest() {
    if (this.data.reduced) return
    clearInterval(this._restTimer)
    let seconds = REST_SECONDS
    this.setData({ restVisible: true, restSeconds: seconds, restText: restClock(seconds) })
    this._restTimer = setInterval(() => {
      if (this._unloaded) {
        clearInterval(this._restTimer)
        return
      }
      seconds -= 1
      if (seconds <= 0) {
        this.closeRest()
        return
      }
      this.setData({ restSeconds: seconds, restText: restClock(seconds) })
    }, 1000)
  },
  closeRest(silent) {
    clearInterval(this._restTimer)
    this._restTimer = null
    if (!this.data.restVisible && silent === true) return
    this.setData({
      restVisible: false,
      justCompleted: false,
      restSeconds: REST_SECONDS,
      restText: restClock(REST_SECONDS)
    })
  },

  reload() {
    if (this._writeBusy || this.data.finishing) return Promise.resolve()
    this.closeRest(true)
    this.setData({ loading: true, loadError: '', justCompleted: false, exerciseDone: null })
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
        this.applySession(active, true)
        this.setData({ plans: [] })
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
        const plans = published.filter(
          (p) => p.published.planned_date === today && !doneIds[p.plan_id]
        )
        this.setData({
          session: null,
          phase: 'picker',
          focusView: null,
          nextHint: null,
          wheelItems: [],
          selectedCard: null,
          planDots: [],
          activeSid: '',
          activeGroup: null,
          lockedExerciseId: '',
          plans,
          hasPublishedPlans: published.length > 0
        })
      })
    }).catch((err) => {
      if (current()) this.setData({ loadError: err.message || '训练加载失败，请重试' })
    }).then(() => {
      if (current()) this.setData({ loading: false })
    })
  },

  goPlans() { wx.navigateTo({ url: '/pages/plans/index' }) },
  goExercises() { wx.navigateTo({ url: '/pages/exercises/index' }) },
  goDiary() { wx.navigateTo({ url: '/pages/diary/index' }) },
  goEditPlan() {
    const planId = this.data.session && this.data.session.plan_id
    if (!planId) {
      getApp().toast('当前训练没有关联计划')
      return
    }
    wx.navigateTo({ url: '/pages/plan-edit/index?id=' + planId })
  },
  goExerciseDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      getApp().toast('该动作暂无详情')
      return
    }
    wx.navigateTo({ url: '/pages/exercise-detail/index?id=' + id })
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
    }).then(() => this.reload()).catch((err) => app.toast(err.message || '模板创建失败')).then(() => { this._starting = false })
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
        this.applySession(res.data, true)
        delete this._startKeys[keyName]
        if (res.resumed) app.toast('已恢复未完成训练')
        else app.toast('先选一个动作开始')
      })
      .catch((err) => app.toast((err && err.message) || '无法开始'))
      .then(() => { this._starting = false })
  },

  onSetField(e) {
    if (this._writeBusy || this.data.finishing || !this.data.session || this.data.phase !== 'locked') return
    const setId = e.currentTarget.dataset.sid
    const field = e.currentTarget.dataset.field
    if (!['actualWeight', 'actualReps'].includes(field)) return
    const pending = Object.assign({}, this.data.pending)
    pending[setId] = Object.assign({}, pending[setId], { [field]: e.detail.value })
    const session = JSON.parse(JSON.stringify(this.data.session))
    const hit = session.exercises.reduce((all, ex) => all.concat(ex.sets), []).find((set) => set.id === setId)
    if (!hit) return
    hit[field] = e.detail.value
    this.setData({ session, pending, saveError: '', justCompleted: false })
    this.selectActive(this.data.activeSid, this.data.lockedExerciseId)
    this.cacheDraft()
  },

  async saveSet(setId, state) {
    const session = this.data.session
    const owner = this.studentId() + ':' + getApp().globalData.role
    const hit = session.exercises.reduce((all, ex) => all.concat(ex.sets), []).find((set) => set.id === setId)
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
    const pending = Object.assign({}, this.data.pending)
    delete pending[setId]
    const nextSession = JSON.parse(JSON.stringify(res.data))
    nextSession.exercises.forEach((ex) => ex.sets.forEach((set) => {
      if (pending[set.id]) Object.assign(set, pending[set.id])
    }))
    this.setData({ session: nextSession, pending })
    this.cacheDraft()
    return nextSession
  },

  showExerciseDone(exercise) {
    const baseline = baselineOf(exercise)
    const progress = exerciseProgress(exercise)
    this.setData({
      phase: 'exerciseDone',
      exerciseDone: {
        name: exercise.name,
        doneSets: progress.done,
        weight: baseline.weight == null ? '—' : baseline.weight,
        reps: baseline.reps == null ? '—' : baseline.reps
      },
      justCompleted: false
    })
    this.cacheDraft()
  },

  onSetState(e) {
    if (this._writeBusy || this.data.finishing || this._finishModal || this._abandonModal || this.data.restVisible) return Promise.resolve()
    if (this.data.phase !== 'locked') return Promise.resolve()
    this._writeBusy = true
    this.setData({ savingSet: true, saveError: '' })
    const setId = e.currentTarget.dataset.sid
    const state = e.currentTarget.dataset.state
    const lockedId = this.data.lockedExerciseId
    return this.saveSet(setId, state)
      .then((session) => {
        interaction.feedback()
        const exercise = session.exercises.find((ex) => ex.id === lockedId)
        if (!exercise) return
        if (state === 'done' || state === 'skipped') {
          if (exerciseProgress(exercise).complete) {
            this.setData({ lockedExerciseId: lockedId, phase: 'locked' })
            this.selectActive(setId, lockedId)
            getApp().toast('本组已记录')
            setTimeout(() => {
              if (!this._unloaded) this.showExerciseDone(exercise)
            }, this.data.reduced ? 0 : 300)
            return
          }
          const next = firstPendingSet(exercise)
          this.setData({ lockedExerciseId: lockedId, phase: 'locked' })
          this.selectActive(next ? next.id : setId, lockedId)
          if (state === 'done') {
            this.setData({ justCompleted: true })
            getApp().toast('本组已记录')
            if (next) setTimeout(() => { if (!this._unloaded) this.openRest() }, this.data.reduced ? 0 : 280)
          }
        }
      })
      .catch((err) => this.setData({ saveError: (err.message || '保存失败') + '；本地输入仍保留，请重试。' }))
      .then(() => {
        this._writeBusy = false
        this.setData({ savingSet: false })
      })
  },

  onFinish() {
    if (this.data.finishing || this._writeBusy || this._finishModal) return
    this.closeRest(true)
    const app = getApp()
    const session = this.data.session
    this._finishModal = true
    wx.showModal({
      title: '结束训练',
      content: '已完成 ' + session.done_sets + ' 组。未完成组将标为跳过。重复点击不会重复累计次数。',
      confirmText: '确认结束',
      success: (res) => {
        this._finishModal = false
        if (!res.confirm || this._writeBusy || this.data.finishing) return
        this.setData({ finishing: true })
        const completionKey = session.session_id + ':complete'
        this._writeBusy = true
        let flush = Promise.resolve()
        Object.keys(this.data.pending).forEach((sid) => { flush = flush.then(() => this.saveSet(sid)) })
        flush.then(() => trainingApi.finalizeSession(app, session.session_id, {
          completionKey,
          baseRevision: this.data.session.revision,
          share: false,
          actorRole: 'student'
        }))
          .then((resp) => {
            this._writeBusy = false
            const drafts = app.globalData.drafts || {}
            delete drafts[this.draftKey(session)]
            app.persist()
            this.setData({
              finishing: false,
              session: null,
              pending: {},
              focusView: null,
              nextHint: null,
              wheelItems: [],
              selectedCard: null,
              activeSid: '',
              activeGroup: null,
              lockedExerciseId: '',
              phase: 'picker',
              exerciseDone: null,
              justCompleted: false
            })
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
      },
      fail: () => { this._finishModal = false }
    })
  },

  onAbandon() {
    if (this._writeBusy || this.data.finishing || this._abandonModal) return
    this.closeRest(true)
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
            const drafts = app.globalData.drafts || {}
            delete drafts[this.draftKey(this.data.session)]
            app.persist()
            this._writeBusy = false
            this.setData({
              session: null,
              pending: {},
              savingSet: false,
              focusView: null,
              nextHint: null,
              wheelItems: [],
              selectedCard: null,
              activeSid: '',
              activeGroup: null,
              lockedExerciseId: '',
              phase: 'picker',
              exerciseDone: null,
              justCompleted: false
            })
            this.reload()
          })
          .catch((err) => {
            this._writeBusy = false
            this.setData({ savingSet: false, saveError: err.message || '放弃失败' })
          })
      },
      fail: () => { this._abandonModal = false }
    })
  }
})
