/**
 * 将 MemoryStore.state 适配成原 mock 服务期望的 app 形态
 */
function asApp(store) {
  const state = store.state
  // 确保子树存在
  if (!state.schedule) state.schedule = { rulesByCoach: {}, exceptions: [], bookings: [], changes: [], idempotency: {} }
  if (!state.training) state.training = { plans: [], planRevisions: [], sessions: [], finalizeKeys: {} }
  if (!state.diary) {
    state.diary = {
      dailyLogs: [],
      meals: [],
      waters: [],
      bodyStates: [],
      feedbacks: [],
      dayShares: {}
    }
  }
  if (!state.bindings) state.bindings = []
  if (!state.exerciseMeta) state.exerciseMeta = { favorites: {}, reviews: {} }
  if (!state.customExercises) state.customExercises = []

  return {
    globalData: state,
    persist() {
      store.persist()
    },
    toast() {}
  }
}

/** 将 Promise reject 的 {code,message} 转为可抛出错误 */
async function unwrap(promise) {
  try {
    return await promise
  } catch (err) {
    if (err && err.code) {
      const { AppError } = require('./errors')
      throw new AppError(err.code, err.message, {
        retryable: err.retryable,
        extra: err.latest_revision != null ? { latest_revision: err.latest_revision } : null
      })
    }
    throw err
  }
}

module.exports = { asApp, unwrap }
