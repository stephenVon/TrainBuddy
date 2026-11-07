/**
 * 积分兑换。价格来自服务端目录。预占、履约、核销或释放在同一 store.tx 内完成。
 */

const time = require('../lib/time')
const { makeId } = require('../lib/ids')
const { AppError } = require('../lib/errors')
const pointsService = require('./pointsService')
const entitlementService = require('./entitlementService')
const trainingService = require('./trainingService')

function seedCatalog() {
  return [
    {
      sku: 'plan_draft',
      title: '新增训练计划草稿',
      description: '兑换后创建一份你自己的训练计划草稿，不会自动发布。',
      pointsPrice: 30,
      fulfillmentType: 'plan_draft',
      fulfillmentPayload: { title: '积分兑换计划' },
      enabled: true,
      startsAt: null,
      endsAt: null,
      perUserLimit: null,
      stock: null,
      revision: 1
    },
    {
      sku: 'nutrition_scan_3',
      title: '饮食识别 3 次',
      description: '兑换后增加 3 次饮食识别额度。服务未开通时不能实际识别。',
      pointsPrice: 30,
      fulfillmentType: 'nutrition_scan',
      fulfillmentPayload: { amount: 3 },
      enabled: false,
      startsAt: null,
      endsAt: null,
      perUserLimit: null,
      stock: null,
      revision: 1
    },
    {
      sku: 'membership_30d',
      title: '会员 30 天',
      description: '用积分开通 30 天会员资格，不是付款购买。',
      pointsPrice: 100,
      fulfillmentType: 'membership',
      fulfillmentPayload: { plan: 'points_member', days: 30 },
      enabled: false,
      startsAt: null,
      endsAt: null,
      perUserLimit: null,
      stock: null,
      revision: 1
    }
  ]
}

function ensure(state) {
  if (!state.rewards) state.rewards = { catalog: [], orders: [] }
  if (!state.rewards.catalog) state.rewards.catalog = []
  if (!state.rewards.orders) state.rewards.orders = []
  seedCatalog().forEach((item) => {
    if (!state.rewards.catalog.some((row) => row.sku === item.sku)) {
      state.rewards.catalog.push(Object.assign({}, item))
    }
  })
  return state.rewards
}

function inWindow(item, now) {
  if (item.startsAt != null && now < item.startsAt) return false
  if (item.endsAt != null && now > item.endsAt) return false
  return true
}

function presentItem(item) {
  return {
    sku: item.sku,
    title: item.title,
    description: item.description,
    points_price: item.pointsPrice,
    fulfillment_type: item.fulfillmentType,
    enabled: !!item.enabled,
    per_user_limit: item.perUserLimit,
    stock: item.stock,
    starts_at: item.startsAt,
    ends_at: item.endsAt,
    revision: item.revision
  }
}

function presentOrder(order) {
  return {
    order_id: order.id,
    user_id: order.userId,
    sku: order.sku,
    points_price: order.pointsPrice,
    status: order.status,
    fulfillment_ref: order.fulfillmentRef || null,
    failure_code: order.failureCode || null,
    created_at: order.createdAt,
    updated_at: order.updatedAt
  }
}

function listCatalog(state, opts) {
  const now = time.nowMs()
  return ensure(state)
    .catalog.filter((item) => (opts && opts.includeDisabled ? true : item.enabled && inWindow(item, now)))
    .map(presentItem)
}

function activeItem(state, sku) {
  const now = time.nowMs()
  const item = ensure(state).catalog.find((row) => row.sku === sku)
  if (!item || !item.enabled || !inWindow(item, now)) return null
  return item
}

function isHolding(order) {
  return ['fulfilled', 'needs_review', 'fulfilling', 'reserved'].indexOf(order.status) !== -1
}

function countOpen(state, userId, sku) {
  return ensure(state).orders.filter((order) => {
    return order.userId === userId && order.sku === sku && isHolding(order)
  }).length
}

function countSku(state, sku) {
  return ensure(state).orders.filter((order) => order.sku === sku && isHolding(order)).length
}

async function fulfill(app, actor, item, order) {
  const state = app.globalData
  const payload = item.fulfillmentPayload || {}
  if (item.fulfillmentType === 'fail_closed') {
    throw new AppError('FULFILLMENT_FAILED', '履约失败')
  }
  if (item.fulfillmentType === 'needs_review') {
    order.attempts = (order.attempts || 0) + 1
    if (order.attempts < 2) return { needsReview: true }
    return { type: 'manual', id: order.id }
  }
  if (item.fulfillmentType === 'plan_draft') {
    const out = await trainingService.createManualPlan(app, {
      studentId: actor.userId,
      authorId: actor.userId,
      authorRole: 'student',
      title: payload.title || '积分兑换计划'
    })
    return { type: 'plan', plan_id: out.data.plan_id }
  }
  if (item.fulfillmentType === 'nutrition_scan') {
    const granted = entitlementService.grant(state, {
      userId: actor.userId,
      feature: 'nutrition_scan',
      amount: payload.amount || 1,
      source: 'points_redemption',
      ticketId: 'redeem_' + order.id,
      note: item.sku
    })
    return { type: 'entitlement', feature: 'nutrition_scan', ledger_id: granted.entry.ledger_id }
  }
  if (item.fulfillmentType === 'membership') {
    const days = payload.days || 30
    const sub = entitlementService.setSubscription(state, {
      userId: actor.userId,
      plan: payload.plan || 'points_member',
      status: 'active',
      expiresAt: time.nowMs() + days * 24 * 3600 * 1000,
      source: 'points_redemption',
      ticketId: order.id
    })
    return { type: 'subscription', subscription_id: sub.subscription_id }
  }
  return { needsReview: true }
}

async function redeem(app, actor, body, idempotencyKey) {
  if (!idempotencyKey) throw new AppError('VALIDATION', '兑换需要 Idempotency-Key')
  const state = app.globalData
  const box = ensure(state)
  const existing = box.orders.find(
    (order) => order.userId === actor.userId && order.idempotencyKey === idempotencyKey
  )
  if (existing) return presentOrder(existing)
  const item = activeItem(state, body.sku)
  if (!item) throw new AppError('VALIDATION', '商品不可兑换')
  if (item.stock != null && countSku(state, item.sku) >= item.stock) {
    throw new AppError('VALIDATION', '商品已兑完')
  }
  if (item.perUserLimit != null && countOpen(state, actor.userId, item.sku) >= item.perUserLimit) {
    throw new AppError('VALIDATION', '已达到兑换上限')
  }
  const order = {
    id: makeId('ord'),
    userId: actor.userId,
    sku: item.sku,
    pointsPrice: item.pointsPrice,
    status: 'reserved',
    idempotencyKey,
    reserveLedgerId: null,
    fulfillmentRef: null,
    failureCode: null,
    attempts: 0,
    createdAt: time.nowMs(),
    updatedAt: time.nowMs()
  }
  const reserved = pointsService.reserve(state, actor.userId, item.pointsPrice, order.id)
  order.reserveLedgerId = reserved.ledger_id
  order.status = 'fulfilling'
  box.orders.push(order)
  try {
    const ref = await fulfill(app, actor, item, order)
    if (ref && ref.needsReview) {
      order.status = 'needs_review'
      order.updatedAt = time.nowMs()
      return presentOrder(order)
    }
    pointsService.capture(state, actor.userId, item.pointsPrice, order.id)
    order.fulfillmentRef = ref
    order.status = 'fulfilled'
    order.updatedAt = time.nowMs()
    return presentOrder(order)
  } catch (err) {
    pointsService.release(state, actor.userId, item.pointsPrice, order.id)
    order.status = 'failed'
    order.failureCode = (err && err.code) || 'FULFILLMENT_FAILED'
    order.updatedAt = time.nowMs()
    return presentOrder(order)
  }
}

function listOrders(state, userId) {
  return ensure(state)
    .orders.filter((order) => order.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(presentOrder)
}

function getOrder(state, userId, orderId) {
  const order = ensure(state).orders.find((item) => item.id === orderId && item.userId === userId)
  if (!order) throw new AppError('NOT_FOUND', '订单不存在')
  return presentOrder(order)
}

function listAdminOrders(state, status) {
  return ensure(state)
    .orders.filter((order) => (status ? order.status === status : true))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(presentOrder)
}

async function retryOrder(app, actor, orderId, body) {
  const state = app.globalData
  const order = ensure(state).orders.find((item) => item.id === orderId)
  if (!order) throw new AppError('NOT_FOUND', '订单不存在')
  require('./opsService').audit(state, actor, {
    ticketId: body.ticket_id,
    action: 'redemption_retry',
    targetType: 'redemption',
    targetId: orderId,
    reason: body.reason
  })
  if (order.status === 'fulfilled' || order.fulfillmentRef) {
    if (order.status !== 'fulfilled' && order.fulfillmentRef) {
      pointsService.capture(state, order.userId, order.pointsPrice, order.id)
      order.status = 'fulfilled'
      order.updatedAt = time.nowMs()
    }
    return presentOrder(order)
  }
  if (order.status !== 'needs_review' && order.status !== 'fulfilling') {
    throw new AppError('INVALID_STATE', '当前订单不能重试')
  }
  const item = ensure(state).catalog.find((row) => row.sku === order.sku)
  if (!item) throw new AppError('NOT_FOUND', '商品不存在')
  const owner = { userId: order.userId }
  try {
    const ref = await fulfill(app, owner, item, order)
    if (ref && ref.needsReview) {
      order.status = 'needs_review'
      order.updatedAt = time.nowMs()
      return presentOrder(order)
    }
    pointsService.capture(state, order.userId, order.pointsPrice, order.id)
    order.fulfillmentRef = ref
    order.status = 'fulfilled'
    order.failureCode = null
    order.updatedAt = time.nowMs()
    return presentOrder(order)
  } catch (err) {
    order.status = 'needs_review'
    order.failureCode = (err && err.code) || 'FULFILLMENT_FAILED'
    order.updatedAt = time.nowMs()
    return presentOrder(order)
  }
}

function createReward(state, actor, body) {
  require('./opsService').audit(state, actor, {
    ticketId: body.ticket_id,
    action: 'reward_create',
    targetType: 'reward',
    targetId: body.sku,
    reason: body.reason
  })
  const box = ensure(state)
  if (!body.sku || box.catalog.some((item) => item.sku === body.sku)) {
    throw new AppError('VALIDATION', '商品编号无效或已存在')
  }
  const item = {
    sku: String(body.sku).slice(0, 40),
    title: String(body.title || body.sku).slice(0, 40),
    description: String(body.description || '').slice(0, 160),
    pointsPrice: Number(body.points_price || 0),
    fulfillmentType: body.fulfillment_type || 'needs_review',
    fulfillmentPayload: body.fulfillment_payload || {},
    enabled: !!body.enabled,
    startsAt: body.starts_at || null,
    endsAt: body.ends_at || null,
    perUserLimit: body.per_user_limit == null ? null : Number(body.per_user_limit),
    stock: body.stock == null ? null : Number(body.stock),
    revision: 1
  }
  if (item.pointsPrice <= 0) throw new AppError('VALIDATION', '积分价格无效')
  box.catalog.push(item)
  return presentItem(item)
}

function patchReward(state, actor, sku, body) {
  const item = ensure(state).catalog.find((row) => row.sku === sku)
  if (!item) throw new AppError('NOT_FOUND', '商品不存在')
  require('./opsService').audit(state, actor, {
    ticketId: body.ticket_id,
    action: 'reward_patch',
    targetType: 'reward',
    targetId: sku,
    reason: body.reason,
    scope: body.patch || {}
  })
  const patch = body.patch || {}
  if (patch.title) item.title = String(patch.title).slice(0, 40)
  if (patch.description != null) item.description = String(patch.description).slice(0, 160)
  if (patch.points_price != null) item.pointsPrice = Number(patch.points_price)
  if (patch.enabled != null) item.enabled = !!patch.enabled
  if (patch.per_user_limit !== undefined) {
    item.perUserLimit = patch.per_user_limit == null ? null : Number(patch.per_user_limit)
  }
  if (patch.stock !== undefined) item.stock = patch.stock == null ? null : Number(patch.stock)
  item.revision += 1
  return presentItem(item)
}

module.exports = {
  ensure,
  listCatalog,
  redeem,
  listOrders,
  getOrder,
  listAdminOrders,
  retryOrder,
  createReward,
  patchReward
}
