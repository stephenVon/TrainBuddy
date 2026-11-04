/**
 * 权益账本：预占 / 核销 / 释放（API30）
 * - 同一幂等键只预占一次
 * - 同一 chargeKey 最多核销一次（AC31）
 * - 订阅到期：历史可读，新付费操作拒绝（AC34）
 */

const time = require('../lib/time')
const { makeId } = require('../lib/ids')
const { AppError } = require('../lib/errors')
const config = require('../config')

const FEATURES = [
  'posture_scan',
  'goal_image',
  'voice_structure',
  'coach_student_slots',
  'nutrition_scan'
]

function ensure(state) {
  if (!state.entitlements) {
    state.entitlements = { balances: [], ledger: [], subscriptions: [] }
  }
  if (!state.entitlements.balances) state.entitlements.balances = []
  if (!state.entitlements.ledger) state.entitlements.ledger = []
  if (!state.entitlements.subscriptions) state.entitlements.subscriptions = []
  return state.entitlements
}

function getBalance(state, userId, feature) {
  const e = ensure(state)
  let row = e.balances.find((b) => b.userId === userId && b.feature === feature)
  if (!row) {
    row = {
      userId,
      feature,
      balance: 0,
      reserved: 0,
      periodStart: null,
      periodEnd: null,
      source: 'none',
      updatedAt: time.nowMs()
    }
    e.balances.push(row)
  }
  return row
}

function getSubscription(state, userId) {
  const e = ensure(state)
  return e.subscriptions
    .filter((s) => s.userId === userId)
    .sort((a, b) => (b.expiresAt || 0) - (a.expiresAt || 0))[0] || null
}

/**
 * AC34：到期不挡历史读；仅挡新付费写
 */
function assertPaidOpAllowed(state, userId, feature) {
  const sub = getSubscription(state, userId)
  if (sub && sub.status === 'expired') {
    throw new AppError('SUBSCRIPTION_EXPIRED', '订阅已到期，历史仍可查看与导出；新付费操作暂不可用', {
      status: 402,
      extra: { feature, expires_at: sub.expiresAt }
    })
  }
  if (sub && sub.expiresAt && sub.expiresAt < time.nowMs()) {
    sub.status = 'expired'
    throw new AppError('SUBSCRIPTION_EXPIRED', '订阅已到期，历史仍可查看与导出；新付费操作暂不可用', {
      status: 402,
      extra: { feature, expires_at: sub.expiresAt }
    })
  }
}

function available(row) {
  return Math.max(0, (row.balance || 0) - (row.reserved || 0))
}

/**
 * 预占：同一 idempotencyKey 只预占一次
 */
function reserve(state, { userId, feature, amount, taskId, idempotencyKey, skipSubscriptionCheck }) {
  if (!feature || FEATURES.indexOf(feature) < 0) {
    throw new AppError('VALIDATION', '未知权益功能')
  }
  const qty = Number(amount || 1)
  if (qty <= 0) throw new AppError('VALIDATION', '预占数量无效')

  if (!skipSubscriptionCheck) assertPaidOpAllowed(state, userId, feature)

  const e = ensure(state)
  if (idempotencyKey) {
    const existing = e.ledger.find(
      (l) =>
        l.userId === userId &&
        l.action === 'reserve' &&
        l.idempotencyKey === idempotencyKey
    )
    if (existing) {
      return { entry: presentEntry(existing), balance: presentBalance(getBalance(state, userId, feature)), reused: true }
    }
  }

  const row = getBalance(state, userId, feature)
  if (available(row) < qty) {
    throw new AppError('ENTITLEMENT_EXHAUSTED', '额度不足，请联系运营发放试用或待支付能力开放后购买', {
      status: 402,
      extra: {
        feature,
        available: available(row),
        requested: qty,
        payment_enabled: !!config.features.paymentEnabled
      }
    })
  }

  row.reserved += qty
  row.updatedAt = time.nowMs()

  const entry = {
    id: makeId('led'),
    userId,
    feature,
    action: 'reserve',
    amount: qty,
    taskId: taskId || null,
    idempotencyKey: idempotencyKey || null,
    chargeKey: null,
    status: 'reserved',
    relatedEntryId: null,
    meta: {},
    createdAt: time.nowMs()
  }
  e.ledger.push(entry)
  return { entry: presentEntry(entry), balance: presentBalance(row), reused: false }
}

/**
 * 核销：同一 chargeKey 最多一次（AC31）
 */
function charge(state, { userId, feature, amount, taskId, chargeKey, reserveEntryId }) {
  const e = ensure(state)
  const qty = Number(amount || 1)

  if (chargeKey) {
    const dup = e.ledger.find(
      (l) => l.action === 'charge' && l.chargeKey === chargeKey && l.status === 'charged'
    )
    if (dup) {
      return { entry: presentEntry(dup), duplicated: true, balance: presentBalance(getBalance(state, userId, feature)) }
    }
  }

  const row = getBalance(state, userId, feature)
  let reserveEntry = null
  if (reserveEntryId) {
    reserveEntry = e.ledger.find((l) => l.id === reserveEntryId)
  } else if (taskId) {
    reserveEntry = e.ledger
      .filter(
        (l) =>
          l.taskId === taskId &&
          l.action === 'reserve' &&
          (l.status === 'reserved' || l.status === 'partial_charged')
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0]
  }

  if (
    reserveEntry &&
    (reserveEntry.status === 'reserved' || reserveEntry.status === 'partial_charged')
  ) {
    const already = reserveEntry.chargedAmount || 0
    const remain = Math.max(0, reserveEntry.amount - already)
    const use = Math.min(qty, remain)
    if (use <= 0) {
      // 预占已核销完；同 chargeKey 已在上方拦截，此处视为无剩余可扣
      return {
        entry: presentEntry(reserveEntry),
        duplicated: true,
        balance: presentBalance(row)
      }
    }
    row.reserved = Math.max(0, row.reserved - use)
    row.balance = Math.max(0, row.balance - use)
    reserveEntry.chargedAmount = already + use
    reserveEntry.status =
      reserveEntry.chargedAmount >= reserveEntry.amount ? 'charged' : 'partial_charged'
  } else {
    // 无预占时直接扣余额（补偿场景）
    if (row.balance < qty) {
      throw new AppError('ENTITLEMENT_EXHAUSTED', '额度不足，无法核销')
    }
    row.balance -= qty
  }
  row.updatedAt = time.nowMs()

  const entry = {
    id: makeId('led'),
    userId,
    feature,
    action: 'charge',
    amount: qty,
    taskId: taskId || null,
    idempotencyKey: null,
    chargeKey: chargeKey || null,
    status: 'charged',
    relatedEntryId: reserveEntry ? reserveEntry.id : null,
    meta: {},
    createdAt: time.nowMs()
  }
  e.ledger.push(entry)
  return { entry: presentEntry(entry), duplicated: false, balance: presentBalance(row) }
}

/**
 * 释放未交付的预占
 */
function release(state, { userId, feature, amount, taskId, reserveEntryId, reason }) {
  const e = ensure(state)
  const row = getBalance(state, userId, feature)
  let reserveEntry = null
  if (reserveEntryId) {
    reserveEntry = e.ledger.find((l) => l.id === reserveEntryId)
  } else if (taskId) {
    reserveEntry = e.ledger.find(
      (l) =>
        l.taskId === taskId &&
        l.action === 'reserve' &&
        (l.status === 'reserved' || l.status === 'partial_charged')
    )
  }
  if (
    !reserveEntry ||
    (reserveEntry.status !== 'reserved' && reserveEntry.status !== 'partial_charged')
  ) {
    return { released: false, balance: presentBalance(row) }
  }

  const alreadyCharged = reserveEntry.chargedAmount || 0
  const remain = reserveEntry.amount - alreadyCharged
  const qty = amount != null ? Math.min(Number(amount), remain) : remain
  if (qty <= 0) return { released: false, balance: presentBalance(row) }

  row.reserved = Math.max(0, row.reserved - qty)
  row.updatedAt = time.nowMs()
  reserveEntry.releasedAmount = (reserveEntry.releasedAmount || 0) + qty
  if (alreadyCharged > 0 && remain - qty <= 0) {
    reserveEntry.status = 'charged'
  } else if (alreadyCharged > 0) {
    reserveEntry.status = 'partial_charged'
  } else {
    reserveEntry.status = 'released'
  }
  reserveEntry.releaseReason = reason || 'released'

  const entry = {
    id: makeId('led'),
    userId,
    feature,
    action: 'release',
    amount: qty,
    taskId: taskId || null,
    idempotencyKey: null,
    chargeKey: null,
    status: 'released',
    relatedEntryId: reserveEntry.id,
    meta: { reason: reason || null },
    createdAt: time.nowMs()
  }
  e.ledger.push(entry)
  return { released: true, entry: presentEntry(entry), balance: presentBalance(row) }
}

/**
 * 后台发放／补偿（试用，非付款成功）
 */
function grant(state, { userId, feature, amount, source, ticketId, operatorId, note, periodDays }) {
  if (!feature || FEATURES.indexOf(feature) < 0) {
    throw new AppError('VALIDATION', '未知权益功能')
  }
  const qty = Number(amount || 0)
  if (qty <= 0) throw new AppError('VALIDATION', '发放数量无效')

  const row = getBalance(state, userId, feature)
  row.balance += qty
  row.source = source || 'ops_grant'
  if (periodDays) {
    row.periodStart = time.nowMs()
    row.periodEnd = time.nowMs() + Number(periodDays) * 24 * 3600 * 1000
  }
  row.updatedAt = time.nowMs()

  const e = ensure(state)
  const entry = {
    id: makeId('led'),
    userId,
    feature,
    action: 'grant',
    amount: qty,
    taskId: null,
    idempotencyKey: ticketId ? 'grant_' + ticketId + '_' + feature : null,
    chargeKey: null,
    status: 'granted',
    relatedEntryId: null,
    meta: { ticketId: ticketId || null, operatorId: operatorId || null, note: note || null },
    createdAt: time.nowMs()
  }
  if (entry.idempotencyKey) {
    const dup = e.ledger.find((l) => l.idempotencyKey === entry.idempotencyKey && l.action === 'grant')
    if (dup) return { entry: presentEntry(dup), balance: presentBalance(row), reused: true }
  }
  e.ledger.push(entry)
  return { entry: presentEntry(entry), balance: presentBalance(row), reused: false }
}

function setSubscription(state, { userId, plan, expiresAt, status, source, ticketId, operatorId }) {
  const e = ensure(state)
  const sub = {
    id: makeId('sub'),
    userId,
    plan: plan || 'coach_trial',
    status: status || 'active',
    expiresAt: expiresAt || null,
    source: source || 'ops_grant',
    ticketId: ticketId || null,
    operatorId: operatorId || null,
    createdAt: time.nowMs(),
    updatedAt: time.nowMs()
  }
  e.subscriptions.push(sub)
  return presentSubscription(sub)
}

function expireSubscription(state, userId) {
  const sub = getSubscription(state, userId)
  if (!sub) return null
  sub.status = 'expired'
  sub.expiresAt = Math.min(sub.expiresAt || time.nowMs(), time.nowMs())
  sub.updatedAt = time.nowMs()
  return presentSubscription(sub)
}

function listEntitlements(state, userId) {
  ensure(state)
  const features = FEATURES.map((f) => presentBalance(getBalance(state, userId, f)))
  return {
    user_id: userId,
    features,
    subscription: presentSubscription(getSubscription(state, userId)),
    payment_enabled: !!config.features.paymentEnabled,
    note: config.features.paymentEnabled
      ? '支付开关已开，但仍需接入真实渠道后方可扣款'
      : '支付未决策：不可真实付款；额度由试用／运营发放'
  }
}

function listLedger(state, userId, filter = {}) {
  const e = ensure(state)
  return e.ledger
    .filter((l) => l.userId === userId)
    .filter((l) => (filter.feature ? l.feature === filter.feature : true))
    .filter((l) => (filter.task_id ? l.taskId === filter.task_id : true))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(presentEntry)
}

function findEntry(state, entryId) {
  return ensure(state).ledger.find((l) => l.id === entryId) || null
}

function presentBalance(row) {
  return {
    feature: row.feature,
    balance: row.balance,
    reserved: row.reserved,
    available: available(row),
    period_start: row.periodStart,
    period_end: row.periodEnd,
    source: row.source
  }
}

function presentEntry(l) {
  return {
    ledger_id: l.id,
    user_id: l.userId,
    feature: l.feature,
    action: l.action,
    amount: l.amount,
    status: l.status,
    task_id: l.taskId,
    charge_key: l.chargeKey,
    idempotency_key: l.idempotencyKey,
    related_entry_id: l.relatedEntryId,
    meta: l.meta,
    created_at: l.createdAt
  }
}

function presentSubscription(s) {
  if (!s) return null
  const expired =
    s.status === 'expired' || (s.expiresAt != null && s.expiresAt < time.nowMs())
  return {
    subscription_id: s.id,
    plan: s.plan,
    status: expired ? 'expired' : s.status,
    expires_at: s.expiresAt,
    source: s.source
  }
}

/** 种子：给用户发放试用额度（非付款） */
function seedTrialForUser(state, userId) {
  const defaults = config.entitlements.trialDefaults || {}
  Object.keys(defaults).forEach((feature) => {
    grant(state, {
      userId,
      feature,
      amount: defaults[feature],
      source: 'trial_seed',
      note: '系统试用额度'
    })
  })
  setSubscription(state, {
    userId,
    plan: 'trial',
    status: 'active',
    expiresAt: time.nowMs() + 30 * 24 * 3600 * 1000,
    source: 'trial_seed'
  })
}

/**
 * 存量用户补发：配置里新增的试用能力（如 nutrition_scan）若从未 grant 过则补发
 * 避免老 store 无余额时正式模式一调就「额度不足」
 */
function ensureMissingTrialGrants(state, userId) {
  const defaults = config.entitlements.trialDefaults || {}
  const e = ensure(state)
  const granted = {}
  ;(e.ledger || []).forEach((l) => {
    if (
      l.userId === userId &&
      l.action === 'grant' &&
      (l.source === 'trial_seed' || l.source === 'trial_backfill')
    ) {
      granted[l.feature] = true
    }
  })
  Object.keys(defaults).forEach((feature) => {
    if (granted[feature]) return
    const row = getBalance(state, userId, feature)
    // 已有人工发放或余额则跳过
    if ((row.balance || 0) > 0 || (row.reserved || 0) > 0) {
      granted[feature] = true
      return
    }
    grant(state, {
      userId,
      feature,
      amount: defaults[feature],
      source: 'trial_backfill',
      note: '存量用户补发试用额度'
    })
  })
}

module.exports = {
  FEATURES,
  ensure,
  reserve,
  charge,
  release,
  grant,
  setSubscription,
  expireSubscription,
  listEntitlements,
  listLedger,
  getBalance,
  getSubscription,
  ensureMissingTrialGrants,
  assertPaidOpAllowed,
  findEntry,
  seedTrialForUser,
  presentEntry
}
