/**
 * 微信小程序登录：jscode2session
 * 密钥：WECHAT_APPID + WECHAT_APPSECRET（仅服务端）
 */

const { AppError } = require('../lib/errors')

/** 测试可注入；生产勿设置 */
let exchangeImpl = null

function setCode2SessionImpl(fn) {
  exchangeImpl = typeof fn === 'function' ? fn : null
}

function isConfigured() {
  return !!(
    process.env.WECHAT_APPID &&
    String(process.env.WECHAT_APPID).trim() &&
    process.env.WECHAT_APPSECRET &&
    String(process.env.WECHAT_APPSECRET).trim()
  )
}

/**
 * @returns {Promise<{ openid: string, sessionKey?: string, unionid?: string }>}
 */
async function code2session(jsCode) {
  if (!jsCode || !String(jsCode).trim()) {
    throw new AppError('VALIDATION', '缺少微信登录 code')
  }
  if (!isConfigured()) {
    throw new AppError(
      'WECHAT_LOGIN_NOT_CONFIGURED',
      '微信登录未配置：请设置 WECHAT_APPID 与 WECHAT_APPSECRET',
      { status: 503 }
    )
  }

  if (exchangeImpl) {
    return exchangeImpl(String(jsCode).trim())
  }

  const appid = String(process.env.WECHAT_APPID).trim()
  const secret = String(process.env.WECHAT_APPSECRET).trim()
  const url =
    'https://api.weixin.qq.com/sns/jscode2session' +
    '?appid=' +
    encodeURIComponent(appid) +
    '&secret=' +
    encodeURIComponent(secret) +
    '&js_code=' +
    encodeURIComponent(String(jsCode).trim()) +
    '&grant_type=authorization_code'

  let raw
  try {
    const res = await fetch(url)
    raw = await res.json()
  } catch (e) {
    throw new AppError('WECHAT_LOGIN_FAILED', '微信登录服务暂时不可用', {
      retryable: true,
      status: 502,
      extra: { detail: e.message }
    })
  }

  if (raw.errcode) {
    // 常见：40029 invalid code / 40163 code been used / 45011 frequency
    const retryable = raw.errcode === 45011 || raw.errcode === -1
    throw new AppError(
      'WECHAT_LOGIN_FAILED',
      '微信登录失败：' + (raw.errmsg || raw.errcode),
      {
        retryable,
        status: 401,
        extra: { errcode: raw.errcode, errmsg: raw.errmsg }
      }
    )
  }

  if (!raw.openid) {
    throw new AppError('WECHAT_LOGIN_FAILED', '微信未返回 openid', {
      status: 502
    })
  }

  return {
    openid: raw.openid,
    sessionKey: raw.session_key || null,
    unionid: raw.unionid || null
  }
}

module.exports = {
  isConfigured,
  code2session,
  setCode2SessionImpl
}
