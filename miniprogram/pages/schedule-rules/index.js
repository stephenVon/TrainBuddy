const { requireLogin, requireCoachRole } = require('../../utils/guard')
const bookingApi = require('../../services/bookingApi')
const time = require('../../utils/time')
const { SCHEDULE_CONFIG } = require('../../utils/scheduleConfig')

const WD = ['日', '一', '二', '三', '四', '五', '六']

Page({
  data: {
    demoTools: false,
    rules: [],
    exceptions: [],
    baseRevision: 0,
    minBook: SCHEDULE_CONFIG.minBookAheadMin,
    cancelH: SCHEDULE_CONFIG.cancelOrChangeAheadMin / 60,
    pendingH: SCHEDULE_CONFIG.pendingExpireMin / 60
  },

  onLoad(query) {
    let develop = false
    try { develop = wx.getAccountInfoSync().miniProgram.envVersion === 'develop' } catch (_) {}
    this.setData({ demoTools: develop && !!query && query.demo === '1' })
  },
  onShow() {
    if (!requireCoachRole(this)) return
    this.reload()
  },

  coachId() {
    const app = getApp()
    return (
      (app.globalData.session.user.coachProfile &&
        app.globalData.session.user.coachProfile.coachId) ||
      'coach_001'
    )
  },

  reload() {
    const app = getApp()
    bookingApi.getAvailability(app, this.coachId()).then((res) => {
      const rules = (res.data.rules || []).map((r) =>
        Object.assign({}, r, { weekdayLabel: WD[r.weekday] })
      )
      const exceptions = (res.data.exceptions || []).map((ex) =>
        Object.assign({}, ex, {
          rangeText:
            time.isoShanghai(ex.startAt) + ' ~ ' + time.isoShanghai(ex.endAt)
        })
      )
      this.setData({
        rules,
        exceptions,
        baseRevision: res.data.base_revision
      })
    })
  },

  onAddSunday() {
    if (!this.data.demoTools) return
    const app = getApp()
    const rules = this.data.rules
      .map((r) => ({
        id: r.id,
        weekday: r.weekday,
        startLocal: r.startLocal,
        endLocal: r.endLocal,
        durationMin: r.durationMin,
        bufferMin: r.bufferMin,
        location: r.location,
        courseTypeId: r.courseTypeId
      }))
      .concat([
        {
          weekday: 0,
          startLocal: '10:00',
          endLocal: '14:00',
          durationMin: 60,
          bufferMin: 0,
          location: '私教工作室',
          courseTypeId: 'private_strength_60'
        }
      ])

    bookingApi
      .patchAvailability(app, this.coachId(), {
        rules,
        baseRevision: this.data.baseRevision
      })
      .then(() => {
        app.toast('已更新周规则')
        this.reload()
      })
      .catch((err) => app.toast((err && err.message) || '保存失败'))
  },

  onCloseTomorrowMorning() {
    if (!this.data.demoTools) return
    const app = getApp()
    const tomorrow = time.addDays(time.todayKey(), 1)
    const startAt = time.shanghaiLocalToMs(tomorrow, '09:00')
    const endAt = time.shanghaiLocalToMs(tomorrow, '12:00')
    bookingApi
      .addException(app, {
        coachId: this.coachId(),
        startAt,
        endAt,
        type: 'closed',
        reason: '临时休息'
      })
      .then(() => {
        app.toast('已添加关闭例外')
        this.reload()
      })
  }
})
