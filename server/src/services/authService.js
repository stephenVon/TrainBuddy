const config = require('../config')
const time = require('../lib/time')
const { makeId } = require('../lib/ids')
const { AppError } = require('../lib/errors')
const { getPrimaryBinding } = require('../lib/permission')
const entitlementService = require('./entitlementService')
const wechatAuth = require('./wechatAuth')

const ACCOUNT_MAP = {
  student_only: 'u_stu_001',
  coach_approved: 'u_coach_001',
  student_claim_coach: 'u_stu_002',
  coach_b: 'u_coach_002',
  ops_admin: 'u_ops_001'
}

function createSession(state, userId) {
  const token = 'sess_' + makeId('tok')
  state.sessions[token] = {
    userId,
    createdAt: time.nowMs(),
    expiresAt: time.nowMs() + config.sessionTtlMs
  }
  return token
}

function rolesOf(state, userId) {
  return state.userRoles
    .filter((r) => r.userId === userId && r.status === 'active')
    .map((r) => r.role)
}

function presentUser(state, user) {
  return {
    userId: user.userId,
    displayName: user.displayName,
    wechatSubject: user.wechatSubject,
    coachProfile: user.coachProfile
  }
}

function assertClaimRole(grantedRoles, claimRole) {
  if (claimRole && grantedRoles.indexOf(claimRole) === -1) {
    throw new AppError('ROLE_NOT_GRANTED', '无法获取该角色权限，请联系平台审核', {
      extra: { grantedRoles }
    })
  }
}

function finishLogin(state, user, { claimRole, mockAccountKey }) {
  const grantedRoles = rolesOf(state, user.userId)
  assertClaimRole(grantedRoles, claimRole)
  const sessionToken = createSession(state, user.userId)
  const out = {
    sessionToken,
    user: presentUser(state, user),
    grantedRoles
  }
  if (mockAccountKey) out.mockAccountKey = mockAccountKey
  return out
}

/** 演示账号：accountKey → 固定 userId */
function mockAccountSession(state, accountKey, claimRole) {
  const userId = ACCOUNT_MAP[accountKey]
  if (!userId) throw new AppError('USER_NOT_FOUND', '账号不存在')
  const user = state.users.find((u) => u.userId === userId)
  if (!user) throw new AppError('USER_NOT_FOUND', '账号不存在')
  return finishLogin(state, user, { claimRole, mockAccountKey: accountKey })
}

function findByOpenid(state, openid) {
  return state.users.find((u) => u.wechatSubject === openid)
}

function registerWechatUser(state, { openid, unionid }) {
  const user = {
    userId: makeId('u'),
    displayName: '微信用户',
    wechatSubject: openid,
    unionId: unionid || null,
    status: 'active',
    coachProfile: null,
    createdAt: time.nowMs()
  }
  state.users.push(user)
  state.userRoles.push({
    userId: user.userId,
    role: 'student',
    status: 'active',
    grantedBy: 'wechat_login'
  })
  entitlementService.seedTrialForUser(state, user.userId)
  return user
}

/**
 * API01：微信登录 / 演示账号
 * - 有 accountKey → 演示映射（本地/AC 测例）
 * - 仅有 code → jscode2session，按 openid 登录或注册（默认仅 student）
 */
async function wechatSession(state, body = {}) {
  const accountKey = body.accountKey ? String(body.accountKey).trim() : ''
  const code = body.code ? String(body.code).trim() : ''
  const claimRole = body.claimRole || undefined

  if (accountKey) {
    return mockAccountSession(state, accountKey, claimRole)
  }

  if (!code) {
    throw new AppError('VALIDATION', '请提供微信 code 或演示 accountKey')
  }

  const { openid, unionid } = await wechatAuth.code2session(code)
  // session_key 仅服务端可用，不下发
  let user = findByOpenid(state, openid)
  if (!user) {
    user = registerWechatUser(state, { openid, unionid })
  } else if (unionid && !user.unionId) {
    user.unionId = unionid
  }

  return finishLogin(state, user, { claimRole })
}

/** API02 GET /me */
function getMe(state, actor) {
  const user = state.users.find((u) => u.userId === actor.userId)
  const binding = getPrimaryBinding(state, actor.userId)
  return {
    user: presentUser(state, user),
    grantedRoles: actor.grantedRoles,
    primaryBinding: binding
      ? {
          id: binding.id,
          coachUserId: binding.coachUserId,
          coachId: binding.coachId,
          coachName: binding.coachName,
          studentId: binding.studentId,
          status: binding.status,
          scopes: binding.scopes,
          boundAt: binding.boundAt,
          isPrimary: binding.isPrimary
        }
      : null
  }
}

function patchMe(state, actor, patch) {
  const user = state.users.find((u) => u.userId === actor.userId)
  if (patch.displayName) user.displayName = String(patch.displayName).slice(0, 32)
  return getMe(state, actor)
}

function applyCoachRole(state, actor) {
  // 只提交申请，不立即授予（AC01）
  return {
    status: 'pending_review',
    message: '已提交教练申请，审核通过前无法使用教练工作台'
  }
}

module.exports = {
  ACCOUNT_MAP,
  wechatSession,
  getMe,
  patchMe,
  applyCoachRole,
  rolesOf,
  presentUser,
  createSession
}
