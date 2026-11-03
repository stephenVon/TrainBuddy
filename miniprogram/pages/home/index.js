const { syncRoleBar, goProfile } = require('../../utils/role')
const { requireLogin } = require('../../utils/guard')
const { canActivateRole } = require('../../utils/permission')
const bindingApi = require('../../services/bindingApi')
const bookingApi = require('../../services/bookingApi')
const growthApi = require('../../services/growthApi')
const trainingApi = require('../../services/trainingApi')
const time = require('../../utils/time')
const { trainingOverview, upcoming } = require('../../utils/homePresenter')

Page({
  data: {
    role: 'student',
    canSwitchCoach: false,
    streak: 0,
    weekCount: 0,
    planRateText: '暂无',
    nextBooking: null,
    pendingCoachCount: 0,
    sessions: [],
    hasBinding: false,
    coachName: '教练',
    boundCount: 0,
    avatarChar: '我',
    hasStats: false, loading: false, syncError: '', trainingError: '', bookingError: '',
    trainingTitle: '正在读取训练计划', trainingSubtitle: '', trainingAction: '查看训练',
    exerciseCount: 0, totalSets: 0, doneSets: 0, progressPercent: 0,
    activeSession: null, todayPlan: null, todayPlanDone: false, planCount: 0, recentSessions: [],
    todayCourses: [], todayCourseCount: 0, trainingDays: 0, volumeText: '—', todayLabel: ''
  },

  onShow() {
    if (!requireLogin(this)) return
    this.refreshPage()
  },
  onUnload() { this._generation = (this._generation || 0) + 1 },

  refreshPage() {
    const app = getApp()
    const generation = this._generation = (this._generation || 0) + 1
    syncRoleBar(this)
    const user = app.globalData.session.user
    const owner = user.userId + ':' + app.globalData.role
    const current = () => generation === this._generation && app.globalData.session && owner === app.globalData.session.user.userId + ':' + app.globalData.role
    const today = time.todayKey(), label = time.formatDateLabel(today)
    this.setData({
      canSwitchCoach: canActivateRole(app, 'coach'),
      avatarChar: (user.displayName || '我').slice(0, 1), loading: true, syncError: '', trainingError: '', bookingError: '',
      todayLabel: label.month + '月' + Number(label.day) + '日 · ' + label.weekday,
      hasStats: false, sessions: [], todayCourses: [], todayCourseCount: 0, pendingCoachCount: 0,
      boundCount: 0, nextBooking: null, recentSessions: [], activeSession: null,
      todayPlan: null, todayPlanDone: false, trainingTitle: '正在读取训练计划', trainingSubtitle: '', trainingAction: '查看训练',
      exerciseCount: 0, totalSets: 0, doneSets: 0, progressPercent: 0, planCount: 0, planRateText: '—'
    })

    const profile = bindingApi.refreshMe(app)
      .then((me) => {
        if (!current()) return null
        if (me && me.grantedRoles) {
          app.globalData.session.grantedRoles = me.grantedRoles
          app.globalData.grantedRoles = me.grantedRoles
          syncRoleBar(this)
        }
        const primary = bindingApi.getActivePrimaryCoach(app, user.userId)
        this.setData({ hasBinding: !!primary, coachName: primary ? primary.coachName : '教练' })
        return primary
      })
      .catch(err => { if (current()) this.setData({ syncError: err.message || '关系同步失败，请重试' }) })

    let tasks
    if (app.globalData.role === 'student') {
      tasks = [profile,
        growthApi.getSummary(app, user.userId).then((res) => {
          if (!current()) return
          const s = res.data
          this.setData({
            streak: s.diaryStreak || 0,
            weekCount: s.sessionCount,
            hasStats: true, trainingDays: s.trainingDays || 0,
            volumeText: s.empty && s.empty.volume ? '—' : String(s.volumeKg),
            planRateText:
              s.planCompletionRate != null ? s.planCompletionRate + '%' : '暂无'
          })
        }),
        profile.then(primary => {
          if (!primary || !current()) return
          return bookingApi
            .listBookings(app, {
              studentId: user.userId,
              status: ['pending', 'confirmed']
            })
            .then((res) => {
              if (!current()) return
              const next = upcoming(res.data, Date.now())
              this.setData({
                nextBooking: next
                  ? Object.assign({}, next, {
                      statusLabel: bookingApi.statusLabel(next.status)
                    })
                  : null
              })
            })
            .catch(err => { if (current()) this.setData({ bookingError: err.message || '预约加载失败' }) })
        }),
        Promise.all([
          trainingApi.listPlansForStudent(app, user.userId),
          trainingApi.listSessions(app, { studentId: user.userId, status: ['draft', 'in_progress', 'completed'] })
        ]).then(([plans, sessions]) => {
          if (!current()) return
          const rows = sessions.data || []
          const active = rows.find(row => row.source_type === 'from_plan' && ['draft', 'in_progress'].includes(row.status)) || rows.find(row => ['draft', 'in_progress'].includes(row.status))
          this.setData(Object.assign(trainingOverview(active, plans.data, today, rows), {
            recentSessions: rows.filter(row => row.status === 'completed').sort((a, b) => String(b.business_date).localeCompare(String(a.business_date))).slice(0, 3)
          }))
        }).catch(err => { if (current()) this.setData({ trainingError: err.message || '训练计划加载失败' }) })
      ]
    } else {
      const coachId = user.coachProfile && user.coachProfile.coachId
      tasks = [profile,
        bindingApi.listBoundStudentsForCoachAsync(app).then(bound => { if (current()) this.setData({ sessions: (bound || []).map(student => Object.assign({}, student, { initial: (student.name || '?').slice(0,1) })), boundCount: (bound || []).length }) }),
        coachId ? Promise.all([
          bookingApi.listBookings(app, { coachId, status: ['pending'] }),
          bookingApi.listBookings(app, { coachId, dateKey: today })
        ]).then(([pending, day]) => {
          if (!current()) return
          const todayCourses = (day.data || []).filter(row => ['pending','confirmed','in_progress','completed'].includes(row.status)).sort((a, b) => a.startAt - b.startAt).map(row => Object.assign({}, row, { statusLabel: bookingApi.statusLabel(row.status) }))
          this.setData({ pendingCoachCount: (pending.data || []).length, todayCourses, todayCourseCount: todayCourses.length })
        }).catch(err => { if (current()) this.setData({ bookingError: err.message || '课程加载失败' }) }) : Promise.reject(Error('教练档案尚未配置，请前往个人中心核对'))
      ]
    }
    return Promise.all(tasks.map(task => Promise.resolve(task).catch(err => { if (current()) this.setData({ syncError: err.message || '部分内容加载失败，请重试' }) })))
      .then(() => { if (current()) this.setData({ loading: false }) })
  },

  goProfile,
  goPlans() { wx.navigateTo({ url: '/pages/plans/index' }) },
  goCoach() { wx.redirectTo({ url: '/pages/coach/index' }) },
  goStudents() { wx.redirectTo({ url: '/pages/students/index' }) },
  goCourse(e) { const id = e.currentTarget.dataset.id; if (id) wx.navigateTo({ url: '/pages/booking-detail/index?id=' + id }) },

  goBind() {
    wx.navigateTo({ url: '/pages/bind/index' })
  },

  onMsg() {
    getApp().toast('暂时没有新消息')
  },

  goWorkout() {
    wx.redirectTo({ url: '/pages/workout/index' })
  },

  onTrainingCta() {
    if (this.data.trainingError) return this.refreshPage()
    if (this.data.todayPlanDone && !this.data.activeSession) return this.goGrowth()
    return this.goWorkout()
  },

  goGrowth() {
    wx.redirectTo({ url: '/pages/growth/index' })
  },

  goDiary() {
    wx.navigateTo({ url: '/pages/diary/index' })
  },

  goExercises() {
    wx.navigateTo({ url: '/pages/exercises/index' })
  },

  goStudentProfile(e) {
    const studentId = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.student || ''
    wx.navigateTo({
      url:
        '/pages/student-profile/index?studentId=' +
        studentId +
        '&name=' +
        encodeURIComponent(name)
    })
  },

  goBooking() {
    wx.redirectTo({ url: '/pages/booking/index' })
  },

  goNextBooking() {
    const b = this.data.nextBooking
    if (!b) {
      this.goBooking()
      return
    }
    wx.navigateTo({ url: '/pages/booking-detail/index?id=' + b.booking_id })
  },

  goRecord() {
    wx.navigateTo({ url: '/pages/record/index?pick=1' })
  },

  goPosture() { wx.navigateTo({ url: '/pages/ai/index?tool=posture' }) },
  goInvite() { wx.navigateTo({ url: '/pages/profile/index?invite=1' }) },
  goCourseRecord(e) {
    const course = this.data.todayCourses.find(row => row.booking_id === e.currentTarget.dataset.id)
    if (!course) return
    this.goRecordFor({ currentTarget: { dataset: { id: course.student_id, student: course.student_name } } })
  },
  goRecordFor(e) {
    const app = getApp()
    const studentId = e.currentTarget.dataset.id
    const check = require('../../utils/permission').canCoachReadStudent(
      app,
      app.globalData.session.user.userId,
      studentId
    )
    if (!check.ok) {
      app.toast(check.message || '无权访问')
      return
    }
    app.globalData.student = e.currentTarget.dataset.student
    app.globalData.activeSubjectId = studentId
    app.persist()
    wx.redirectTo({ url: '/pages/record/index' })
  }
})
