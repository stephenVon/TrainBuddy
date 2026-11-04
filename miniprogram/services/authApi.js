/**
 * API01 / API02 — 登录与资料（远程）
 */
const http = require('../utils/http')

function wechatLogin(code) {
  return http.post('/auth/wechat-session', { code }).then((res) => res.data)
}

function wechatStatus() {
  return http.get('/auth/wechat-status').then((res) => res.data)
}

/**
 * 演示登录：accountKey 代替微信 code（服务端校验角色，AC01）
 */
function mockLogin(payload) {
  return http
    .post('/auth/wechat-session', {
      accountKey: (payload && payload.accountKey) || 'student_only',
      claimRole: payload && payload.claimRole,
      code: payload && payload.accountKey
    })
    .then((res) => res.data)
}

function applyCoachRole() {
  return http.post('/auth/apply-coach', {}).then((res) => res.data)
}

function getMe() {
  return http.get('/me').then((res) => res.data)
}

function patchMe(patch) {
  return http.patch('/me', patch).then((res) => res.data)
}

module.exports = {
  wechatLogin,
  wechatStatus,
  mockLogin,
  applyCoachRole,
  getMe,
  patchMe
}
