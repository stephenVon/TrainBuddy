const { requireLogin } = require('../../utils/guard')
const trainingApi = require('../../services/trainingApi')
const planSchedule = require('../../utils/planSchedule')

const ACTION_RPX = 96
const FILTERS = [
  { key: 'all', label: '全部计划' },
  { key: 'coach', label: '教练计划' },
  { key: 'mine', label: '我的计划' }
]

function matchFilter(item, key) {
  if (key === 'coach') return item.author_role === 'coach'
  if (key === 'mine') return item.author_role !== 'coach'
  return true
}

function decoratePlans(list, filterKey) {
  return (list || [])
    .filter((item) => matchFilter(item, filterKey || 'all'))
    .map((item) => Object.assign({}, item, {
      offset: 0,
      swiping: false,
      scheduleText: item.published ? planSchedule.scheduleLabel(item.published) : '尚未发布'
    }))
}

Page({
  data: {
    plans: [],
    isCoach: false,
    isStudent: true,
    canCreate: false,
    filters: FILTERS,
    filterKey: 'all',
    hasPlans: false,
    studentId: '', loading: false, error: '', creating: false
  },

  onShow() {
    if (!requireLogin(this)) return
    const app = getApp()
    const role = app.globalData.role
    const user = app.globalData.session.user
    const studentId =
      role === 'coach' ? app.globalData.activeSubjectId || '' : user.userId
    const windowWidth = (wx.getSystemInfoSync() || {}).windowWidth || 375
    this._actionWidth = Math.round((ACTION_RPX / 750) * windowWidth)
    this.setData({
      isCoach: role === 'coach',
      isStudent: role === 'student',
      canCreate: role === 'student' || !!studentId,
      studentId, loading: !!studentId, error: ''
    })
    if (!studentId) return
    return trainingApi.listPlansForStudent(app, studentId).then((res) => {
      this._allPlans = res.data || []
      this.setData({
        hasPlans: this._allPlans.length > 0,
        plans: decoratePlans(this._allPlans, this.data.filterKey)
      })
    }).catch(err => this.setData({ error: err.message || '读取计划失败，请重试' })).then(() => this.setData({ loading: false }))
  },

  onFilter(e) {
    const key = e.currentTarget.dataset.key
    if (!key || key === this.data.filterKey) return
    this.setData({
      filterKey: key,
      plans: decoratePlans(this._allPlans || [], key)
    })
  },

  actionWidth() {
    return this._actionWidth || 48
  },

  closeOtherSwipes(keepIndex) {
    const next = this.data.plans.map((item, index) => {
      if (index === keepIndex || !item.offset) return item
      return Object.assign({}, item, { offset: 0, swiping: false })
    })
    this.setData({ plans: next })
  },

  setSwipe(index, offset, swiping) {
    this.setData({
      ['plans[' + index + '].offset']: offset,
      ['plans[' + index + '].swiping']: !!swiping
    })
  },

  onSwipeStart(e) {
    if (!Number(e.currentTarget.dataset.canEdit)) return
    const index = Number(e.currentTarget.dataset.index)
    const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0])
    if (!touch) return
    this.closeOtherSwipes(index)
    const current = this.data.plans[index] || {}
    this._swipe = {
      index,
      startX: touch.clientX,
      startY: touch.clientY,
      startOffset: current.offset || 0,
      axis: null
    }
  },

  onSwipeMove(e) {
    const swipe = this._swipe
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
    const max = this.actionWidth()
    let offset = swipe.startOffset + dx
    if (offset > 0) offset = 0
    if (offset < -max) offset = -max
    this.setSwipe(swipe.index, offset, true)
  },

  onSwipeEnd() {
    const swipe = this._swipe
    this._swipe = null
    if (!swipe || swipe.axis !== 'x') return
    const current = this.data.plans[swipe.index]
    if (!current) return
    const max = this.actionWidth()
    const open = (current.offset || 0) < -max / 2
    this.setSwipe(swipe.index, open ? -max : 0, false)
  },

  onAskDelete(e) {
    if (this._deleting || this._deleteModal) return
    const id = e.currentTarget.dataset.id
    const title = e.currentTarget.dataset.title || '该计划'
    this._deleteModal = true
    wx.showModal({
      title: '删除训练计划',
      content: '确定删除「' + title + '」吗？删除后无法恢复。',
      confirmText: '删除',
      confirmColor: '#b42332',
      cancelText: '取消',
      success: (res) => {
        this._deleteModal = false
        if (!res.confirm) return
        this.deletePlan(id)
      },
      fail: () => {
        this._deleteModal = false
      }
    })
  },

  deletePlan(planId) {
    if (this._deleting) return
    this._deleting = true
    const app = getApp()
    trainingApi
      .deletePlan(app, planId)
      .then(() => {
        this._allPlans = (this._allPlans || []).filter((item) => item.plan_id !== planId)
        this.setData({
          hasPlans: this._allPlans.length > 0,
          plans: decoratePlans(this._allPlans, this.data.filterKey)
        })
        app.toast('已删除')
      })
      .catch((err) => app.toast((err && err.message) || '删除失败'))
      .then(() => { this._deleting = false })
  },

  onCreatePlan() {
    if (this._creating || !this.data.canCreate) return
    this._creating = true
    this.setData({ creating: true })
    const app = getApp()
    const payload = this.data.isCoach ? { studentId: this.data.studentId, title: '训练计划' } : { title: '我的训练计划' }
    trainingApi.createManualPlan(app, payload)
      .then((res) => wx.navigateTo({ url: '/pages/plan-edit/index?id=' + res.data.plan_id }))
      .catch((err) => app.toast((err && err.message) || '创建失败'))
      .then(() => { this._creating = false; this.setData({ creating: false }) })
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
