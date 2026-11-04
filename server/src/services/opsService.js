/**
 * 最小运营后台（文档 12.2）
 * 敏感操作记录工单号、操作者、对象、理由、时间与范围。
 */

const time = require('../lib/time')
const { makeId } = require('../lib/ids')
const { AppError } = require('../lib/errors')
const entitlementService = require('./entitlementService')
const outboxService = require('./outboxService')
const aiTaskService = require('./ai/aiTaskService')
const config = require('../config')

function ensureOps(state) {
  if (!state.ops) state.ops = { audits: [], config: {} }
  if (!state.ops.audits) state.ops.audits = []
  if (!state.ops.config) state.ops.config = {}
  return state.ops
}

function audit(state, actor, { ticketId, action, targetType, targetId, reason, scope }) {
  if (!ticketId) throw new AppError('VALIDATION', '敏感操作须填写工单号 ticket_id')
  const ops = ensureOps(state)
  const row = {
    id: makeId('aud'),
    ticketId,
    operatorId: actor.userId,
    operatorName: actor.displayName,
    action,
    targetType: targetType || null,
    targetId: targetId || null,
    reason: reason || '',
    scope: scope || null,
    createdAt: time.nowMs()
  }
  ops.audits.push(row)
  return row
}

function listAudits(state, filter = {}) {
  return ensureOps(state)
    .audits.filter((a) => (filter.ticket_id ? a.ticketId === filter.ticket_id : true))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((a) => ({
      audit_id: a.id,
      ticket_id: a.ticketId,
      operator_id: a.operatorId,
      operator_name: a.operatorName,
      action: a.action,
      target_type: a.targetType,
      target_id: a.targetId,
      reason: a.reason,
      scope: a.scope,
      created_at: a.createdAt
    }))
}

/** 教练审核 */
function reviewCoach(state, actor, body) {
  const userId = body.user_id
  const decision = body.decision // approve | reject
  const user = state.users.find((u) => u.userId === userId)
  if (!user) throw new AppError('NOT_FOUND', '用户不存在')
  audit(state, actor, {
    ticketId: body.ticket_id,
    action: 'coach_review_' + decision,
    targetType: 'user',
    targetId: userId,
    reason: body.reason
  })
  if (!user.coachProfile) {
    user.coachProfile = { coachId: 'coach_' + userId.slice(-6), intro: '', approvalStatus: 'pending' }
  }
  if (decision === 'approve') {
    user.coachProfile.approvalStatus = 'approved'
    const has = state.userRoles.some((r) => r.userId === userId && r.role === 'coach' && r.status === 'active')
    if (!has) {
      state.userRoles.push({
        userId,
        role: 'coach',
        status: 'active',
        grantedBy: actor.userId
      })
    }
  } else {
    user.coachProfile.approvalStatus = 'rejected'
  }
  return { user_id: userId, approval_status: user.coachProfile.approvalStatus }
}

/** 账号停用 */
function disableAccount(state, actor, body) {
  const user = state.users.find((u) => u.userId === body.user_id)
  if (!user) throw new AppError('NOT_FOUND', '用户不存在')
  audit(state, actor, {
    ticketId: body.ticket_id,
    action: 'account_disable',
    targetType: 'user',
    targetId: body.user_id,
    reason: body.reason
  })
  user.status = 'disabled'
  return { user_id: user.userId, status: user.status }
}

/** 关系异常：强制结束绑定 */
function forceUnbind(state, actor, body) {
  const b = (state.bindings || []).find((x) => x.id === body.binding_id)
  if (!b) throw new AppError('NOT_FOUND', '绑定不存在')
  audit(state, actor, {
    ticketId: body.ticket_id,
    action: 'binding_force_end',
    targetType: 'binding',
    targetId: b.id,
    reason: body.reason,
    scope: { studentId: b.studentId, coachUserId: b.coachUserId }
  })
  b.status = 'ended'
  b.endedAt = time.nowMs()
  b.mediaAccessRevoked = true
  return { binding_id: b.id, status: b.status }
}

/** 动作内容审核 */
function reviewExercise(state, actor, body) {
  audit(state, actor, {
    ticketId: body.ticket_id,
    action: 'exercise_review',
    targetType: 'exercise',
    targetId: body.exercise_id,
    reason: body.reason,
    scope: { decision: body.decision }
  })
  if (!state.exerciseMeta) state.exerciseMeta = { favorites: {}, reviews: {} }
  if (!state.exerciseMeta.reviews) state.exerciseMeta.reviews = {}
  state.exerciseMeta.reviews[body.exercise_id] = {
    decision: body.decision,
    at: time.nowMs(),
    by: actor.userId
  }
  return { exercise_id: body.exercise_id, decision: body.decision }
}

/** 额度补偿 */
function compensateEntitlement(state, actor, body) {
  audit(state, actor, {
    ticketId: body.ticket_id,
    action: 'entitlement_compensate',
    targetType: 'user',
    targetId: body.user_id,
    reason: body.reason,
    scope: { feature: body.feature, amount: body.amount }
  })
  return entitlementService.grant(state, {
    userId: body.user_id,
    feature: body.feature,
    amount: body.amount,
    source: 'ops_compensate',
    ticketId: body.ticket_id,
    operatorId: actor.userId,
    note: body.reason
  })
}

/** 发放试用订阅／权益 */
function grantTrial(state, actor, body) {
  audit(state, actor, {
    ticketId: body.ticket_id,
    action: 'trial_grant',
    targetType: 'user',
    targetId: body.user_id,
    reason: body.reason
  })
  const grants = []
  const features = body.features || config.entitlements.trialDefaults
  Object.keys(features).forEach((feature) => {
    grants.push(
      entitlementService.grant(state, {
        userId: body.user_id,
        feature,
        amount: features[feature],
        source: 'ops_trial',
        ticketId: body.ticket_id,
        operatorId: actor.userId,
        note: body.reason
      })
    )
  })
  let subscription = null
  if (body.subscription !== false) {
    subscription = entitlementService.setSubscription(state, {
      userId: body.user_id,
      plan: body.plan || 'trial',
      status: 'active',
      expiresAt: body.expires_at || time.nowMs() + 30 * 24 * 3600 * 1000,
      source: 'ops_trial',
      ticketId: body.ticket_id,
      operatorId: actor.userId
    })
  }
  return { grants, subscription }
}

/** AI 任务元数据查看／触发重试（不读媒体内容） */
function getAiTaskMeta(state, taskId) {
  const ai = state.ai || { tasks: [] }
  const task = (ai.tasks || []).find((t) => t.id === taskId)
  if (!task) throw new AppError('NOT_FOUND', '任务不存在')
  return {
    task_id: task.id,
    type: task.type,
    mode: task.mode,
    status: task.status,
    owner_id: task.ownerId,
    error: task.error,
    consent_revoked: !!task.consentRevoked,
    created_at: task.createdAt,
    updated_at: task.updatedAt
  }
}

async function retryAiTask(state, actor, body) {
  audit(state, actor, {
    ticketId: body.ticket_id,
    action: 'ai_task_retry',
    targetType: 'ai_task',
    targetId: body.task_id,
    reason: body.reason,
    scope: { node_key: body.node_key || null }
  })
  const fakeActor = { userId: body.as_user_id || null }
  const task = (state.ai.tasks || []).find((t) => t.id === body.task_id)
  if (!task) throw new AppError('NOT_FOUND', '任务不存在')
  fakeActor.userId = task.ownerId
  return aiTaskService.retryTask(state, fakeActor, body.task_id, {
    node_key: body.node_key,
    base_revision: body.base_revision
  })
}

function getConfig(state) {
  const ops = ensureOps(state)
  let llmStatus = { configured: false }
  try {
    llmStatus = require('./llm').publicStatus()
  } catch (_) {}
  return {
    payment_enabled: !!config.features.paymentEnabled,
    ai_provider: process.env.AI_PROVIDER || config.aiProvider,
    llm: llmStatus,
    runtime_overrides: ops.config
  }
}

function patchConfig(state, actor, body) {
  audit(state, actor, {
    ticketId: body.ticket_id,
    action: 'config_patch',
    targetType: 'config',
    targetId: 'runtime',
    reason: body.reason,
    scope: body.patch || {}
  })
  const ops = ensureOps(state)
  ops.config = Object.assign({}, ops.config, body.patch || {})
  return getConfig(state)
}

function listFailedOutbox(state) {
  return outboxService.listFailed(state)
}

function retryOutbox(state, actor, body) {
  audit(state, actor, {
    ticketId: body.ticket_id,
    action: 'outbox_retry',
    targetType: 'outbox',
    targetId: body.outbox_id,
    reason: body.reason
  })
  return outboxService.retry(state, body.outbox_id)
}

module.exports = {
  audit,
  listAudits,
  reviewCoach,
  disableAccount,
  forceUnbind,
  reviewExercise,
  compensateEntitlement,
  grantTrial,
  getAiTaskMeta,
  retryAiTask,
  getConfig,
  patchConfig,
  listFailedOutbox,
  retryOutbox
}
