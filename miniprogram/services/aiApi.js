/**
 * 媒体 / AI 任务 / 体态 / 目标图 / 咨询
 */
const http = require('../utils/http')

function providers() {
  return http.get('/ai/providers').then((res) => res.data)
}

function createUploadIntent(body) {
  return http.post('/media/upload-intents', body).then((res) => res.data)
}

function completeUpload(mediaId, body) {
  return http.post('/media/' + mediaId + '/complete', body || {}).then((res) => res.data)
}

function mediaAccess(mediaId) {
  return http.get('/media/' + mediaId + '/access').then((res) => res.data)
}

function deleteMedia(mediaId) {
  return http.del('/media/' + mediaId).then((res) => res.data)
}

function exportWatermark(mediaId) {
  return http.post('/media/' + mediaId + '/export-watermark', {}).then((res) => res.data)
}

function createAiTask(body, idempotencyKey, options) {
  const opts = options || {}
  return http
    .post('/ai-tasks', body, {
      idempotencyKey: idempotencyKey || 'ai_' + Date.now(),
      timeout: opts.timeout != null ? opts.timeout : body && body.type === 'goal_image' ? 180000 : 60000
    })
    .then((res) => res.data)
}

function getAiTask(taskId) {
  return http.get('/ai-tasks/' + taskId).then((res) => res.data)
}

function listAiTasks(query) {
  return http.get('/ai-tasks', query).then((res) => res.data)
}

function retryAiTask(taskId, body, idempotencyKey) {
  return http
    .post('/ai-tasks/' + taskId + '/retry', body || {}, {
      idempotencyKey: idempotencyKey || 'retry_' + taskId + '_' + Date.now()
    })
    .then((res) => res.data)
}

function cancelAiTask(taskId, body) {
  return http.post('/ai-tasks/' + taskId + '/cancel', body || {}).then((res) => res.data)
}

function getPostureReport(reportId) {
  return http.get('/posture-reports/' + reportId).then((res) => res.data)
}

function listPostureReports(query) {
  return http.get('/posture-reports', query).then((res) => res.data)
}

function reviewPosture(reportId, body, idempotencyKey) {
  return http
    .post('/posture-reports/' + reportId + '/review', body, {
      idempotencyKey: idempotencyKey || 'rev_' + reportId
    })
    .then((res) => res.data)
}

function getGoalGroup(groupId) {
  return http.get('/goal-groups/' + groupId).then((res) => res.data)
}

function createConsultation(body, idempotencyKey) {
  return http
    .post('/consultations', body, {
      idempotencyKey: idempotencyKey || 'consult_' + Date.now()
    })
    .then((res) => res.data)
}

function listConsultations() {
  return http.get('/consultations').then((res) => res.data)
}

/**
 * 演示上传：意图 → 完成（不实际上传字节）
 */
async function demoUploadPhoto(purpose, quality) {
  const intent = await createUploadIntent({
    purpose,
    mime: 'image/jpeg',
    size: 204800,
    is_demo: true
  })
  return completeUpload(intent.media_id, { quality: quality || { person_count: 1 } })
}

function confirmNutritionTask(taskId, body, idempotencyKey) {
  return http
    .post('/nutrition-tasks/' + taskId + '/confirm', body || {}, {
      idempotencyKey: idempotencyKey || 'nutri_confirm_' + taskId
    })
    .then((res) => res.data)
}

function getNutritionSyncSettings() {
  return http.get('/nutrition-sync-settings').then((res) => res.data)
}

function setNutritionSyncSettings(body) {
  return http
    .request('PUT', '/nutrition-sync-settings', { body: body || {} })
    .then((res) => res.data)
}

module.exports = {
  providers,
  createUploadIntent,
  completeUpload,
  mediaAccess,
  deleteMedia,
  exportWatermark,
  createAiTask,
  getAiTask,
  listAiTasks,
  retryAiTask,
  cancelAiTask,
  getPostureReport,
  listPostureReports,
  reviewPosture,
  getGoalGroup,
  createConsultation,
  listConsultations,
  demoUploadPhoto,
  confirmNutritionTask,
  getNutritionSyncSettings,
  setNutritionSyncSettings
}
