/**
 * 训练计划 / 实际会话 mock API
 * 对齐设计文档第 7 节：Plan 与 Session 分离，逐组 ActualSet，幂等 finalize
 */

const time = require('../lib/time')
const { makeId: makeIdLib } = require('../lib/ids')
const planValidation = require('../lib/planValidation')
const { AppError } = require('../lib/errors')

const EXERCISE_LIBRARY = [
  { id: 'squat', name: '杠铃深蹲', icon: '🏋️', defaultSets: 4, defaultReps: 10, defaultWeight: 60 },
  { id: 'rdl', name: '罗马尼亚硬拉', icon: '🦵', defaultSets: 3, defaultReps: 10, defaultWeight: 40 },
  { id: 'hip_thrust', name: '臀推', icon: '🍑', defaultSets: 3, defaultReps: 12, defaultWeight: 45 },
  { id: 'bench', name: '杠铃卧推', icon: '💪', defaultSets: 4, defaultReps: 8, defaultWeight: 50 },
  { id: 'core', name: '核心训练', icon: '🧘', defaultSets: 3, defaultReps: 12, defaultWeight: null }
]

function makeId(prefix) { return makeIdLib(prefix) }

function ensureStore(app) {
  const gd = app.globalData
  if (!gd.training) {
    gd.training = {
      plans: [],
      planRevisions: [],
      sessions: [],
      finalizeKeys: {},
      nextPlanGenKeys: {}
    }
  }
  if (!gd.training.nextPlanGenKeys) gd.training.nextPlanGenKeys = {}
  return gd.training
}

function persist(app) {
  app.persist()
}

function todayBusinessDate() {
  return time.todayKey()
}

function findPlan(store, planId) {
  return store.plans.find((p) => p.id === planId)
}

function findRevision(store, planId, version) {
  return store.planRevisions.find((r) => r.planId === planId && r.version === version)
}

function latestRevision(store, planId) {
  return store.planRevisions
    .filter((r) => r.planId === planId)
    .sort((a, b) => b.version - a.version)[0]
}

function publishedRevision(store, plan) {
  if (!plan || !plan.currentPublishedRevision) return null
  return findRevision(store, plan.id, plan.currentPublishedRevision)
}

function findSession(store, sessionId) {
  return store.sessions.find((s) => s.id === sessionId)
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

function countRequiredSets(session) {
  let n = 0
  ;(session.exercises || []).forEach((ex) => {
    ;(ex.sets || []).forEach((set) => {
      if (set.required !== false) n += 1
    })
  })
  return n
}

function presentSession(s) {
  const done = countDoneSets(s)
  const total = countRequiredSets(s)
  return {
    session_id: s.id,
    student_id: s.studentId,
    student_name: s.studentName,
    coach_id: s.coachId,
    plan_id: s.planId,
    plan_revision: s.planRevision,
    source_type: s.sourceType,
    status: s.status,
    title: s.title,
    business_date: s.businessDate,
    started_at: s.startedAt,
    ended_at: s.endedAt,
    shared_at: s.sharedAt,
    revision: s.revision,
    public_note: s.publicNote || '',
    private_note: s.privateNote || '',
    exercises: s.exercises,
    done_sets: done,
    total_sets: total,
    progress_percent: total ? Math.min(100, Math.round((done / total) * 100)) : 0,
    booking_id: s.bookingId || null,
    has_booking: !!s.bookingId
  }
}

function presentPlan(store, plan) {
  const pub = publishedRevision(store, plan)
  const latest = latestRevision(store, plan.id)
  return {
    plan_id: plan.id,
    student_id: plan.studentId,
    author_id: plan.authorId,
    author_role: plan.authorRole,
    source_type: plan.sourceType,
    current_published_revision: plan.currentPublishedRevision,
    published: pub
      ? {
          version: pub.version,
          status: pub.status,
          title: pub.title,
          goal: pub.goal,
          planned_date: pub.plannedDate,
          exercises: pub.exercises,
          published_at: pub.publishedAt
        }
      : null,
    latest_draft:
      latest && latest.status === 'draft'
        ? {
            version: latest.version,
            revision: latest.revision || 1,
            title: latest.title,
            goal: latest.goal,
            planned_date: latest.plannedDate,
            exercises: latest.exercises,
            reason: latest.reason,
            missing_notes: latest.missingNotes || []
          }
        : null
  }
}

function buildSetsFromTarget(count, reps, weight, required) {
  const sets = []
  for (let i = 1; i <= count; i++) {
    sets.push({
      id: makeId('pset'),
      setNo: i,
      targetWeight: weight,
      targetReps: reps,
      required: required !== false
    })
  }
  return sets
}

function libraryItem(idOrName) {
  return (
    EXERCISE_LIBRARY.find((e) => e.id === idOrName || e.name === idOrName) ||
    null
  )
}

/** 默认下肢模板（用于无计划时开练 / 教练快速录入） */
function defaultLowerBodyExercises() {
  return EXERCISE_LIBRARY.slice(0, 3).map((e, idx) => ({
    id: makeId('pex'),
    exerciseId: e.id,
    name: e.name,
    icon: e.icon,
    order: idx + 1,
    loadBasis: 'total',
    sets: buildSetsFromTarget(e.defaultSets, e.defaultReps, e.defaultWeight, true)
  }))
}

function cloneExercisesForSession(planExercises) {
  return (planExercises || []).map((ex, idx) => ({
    id: makeId('sex'),
    exerciseId: ex.exerciseId || null,
    name: ex.name,
    nameSnapshot: ex.name,
    icon: ex.icon || '🏋️',
    order: ex.order || idx + 1,
    loadBasis: ex.loadBasis || 'unknown',
    sets: (ex.sets || []).map((s) => ({
      id: makeId('aset'),
      setNo: s.setNo,
      targetWeight: s.targetWeight,
      targetReps: s.targetReps,
      actualWeight: s.targetWeight,
      actualReps: s.targetReps,
      state: 'pending',
      required: s.required !== false,
      effort: null
    }))
  }))
}

/**
 * 创建或返回学员默认已发布计划
 */
function ensureDefaultPublishedPlan(app, { studentId, authorId, authorRole }) {
  const store = ensureStore(app)
  let plan = store.plans.find(
    (p) =>
      p.studentId === studentId &&
      p.sourceType === 'template_default' &&
      p.currentPublishedRevision
  )
  if (plan) return presentPlan(store, plan)

  plan = {
    id: makeId('plan'),
    studentId,
    authorId: authorId || studentId,
    authorRole: authorRole || 'coach',
    sourceType: 'template_default',
    sourceId: null,
    currentPublishedRevision: 1,
    createdAt: time.nowMs(),
    updatedAt: time.nowMs()
  }
  const rev = {
    id: makeId('prev'),
    planId: plan.id,
    version: 1,
    status: 'published',
    title: '下肢力量 · A 计划',
    goal: '动作稳定、节奏可控',
    plannedDate: todayBusinessDate(),
    exercises: defaultLowerBodyExercises(),
    reason: '系统默认模板',
    missingNotes: [],
    publishedAt: time.nowMs(),
    createdAt: time.nowMs()
  }
  store.plans.push(plan)
  store.planRevisions.push(rev)
  persist(app)
  return presentPlan(store, plan)
}

function listPlansForStudent(app, studentId) {
  const store = ensureStore(app)
  const list = store.plans
    .filter((p) => p.studentId === studentId)
    .map((p) => presentPlan(store, p))
  return Promise.resolve({ data: list, request_id: makeId('req') })
}

/**
 * API17 从已发布计划开始会话（复制快照）
 */
function startSessionFromPlan(app, planId, { studentId, idempotencyKey }) {
  const store = ensureStore(app)
  if (idempotencyKey && store.finalizeKeys['start:' + idempotencyKey]) {
    const sid = store.finalizeKeys['start:' + idempotencyKey]
    return Promise.resolve({
      data: presentSession(findSession(store, sid)),
      request_id: makeId('req')
    })
  }

  const plan = findPlan(store, planId)
  if (!plan || plan.studentId !== studentId) {
    return Promise.reject({ code: 'FORBIDDEN', message: '无权开始该计划' })
  }
  const pub = publishedRevision(store, plan)
  if (!pub) {
    return Promise.reject({ code: 'NO_PUBLISHED_PLAN', message: '暂无已发布计划' })
  }

  // 恢复未完成草稿会话（同一计划）
  const existing = store.sessions.find(
    (s) =>
      s.studentId === studentId &&
      s.planId === planId &&
      (s.status === 'draft' || s.status === 'in_progress')
  )
  if (existing) {
    return Promise.resolve({
      data: presentSession(existing),
      request_id: makeId('req'),
      resumed: true
    })
  }

  const today = todayBusinessDate()
  if (pub.plannedDate !== today) {
    return Promise.reject(
      new AppError('INVALID_STATE', '该计划安排日不是今天，请到计划页调整日期后再开练', {
        extra: { planned_date: pub.plannedDate }
      })
    )
  }

  // 同一计划当日已完成后不可再开，避免重复累计训练次数
  const doneToday = store.sessions.find(
    (s) =>
      s.studentId === studentId &&
      s.planId === planId &&
      s.status === 'completed' &&
      s.businessDate === today &&
      s.sourceType === 'from_plan'
  )
  if (doneToday) {
    return Promise.reject(
      new AppError('INVALID_STATE', '今日已完成该计划，请到成长页查看记录', {
        extra: { session_id: doneToday.id }
      })
    )
  }

  const session = {
    id: makeId('sess'),
    studentId,
    studentName: '',
    coachId: plan.authorRole === 'coach' ? plan.authorId : null,
    bookingId: null,
    planId: plan.id,
    planRevision: pub.version,
    sourceType: 'from_plan',
    status: 'in_progress',
    title: pub.title,
    businessDate: todayBusinessDate(),
    startedAt: time.nowMs(),
    endedAt: null,
    sharedAt: null,
    revision: 1,
    publicNote: '',
    privateNote: '',
    exercises: cloneExercisesForSession(pub.exercises),
    completionKey: null,
    createdAt: time.nowMs(),
    updatedAt: time.nowMs()
  }
  store.sessions.push(session)
  if (idempotencyKey) store.finalizeKeys['start:' + idempotencyKey] = session.id
  persist(app)
  return Promise.resolve({ data: presentSession(session), request_id: makeId('req') })
}

/**
 * 教练创建课后表草稿（不共享）
 */
function createCoachDraftSession(app, payload) {
  const store = ensureStore(app)
  const {
    studentId,
    studentName,
    coachId,
    title,
    bookingId
  } = payload

  const existing = store.sessions.find(
    (s) =>
      s.coachId === coachId &&
      s.studentId === studentId &&
      s.sourceType === 'coach_post_session' &&
      s.status === 'draft'
  )
  if (existing) {
    return Promise.resolve({ data: presentSession(existing), request_id: makeId('req') })
  }

  const session = {
    id: makeId('sess'),
    studentId,
    studentName: studentName || '',
    coachId,
    bookingId: bookingId || null,
    planId: null,
    planRevision: null,
    sourceType: 'coach_post_session',
    status: 'draft',
    title: title || '课后训练表',
    businessDate: todayBusinessDate(),
    startedAt: time.nowMs(),
    endedAt: null,
    sharedAt: null,
    revision: 1,
    publicNote: '',
    privateNote: '',
    exercises: [],
    completionKey: null,
    createdAt: time.nowMs(),
    updatedAt: time.nowMs()
  }
  store.sessions.push(session)
  persist(app)
  return Promise.resolve({ data: presentSession(session), request_id: makeId('req') })
}

function getSession(app, sessionId) {
  const store = ensureStore(app)
  const s = findSession(store, sessionId)
  if (!s) return Promise.reject({ code: 'NOT_FOUND', message: '训练不存在' })
  return Promise.resolve({ data: presentSession(s), request_id: makeId('req') })
}

function patchSessionMeta(app, sessionId, patch) {
  const store = ensureStore(app)
  const s = findSession(store, sessionId)
  if (!s) return Promise.reject({ code: 'NOT_FOUND', message: '训练不存在' })
  if (s.status === 'completed') {
    return Promise.reject({ code: 'INVALID_STATE', message: '已完成记录请走修订接口' })
  }
  if (patch.title != null) s.title = patch.title
  if (patch.publicNote != null) s.publicNote = patch.publicNote
  if (patch.privateNote != null) s.privateNote = patch.privateNote
  s.revision += 1
  s.updatedAt = time.nowMs()
  persist(app)
  return Promise.resolve({ data: presentSession(s), request_id: makeId('req') })
}

function addExercise(app, sessionId, { exerciseId, name, sets, reps, weight }) {
  const store = ensureStore(app)
  const s = findSession(store, sessionId)
  if (!s) return Promise.reject({ code: 'NOT_FOUND', message: '训练不存在' })
  if (s.status === 'completed') {
    return Promise.reject({ code: 'INVALID_STATE', message: '已完成不可直接改组' })
  }
  const lib = libraryItem(exerciseId) || libraryItem(name)
  const setCount = sets || (lib && lib.defaultSets) || 3
  const setReps = reps || (lib && lib.defaultReps) || 10
  const setWeight = weight != null ? weight : lib ? lib.defaultWeight : null
  const exName = name || (lib && lib.name) || '自定义动作'

  const planSets = buildSetsFromTarget(setCount, setReps, setWeight, true)
  const exercise = {
    id: makeId('sex'),
    exerciseId: (lib && lib.id) || null,
    name: exName,
    nameSnapshot: exName,
    icon: (lib && lib.icon) || '🏋️',
    order: s.exercises.length + 1,
    loadBasis: setWeight == null ? 'bodyweight' : 'total',
    sets: planSets.map((ps) => ({
      id: makeId('aset'),
      setNo: ps.setNo,
      targetWeight: ps.targetWeight,
      targetReps: ps.targetReps,
      actualWeight: ps.targetWeight,
      actualReps: ps.targetReps,
      state: 'pending',
      required: true,
      effort: null
    }))
  }
  s.exercises.push(exercise)
  s.revision += 1
  s.updatedAt = time.nowMs()
  persist(app)
  return Promise.resolve({ data: presentSession(s), request_id: makeId('req') })
}

function removeExercise(app, sessionId, exerciseId) {
  const store = ensureStore(app)
  const s = findSession(store, sessionId)
  if (!s) return Promise.reject({ code: 'NOT_FOUND', message: '训练不存在' })
  s.exercises = s.exercises.filter((e) => e.id !== exerciseId)
  s.revision += 1
  s.updatedAt = time.nowMs()
  persist(app)
  return Promise.resolve({ data: presentSession(s), request_id: makeId('req') })
}

/**
 * 更新某一 ActualSet（独立重量/次数/状态）
 */
function updateActualSet(app, sessionId, setId, patch) {
  const store = ensureStore(app)
  const s = findSession(store, sessionId)
  if (!s) return Promise.reject({ code: 'NOT_FOUND', message: '训练不存在' })
  if (s.status === 'completed') {
    return Promise.reject({ code: 'INVALID_STATE', message: '已完成会话不可改组' })
  }
  let hit = null
  s.exercises.forEach((ex) => {
    ;(ex.sets || []).forEach((set) => {
      if (set.id === setId) hit = set
    })
  })
  if (!hit) return Promise.reject({ code: 'NOT_FOUND', message: '组不存在' })

  if (patch.actualWeight != null) hit.actualWeight = patch.actualWeight
  if (patch.actualReps != null) hit.actualReps = patch.actualReps
  if (patch.state) {
    if (['pending', 'done', 'skipped'].indexOf(patch.state) === -1) {
      return Promise.reject({ code: 'INVALID_ACTION', message: '组状态不合法' })
    }
    hit.state = patch.state
  }
  if (patch.effort != null) hit.effort = patch.effort

  if (s.status === 'draft') s.status = 'in_progress'
  s.revision += 1
  s.updatedAt = time.nowMs()
  persist(app)
  return Promise.resolve({ data: presentSession(s), request_id: makeId('req') })
}

/**
 * 简易文字结构化（语音路径占位）：不擅自补组数
 * 例：「深蹲 60kg 10次 4组」
 */
function parseTextToExercises(text) {
  const lines = String(text || '')
    .split(/\n|；|;/)
    .map((l) => l.trim())
    .filter(Boolean)
  const results = []
  const unparsed = []

  lines.forEach((line, idx) => {
    // 优先：深蹲 4×10 / 深蹲 4x10 60kg / 深蹲 60kg 10次 4组
    let name = ''
    let setCount = null
    let reps = null
    let weight = null

    const compact = line.match(
      /^(.+?)\s+(\d+)\s*[×xX*]\s*(\d+)(?:\s*[·,]?\s*(\d+(?:\.\d+)?)\s*(?:kg|公斤)?)?/
    )
    if (compact) {
      name = compact[1].trim()
      setCount = +compact[2]
      reps = +compact[3]
      if (compact[4]) weight = +compact[4]
    } else {
      const weightMatch = line.match(/(\d+(?:\.\d+)?)\s*(?:kg|公斤)/i)
      const repsMatch = line.match(/(\d+)\s*(?:次|reps?)/i)
      const setsMatch = line.match(/(\d+)\s*(?:组|sets?)/i)
      name = line
        .replace(/(\d+(?:\.\d+)?)\s*(kg|公斤)/gi, ' ')
        .replace(/(\d+)\s*(次|组|reps?|sets?)/gi, ' ')
        .replace(/[×xX*·]/g, ' ')
        .trim()
      setCount = setsMatch ? +setsMatch[1] : null
      reps = repsMatch ? +repsMatch[1] : null
      weight = weightMatch ? +weightMatch[1] : null
    }

    if (!name) {
      unparsed.push(line)
      return
    }
    const lib =
      libraryItem(name) || EXERCISE_LIBRARY.find((e) => name.indexOf(e.name) !== -1)
    const missing = []
    if (setCount == null) missing.push('set_count')
    if (reps == null) missing.push('reps')

    results.push({
      segment_id: 'seg_' + (idx + 1),
      raw_name: name,
      exercise_candidate: lib ? lib.id : null,
      display_name: lib ? lib.name : name,
      icon: lib ? lib.icon : '🏋️',
      weight_kg: weight,
      candidate_reps_per_set: reps,
      set_count: setCount,
      load_basis: weight == null ? 'unknown' : 'total',
      missing_fields: missing,
      requires_confirmation: missing.length > 0,
      evidence_text: line
    })
  })

  return {
    schema_version: 'workout_draft.v1',
    segments: results,
    unparsed_text: unparsed
  }
}

/**
 * 合并文字结构化结果到会话（仅追加确认过的完整项）
 */
function mergeParsedSegments(app, sessionId, segments, { mode }) {
  const store = ensureStore(app)
  const s = findSession(store, sessionId)
  if (!s) return Promise.reject({ code: 'NOT_FOUND', message: '训练不存在' })

  const mergeMode = mode || 'append'
  segments.forEach((seg) => {
    if (seg.requires_confirmation && (seg.set_count == null || seg.candidate_reps_per_set == null)) {
      return // 缺失字段不自动写入
    }
    const setCount = seg.set_count
    const reps = seg.candidate_reps_per_set
    const weight = seg.weight_kg
    if (mergeMode === 'append' || mergeMode === 'replace_all') {
      // replace_all 由调用方先清空
    }
    const planSets = buildSetsFromTarget(setCount, reps, weight, true)
    s.exercises.push({
      id: makeId('sex'),
      exerciseId: seg.exercise_candidate,
      name: seg.display_name,
      nameSnapshot: seg.display_name,
      icon: seg.icon || '🏋️',
      order: s.exercises.length + 1,
      loadBasis: seg.load_basis || 'unknown',
      sets: planSets.map((ps) => ({
        id: makeId('aset'),
        setNo: ps.setNo,
        targetWeight: ps.targetWeight,
        targetReps: ps.targetReps,
        actualWeight: ps.targetWeight,
        actualReps: ps.targetReps,
        state: 'pending',
        required: true,
        effort: null
      })),
      fromSegmentId: seg.segment_id
    })
  })
  s.revision += 1
  s.updatedAt = time.nowMs()
  persist(app)
  return Promise.resolve({ data: presentSession(s), request_id: makeId('req') })
}

/**
 * 规则版下次计划：复制最近正式训练，不默认加重量
 */
function generateNextPlanDraft(app, sourceSession, generationType) {
  const store = ensureStore(app)
  const genType = generationType || 'rule_copy'
  const key =
    sourceSession.id + ':' + sourceSession.revision + ':' + genType
  if (store.nextPlanGenKeys[key]) {
    const planId = store.nextPlanGenKeys[key]
    return { plan: presentPlan(store, findPlan(store, planId)), reused: true }
  }

  // 找出是否已有该学员、同源自动草稿正在编辑
  let plan = store.plans.find(
    (p) =>
      p.studentId === sourceSession.studentId &&
      p.sourceType === 'next_from_session' &&
      p.sourceId === sourceSession.id
  )

  const exercises = (sourceSession.exercises || []).map((ex, idx) => ({
    id: makeId('pex'),
    exerciseId: ex.exerciseId,
    name: ex.nameSnapshot || ex.name,
    icon: ex.icon || '🏋️',
    order: idx + 1,
    loadBasis: ex.loadBasis || 'unknown',
    sets: (ex.sets || [])
      .filter((set) => set.state === 'done' || set.required !== false)
      .map((set) => ({
        id: makeId('pset'),
        setNo: set.setNo,
        // 规则版：沿用实际完成值，不 +5kg
        targetWeight: set.state === 'done' ? set.actualWeight : set.targetWeight,
        targetReps: set.state === 'done' ? set.actualReps : set.targetReps,
        required: set.required !== false
      }))
  }))

  const missingNotes = []
  exercises.forEach((ex) => {
    ex.sets.forEach((set) => {
      if (set.targetWeight == null) missingNotes.push(ex.name + ' 第' + set.setNo + '组重量待确认')
      if (set.targetReps == null) missingNotes.push(ex.name + ' 第' + set.setNo + '组次数待确认')
    })
  })
  if (!exercises.length) missingNotes.push('来源训练无有效组，需教练补全')

  const plannedDate = time.addDays(todayBusinessDate(), 2)

  if (!plan) {
    plan = {
      id: makeId('plan'),
      studentId: sourceSession.studentId,
      authorId: sourceSession.coachId || sourceSession.studentId,
      authorRole: sourceSession.coachId ? 'coach' : 'student',
      sourceType: 'next_from_session',
      sourceId: sourceSession.id,
      currentPublishedRevision: null,
      createdAt: time.nowMs(),
      updatedAt: time.nowMs()
    }
    store.plans.push(plan)
  }

  const latest = latestRevision(store, plan.id)
  // 不覆盖教练正在编辑的草稿：若最新已是 draft，另存候选版本号但标记 reason
  let version = latest ? latest.version + 1 : 1
  if (latest && latest.status === 'draft') {
    // 保留旧草稿，新增候选
    version = latest.version + 1
  }

  const rev = {
    id: makeId('prev'),
    planId: plan.id,
    version,
    status: 'draft',
    title: (sourceSession.title || '训练') + ' · 下次计划',
    goal: '沿用上次完成情况，请教练复核后再发布',
    plannedDate,
    exercises,
    reason: '规则生成：复制来源会话，未自动加量',
    missingNotes,
    sourceSessionId: sourceSession.id,
    sourceSessionRevision: sourceSession.revision,
    publishedAt: null,
    createdAt: time.nowMs()
  }
  store.planRevisions.push(rev)
  plan.updatedAt = time.nowMs()
  store.nextPlanGenKeys[key] = plan.id
  persist(app)
  return { plan: presentPlan(store, plan), draftVersion: version, reused: false }
}

/**
 * API13 finalize：正式完成；completion_key 幂等
 * share=true 时学员可见；触发一次下次计划草稿
 */
function finalizeSession(app, sessionId, { completionKey, share, actorRole }) {
  const store = ensureStore(app)
  const s = findSession(store, sessionId)
  if (!s) return Promise.reject({ code: 'NOT_FOUND', message: '训练不存在' })

  const key = completionKey || s.id + ':finalize'
  if (store.finalizeKeys[key]) {
    const existingId = store.finalizeKeys[key]
    const existing = findSession(store, existingId)
    return Promise.resolve({
      data: {
        session: presentSession(existing),
        next_plan: null,
        next_plan_error: null,
        idempotent: true
      },
      request_id: makeId('req')
    })
  }

  if (s.status === 'completed') {
    store.finalizeKeys[key] = s.id
    return Promise.resolve({
      data: {
        session: presentSession(s),
        next_plan: null,
        next_plan_error: null,
        idempotent: true
      },
      request_id: makeId('req')
    })
  }

  const done = countDoneSets(s)
  // 零完成组：可存草稿或放弃，不计训练次数
  if (done === 0 && actorRole === 'student') {
    return Promise.reject({
      code: 'NO_COMPLETED_SETS',
      message: '尚未完成任何一组，可继续训练或标记放弃'
    })
  }

  s.status = 'completed'
  s.endedAt = time.nowMs()
  s.completionKey = key
  s.revision += 1
  s.updatedAt = time.nowMs()
  if (share) {
    s.sharedAt = time.nowMs()
  }
  // 未完成必做组标记 skipped（不自动补齐实际值）
  s.exercises.forEach((ex) => {
    ;(ex.sets || []).forEach((set) => {
      if (set.state === 'pending' && set.required !== false) {
        set.state = 'skipped'
      }
    })
  })

  store.finalizeKeys[key] = s.id

  let nextPlan = null
  let nextPlanError = null
  try {
    if (share || s.sourceType === 'coach_post_session') {
      // 教练同步课后表后触发；学员自主完成也可生成个人草稿
      const gen = generateNextPlanDraft(app, s, 'rule_copy')
      nextPlan = gen.plan
    }
  } catch (e) {
    nextPlanError = '训练表已同步，下次计划生成失败，可重试'
  }

  persist(app)
  return Promise.resolve({
    data: {
      session: presentSession(s),
      next_plan: nextPlan,
      next_plan_error: nextPlanError,
      idempotent: false
    },
    request_id: makeId('req')
  })
}

function abandonSession(app, sessionId) {
  const store = ensureStore(app)
  const s = findSession(store, sessionId)
  if (!s) return Promise.reject({ code: 'NOT_FOUND', message: '训练不存在' })
  if (s.status === 'completed') {
    return Promise.reject({ code: 'INVALID_STATE', message: '已完成不可放弃' })
  }
  s.status = 'abandoned'
  s.endedAt = time.nowMs()
  s.revision += 1
  persist(app)
  return Promise.resolve({ data: presentSession(s), request_id: makeId('req') })
}

function listSessions(app, filter) {
  const store = ensureStore(app)
  let list = store.sessions.slice()
  if (filter.studentId) list = list.filter((s) => s.studentId === filter.studentId)
  if (filter.coachId) list = list.filter((s) => s.coachId === filter.coachId)
  if (filter.status) {
    const arr = Array.isArray(filter.status) ? filter.status : [filter.status]
    list = list.filter((s) => arr.indexOf(s.status) !== -1)
  }
  if (filter.sharedOnly) list = list.filter((s) => !!s.sharedAt)
  list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  return Promise.resolve({
    data: list.map(presentSession),
    request_id: makeId('req')
  })
}

/**
 * 获取计划草稿并更新（C05）
 */
function getPlan(app, planId) {
  const store = ensureStore(app)
  const plan = findPlan(store, planId)
  if (!plan) return Promise.reject({ code: 'NOT_FOUND', message: '计划不存在' })
  return Promise.resolve({ data: presentPlan(store, plan), request_id: makeId('req') })
}

function updatePlanDraft(app, planId, { version, title, goal, plannedDate, exercises, reason, base_revision }) {
  const store = ensureStore(app)
  const plan = findPlan(store, planId)
  if (!plan) return Promise.reject({ code: 'NOT_FOUND', message: '计划不存在' })
  const latest = latestRevision(store, planId)
  if (version != null && (!latest || version !== latest.version)) throw new AppError('REVISION_CONFLICT', '计划已有新版本，请重新载入')
  let rev = latest
  if (rev && rev.status === 'draft' && base_revision != null && base_revision !== (rev.revision || 1)) throw new AppError('REVISION_CONFLICT', '草稿已被更新，本地修改已保留，请重新载入后合并')
  // Validate a detached candidate before touching the shared in-memory store.
  const base = rev || publishedRevision(store, plan) || {}
  const nextTitle = title != null ? title : base.title || '训练计划'
  const nextGoal = goal != null ? goal : base.goal || ''
  const nextReason = reason != null ? reason : base.reason || '手动编辑'
  if (typeof nextTitle !== 'string' || !nextTitle.trim() || nextTitle.trim().length > 60) planValidation.invalid('标题需为 1–60 字')
  if (typeof nextGoal !== 'string' || nextGoal.length > 500 || typeof nextReason !== 'string' || nextReason.length > 500) planValidation.invalid('目标和修改说明最多 500 字')
  const nextDate = planValidation.date(plannedDate != null ? plannedDate : base.plannedDate || todayBusinessDate())
  const nextExercises = planValidation.exercises(exercises != null ? exercises : base.exercises || [], false)
  if (!rev || rev.status !== 'draft') {
    // 基于已发布版新建草稿
    const pub = publishedRevision(store, plan) || latestRevision(store, planId)
    const newVersion = (latestRevision(store, planId) || { version: 0 }).version + 1
    rev = {
      id: makeId('prev'),
      planId,
      version: newVersion,
      status: 'draft',
      title: (pub && pub.title) || '训练计划',
      goal: (pub && pub.goal) || '',
      plannedDate: (pub && pub.plannedDate) || todayBusinessDate(),
      exercises: JSON.parse(JSON.stringify((pub && pub.exercises) || [])),
      reason: '手动编辑',
      missingNotes: [],
      publishedAt: null,
      createdAt: time.nowMs()
    }
    store.planRevisions.push(rev)
  }
  rev.title = nextTitle.trim()
  rev.goal = nextGoal
  rev.plannedDate = nextDate
  rev.exercises = nextExercises
  rev.reason = nextReason
  rev.revision = (rev.revision || 1) + 1
  plan.updatedAt = time.nowMs()
  persist(app)
  return Promise.resolve({ data: presentPlan(store, plan), request_id: makeId('req') })
}

function updateDraftSet(app, planId, version, exerciseId, setId, patch) {
  const store = ensureStore(app)
  const rev = findRevision(store, planId, version)
  if (!rev || rev.status !== 'draft') {
    return Promise.reject({ code: 'INVALID_STATE', message: '仅草稿可编辑' })
  }
  let hit = null
  rev.exercises.forEach((ex) => {
    if (ex.id !== exerciseId) return
    ;(ex.sets || []).forEach((set) => {
      if (set.id === setId) hit = set
    })
  })
  if (!hit) return Promise.reject({ code: 'NOT_FOUND', message: '组不存在' })
  if (patch.targetWeight != null) hit.targetWeight = patch.targetWeight
  if (patch.targetReps != null) hit.targetReps = patch.targetReps
  persist(app)
  const plan = findPlan(store, planId)
  return Promise.resolve({ data: presentPlan(store, plan), request_id: makeId('req') })
}

function publishPlan(app, planId, { version, reviewConfirmation, baseRevision }) {
  const store = ensureStore(app)
  const plan = findPlan(store, planId)
  if (!plan) return Promise.reject({ code: 'NOT_FOUND', message: '计划不存在' })
  if (!reviewConfirmation) {
    return Promise.reject({ code: 'CONFIRM_REQUIRED', message: '发布前须显式确认' })
  }
  const rev = findRevision(store, planId, version)
  if (!rev || rev.status !== 'draft') {
    return Promise.reject({ code: 'INVALID_STATE', message: '仅草稿可发布' })
  }
  if (rev !== latestRevision(store, planId) || (baseRevision != null && baseRevision !== (rev.revision || 1))) throw new AppError('REVISION_CONFLICT', '草稿已更新，请重新核对后发布')
  planValidation.exercises(rev.exercises, true)
  planValidation.date(rev.plannedDate)
  if (rev.plannedDate < todayBusinessDate()) planValidation.invalid('不能发布过去日期的训练计划')
  // 旧已发布 → superseded
  if (plan.currentPublishedRevision) {
    const old = findRevision(store, planId, plan.currentPublishedRevision)
    if (old && old.status === 'published') old.status = 'superseded'
  }
  rev.status = 'published'
  rev.publishedAt = time.nowMs()
  plan.currentPublishedRevision = rev.version
  plan.updatedAt = time.nowMs()
  persist(app)
  return Promise.resolve({ data: presentPlan(store, plan), request_id: makeId('req') })
}

function retryNextPlan(app, sessionId) {
  const store = ensureStore(app)
  const s = findSession(store, sessionId)
  if (!s || s.status !== 'completed') {
    return Promise.reject({ code: 'INVALID_STATE', message: '仅已完成训练可生成下次计划' })
  }
  // 强制重新生成：换 generation_version
  const gen = generateNextPlanDraft(app, s, 'rule_copy_v' + time.nowMs())
  return Promise.resolve({ data: gen.plan, request_id: makeId('req') })
}

function completedSessionStats(app, studentId) {
  const store = ensureStore(app)
  const list = store.sessions.filter(
    (s) => s.studentId === studentId && s.status === 'completed' && countDoneSets(s) > 0
  )
  const dates = {}
  list.forEach((s) => {
    dates[s.businessDate] = true
  })
  return {
    sessionCount: list.length,
    trainingDays: Object.keys(dates).length
  }
}

/**
 * 从动作库加入学员个人计划草稿（不直接改已发布快照）
 */
function addExerciseToPersonalPlan(app, studentId, exerciseMeta) {
  const store = ensureStore(app)
  let plan = store.plans.find(p => p.studentId === studentId && p.authorId === studentId && p.sourceType === 'personal_library')
  if (!plan) {
    plan = { id: makeId('plan'), studentId, authorId: studentId, authorRole: 'student', sourceType: 'personal_library', currentPublishedRevision: null, createdAt: time.nowMs(), updatedAt: time.nowMs() }
    store.plans.push(plan)
  }
  const planId = plan.id
  // 确保有 draft
  return updatePlanDraft(app, planId, {
    title: (latestRevision(store, planId) || {}).title || '我的自主训练计划',
    reason: '从动作库加入'
  }).then(() => {
    const draft = latestRevision(store, planId)
    if (!draft || draft.status !== 'draft') {
      return Promise.reject({ code: 'NO_DRAFT', message: '无法创建计划草稿' })
    }
    const sets = buildSetsFromTarget(
      1,
      null,
      null,
      true
    )
    draft.exercises.push({
      id: makeId('pex'),
      exerciseId: exerciseMeta.id,
      name: exerciseMeta.name,
      icon: exerciseMeta.icon || '🏋️',
      order: draft.exercises.length + 1,
      loadBasis: exerciseMeta.metricType === 'reps' ? 'bodyweight' : 'unknown',
      sets
    })
    plan.updatedAt = time.nowMs()
    persist(app)
    return {
      data: presentPlan(store, plan),
      request_id: makeId('req')
    }
  })
}

module.exports = {
  EXERCISE_LIBRARY,
  ensureStore,
  ensureDefaultPublishedPlan,
  listPlansForStudent,
  startSessionFromPlan,
  createCoachDraftSession,
  getSession,
  patchSessionMeta,
  addExercise,
  removeExercise,
  updateActualSet,
  parseTextToExercises,
  mergeParsedSegments,
  finalizeSession,
  abandonSession,
  listSessions,
  getPlan,
  updatePlanDraft,
  updateDraftSet,
  publishPlan,
  retryNextPlan,
  generateNextPlanDraft,
  completedSessionStats,
  addExerciseToPersonalPlan,
  presentSession,
  presentPlan,
  countDoneSets
}
