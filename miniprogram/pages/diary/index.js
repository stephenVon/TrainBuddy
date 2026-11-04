const { requireLogin } = require('../../utils/guard')
const diaryApi = require('../../services/diaryApi')
const time = require('../../utils/time')

const MEAL_LABEL = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐'
}

Page({
  data: {
    dateList: [],
    localDate: '',
    view: {
      sessions: [],
      coachNotes: [],
      meals: [],
      shares: {},
      waterTotalMl: 0,
      restDay: false,
      canEdit: true
    },
    mealTypes: diaryApi.MEAL_TYPES,
    specialTypes: diaryApi.SPECIAL_TYPES,
    mealType: 'lunch',
    mealText: '',
    waterMl: '250',
    sleepHours: '',
    fatigue: '',
    soreness: '',
    specialType: '',
    specialNote: '',
    waterPercent: 0,
    waterPulse: false,
    openPanel: 'coach',
    accordion: []
  },

  onLoad(query) {
    if (query && /^\d{4}-\d{2}-\d{2}$/.test(query.date || '')) {
      this.setData({ localDate: query.date })
    }
  },
  onJumpSection(e) {
    const section = e.currentTarget.dataset.section
    if (!['training','meals','water','state','sharing'].includes(section)) return
    wx.pageScrollTo({ selector: '#diary-' + section, offsetTop: -56, duration: 0, fail: () => getApp().toast('请向下滑动查看对应记录') })
  },

  onShow() {
    if (!requireLogin(this)) return
    const today = time.todayKey()
    const keys = []
    for (let i = -6; i <= 0; i++) keys.push(time.addDays(today, i))
    this.setData({
      dateList: keys.map((k) => time.formatDateLabel(k)),
      localDate: this.data.localDate || today
    })
    this.reload()
  },

  studentId() {
    return getApp().globalData.session.user.userId
  },

  waterPercentOf(ml) {
    const n = Number(ml) || 0
    return Math.max(0, Math.min(100, Math.round((n / 2000) * 100)))
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

    return [
      {
        id: 'coach',
        title: '教练课后点评',
        hint: notes.length ? notes.length + ' 条同步点评' : '暂无点评',
        badge: notes.length ? '有新反馈' : '',
        icon: '✦'
      },
      {
        id: 'meal',
        title: '饮食',
        hint: meals.length ? meals.length + ' 条记录' : '添加今日饮食',
        badge: shares.meal ? '已共享' : '',
        icon: '◎'
      },
      {
        id: 'water',
        title: '饮水',
        hint: (view.waterTotalMl || 0) + ' ml',
        badge: '',
        icon: '◌'
      },
      {
        id: 'body',
        title: '身体状态',
        hint: hasBody ? '已填写' : '睡眠 · 疲劳 · 酸痛',
        badge: shares.body_state ? '已共享' : '',
        icon: '◉'
      },
      {
        id: 'special',
        title: '特殊情况',
        hint: hasSpecial ? '已备注' : '默认私密',
        badge: shares.special ? '已共享' : '',
        icon: '△'
      },
      {
        id: 'training',
        title: '当天训练',
        hint: sessions.length ? sessions.length + ' 次完成' : '暂无训练',
        badge: shares.workout_self ? '已共享' : '',
        icon: '↗'
      }
    ]
  },

  pickDefaultPanel(view) {
    const notes = view.coachNotes || []
    if (notes.length) return 'coach'
    if ((view.meals || []).length) return 'meal'
    return this.data.openPanel || 'coach'
  },

  normalizeView(view) {
    view.meals = (view.meals || []).map((m) =>
      Object.assign({}, m, { mealTypeLabel: MEAL_LABEL[m.mealType] || m.mealType })
    )
    view.coachNotes = view.coachNotes || []
    view.sessions = view.sessions || []
    view.shares = view.shares || {}
    return view
  },

  reload() {
    const app = getApp()
    diaryApi.getDailyView(app, this.studentId(), this.data.localDate).then((res) => {
      const view = this.normalizeView(res.data)
      const body = view.bodyState || {}
      const accordion = this.buildAccordion(view)
      this.setData({
        view,
        accordion,
        openPanel: this.pickDefaultPanel(view),
        sleepHours: body.sleepHours != null ? String(body.sleepHours) : '',
        fatigue: body.fatigue != null ? String(body.fatigue) : '',
        soreness: body.soreness || '',
        specialType: body.specialType || '',
        specialNote: body.specialNote || '',
        waterPercent: this.waterPercentOf(view.waterTotalMl)
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
    this.setData({ localDate: key })
    this.reload()
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
      waterPercent: this.waterPercentOf(view.waterTotalMl)
    })
  },

  pulseWater() {
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
    diaryApi
      .addMeal(app, {
        studentId: this.studentId(),
        localDate: this.data.localDate,
        mealType: this.data.mealType,
        foodText: text
      })
      .then(() => {
        this.setData({ mealText: '' })
        this.reload()
      })
      .catch((err) => app.toast((err && err.message) || '失败'))
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
    diaryApi
      .addWater(app, this.studentId(), this.data.localDate, this.data.waterMl)
      .then((res) => {
        this.applyView(res.data)
        this.pulseWater()
      })
      .catch((err) => app.toast((err && err.message) || '失败'))
  },

  onSleep(e) {
    this.setData({ sleepHours: e.detail.value })
  },
  onFatigue(e) {
    this.setData({ fatigue: e.detail.value })
  },
  onSoreness(e) {
    this.setData({ soreness: e.detail.value })
  },
  onSaveBody() {
    const app = getApp()
    diaryApi
      .upsertBodyState(app, this.studentId(), this.data.localDate, {
        sleepHours: this.data.sleepHours === '' ? null : parseFloat(this.data.sleepHours),
        fatigue: this.data.fatigue === '' ? null : parseInt(this.data.fatigue, 10),
        soreness: this.data.soreness
      })
      .then((res) => {
        this.applyView(res.data)
        app.toast('状态已保存')
      })
      .catch((err) => app.toast((err && err.message) || '失败'))
  },

  onSpecialType(e) {
    this.setData({ specialType: e.currentTarget.dataset.k })
  },
  onSpecialNote(e) {
    this.setData({ specialNote: e.detail.value })
  },
  onSaveSpecial() {
    const app = getApp()
    diaryApi
      .upsertBodyState(app, this.studentId(), this.data.localDate, {
        specialType: this.data.specialType,
        specialNote: this.data.specialNote
      })
      .then((res) => {
        this.applyView(res.data)
        app.toast('特殊情况已保存（默认私密）')
      })
      .catch((err) => app.toast((err && err.message) || '失败'))
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
