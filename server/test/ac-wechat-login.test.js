const { describe, it, before, after, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { createTestApp } = require('./helpers')
const wechatAuth = require('../src/services/wechatAuth')

describe('WeChat login (API01)', () => {
  let ctx
  const prevAppId = process.env.WECHAT_APPID
  const prevSecret = process.env.WECHAT_APPSECRET

  before(async () => {
    ctx = createTestApp()
  })

  after(async () => {
    wechatAuth.setCode2SessionImpl(null)
    if (prevAppId === undefined) delete process.env.WECHAT_APPID
    else process.env.WECHAT_APPID = prevAppId
    if (prevSecret === undefined) delete process.env.WECHAT_APPSECRET
    else process.env.WECHAT_APPSECRET = prevSecret
    await ctx.cleanup()
  })

  afterEach(() => {
    wechatAuth.setCode2SessionImpl(null)
  })

  it('演示 accountKey 仍可登录', async () => {
    const data = await ctx.login('student_only')
    assert.equal(data.user.userId, 'u_stu_001')
    assert.ok(data.sessionToken)
    assert.ok(data.grantedRoles.includes('student'))
  })

  it('仅 code 且未配置 → WECHAT_LOGIN_NOT_CONFIGURED', async () => {
    delete process.env.WECHAT_APPID
    delete process.env.WECHAT_APPSECRET
    const res = await ctx.request('POST', '/api/v1/auth/wechat-session', {
      body: { code: 'fake_wx_code' }
    })
    assert.equal(res.status, 503)
    assert.equal(res.body.error.code, 'WECHAT_LOGIN_NOT_CONFIGURED')
  })

  it('wechat-status 反映配置', async () => {
    delete process.env.WECHAT_APPID
    delete process.env.WECHAT_APPSECRET
    let res = await ctx.request('GET', '/api/v1/auth/wechat-status')
    assert.equal(res.status, 200)
    assert.equal(res.body.data.configured, false)

    process.env.WECHAT_APPID = 'wx_test'
    process.env.WECHAT_APPSECRET = 'secret_test'
    res = await ctx.request('GET', '/api/v1/auth/wechat-status')
    assert.equal(res.body.data.configured, true)
    assert.equal(res.body.data.appid_set, true)
  })

  it('code + mock jscode2session → 注册学员并二次登录同 userId', async () => {
    process.env.WECHAT_APPID = 'wx_test'
    process.env.WECHAT_APPSECRET = 'secret_test'
    wechatAuth.setCode2SessionImpl(async (code) => {
      assert.equal(code, 'code_abc')
      return { openid: 'oid_real_user_1', unionid: 'uid_1' }
    })

    const first = await ctx.request('POST', '/api/v1/auth/wechat-session', {
      body: { code: 'code_abc' }
    })
    assert.equal(first.status, 200)
    const u1 = first.body.data.user
    assert.equal(u1.wechatSubject, 'oid_real_user_1')
    assert.equal(u1.displayName, '微信用户')
    assert.deepEqual(first.body.data.grantedRoles, ['student'])
    assert.ok(!first.body.data.mockAccountKey)

    const second = await ctx.request('POST', '/api/v1/auth/wechat-session', {
      body: { code: 'code_abc' }
    })
    assert.equal(second.status, 200)
    assert.equal(second.body.data.user.userId, u1.userId)
  })

  it('新微信用户不能 claim 教练（AC01）', async () => {
    process.env.WECHAT_APPID = 'wx_test'
    process.env.WECHAT_APPSECRET = 'secret_test'
    wechatAuth.setCode2SessionImpl(async () => ({
      openid: 'oid_claim_coach'
    }))
    const res = await ctx.request('POST', '/api/v1/auth/wechat-session', {
      body: { code: 'any', claimRole: 'coach' }
    })
    assert.equal(res.status, 403)
    assert.equal(res.body.error.code, 'ROLE_NOT_GRANTED')
  })
})
