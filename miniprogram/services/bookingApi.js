/**
 * API04–API10 约课排班（远程）
 */
const http = require('../utils/http')
const { SCHEDULE_CONFIG } = require('../utils/scheduleConfig')

function getSlots(app, opts) {
  return http
    .get('/coaches/' + opts.coachId + '/slots', {
      from: opts.fromDate,
      to: opts.toDate,
      course_type: opts.courseTypeId
    })
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function getAvailability(app, coachId) {
  return http
    .get('/coaches/' + coachId + '/availability')
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function patchAvailability(app, coachId, payload) {
  return http
    .patch(
      '/coaches/' + coachId + '/availability',
      {
        rules: payload.rules,
        base_revision: payload.baseRevision
      },
      { idempotencyKey: payload.idempotencyKey || 'avail_' + Date.now() }
    )
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function addException(app, payload) {
  return http
    .post('/coaches/' + payload.coachId + '/exceptions', payload)
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function createBooking(app, payload, idempotencyKey) {
  return http
    .post(
      '/bookings',
      {
        coach_id: payload.coachId,
        start_at: payload.startAt,
        course_type_id: payload.courseTypeId,
        accepted_rules_version: payload.acceptedRulesVersion
      },
      { idempotencyKey: idempotencyKey || 'bk_' + Date.now() }
    )
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function decideBooking(app, bookingId, payload) {
  const action = payload.action
  return http
    .post(
      '/bookings/' + bookingId + '/' + (action === 'accept' ? 'accept' : 'reject'),
      { revision: payload.revision, reason: payload.reason },
      { idempotencyKey: 'decide_' + bookingId + '_' + action }
    )
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function cancelBooking(app, bookingId, payload) {
  return http
    .post(
      '/bookings/' + bookingId + '/cancel',
      { revision: payload.revision, reason: payload.reason },
      { idempotencyKey: 'cancel_' + bookingId }
    )
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function requestChange(app, bookingId, payload) {
  return http
    .post(
      '/bookings/' + bookingId + '/changes',
      { proposed_start: payload.proposedStart, course_type_id: payload.courseTypeId },
      { idempotencyKey: 'chg_' + bookingId + '_' + Date.now() }
    )
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function decideChange(app, changeId, payload) {
  return http
    .post(
      '/booking-changes/' + changeId + '/decision',
      { action: payload.action },
      { idempotencyKey: 'chgdec_' + changeId + '_' + payload.action }
    )
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function setAttendance(app, bookingId, payload) {
  return http
    .post('/bookings/' + bookingId + '/attendance', payload, {
      idempotencyKey: 'att_' + bookingId
    })
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function listBookings(app, filter) {
  const q = {}
  if (filter.coachId) q.coach_id = filter.coachId
  if (filter.studentId) q.student_id = filter.studentId
  if (filter.status) {
    q.status = Array.isArray(filter.status) ? filter.status.join(',') : filter.status
  }
  if (filter.dateKey) q.date = filter.dateKey
  return http.get('/bookings', q).then((res) => ({ data: res.data, request_id: res.request_id }))
}

function listPendingChanges(app, coachId) {
  return http
    .get('/booking-changes/pending')
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function getBooking(app, bookingId) {
  return http
    .get('/bookings/' + bookingId)
    .then((res) => ({ data: res.data, request_id: res.request_id }))
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

/** 首页/日程共用的状态视觉：色调 + 图标，不改变业务含义 */
function statusTone(status) {
  if (status === 'pending') return 'warn'
  if (status === 'confirmed' || status === 'in_progress') return 'ok'
  if (status === 'rejected' || status === 'cancelled' || status === 'expired' || status === 'no_show') return 'err'
  if (status === 'completed') return 'muted'
  return 'muted'
}

function statusIcon(status) {
  if (status === 'pending') return 'booking'
  if (status === 'confirmed' || status === 'completed') return 'check'
  if (status === 'in_progress') return 'play'
  return 'booking'
}

module.exports = {
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
  statusTone,
  statusIcon,
  SCHEDULE_CONFIG
}
