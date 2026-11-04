const { syncRoleBar } = require('../../utils/role')
const { requireLogin } = require('../../utils/guard')
const bindingApi = require('../../services/bindingApi')
const bookingApi = require('../../services/bookingApi')
const time = require('../../utils/time')
const { SCHEDULE_CONFIG } = require('../../utils/scheduleConfig')
const interaction = require('../../utils/interaction')

Page({
  data: {
    role: 'student',
    hasBinding: false,
    coachName: '',
    coachId: '',
    dateList: [],
    selectedDate: '',
    monthTitle: '',
    openDays: SCHEDULE_CONFIG.openDaysAhead,
    daySlots: [],
    myBookings: [],
    submitting: false,
    actionState: 'idle', bookingError: '', slotsError: '', slotsLoading: false,
    timeOptions: [], timeIndex: 0, selectedSlots: [], selectedCount: 0, selectedSummary: '', reduced: false,
    coachTab: 'day', coachLoading: false, showScheduleTools: false, showOpenSlots: false,
    pendingList: [],
    changeList: [],
    pendingCount: 0,
    coachDayBookings: [],
    openSlotsPreview: [],
    weekSummary: []
  },

  onLoad(query) { if (query && ['day','week','pending'].includes(query.tab)) this.setData({ coachTab:query.tab }) },
  onShow() {
    if (!requireLogin(this)) return
    syncRoleBar(this)
    this.setData({ reduced: interaction.reducedMotion() })
    const app = getApp()
    wx.setNavigationBarTitle({
      title: app.globalData.role === 'coach' ? '日程' : '约课'
    })
    this.initDates()
    this.refresh()
  },
  onUnload() { this._refreshGeneration = (this._refreshGeneration || 0) + 1 },

  initDates() {
    const today = time.todayKey()
    const keys = time.listDateKeys(today, SCHEDULE_CONFIG.openDaysAhead)
    const dateList = keys.map((k) => time.formatDateLabel(k))
    const selectedDate = this.data.selectedDate || today
    const lab = time.formatDateLabel(selectedDate)
    this.setData({
      dateList,
      selectedDate,
      monthTitle: lab.year + ' 年 ' + lab.month + ' 月',
      openDays: SCHEDULE_CONFIG.openDaysAhead
    })
  },

  refresh() {
    const app = getApp()
    if (app.globalData.role === 'coach') {
      this.refreshCoach()
    } else {
      this.refreshStudent()
    }
  },

  refreshStudent() {
    const generation = this._refreshGeneration = (this._refreshGeneration || 0) + 1
    const selectedDate = this.data.selectedDate
    const owner = this.studentOwner()
    this.setData({ slotsLoading: true, slotsError: '' })
    const app = getApp()
    const user = app.globalData.session.user
    bindingApi.refreshMe(app).then((me) => {
      if (generation !== this._refreshGeneration || getApp().globalData.role !== 'student' || owner !== this.studentOwner()) return
      const primary =
        (me && me.primaryBinding) || bindingApi.getActivePrimaryCoach(app, user.userId)
      if (!primary) {
        this.setData({
          hasBinding: false,
          coachName: '',
          coachId: '',
          daySlots: [],
          myBookings: []
          , slotsLoading: false, selectedSlots: [], selectedCount: 0, selectedSummary: '', timeOptions: []
        })
        return
      }
      this.setData({
        hasBinding: true,
        coachName: primary.coachName,
        coachId: primary.coachId
      })

      return Promise.all([bookingApi
        .getSlots(app, {
          coachId: primary.coachId,
          fromDate: selectedDate,
          toDate: selectedDate
        })
        .then((res) => {
          if (generation !== this._refreshGeneration || owner !== this.studentOwner()) return
          const previous = this.data.selectedSlots || []
          const prevKeys = {}
          previous.forEach((slot) => { prevKeys[this.slotKey(slot)] = true })
          const daySlots = (res.data.slots || []).map((slot) => {
            const available = slot.status === 'open' && Number(slot.startAt) > Date.now()
            const key = this.slotKey(slot)
            return Object.assign({}, slot, {
              available,
              selected: !!(available && prevKeys[key])
            })
          })
          const timeOptions = daySlots.filter((slot) => slot.available).map((slot) => ({
            label: slot.startLabel + '–' + slot.endLabel + ' · ' + slot.courseName, slot
          }))
          const selectedSlots = daySlots.filter((slot) => slot.selected)
          this.setData(Object.assign({
            daySlots,
            timeOptions,
            timeIndex: 0,
            slotsLoading: false
          }, this.selectionState(selectedSlots)))
        }), bookingApi
        .listBookings(app, { studentId: user.userId })
        .then((res) => {
          if (generation !== this._refreshGeneration || owner !== this.studentOwner()) return
          const myBookings = (res.data || []).map((b) =>
            Object.assign({}, b, { statusLabel: bookingApi.statusLabel(b.status) })
          )
          this.setData({ myBookings })
        })])
    }).catch(err => {
      if (generation === this._refreshGeneration) this.setData({ slotsLoading: false, slotsError: err.message || '时段加载失败，请重试' })
    })
  },

  refreshCoach() {
    const generation = this._refreshGeneration = (this._refreshGeneration || 0) + 1
    const owner = this.studentOwner()
    this.setData({ slotsError: '', coachLoading: true })
    const app = getApp()
    const coachId =
      (app.globalData.session.user.coachProfile &&
        app.globalData.session.user.coachProfile.coachId) ||
      'coach_001'

    return Promise.all([
      bookingApi.listBookings(app, {
        coachId,
        status: ['pending']
      }),
      bookingApi.listPendingChanges(app, coachId),
      bookingApi.listBookings(app, { coachId, dateKey: this.data.selectedDate }),
      bookingApi.getSlots(app, {
        coachId,
        fromDate: this.data.selectedDate,
        toDate: this.data.selectedDate
      })
    ]).then(([pendingRes, changeRes, dayRes, slotsRes]) => {
      if (generation !== this._refreshGeneration || owner !== this.studentOwner()) return
      const pendingList = (pendingRes.data || []).map((b) =>
        Object.assign({}, b, { statusLabel: bookingApi.statusLabel(b.status) })
      )
      const changeList = changeRes.data || []
      const coachDayBookings = (dayRes.data || []).map((b) =>
        Object.assign({}, b, { statusLabel: bookingApi.statusLabel(b.status) })
      )
      const openSlotsPreview = (slotsRes.data.slots || [])
        .filter((s) => s.status === 'open')
        .slice(0, 8)

      this.setData({
        pendingList,
        changeList,
        pendingCount: pendingList.length + changeList.length,
        coachDayBookings,
        openSlotsPreview,
        coachLoading: false
      })
      return this.buildWeekSummary(coachId, generation)
    }).catch(err => {
      if (generation === this._refreshGeneration && owner === this.studentOwner()) this.setData({ coachLoading: false, slotsError: err.message || '排课加载失败，请重试' })
    })
  },

  buildWeekSummary(coachId, generation) {
    const app = getApp()
    const start = this.data.selectedDate
    // 以选中日所在周：简化为选中日起 7 天
    const keys = time.listDateKeys(start, 7)
    return Promise.all(
      keys.map((k) =>
        bookingApi.listBookings(app, { coachId, dateKey: k }).then((res) => {
          const active = (res.data || []).filter((b) => {
            const s = b.status
            return s === 'pending' || s === 'confirmed' || s === 'in_progress'
          })
          const lab = time.formatDateLabel(k)
          return { dateKey: k, weekday: lab.weekday, day: lab.day, count: active.length }
        })
      )
    ).then((weekSummary) => { if (generation === this._refreshGeneration) this.setData({ weekSummary }) })
  },

  slotKey(slot) {
    return String(slot.startAt) + ':' + String(slot.courseTypeId)
  },
  onScheduleTools() { this.setData({ showScheduleTools: !this.data.showScheduleTools }) },
  onOpenSlotsToggle() { this.setData({ showOpenSlots: !this.data.showOpenSlots }) },

  selectionState(selectedSlots) {
    const list = (selectedSlots || []).slice().sort((a, b) => a.startAt - b.startAt)
    const summary = list.length
      ? list.map((s) => s.startLabel + ' ' + s.courseName).join('、')
      : ''
    return {
      selectedSlots: list,
      selectedCount: list.length,
      selectedSummary: summary
    }
  },

  applySlotSelection(selectedSlots) {
    const keys = {}
    ;(selectedSlots || []).forEach((slot) => { keys[this.slotKey(slot)] = true })
    const daySlots = (this.data.daySlots || []).map((slot) =>
      Object.assign({}, slot, { selected: !!(slot.available && keys[this.slotKey(slot)]) })
    )
    this.setData(Object.assign({
      daySlots,
      actionState: 'idle',
      bookingError: ''
    }, this.selectionState(daySlots.filter((slot) => slot.selected))))
  },

  onPickDate(e) {
    if (this._bookingBusy || this._bookingModal || this.data.actionState === 'error') return
    const key = e.detail.value || e.currentTarget.dataset.key
    if (!this.data.dateList.some(item => item.dateKey === key)) return
    const lab = time.formatDateLabel(key)
    this.setData({
      selectedDate: key,
      selectedSlots: [],
      selectedCount: 0,
      selectedSummary: '',
      timeOptions: [],
      daySlots: [],
      actionState: 'idle',
      bookingError: '',
      monthTitle: lab.year + ' 年 ' + lab.month + ' 月'
    })
    this.refresh()
  },

  onTimePick(e) {
    if (this._bookingBusy || this._bookingModal || this.data.actionState === 'error') return
    const timeIndex = Number(e.detail.value)
    const item = this.data.timeOptions[timeIndex]
    if (!item || !item.slot) return
    this.setData({ timeIndex })
    this.toggleSlot(item.slot)
  },
  onMotion(e) { interaction.setReducedMotion(e.detail.value); this.setData({ reduced: !!e.detail.value }) },
  studentOwner() { const app = getApp(); return app.globalData.session.user.userId + ':' + app.globalData.role },
  onResetBooking() { if (!this._bookingBusy) { this._retryBookingList = null; this.setData({ actionState: 'idle', bookingError: '' }); this.refresh() } },

  toggleSlot(slot) {
    if (!slot || !slot.available) return
    const key = this.slotKey(slot)
    const current = this.data.selectedSlots || []
    const exists = current.some((item) => this.slotKey(item) === key)
    const next = exists
      ? current.filter((item) => this.slotKey(item) !== key)
      : current.concat([slot])
    this.applySlotSelection(next)
  },

  onSelectSlot(e) {
    if (this._bookingBusy || this._bookingModal || this.data.actionState === 'error') return
    const startAt = Number(e.currentTarget.dataset.start)
    const courseTypeId = e.currentTarget.dataset.course
    const slot = (this.data.daySlots || []).find(
      (item) => item.startAt === startAt && item.courseTypeId === courseTypeId
    )
    if (slot) this.toggleSlot(slot)
  },

  onBookSelected() {
    const slots = this.data.selectedSlots || []
    if (!slots.length || this.data.slotsLoading) return
    this.onRequestBookMulti(slots)
  },

  onCoachTab(e) {
    this.setData({ coachTab: e.currentTarget.dataset.tab })
  },

  goBind() {
    wx.navigateTo({ url: '/pages/bind/index' })
  },

  goRules() {
    wx.navigateTo({ url: '/pages/schedule-rules/index' })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/booking-detail/index?id=' + id })
  },

  /**
   * 交互：仅打开确认框，确认后才调用 createBooking（修复原型先写 booked）
   * 支持一次提交多个已选时段。
   */
  onRequestBookMulti(slots) {
    if (this._bookingBusy || this._bookingModal || this.data.slotsLoading) return
    if (this.data.actionState === 'error' && this._retryBookingList && this._retryBookingList.length) {
      return this.submitBookings(this._retryBookingList)
    }
    const valid = (slots || []).filter((slot) =>
      this.data.daySlots.some(
        (row) =>
          row.startAt === slot.startAt &&
          row.courseTypeId === slot.courseTypeId &&
          row.available &&
          Number(row.startAt) > Date.now()
      )
    )
    if (!valid.length) return
    const dateKey = this.data.selectedDate
    const linesText = valid
      .slice()
      .sort((a, b) => a.startAt - b.startAt)
      .map((s) => s.startLabel + '「' + s.courseName + '」')
      .join('\n')
    this._bookingModal = true
    wx.showModal({
      title: valid.length > 1 ? '批量预约确认' : '预约确认',
      content:
        '预约 ' +
        dateKey +
        ' 共 ' +
        valid.length +
        ' 个时段：\n' +
        linesText +
        '\n提交后为待确认，教练接受前可撤回。取消弹层不会创建预约。',
      confirmText: '提交预约',
      success: (res) => {
        this._bookingModal = false
        if (!res.confirm) return
        this.submitBookings(valid)
      },
      fail: () => {
        this._bookingModal = false
      }
    })
  },

  submitBookings(slots) {
    if (this._bookingBusy) return Promise.resolve()
    const list = (slots || []).slice().sort((a, b) => a.startAt - b.startAt)
    if (!list.length) return Promise.resolve()
    this._bookingBusy = true
    const app = getApp()
    const user = app.globalData.session.user
    const owner = this.studentOwner()
    this._retryBookingList = list
    this.setData({ submitting: true, actionState: 'submitting', bookingError: '' })

    const created = []
    const failed = []

    const runNext = (index) => {
      if (owner !== this.studentOwner()) return Promise.resolve()
      if (index >= list.length) return Promise.resolve()
      const slot = list[index]
      const idem =
        'book_' + user.userId + '_' + this.data.coachId + '_' + slot.startAt + '_' + slot.courseTypeId
      return bookingApi
        .createBooking(
          app,
          {
            coachId: this.data.coachId,
            studentId: user.userId,
            studentName: user.displayName,
            startAt: slot.startAt,
            courseTypeId: slot.courseTypeId,
            acceptedRulesVersion: SCHEDULE_CONFIG.rulesVersion
          },
          idem
        )
        .then((resp) => {
          created.push(resp.data)
          return runNext(index + 1)
        })
        .catch((err) => {
          failed.push({ slot, err })
          // Independent slots continue after a conflict so later selections are not lost.
          return runNext(index + 1)
        })
    }

    return runNext(0)
      .then(() => {
        if (owner !== this.studentOwner()) return
        this._bookingBusy = false
        this.setData({ submitting: false })
        if (!failed.length && created.length) {
          this._retryBookingList = null
          const actionState = interaction.bookingState(created[0])
          this.setData(Object.assign({ actionState }, this.selectionState([])))
          wx.showModal({
            title:
              created.length > 1
                ? '已提交 ' + created.length + ' 个预约'
                : actionState === 'confirmed'
                  ? '预约成功'
                  : '已提交，等待教练确认',
            content:
              '成功 ' +
              created.length +
              ' 个。状态以待确认为主，超时未确认将自动失效。',
            showCancel: false,
            success: () => {
              if (created[0] && created[0].booking_id) {
                wx.navigateTo({
                  url: '/pages/booking-detail/index?id=' + created[0].booking_id
                })
              }
            }
          })
          this.refresh()
          return
        }
        if (created.length && failed.length) {
          const remain = failed.map((row) => row.slot)
          this._retryBookingList = remain
          const bookingError =
            '已成功 ' + created.length + ' 个，失败 ' + failed.length + ' 个。可重试剩余时段。'
          this.setData(
            Object.assign(
              { actionState: 'error', bookingError },
              this.selectionState(remain)
            )
          )
          wx.showModal({
            title: '部分预约失败',
            content: bookingError,
            showCancel: false,
            success: () => this.refresh()
          })
          return
        }
        const err = failed[0] && failed[0].err
        const msg = (err && err.message) || '预约失败'
        if (err && ['SLOT_CONFLICT', 'BOOKING_WINDOW_CLOSED'].includes(err.code)) {
          this._retryBookingList = null
          this.setData(
            Object.assign(
              {
                actionState: 'idle',
                bookingError: msg + '。请重新选择并确认时段。'
              },
              this.selectionState([])
            )
          )
          wx.showModal({
            title: '时段冲突',
            content: msg + '，已刷新可约时段。',
            showCancel: false,
            success: () => this.refresh()
          })
          return
        }
        this.setData({
          actionState: 'error',
          bookingError: msg + '。可重试；网络中断时将沿用同一请求编号。'
        })
        app.toast(msg)
      })
      .catch(() => {
        this._bookingBusy = false
        this.setData({ submitting: false, actionState: 'error' })
      })
  },

  onAccept(e) {
    this.decide(e, 'accept')
  },

  onReject(e) {
    const id = e.currentTarget.dataset.id
    const rev = Number(e.currentTarget.dataset.rev)
    wx.showModal({
      title: '拒绝预约',
      content: '确认拒绝？拒绝后时段释放。点取消不会改动预约。',
      confirmText: '确认拒绝',
      success: (res) => {
        if (!res.confirm) return
        this.decide({ currentTarget: { dataset: { id, rev } } }, 'reject', '教练拒绝')
      }
    })
  },

  decide(e, action, reason) {
    const app = getApp()
    const id = e.currentTarget.dataset.id
    const revision = Number(e.currentTarget.dataset.rev)
    const coachId =
      (app.globalData.session.user.coachProfile &&
        app.globalData.session.user.coachProfile.coachId) ||
      'coach_001'
    bookingApi
      .decideBooking(app, id, {
        action,
        reason: reason || '',
        revision,
        coachId
      })
      .then(() => {
        app.toast(action === 'accept' ? '已确认' : '已拒绝')
        this.refresh()
      })
      .catch((err) => app.toast((err && err.message) || '操作失败'))
  },

  onAcceptChange(e) {
    const app = getApp()
    const coachId =
      (app.globalData.session.user.coachProfile &&
        app.globalData.session.user.coachProfile.coachId) ||
      'coach_001'
    bookingApi
      .decideChange(app, e.currentTarget.dataset.id, { action: 'accept', coachId })
      .then(() => {
        app.toast('改期已生效')
        this.refresh()
      })
      .catch((err) => app.toast((err && err.message) || '失败'))
  },

  onRejectChange(e) {
    const app = getApp()
    const coachId =
      (app.globalData.session.user.coachProfile &&
        app.globalData.session.user.coachProfile.coachId) ||
      'coach_001'
    bookingApi
      .decideChange(app, e.currentTarget.dataset.id, { action: 'reject', coachId })
      .then(() => {
        app.toast('已拒绝改期，原课保留')
        this.refresh()
      })
      .catch((err) => app.toast((err && err.message) || '失败'))
  }
})
