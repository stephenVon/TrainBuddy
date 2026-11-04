/**
 * API25–26 AI 任务中心：创建／查询／取消／重试
 * - 演示与真实隔离（is_demo）
 * - 账本同结果最多核销一次（AC31）
 * - 撤权后迟到回调不发布（AC30）
 */

const time = require('../../lib/time')
const { makeId } = require('../../lib/ids')
const { AppError } = require('../../lib/errors')
const mediaService = require('../mediaService')
const entitlementService = require('../entitlementService')
const {
  runPostureScan,
  runGoalNode,
  runNutritionScan,
  resolveProvider,
  WATERMARK
} = require('./providers')

function ensureAi(state) {
  if (!state.ai) state.ai = { tasks: [], ledger: [], callbackDedup: {} }
  if (!state.ai.tasks) state.ai.tasks = []
  if (!state.ai.ledger) state.ai.ledger = []
  if (!state.ai.callbackDedup) state.ai.callbackDedup = {}
  return state.ai
}

function featureForType(type) {
  if (type === 'goal_image') return 'goal_image'
  if (type === 'nutrition_scan') return 'nutrition_scan'
  return 'posture_scan'
}

function findTask(state, taskId) {
  return ensureAi(state).tasks.find((t) => t.id === taskId) || null
}

function ensureGoals(state) {
  if (!state.goals) state.goals = { groups: [] }
  if (!state.goals.groups) state.goals.groups = []
  return state.goals
}

function ensurePosture(state) {
  if (!state.posture) state.posture = { reports: [] }
  if (!state.posture.reports) state.posture.reports = []
  return state.posture
}

async function createTask(state, actor, body) {
  const ai = ensureAi(state)
  const type = body.type
  if (!type || ['posture_scan', 'goal_image', 'nutrition_scan'].indexOf(type) < 0) {
    throw new AppError('VALIDATION', 'type 须为 posture_scan、goal_image 或 nutrition_scan')
  }

  const mode = body.mode === 'demo' ? 'demo' : 'real'
  const consentOk = body.consent_confirmed !== false
  if (!consentOk && mode === 'real') {
    throw new AppError('CONSENT_REQUIRED', '请先确认用途与授权')
  }

  const taskId = makeId('aitask')
  let reserveAmount = 1
  if (type === 'goal_image') {
    const nodes = (body.input && body.input.nodes) || body.nodes
    const goalCfg = body.input && (body.input.goal_config || body.input.goalConfig)
    if (nodes && nodes.length) reserveAmount = nodes.length
    else if (mode === 'real' && goalCfg) reserveAmount = 1
    else reserveAmount = 3
  }

  let ledgerId = null
  if (mode === 'real') {
    entitlementService.ensureMissingTrialGrants(state, actor.userId)
    const reserved = entitlementService.reserve(state, {
      userId: actor.userId,
      feature: featureForType(type),
      amount: reserveAmount,
      taskId,
      idempotencyKey: body.idempotency_key || body.reserve_key || null
    })
    ledgerId = reserved.entry.ledger_id
  }

  const task = {
    id: taskId,
    type,
    mode,
    isDemo: mode === 'demo',
    ownerId: actor.userId,
    status: 'queued',
    revision: 1,
    input: body.input || {},
    resultRef: null,
    error: null,
    ledgerId,
    reserveAmount: mode === 'real' ? reserveAmount : 0,
    chargedNodes: [],
    consentRevoked: false,
    callbackIds: [],
    createdAt: time.nowMs(),
    updatedAt: time.nowMs(),
    publishedAt: null,
    nodes: null,
    groupId: null,
    confirmedMealId: null
  }

  ai.tasks.push(task)

  try {
    if (type === 'posture_scan') {
      await processPostureTask(state, task, body)
    } else if (type === 'goal_image') {
      await processGoalTask(state, task, body)
    } else {
      await processNutritionTask(state, task, body)
    }
  } catch (e) {
    task.status = 'failed'
    task.error = {
      code: e.code || 'AI_FAILED',
      message: e.message || '任务失败',
      retryable: !!e.retryable
    }
    task.updatedAt = time.nowMs()
    releaseTaskQuota(state, task, 'failed')
  }

  return presentTask(task, state)
}

async function processNutritionTask(state, task, body) {
  const input = Object.assign({}, task.input || {}, (body && body.input) || {})
  task.input = input
  const mediaId = input.media_id || input.mediaId
  if (!mediaId) {
    throw new AppError('VALIDATION', '缺少 media_id')
  }

  const asset = mediaService.getAsset(state, mediaId)
  if (!asset || asset.deletedAt || asset.ownerId !== task.ownerId) {
    throw new AppError('NOT_FOUND', '媒体不存在或无权使用')
  }
  if (asset.status !== 'ready') {
    throw new AppError('INVALID_STATE', '媒体尚未上传完成，不能开始识别')
  }

  task.status = 'running'
  task.updatedAt = time.nowMs()

  const qualityHints = input.quality_hints || input.qualityHints || asset.quality || {}
  let imageBase64 = input.image_base64 || input.imageBase64 || null
  let imageUrl = input.image_url || input.imageUrl || null
  // 本地 mock 签名 URL 外网模型无法拉取，且会触发「only support text」类错误；有 base64 时优先用
  if (imageUrl && /mock\.(signed|upload)\.local/i.test(imageUrl)) {
    imageUrl = null
  }
  if (!imageUrl && !imageBase64) {
    try {
      const access = mediaService.getAccess(
        state,
        { userId: task.ownerId },
        mediaId
      )
      const u = access && access.url
      if (u && !/mock\.(signed|upload)\.local/i.test(u)) imageUrl = u
    } catch (_) {
      /* ignore */
    }
  }
  // 避免把大图 base64 持久化进 store
  if (task.input) {
    delete task.input.image_base64
    delete task.input.imageBase64
  }
  const out = await runNutritionScan({
    mode: task.mode,
    qualityHints,
    imageUrl,
    imageBase64,
    mime: asset.mime || 'image/jpeg'
  })

  if (task.consentRevoked) {
    task.status = 'cancelled'
    task.error = { code: 'CONSENT_REVOKED', message: '授权已撤回，迟到结果不发布' }
    releaseTaskQuota(state, task, 'revoked')
    return
  }

  if (out.status === 'need_retake') {
    task.status = 'need_retake'
    task.resultRef = {
      kind: 'nutrition_result',
      data: {
        task_id: task.id,
        media_id: mediaId,
        status: 'need_retake',
        items: [],
        total_macros_g: { carbs: null, protein: null, fat: null },
        is_estimate: true,
        is_demo: !!out.is_demo,
        model_version: out.model_version || null,
        quality: out.quality,
        message: out.message || '请重拍'
      }
    }
    task.updatedAt = time.nowMs()
    releaseTaskQuota(state, task, 'need_retake')
    return
  }

  task.status = 'needs_confirmation'
  task.resultRef = {
    kind: 'nutrition_result',
    data: {
      task_id: task.id,
      media_id: mediaId,
      status: 'needs_confirmation',
      items: out.items || [],
      total_macros_g: out.total_macros_g || { carbs: null, protein: null, fat: null },
      is_estimate: out.is_estimate !== false,
      is_demo: !!out.is_demo,
      model_version: out.model_version || null,
      quality: out.quality || null
    }
  }
  task.publishedAt = time.nowMs()
  task.updatedAt = time.nowMs()
  chargeTaskQuota(state, task, 1, task.id + ':nutrition')
}

async function processPostureTask(state, task, body) {
  const input = body.input || {}
  const frontId = input.front_media_id || input.frontMediaId
  const sideId = input.side_media_id || input.sideMediaId
  let front = null
  let side = null
  try {
    if (frontId) front = mediaService.getAsset(state, frontId)
    if (sideId) side = mediaService.getAsset(state, sideId)
  } catch (_) {}

  const qualityGate = mediaService.evaluatePostureInputQuality(
    front,
    side,
    input.quality_hints || input
  )
  const forcePelvicUnable = !!(input.force_pelvic_unable || body.force_pelvic_unable)

  const frontImageBase64 = input.front_image_base64 || input.frontImageBase64 || null
  const sideImageBase64 = input.side_image_base64 || input.sideImageBase64 || null
  if (task.input) {
    delete task.input.front_image_base64
    delete task.input.frontImageBase64
    delete task.input.side_image_base64
    delete task.input.sideImageBase64
  }

  const out = await runPostureScan({
    mode: task.mode,
    qualityGate,
    forcePelvicUnable,
    frontImageBase64,
    sideImageBase64,
    mime: (front && front.mime) || (side && side.mime) || 'image/jpeg'
  })

  if (task.consentRevoked) {
    task.status = 'cancelled'
    task.error = { code: 'CONSENT_REVOKED', message: '授权已撤回，结果不发布' }
    task.updatedAt = time.nowMs()
    releaseTaskQuota(state, task, 'revoked')
    return
  }

  if (out.status === 'need_retake') {
    task.status = 'need_retake'
    task.resultRef = { kind: 'quality_gate', data: out }
    task.updatedAt = time.nowMs()
    releaseTaskQuota(state, task, 'need_retake')
    return
  }

  const posture = ensurePosture(state)
  const report = {
    id: makeId('preport'),
    taskId: task.id,
    studentId: task.ownerId,
    status: 'draft',
    isDemo: task.isDemo,
    overallScore: null,
    modelVersion: out.model_version,
    items: out.items,
    improvementHints: out.improvement_hints,
    frontMediaId: frontId || null,
    sideMediaId: sideId || null,
    review: null,
    aiSnapshot: out,
    revision: 1,
    createdAt: time.nowMs(),
    updatedAt: time.nowMs()
  }
  posture.reports.push(report)

  task.status = 'succeeded'
  task.resultRef = { kind: 'posture_report', report_id: report.id }
  task.publishedAt = time.nowMs()
  task.updatedAt = time.nowMs()
  chargeTaskQuota(state, task, 1, 'callback_posture_' + task.id)
}

async function processGoalTask(state, task, body) {
  const input = Object.assign({}, task.input || {}, (body && body.input) || {})
  task.input = input
  const sourceMediaId = input.source_media_id || input.sourceMediaId
  const sourceImageBase64 = input.source_image_base64 || input.sourceImageBase64 || null
  const goalConfig = input.goal_config || input.goalConfig || null
  if (!sourceMediaId && !sourceImageBase64 && task.mode === 'real') {
    throw new AppError('VALIDATION', '缺少源照片，请先拍照或从相册上传')
  }

  let nodesSpec = input.nodes || body.nodes
  if (!nodesSpec || !nodesSpec.length) {
    // 正式有配置时默认单节点（更快）；演示仍三节点覆盖 AC
    nodesSpec =
      task.mode === 'real' && goalConfig
        ? [{ key: 'goal', months: 3 }]
        : [
            { key: 'm2', months: 2 },
            { key: 'm3', months: 3 },
            { key: 'm6', months: 6 }
          ]
  }
  if (nodesSpec.length > 3) {
    throw new AppError('VALIDATION', '每次最多 3 个节点')
  }

  const failKeys = new Set((input.fail_nodes || body.fail_nodes || []).map(String))

  let sourcePreviewUrl = null
  if (sourceImageBase64) {
    sourcePreviewUrl =
      String(sourceImageBase64).indexOf('data:') === 0
        ? String(sourceImageBase64)
        : 'data:image/jpeg;base64,' + String(sourceImageBase64).replace(/^data:[^;]+;base64,/, '')
  }

  const goals = ensureGoals(state)
  const group = {
    id: makeId('ggrp'),
    taskId: task.id,
    ownerId: task.ownerId,
    sourceMediaId: sourceMediaId || null,
    sourcePreviewUrl,
    goalConfig: goalConfig || null,
    goalText: input.goal_text || input.goalText || '',
    isDemo: task.isDemo,
    status: 'processing',
    consentRevoked: false,
    nodes: [],
    createdAt: time.nowMs(),
    updatedAt: time.nowMs()
  }
  goals.groups.push(group)
  task.groupId = group.id
  task.nodes = []
  task.status = 'running'
  task.updatedAt = time.nowMs()

  for (const spec of nodesSpec) {
    const node = {
      key: spec.key || 'm' + spec.months,
      months: Number(spec.months),
      status: 'queued',
      resultMediaId: null,
      previewUrl: null,
      error: null,
      revision: 1,
      charged: false
    }
    group.nodes.push(node)
    task.nodes.push(node)

    try {
      if (task.consentRevoked || group.consentRevoked) {
        node.status = 'cancelled'
        node.error = { code: 'CONSENT_REVOKED', message: '授权已撤回，不发布' }
        continue
      }
      const out = await runGoalNode({
        mode: task.mode,
        nodeKey: node.key,
        months: node.months,
        fail: failKeys.has(node.key),
        goalText: input.goal_text || input.goalText || '',
        goalConfig,
        sourceImageBase64,
        sourceImageUrl: null,
        mime: input.mime || 'image/jpeg'
      })

      if (task.consentRevoked || group.consentRevoked) {
        node.status = 'cancelled'
        node.error = { code: 'CONSENT_REVOKED', message: '授权已撤回，迟到结果不发布' }
        continue
      }

      const media = mediaService.ensureMedia(state)
      const dataUrl = out.image_data_url || null
      const resultAsset = {
        id: makeId('media'),
        ownerId: task.ownerId,
        purpose: 'goal_image_result',
        mime: 'image/jpeg',
        size: dataUrl ? Math.ceil((dataUrl.length * 3) / 4) : 1024,
        status: 'ready',
        deletedAt: null,
        meta: {
          node: node.key,
          months: node.months,
          preview_label: out.preview_label,
          goal_config: goalConfig
        },
        quality: null,
        derivedFrom: sourceMediaId || null,
        watermarked: true,
        watermarkText: out.watermark_text || WATERMARK(),
        isDemo: task.isDemo,
        dataUrl,
        createdAt: time.nowMs(),
        updatedAt: time.nowMs(),
        completedAt: time.nowMs()
      }
      media.assets.push(resultAsset)

      node.status = 'succeeded'
      node.resultMediaId = resultAsset.id
      node.previewUrl = dataUrl
      node.result = out
      chargeNodeQuota(state, task, node.key)
    } catch (e) {
      node.status = 'failed'
      node.error = {
        code: e.code || 'NODE_FAILED',
        message: e.message || '节点失败',
        retryable: e.retryable !== false
      }
    }
  }

  // 不落库大图 base64，避免 MemoryStore 膨胀
  if (task.input) {
    delete task.input.source_image_base64
    delete task.input.sourceImageBase64
  }

  const statuses = group.nodes.map((n) => n.status)
  if (statuses.every((s) => s === 'succeeded')) {
    group.status = 'succeeded'
    task.status = 'succeeded'
  } else if (statuses.some((s) => s === 'succeeded')) {
    group.status = 'partial'
    task.status = 'partial'
  } else if (statuses.every((s) => s === 'cancelled')) {
    group.status = 'cancelled'
    task.status = 'cancelled'
  } else {
    group.status = 'failed'
    task.status = 'failed'
    task.error = { code: 'ALL_NODES_FAILED', message: '全部节点失败' }
  }
  group.updatedAt = time.nowMs()
  task.resultRef = { kind: 'goal_group', group_id: group.id }
  task.updatedAt = time.nowMs()
  if (task.status === 'succeeded' || task.status === 'partial') {
    task.publishedAt = time.nowMs()
  }
  // 未成功节点释放预占
  releaseTaskQuota(state, task, task.status)
}

/**
 * AC31：同一 chargeKey／回调最多核销一次
 */
function chargeTaskQuota(state, task, amount, chargeKey) {
  if (!task.ledgerId || task.isDemo) return null
  const ai = ensureAi(state)
  if (chargeKey && ai.callbackDedup[chargeKey]) {
    return { duplicated: true }
  }
  const result = entitlementService.charge(state, {
    userId: task.ownerId,
    feature: featureForType(task.type),
    amount: amount || 1,
    taskId: task.id,
    chargeKey,
    reserveEntryId: task.ledgerId
  })
  if (chargeKey) ai.callbackDedup[chargeKey] = result.entry.ledger_id
  return result
}

function chargeNodeQuota(state, task, nodeKey) {
  if (!task.ledgerId || task.isDemo) return null
  if (task.chargedNodes && task.chargedNodes.indexOf(nodeKey) >= 0) return null
  const result = chargeTaskQuota(state, task, 1, task.id + ':node:' + nodeKey)
  if (!task.chargedNodes) task.chargedNodes = []
  if (!result || !result.duplicated) task.chargedNodes.push(nodeKey)
  return result
}

function releaseTaskQuota(state, task, reason) {
  if (!task.ledgerId || task.isDemo) return null
  return entitlementService.release(state, {
    userId: task.ownerId,
    feature: featureForType(task.type),
    taskId: task.id,
    reserveEntryId: task.ledgerId,
    reason
  })
}

function getTask(state, actor, taskId) {
  const ai = ensureAi(state)
  const task = ai.tasks.find((t) => t.id === taskId)
  if (!task) throw new AppError('NOT_FOUND', '任务不存在')
  if (task.ownerId !== actor.userId && !canCoachRead(state, actor, task.ownerId)) {
    throw new AppError('FORBIDDEN', '无权查看该任务')
  }
  return presentTask(task, state)
}

function listTasks(state, actor, filter = {}) {
  const ai = ensureAi(state)
  return ai.tasks
    .filter((t) => t.ownerId === actor.userId)
    .filter((t) => (filter.mode ? t.mode === filter.mode : true))
    .filter((t) => (filter.type ? t.type === filter.type : true))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((t) => presentTask(t, state))
}

function cancelTask(state, actor, taskId, body = {}) {
  const ai = ensureAi(state)
  const task = ai.tasks.find((t) => t.id === taskId)
  if (!task) throw new AppError('NOT_FOUND', '任务不存在')
  if (task.ownerId !== actor.userId) throw new AppError('FORBIDDEN', '无权取消')
  if (body.base_revision != null && Number(body.base_revision) !== task.revision) {
    throw new AppError('REVISION_CONFLICT', '任务已被更新', {
      extra: { latest_revision: task.revision }
    })
  }
  if (['succeeded', 'partial', 'cancelled', 'confirmed'].indexOf(task.status) >= 0) {
    throw new AppError('INVALID_STATE', '当前状态不可取消')
  }
  task.status = 'cancelled'
  task.consentRevoked = !!body.revoke_consent
  task.revision += 1
  task.updatedAt = time.nowMs()
  releaseTaskQuota(state, task, 'cancelled')

  if (task.groupId) {
    const goals = ensureGoals(state)
    const g = goals.groups.find((x) => x.id === task.groupId)
    if (g) {
      g.consentRevoked = task.consentRevoked
      g.status = 'cancelled'
      g.updatedAt = time.nowMs()
    }
  }
  return presentTask(task, state)
}

/**
 * 重试：整任务或单节点（AC28）；成功部分不重复核销（AC31）
 * 已撤权不能再提交（AC26 配套 / API26）
 */
async function retryTask(state, actor, taskId, body = {}) {
  const ai = ensureAi(state)
  const task = ai.tasks.find((t) => t.id === taskId)
  if (!task) throw new AppError('NOT_FOUND', '任务不存在')
  if (task.ownerId !== actor.userId) throw new AppError('FORBIDDEN', '无权重试')
  if (task.consentRevoked) {
    throw new AppError('CONSENT_REVOKED', '授权已撤回，不能再提交')
  }
  if (body.base_revision != null && Number(body.base_revision) !== task.revision) {
    throw new AppError('REVISION_CONFLICT', '任务已被更新', {
      extra: { latest_revision: task.revision }
    })
  }

  const nodeKey = body.node_key || body.nodeKey
  if (task.type === 'goal_image' && nodeKey) {
    return retryGoalNode(state, task, nodeKey)
  }

  if (task.type === 'posture_scan' && task.status === 'need_retake') {
    task.status = 'queued'
    task.error = null
    task.revision += 1
    task.updatedAt = time.nowMs()
    await processPostureTask(state, task, {
      input: Object.assign({}, task.input, body.input || {})
    })
    return presentTask(task, state)
  }

  if (
    task.type === 'nutrition_scan' &&
    (task.status === 'need_retake' || task.status === 'failed')
  ) {
    task.status = 'queued'
    task.error = null
    task.resultRef = null
    task.revision += 1
    task.updatedAt = time.nowMs()
    try {
      await processNutritionTask(state, task, {
        input: Object.assign({}, task.input, body.input || {})
      })
    } catch (e) {
      task.status = 'failed'
      task.error = {
        code: e.code || 'AI_FAILED',
        message: e.message || '任务失败',
        retryable: !!e.retryable
      }
      task.updatedAt = time.nowMs()
      releaseTaskQuota(state, task, 'failed')
    }
    return presentTask(task, state)
  }

  throw new AppError('VALIDATION', '请指定可重试的失败节点或需重拍任务')
}

async function retryGoalNode(state, task, nodeKey) {
  const goals = ensureGoals(state)
  const group = goals.groups.find((g) => g.id === task.groupId)
  if (!group) throw new AppError('NOT_FOUND', '目标组不存在')
  if (group.consentRevoked || task.consentRevoked) {
    throw new AppError('CONSENT_REVOKED', '授权已撤回，不能再提交')
  }
  const node = group.nodes.find((n) => n.key === nodeKey)
  if (!node) throw new AppError('NOT_FOUND', '节点不存在')
  if (node.status === 'succeeded') {
    throw new AppError('INVALID_STATE', '成功节点无需重试，不重复核销')
  }

  node.status = 'queued'
  node.error = null
  node.revision += 1
  task.revision += 1
  task.updatedAt = time.nowMs()

  try {
    const input = task.input || {}
    const out = await runGoalNode({
      mode: task.mode,
      nodeKey: node.key,
      months: node.months,
      fail: false,
      goalText: input.goal_text || input.goalText || '',
      goalConfig: input.goal_config || input.goalConfig || group.goalConfig || null,
      sourceImageBase64: null,
      sourceImageUrl: group.sourcePreviewUrl || null,
      mime: input.mime || 'image/jpeg'
    })
    if (task.consentRevoked || group.consentRevoked) {
      node.status = 'cancelled'
      node.error = { code: 'CONSENT_REVOKED', message: '授权已撤回，迟到结果不发布' }
    } else {
      const media = mediaService.ensureMedia(state)
      const dataUrl = out.image_data_url || null
      const resultAsset = {
        id: makeId('media'),
        ownerId: task.ownerId,
        purpose: 'goal_image_result',
        mime: 'image/jpeg',
        size: dataUrl ? Math.ceil((dataUrl.length * 3) / 4) : 1024,
        status: 'ready',
        deletedAt: null,
        dataUrl,
        meta: { node: node.key, months: node.months },
        quality: null,
        derivedFrom: group.sourceMediaId,
        watermarked: true,
        watermarkText: out.watermark_text || WATERMARK(),
        isDemo: task.isDemo,
        createdAt: time.nowMs(),
        updatedAt: time.nowMs(),
        completedAt: time.nowMs()
      }
      media.assets.push(resultAsset)
      node.status = 'succeeded'
      node.resultMediaId = resultAsset.id
      node.previewUrl = dataUrl
      node.result = out
      chargeNodeQuota(state, task, node.key)
    }
  } catch (e) {
    node.status = 'failed'
    node.error = { code: e.code || 'NODE_FAILED', message: e.message, retryable: true }
  }

  const statuses = group.nodes.map((n) => n.status)
  if (statuses.every((s) => s === 'succeeded')) {
    group.status = 'succeeded'
    task.status = 'succeeded'
  } else if (statuses.some((s) => s === 'succeeded')) {
    group.status = 'partial'
    task.status = 'partial'
  } else {
    group.status = 'failed'
    task.status = 'failed'
  }
  group.updatedAt = time.nowMs()
  task.updatedAt = time.nowMs()
  if (task.status === 'succeeded' || task.status === 'partial') {
    task.publishedAt = task.publishedAt || time.nowMs()
  }
  releaseTaskQuota(state, task, 'retry_settle')
  return presentTask(task, state)
}

/**
 * AC30：模拟迟到回调；撤权后不发布
 */
function applyLateCallback(state, taskId, callbackId, payload) {
  const ai = ensureAi(state)
  const task = ai.tasks.find((t) => t.id === taskId)
  if (!task) throw new AppError('NOT_FOUND', '任务不存在')

  if (!callbackId) throw new AppError('VALIDATION', '缺少 callback_id')

  if (ai.callbackDedup[callbackId]) {
    return {
      applied: false,
      reason: 'duplicate_callback',
      ledger: presentLedgerSummary(state, task)
    }
  }

  if (task.consentRevoked) {
    ai.callbackDedup[callbackId] = 'ignored_revoked'
    return { applied: false, reason: 'consent_revoked', published: false }
  }

  if (task.status === 'cancelled') {
    ai.callbackDedup[callbackId] = 'ignored_cancelled'
    return { applied: false, reason: 'cancelled', published: false }
  }

  task.callbackIds.push(callbackId)
  ai.callbackDedup[callbackId] = 'accepted'

  // AC31：任务已有核销记录则不再扣费，只登记回调
  const priorCharges = entitlementService
    .listLedger(state, task.ownerId, { task_id: task.id })
    .filter((l) => l.action === 'charge')
  if (priorCharges.length === 0 && task.ledgerId && !task.isDemo) {
    chargeTaskQuota(state, task, 1, 'settle_' + task.id)
  }

  if (payload && payload.publish && task.status !== 'succeeded') {
    task.status = 'succeeded'
    task.publishedAt = time.nowMs()
  }
  task.updatedAt = time.nowMs()
  return { applied: true, ledger: presentLedgerSummary(state, task) }
}

function revokeConsentOnTask(state, taskId) {
  const ai = ensureAi(state)
  const task = ai.tasks.find((t) => t.id === taskId)
  if (!task) throw new AppError('NOT_FOUND', '任务不存在')
  task.consentRevoked = true
  task.updatedAt = time.nowMs()
  if (task.groupId) {
    const g = ensureGoals(state).groups.find((x) => x.id === task.groupId)
    if (g) {
      g.consentRevoked = true
      g.updatedAt = time.nowMs()
    }
  }
  if (!task.publishedAt) {
    task.status = 'cancelled'
    releaseTaskQuota(state, task, 'revoked')
  }
  return presentTask(task, state)
}

function presentLedgerSummary(state, task) {
  if (!task.ledgerId || !state) return null
  const entry = entitlementService.findEntry(state, task.ledgerId)
  if (!entry) return null
  const charges = entitlementService
    .listLedger(state, task.ownerId, { task_id: task.id })
    .filter((l) => l.action === 'charge')
  return {
    id: entry.id,
    status: entry.status,
    feature: entry.feature,
    reserved_amount: entry.amount,
    charged_count: charges.reduce((s, c) => s + c.amount, 0),
    charged_at: charges[0] ? charges[0].created_at : null
  }
}

function canCoachRead(state, actor, studentId) {
  const b = (state.bindings || []).find(
    (x) =>
      x.studentId === studentId &&
      x.coachUserId === actor.userId &&
      x.status === 'active'
  )
  return !!b
}

function presentTask(task, state) {
  const out = {
    task_id: task.id,
    type: task.type,
    mode: task.mode,
    is_demo: !!task.isDemo,
    status: task.status,
    revision: task.revision,
    owner_id: task.ownerId,
    result: null,
    error: task.error,
    consent_revoked: !!task.consentRevoked,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    published_at: task.publishedAt,
    provider: resolveProvider(task.mode)
  }

  if (task.resultRef && task.resultRef.kind === 'posture_report' && state) {
    const r = ensurePosture(state).reports.find((x) => x.id === task.resultRef.report_id)
    if (r) out.result = presentReportBrief(r)
  } else if (task.resultRef && task.resultRef.kind === 'goal_group' && state) {
    const g = ensureGoals(state).groups.find((x) => x.id === task.resultRef.group_id)
    if (g) out.result = presentGroup(g)
  } else if (task.resultRef && task.resultRef.kind === 'quality_gate') {
    out.result = task.resultRef.data
  } else if (task.resultRef && task.resultRef.kind === 'nutrition_result') {
    out.result = task.resultRef.data
  }

  if (task.confirmedMealId) {
    out.confirmed_meal_id = task.confirmedMealId
  }

  if (task.nodes) {
    out.nodes = task.nodes.map((n) => ({
      key: n.key,
      months: n.months,
      status: n.status,
      result_media_id: n.resultMediaId,
      error: n.error,
      watermarked: !!(n.result && n.result.watermark_baked)
    }))
  }

  if (task.ledgerId && state) {
    out.ledger = presentLedgerSummary(state, task)
  }
  return out
}

function presentReportBrief(r) {
  return {
    report_id: r.id,
    status: r.status,
    overall_score: null,
    is_demo: !!r.isDemo,
    item_count: (r.items || []).length,
    review_status: r.review ? r.review.decision : null
  }
}

function presentGroup(g) {
  return {
    group_id: g.id,
    status: g.status,
    is_demo: !!g.isDemo,
    goal_text: g.goalText,
    goal_config: g.goalConfig || null,
    source_media_id: g.sourceMediaId || null,
    source_preview_url: g.sourcePreviewUrl || null,
    nodes: g.nodes.map((n) => ({
      key: n.key,
      months: n.months,
      status: n.status,
      result_media_id: n.resultMediaId,
      preview_url: n.previewUrl || null,
      error: n.error,
      watermarked: n.status === 'succeeded'
    }))
  }
}

function getGoalGroup(state, actor, groupId) {
  const g = ensureGoals(state).groups.find((x) => x.id === groupId)
  if (!g) throw new AppError('NOT_FOUND', '目标组不存在')
  if (g.ownerId !== actor.userId && !canCoachRead(state, actor, g.ownerId)) {
    throw new AppError('FORBIDDEN', '无权查看')
  }
  return presentGroup(g)
}

module.exports = {
  createTask,
  getTask,
  listTasks,
  cancelTask,
  retryTask,
  applyLateCallback,
  revokeConsentOnTask,
  getGoalGroup,
  ensureAi,
  ensurePosture,
  ensureGoals,
  presentTask,
  findTask,
  processNutritionTask
}
