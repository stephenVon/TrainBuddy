const { requireLogin } = require('../../utils/guard')
const bookingApi = require('../../services/bookingApi')
const time = require('../../utils/time')
const { SCHEDULE_CONFIG } = require('../../utils/scheduleConfig')

Page({
  data: {
    booking: null,
    statusLabel: '',
    statusTone: 'muted',
    statusPillClass: 'statuspill-muted',
    isStudent: false,
    isCoach: false,
    expireText: '',
    cancelHours: SCHEDULE_CONFIG.cancelOrChangeAheadMin / 60,
    changing: false,
    dateList: [],
    changeDate: '',
    changeSlots: [],
    changeLoading: false,
    changeError: '',
    todayKey: ''
  },

  onLoad(query) {
    this.bookingId = query.id
  },

  onShow() {
    if (!requireLogin(this)) return
    this.reload()
  },

  reload() {
    const app = getApp()
    const role = app.globalData.role
    const user = app.globalData.session.user
    bookingApi
      .getBooking(app, this.bookingId)
      .then((res) => {
        const b = res.data
        const isStudent = role === 'student' && b.student_id === user.userId
        const coachId =
          (user.coachProfile && user.coachProfile.coachId) || 'coach_001'
        const isCoach = role === 'coach' && b.coach_id === coachId
        const tone = bookingApi.statusTone(b.status)
        this.setData({
          booking: b,
          statusLabel: bookingApi.statusLabel(b.status),
          statusTone: tone,
          statusPillClass: 'statuspill-' + tone,
          isStudent,
          isCoach,
          expireText: b.expiresAt ? time.isoShanghai(b.expiresAt) : ''
        })
      })
      .catch(() => this.setData({ booking: null }))
  },

  enrichChangeDates(dateList, changeDate, today) {
    return (dateList || []).map((item) =>
      Object.assign({}, item, {
        isToday: item.dateKey === today,
        isSelected: item.dateKey === changeDate,
        mark: item.dateKey === today ? '今天' : ''
      })
    )
  },

  onCancel() {
    const app = getApp()
    const b = this.data.booking
    wx.showModal({
      title: '取消预约',
      content: '确认取消？取消弹层点「取消」不会改动预约。',
      confirmText: '确认取消',
      success: (res) => {
        if (!res.confirm) return
        bookingApi
          .cancelBooking(app, b.booking_id, {
            actorId: app.globalData.session.user.userId,
            role: app.globalData.role,
            revision: b.revision,
            reason: ''
          })
          .then(() => {
            app.toast('已取消')
            this.reload()
          })
          .catch((err) => app.toast((err && err.message) || '取消失败'))
      }
    })
  },

  onAccept() {
    this.coachDecide('accept')
  },

  onReject() {
    this.coachDecide('reject', '时段不便')
  },

  coachDecide(action, reason) {
    const app = getApp()
    const b = this.data.booking
    const coachId =
      (app.globalData.session.user.coachProfile &&
        app.globalData.session.user.coachProfile.coachId) ||
      'coach_001'
    bookingApi
      .decideBooking(app, b.booking_id, {
        action,
        reason: reason || '',
        revision: b.revision,
        coachId
      })
      .then(() => {
        app.toast(action === 'accept' ? '已确认' : '已拒绝')
        this.reload()
      })
      .catch((err) => app.toast((err && err.message) || '操作失败'))
  },

  onAttend(e) {
    const app = getApp()
    const status = e.currentTarget.dataset.st
    const coachId =
      (app.globalData.session.user.coachProfile &&
        app.globalData.session.user.coachProfile.coachId) ||
      'coach_001'
    bookingApi
      .setAttendance(app, this.data.booking.booking_id, {
        status,
        coachId,
        note: ''
      })
      .then(() => {
        app.toast('已更新出勤')
        this.reload()
      })
      .catch((err) => app.toast((err && err.message) || '失败'))
  },

  onChange() {
    const today = time.todayKey()
    const raw = time.listDateKeys(today, SCHEDULE_CONFIG.openDaysAhead).map((k) =>
      time.formatDateLabel(k)
    )
    this.setData({
      changing: true,
      todayKey: today,
      dateList: this.enrichChangeDates(raw, today, today),
      changeDate: today,
      changeError: ''
    })
    this.loadChangeSlots(today)
  },

  closeChange() {
    this.setData({ changing: false, changeSlots: [], changeLoading: false, changeError: '' })
  },

  onChangeDate(e) {
    const key = e.currentTarget.dataset.key
    const today = this.data.todayKey || time.todayKey()
    this.setData({
      changeDate: key,
      dateList: this.enrichChangeDates(this.data.dateList, key, today),
      changeError: ''
    })
    this.loadChangeSlots(key)
  },

  loadChangeSlots(dateKey) {
    const app = getApp()
    const b = this.data.booking
    this.setData({ changeLoading: true, changeError: '' })
    bookingApi
      .getSlots(app, {
        coachId: b.coach_id,
        fromDate: dateKey,
        toDate: dateKey,
        courseTypeId: b.course_type_id
      })
      .then((res) => {
        const changeSlots = (res.data.slots || [])
          .filter((s) => s.status === 'open')
          .map((s) =>
            Object.assign({}, s, {
              available: Number(s.startAt) > Date.now(),
              stateMark: Number(s.startAt) > Date.now() ? '可改期' : '已过期'
            })
          )
        this.setData({ changeSlots, changeLoading: false })
      })
      .catch((err) => {
        this.setData({
          changeLoading: false,
          changeError: (err && err.message) || '时段加载失败',
          changeSlots: []
        })
      })
  },

  submitChange(e) {
    const app = getApp()
    const startAt = Number(e.currentTarget.dataset.start)
    wx.showModal({
      title: '提交改期',
      content: '原课将保持已确认，直至教练接受新时段。取消弹层不会提交。',
      confirmText: '提交',
      success: (res) => {
        if (!res.confirm) return
        bookingApi
          .requestChange(app, this.data.booking.booking_id, {
            proposedStart: startAt,
            courseTypeId: this.data.booking.course_type_id,
            actorId: app.globalData.session.user.userId
          })
          .then(() => {
            app.toast('改期已提交')
            this.setData({ changing: false })
            this.reload()
          })
          .catch((err) => app.toast((err && err.message) || '改期失败'))
      }
    })
  }
})
