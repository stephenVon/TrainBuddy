/**
 * 成就定义与授予。负面成就不发积分，也不扣积分。
 */

const time = require('../lib/time')
const { AppError } = require('../lib/errors')

const SEED = [
  {
    key: 'first_plan_training',
    title: '首次完成计划训练',
    description: '第一次按已发布计划完成训练。',
    polarity: 'positive',
    trigger: 'training_completed',
    threshold: 1,
    period: 'lifetime',
    pointReward: 5,
    visibility: 'self',
    version: 1,
    enabled: true
  },
  {
    key: 'plan_training_10',
    title: '完成 10 次计划训练',
    description: '累计完成 10 次已发布计划训练。',
    polarity: 'positive',
    trigger: 'training_completed',
    threshold: 10,
    period: 'lifetime',
    pointReward: 20,
    visibility: 'self',
    version: 1,
    enabled: true
  },
  {
    key: 'plan_streak_3',
    title: '连续训练 3 天',
    description: '按上海业务日连续 3 天完成计划训练，同一天多次只算一天。',
    polarity: 'positive',
    trigger: 'training_streak',
    threshold: 3,
    period: 'lifetime',
    pointReward: 10,
    visibility: 'self',
    version: 1,
    enabled: true
  },
  {
    key: 'first_booking_completed',
    title: '首次完成课程',
    description: '教练第一次确认课程结束。',
    polarity: 'positive',
    trigger: 'booking_attended',
    threshold: 1,
    period: 'lifetime',
    pointReward: 10,
    visibility: 'self',
    version: 1,
    enabled: true
  },
  {
    key: 'booking_no_show_streak_2',
    title: '连续缺席提醒',
    description: '连续两次课程被记为缺席。只提醒你自己，不扣积分。',
    polarity: 'negative',
    trigger: 'booking_no_show',
    threshold: 2,
    period: 'lifetime',
    pointReward: 0,
    visibility: 'self',
    version: 1,
    enabled: true
  }
]

function ensure(state) {
  if (!state.achievements) state.achievements = { definitions: [], grants: [] }
  if (!state.achievements.definitions) state.achievements.definitions = []
  if (!state.achievements.grants) state.achievements.grants = []
  SEED.forEach((def) => {
    if (!state.achievements.definitions.some((item) => item.key === def.key)) {
      state.achievements.definitions.push(Object.assign({}, def))
    }
  })
  state.achievements.definitions.forEach((def) => {
    if (def.polarity === 'negative') def.pointReward = 0
  })
  return state.achievements
}

function periodKey(def) {
  return def.period || 'lifetime'
}

function grantId(userId, def) {
  return userId + ':' + def.key + ':' + periodKey(def)
}

function findGrant(state, userId, def) {
  const id = grantId(userId, def)
  return ensure(state).grants.find((item) => item.id === id) || null
}

function upsertGrant(state, userId, def) {
  const box = ensure(state)
  let row = findGrant(state, userId, def)
  if (row) return row
  row = {
    id: grantId(userId, def),
    userId,
    achievementKey: def.key,
    definitionVersion: def.version,
    progress: 0,
    target: def.threshold,
    earnedAt: null,
    sourceEventId: null,
    rewardLedgerId: null,
    sourceIds: [],
    dates: [],
    streak: 0
  }
  box.grants.push(row)
  return row
}

function streakEnding(dates, end) {
  const set = {}
  ;(dates || []).forEach((day) => {
    set[day] = true
  })
  let count = 0
  let cursor = end
  while (cursor && set[cursor]) {
    count += 1
    cursor = time.addDays(cursor, -1)
  }
  return count
}

function matches(def, event) {
  if (event.type === 'training_completed') {
    return def.trigger === 'training_completed' || def.trigger === 'training_streak'
  }
  if (event.type === 'booking_attended') return def.trigger === 'booking_attended'
  if (event.type === 'booking_no_show') return def.trigger === 'booking_no_show'
  return false
}

function applyProgress(row, def, event) {
  if (row.sourceIds.indexOf(event.sourceId) !== -1 && def.trigger !== 'training_streak') return
  if (def.trigger === 'training_streak') {
    if (row.dates.indexOf(event.businessDate) === -1) row.dates.push(event.businessDate)
    if (row.sourceIds.indexOf(event.sourceId) === -1) row.sourceIds.push(event.sourceId)
    row.progress = streakEnding(row.dates, event.businessDate)
    row.streak = row.progress
    return
  }
  if (def.trigger === 'booking_no_show') {
    row.sourceIds.push(event.sourceId)
    row.streak += 1
    row.progress = row.streak
    return
  }
  row.sourceIds.push(event.sourceId)
  row.progress = row.sourceIds.length
}

function resetOpenNoShow(state, userId) {
  const def = ensure(state).definitions.find((item) => item.key === 'booking_no_show_streak_2')
  if (!def) return
  const row = findGrant(state, userId, def)
  if (!row || row.earnedAt) return
  row.streak = 0
  row.progress = 0
}

function evaluate(state, event) {
  if (event.type === 'booking_attended') resetOpenNoShow(state, event.userId)
  const earned = []
  ensure(state)
    .definitions.filter((def) => def.enabled && matches(def, event))
    .forEach((def) => {
      if (def.polarity === 'negative') def.pointReward = 0
      const row = upsertGrant(state, event.userId, def)
      if (row.earnedAt) return
      applyProgress(row, def, event)
      if (row.progress < def.threshold) return
      row.earnedAt = time.nowMs()
      row.sourceEventId = event.sourceId
      const reward = def.polarity === 'negative' ? 0 : Number(def.pointReward) || 0
      if (reward > 0) {
        const posted = require('./pointsService').awardFixed(state, {
          userId: event.userId,
          points: reward,
          idempotencyKey: 'achievement:' + event.userId + ':' + def.key + ':' + periodKey(def),
          sourceType: 'achievement',
          sourceId: def.key,
          ruleKey: def.key,
          ruleVersion: def.version
        })
        row.rewardLedgerId = posted.ledger ? posted.ledger.ledger_id : null
      }
      earned.push({
        key: def.key,
        title: def.title,
        points: reward,
        polarity: def.polarity
      })
    })
  return earned
}

function presentDefinition(def, grant) {
  const reward = def.polarity === 'negative' ? 0 : Number(def.pointReward) || 0
  return {
    key: def.key,
    title: def.title,
    description: def.description,
    polarity: def.polarity,
    threshold: def.threshold,
    progress: grant ? grant.progress : 0,
    earned: !!(grant && grant.earnedAt),
    earned_at: grant ? grant.earnedAt : null,
    point_reward: reward,
    visibility: def.visibility || 'self'
  }
}

function listForUser(state, userId) {
  const box = ensure(state)
  return box.definitions.map((def) => presentDefinition(def, findGrant(state, userId, def)))
}

function listDefinitions(state) {
  return ensure(state).definitions.map((def) => ({
    key: def.key,
    title: def.title,
    description: def.description,
    polarity: def.polarity,
    trigger: def.trigger,
    threshold: def.threshold,
    period: def.period,
    point_reward: def.polarity === 'negative' ? 0 : def.pointReward,
    visibility: def.visibility,
    version: def.version,
    enabled: !!def.enabled
  }))
}

function patchDefinition(state, actor, key, body) {
  const def = ensure(state).definitions.find((item) => item.key === key)
  if (!def) throw new AppError('NOT_FOUND', '成就不存在')
  require('./opsService').audit(state, actor, {
    ticketId: body.ticket_id,
    action: 'achievement_patch',
    targetType: 'achievement',
    targetId: key,
    reason: body.reason,
    scope: body.patch || {}
  })
  const patch = body.patch || {}
  if (patch.title) def.title = String(patch.title).slice(0, 40)
  if (patch.description != null) def.description = String(patch.description).slice(0, 120)
  if (patch.enabled != null) def.enabled = !!patch.enabled
  if (patch.visibility) def.visibility = patch.visibility === 'self' ? 'self' : def.visibility
  if (def.polarity === 'negative') def.pointReward = 0
  else if (patch.point_reward != null) def.pointReward = Math.max(0, Number(patch.point_reward) || 0)
  return listDefinitions(state).find((item) => item.key === key)
}

module.exports = {
  ensure,
  evaluate,
  listForUser,
  listDefinitions,
  patchDefinition
}
