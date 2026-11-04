/**
 * 语音任务：录音/文字 → 转写 → 结构化 → 冲突检测 → 教练确认合并（7.3）
 */

const time = require('../../lib/time')
const { makeId } = require('../../lib/ids')
const { AppError } = require('../../lib/errors')
const { getAdapter } = require('./adapters')
const { structureTextWithLlm } = require('./structure')
const trainingService = require('../trainingService')

function ensureVoice(state) {
  if (!state.voice) {
    state.voice = { tasks: [], mergeLog: [] }
  }
  return state.voice
}

/**
 * 创建任务：记录 base_revision；异步转写+结构化
 */
async function createTask(state, app, sessionId, actor, body) {
  const voice = ensureVoice(state)
  const sessRes = await trainingService.getSession(app, sessionId)
  const session = sessRes.data
  if (!session) throw new AppError('NOT_FOUND', '训练不存在')
  if (session.status === 'completed') {
    throw new AppError('INVALID_STATE', '已同步记录请走修订')
  }

  const baseRevision =
    body.base_revision != null ? Number(body.base_revision) : session.revision

  const task = {
    id: makeId('vtask'),
    sessionId,
    studentId: session.student_id,
    coachUserId: actor.userId,
    source: body.source || (body.text ? 'text' : 'voice'),
    status: 'processing',
    baseRevision,
    provider: body.provider || process.env.VOICE_ASR_PROVIDER || 'mock',
    transcript: null,
    structured: null,
    conflicts: [],
    mergedSegmentIds: [],
    error: null,
    createdAt: time.nowMs(),
    updatedAt: time.nowMs(),
    // 姓名提示仅作展示，归属以页面选定学员为准
    nameHint: body.name_hint || null
  }
  voice.tasks.push(task)

  try {
    let text = body.text || ''
    if (!text) {
      const adapter = getAdapter(task.provider)
      const asr = await adapter.transcribe({
        audioBase64: body.audio_base64,
        mediaUrl: body.media_url,
        demoPhrase: body.demo_phrase,
        locale: body.locale || 'zh-CN'
      })
      task.transcript = asr
      text = asr.text || ''
    } else {
      task.transcript = {
        provider: 'passthrough',
        text,
        confidence: 1
      }
    }

    task.structured = await structureTextWithLlm(text, { taskId: task.id })
    // 用最新会话算冲突（AC12：等待期间人工改动）
    const latest = (await trainingService.getSession(app, sessionId)).data
    task.conflicts = detectConflicts(latest, task.structured.segments, baseRevision)
    task.status = 'ready'
    task.updatedAt = time.nowMs()
  } catch (e) {
    task.status = 'failed'
    task.error = {
      code: e.code || 'ASR_FAILED',
      message: e.message || '转写失败',
      retryable: !!e.retryable
    }
    task.updatedAt = time.nowMs()
  }

  return presentTask(task)
}

async function getTask(state, app, taskId) {
  const voice = ensureVoice(state)
  const task = voice.tasks.find((t) => t.id === taskId)
  if (!task) throw new AppError('NOT_FOUND', '语音任务不存在')
  // AC12：拉取时按当前会话重算冲突，不覆盖人工值
  if (task.status === 'ready' || task.status === 'partially_merged') {
    try {
      const latest = (await trainingService.getSession(app, task.sessionId)).data
      task.conflicts = detectConflicts(
        latest,
        (task.structured && task.structured.segments) || [],
        task.baseRevision
      )
    } catch (_) {}
  }
  return presentTask(task)
}

function listTasks(state, sessionId) {
  const voice = ensureVoice(state)
  return voice.tasks
    .filter((t) => t.sessionId === sessionId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(presentTask)
}

/**
 * 冲突：base_revision 落后 或 同名动作已有人工重量与候选不同
 */
function detectConflicts(session, segments, baseRevision) {
  const conflicts = []
  if (session.revision !== baseRevision) {
    conflicts.push({
      type: 'revision_drift',
      message: '识别等待期间记录已更新',
      base_revision: baseRevision,
      current_revision: session.revision
    })
  }

  ;(segments || []).forEach((seg) => {
    const existing = (session.exercises || []).find(
      (ex) =>
        ex.name === seg.display_name ||
        (seg.exercise_candidate && ex.exerciseId === seg.exercise_candidate)
    )
    if (!existing) return
    const humanWeights = (existing.sets || [])
      .map((s) => s.actualWeight)
      .filter((w) => w != null)
    if (
      seg.weight_kg != null &&
      humanWeights.length &&
      humanWeights.some((w) => Number(w) !== Number(seg.weight_kg))
    ) {
      conflicts.push({
        type: 'field_conflict',
        field: 'weight_kg',
        segment_id: seg.segment_id,
        exercise_id: existing.id,
        human_value: humanWeights,
        ai_value: seg.weight_kg,
        resolution_default: 'keep_human',
        message: '冲突字段优先保留人工值，AI 值作可采纳候选'
      })
    }
  })
  return conflicts
}

/**
 * 合并：append | supplement | replace_sets
 * - 同名不自动覆盖（需明确 mode）
 * - 同一 segment_id 不重复（AC13）
 * - 冲突默认 keep_human（AC12）
 */
async function mergeTask(state, app, sessionId, taskId, body, actor) {
  const voice = ensureVoice(state)
  const task = voice.tasks.find((t) => t.id === taskId)
  if (!task) throw new AppError('NOT_FOUND', '语音任务不存在')
  if (task.sessionId !== sessionId) throw new AppError('FORBIDDEN', '任务与会话不匹配')
  // merged 也允许再调（AC13：同 segment 返回 already_merged，不重复写入）
  if (task.status === 'failed' || task.status === 'processing') {
    throw new AppError('INVALID_STATE', '任务未就绪或已失败')
  }

  const sessRes = await trainingService.getSession(app, sessionId)
  const session = sessRes.data
  if (body.base_revision != null && Number(body.base_revision) !== session.revision) {
    throw new AppError('REVISION_CONFLICT', '记录已被更新', {
      extra: { latest_revision: session.revision }
    })
  }

  const mode = body.mode || 'append'
  const resolutions = body.resolutions || {} // segment_id -> keep_human | take_ai
  let segmentIds = body.segment_ids
  if (!segmentIds || !segmentIds.length) {
    segmentIds = (task.structured.segments || [])
      .filter((s) => !s.requires_confirmation)
      .map((s) => s.segment_id)
  }

  const toMerge = []
  const skipped = []
  ;(task.structured.segments || []).forEach((seg) => {
    if (segmentIds.indexOf(seg.segment_id) === -1) return
    if (task.mergedSegmentIds.indexOf(seg.segment_id) !== -1) {
      skipped.push({ segment_id: seg.segment_id, reason: 'already_merged' })
      return
    }
    // 仍缺字段：除非教练在 resolutions 里补全了 patch
    const patch = (body.segment_patches && body.segment_patches[seg.segment_id]) || {}
    const filled = Object.assign({}, seg, patch)
    if (filled.set_count == null || filled.candidate_reps_per_set == null) {
      skipped.push({ segment_id: seg.segment_id, reason: 'missing_fields' })
      return
    }
    if (!filled.display_name || filled.display_name === '（待确认动作）') {
      if (!patch.display_name && !patch.exercise_candidate) {
        skipped.push({ segment_id: seg.segment_id, reason: 'missing_exercise' })
        return
      }
    }
    toMerge.push(filled)
  })

  // 应用冲突策略：默认保留人工，不覆盖已有动作的人工组
  const store = trainingService.ensureStore(app)
  const s = store.sessions.find((x) => x.id === sessionId)
  const snapshotBefore = JSON.parse(JSON.stringify(s.exercises || []))

  toMerge.forEach((seg) => {
    const existingIdx = (s.exercises || []).findIndex(
      (ex) =>
        ex.name === seg.display_name ||
        (seg.exercise_candidate && ex.exerciseId === seg.exercise_candidate)
    )

    if (existingIdx >= 0 && mode === 'append') {
      // 同名不自动覆盖：跳过并提示选 supplement / replace_sets
      skipped.push({
        segment_id: seg.segment_id,
        reason: 'same_name_exists',
        message: '同名动作已存在，请选择补充或替换指定组'
      })
      return
    }

    const resolve = resolutions[seg.segment_id] || 'keep_human'
    let weight = seg.weight_kg
    if (existingIdx >= 0 && resolve === 'keep_human') {
      const human = s.exercises[existingIdx].sets.find((x) => x.actualWeight != null)
      if (human) weight = human.actualWeight
    }

    const setCount = Number(seg.set_count)
    const reps = Number(seg.candidate_reps_per_set)
    const sets = []
    for (let i = 1; i <= setCount; i++) {
      sets.push({
        id: makeId('aset'),
        setNo: i,
        targetWeight: weight,
        targetReps: reps,
        actualWeight: weight,
        actualReps: reps,
        state: 'pending',
        required: true,
        effort: null
      })
    }

    const exercise = {
      id: makeId('sex'),
      exerciseId: seg.exercise_candidate || null,
      name: seg.display_name,
      nameSnapshot: seg.display_name,
      icon: seg.icon || '🏋️',
      order: s.exercises.length + 1,
      loadBasis: seg.load_basis || 'unknown',
      sets,
      fromSegmentId: seg.segment_id,
      fromTaskId: task.id
    }

    if (mode === 'replace_sets' && existingIdx >= 0) {
      exercise.order = s.exercises[existingIdx].order
      s.exercises[existingIdx] = exercise
    } else if (mode === 'supplement' && existingIdx >= 0) {
      // 追加组到现有动作
      const ex = s.exercises[existingIdx]
      const base = ex.sets.length
      sets.forEach((set, i) => {
        set.setNo = base + i + 1
        ex.sets.push(set)
      })
      ex.fromSegmentId = seg.segment_id
    } else {
      s.exercises.push(exercise)
    }

    task.mergedSegmentIds.push(seg.segment_id)
  })

  s.revision += 1
  s.updatedAt = time.nowMs()
  if (s.status === 'draft') s.status = 'in_progress'

  voice.mergeLog.push({
    id: makeId('mlog'),
    taskId: task.id,
    sessionId,
    actorId: actor.userId,
    mode,
    merged: toMerge.map((s) => s.segment_id),
    skipped,
    before: snapshotBefore,
    createdAt: time.nowMs()
  })

  task.status =
    task.mergedSegmentIds.length >= (task.structured.segments || []).length
      ? 'merged'
      : 'partially_merged'
  task.updatedAt = time.nowMs()
  app.persist()

  return {
    session: trainingService.presentSession(s),
    task: presentTask(task),
    skipped,
    merged_count: toMerge.length - skipped.filter((x) => x.reason === 'same_name_exists').length
  }
}

/** 撤销最近一次合并（按 mergeLog） */
async function undoLastMerge(state, app, sessionId, actor) {
  const voice = ensureVoice(state)
  const logs = voice.mergeLog.filter((m) => m.sessionId === sessionId)
  const last = logs[logs.length - 1]
  if (!last) throw new AppError('NOT_FOUND', '没有可撤销的合并')

  const store = trainingService.ensureStore(app)
  const s = store.sessions.find((x) => x.id === sessionId)
  if (!s || s.status === 'completed') {
    throw new AppError('INVALID_STATE', '当前状态不可撤销合并')
  }

  s.exercises = last.before
  s.revision += 1
  s.updatedAt = time.nowMs()

  const task = voice.tasks.find((t) => t.id === last.taskId)
  if (task) {
    last.merged.forEach((sid) => {
      const i = task.mergedSegmentIds.indexOf(sid)
      if (i >= 0) task.mergedSegmentIds.splice(i, 1)
    })
    task.status = 'ready'
    task.updatedAt = time.nowMs()
  }
  voice.mergeLog.pop()
  app.persist()

  return {
    session: trainingService.presentSession(s),
    undone_merge_id: last.id
  }
}

function presentTask(task) {
  return {
    task_id: task.id,
    session_id: task.sessionId,
    status: task.status,
    source: task.source,
    provider: task.provider,
    base_revision: task.baseRevision,
    transcript: task.transcript,
    structured: task.structured,
    conflicts: task.conflicts || [],
    merged_segment_ids: task.mergedSegmentIds || [],
    error: task.error,
    name_hint: task.nameHint,
    created_at: task.createdAt,
    updated_at: task.updatedAt
  }
}

module.exports = {
  createTask,
  getTask,
  listTasks,
  mergeTask,
  undoLastMerge,
  detectConflicts,
  presentTask,
  ensureVoice
}
