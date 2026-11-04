const { requireLogin } = require('../../utils/guard')
const trainingApi = require('../../services/trainingApi')

Page({
  data: {
    plans: [],
    isCoach: false,
    isStudent: true,
    studentId: '', loading: false, error: ''
  },

  onShow() {
    if (!requireLogin(this)) return
    const app = getApp()
    const role = app.globalData.role
    const user = app.globalData.session.user
    const studentId =
      role === 'coach' ? app.globalData.activeSubjectId || user.userId : user.userId
    this.setData({
      isCoach: role === 'coach',
      isStudent: role === 'student',
      studentId, loading: true, error: ''
    })
    return trainingApi.listPlansForStudent(app, studentId).then((res) => {
      this.setData({ plans: res.data || [] })
    }).catch(err => this.setData({ error: err.message || '读取计划失败，请重试' })).then(() => this.setData({ loading: false }))
  },

  onEnsureDefault() {
    const app = getApp()
    const user = app.globalData.session.user
    trainingApi.ensureDefaultPublishedPlan(app, {
      studentId: user.userId,
      authorId: user.userId,
      authorRole: 'student'
    }).then(() => this.onShow()).catch(err => app.toast(err.message || '创建失败'))
  },

  goEdit(e) {
    wx.navigateTo({ url: '/pages/plan-edit/index?id=' + e.currentTarget.dataset.id })
  },

  goStart(e) {
    const app = getApp()
    trainingApi
      .startSessionFromPlan(app, e.currentTarget.dataset.id, {
        studentId: app.globalData.session.user.userId,
        idempotencyKey:
          app.globalData.session.user.userId +
          ':' +
          e.currentTarget.dataset.id +
          ':' + Date.now()
      })
      .then(() => wx.redirectTo({ url: '/pages/workout/index' }))
      .catch(err => app.toast(err.message || '无法开始训练'))
  }
})
