const crypto = require('crypto')
const time = require('./lib/time')
const config = require('./config')
const { makeId } = require('./lib/ids')
const entitlementService = require('./services/entitlementService')
const exerciseService = require('./services/exerciseService')

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function seed(store) {
  const state = store.state
  if (state.seeded) return

  const users = [
    {
      userId: 'u_stu_001',
      displayName: '陈佳宁',
      wechatSubject: 'mock_openid_stu_001',
      status: 'active',
      coachProfile: null,
      createdAt: time.nowMs()
    },
    {
      userId: 'u_stu_002',
      displayName: '周子墨',
      wechatSubject: 'mock_openid_stu_002',
      status: 'active',
      coachProfile: null,
      createdAt: time.nowMs()
    },
    {
      userId: 'u_coach_001',
      displayName: '林野',
      wechatSubject: 'mock_openid_coach_001',
      status: 'active',
      coachProfile: {
        coachId: 'coach_001',
        intro: '力量进阶 · 私教工作室',
        approvalStatus: 'approved'
      },
      createdAt: time.nowMs()
    },
    {
      userId: 'u_coach_002',
      displayName: '顾清',
      wechatSubject: 'mock_openid_coach_002',
      status: 'active',
      coachProfile: {
        coachId: 'coach_002',
        intro: '体态与灵活性',
        approvalStatus: 'approved'
      },
      createdAt: time.nowMs()
    },
    {
      userId: 'u_ops_001',
      displayName: '平台运营',
      wechatSubject: 'mock_openid_ops_001',
      status: 'active',
      coachProfile: null,
      createdAt: time.nowMs()
    }
  ]
  state.users = users
  state.userRoles = [
    { userId: 'u_stu_001', role: 'student', status: 'active', grantedBy: 'system' },
    { userId: 'u_stu_002', role: 'student', status: 'active', grantedBy: 'system' },
    { userId: 'u_coach_001', role: 'student', status: 'active', grantedBy: 'system' },
    { userId: 'u_coach_001', role: 'coach', status: 'active', grantedBy: 'system' },
    { userId: 'u_coach_002', role: 'student', status: 'active', grantedBy: 'system' },
    { userId: 'u_coach_002', role: 'coach', status: 'active', grantedBy: 'system' },
    { userId: 'u_ops_001', role: 'ops', status: 'active', grantedBy: 'system' }
  ]

  // 试用权益（非付款成功）
  ;['u_stu_001', 'u_stu_002', 'u_coach_001', 'u_coach_002'].forEach((uid) => {
    entitlementService.seedTrialForUser(state, uid)
  })

  // 演示邀请码 LINYE7D
  const inviteToken = 'LINYE7D'
  state.invitations = [
    {
      id: makeId('inv'),
      tokenHash: hashToken(inviteToken),
      tokenPlainDemo: inviteToken,
      coachUserId: 'u_coach_001',
      coachId: 'coach_001',
      coachName: '林野',
      expiresAt: time.nowMs() + 30 * 24 * 3600 * 1000,
      usedAt: null,
      revokedAt: null,
      createdAt: time.nowMs()
    }
  ]

  // 默认排班
  ;['coach_001', 'coach_002'].forEach((coachId) => {
    const rules = []
    ;[1, 2, 3, 4, 5].forEach((wd) => {
      rules.push(makeRule(coachId, wd, '09:00', '12:00'))
      rules.push(makeRule(coachId, wd, '14:00', '20:00'))
    })
    rules.push(makeRule(coachId, 6, '10:00', '16:00'))
    state.schedule.rulesByCoach[coachId] = { baseRevision: 1, rules }
  })

  exerciseService.seedExerciseCatalog(state)

  state.seeded = true
  store.persist()
}

function makeRule(coachId, weekday, startLocal, endLocal) {
  return {
    id: makeId('rule'),
    coachId,
    weekday,
    startLocal,
    endLocal,
    durationMin: config.schedule.defaultDurationMin,
    bufferMin: config.schedule.defaultBufferMin,
    location: '私教工作室',
    courseTypeId: 'private_strength_60',
    effectiveFrom: null,
    effectiveTo: null
  }
}

module.exports = { seed, hashToken }
