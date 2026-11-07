/**
 * 运营角色：账号、教练审核、权益、任务元数据、通知
 */
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { createTestApp } = require('./helpers')

describe('ops admin', () => {
  let ctx
  let ops
  let stu
  let applicant

  before(async () => {
    ctx = createTestApp()
    ops = await ctx.login('ops_admin')
    stu = await ctx.login('student_only')
    applicant = await ctx.login('student_claim_coach')
  })

  after(async () => {
    await ctx.cleanup()
  })

  it('serves the ops console at /ops and /ops/', async () => {
    const plain = await ctx.request('GET', '/ops')
    const slash = await ctx.request('GET', '/ops/')
    assert.equal(plain.status, 200)
    assert.equal(slash.status, 200)
    assert.match(String(plain.body), /账号/)
    assert.match(String(slash.body), /教练审核/)
  })

  it('rejects a student reading accounts and claiming the ops role', async () => {
    const denied = await ctx.request('GET', '/api/v1/admin/accounts', { token: stu.sessionToken })
    assert.equal(denied.status, 403)
    const claim = await ctx.request('POST', '/api/v1/auth/wechat-session', {
      body: { accountKey: 'student_only', claimRole: 'ops' }
    })
    assert.equal(claim.status, 403)
    assert.equal(claim.body.error.code, 'ROLE_NOT_GRANTED')
  })

  it('lists accounts without identity secrets', async () => {
    const res = await ctx.request('GET', '/api/v1/admin/accounts', { token: ops.sessionToken })
    assert.equal(res.status, 200)
    const raw = JSON.stringify(res.body.data)
    assert.equal(raw.includes('wechatSubject'), false)
    assert.equal(raw.includes('session'), false)
    const row = res.body.data.find((item) => item.user_id === 'u_ops_001')
    assert.ok(row)
    assert.deepEqual(row.roles, ['ops'])
  })

  it('refuses to disable the acting operator', async () => {
    const res = await ctx.request('POST', '/api/v1/admin/accounts/disable', {
      token: ops.sessionToken,
      body: { user_id: ops.user.userId, ticket_id: 'TKT-SELF', reason: '误操作' }
    })
    assert.equal(res.status, 403)
    const accounts = await ctx.request('GET', '/api/v1/admin/accounts', { token: ops.sessionToken })
    const row = accounts.body.data.find((item) => item.user_id === ops.user.userId)
    assert.equal(row.status, 'active')
  })

  it('keeps a coach application pending until an operator approves it', async () => {
    const userId = applicant.user.userId
    const applied = await ctx.request('POST', '/api/v1/auth/apply-coach', { token: applicant.sessionToken })
    assert.equal(applied.status, 200)
    assert.equal(applied.body.data.status, 'pending_review')

    const pending = await ctx.request('GET', '/api/v1/admin/coach-applications?status=pending', {
      token: ops.sessionToken
    })
    assert.ok(pending.body.data.some((row) => row.user_id === userId))

    const meBefore = await ctx.request('GET', '/api/v1/me', { token: applicant.sessionToken })
    assert.equal(meBefore.body.data.grantedRoles.includes('coach'), false)

    const rejected = await ctx.request('POST', '/api/v1/admin/coach-reviews', {
      token: ops.sessionToken,
      body: { user_id: userId, decision: 'reject', ticket_id: 'TKT-COACH-R', reason: '资料不足' }
    })
    assert.equal(rejected.status, 200)
    const meRejected = await ctx.request('GET', '/api/v1/me', { token: applicant.sessionToken })
    assert.equal(meRejected.body.data.grantedRoles.includes('coach'), false)

    await ctx.request('POST', '/api/v1/auth/apply-coach', { token: applicant.sessionToken })
    const approved = await ctx.request('POST', '/api/v1/admin/coach-reviews', {
      token: ops.sessionToken,
      body: { user_id: userId, decision: 'approve', ticket_id: 'TKT-COACH-A', reason: '资料齐全' }
    })
    assert.equal(approved.body.data.approval_status, 'approved')
    const meApproved = await ctx.request('GET', '/api/v1/me', { token: applicant.sessionToken })
    assert.equal(meApproved.body.data.grantedRoles.includes('coach'), true)
  })

  it('returns entitlement balances and notification text for a chosen user', async () => {
    const rights = await ctx.request('GET', '/api/v1/admin/entitlements?user_id=u_stu_001', {
      token: ops.sessionToken
    })
    assert.equal(rights.status, 200)
    assert.ok(Array.isArray(rights.body.data.features))

    const note = await ctx.request('POST', '/api/v1/notifications/demo', {
      token: stu.sessionToken,
      body: { title: '课前提醒', body: '明天 10:00' }
    })
    assert.equal(note.status, 200)
    const list = await ctx.request('GET', '/api/v1/admin/notifications?user_id=u_stu_001', {
      token: ops.sessionToken
    })
    assert.equal(list.status, 200)
    assert.ok(list.body.data.some((row) => row.title === '课前提醒'))
  })

  it('lists AI task metadata without result bodies', async () => {
    if (!ctx.store.state.ai) ctx.store.state.ai = { tasks: [] }
    ctx.store.state.ai.tasks.push({
      id: 'task_ops_meta',
      type: 'posture_scan',
      mode: 'demo',
      status: 'succeeded',
      ownerId: 'u_stu_001',
      error: null,
      resultRef: { kind: 'posture_report', report_id: 'secret_report' },
      createdAt: 2,
      updatedAt: 2
    })
    const res = await ctx.request('GET', '/api/v1/admin/ai-tasks', { token: ops.sessionToken })
    assert.equal(res.status, 200)
    const raw = JSON.stringify(res.body.data)
    assert.equal(raw.includes('secret_report'), false)
    assert.equal(raw.includes('"result"'), false)
    const row = res.body.data.find((item) => item.task_id === 'task_ops_meta')
    assert.equal(row.status, 'succeeded')
    assert.equal(row.owner_id, 'u_stu_001')
  })

  it('blocks login after disable and restores it after enable', async () => {
    const disabled = await ctx.request('POST', '/api/v1/admin/accounts/disable', {
      token: ops.sessionToken,
      body: { user_id: 'u_stu_001', ticket_id: 'TKT-OFF', reason: '暂停使用' }
    })
    assert.equal(disabled.status, 200)
    const blocked = await ctx.request('POST', '/api/v1/auth/wechat-session', {
      body: { accountKey: 'student_only' }
    })
    assert.equal(blocked.status, 401)

    const enabled = await ctx.request('POST', '/api/v1/admin/accounts/enable', {
      token: ops.sessionToken,
      body: { user_id: 'u_stu_001', ticket_id: 'TKT-ON', reason: '恢复使用' }
    })
    assert.equal(enabled.status, 200)
    const again = await ctx.login('student_only')
    assert.ok(again.sessionToken)
  })
})
