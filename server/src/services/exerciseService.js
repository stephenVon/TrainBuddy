/**
 * 动作库（S06）：仅已审核公开内容进入学员教学列表。
 * 公开目录来自 free-exercise-db（Unlicense）；名称与步骤以中文展示。
 */

const time = require('../lib/time')
const { exerciseImageUrl } = require('../lib/exerciseImage')
const { translateName, translateInstructions, targetLabel, TARGET_LABELS } = require('../lib/exerciseZh')
const importedCatalog = require('../data/exercise-catalog.json')
let instructionsZh = { items: {} }
try { instructionsZh = require('../data/exercise-instructions-zh.json') } catch (_) {}

const CURATED = [
  {
    id: 'draft_unreviewed',
    sourceId: 'curated:draft_unreviewed',
    name: '未审核实验动作',
    aliases: [],
    muscleGroup: '全身',
    bodyPart: '',
    target: '',
    equipment: 'other',
    difficulty: '高级',
    metricType: 'weight_reps',
    icon: '⚠️',
    reviewStatus: 'pending',
    instructions: ['不应出现在学员列表'],
    cues: [],
    commonErrors: [],
    defaultSets: 3,
    defaultReps: 8,
    defaultWeight: 20,
    reviewer: null,
    updatedAt: '2026-10-14',
    origin: 'curated'
  }
]

const BODY_PART_LABELS = {
  waist: '腰腹',
  'upper legs': '大腿',
  'lower legs': '小腿',
  chest: '胸部',
  back: '背部',
  shoulders: '肩部',
  'upper arms': '上臂',
  'lower arms': '前臂',
  neck: '颈部',
  cardio: '有氧'
}

const EQUIPMENT_LABELS = {
  barbell: '杠铃',
  dumbbell: '哑铃',
  'body only': '自重',
  none: '徒手',
  machine: '器械',
  cable: '绳索',
  kettlebells: '壶铃',
  bands: '弹力带',
  other: '其他',
  'e-z curl bar': 'EZ 杠',
  'exercise ball': '健身球',
  'foam roll': '泡沫轴',
  'medicine ball': '药球'
}

let catalogCache = null

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function upsertBySource(target, rows) {
  const index = new Map(target.map((row) => [row.sourceId || row.id, row]))
  let inserted = 0
  rows.forEach((row) => {
    const key = row.sourceId || row.id
    if (index.has(key)) {
      const current = index.get(key)
      Object.assign(current, row, {
        reviewStatus: current.origin === 'curated' ? current.reviewStatus : row.reviewStatus
      })
      return
    }
    index.set(key, row)
    target.push(row)
    inserted += 1
  })
  return { total: target.length, inserted }
}

function loadPublicCatalog() {
  if (catalogCache) return catalogCache
  const imported = (importedCatalog.items || []).map((row) => Object.assign({
    aliases: [],
    cues: [],
    commonErrors: [],
    difficulty: '',
    icon: '🏋️',
    reviewer: 'free-exercise-db 导入',
    updatedAt: importedCatalog.importedAt || '',
    origin: 'free-exercise-db'
  }, row, { reviewStatus: 'approved' }))
  const rows = []
  upsertBySource(rows, CURATED.map(clone))
  upsertBySource(rows, imported)
  catalogCache = rows
  return catalogCache
}

/** 可重复执行：按 sourceId 去重灌入公开目录，不写入自定义动作。 */
function seedExerciseCatalog(state) {
  if (!state.exerciseMeta) state.exerciseMeta = { favorites: {}, reviews: {} }
  if (!state.customExercises) state.customExercises = []
  const catalog = loadPublicCatalog()
  const fingerprint = catalog.map((row) => row.sourceId || row.id).sort().join('|')
  const again = loadPublicCatalog()
  const againFingerprint = again.map((row) => row.sourceId || row.id).sort().join('|')
  state.exerciseCatalog = {
    version: importedCatalog.imageCommit,
    source: importedCatalog.source,
    license: importedCatalog.license,
    reviewStatus: 'approved',
    reviewReason: importedCatalog.reviewReason,
    count: catalog.filter((row) => row.reviewStatus === 'approved').length,
    seededAt: time.nowMs()
  }
  return {
    count: catalog.length,
    approved: state.exerciseCatalog.count,
    idempotent: fingerprint === againFingerprint
  }
}

function ensureStore(app) {
  const gd = app.globalData
  if (!gd.exerciseMeta) gd.exerciseMeta = { favorites: {}, reviews: {} }
  if (!gd.customExercises) gd.customExercises = []
  if (!gd.exerciseCatalog) seedExerciseCatalog(gd)
  return gd.exerciseMeta
}

function applyReview(app, exercise) {
  const reviews = ((app.globalData.exerciseMeta || {}).reviews) || {}
  const decision = reviews[exercise.id] && reviews[exercise.id].decision
  if (!decision) return exercise.reviewStatus
  if (decision === 'approve' || decision === 'approved') return 'approved'
  if (decision === 'reject' || decision === 'rejected') return 'rejected'
  return decision
}

function allExercises(app) {
  ensureStore(app)
  return loadPublicCatalog().map((row) => Object.assign({}, row, {
    reviewStatus: applyReview(app, row)
  }))
}

function parsePage(query) {
  const page = Math.max(1, parseInt((query && (query.page || query.page_no)) || '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt((query && (query.limit || query.page_size)) || '30', 10) || 30))
  return { page, limit, offset: (page - 1) * limit }
}

function queryText(query) {
  return String((query && (query.q || query.search)) || '').trim().toLowerCase()
}

function approvedPublic(app) {
  return allExercises(app).filter((row) => {
    if (row.origin === 'custom' || row.visibility === 'custom') return false
    return row.reviewStatus === 'approved'
  })
}

function matches(row, query) {
  const muscle = (query && (query.muscleGroup || query.muscle_group)) || ''
  const bodyPart = (query && (query.body_part || query.bodyPart)) || ''
  const target = (query && query.target) || ''
  const equipment = (query && query.equipment) || ''
  const q = queryText(query)
  if (muscle && row.muscleGroup !== muscle) return false
  if (bodyPart && row.bodyPart !== bodyPart) return false
  if (target && row.target !== target) return false
  if (equipment && row.equipment !== equipment) return false
  if (!q) return true
  const zhName = row.origin === 'free-exercise-db' ? translateName(row.name) : row.name
  const blob = [row.name, zhName].concat(row.aliases || [], row.muscleGroup, row.bodyPart, row.target, row.equipment, row.sourceId || '').join(' ').toLowerCase()
  return blob.indexOf(q) !== -1
}

function presentListItem(row) {
  const imageUrl = exerciseImageUrl(row.mediaRef)
  const nameZh = row.origin === 'free-exercise-db' ? translateName(row.name) : row.name
  return {
    id: row.id,
    sourceId: row.sourceId,
    name: nameZh,
    nameEn: row.name,
    icon: row.icon || '🏋️',
    muscleGroup: row.muscleGroup,
    bodyPart: row.bodyPart,
    bodyPartLabel: BODY_PART_LABELS[row.bodyPart] || row.bodyPart,
    equipment: row.equipment,
    equipmentLabel: EQUIPMENT_LABELS[row.equipment] || row.equipment,
    target: row.target,
    targetLabel: targetLabel(row.target),
    difficulty: row.difficulty || '',
    metricType: row.metricType,
    mediaRef: row.mediaRef || '',
    imageUrl
  }
}

function instructionsFor(row) {
  if (row.origin !== 'free-exercise-db') return row.instructions || []
  const mapped = instructionsZh.items && instructionsZh.items[row.sourceId]
  if (Array.isArray(mapped) && mapped.length) return mapped
  return translateInstructions(row.instructions || [])
}

function presentDetail(row, favorited) {
  const presented = presentListItem(row)
  const instructions = instructionsFor(row)
  return Object.assign(presented, {
    aliases: (row.aliases || []).concat(row.name && row.name !== presented.name ? [row.name] : []),
    instructions,
    cues: row.cues || [],
    commonErrors: row.commonErrors || [],
    secondaryMuscles: row.secondaryMuscles || [],
    reviewStatus: row.reviewStatus,
    reviewer: row.reviewer || '',
    updatedAt: row.updatedAt || '',
    origin: row.origin,
    favorited: !!favorited,
    defaultSets: row.defaultSets,
    defaultReps: row.defaultReps,
    defaultWeight: row.defaultWeight
  })
}

function listExercises(app, query) {
  ensureStore(app)
  const { page, limit, offset } = parsePage(query)
  const matched = approvedPublic(app)
    .filter((row) => matches(row, query))
    .sort((a, b) => {
      if (a.origin === 'curated' && b.origin !== 'curated') return -1
      if (b.origin === 'curated' && a.origin !== 'curated') return 1
      return String(translateName(a.name)).localeCompare(String(translateName(b.name)), 'zh')
    })
  const slice = matched.slice(offset, offset + limit).map(presentListItem)
  return Promise.resolve({
    data: slice,
    total: matched.length,
    page,
    limit,
    request_id: 'ex_' + time.nowMs()
  })
}

function findExercise(app, id) {
  const key = decodeURIComponent(String(id || ''))
  return allExercises(app).find((row) => row.id === key || row.sourceId === key)
}

function getExercise(app, id) {
  ensureStore(app)
  const e = findExercise(app, id)
  if (!e || e.reviewStatus !== 'approved' || e.origin === 'custom') {
    return Promise.reject({ code: 'NOT_FOUND', message: '动作不存在或未审核' })
  }
  const meta = ensureStore(app)
  const userId = app.globalData.session && app.globalData.session.user
    ? app.globalData.session.user.userId
    : ''
  const favs = meta.favorites[userId] || []
  return Promise.resolve({
    data: presentDetail(e, favs.indexOf(e.id) !== -1),
    request_id: 'ex_' + time.nowMs()
  })
}

function toggleFavorite(app, exerciseId) {
  const meta = ensureStore(app)
  const userId = app.globalData.session.user.userId
  if (!meta.favorites[userId]) meta.favorites[userId] = []
  const arr = meta.favorites[userId]
  const i = arr.indexOf(exerciseId)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(exerciseId)
  app.persist()
  return Promise.resolve({ data: { favorited: i < 0 }, request_id: 'ex_' + time.nowMs() })
}

function uniqueSorted(values, labels) {
  return Array.from(new Set(values.filter(Boolean))).sort().map((value) => ({
    value,
    label: (labels && labels[value]) || value
  }))
}

function listFacets(app) {
  const rows = approvedPublic(app)
  return Promise.resolve({
    data: {
      muscleGroups: uniqueSorted(rows.map((row) => row.muscleGroup)),
      body_parts: uniqueSorted(rows.map((row) => row.bodyPart), BODY_PART_LABELS),
      targets: uniqueSorted(rows.map((row) => row.target), TARGET_LABELS),
      equipment: uniqueSorted(rows.map((row) => row.equipment), EQUIPMENT_LABELS)
    },
    request_id: 'ex_' + time.nowMs()
  })
}

function filters() {
  return {
    muscleGroups: ['下肢', '上肢', '核心'],
    equipments: ['杠铃', '自重', '其他'],
    difficulties: ['初级', '中级', '高级']
  }
}

module.exports = {
  CATALOG: CURATED,
  listExercises,
  getExercise,
  toggleFavorite,
  listFacets,
  seedExerciseCatalog,
  filters,
  BODY_PART_LABELS,
  EQUIPMENT_LABELS
}
