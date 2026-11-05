const { requireLogin } = require('../../utils/guard')
const diaryApi = require('../../services/diaryApi')
const time = require('../../utils/time')
const interaction = require('../../utils/interaction')

const MEAL_LABEL = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐'
}

/** 页面既有饮水参考目标（ml），非医学建议 */
const WATER_TARGET_ML = 2000

const SPECIAL_LABEL = {
  travel: '出差',
  overtime: '加班',
  period: '生理期',
  injury: '受伤/不适',
  other: '其他'
}

function macroKind(v) {
  if (v == null || v === '') return 'unknown'
  if (Number(v) === 0) return 'zero'
  return 'value'
}

function macroDisplay(v) {
  return v == null || v === '' ? '—' : String(v)
}

function presentMacros(macros) {
  const m = macros || {}
  return [
    { key: 'carbs', name: '碳水', value: macroDisplay(m.carbs), kind: macroKind(m.carbs) },
    { key: 'protein', name: '蛋白', value: macroDisplay(m.protein), kind: macroKind(m.protein) },
    { key: 'fat', name: '脂肪', value: macroDisplay(m.fat), kind: macroKind(m.fat) }
  ]
}

function hasMacroData(macros) {
  const m = macros || {}
  return m.carbs != null || m.protein != null || m.fat != null
}

Page({
  data: {
    dateList: [],
    localDate: '',
    reduced: false,
    waterTargetMl: WATER_TARGET_ML,
    view: {
      sessions: [],
      coachNotes: [],
      meals: [],
      shares: {},
      waterTotalMl: 0,
      restDay: false,
      canEdit: true
    },
    daySummary: {
      training: '暂无',
      meal: '暂无',
      water: '—',
      body: '未填',
      coach: '暂无'
    },
    mealTypes: diaryApi.MEAL_TYPES,
    specialTypes: diaryApi.SPECIAL_TYPES,
    fatigueOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    mealType: 'lunch',
    mealText: '',
    waterMl: '250',
    sleepHours: '',
    fatigue: '',
    soreness: '',
    specialType: '',
    specialNote: '',
    specialTypeLabel: '',
    waterPercent: 0,
    waterPulse: false,
    openPanel: 'coach',
    accordion: [],
    bodyDirty: false,
    specialDirty: false,
    bodySaveState: 'idle',
    bodySaveHint: '',
    specialSaveState: 'idle',
    specialSaveHint: '',
    waterSaveState: 'idle',
    waterSaveHint: '',
    mealSaveState: 'idle',
    mealSaveHint: '',
    loadError: ''
  },

  onLoad(query) {
    if (query && /^\d{4}-\d{2}-\d{2}$/.test(query.date || '')) {
      this.setData({ localDate: query.date })
    }
  },

  onJumpSection(e) {
    const section = e.currentTarget.dataset.section
    if (!['training', 'meals', 'water', 'state', 'sharing'].includes(section)) return
    wx.pageScrollTo({
      selector: '#diary-' + section,
      offsetTop: -56,
      duration: 0,
      fail: () => getApp().toast('请向下滑动查看对应记录')
    })
  },

  onShow() {
    if (!requireLogin(this)) return
    const today = time.todayKey()
    const keys = []
    for (let i = -6; i <= 0; i++) keys.push(time.addDays(today, i))
    this.setData({
      reduced: interaction.reducedMotion(),
      dateList: keys.map((k) => time.formatDateLabel(k)),
      localDate: this.data.localDate || today
    })
    this.reload({ resetPanel: !this._loadedOnce })
    this._loadedOnce = true
  },

  onMotion(e) {
    interaction.setReducedMotion(e.detail.value)
    this.setData({ reduced: !!e.detail.value })
  },

  studentId() {
    return getApp().globalData.session.user.userId
  },

  waterPercentOf(ml) {
    const n = Number(ml) || 0
    return Math.max(0, Math.min(100, Math.round((n / WATER_TARGET_ML) * 100)))
  },

  buildDaySummary(view) {
    const notes = view.coachNotes || []
    const meals = view.meals || []
    const sessions = view.sessions || []
    const body = view.bodyState || {}
    const hasBody =
      body.sleepHours != null || body.fatigue != null || !!(body.soreness || '').trim()
    const water = view.waterTotalMl || 0
    return {
      training: sessions.length ? sessions.length + ' 次' : '暂无',
      meal: meals.length ? meals.length + ' 餐' : '暂无',
      water: water > 0 ? water + ' ml' : '—',
      body: hasBody ? '已填' : '未填',
      coach: notes.length ? notes.length + ' 条' : '暂无'
    }
  },

  buildAccordion(view) {
    const notes = view.coachNotes || []
    const meals = view.meals || []
    const sessions = view.sessions || []
    const shares = view.shares || {}
    const body = view.bodyState || {}
    const hasBody =
      body.sleepHours != null || body.fatigue != null || !!(body.soreness || '').trim()
    const hasSpecial = !!(body.specialType || (body.specialNote || '').trim())
    const water = view.waterTotalMl || 0

    return [
      {
        id: 'coach',
        title: '教练课后点评',
        hint: notes.length ? notes.length + ' 条同步点评' : '暂无点评',
        badge: notes.length ? '有反馈' : '',
        icon: '✦',
        filled: !!notes.length
      },
      {
        id: 'meal',
        title: '饮食',
        hint: meals.length ? meals.length + ' 条记录' : '添加今日饮食',
        badge: shares.meal ? '已共享' : '',
        icon: '◎',
        filled: !!meals.length
      },
      {
        id: 'water',
        title: '饮水',
        hint: water + ' / ' + WATER_TARGET_ML + ' ml',
        badge: '',
        icon: '◌',
        filled: water > 0
      },
      {
        id: 'body',
        title: '身体状态',
        hint: hasBody ? '已填写' : '睡眠 · 疲劳 · 酸痛',
        badge: shares.body_state ? '已共享' : '',
        icon: '◉',
        filled: hasBody
      },
      {
        id: 'special',
        title: '特殊情况',
        hint: hasSpecial
          ? SPECIAL_LABEL[body.specialType] || '已备注'
          : '默认私密',
        badge: shares.special ? '已共享' : '',
        icon: '△',
        filled: hasSpecial
      },
      {
        id: 'training',
        title: '当天训练',
        hint: sessions.length ? sessions.length + ' 次完成' : '暂无训练',
        badge: shares.workout_self ? '已共享' : '',
        icon: '↗',
        filled: !!sessions.length
      }
    ]
  },

  pickDefaultPanel(view) {
    const notes = view.coachNotes || []
    if (notes.length) return 'coach'
    if ((view.meals || []).length) return 'meal'
    return this.data.openPanel || 'coach'
  },

  presentMeal(m) {
    const macros = m.macrosG || m.macros_g || null
    const mediaId = m.mediaId || m.media_id || ''
    const photoUrl = m.photoUrl || m.photo_url || m.preview_url || ''
    return Object.assign({}, m, {
      mealTypeLabel: MEAL_LABEL[m.mealType || m.meal_type] || m.mealType || m.meal_type,
      foodText: m.foodText || m.food_text || '',
      portionText: m.portionText || m.portion_text || '',
      hasPhoto: !!(photoUrl || mediaId),
      photoUrl: photoUrl || '',
      macrosViews: presentMacros(macros),
      showMacros: hasMacroData(macros),
      isEstimate: !!(m.isEstimate || m.is_estimate)
    })
  },

  normalizeView(view) {
    view.meals = (view.meals || []).map((m) => this.presentMeal(m))
    view.coachNotes = view.coachNotes || []
    view.sessions = view.sessions || []
    view.shares = view.shares || {}
    return view
  },

  syncFormFromBody(body, force) {
    if (!force && (this.data.bodyDirty || this.data.specialDirty)) return {}
    const patch = {}
    if (force || !this.data.bodyDirty) {
      patch.sleepHours = body.sleepHours != null ? String(body.sleepHours) : ''
      patch.fatigue = body.fatigue != null ? String(body.fatigue) : ''
      patch.soreness = body.soreness || ''
      patch.bodyDirty = false
      patch.bodySaveState = 'idle'
      patch.bodySaveHint = ''
    }
    if (force || !this.data.specialDirty) {
      patch.specialType = body.specialType || ''
      patch.specialNote = body.specialNote || ''
      patch.specialTypeLabel = SPECIAL_LABEL[body.specialType] || ''
      patch.specialDirty = false
      patch.specialSaveState = 'idle'
      patch.specialSaveHint = ''
    }
    return patch
  },

  reload(opts) {
    const app = getApp()
    const resetPanel = !!(opts && opts.resetPanel)
    const forceForm = !!(opts && opts.forceForm)
    this.setData({ loadError: '' })
    diaryApi
      .getDailyView(app, this.studentId(), this.data.localDate)
      .then((res) => {
        const view = this.normalizeView(res.data)
        const body = view.bodyState || {}
        const accordion = this.buildAccordion(view)
        const patch = Object.assign(
          {
            view,
            accordion,
            daySummary: this.buildDaySummary(view),
            waterPercent: this.waterPercentOf(view.waterTotalMl),
            loadError: ''
          },
          this.syncFormFromBody(body, forceForm)
        )
        if (resetPanel) patch.openPanel = this.pickDefaultPanel(view)
        this.setData(patch)
      })
      .catch((err) => {
        this.setData({
          loadError: (err && err.message) || '加载日记失败'
        })
      })
  },

  onTogglePanel(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const next = this.data.openPanel === id ? '' : id
    this.setData({ openPanel: next })
  },

  onPickDate(e) {
    const key = e.currentTarget.dataset.key
    if (!key || key === this.data.localDate) return
    this.setData({
      localDate: key,
      bodyDirty: false,
      specialDirty: false,
      bodySaveState: 'idle',
      specialSaveState: 'idle',
      mealSaveState: 'idle',
      waterSaveState: 'idle'
    })
    this.reload({ resetPanel: true, forceForm: true })
  },

  onToggleRest() {
    const app = getApp()
    const rest = !(this.data.view && this.data.view.restDay)
    diaryApi
      .setRestDay(app, this.studentId(), this.data.localDate, rest)
      .then((res) => {
        this.applyView(res.data)
        app.toast(rest ? '已记为休息日' : '已取消休息标记')
      })
      .catch((err) => app.toast((err && err.message) || '失败'))
  },

  applyView(view) {
    view = this.normalizeView(view)
    this.setData({
      view,
      accordion: this.buildAccordion(view),
      daySummary: this.buildDaySummary(view),
      waterPercent: this.waterPercentOf(view.waterTotalMl)
    })
  },

  pulseWater() {
    if (this.data.reduced) return
    this.setData({ waterPulse: true })
    clearTimeout(this._waterPulseTimer)
    this._waterPulseTimer = setTimeout(() => {
      this.setData({ waterPulse: false })
    }, 700)
  },

  onMealType(e) {
    this.setData({ mealType: e.currentTarget.dataset.k })
  },
  onMealText(e) {
    this.setData({ mealText: e.detail.value })
  },
  onAddMeal() {
    const app = getApp()
    const text = (this.data.mealText || '').trim()
    if (!text) {
      app.toast('请填写食物')
      return
    }
    this.setData({ mealSaveState: 'saving', mealSaveHint: '保存中…' })
    diaryApi
      .addMeal(app, {
        studentId: this.studentId(),
        localDate: this.data.localDate,
        mealType: this.data.mealType,
        foodText: text
      })
      .then(() => {
        this.setData({
          mealText: '',
          mealSaveState: 'saved',
          mealSaveHint: '已添加'
        })
        this.reload()
      })
      .catch((err) => {
        this.setData({
          mealSaveState: 'error',
          mealSaveHint: (err && err.message) || '添加失败'
        })
        app.toast((err && err.message) || '失败')
      })
  },
  onDelMeal(e) {
    diaryApi
      .deleteMeal(getApp(), e.currentTarget.dataset.id, this.studentId())
      .then(() => this.reload())
  },

  onWaterInput(e) {
    this.setData({ waterMl: e.detail.value })
  },
  onAddWater() {
    const app = getApp()
    this.setData({ waterSaveState: 'saving', waterSaveHint: '记录中…' })
    diaryApi
      .addWater(app, this.studentId(), this.data.localDate, this.data.waterMl)
      .then((res) => {
        this.applyView(res.data)
        this.pulseWater()
        this.setData({
          waterSaveState: 'saved',
          waterSaveHint: '已累加'
        })
      })
      .catch((err) => {
        this.setData({
          waterSaveState: 'error',
          waterSaveHint: (err && err.message) || '记录失败'
        })
        app.toast((err && err.message) || '失败')
      })
  },

  onSleep(e) {
    this.setData({
      sleepHours: e.detail.value,
      bodyDirty: true,
      bodySaveState: 'dirty',
      bodySaveHint: '未保存'
    })
  },
  onFatigue(e) {
    this.setData({
      fatigue: e.detail.value,
      bodyDirty: true,
      bodySaveState: 'dirty',
      bodySaveHint: '未保存'
    })
  },
  onSoreness(e) {
    this.setData({
      soreness: e.detail.value,
      bodyDirty: true,
      bodySaveState: 'dirty',
      bodySaveHint: '未保存'
    })
  },
  onFatiguePick(e) {
    const v = e.currentTarget.dataset.v
    if (v == null) return
    this.setData({
      fatigue: String(v),
      bodyDirty: true,
      bodySaveState: 'dirty',
      bodySaveHint: '未保存'
    })
  },
  onSaveBody() {
    const app = getApp()
    this.setData({ bodySaveState: 'saving', bodySaveHint: '保存中…' })
    diaryApi
      .upsertBodyState(app, this.studentId(), this.data.localDate, {
        sleepHours: this.data.sleepHours === '' ? null : parseFloat(this.data.sleepHours),
        fatigue: this.data.fatigue === '' ? null : parseInt(this.data.fatigue, 10),
        soreness: this.data.soreness
      })
      .then((res) => {
        this.setData({
          bodyDirty: false,
          bodySaveState: 'saved',
          bodySaveHint: '已保存'
        })
        this.applyView(res.data)
        app.toast('状态已保存')
      })
      .catch((err) => {
        this.setData({
          bodySaveState: 'error',
          bodySaveHint: (err && err.message) || '保存失败'
        })
        app.toast((err && err.message) || '失败')
      })
  },

  onSpecialType(e) {
    const k = e.currentTarget.dataset.k
    this.setData({
      specialType: k,
      specialTypeLabel: SPECIAL_LABEL[k] || '',
      specialDirty: true,
      specialSaveState: 'dirty',
      specialSaveHint: '未保存'
    })
  },
  onSpecialNote(e) {
    this.setData({
      specialNote: e.detail.value,
      specialDirty: true,
      specialSaveState: 'dirty',
      specialSaveHint: '未保存'
    })
  },
  onSaveSpecial() {
    const app = getApp()
    this.setData({ specialSaveState: 'saving', specialSaveHint: '保存中…' })
    diaryApi
      .upsertBodyState(app, this.studentId(), this.data.localDate, {
        specialType: this.data.specialType,
        specialNote: this.data.specialNote
      })
      .then((res) => {
        this.setData({
          specialDirty: false,
          specialSaveState: 'saved',
          specialSaveHint: '已保存'
        })
        this.applyView(res.data)
        app.toast('特殊情况已保存（默认私密）')
      })
      .catch((err) => {
        this.setData({
          specialSaveState: 'error',
          specialSaveHint: (err && err.message) || '保存失败'
        })
        app.toast((err && err.message) || '失败')
      })
  },

  onShare(e) {
    const app = getApp()
    const cat = e.currentTarget.dataset.cat
    diaryApi
      .shareDayCategory(app, this.studentId(), this.data.localDate, cat)
      .then((res) => {
        this.applyView(res.data)
        app.toast(res.hint || '已共享给教练（仅该日该类）')
      })
      .catch((err) => app.toast((err && err.message) || '共享失败'))
  },

  onRevoke(e) {
    const app = getApp()
    const cat = e.currentTarget.dataset.cat
    diaryApi
      .revokeDayCategory(app, this.studentId(), this.data.localDate, cat)
      .then((res) => {
        this.applyView(res.data)
        app.toast('已撤回共享')
      })
  }
})
