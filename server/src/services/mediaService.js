/**
 * API23–24 媒体：上传意图、完成、短期访问、删除与清理任务
 */

const time = require('../lib/time')
const { makeId } = require('../lib/ids')
const { AppError } = require('../lib/errors')
const config = require('../config')
const bindingService = require('./bindingService')

function ensureMedia(state) {
  if (!state.media) state.media = { assets: [], cleanupTasks: [] }
  if (!state.media.assets) state.media.assets = []
  if (!state.media.cleanupTasks) state.media.cleanupTasks = []
  return state.media
}

function createUploadIntent(state, actor, body) {
  const media = ensureMedia(state)
  const purpose = body.purpose
  const mime = body.mime || body.content_type
  const size = Number(body.size || 0)
  if (!purpose) throw new AppError('VALIDATION', '缺少 purpose')
  if (!mime || config.media.allowedMime.indexOf(mime) < 0) {
    throw new AppError('VALIDATION', '仅支持 jpg/png/webp')
  }
  if (!size || size <= 0 || size > config.media.maxBytes) {
    throw new AppError('VALIDATION', '文件大小须在 1B–10MB')
  }

  const asset = {
    id: makeId('media'),
    ownerId: actor.userId,
    purpose,
    mime,
    size,
    status: 'pending_upload',
    deletedAt: null,
    meta: body.meta || {},
    quality: null,
    derivedFrom: body.derived_from || null,
    watermarked: false,
    watermarkText: null,
    isDemo: !!body.is_demo || !!body.isDemo,
    createdAt: time.nowMs(),
    updatedAt: time.nowMs(),
    completedAt: null
  }
  media.assets.push(asset)

  return {
    media_id: asset.id,
    upload: {
      method: 'PUT',
      url: 'https://mock.upload.local/' + asset.id,
      headers: { 'Content-Type': mime },
      expires_in: 600
    },
    constraints: {
      max_bytes: config.media.maxBytes,
      allowed_mime: config.media.allowedMime
    }
  }
}

function completeUpload(state, actor, mediaId, body) {
  const media = ensureMedia(state)
  const asset = media.assets.find((a) => a.id === mediaId)
  if (!asset) throw new AppError('NOT_FOUND', '媒体不存在')
  if (asset.ownerId !== actor.userId) throw new AppError('FORBIDDEN', '无权完成该上传')
  if (asset.deletedAt) throw new AppError('INVALID_STATE', '媒体已删除')
  if (asset.status === 'ready') {
    return presentAsset(asset)
  }

  const quality = normalizeQuality(body.quality || body.quality_hints || {})
  asset.quality = quality
  asset.checksum = body.checksum || null
  asset.status = 'ready'
  asset.completedAt = time.nowMs()
  asset.updatedAt = time.nowMs()
  if (body.watermarked) {
    asset.watermarked = true
    asset.watermarkText = body.watermark_text || config.media.watermarkText
  }
  return presentAsset(asset)
}

function normalizeQuality(q) {
  return {
    has_front: q.has_front != null ? !!q.has_front : q.hasFront != null ? !!q.hasFront : null,
    has_side: q.has_side != null ? !!q.has_side : q.hasSide != null ? !!q.hasSide : null,
    person_count:
      q.person_count != null
        ? Number(q.person_count)
        : q.personCount != null
          ? Number(q.personCount)
          : null,
    occlusion: q.occlusion || null,
    clarity: q.clarity || null,
    view: q.view || null,
    retake_reasons: q.retake_reasons || q.retakeReasons || []
  }
}

/**
 * 体态输入质量门禁（AC26）：缺侧面／多人／严重遮挡 → 需重拍，不生成默认正常报告
 */
function evaluatePostureInputQuality(frontAsset, sideAsset, hints) {
  const reasons = []
  const h = hints || {}
  const personCount =
    h.person_count != null
      ? Number(h.person_count)
      : (frontAsset && frontAsset.quality && frontAsset.quality.person_count) || 1
  const occlusion =
    h.occlusion ||
    (frontAsset && frontAsset.quality && frontAsset.quality.occlusion) ||
    (sideAsset && sideAsset.quality && sideAsset.quality.occlusion) ||
    null

  if (!frontAsset || frontAsset.status !== 'ready' || frontAsset.deletedAt) {
    reasons.push('missing_front')
  }
  if (!sideAsset || sideAsset.status !== 'ready' || sideAsset.deletedAt) {
    reasons.push('missing_side')
  }
  if (personCount > 1) reasons.push('multiple_persons')
  if (occlusion === 'severe' || occlusion === 'heavy') reasons.push('severe_occlusion')

  return {
    ok: reasons.length === 0,
    need_retake: reasons.length > 0,
    reasons
  }
}

function getAsset(state, mediaId) {
  const media = ensureMedia(state)
  const asset = media.assets.find((a) => a.id === mediaId)
  if (!asset) throw new AppError('NOT_FOUND', '媒体不存在')
  return asset
}

function getAccess(state, actor, mediaId, opts = {}) {
  const asset = getAsset(state, mediaId)
  if (asset.deletedAt) {
    throw new AppError('MEDIA_DELETED', '媒体已删除，禁止读取', { status: 410 })
  }
  if (asset.status !== 'ready') {
    throw new AppError('INVALID_STATE', '媒体尚未就绪')
  }

  const purpose = opts.purpose || asset.purpose
  if (actor.userId === asset.ownerId) {
    return signedUrl(asset, 'self')
  }

  // 教练：绑定 + 未撤权 + 范围
  try {
    return bindingService.requestMediaAccess(state, {
      assetId: asset.id,
      subjectId: asset.ownerId,
      viewerId: actor.userId,
      purpose: purpose === 'raw_photo' || purpose === 'posture_input' ? 'raw_photo' : purpose
    })
  } catch (e) {
    throw e
  }
}

function signedUrl(asset, tag) {
  const exp = time.nowMs() + config.media.accessTtlSec * 1000
  return {
    url:
      asset.dataUrl ||
      'https://mock.signed.local/' + asset.id + '?' + tag + '&exp=' + exp,
    expires_in: config.media.accessTtlSec,
    watermarked: !!asset.watermarked,
    watermark_text: asset.watermarkText || null,
    is_demo: !!asset.isDemo,
    has_inline_preview: !!asset.dataUrl
  }
}

/**
 * AC32：删除后立即禁止新读取；清理任务可查状态
 */
function deleteMedia(state, actor, mediaId) {
  const media = ensureMedia(state)
  const asset = getAsset(state, mediaId)
  if (asset.ownerId !== actor.userId) {
    throw new AppError('FORBIDDEN', '仅所有者可删除')
  }
  if (asset.deletedAt) {
    const existing = media.cleanupTasks.find((t) => t.mediaId === mediaId)
    return {
      media_id: mediaId,
      deleted: true,
      cleanup_task: existing ? presentCleanup(existing) : null
    }
  }

  asset.deletedAt = time.nowMs()
  asset.status = 'deleted'
  asset.updatedAt = time.nowMs()

  // 级联标记派生结果
  media.assets.forEach((a) => {
    if (a.derivedFrom === mediaId && !a.deletedAt) {
      a.deletedAt = time.nowMs()
      a.status = 'deleted'
      a.updatedAt = time.nowMs()
    }
  })

  const task = {
    id: makeId('mclean'),
    mediaId,
    status: 'queued',
    createdAt: time.nowMs(),
    updatedAt: time.nowMs(),
    completedAt: null
  }
  media.cleanupTasks.push(task)
  // 演示存储：立即完成清理
  task.status = 'completed'
  task.completedAt = time.nowMs()
  task.updatedAt = time.nowMs()

  return {
    media_id: mediaId,
    deleted: true,
    cleanup_task: presentCleanup(task)
  }
}

function getCleanupTask(state, taskId) {
  const media = ensureMedia(state)
  const task = media.cleanupTasks.find((t) => t.id === taskId)
  if (!task) throw new AppError('NOT_FOUND', '清理任务不存在')
  return presentCleanup(task)
}

function presentCleanup(t) {
  return {
    cleanup_task_id: t.id,
    media_id: t.mediaId,
    status: t.status,
    created_at: t.createdAt,
    completed_at: t.completedAt
  }
}

function presentAsset(a) {
  return {
    media_id: a.id,
    owner_id: a.ownerId,
    purpose: a.purpose,
    mime: a.mime,
    size: a.size,
    status: a.status,
    deleted: !!a.deletedAt,
    quality: a.quality,
    watermarked: !!a.watermarked,
    watermark_text: a.watermarkText,
    is_demo: !!a.isDemo,
    derived_from: a.derivedFrom,
    created_at: a.createdAt,
    completed_at: a.completedAt
  }
}

/**
 * 导出目标图：水印写入像素层标记（AC29）
 */
function markExportWatermark(state, mediaId) {
  const asset = getAsset(state, mediaId)
  if (asset.deletedAt) throw new AppError('MEDIA_DELETED', '媒体已删除', { status: 410 })
  asset.watermarked = true
  asset.watermarkText = config.media.watermarkText
  asset.updatedAt = time.nowMs()
  return {
    media_id: asset.id,
    watermarked: true,
    watermark_text: asset.watermarkText,
    share_scope_reminder: '分享前请再次确认接收人与用途范围'
  }
}

module.exports = {
  createUploadIntent,
  completeUpload,
  getAccess,
  deleteMedia,
  getCleanupTask,
  getAsset,
  evaluatePostureInputQuality,
  presentAsset,
  markExportWatermark,
  ensureMedia
}
