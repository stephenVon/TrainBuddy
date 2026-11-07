/**
 * API12–17 计划与训练（远程）；草稿仅本地 permission.draft
 */
const http = require('../utils/http')

const EXERCISE_LIBRARY = [
  { id: 'squat', name: '杠铃深蹲', icon: '🏋️', defaultSets: 4, defaultReps: 10, defaultWeight: 60 },
  { id: 'rdl', name: '罗马尼亚硬拉', icon: '🦵', defaultSets: 3, defaultReps: 10, defaultWeight: 40 },
  { id: 'hip_thrust', name: '臀推', icon: '🍑', defaultSets: 3, defaultReps: 12, defaultWeight: 45 },
  { id: 'bench', name: '杠铃卧推', icon: '💪', defaultSets: 4, defaultReps: 8, defaultWeight: 50 },
  { id: 'core', name: '核心训练', icon: '🧘', defaultSets: 3, defaultReps: 12, defaultWeight: null }
]

function ensureStore() {
  return { plans: [], sessions: [] }
}

function createManualPlan(app, payload) {
  const body = {}
  if (payload && payload.studentId) body.student_id = payload.studentId
  if (payload && payload.title) body.title = payload.title
  return http.post('/plans', body).then((res) => ({ data: res.data, request_id: res.request_id }))
}

function deletePlan(app, planId) {
  return http.del('/plans/' + planId).then((res) => ({ data: res.data, request_id: res.request_id }))
}

function listPlansForStudent(app, studentId) {
  return http
    .get('/plans', { student_id: studentId })
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function ensureDefaultPublishedPlan(app, payload) {
  return http.post('/plans/ensure-default', {}).then((res) => res.data)
}

function startSessionFromPlan(app, planId, { studentId, idempotencyKey }) {
  return http
    .post(
      '/plans/' + planId + '/start-session',
      {},
      { idempotencyKey: idempotencyKey || 'start_' + planId }
    )
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function createCoachDraftSession(app, payload) {
  return http
    .post(
      '/sessions',
      {
        coachDraft: true,
        student_id: payload.studentId,
        student_name: payload.studentName,
        title: payload.title,
        booking_id: payload.bookingId
      },
      { idempotencyKey: 'cdraft_' + payload.studentId }
    )
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function getSession(app, sessionId) {
  return http
    .get('/sessions/' + sessionId)
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function patchSessionMeta(app, sessionId, patch) {
  return http
    .patch('/sessions/' + sessionId, patch)
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function addExercise(app, sessionId, payload) {
  return http
    .post('/sessions/' + sessionId + '/exercises', payload)
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function removeExercise(app, sessionId, exerciseId) {
  return http
    .del('/sessions/' + sessionId + '/exercises/' + exerciseId)
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function mergeParsedSegments(app, sessionId, segments) {
  // 将已确认片段逐个 addExercise
  let chain = Promise.resolve(null)
  segments.forEach((seg) => {
    chain = chain.then(() =>
      addExercise(app, sessionId, {
        name: seg.display_name || seg.raw_name,
        exerciseId: seg.exercise_candidate,
        sets: seg.set_count,
        reps: seg.candidate_reps_per_set,
        weight: seg.weight_kg
      })
    )
  })
  return chain.then((last) => last || getSession(app, sessionId))
}

function updateActualSet(app, sessionId, setId, patch) {
  return http
    .patch('/sessions/' + sessionId + '/sets/' + setId, patch)
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function finalizeSession(app, sessionId, opts) {
  return http
    .post(
      '/sessions/' + sessionId + '/finalize',
      {
        share: opts.share,
        completion_key: opts.completionKey,
        base_revision: opts.baseRevision
      },
      { idempotencyKey: opts.completionKey || 'fin_' + sessionId }
    )
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function abandonSession(app, sessionId) {
  return http
    .post('/sessions/' + sessionId + '/abandon', {})
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function listSessions(app, filter) {
  const q = {}
  if (filter.studentId) q.student_id = filter.studentId
  if (filter.status) {
    q.status = Array.isArray(filter.status) ? filter.status.join(',') : filter.status
  }
  return http.get('/sessions', q).then((res) => ({ data: res.data, request_id: res.request_id }))
}

function getPlan(app, planId) {
  return http
    .get('/plans/' + planId)
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function updatePlanDraft(app, planId, patch) {
  return http
    .patch('/plans/' + planId + '/draft', patch)
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function publishPlan(app, planId, opts) {
  return http
    .post(
      '/plans/' + planId + '/publish',
      {
        version: opts.version,
        base_revision: opts.baseRevision,
        review_confirmation: opts.reviewConfirmation !== false
      },
      { idempotencyKey: 'pub_' + planId + '_' + opts.version + '_' + opts.baseRevision }
    )
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

/** 文字结构化（本地粗解析；正式可走 parse-text 接口） */
function parseTextToExercises(text) {
  const lines = String(text || '')
    .split(/\n|；|;/)
    .map((l) => l.trim())
    .filter(Boolean)
  const segments = []
  const unparsed = []
  lines.forEach((line, idx) => {
    const m = line.match(
      /^(.+?)\s+(\d+(?:\.\d+)?)\s*kg\s+(\d+)\s*次(?:\s+(\d+)\s*组)?$/i
    )
    const m2 = line.match(/^(.+?)\s+(\d+)\s*[x×]\s*(\d+)(?:\s+(\d+(?:\.\d+)?)\s*kg)?$/i)
    let name
    let weight
    let reps
    let setCount
    if (m) {
      name = m[1]
      weight = parseFloat(m[2])
      reps = parseInt(m[3], 10)
      setCount = m[4] ? parseInt(m[4], 10) : null
    } else if (m2) {
      name = m2[1]
      setCount = parseInt(m2[2], 10)
      reps = parseInt(m2[3], 10)
      weight = m2[4] ? parseFloat(m2[4]) : null
    } else {
      unparsed.push(line)
      return
    }
    const lib = EXERCISE_LIBRARY.find(
      (e) => name.indexOf(e.name) !== -1 || e.name.indexOf(name) !== -1
    )
    const missing = []
    if (setCount == null) missing.push('set_count')
    if (reps == null) missing.push('reps')
    segments.push({
      segment_id: 'seg_' + (idx + 1),
      raw_name: name,
      exercise_candidate: lib ? lib.id : null,
      display_name: lib ? lib.name : name,
      set_count: setCount,
      candidate_reps_per_set: reps,
      weight_kg: weight,
      missing_fields: missing,
      requires_confirmation: missing.length > 0
    })
  })
  return { schema_version: 'workout_draft.v1', segments, unparsed_text: unparsed }
}

function parseTextToExercisesRemote(app, sessionId, text) {
  return http
    .post('/sessions/' + sessionId + '/parse-text', { text })
    .then((res) => res.data)
}

function addExerciseToPersonalPlan(app, studentId, exerciseMeta, actionKey) {
  return http.post('/plans/personal/exercises', { exercise_id: exerciseMeta.id }, {
    idempotencyKey: actionKey || 'add_plan_' + Date.now() + '_' + Math.random().toString(36).slice(2)
  })
}

function completedSessionStats(app, studentId) {
  return http.get('/growth/summary', { student_id: studentId }).then((res) => ({
    sessionCount: res.data.sessionCount || 0,
    trainingDays: res.data.trainingDays || 0
  }))
}

function countDoneSets(session) {
  let n = 0
  ;(session.exercises || []).forEach((ex) => {
    ;(ex.sets || []).forEach((set) => {
      if (set.state === 'done') n += 1
    })
  })
  return n
}

module.exports = {
  EXERCISE_LIBRARY,
  ensureStore,
  createManualPlan,
  deletePlan,
  listPlansForStudent,
  ensureDefaultPublishedPlan,
  startSessionFromPlan,
  createCoachDraftSession,
  getSession,
  patchSessionMeta,
  addExercise,
  removeExercise,
  mergeParsedSegments,
  updateActualSet,
  finalizeSession,
  abandonSession,
  listSessions,
  getPlan,
  updatePlanDraft,
  publishPlan,
  parseTextToExercises,
  parseTextToExercisesRemote,
  addExerciseToPersonalPlan,
  completedSessionStats,
  countDoneSets
}
