/**
 * 口述/文字 → 结构化候选（第 7.3 节）
 * - 缺失单位、次数、组数 → missing_fields，不擅自补全（AC11）
 * - 「50 × 5」不补三组；「哑铃 16」不擅自判单侧/总重
 * - LLM 正式输出：coach_session_summary.v1（session_summary + exercises）
 * - 规则引擎仍产出 segments，再包装为同一形状（并派生 exercises）
 */

const EXERCISE_LIBRARY = [
  { id: 'squat', name: '杠铃深蹲', aliases: ['深蹲'], icon: '🏋️' },
  { id: 'rdl', name: '罗马尼亚硬拉', aliases: ['硬拉', 'RDL'], icon: '🦵' },
  { id: 'hip_thrust', name: '臀推', aliases: ['臀桥'], icon: '🍑' },
  { id: 'bench', name: '杠铃卧推', aliases: ['卧推'], icon: '💪' },
  { id: 'db_bench', name: '哑铃卧推', aliases: ['哑铃推胸'], icon: '💪' },
  { id: 'core', name: '核心训练', aliases: ['卷腹', '平板支撑'], icon: '🧘' }
]

function libraryItem(name) {
  const n = String(name || '').trim()
  if (!n) return null
  // 精确名优先，再别名；避免「哑铃卧推」命中「卧推」
  const exact = EXERCISE_LIBRARY.find((e) => e.name === n)
  if (exact) return exact
  const byAlias = EXERCISE_LIBRARY.find((e) => e.aliases.some((a) => n === a))
  if (byAlias) return byAlias
  return (
    EXERCISE_LIBRARY.find(
      (e) =>
        n.indexOf(e.name) !== -1 ||
        e.aliases.some((a) => a.length >= 2 && n.indexOf(a) !== -1)
    ) || null
  )
}

function makeSegmentId(taskId, idx) {
  return (taskId || 'seg') + '_' + (idx + 1)
}

/**
 * @param {string} text
 * @param {{ taskId?: string }} opts
 */
function structureText(text, opts = {}) {
  const taskId = opts.taskId || 'local'
  const chunks = String(text || '')
    .split(/\n|；|;|。/)
    .map((l) => l.trim())
    .filter(Boolean)

  const segments = []
  const unparsed = []

  chunks.forEach((line, idx) => {
    const seg = parseLine(line, makeSegmentId(taskId, idx))
    if (!seg) {
      unparsed.push(line)
      return
    }
    segments.push(seg)
  })

  return wrapStructured({
    schema_version: 'workout_draft.v1',
    segments,
    unparsed_text: unparsed
  })
}

/**
 * 将 exercises 展开为可合并的 segments（每档重量一组一条）
 */
function exercisesToSegments(exercises, opts = {}) {
  const taskId = opts.taskId || 'seg'
  const segments = []
  let idx = 0
  ;(exercises || []).forEach((ex) => {
    const name = (ex && ex.name) || '（待确认动作）'
    const lib = libraryItem(name)
    const sets = Array.isArray(ex.sets) && ex.sets.length ? ex.sets : [{}]
    sets.forEach((s) => {
      const missing = []
      if (!name || name === '（待确认动作）') missing.push('exercise_name')
      if (s.set_count == null) missing.push('set_count')
      if (s.reps == null) missing.push('reps')
      if (s.weight_kg == null) missing.push('weight_kg')
      segments.push({
        segment_id: makeSegmentId(taskId, idx++),
        raw_name: name,
        exercise_candidate: lib ? lib.id : null,
        display_name: lib ? lib.name : name,
        icon: lib ? lib.icon : '🏋️',
        weight_kg: s.weight_kg != null ? Number(s.weight_kg) : null,
        candidate_reps_per_set: s.reps != null ? Number(s.reps) : null,
        set_count: s.set_count != null ? Number(s.set_count) : null,
        load_basis: 'unknown',
        missing_fields: missing,
        requires_confirmation: missing.length > 0,
        evidence_text:
          name +
          ' ' +
          (s.weight_kg != null ? s.weight_kg + 'kg ' : '') +
          (s.set_count != null ? s.set_count + '组 ' : '') +
          (s.reps != null ? s.reps + '次' : ''),
        performance: (ex && ex.performance) || '',
        next_session_suggestion: (ex && ex.next_session_suggestion) || ''
      })
    })
  })
  return segments
}

/**
 * segments → exercises（同名合并多档重量）
 */
function segmentsToExercises(segments) {
  const byName = new Map()
  ;(segments || []).forEach((seg) => {
    const name = seg.display_name || seg.raw_name || '（待确认动作）'
    if (!byName.has(name)) {
      byName.set(name, {
        name,
        sets: [],
        performance: seg.performance || '',
        next_session_suggestion: seg.next_session_suggestion || ''
      })
    }
    const ex = byName.get(name)
    ex.sets.push({
      weight_kg: seg.weight_kg != null ? Number(seg.weight_kg) : null,
      reps: seg.candidate_reps_per_set != null ? Number(seg.candidate_reps_per_set) : null,
      set_count: seg.set_count != null ? Number(seg.set_count) : null
    })
  })
  return Array.from(byName.values())
}

function wrapStructured(data, opts = {}) {
  const out = Object.assign({}, data || {})
  const taskId = opts.taskId || 'seg'

  if (Array.isArray(out.exercises) && out.exercises.length && !Array.isArray(out.segments)) {
    out.segments = exercisesToSegments(out.exercises, { taskId })
  }
  if (!Array.isArray(out.segments)) out.segments = []
  if (!Array.isArray(out.unparsed_text)) out.unparsed_text = []
  if (!Array.isArray(out.exercises) || !out.exercises.length) {
    out.exercises = segmentsToExercises(out.segments)
  }
  if (!Array.isArray(out.needs_confirmation)) {
    out.needs_confirmation = []
  }
  out.segments.forEach((seg) => {
    ;(seg.missing_fields || []).forEach((f) => {
      const tip = (seg.display_name || '动作') + ' 缺少 ' + f
      if (out.needs_confirmation.indexOf(tip) < 0) out.needs_confirmation.push(tip)
    })
  })
  out.unparsed_text.forEach((t) => {
    const tip = '未解析：' + t
    if (out.needs_confirmation.indexOf(tip) < 0) out.needs_confirmation.push(tip)
  })
  if (out.session_summary == null) {
    out.session_summary = out.exercises.length
      ? '本次训练包含：' + out.exercises.map((e) => e.name).join('、') + '。'
      : ''
  } else {
    out.session_summary = String(out.session_summary)
  }
  if (out.coach_record == null) out.coach_record = ''
  else out.coach_record = String(out.coach_record)
  if (out.coach_feedback == null) out.coach_feedback = ''
  else out.coach_feedback = String(out.coach_feedback)
  if (out.fatigue_or_discomfort == null) out.fatigue_or_discomfort = ''
  else out.fatigue_or_discomfort = String(out.fatigue_or_discomfort)
  if (!Array.isArray(out.model_inferences)) out.model_inferences = []
  if (!out.schema_version || out.schema_version === 'workout_draft.v1') {
    // 对外统一新版本；segments 仍保留供合并
    if (out.exercises.length || out.session_summary || out.coach_record) {
      out.schema_version = 'coach_session_summary.v1'
    }
  }
  return out
}

function parseLine(line, segmentId) {
  let name = ''
  let setCount = null
  let reps = null
  let weight = null
  let loadBasis = 'unknown'

  // 「50公斤 5次」或「50 kg × 5」——可能无动作名（AC11）
  const bare =
    line.match(
      /^(?:(\d+(?:\.\d+)?)\s*(?:kg|公斤)\s*(?:[×xX*]\s*)?(\d+)\s*(?:次|reps?)?)$/i
    ) ||
    line.match(/^(?:(\d+(?:\.\d+)?)\s*(?:[×xX*])\s*(\d+)\s*(?:次)?)$/i)

  if (bare && !/[一-龥a-zA-Z]{2,}/.test(line.replace(/\d|kg|公斤|次|组|x|×|\s|\./gi, ''))) {
    // 纯数字重量×次数，无动作名、无组数
    weight = +bare[1]
    reps = +bare[2]
    name = ''
    const missing = ['exercise_name', 'set_count', 'load_basis']
    return {
      segment_id: segmentId,
      raw_name: '',
      exercise_candidate: null,
      display_name: '（待确认动作）',
      icon: '❓',
      weight_kg: weight,
      candidate_reps_per_set: reps,
      set_count: null,
      load_basis: 'unknown',
      missing_fields: missing,
      requires_confirmation: true,
      evidence_text: line,
      merge_hint: '缺组数与重量口径，不自动补默认组数'
    }
  }

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
      .replace(/\s+/g, ' ')
      .trim()
    setCount = setsMatch ? +setsMatch[1] : null
    reps = repsMatch ? +repsMatch[1] : null
    weight = weightMatch ? +weightMatch[1] : null
  }

  // 「哑铃 16」/「哑铃卧推 16」：数字无 kg 单位 → 记重量但口径未知
  if (/哑铃/.test(line) && weight == null) {
    const bareNum =
      line.match(/哑铃[^0-9]{0,6}?(\d+(?:\.\d+)?)/) ||
      line.match(/(\d+(?:\.\d+)?)\s*(?=次|组)/)
    if (bareNum) {
      weight = +bareNum[1]
      // 从名称里去掉该裸数字，避免动作名带「16」
      name = name.replace(new RegExp('\\s*' + bareNum[1] + '\\s*'), ' ').trim()
    }
    loadBasis = 'unknown'
  }

  if (/单侧|每侧/.test(line)) loadBasis = 'per_side'
  else if (/总重|两边合计|合计/.test(line)) loadBasis = 'total'
  else if (weight != null && /杠铃/.test(line) && !/哑铃/.test(line)) loadBasis = 'total'
  else if (weight != null && /哑铃/.test(line)) loadBasis = 'unknown'

  if (!name && weight == null && reps == null && setCount == null) return null

  let resolvedLib = name ? libraryItem(name) : null
  if (/哑铃/.test(line) && !resolvedLib) {
    resolvedLib = libraryItem('哑铃卧推')
  }
  if (/哑铃/.test(line) && resolvedLib && resolvedLib.id === 'bench') {
    // 避免「哑铃卧推」被「卧推」别名误匹配到杠铃
    resolvedLib = libraryItem('哑铃卧推')
  }
  const missing = []
  if (!name && !resolvedLib) missing.push('exercise_name')
  if (setCount == null) missing.push('set_count')
  if (reps == null) missing.push('reps')
  if (weight != null && loadBasis === 'unknown' && /哑铃/.test(line)) {
    missing.push('load_basis')
  }

  return {
    segment_id: segmentId,
    raw_name: name || '',
    exercise_candidate: resolvedLib ? resolvedLib.id : null,
    display_name: resolvedLib ? resolvedLib.name : name || '（待确认动作）',
    icon: resolvedLib ? resolvedLib.icon : '🏋️',
    weight_kg: weight,
    candidate_reps_per_set: reps,
    set_count: setCount,
    load_basis: loadBasis,
    missing_fields: missing,
    requires_confirmation: missing.length > 0,
    evidence_text: line
  }
}

/**
 * 优先走统一 LLM；失败或未配置时回退规则解析（保证 AC11）
 */
async function structureTextWithLlm(text, opts = {}) {
  const llm = require('../llm')
  if (!llm.isTaskEnabled('voice_structure')) {
    return structureText(text, opts)
  }
  try {
    const out = await llm.runTask(
      'voice_structure',
      { text, taskId: opts.taskId || 'seg' },
      { mode: 'real' }
    )
    return wrapStructured(out.data || {}, { taskId: opts.taskId || 'seg' })
  } catch (_) {
    return structureText(text, opts)
  }
}

module.exports = {
  structureText,
  structureTextWithLlm,
  parseLine,
  libraryItem,
  exercisesToSegments,
  segmentsToExercises,
  wrapStructured,
  EXERCISE_LIBRARY
}
