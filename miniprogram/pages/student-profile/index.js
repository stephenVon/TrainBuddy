const { requireCoachRole } = require('../../utils/guard')
const { canCoachReadStudent } = require('../../utils/permission')
const diaryApi = require('../../services/diaryApi')
const bindingApi = require('../../services/bindingApi')
const time = require('../../utils/time')
const trainingApi = require('../../services/trainingApi')

const MEAL_LABEL = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐'
}

const SPECIAL_LABEL = {
  travel: '出差',
  overtime: '加班',
  period: '生理期',
  injury: '受伤/不适',
  other: '其他'
}

Page({
  data: {
    showHealth: false, trainingHistory: [], trainingLoading: false, trainingError: '',
    studentId: '',
    studentName: '',
    dateList: [],
    localDate: '',
    today: '',
    shared: {
      visible: {},
      hiddenReasons: {},
      canSee: {}
    },
    feedbackText: '',
    mealFeedbackText: '',
    sendingFeedback: false,
    feedbacks: []
  },

  onLoad(query) {
    const app = getApp()
    const studentId =
      (query && query.studentId) || app.globalData.activeSubjectId || ''
    const studentName =
      (query && query.name) || app.globalData.student || '学员'
    this.setData({ studentId, studentName })
  },

  onShow() {
    if (!requireCoachRole(this)) return
    const app = getApp()
    const studentId = this.data.studentId || app.globalData.activeSubjectId
    if (!studentId) {
      app.toast('请先选择学员')
      wx.redirectTo({ url: '/pages/students/index' })
      return
    }
    const check = canCoachReadStudent(
      app,
      app.globalData.session.user.userId,
      studentId
    )
    if (!check.ok) {
      app.toast(check.message || '无权访问')
      wx.redirectTo({ url: '/pages/students/index' })
      return
    }

    const today = time.todayKey()
    const keys = []
    for (let i = -6; i <= 0; i++) keys.push(time.addDays(today, i))
    bindingApi.listBoundStudentsForCoachAsync(app).then((bound) => {
      const row = (bound || []).find((b) => b.studentId === studentId)
      this.setData({
        studentId,
        studentName: (row && row.name) || this.data.studentName,
        dateList: keys.map((k) => time.formatDateLabel(k)),
        today,
        localDate: this.data.localDate || today
      })
      this.reload()
      this.reloadTraining()
    })
  },

  reload() {
    const app = getApp()
    const coachId = app.globalData.session.user.userId
    const { studentId, localDate } = this.data
    const sequence = this.reloadSequence = (this.reloadSequence || 0) + 1
    this.setData({shared:{visible:{},hiddenReasons:{},canSee:{}},feedbacks:[]})
    diaryApi
      .getSharedDailyForCoach(app, coachId, studentId, localDate)
      .then((res) => {
        if (sequence !== this.reloadSequence) return
        const shared = res.data
        const vis = shared.visible || {}
        if (vis.meals) {
          vis.meals = vis.meals.map((m) =>
            Object.assign({}, m, {
              mealType: MEAL_LABEL[m.mealType] || m.mealType
            })
          )
        }
        if (vis.special && vis.special.specialType) {
          vis.special = Object.assign({}, vis.special, {
            specialType:
              SPECIAL_LABEL[vis.special.specialType] || vis.special.specialType
          })
        }
        shared.visible = vis
        shared.canSee = {
          workout: Array.isArray(vis.sessions),
          meal: Array.isArray(vis.meals),
          body: !shared.hiddenReasons.body_state && 'bodyState' in vis,
          special: !shared.hiddenReasons.special && 'special' in vis
        }
        this.setData({ shared })
      })
      .catch((err) => app.toast((err && err.message) || '加载失败'))

    diaryApi
      .listFeedback(app, {
        studentId,
        targetId: studentId + '|' + localDate
      })
      .then((res) => { if (sequence === this.reloadSequence) this.setData({ feedbacks: res.data || [] }) })
      .catch(err => app.toast(err.message || '点评加载失败'))
  },
  onToggleHealth() { this.setData({ showHealth: !this.data.showHealth }) },
  reloadTraining() {
    const studentId = this.data.studentId
    const generation = this._trainingGeneration = (this._trainingGeneration || 0) + 1
    this.setData({ trainingLoading:true, trainingError:'' })
    return trainingApi.listSessions(getApp(), { studentId }).then(res => {
      if (generation === this._trainingGeneration && studentId === this.data.studentId) this.setData({ trainingHistory:res.data || [] })
    }).catch(err => { if (generation === this._trainingGeneration) this.setData({ trainingError:err.message || '训练记录读取失败' }) })
      .finally(() => { if (generation === this._trainingGeneration) this.setData({ trainingLoading:false }) })
  },
  onUnload() { this.reloadSequence = (this.reloadSequence || 0) + 1; this._trainingGeneration = (this._trainingGeneration || 0) + 1 },
  goPlans() {
    const app = getApp()
    app.globalData.activeSubjectId = this.data.studentId
    app.globalData.student = this.data.studentName
    app.persist()
    wx.navigateTo({ url:'/pages/plans/index' })
  },

  onDateChange(e) {
    this.onPickDate({currentTarget:{dataset:{key:e.detail.value}}})
  },

  onPickDate(e) {
    if (this.data.sendingFeedback) return
    this.setData({ localDate: e.currentTarget.dataset.key, feedbackText: '', mealFeedbackText: '' })
    this.reload()
  },

  onFeedbackInput(e) {
    this.setData({ feedbackText: e.detail.value })
  },

  onMealFeedbackInput(e) { this.setData({mealFeedbackText:e.detail.value}) },

  onSubmitFeedback(e) {
    if (this.data.sendingFeedback) return
    const type = e && e.currentTarget && e.currentTarget.dataset.type === 'meal' ? 'meal' : 'daily_log'
    const field = type === 'meal' ? 'mealFeedbackText' : 'feedbackText'
    const app = getApp(), user = app.globalData.session.user
    const text = (this.data[field] || '').trim()
    if (!text) { app.toast('请填写点评'); return }
    const targetId = this.data.studentId + '|' + this.data.localDate
    const signature = type + '|' + targetId + '|' + text
    if (!this.feedbackIntent || this.feedbackIntent.signature !== signature) this.feedbackIntent = { signature, key:'feedback_'+Date.now()+'_'+Math.random().toString(36).slice(2) }
    this.setData({sendingFeedback:true})
    return diaryApi.addFeedback(app, {
      targetType:type, targetId, studentId:this.data.studentId, text, idempotencyKey:this.feedbackIntent.key
    }).then(() => {
      this.feedbackIntent=null
      this.setData({[field]:''})
      app.toast('点评已同步给学员')
      this.reload()
    }).catch(err => app.toast(err.message || '点评提交失败，请重试'))
      .finally(() => this.setData({sendingFeedback:false}))
  },

  goRecord() {
    const app = getApp()
    app.globalData.activeSubjectId = this.data.studentId
    app.globalData.student = this.data.studentName
    app.persist()
    wx.redirectTo({ url: '/pages/record/index' })
  },

  goBack() {
    wx.redirectTo({ url: '/pages/students/index' })
  }
})
