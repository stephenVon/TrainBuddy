/**
 * 约课排班 mock API，语义对齐设计文档 API04–API10。
 * 不在确认前提前写入「已预约」。
 */

const { schedule: SCHEDULE_CONFIG } = require('../config')
const time = require('../lib/time')
const { makeId: makeIdLib } = require('../lib/ids')
const { AppError } = require('../lib/errors')
const pointsService = require('./pointsService')
const outboxService = require('./outboxService')

const ACTIVE_OCCUPY = {
  pending: true,
  confirmed: true,
  in_progress: true
}

function makeId(prefix) { return makeIdLib(prefix) }

function ensureStore(appOrState) {
  // 兼容：Express 侧传入 { globalData, persist } 适配器
  const gd = appOrState.globalData || appOrState
  if (!gd.schedule) {
    gd.schedule = {
      rulesByCoach: {},
      exceptions: [],
      bookings: [],
      changes: [],
      idempotency: {}
    }
    seedDefaultRules(gd.schedule)
  }
  if (!gd.schedule.idempotency) gd.schedule.idempotency = {}
  return gd.schedule
}

function seedDefaultRules(schedule) {
  // 林野默认：周一至周五 09:00-12:00、14:00-20:00；周六 10:00-16:00
  const coachId = 'coach_001'
  if (schedule.rulesByCoach[coachId]) return
  const rules = []
  ;[1, 2, 3, 4, 5].forEach((wd) => {
    rules.push(rule(coachId, wd, '09:00', '12:00'))
    rules.push(rule(coachId, wd, '14:00', '20:00'))
  })
  rules.push(rule(coachId, 6, '10:00', '16:00'))
  schedule.rulesByCoach[coachId] = {
    baseRevision: 1,
    rules
  }
}

function rule(coachId, weekday, startLocal, endLocal) {
  return {
    id: makeId('rule'),
    coachId,
    weekday,
    startLocal,
    endLocal,
    durationMin: SCHEDULE_CONFIG.defaultDurationMin,
    bufferMin: SCHEDULE_CONFIG.defaultBufferMin,
    location: '私教工作室',
    courseTypeId: 'private_strength_60',
    effectiveFrom: null,
    effectiveTo: null
  }
}

function getCourseType(id) {
  return (
    SCHEDULE_CONFIG.courseTypes.find((c) => c.id === id) ||
    SCHEDULE_CONFIG.courseTypes[0]
  )
}

function persist(app) {
  app.persist()
}

function expirePendings(store) {
  const now = time.nowMs()
  store.bookings.forEach((b) => {
    if (b.status === 'pending' && b.expiresAt && b.expiresAt <= now) {
      b.status = 'expired'
      b.updatedAt = now
      b.revision += 1
    }
  })
  store.changes.forEach((c) => {
    if (c.status === 'pending' && c.expiresAt && c.expiresAt <= now) {
      c.status = 'expired'
      c.updatedAt = now
    }
  })
}

function getOccupancies(store, { coachId, studentId, excludeBookingId, excludeChangeId }) {
  const list = []
  store.bookings.forEach((b) => {
    if (!ACTIVE_OCCUPY[b.status]) return
    if (excludeBookingId && b.id === excludeBookingId) return
    if (coachId && b.coachId !== coachId) return
    if (studentId && b.studentId !== studentId) return
    const buffer = (b.rulesSnapshot && b.rulesSnapshot.bufferMin) || 0
    list.push({
      type: 'booking',
      id: b.id,
      start: b.startAt - buffer * 60000,
      end: b.endAt + buffer * 60000,
      coachId: b.coachId,
      studentId: b.studentId,
      status: b.status
    })
  })
  store.changes.forEach((c) => {
    if (c.status !== 'pending') return
    if (excludeChangeId && c.id === excludeChangeId) return
    const booking = store.bookings.find((b) => b.id === c.bookingId)
    if (!booking) return
    if (coachId && booking.coachId !== coachId) return
    if (studentId && booking.studentId !== studentId) return
    const buffer = (booking.rulesSnapshot && booking.rulesSnapshot.bufferMin) || 0
    list.push({
      type: 'change',
      id: c.id,
      start: c.proposedStart - buffer * 60000,
      end: c.proposedEnd + buffer * 60000,
      coachId: booking.coachId,
      studentId: booking.studentId,
      status: 'change_pending'
    })
  })
  return list
}

function hasConflict(store, opts) {
  const { startAt, endAt, coachId, studentId, excludeBookingId, excludeChangeId } = opts
  if (coachId) {
    const coachOcc = getOccupancies(store, {
      coachId,
      excludeBookingId,
      excludeChangeId
    })
    for (let i = 0; i < coachOcc.length; i++) {
      if (time.overlaps(startAt, endAt, coachOcc[i].start, coachOcc[i].end)) {
        return { code: 'SLOT_CONFLICT', message: '该时间刚被预约，请重新选择', side: 'coach' }
      }
    }
  }
  if (studentId) {
    const stuOcc = getOccupancies(store, {
      studentId,
      excludeBookingId,
      excludeChangeId
    })
    for (let j = 0; j < stuOcc.length; j++) {
      if (time.overlaps(startAt, endAt, stuOcc[j].start, stuOcc[j].end)) {
        return { code: 'SLOT_CONFLICT', message: '你在该时段已有其他安排', side: 'student' }
      }
    }
  }
  return null
}

function isClosedByException(store, coachId, startAt, endAt) {
  return store.exceptions.some((ex) => {
    if (ex.coachId !== coachId) return false
    if (ex.type !== 'closed') return false
    return time.overlaps(startAt, endAt, ex.startAt, ex.endAt)
  })
}

function isOpenedByException(store, coachId, startAt, endAt) {
  return store.exceptions.some((ex) => {
    if (ex.coachId !== coachId) return false
    if (ex.type !== 'open') return false
    return startAt >= ex.startAt && endAt <= ex.endAt
  })
}

function rulesForDay(store, coachId, dateKey) {
  const pack = store.rulesByCoach[coachId]
  if (!pack) return []
  const wd = time.toShanghaiParts(time.shanghaiLocalToMs(dateKey, '12:00')).weekday
  return pack.rules.filter((r) => r.weekday === wd)
}

function generateCandidateStarts(dateKey, rule) {
  const starts = []
  const dayStart = time.shanghaiLocalToMs(dateKey, rule.startLocal)
  const dayEnd = time.shanghaiLocalToMs(dateKey, rule.endLocal)
  const duration = rule.durationMin * 60000
  const step = duration // 按课时步长切段
  for (let t = dayStart; t + duration <= dayEnd; t += step) {
    starts.push(t)
  }
  return starts
}

/** API05 GET /coaches/{id}/slots */
function getSlots(app, { coachId, fromDate, toDate, courseTypeId }) {
  const store = ensureStore(app)
  expirePendings(store)
  const course = getCourseType(courseTypeId || 'private_strength_60')
  const keys = []
  let cur = fromDate
  while (cur <= toDate) {
    keys.push(cur)
    cur = time.addDays(cur, 1)
  }
  const now = time.nowMs()
  const minStart = now + SCHEDULE_CONFIG.minBookAheadMin * 60000
  const openUntil = time.shanghaiLocalToMs(
    time.addDays(time.todayKey(), SCHEDULE_CONFIG.openDaysAhead),
    '23:59'
  )

  const slots = []
  keys.forEach((dateKey) => {
    const dayRules = rulesForDay(store, coachId, dateKey)
    dayRules.forEach((rule) => {
      generateCandidateStarts(dateKey, rule).forEach((startAt) => {
        const durationMin = course.durationMin || rule.durationMin
        const endAt = startAt + durationMin * 60000
        const buffer = rule.bufferMin || 0
        const occupyStart = startAt - buffer * 60000
        const occupyEnd = endAt + buffer * 60000

        let status = 'open'
        let reason = ''
        if (startAt < minStart) {
          status = 'closed'
          reason = 'BOOKING_WINDOW_CLOSED'
        } else if (startAt > openUntil) {
          status = 'closed'
          reason = 'OUT_OF_OPEN_RANGE'
        } else if (isClosedByException(store, coachId, occupyStart, occupyEnd)) {
          status = 'closed'
          reason = 'EXCEPTION_CLOSED'
        } else {
          const conflict = hasConflict(store, {
            startAt: occupyStart,
            endAt: occupyEnd,
            coachId,
            studentId: null
          })
          // 仅教练维度冲突 → 不可约，不泄露其他学员
          const coachOnly = getOccupancies(store, { coachId }).some((o) =>
            time.overlaps(occupyStart, occupyEnd, o.start, o.end)
          )
          if (coachOnly) {
            status = 'unavailable'
            reason = 'OCCUPIED'
          }
        }

        // 临时开放例外：若规则外但 open exception 覆盖，可额外放行（简化：仅标记）
        if (status === 'closed' && isOpenedByException(store, coachId, startAt, endAt)) {
          status = 'open'
          reason = 'EXCEPTION_OPEN'
        }

        slots.push({
          dateKey,
          startAt,
          endAt,
          startLabel: time.formatHm(startAt),
          endLabel: time.formatHm(endAt),
          status,
          reason,
          courseTypeId: course.id,
          courseName: course.name,
          location: rule.location || course.location,
          durationMin,
          bufferMin: buffer,
          // 学员端不可约只显示「不可约」，不带其他学员信息
          displayStatus:
            status === 'open' ? '可预约' : status === 'unavailable' ? '不可约' : '不可约'
        })
      })
    })
  })

  return Promise.resolve({
    data: {
      coachId,
      timezone: SCHEDULE_CONFIG.timezone,
      slots,
      config: {
        openDaysAhead: SCHEDULE_CONFIG.openDaysAhead,
        minBookAheadMin: SCHEDULE_CONFIG.minBookAheadMin
      }
    },
    request_id: makeId('req')
  })
}

/** API04 GET availability */
function getAvailability(app, coachId) {
  const store = ensureStore(app)
  const pack = store.rulesByCoach[coachId] || { baseRevision: 0, rules: [] }
  const exceptions = store.exceptions.filter((e) => e.coachId === coachId)
  return Promise.resolve({
    data: {
      coachId,
      base_revision: pack.baseRevision,
      rules: pack.rules,
      exceptions,
      config: SCHEDULE_CONFIG
    },
    request_id: makeId('req')
  })
}

/** API04 PATCH availability */
function patchAvailability(app, coachId, { rules, baseRevision, actorUserId }) {
  const store = ensureStore(app)
  const pack = store.rulesByCoach[coachId] || { baseRevision: 0, rules: [] }
  if (baseRevision != null && baseRevision !== pack.baseRevision) {
    return Promise.reject({
      code: 'REVISION_CONFLICT',
      message: '排班规则已被更新',
      retryable: false
    })
  }
  // 仅影响未预约空档：已确认课程不动
  pack.rules = (rules || []).map((r) =>
    Object.assign({}, r, {
      id: r.id || makeId('rule'),
      coachId,
      durationMin: r.durationMin || SCHEDULE_CONFIG.defaultDurationMin,
      bufferMin: r.bufferMin != null ? r.bufferMin : SCHEDULE_CONFIG.defaultBufferMin
    })
  )
  pack.baseRevision += 1
  store.rulesByCoach[coachId] = pack
  persist(app)
  return Promise.resolve({
    data: { base_revision: pack.baseRevision, rules: pack.rules },
    request_id: makeId('req')
  })
}

function addException(app, { coachId, startAt, endAt, type, reason }) {
  const store = ensureStore(app)
  const ex = {
    id: makeId('ex'),
    coachId,
    startAt,
    endAt,
    type: type === 'open' ? 'open' : 'closed',
    reason: reason || ''
  }
  store.exceptions.push(ex)
  persist(app)
  return Promise.resolve({ data: ex, request_id: makeId('req') })
}

function calcPendingExpire(startAt) {
  const now = time.nowMs()
  const byWait = now + SCHEDULE_CONFIG.pendingExpireMin * 60000
  const byStart = startAt - SCHEDULE_CONFIG.pendingExpireBeforeStartMin * 60000
  return Math.min(byWait, byStart)
}

/** API06 POST /bookings — 确认后才创建 pending 占用 */
function createBooking(app, payload, idempotencyKey) {
  const store = ensureStore(app)
  expirePendings(store)

  if (idempotencyKey && store.idempotency[idempotencyKey]) {
    return Promise.resolve(store.idempotency[idempotencyKey])
  }

  const {
    coachId,
    studentId,
    studentName,
    courseTypeId,
    acceptedRulesVersion
  } = payload
  let startAt = payload.startAt
  if (typeof startAt === 'string') startAt = Date.parse(startAt)
  startAt = Number(startAt)

  if (acceptedRulesVersion !== SCHEDULE_CONFIG.rulesVersion) {
    return Promise.reject({
      code: 'RULES_VERSION_MISMATCH',
      message: '预约规则已更新，请重新确认'
    })
  }

  const course = getCourseType(courseTypeId || 'private_strength_60')
  const endAt = startAt + course.durationMin * 60000
  const now = time.nowMs()

  if (startAt < now + SCHEDULE_CONFIG.minBookAheadMin * 60000) {
    return Promise.reject({
      code: 'BOOKING_WINDOW_CLOSED',
      message: '已超过可预约时间'
    })
  }

  const buffer = SCHEDULE_CONFIG.defaultBufferMin
  const conflict = hasConflict(store, {
    startAt: startAt - buffer * 60000,
    endAt: endAt + buffer * 60000,
    coachId,
    studentId
  })
  if (conflict) {
    return Promise.reject(conflict)
  }

  if (isClosedByException(store, coachId, startAt, endAt)) {
    return Promise.reject({
      code: 'SLOT_CONFLICT',
      message: '教练该时段已关闭'
    })
  }

  const booking = {
    id: makeId('bk'),
    coachId,
    studentId,
    studentName: studentName || '',
    courseTypeId: course.id,
    courseName: course.name,
    startAt,
    endAt,
    status: 'pending',
    expiresAt: calcPendingExpire(startAt),
    location: course.location,
    rulesSnapshot: {
      version: SCHEDULE_CONFIG.rulesVersion,
      durationMin: course.durationMin,
      bufferMin: buffer,
      cancelOrChangeAheadMin: SCHEDULE_CONFIG.cancelOrChangeAheadMin,
      pendingExpireMin: SCHEDULE_CONFIG.pendingExpireMin
    },
    revision: 1,
    createdAt: now,
    updatedAt: now,
    rejectReason: '',
    attendanceNote: ''
  }

  store.bookings.push(booking)
  const resp = {
    data: presentBooking(booking),
    request_id: makeId('req')
  }
  if (idempotencyKey) store.idempotency[idempotencyKey] = resp
  persist(app)
  return Promise.resolve(resp)
}

function presentBooking(b) {
  return {
    booking_id: b.id,
    coach_id: b.coachId,
    student_id: b.studentId,
    student_name: b.studentName,
    course_type_id: b.courseTypeId,
    course_name: b.courseName,
    status: b.status,
    start_at: time.isoShanghai(b.startAt),
    end_at: time.isoShanghai(b.endAt),
    startAt: b.startAt,
    endAt: b.endAt,
    expires_at: b.expiresAt ? time.isoShanghai(b.expiresAt) : null,
    expiresAt: b.expiresAt,
    location: b.location,
    revision: b.revision,
    rules_snapshot: b.rulesSnapshot,
    rejectReason: b.rejectReason,
    dateKey: time.shanghaiDateKey(b.startAt),
    startLabel: time.formatHm(b.startAt),
    endLabel: time.formatHm(b.endAt)
  }
}

function findBooking(store, id) {
  return store.bookings.find((b) => b.id === id)
}

/** API07 accept / reject */
function decideBooking(app, bookingId, { action, reason, revision, coachUserId, coachId }) {
  const store = ensureStore(app)
  expirePendings(store)
  const b = findBooking(store, bookingId)
  if (!b) return Promise.reject({ code: 'NOT_FOUND', message: '预约不存在' })
  if (coachId && b.coachId !== coachId) {
    return Promise.reject({ code: 'FORBIDDEN', message: '只能处理自己的课' })
  }
  if (b.status === 'expired') {
    return Promise.reject({ code: 'BOOKING_EXPIRED', message: '预约等待已超时' })
  }
  if (b.status !== 'pending') {
    return Promise.reject({ code: 'INVALID_STATE', message: '当前状态不可操作' })
  }
  if (revision != null && revision !== b.revision) {
    return Promise.reject({ code: 'REVISION_CONFLICT', message: '记录已被更新' })
  }

  if (action === 'accept') {
    b.status = 'confirmed'
  } else if (action === 'reject') {
    b.status = 'rejected'
    b.rejectReason = reason || ''
  } else {
    return Promise.reject({ code: 'INVALID_ACTION', message: '未知操作' })
  }
  b.revision += 1
  b.updatedAt = time.nowMs()
  persist(app)
  return Promise.resolve({ data: presentBooking(b), request_id: makeId('req') })
}

/** API08 cancel */
function cancelBooking(app, bookingId, { actorId, role, reason, revision }) {
  const store = ensureStore(app)
  expirePendings(store)
  const b = findBooking(store, bookingId)
  if (!b) return Promise.reject({ code: 'NOT_FOUND', message: '预约不存在' })
  if (revision != null && revision !== b.revision) {
    return Promise.reject({ code: 'REVISION_CONFLICT', message: '记录已被更新' })
  }

  if (b.status === 'pending' && role === 'student' && b.studentId === actorId) {
    b.status = 'cancelled'
    b.revision += 1
    b.updatedAt = time.nowMs()
    persist(app)
    return Promise.resolve({ data: presentBooking(b), request_id: makeId('req') })
  }

  if (b.status === 'confirmed') {
    const ahead = b.startAt - time.nowMs()
    const need = (b.rulesSnapshot.cancelOrChangeAheadMin || 0) * 60000
    if (ahead < need && role === 'student') {
      return Promise.reject({
        code: 'BOOKING_WINDOW_CLOSED',
        message: '已超过可自行取消时间，请联系教练'
      })
    }
    if (
      (role === 'student' && b.studentId === actorId) ||
      (role === 'coach' && true)
    ) {
      b.status = 'cancelled'
      b.revision += 1
      b.updatedAt = time.nowMs()
      b.rejectReason = reason || ''
      persist(app)
      return Promise.resolve({ data: presentBooking(b), request_id: makeId('req') })
    }
  }

  return Promise.reject({ code: 'INVALID_STATE', message: '当前状态不可取消' })
}

/** API09 改期申请 */
function requestChange(app, bookingId, { proposedStart, courseTypeId, actorId }) {
  const store = ensureStore(app)
  expirePendings(store)
  const b = findBooking(store, bookingId)
  if (!b) return Promise.reject({ code: 'NOT_FOUND', message: '预约不存在' })
  if (b.status !== 'confirmed') {
    return Promise.reject({ code: 'INVALID_STATE', message: '仅已确认预约可改期' })
  }
  if (b.studentId !== actorId) {
    return Promise.reject({ code: 'FORBIDDEN', message: '仅学员可申请改期' })
  }
  const pending = store.changes.find((c) => c.bookingId === bookingId && c.status === 'pending')
  if (pending) {
    return Promise.reject({ code: 'CHANGE_EXISTS', message: '已有待处理改期' })
  }

  const course = getCourseType(courseTypeId || b.courseTypeId)
  const proposedEnd = proposedStart + course.durationMin * 60000
  const buffer = (b.rulesSnapshot && b.rulesSnapshot.bufferMin) || 0

  const conflict = hasConflict(store, {
    startAt: proposedStart - buffer * 60000,
    endAt: proposedEnd + buffer * 60000,
    coachId: b.coachId,
    studentId: b.studentId,
    excludeBookingId: b.id
  })
  if (conflict) return Promise.reject(conflict)

  const change = {
    id: makeId('chg'),
    bookingId: b.id,
    proposedStart,
    proposedEnd,
    status: 'pending',
    expiresAt: calcPendingExpire(proposedStart),
    requestedBy: actorId,
    createdAt: time.nowMs()
  }
  store.changes.push(change)
  persist(app)
  return Promise.resolve({
    data: {
      change_id: change.id,
      booking_id: b.id,
      status: change.status,
      proposed_start: time.isoShanghai(proposedStart),
      proposed_end: time.isoShanghai(proposedEnd),
      expires_at: time.isoShanghai(change.expiresAt),
      // 旧预约仍 confirmed
      original: presentBooking(b)
    },
    request_id: makeId('req')
  })
}

/** API09 decision */
function decideChange(app, changeId, { action, coachId }) {
  const store = ensureStore(app)
  expirePendings(store)
  const change = store.changes.find((c) => c.id === changeId)
  if (!change) return Promise.reject({ code: 'NOT_FOUND', message: '改期不存在' })
  if (change.status === 'expired') {
    return Promise.reject({ code: 'BOOKING_EXPIRED', message: '改期已超时' })
  }
  if (change.status !== 'pending') {
    return Promise.reject({ code: 'INVALID_STATE', message: '改期已处理' })
  }
  const b = findBooking(store, change.bookingId)
  if (!b || (coachId && b.coachId !== coachId)) {
    return Promise.reject({ code: 'FORBIDDEN', message: '无权处理' })
  }

  if (action === 'reject') {
    change.status = 'rejected'
    persist(app)
    return Promise.resolve({
      data: { change_id: change.id, status: 'rejected', booking: presentBooking(b) },
      request_id: makeId('req')
    })
  }

  if (action === 'accept') {
    const buffer = (b.rulesSnapshot && b.rulesSnapshot.bufferMin) || 0
    const conflict = hasConflict(store, {
      startAt: change.proposedStart - buffer * 60000,
      endAt: change.proposedEnd + buffer * 60000,
      coachId: b.coachId,
      studentId: b.studentId,
      excludeBookingId: b.id,
      excludeChangeId: change.id
    })
    if (conflict) return Promise.reject(conflict)

    // 同一事务语义：释放旧占用，指向新时段
    b.startAt = change.proposedStart
    b.endAt = change.proposedEnd
    b.revision += 1
    b.updatedAt = time.nowMs()
    change.status = 'accepted'
    persist(app)
    return Promise.resolve({
      data: { change_id: change.id, status: 'accepted', booking: presentBooking(b) },
      request_id: makeId('req')
    })
  }

  return Promise.reject({ code: 'INVALID_ACTION', message: '未知操作' })
}

/** API10 attendance */
function setAttendance(app, bookingId, { status, note, coachId }) {
  const store = ensureStore(app)
  const b = findBooking(store, bookingId)
  if (!b) return Promise.reject({ code: 'NOT_FOUND', message: '预约不存在' })
  if (!coachId || b.coachId !== coachId) {
    return Promise.reject({ code: 'FORBIDDEN', message: '无权操作' })
  }
  if (b.status !== 'confirmed' && b.status !== 'in_progress') {
    return Promise.reject({ code: 'INVALID_STATE', message: '当前状态不可标记出勤' })
  }
  const allowed = { in_progress: 1, completed: 1, no_show: 1 }
  if (!allowed[status]) {
    return Promise.reject({ code: 'INVALID_ACTION', message: '出勤状态不合法' })
  }
  const previous = b.status
  b.status = status
  b.attendanceNote = note || ''
  b.revision += 1
  b.updatedAt = time.nowMs()
  let reward = null
  if (previous !== status && (status === 'completed' || status === 'no_show')) {
    reward = pointsService.rewardBooking(app.globalData, b, status)
    if (reward && reward.awarded) {
      try {
        outboxService.enqueue(app.globalData, {
          userId: b.studentId,
          title: '课程积分已入账',
          body: '本次课程获得 ' + reward.points + ' 积分'
        })
      } catch (_) {}
    }
  }
  persist(app)
  return Promise.resolve({
    data: Object.assign({}, presentBooking(b), { reward }),
    request_id: makeId('req')
  })
}

function listBookings(app, filter) {
  const store = ensureStore(app)
  expirePendings(store)
  let list = store.bookings.slice()
  if (filter.coachId) list = list.filter((b) => b.coachId === filter.coachId)
  if (filter.studentId) list = list.filter((b) => b.studentId === filter.studentId)
  if (filter.status) {
    const set = Array.isArray(filter.status) ? filter.status : [filter.status]
    list = list.filter((b) => set.indexOf(b.status) !== -1)
  }
  if (filter.dateKey) {
    list = list.filter((b) => time.shanghaiDateKey(b.startAt) === filter.dateKey)
  }
  list.sort((a, b) => a.startAt - b.startAt)
  return Promise.resolve({
    data: list.map(presentBooking),
    request_id: makeId('req')
  })
}

function listPendingChanges(app, coachId) {
  const store = ensureStore(app)
  expirePendings(store)
  const rows = store.changes
    .filter((c) => c.status === 'pending')
    .map((c) => {
      const b = findBooking(store, c.bookingId)
      if (!b || b.coachId !== coachId) return null
      return {
        change_id: c.id,
        booking: presentBooking(b),
        proposed_start: time.isoShanghai(c.proposedStart),
        proposed_end: time.isoShanghai(c.proposedEnd),
        proposedStart: c.proposedStart,
        proposedEnd: c.proposedEnd,
        proposedStartLabel: time.formatHm(c.proposedStart),
        proposedEndLabel: time.formatHm(c.proposedEnd),
        proposedDateKey: time.shanghaiDateKey(c.proposedStart),
        expiresAt: c.expiresAt
      }
    })
    .filter(Boolean)
  return Promise.resolve({ data: rows, request_id: makeId('req') })
}

function getBooking(app, bookingId) {
  const store = ensureStore(app)
  expirePendings(store)
  const b = findBooking(store, bookingId)
  if (!b) return Promise.reject({ code: 'NOT_FOUND', message: '预约不存在' })
  return Promise.resolve({ data: presentBooking(b), request_id: makeId('req') })
}

function statusLabel(status) {
  const map = {
    pending: '待确认',
    confirmed: '已确认',
    rejected: '已拒绝',
    cancelled: '已取消',
    expired: '已失效',
    in_progress: '进行中',
    completed: '已完成',
    no_show: '缺席'
  }
  return map[status] || status
}

module.exports = {
  ensureStore,
  getSlots,
  getAvailability,
  patchAvailability,
  addException,
  createBooking,
  decideBooking,
  cancelBooking,
  requestChange,
  decideChange,
  setAttendance,
  listBookings,
  listPendingChanges,
  getBooking,
  statusLabel,
  presentBooking,
  SCHEDULE_CONFIG
}
