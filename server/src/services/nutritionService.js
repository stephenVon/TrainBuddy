/**
 * 营养识别确认入库 + 自动同步偏好（逐条共享，不静默整天共享）
 */

const time = require('../lib/time')
const { makeId } = require('../lib/ids')
const { AppError } = require('../lib/errors')
const bindingApi = require('./bindingAdapter')
const diaryService = require('./diaryService')
const aiTaskService = require('./ai/aiTaskService')

function ensurePrefs(state) {
  if (!state.nutritionPrefs) state.nutritionPrefs = {}
  return state.nutritionPrefs
}

function getPrefs(state, userId) {
  const prefs = ensurePrefs(state)
  const row = prefs[userId] || {
    autoSync: false,
    coachUserId: null,
    updatedAt: null
  }
  return presentPrefs(row, state, userId)
}

function presentPrefs(row, state, userId) {
  const binding = bindingApi.getActivePrimaryCoach({ globalData: state }, userId)
  const mealScope =
    binding && binding.scopes ? binding.scopes.meal !== false : false
  const coachMatch =
    !!(binding && row.coachUserId && binding.coachUserId === row.coachUserId)
  const canAutoSync = !!(binding && mealScope && coachMatch && row.autoSync)
  return {
    auto_sync: !!row.autoSync,
    coach_user_id: row.coachUserId || null,
    updated_at: row.updatedAt,
    binding_active: !!binding,
    meal_scope_on: !!mealScope,
    coach_match: !row.coachUserId || coachMatch,
    effective_auto_sync: canAutoSync,
    hint: !binding
      ? '尚未绑定教练，无法开启自动同步'
      : !mealScope
        ? '请先在隐私设置中开启饮食授权'
        : row.autoSync && !coachMatch
          ? '教练关系已变更，请重新开启自动同步'
          : null
  }
}

/**
 * 开启时锁定当前主教练；关闭只影响后续，不撤回已共享条目
 */
function setPrefs(state, actor, body) {
  const prefs = ensurePrefs(state)
  const autoSync = !!body.auto_sync
  const prev = prefs[actor.userId] || {
    autoSync: false,
    coachUserId: null,
    updatedAt: null
  }

  if (!autoSync) {
    prefs[actor.userId] = {
      autoSync: false,
      coachUserId: prev.coachUserId,
      updatedAt: time.nowMs()
    }
    return presentPrefs(prefs[actor.userId], state, actor.userId)
  }

  const binding = bindingApi.getActivePrimaryCoach({ globalData: state }, actor.userId)
  if (!binding) {
    throw new AppError('BINDING_INACTIVE', '尚未绑定教练，无法开启自动同步')
  }
  if (binding.scopes && binding.scopes.meal === false) {
    throw new AppError('FORBIDDEN', '饮食授权未开启，无法自动同步')
  }

  prefs[actor.userId] = {
    autoSync: true,
    coachUserId: binding.coachUserId,
    updatedAt: time.nowMs()
  }
  return presentPrefs(prefs[actor.userId], state, actor.userId)
}

function nullishMacro(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (Number.isNaN(n)) return null
  return n
}

function normalizeMacros(m) {
  const src = m || {}
  return {
    carbs: nullishMacro(src.carbs),
    protein: nullishMacro(src.protein),
    fat: nullishMacro(src.fat)
  }
}

function formatFoodText(items) {
  if (!items || !items.length) return ''
  return items
    .map((it) => {
      const name = (it.food_name || it.foodName || '').trim() || '未命名食物'
      const p = it.portion || {}
      const amt = p.amount != null ? p.amount : ''
      const unit = p.unit || 'g'
      return amt !== '' ? name + ' ' + amt + unit : name
    })
    .join('；')
}

function formatPortionText(items, total) {
  const macros = normalizeMacros(total)
  const parts = []
  if (macros.carbs != null) parts.push('碳' + macros.carbs + 'g')
  if (macros.protein != null) parts.push('蛋白' + macros.protein + 'g')
  if (macros.fat != null) parts.push('脂' + macros.fat + 'g')
  return parts.join(' / ') || (items && items.length ? '待确认份量' : '')
}

/**
 * 确认营养任务并写入本人饮食；可选逐条自动同步
 */
async function confirmTask(state, actor, taskId, body) {
  const task = aiTaskService.findTask(state, taskId)
  if (!task) throw new AppError('NOT_FOUND', '任务不存在')
  if (task.ownerId !== actor.userId) throw new AppError('FORBIDDEN', '无权确认该任务')
  if (task.type !== 'nutrition_scan') {
    throw new AppError('VALIDATION', '非营养识别任务')
  }

  // 幂等：已确认过则返回原 meal
  if (task.confirmedMealId) {
    const store = diaryService.ensureStore({ globalData: state, persist() {} })
    const meal = store.meals.find((m) => m.id === task.confirmedMealId)
    if (meal) {
      return {
        meal: presentMeal(meal),
        task: aiTaskService.presentTask(task, state),
        sync: {
          attempted: false,
          status: meal.syncStatus || 'none',
          message: '已确认过，未重复保存'
        },
        duplicated: true
      }
    }
  }

  if (task.status !== 'needs_confirmation') {
    throw new AppError('INVALID_STATE', '当前状态不可确认，请先完成识别')
  }

  const localDate = body.local_date || body.localDate || time.todayKey()
  const mealType = body.meal_type || body.mealType || 'snack'
  const result =
    (task.resultRef && task.resultRef.kind === 'nutrition_result' && task.resultRef.data) ||
    {}
  const items = Array.isArray(body.items) ? body.items : result.items || []
  const totalMacros = normalizeMacros(
    body.total_macros_g || body.totalMacrosG || result.total_macros_g
  )
  const foodText =
    body.food_text != null || body.foodText != null
      ? body.food_text || body.foodText
      : formatFoodText(items)
  const portionText =
    body.portion_text != null || body.portionText != null
      ? body.portion_text || body.portionText
      : formatPortionText(items, totalMacros)

  const app = {
    globalData: state,
    persist() {},
    toast() {}
  }

  const out = await diaryService.addMeal(app, {
    studentId: actor.userId,
    localDate,
    mealType,
    foodText,
    portionText,
    macrosG: totalMacros,
    isEstimate: body.is_estimate != null ? !!body.is_estimate : result.is_estimate !== false,
    sourceTaskId: task.id,
    mediaId: task.input && (task.input.media_id || task.input.mediaId),
    items: items.map((it) => ({
      food_name: it.food_name || it.foodName || '',
      portion: it.portion || null,
      macros_g: normalizeMacros(it.macros_g || it.macrosG),
      basis: it.basis || null,
      uncertainties: it.uncertainties || []
    }))
  })

  const meal = out.data
  task.confirmedMealId = meal.id
  task.status = 'confirmed'
  task.publishedAt = task.publishedAt || time.nowMs()
  task.revision += 1
  task.updatedAt = time.nowMs()

  const sync = await tryAutoSyncMeal(state, actor.userId, meal)

  return {
    meal: presentMeal(meal),
    task: aiTaskService.presentTask(task, state),
    sync,
    duplicated: false
  }
}

async function tryAutoSyncMeal(state, userId, meal) {
  const prefs = ensurePrefs(state)[userId]
  if (!prefs || !prefs.autoSync) {
    meal.syncStatus = 'none'
    return { attempted: false, status: 'none', message: '未开启自动同步' }
  }

  const binding = bindingApi.getActivePrimaryCoach({ globalData: state }, userId)
  if (!binding) {
    meal.syncStatus = 'sync_failed'
    meal.syncError = 'BINDING_INACTIVE'
    return {
      attempted: true,
      status: 'sync_failed',
      message: '已记录，尚未同步：教练绑定已失效'
    }
  }
  if (prefs.coachUserId && prefs.coachUserId !== binding.coachUserId) {
    meal.syncStatus = 'sync_failed'
    meal.syncError = 'COACH_CHANGED'
    return {
      attempted: true,
      status: 'sync_failed',
      message: '已记录，尚未同步：教练已变更，请重新开启自动同步'
    }
  }
  if (binding.scopes && binding.scopes.meal === false) {
    meal.syncStatus = 'sync_failed'
    meal.syncError = 'MEAL_SCOPE_OFF'
    return {
      attempted: true,
      status: 'sync_failed',
      message: '已记录，尚未同步：饮食授权未开启'
    }
  }

  shareMealItem(state, userId, meal.id, binding.coachUserId)
  return {
    attempted: true,
    status: 'synced',
    message: '已同步给当前教练（不含原图）'
  }
}

/**
 * 逐条共享饮食给指定教练（不写 dayShares，不连带当天其他记录）
 */
function shareMealItem(state, studentId, mealId, coachUserId) {
  const store = diaryService.ensureStore({ globalData: state, persist() {} })
  const meal = store.meals.find((m) => m.id === mealId && m.studentId === studentId)
  if (!meal || meal.deletedAt) throw new AppError('NOT_FOUND', '饮食记录不存在')

  const binding = bindingApi.getActivePrimaryCoach({ globalData: state }, studentId)
  if (!binding || binding.coachUserId !== coachUserId) {
    throw new AppError('BINDING_INACTIVE', '教练绑定无效')
  }
  if (binding.scopes && binding.scopes.meal === false) {
    throw new AppError('FORBIDDEN', '饮食授权未开启')
  }

  meal.sharedToCoachUserId = coachUserId
  meal.sharedAt = time.nowMs()
  meal.syncStatus = 'synced'
  meal.syncError = null
  meal.mediaShared = false
  meal.updatedAt = time.nowMs()
  return presentMeal(meal)
}

function unshareMealItem(state, studentId, mealId) {
  const store = diaryService.ensureStore({ globalData: state, persist() {} })
  const meal = store.meals.find((m) => m.id === mealId && m.studentId === studentId)
  if (!meal || meal.deletedAt) throw new AppError('NOT_FOUND', '饮食记录不存在')
  meal.sharedToCoachUserId = null
  meal.sharedAt = null
  meal.syncStatus = 'none'
  meal.syncError = null
  meal.updatedAt = time.nowMs()
  return presentMeal(meal)
}

function presentMeal(meal) {
  return {
    id: meal.id,
    student_id: meal.studentId,
    local_date: meal.localDate,
    meal_type: meal.mealType,
    food_text: meal.foodText,
    portion_text: meal.portionText,
    macros_g: meal.macrosG || { carbs: null, protein: null, fat: null },
    is_estimate: !!meal.isEstimate,
    source_task_id: meal.sourceTaskId || null,
    media_id: meal.mediaId || null,
    media_shared: !!meal.mediaShared,
    items: meal.items || [],
    shared_to_coach_user_id: meal.sharedToCoachUserId || null,
    shared_at: meal.sharedAt || null,
    sync_status: meal.syncStatus || 'none',
    sync_error: meal.syncError || null,
    created_at: meal.createdAt,
    updated_at: meal.updatedAt
  }
}

module.exports = {
  getPrefs,
  setPrefs,
  confirmTask,
  shareMealItem,
  unshareMealItem,
  tryAutoSyncMeal,
  presentMeal,
  makeId
}
