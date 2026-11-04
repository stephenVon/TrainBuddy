/**
 * 每日日记（S07）：训练/饮食/饮水/状态/特殊情况/打卡拆分存储
 * 共享按类别授权，不默认共享全部历史
 */

const time = require('../lib/time')
const { makeId: makeIdLib } = require('../lib/ids')
const bindingApi = require('./bindingAdapter')

const MEAL_TYPES = [
  { key: 'breakfast', label: '早餐' },
  { key: 'lunch', label: '午餐' },
  { key: 'dinner', label: '晚餐' },
  { key: 'snack', label: '加餐' }
]

const SPECIAL_TYPES = [
  { key: 'travel', label: '出差' },
  { key: 'overtime', label: '加班' },
  { key: 'period', label: '生理期' },
  { key: 'injury', label: '受伤/不适' },
  { key: 'other', label: '其他' }
]

function makeId(prefix) { return makeIdLib(prefix) }

function ensureStore(app) {
  const gd = app.globalData
  if (!gd.diary) {
    gd.diary = {
      dailyLogs: [],
      meals: [],
      waters: [],
      bodyStates: [],
      feedbacks: [],
      dayShares: {} // key: studentId|date|category -> { sharedAt, recipientCoachUserId }
    }
  }
  return gd.diary
}

function persist(app) {
  app.persist()
}

function shareKey(studentId, date, category) {
  return studentId + '|' + date + '|' + category
}

function getOrCreateDailyLog(store, studentId, localDate) {
  let log = store.dailyLogs.find(
    (d) => d.studentId === studentId && d.localDate === localDate
  )
  if (!log) {
    log = {
      id: makeId('dlog'),
      studentId,
      localDate,
      restDay: false,
      note: '',
      createdAt: time.nowMs(),
      updatedAt: time.nowMs()
    }
    store.dailyLogs.push(log)
  }
  return log
}

function withinBackfillWindow(localDate) {
  const today = time.todayKey()
  const min = time.addDays(today, -30)
  return localDate >= min && localDate <= today
}

function getDailyView(app, studentId, localDate) {
  const store = ensureStore(app)
  const log = store.dailyLogs.find(
    (d) => d.studentId === studentId && d.localDate === localDate
  )
  const meals = store.meals.filter(
    (m) => m.studentId === studentId && m.localDate === localDate && !m.deletedAt
  )
  const waters = store.waters.filter(
    (w) => w.studentId === studentId && w.localDate === localDate
  )
  const waterTotal = waters.reduce((s, w) => s + (w.amountMl || 0), 0)
  const body = store.bodyStates.find(
    (b) => b.studentId === studentId && b.localDate === localDate
  )

  // 关联当天训练会话
  const trainingApi = require('./trainingService')
  const training = app.globalData.training || { sessions: [] }
  const sessions = (training.sessions || []).filter(
    (s) =>
      s.studentId === studentId &&
      s.businessDate === localDate &&
      s.status === 'completed'
  )

  const categories = ['workout_self', 'meal', 'body_state', 'special']
  const shares = {}
  const primary = bindingApi.getActivePrimaryCoach(app, studentId)
  categories.forEach((c) => {
    const sk = shareKey(studentId, localDate, c)
    shares[c] = !!(primary && store.dayShares[sk] && store.dayShares[sk].recipientCoachUserId === primary.coachUserId)
  })

  const sessionRows = sessions.map((s) => ({
    id: s.id,
    title: s.title,
    doneSets: trainingApi.countDoneSets(s),
    sourceType: s.sourceType || '',
    sharedAt: s.sharedAt || null,
    publicNote: s.publicNote || '',
    coachId: s.coachId || null
  }))

  // 教练课后语音／文字点评：已同步的课后表公开备注（学员可见）
  const coachNotes = sessionRows
    .filter((s) => s.sourceType === 'coach_post_session' && s.sharedAt)
    .map((s) => {
      const coachUser =
        (app.globalData.users || []).find(
          (u) =>
            u.userId === s.coachId ||
            (u.coachProfile && u.coachProfile.coachId === s.coachId)
        ) || null
      return {
        sessionId: s.id,
        title: s.title || '课后训练表',
        publicNote: (s.publicNote || '').trim(),
        doneSets: s.doneSets,
        coachName: (coachUser && coachUser.displayName) || '教练'
      }
    })

  return Promise.resolve({
    data: {
      localDate,
      restDay: !!(log && log.restDay),
      note: (log && log.note) || '',
      meals,
      waterTotalMl: waterTotal,
      waterRecords: waters,
      bodyState: body || null,
      sessions: sessionRows,
      coachNotes,
      shares,
      canEdit: withinBackfillWindow(localDate)
    },
    request_id: makeId('req')
  })
}

function setRestDay(app, studentId, localDate, restDay, note) {
  if (!withinBackfillWindow(localDate) && restDay) {
    // 未来日期只允许建计划，不允许实际打卡
    if (localDate > time.todayKey()) {
      return Promise.reject({ code: 'FUTURE_CHECKIN', message: '未来日期不能提交实际打卡' })
    }
  }
  if (localDate < time.addDays(time.todayKey(), -30)) {
    return Promise.reject({ code: 'BACKFILL_CLOSED', message: '已超过 30 天补录窗口' })
  }
  const store = ensureStore(app)
  const log = getOrCreateDailyLog(store, studentId, localDate)
  log.restDay = !!restDay
  if (note != null) log.note = note
  log.updatedAt = time.nowMs()
  persist(app)
  return getDailyView(app, studentId, localDate)
}

function addMeal(app, payload) {
  const { studentId, localDate, mealType, foodText, portionText } = payload
  if (localDate > time.todayKey()) {
    return Promise.reject({ code: 'FUTURE_CHECKIN', message: '未来日期不能记饮食' })
  }
  if (localDate < time.addDays(time.todayKey(), -30)) {
    return Promise.reject({ code: 'BACKFILL_CLOSED', message: '已超过补录窗口' })
  }
  const store = ensureStore(app)
  getOrCreateDailyLog(store, studentId, localDate)
  const meal = {
    id: makeId('meal'),
    studentId,
    localDate,
    mealType: mealType || 'snack',
    foodText: foodText || '',
    portionText: portionText || '',
    macrosG: payload.macrosG || { carbs: null, protein: null, fat: null },
    isEstimate: payload.isEstimate != null ? !!payload.isEstimate : false,
    sourceTaskId: payload.sourceTaskId || null,
    mediaId: payload.mediaId || null,
    mediaShared: false,
    items: payload.items || [],
    sharedToCoachUserId: null,
    sharedAt: null,
    syncStatus: 'none',
    syncError: null,
    createdAt: time.nowMs(),
    updatedAt: time.nowMs(),
    deletedAt: null
  }
  store.meals.push(meal)
  persist(app)
  return Promise.resolve({ data: meal, request_id: makeId('req') })
}

function deleteMeal(app, mealId, studentId) {
  const store = ensureStore(app)
  const meal = store.meals.find((m) => m.id === mealId && m.studentId === studentId)
  if (!meal) return Promise.reject({ code: 'NOT_FOUND', message: '饮食记录不存在' })
  meal.deletedAt = time.nowMs()
  persist(app)
  return Promise.resolve({ data: { ok: true }, request_id: makeId('req') })
}

/** 饮水：只支持分次累加，避免与总量双计 */
function addWater(app, studentId, localDate, amountMl) {
  if (localDate > time.todayKey()) {
    return Promise.reject({ code: 'FUTURE_CHECKIN', message: '未来日期不能记饮水' })
  }
  const amount = Number(amountMl)
  if (!amount || amount <= 0) {
    return Promise.reject({ code: 'INVALID', message: '请输入有效毫升数' })
  }
  const store = ensureStore(app)
  getOrCreateDailyLog(store, studentId, localDate)
  const row = {
    id: makeId('water'),
    studentId,
    localDate,
    amountMl: amount,
    createdAt: time.nowMs()
  }
  store.waters.push(row)
  persist(app)
  return getDailyView(app, studentId, localDate)
}

function upsertBodyState(app, studentId, localDate, patch) {
  if (localDate > time.todayKey()) {
    return Promise.reject({ code: 'FUTURE_CHECKIN', message: '未来日期不能记状态' })
  }
  const store = ensureStore(app)
  getOrCreateDailyLog(store, studentId, localDate)
  let body = store.bodyStates.find(
    (b) => b.studentId === studentId && b.localDate === localDate
  )
  if (!body) {
    body = {
      id: makeId('body'),
      studentId,
      localDate,
      sleepHours: null,
      fatigue: null,
      soreness: '',
      specialType: '',
      specialNote: '',
      updatedAt: time.nowMs()
    }
    store.bodyStates.push(body)
  }
  if (patch.sleepHours != null) body.sleepHours = patch.sleepHours
  if (patch.fatigue != null) body.fatigue = patch.fatigue
  if (patch.soreness != null) body.soreness = patch.soreness
  if (patch.specialType != null) body.specialType = patch.specialType
  if (patch.specialNote != null) body.specialNote = patch.specialNote
  body.updatedAt = time.nowMs()
  persist(app)
  return getDailyView(app, studentId, localDate)
}

/**
 * 按日+类别共享给主教练（逐次，不因开关回溯历史）
 */
function shareDayCategory(app, studentId, localDate, category) {
  const store = ensureStore(app)
  const binding = bindingApi.getActivePrimaryCoach(app, studentId)
  if (!binding) {
    return Promise.reject({ code: 'BINDING_INACTIVE', message: '尚未绑定教练' })
  }
  // 绑定 scopes 是持续授权开关；逐次共享仍写入 dayShares
  const scopeOff = binding.scopes && binding.scopes[category] === false
  const sk = shareKey(studentId, localDate, category)
  store.dayShares[sk] = {
    sharedAt: time.nowMs(),
    recipientCoachUserId: binding.coachUserId,
    category,
    localDate,
    studentId
  }
  persist(app)
  return getDailyView(app, studentId, localDate).then((res) => {
    res.scopeOff = scopeOff
    res.hint = scopeOff
      ? '当日已标记共享，但绑定授权未开启该类，请在隐私设置中打开'
      : null
    return res
  })
}

function revokeDayCategory(app, studentId, localDate, category) {
  const store = ensureStore(app)
  const sk = shareKey(studentId, localDate, category)
  delete store.dayShares[sk]
  persist(app)
  return getDailyView(app, studentId, localDate)
}

/** 教练可见饮食：默认不含原图 media_id */
function presentMealForCoach(m) {
  return {
    id: m.id,
    mealType: m.mealType,
    foodText: m.foodText,
    portionText: m.portionText,
    macros_g: m.macrosG || null,
    is_estimate: !!m.isEstimate,
    items: m.items || [],
    source_task_id: m.sourceTaskId || null,
    media_id: m.mediaShared ? m.mediaId || null : null,
    item_shared: !!m.sharedToCoachUserId,
    createdAt: m.createdAt
  }
}

/**
 * 教练读取某日日记：严格按授权过滤（AC22/AC23）
 */
function getSharedDailyForCoach(app, coachUserId, studentId, localDate) {
  const check = require('../lib/permissionAdapter').canCoachReadStudent(
    app,
    coachUserId,
    studentId
  )
  if (!check.ok) {
    return Promise.reject({ code: check.code, message: check.message })
  }

  const store = ensureStore(app)
  const binding = check.binding

  function shared(cat) {
    const sk = shareKey(studentId, localDate, cat)
    return !!(store.dayShares[sk] && store.dayShares[sk].recipientCoachUserId === coachUserId)
  }

  const result = {
    localDate,
    studentId,
    visible: {},
    hiddenReasons: {}
  }

  // 自主训练
  if (shared('workout_self') && binding.scopes.workout_self) {
    const training = app.globalData.training || { sessions: [] }
    result.visible.sessions = (training.sessions || [])
      .filter(
        (s) =>
          s.studentId === studentId &&
          s.businessDate === localDate &&
          s.status === 'completed'
      )
      .map((s) => ({ id: s.id, title: s.title, status: s.status }))
  } else {
    result.hiddenReasons.workout_self = shared('workout_self')
      ? '绑定未开自主训练授权'
      : '学员未共享该日训练'
  }

  // 饮食：整天共享 或 逐条共享（AI 营养记录），互不静默扩大范围
  const dayMealOk = shared('meal') && binding.scopes.meal
  const itemSharedMeals = store.meals.filter(
    (m) =>
      m.studentId === studentId &&
      m.localDate === localDate &&
      !m.deletedAt &&
      m.sharedToCoachUserId === coachUserId &&
      binding.scopes.meal
  )
  if (dayMealOk) {
    result.visible.meals = store.meals
      .filter(
        (m) =>
          m.studentId === studentId && m.localDate === localDate && !m.deletedAt
      )
      .map(presentMealForCoach)
    const waters = store.waters.filter(
      (w) => w.studentId === studentId && w.localDate === localDate
    )
    result.visible.waterTotalMl = waters.reduce((s, w) => s + w.amountMl, 0)
  } else if (itemSharedMeals.length) {
    result.visible.meals = itemSharedMeals.map(presentMealForCoach)
    result.visible.item_shared_only = true
  } else {
    result.hiddenReasons.meal = '记录不可见'
  }

  // 身体状态（不含特殊情况）
  if (shared('body_state') && binding.scopes.body_state) {
    const body = store.bodyStates.find(
      (b) => b.studentId === studentId && b.localDate === localDate
    )
    result.visible.bodyState = body
      ? {
          sleepHours: body.sleepHours,
          fatigue: body.fatigue,
          soreness: body.soreness
        }
      : null
  } else {
    result.hiddenReasons.body_state = '记录不可见'
  }

  // 特殊情况单独授权
  if (shared('special') && binding.scopes.special) {
    const body = store.bodyStates.find(
      (b) => b.studentId === studentId && b.localDate === localDate
    )
    result.visible.special = body
      ? { specialType: body.specialType, specialNote: body.specialNote }
      : null
  } else {
    result.hiddenReasons.special = '未授权特殊情况'
  }

  const log = store.dailyLogs.find(
    (d) => d.studentId === studentId && d.localDate === localDate
  )
  result.visible.restDay = !!(log && log.restDay)

  return Promise.resolve({ data: result, request_id: makeId('req') })
}

function addFeedback(app, payload) {
  const store = ensureStore(app)
  const row = {
    id: makeId('fb'),
    authorId: payload.authorId,
    authorName: payload.authorName || '',
    targetType: payload.targetType || 'daily_log',
    targetId: payload.targetId,
    studentId: payload.studentId,
    text: payload.text || '',
    createdAt: time.nowMs(),
    readAt: null
  }
  store.feedbacks.push(row)
  persist(app)
  return Promise.resolve({ data: row, request_id: makeId('req') })
}

function listFeedback(app, filter) {
  const store = ensureStore(app)
  let list = store.feedbacks.slice()
  if (filter.studentId) list = list.filter((f) => f.studentId === filter.studentId)
  if (filter.targetId) list = list.filter((f) => f.targetId === filter.targetId)
  list.sort((a, b) => b.createdAt - a.createdAt)
  return Promise.resolve({ data: list, request_id: makeId('req') })
}

/**
 * 日历标记（可同日多项）
 */
function getCalendarMarkers(app, studentId, fromDate, toDate) {
  const store = ensureStore(app)
  const training = app.globalData.training || { sessions: [] }
  const markers = {}

  function ensure(date) {
    if (!markers[date]) {
      markers[date] = {
        date,
        hasWorkout: false,
        restDay: false,
        hasMeal: false,
        hasBodyState: false,
        planIncomplete: false
      }
    }
    return markers[date]
  }

  ;(training.sessions || []).forEach((s) => {
    if (s.studentId !== studentId || s.status !== 'completed') return
    if (s.businessDate < fromDate || s.businessDate > toDate) return
    if (require('./trainingService').countDoneSets(s) > 0) {
      ensure(s.businessDate).hasWorkout = true
    }
  })

  store.dailyLogs.forEach((d) => {
    if (d.studentId !== studentId) return
    if (d.localDate < fromDate || d.localDate > toDate) return
    if (d.restDay) ensure(d.localDate).restDay = true
  })

  store.meals.forEach((m) => {
    if (m.studentId !== studentId || m.deletedAt) return
    if (m.localDate < fromDate || m.localDate > toDate) return
    ensure(m.localDate).hasMeal = true
  })

  store.bodyStates.forEach((b) => {
    if (b.studentId !== studentId) return
    if (b.localDate < fromDate || b.localDate > toDate) return
    if (
      b.sleepHours != null ||
      b.fatigue != null ||
      b.soreness ||
      b.specialType ||
      b.specialNote
    ) {
      ensure(b.localDate).hasBodyState = true
    }
  })

  // 计划未完成：有已发布计划日且无完成会话（简化：当日有 in_progress/abandoned 且无 completed）
  ;(training.sessions || []).forEach((s) => {
    if (s.studentId !== studentId) return
    if (s.businessDate < fromDate || s.businessDate > toDate) return
    if (s.status === 'abandoned' || s.status === 'in_progress') {
      const m = ensure(s.businessDate)
      if (!m.hasWorkout) m.planIncomplete = true
    }
  })

  return Promise.resolve({
    data: Object.keys(markers)
      .sort()
      .map((k) => markers[k]),
    request_id: makeId('req')
  })
}

module.exports = {
  MEAL_TYPES,
  SPECIAL_TYPES,
  ensureStore,
  getDailyView,
  setRestDay,
  addMeal,
  deleteMeal,
  addWater,
  upsertBodyState,
  shareDayCategory,
  revokeDayCategory,
  getSharedDailyForCoach,
  addFeedback,
  listFeedback,
  getCalendarMarkers,
  withinBackfillWindow
}
