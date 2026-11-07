/**
 * 积分账本。余额只能通过流水变动，奖励必须带幂等键。
 * 与 entitlement 额度分开，不能混用。
 */

const time = require('../lib/time')
const { makeId } = require('../lib/ids')
const { AppError } = require('../lib/errors')

const EVENT_TYPES = ['training_completed', 'booking_attended']

function defaultRules() {
  return {
    training_completed: { points: 10, version: 1, enabled: true, dailyCap: null },
    booking_attended: { points: 20, version: 1, enabled: true, dailyCap: null }
  }
}

function ensure(state) {
  if (!state.points) {
    state.points = { accounts: [], ledger: [], rules: defaultRules() }
  }
  if (!state.points.accounts) state.points.accounts = []
  if (!state.points.ledger) state.points.ledger = []
  if (!state.points.rules) state.points.rules = defaultRules()
  EVENT_TYPES.forEach((key) => {
    if (!state.points.rules[key]) state.points.rules[key] = defaultRules()[key]
  })
  return state.points
}

function getAccount(state, userId) {
  const box = ensure(state)
  let row = box.accounts.find((item) => item.userId === userId)
  if (!row) {
    row = {
      userId,
      available: 0,
      reserved: 0,
      lifetimeEarned: 0,
      lifetimeSpent: 0,
      revision: 0,
      updatedAt: time.nowMs()
    }
    box.accounts.push(row)
  }
  return row
}

function findByKey(state, key) {
  if (!key) return null
  return ensure(state).ledger.find((item) => item.idempotencyKey === key) || null
}

function eventKey(eventType, sourceId, rule) {
  return 'points:' + eventType + ':' + sourceId + ':' + (rule ? rule.version : 1)
}

function presentLedger(row) {
  if (!row) return null
  return {
    ledger_id: row.id,
    user_id: row.userId,
    delta: row.delta,
    type: row.type,
    status: row.status,
    source_type: row.sourceType,
    source_id: row.sourceId,
    rule_key: row.ruleKey,
    rule_version: row.ruleVersion,
    related_order_id: row.relatedOrderId || null,
    idempotency_key: row.idempotencyKey,
    metadata: row.metadata || null,
    created_at: row.createdAt
  }
}

function presentAccount(row) {
  return {
    available: row.available,
    reserved: row.reserved,
    lifetime_earned: row.lifetimeEarned,
    lifetime_spent: row.lifetimeSpent
  }
}

function presentRules(rules) {
  const out = {}
  EVENT_TYPES.forEach((key) => {
    const rule = rules[key]
    out[key] = {
      points: rule.points,
      version: rule.version,
      enabled: !!rule.enabled,
      daily_cap: rule.dailyCap == null ? null : rule.dailyCap
    }
  })
  return out
}

function emptyReward(extra) {
  return Object.assign(
    { awarded: false, already: false, points: 0, ledger_id: null, achievements: [], reason: null },
    extra || {}
  )
}

function earnedToday(state, userId, sourceType) {
  const day = time.todayKey()
  return ensure(state).ledger.filter((row) => {
    return (
      row.userId === userId &&
      row.type === 'earn' &&
      row.sourceType === sourceType &&
      time.shanghaiDateKey(row.createdAt) === day
    )
  }).length
}

function credit(state, { userId, points, idempotencyKey, sourceType, sourceId, ruleKey, ruleVersion, metadata, relatedOrderId }) {
  const existing = findByKey(state, idempotencyKey)
  if (existing) return { ledger: presentLedger(existing), already: true }
  const account = getAccount(state, userId)
  account.available += points
  account.lifetimeEarned += points
  account.revision += 1
  account.updatedAt = time.nowMs()
  const row = {
    id: makeId('pts'),
    userId,
    delta: points,
    type: 'earn',
    status: 'posted',
    sourceType: sourceType || null,
    sourceId: sourceId || null,
    idempotencyKey,
    ruleKey: ruleKey || null,
    ruleVersion: ruleVersion == null ? null : ruleVersion,
    relatedOrderId: relatedOrderId || null,
    metadata: metadata || null,
    createdAt: time.nowMs()
  }
  ensure(state).ledger.push(row)
  return { ledger: presentLedger(row), already: false }
}

function awardFixed(state, spec) {
  if (!spec.points || spec.points <= 0) return { ledger: null, already: false }
  return credit(state, spec)
}

function publishedPlanSession(training, session) {
  if (!session || session.sourceType !== 'from_plan' || !session.planId) return false
  const plan = (training.plans || []).find((item) => item.id === session.planId)
  if (!plan) return false
  const rev = (training.planRevisions || []).find(
    (item) => item.planId === plan.id && item.version === session.planRevision
  )
  return !!(rev && rev.status === 'published')
}

function rewardFromRule(state, { userId, eventType, sourceId, businessDate, metadata }) {
  const rule = ensure(state).rules[eventType]
  if (!rule || !rule.enabled) return emptyReward({ reason: 'disabled' })
  const key = eventKey(eventType, sourceId, rule)
  const existing = findByKey(state, key)
  if (existing) {
    return {
      awarded: false,
      already: true,
      points: existing.delta,
      ledger_id: existing.id,
      achievements: [],
      reason: null
    }
  }
  if (rule.dailyCap != null && earnedToday(state, userId, eventType) >= rule.dailyCap) {
    return emptyReward({ reason: 'daily_cap' })
  }
  const posted = credit(state, {
    userId,
    points: rule.points,
    idempotencyKey: key,
    sourceType: eventType,
    sourceId,
    ruleKey: eventType,
    ruleVersion: rule.version,
    metadata: Object.assign({ business_date: businessDate || null }, metadata || {})
  })
  const achievements = require('./achievementService').evaluate(state, {
    type: eventType,
    userId,
    sourceId,
    businessDate: businessDate || time.todayKey()
  })
  return {
    awarded: !posted.already,
    already: posted.already,
    points: rule.points,
    ledger_id: posted.ledger.ledger_id,
    achievements,
    reason: null
  }
}

function rewardTraining(state, training, session, doneCount) {
  if (!publishedPlanSession(training, session) || !doneCount) {
    return emptyReward({ reason: 'ineligible' })
  }
  return rewardFromRule(state, {
    userId: session.studentId,
    eventType: 'training_completed',
    sourceId: session.id,
    businessDate: session.businessDate || time.todayKey()
  })
}

function lookupTraining(state, sessionId) {
  const rule = ensure(state).rules.training_completed
  const existing = findByKey(state, eventKey('training_completed', sessionId, rule))
  if (!existing) return emptyReward()
  return {
    awarded: false,
    already: true,
    points: existing.delta,
    ledger_id: existing.id,
    achievements: [],
    reason: null
  }
}

function rewardBooking(state, booking, status) {
  const businessDate = time.shanghaiDateKey(booking.startAt || time.nowMs())
  if (status === 'no_show') {
    const achievements = require('./achievementService').evaluate(state, {
      type: 'booking_no_show',
      userId: booking.studentId,
      sourceId: booking.id,
      businessDate
    })
    return emptyReward({ achievements })
  }
  if (status !== 'completed') return emptyReward()
  return rewardFromRule(state, {
    userId: booking.studentId,
    eventType: 'booking_attended',
    sourceId: booking.id,
    businessDate
  })
}

function reserve(state, userId, amount, orderId) {
  const qty = Number(amount || 0)
  if (qty <= 0) throw new AppError('VALIDATION', '兑换价格无效')
  const key = 'points:reserve:' + orderId
  const existing = findByKey(state, key)
  if (existing) return presentLedger(existing)
  const account = getAccount(state, userId)
  if (account.available < qty) throw new AppError('VALIDATION', '积分不足')
  account.available -= qty
  account.reserved += qty
  account.revision += 1
  account.updatedAt = time.nowMs()
  const row = {
    id: makeId('pts'),
    userId,
    delta: -qty,
    type: 'reserve',
    status: 'reserved',
    sourceType: 'redemption',
    sourceId: orderId,
    idempotencyKey: key,
    ruleKey: null,
    ruleVersion: null,
    relatedOrderId: orderId,
    metadata: { amount: qty },
    createdAt: time.nowMs()
  }
  ensure(state).ledger.push(row)
  return presentLedger(row)
}

function capture(state, userId, amount, orderId) {
  const key = 'points:spend:' + orderId
  const existing = findByKey(state, key)
  if (existing) return presentLedger(existing)
  const qty = Number(amount || 0)
  const account = getAccount(state, userId)
  account.reserved = Math.max(0, account.reserved - qty)
  account.lifetimeSpent += qty
  account.revision += 1
  account.updatedAt = time.nowMs()
  const row = {
    id: makeId('pts'),
    userId,
    delta: 0,
    type: 'spend',
    status: 'posted',
    sourceType: 'redemption',
    sourceId: orderId,
    idempotencyKey: key,
    ruleKey: null,
    ruleVersion: null,
    relatedOrderId: orderId,
    metadata: { amount: qty },
    createdAt: time.nowMs()
  }
  ensure(state).ledger.push(row)
  return presentLedger(row)
}

function release(state, userId, amount, orderId) {
  const key = 'points:release:' + orderId
  const existing = findByKey(state, key)
  if (existing) return presentLedger(existing)
  const qty = Number(amount || 0)
  const account = getAccount(state, userId)
  account.reserved = Math.max(0, account.reserved - qty)
  account.available += qty
  account.revision += 1
  account.updatedAt = time.nowMs()
  const row = {
    id: makeId('pts'),
    userId,
    delta: qty,
    type: 'release',
    status: 'posted',
    sourceType: 'redemption',
    sourceId: orderId,
    idempotencyKey: key,
    ruleKey: null,
    ruleVersion: null,
    relatedOrderId: orderId,
    metadata: { amount: qty },
    createdAt: time.nowMs()
  }
  ensure(state).ledger.push(row)
  return presentLedger(row)
}

function listLedger(state, userId, filter) {
  const type = filter && filter.type
  const map = { earn: ['earn'], redeem: ['spend'], refund: ['release', 'refund'], adjust: ['adjust'] }
  const allowed = type && map[type] ? map[type] : null
  return ensure(state)
    .ledger.filter((row) => row.userId === userId)
    .filter((row) => (allowed ? allowed.indexOf(row.type) !== -1 : true))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(presentLedger)
}

function summary(state, userId) {
  return presentAccount(getAccount(state, userId))
}

function getRules(state) {
  return presentRules(ensure(state).rules)
}

function patchRules(state, actor, body) {
  require('./opsService').audit(state, actor, {
    ticketId: body.ticket_id,
    action: 'points_rules_patch',
    targetType: 'points_rules',
    targetId: 'rules',
    reason: body.reason,
    scope: body.rules || {}
  })
  const rules = ensure(state).rules
  const patch = body.rules || {}
  EVENT_TYPES.forEach((key) => {
    const next = patch[key]
    if (!next) return
    if (next.points != null) rules[key].points = Number(next.points)
    if (next.enabled != null) rules[key].enabled = !!next.enabled
    if (next.daily_cap !== undefined) rules[key].dailyCap = next.daily_cap == null ? null : Number(next.daily_cap)
    if (next.version != null) rules[key].version = Number(next.version)
  })
  return presentRules(rules)
}

function adjust(state, actor, body) {
  const delta = Number(body.delta)
  if (!body.user_id || !delta) throw new AppError('VALIDATION', '需要 user_id 和非零 delta')
  const user = (state.users || []).find((item) => item.userId === body.user_id)
  if (!user) throw new AppError('NOT_FOUND', '用户不存在')
  require('./opsService').audit(state, actor, {
    ticketId: body.ticket_id,
    action: 'points_adjust',
    targetType: 'user',
    targetId: body.user_id,
    reason: body.reason,
    scope: { delta }
  })
  const account = getAccount(state, body.user_id)
  if (account.available + delta < 0) throw new AppError('VALIDATION', '调整后积分不能为负')
  const key = 'points:adjust:' + body.ticket_id + ':' + body.user_id
  const existing = findByKey(state, key)
  if (existing) return { ledger: presentLedger(existing), account: presentAccount(account), already: true }
  account.available += delta
  if (delta > 0) account.lifetimeEarned += delta
  account.revision += 1
  account.updatedAt = time.nowMs()
  const row = {
    id: makeId('pts'),
    userId: body.user_id,
    delta,
    type: 'adjust',
    status: 'posted',
    sourceType: 'ops_adjust',
    sourceId: body.ticket_id,
    idempotencyKey: key,
    ruleKey: null,
    ruleVersion: null,
    relatedOrderId: null,
    metadata: { operator_id: actor.userId, reason: body.reason || '' },
    createdAt: time.nowMs()
  }
  ensure(state).ledger.push(row)
  return { ledger: presentLedger(row), account: presentAccount(account), already: false }
}

module.exports = {
  ensure,
  summary,
  listLedger,
  rewardTraining,
  lookupTraining,
  rewardBooking,
  awardFixed,
  reserve,
  capture,
  release,
  getRules,
  patchRules,
  adjust,
  presentAccount,
  getAccount
}
