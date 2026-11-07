const { AppError } = require('./errors')
const { makeId } = require('./ids')

function invalid(message) { throw new AppError('VALIDATION', message) }
function number(value, name, min, max, integer, required) {
  if (value === null || value === undefined || value === '') {
    if (required) invalid('请填写' + name)
    return null
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) invalid(name + '超出范围或格式不正确')
  return value
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid('计划日期格式应为 YYYY-MM-DD')
  const d = new Date(value + 'T12:00:00Z')
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) invalid('计划日期不存在')
  return value
}
function uniqueInts(value, min, max) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const result = []
  value.forEach((item) => {
    const n = Number(item)
    if (!Number.isInteger(n) || n < min || n > max || seen.has(n)) return
    seen.add(n)
    result.push(n)
  })
  return result.sort((a, b) => a - b)
}
function schedule(input, publishing) {
  const type = (input && input.scheduleType) || 'once'
  if (!['once', 'permanent', 'range', 'weekly', 'monthly'].includes(type)) invalid('请选择训练日期类型')
  if (input && input.plannedDate) date(input.plannedDate)
  if (input && input.scheduleEnd) date(input.scheduleEnd)
  const result = { scheduleType: type, plannedDate: null, scheduleEnd: null, weekdays: [], monthDays: [] }
  if (type === 'permanent') return result
  if (type === 'once') {
    result.plannedDate = date(input.plannedDate)
    return result
  }
  if (type === 'range') {
    result.plannedDate = date(input.plannedDate)
    result.scheduleEnd = date(input.scheduleEnd)
    if (result.scheduleEnd < result.plannedDate) invalid('结束日期不能早于开始日期')
    return result
  }
  if (type === 'weekly') {
    result.weekdays = uniqueInts(input.weekdays, 1, 7)
    if (publishing && !result.weekdays.length) invalid('请选择每周训练日')
    return result
  }
  result.monthDays = uniqueInts(input.monthDays, 1, 31)
  if (publishing && !result.monthDays.length) invalid('请选择每月训练日')
  return result
}
function exercises(value, publishing) {
  if (!Array.isArray(value) || value.length > 50 || (publishing && !value.length)) invalid('计划需包含 1–50 个动作，空草稿可暂存')
  const ids = new Set()
  const identify = (id, prefix) => {
    if (id != null && (typeof id !== 'string' || !id || id.length > 100)) invalid('动作或组 ID 不合法')
    const result = id || makeId(prefix)
    if (ids.has(result)) invalid('动作或组 ID 重复')
    ids.add(result); return result
  }
  return value.map((ex, i) => {
    if (!ex || typeof ex !== 'object' || typeof ex.name !== 'string' || !ex.name.trim() || ex.name.trim().length > 60) invalid('请填写不超过 60 字的动作名称')
    if (!['total', 'per_side', 'bodyweight', 'unknown'].includes(ex.loadBasis)) invalid('请选择重量口径')
    if (!Array.isArray(ex.sets) || !ex.sets.length || ex.sets.length > 30) invalid('每个动作需包含 1–30 组')
    const result = { id: identify(ex.id, 'pex'), exerciseId: typeof ex.exerciseId === 'string' ? ex.exerciseId : null, name: ex.name.trim(), icon: typeof ex.icon === 'string' ? ex.icon : '🏋️', order: i + 1, loadBasis: ex.loadBasis }
    result.sets = ex.sets.map((set, n) => {
      if (!set || typeof set !== 'object') invalid('训练组格式不正确')
      return {
        id: identify(set.id, 'pset'), setNo: n + 1,
        targetWeight: number(set.targetWeight, '重量（0–500 kg）', 0, 500, false, publishing && ex.loadBasis !== 'bodyweight'),
        targetReps: number(set.targetReps, '次数（1–200）', 1, 200, true, publishing),
        required: set.required !== false
      }
    })
    if (publishing && result.loadBasis === 'unknown') invalid(ex.name + '的重量口径尚未确认')
    return result
  })
}
module.exports = { exercises, date, schedule, invalid }
