/**
 * 示范图来自 yuhonas/free-exercise-db（Unlicense），jsDelivr 固定 commit，避免 URL 漂移。
 * 参考实现：OpenPersonalTraining（MIT）。
 */
const IMAGE_COMMIT = 'b0eed061e1c832b3ed815fbaa4b45b3cdc14df49'
const IMAGE_BASE = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@' + IMAGE_COMMIT + '/exercises'

function exerciseImageUrl(mediaRef) {
  if (!mediaRef) return ''
  if (/^https?:\/\//i.test(mediaRef)) return mediaRef
  return IMAGE_BASE + '/' + String(mediaRef).replace(/^\//, '')
}

module.exports = { IMAGE_COMMIT, IMAGE_BASE, exerciseImageUrl }
