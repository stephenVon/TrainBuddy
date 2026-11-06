const { syncRoleBar } = require('../../utils/role')
const { requireLogin } = require('../../utils/guard')
const growthApi = require('../../services/growthApi')
const diaryApi = require('../../services/diaryApi')
const trainingApi = require('../../services/trainingApi')
const bodyApi = require('../../services/bodyMeasurementApi')
const insights = require('../../utils/bodyInsights')
const time = require('../../utils/time')

Page({
  data: {
    role: 'student',
    monthLabel: '',
    calendarCells: [],
    selectedDate: '',
    dayDetail: null,
    summary: null,
    weekBars: [],
    weekGoal: {
      rate: null,
      sessions: 0,
      days: 0,
      streak: 0,
      ringDeg: 0,
      hasRate: false,
      empty: true
    },
    highlights: [],
    records: [],
    loading: false,
    error: '',
    chartReady: false,
    legend: [
      { key: 'workout', label: '训练', cls: 'dot-workout' },
      { key: 'rest', label: '休息（主动标记）', cls: 'dot-rest' },
      { key: 'meal', label: '饮食', cls: 'dot-meal' },
      { key: 'body', label: '日记状态', cls: 'dot-body' },
      { key: 'measure', label: '身体测量', cls: 'dot-measure' },
      { key: 'incomplete', label: '未完成', cls: 'dot-incomplete' }
    ]
  },

  onShow() {
    if (!requireLogin(this)) return
    syncRoleBar(this)
    const today = time.todayKey()
    this.setData({ selectedDate: this.data.selectedDate || today, chartReady: false })
    this.reload()
  },

  goBodyData() {
    wx.navigateTo({ url: '/pages/body-data/index' })
  },

  goTool(e) {
    const tool = e.currentTarget.dataset.tool
    if (!['food', 'posture', 'goal'].includes(tool)) return
    wx.navigateTo({ url: '/pages/ai/index?tool=' + tool })
  },

  goRecord() {
    wx.navigateTo({ url: '/pages/record/index' })
  },

  studentId() {
    return getApp().globalData.session.user.userId
  },

  reload() {
    this.setData({ loading: true, error: '' })
    const app = getApp()
    const studentId = this.studentId()
    const today = time.todayKey()
    const range = growthApi.monthRange(today)

    return Promise.all([
      growthApi.getSummary(app, studentId),
      diaryApi.getCalendarMarkers(app, studentId, range.from, range.to),
      trainingApi.listSessions(app, {
        studentId,
        status: ['completed']
      }),
      bodyApi.list().catch(() => ({ data: [] }))
    ])
      .then(([sumRes, markRes, sessRes, bodyRes]) => {
        const markerMap = {}
        ;(markRes.data || []).forEach((m) => {
          markerMap[m.date] = m
        })
        const measureDates = {}
        ;(bodyRes.data || []).forEach((row) => {
          if (row.date && row.values && Object.keys(row.values).length) measureDates[row.date] = true
        })
        const sessions = sessRes.data || []
        const summary = sumRes.data
        const weekBars = insights.presentWeekBars(summary && summary.bars)
        const rate = summary && summary.planCompletionRate != null ? summary.planCompletionRate : null
        const weekGoal = {
          rate,
          sessions: summary ? summary.sessionCount || 0 : 0,
          days: summary ? summary.trainingDays || 0 : 0,
          streak: summary ? summary.diaryStreak || 0 : 0,
          hasRate: rate != null,
          ringDeg: rate != null ? Math.min(100, Math.max(0, rate)) * 3.6 : 0,
          empty: !summary || (!!summary.empty && summary.empty.sessionCount && summary.empty.planCompletionRate)
        }
        const cells = this.buildCalendar(range.from, range.to, markerMap, measureDates, today)
        const p = time.parseDateKey(today)
        this.setData({
          summary,
          weekBars,
          weekGoal,
          monthLabel: p.y + '年' + p.m + '月',
          calendarCells: cells,
          highlights: insights.recentLoadHighlights(sessions),
          records: sessions.slice(0, 5).map((s) => ({
            id: s.session_id || s.id,
            text:
              s.business_date +
              ' · ' +
              s.title +
              ' · ' +
              s.done_sets +
              '/' +
              s.total_sets +
              ' 组'
          })),
          chartReady: true
        })
        return this.loadDayDetail(this.data.selectedDate)
      })
      .catch((err) => this.setData({ error: err.message || '训练统计加载失败，请重试' }))
      .then(() => this.setData({ loading: false }))
  },

  buildCalendar(from, to, markerMap, measureDates, today) {
    const firstMs = time.shanghaiLocalToMs(from, '12:00')
    const startWd = time.toShanghaiParts(firstMs).weekday
    const pad = startWd === 0 ? 6 : startWd - 1
    const cells = []
    for (let i = 0; i < pad; i++) {
      cells.push({ empty: true, key: 'pad_' + i })
    }
    let cursor = from
    while (cursor <= to) {
      const m = markerMap[cursor] || {}
      const dots = []
      // 仅展示服务端真实标记；无记录日期不加休息点
      if (m.hasWorkout) dots.push('workout')
      if (m.restDay) dots.push('rest')
      if (m.hasMeal) dots.push('meal')
      if (m.hasBodyState) dots.push('body')
      if (measureDates[cursor]) dots.push('measure')
      if (m.planIncomplete) dots.push('incomplete')
      const d = time.parseDateKey(cursor)
      cells.push({
        empty: false,
        key: cursor,
        date: cursor,
        day: d.day,
        isToday: cursor === today,
        isSelected: cursor === this.data.selectedDate,
        dots,
        hasAny: dots.length > 0
      })
      cursor = time.addDays(cursor, 1)
    }
    return cells
  },

  onPickDay(e) {
    const date = e.currentTarget.dataset.date
    if (!date) return
    const cells = this.data.calendarCells.map((c) =>
      Object.assign({}, c, { isSelected: !c.empty && c.date === date })
    )
    this.setData({ selectedDate: date, calendarCells: cells })
    this.loadDayDetail(date)
  },

  loadDayDetail(date) {
    const app = getApp()
    const studentId = this.studentId()
    return Promise.all([
      diaryApi.getDailyView(app, studentId, date),
      bodyApi.list().catch(() => ({ data: [] }))
    ]).then(([res, bodyRes]) => {
      const v = res.data
      const markers = []
      if (v.sessions && v.sessions.length) markers.push('有训练 ' + v.sessions.length + ' 次')
      if (v.restDay) markers.push('休息日（主动标记）')
      if (v.meals && v.meals.length) markers.push('饮食 ' + v.meals.length + ' 条')
      if (v.waterTotalMl) markers.push('饮水 ' + v.waterTotalMl + 'ml')
      if (v.bodyState) markers.push('已记日记身体状态')
      const measures = (bodyRes.data || []).filter((row) => row.date === date)
      if (measures.length) markers.push('身体测量 ' + measures.length + ' 条')
      this.setData({
        dayDetail: {
          date,
          markers,
          sessions: v.sessions || [],
          measures: measures.map((row) => ({
            id: row.id || row.date + '_' + (row.time || ''),
            time: row.time || row.timeLabel || '时间未记录',
            text: Object.keys(row.values || [])
              .map((key) => {
                const metric = bodyApi.METRICS.find((item) => item.key === key)
                return (metric ? metric.label : key) + ' ' + row.values[key] + (metric ? metric.unit : '')
              })
              .join(' · ')
          })),
          empty: !markers.length
        }
      })
    }).catch((err) => this.setData({ error: err.message || '当日记录读取失败，请重试' }))
  },

  goDiary() {
    wx.navigateTo({ url: '/pages/diary/index' })
  },

  goExercises() {
    wx.navigateTo({ url: '/pages/exercises/index' })
  },

  goWorkout() {
    wx.redirectTo({ url: '/pages/workout/index' })
  }
})
