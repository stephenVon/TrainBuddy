const mock = require('./mock')
const wechat = require('./wechat')
const qwen = require('./qwen')

const REGISTRY = {
  mock,
  wechat,
  qwen
}

function getAdapter(name) {
  const key = (name || process.env.VOICE_ASR_PROVIDER || 'mock').toLowerCase()
  const adapter = REGISTRY[key]
  if (!adapter) {
    const err = new Error('未知转写适配器: ' + key)
    err.code = 'ASR_UNKNOWN_PROVIDER'
    throw err
  }
  return adapter
}

function qwenConfigured() {
  return !!(process.env.QWEN_ASR_API_KEY || process.env.DASHSCOPE_API_KEY)
}

function listProviders() {
  return Object.keys(REGISTRY).map((k) => ({
    id: k,
    configured:
      k === 'mock' ||
      (k === 'wechat' && !!process.env.WECHAT_ASR_ENDPOINT) ||
      (k === 'qwen' && qwenConfigured())
  }))
}

module.exports = { getAdapter, listProviders, REGISTRY }
