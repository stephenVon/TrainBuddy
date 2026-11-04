/**
 * OpenAI 兼容 Chat Completions 客户端
 * - 强制 JSON 输出
 * - 解析失败可重试 1 次
 * - 日志脱敏：不打印 api_key、不打印完整图片 base64
 */

const { loadLlmConfig } = require('./config')
const { validate } = require('./validate')
const { AppError } = require('../../lib/errors')

let injectedFetch = null
let injectedConfig = null

function _setFetchForTest(fn) {
  injectedFetch = fn
}
function _setConfigForTest(cfg) {
  injectedConfig = cfg
}
function _resetTestHooks() {
  injectedFetch = null
  injectedConfig = null
}

function getConfig() {
  return injectedConfig || loadLlmConfig()
}

/**
 * 将供应商限流／错模等转成可读中文；RPM 不立即重试（会加重限流）
 */
function friendlyLlmHttpError(rawMsg, status, model) {
  const msg = String(rawMsg || '')
  const lower = msg.toLowerCase()
  const modelHint = model || ''
  if (
    lower.indexOf('rpm') >= 0 ||
    lower.indexOf('rate limit') >= 0 ||
    lower.indexOf('requests per minute') >= 0 ||
    status === 429
  ) {
    let tip =
      '豆包调用过于频繁（每分钟次数上限），请稍等约 1 分钟再试。'
    if (/seedream/i.test(msg) || /seedream/i.test(modelHint)) {
      tip +=
        '另外：当前接入点绑定的是文生图模型 Seedream，不能用于饮食识图；请在火山方舟新建「视觉理解／多模态」接入点（如 doubao-1.5-vision-pro），把 DOUBAO_MODEL 改成新的 ep-… 后重启 API。'
    }
    return {
      code: 'LLM_RATE_LIMITED',
      message: tip,
      retryable: true,
      rateLimited: true
    }
  }
  if (/seedream/i.test(msg) || /seedream/i.test(modelHint)) {
    return {
      code: 'LLM_WRONG_MODEL',
      message:
        '当前豆包接入点是文生图 Seedream，不适合拍照识饮食。请改用视觉理解模型接入点，并更新 DOUBAO_MODEL。',
      retryable: false,
      rateLimited: false
    }
  }
  if (
    lower.indexOf('only support text') >= 0 ||
    lower.indexOf('only supports text') >= 0 ||
    lower.indexOf('text messages') >= 0
  ) {
    return {
      code: 'LLM_WRONG_MODEL',
      message:
        '当前推理接入点只支持纯文本，不能看图。请在火山方舟新建「视觉理解／多模态」接入点（名称含 vision／视觉），把 DOUBAO_MODEL 换成新的 ep-… 后重启 API。',
      retryable: false,
      rateLimited: false
    }
  }
  return {
    code: 'LLM_HTTP_ERROR',
    message: msg.slice(0, 240),
    retryable: status >= 500,
    rateLimited: false
  }
}

function redactMessages(messages) {
  return (messages || []).map((m) => {
    if (!m || typeof m.content === 'string') {
      const text = String((m && m.content) || '')
      return {
        role: m && m.role,
        content_preview: text.slice(0, 120) + (text.length > 120 ? '…' : '')
      }
    }
    if (Array.isArray(m.content)) {
      return {
        role: m.role,
        content: m.content.map((part) => {
          if (part && part.type === 'image_url') return { type: 'image_url', omitted: true }
          if (part && part.type === 'text') {
            const t = String(part.text || '')
            return { type: 'text', preview: t.slice(0, 80) }
          }
          return { type: part && part.type }
        })
      }
    }
    return { role: m && m.role }
  })
}

function extractJsonText(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch (_) {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fence) {
      try {
        return JSON.parse(fence[1].trim())
      } catch (__) {
        /* continue */
      }
    }
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1))
      } catch (___) {
        return null
      }
    }
    return null
  }
}

/**
 * @param {{ messages: array, schema?: object, model?: string, temperature?: number, timeoutMs?: number }} opts
 */
async function chatJson(opts) {
  const cfg = getConfig()
  const apiKey = opts.apiKey || cfg.apiKey
  const baseUrl = (opts.baseUrl || cfg.baseUrl || '').replace(/\/$/, '')
  if (!apiKey || !baseUrl) {
    throw new AppError('PROVIDER_NOT_CONFIGURED', '大模型未配置 API Key', {
      retryable: false,
      status: 503
    })
  }

  const model = opts.model || cfg.model
  const timeoutMs = opts.timeoutMs || cfg.timeoutMs
  const schema = opts.schema || null
  const fetchFn = injectedFetch || globalThis.fetch
  if (!fetchFn) {
    throw new AppError('PROVIDER_NOT_CONFIGURED', '当前运行时不支持 fetch', {
      retryable: false,
      status: 503
    })
  }

  const body = {
    model,
    temperature: opts.temperature != null ? opts.temperature : 0.2,
    response_format: { type: 'json_object' },
    messages: opts.messages
  }

  let lastError = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer =
      controller &&
      setTimeout(() => {
        try {
          controller.abort()
        } catch (_) {}
      }, timeoutMs)

    try {
      const res = await fetchFn(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey
        },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined
      })
      if (timer) clearTimeout(timer)

      const text = await res.text()
      let payload
      try {
        payload = JSON.parse(text)
      } catch (_) {
        throw new AppError('LLM_BAD_RESPONSE', '大模型返回非 JSON 包体', {
          retryable: true,
          status: 502
        })
      }

      if (!res.ok) {
        const rawMsg =
          (payload.error && (payload.error.message || payload.error.code)) ||
          '大模型请求失败 HTTP ' + res.status
        const friendly = friendlyLlmHttpError(String(rawMsg), res.status, model)
        const retryable =
          friendly.retryable &&
          (res.status >= 500 || res.status === 429) &&
          !friendly.rateLimited
        throw new AppError(friendly.code, friendly.message, {
          retryable,
          status: res.status === 429 ? 429 : 502
        })
      }

      const content =
        payload.choices &&
        payload.choices[0] &&
        payload.choices[0].message &&
        payload.choices[0].message.content
      const parsed = extractJsonText(content)
      if (!parsed) {
        lastError = new AppError('LLM_JSON_PARSE', '无法解析模型 JSON 输出', {
          retryable: true,
          status: 502
        })
        // 追加纠错轮
        body.messages = body.messages.concat([
          {
            role: 'user',
            content: '上一次输出不是合法 JSON。请只输出符合约定的 JSON 对象，不要 Markdown。'
          }
        ])
        continue
      }

      let data = parsed
      if (typeof opts.coerce === 'function') {
        try {
          data = opts.coerce(data) || data
        } catch (_) {
          /* 纠偏失败则仍用原始解析结果做 schema 校验 */
        }
      }

      if (schema) {
        const v = validate(data, schema)
        if (!v.ok) {
          lastError = new AppError(
            'LLM_SCHEMA_INVALID',
            '模型输出不符合 schema: ' + v.errors.slice(0, 3).join('; '),
            { retryable: true, status: 502 }
          )
          body.messages = body.messages.concat([
            {
              role: 'user',
              content:
                '输出未通过字段校验：' +
                v.errors.slice(0, 5).join('; ') +
                '。请按 schema 重新只输出 JSON。'
            }
          ])
          continue
        }
      }

      return {
        data,
        model,
        usage: payload.usage || null,
        attempt: attempt + 1
      }
    } catch (e) {
      if (timer) clearTimeout(timer)
      if (e && e.code) {
        lastError = e
        if (!e.retryable) throw e
        continue
      }
      if (e && e.name === 'AbortError') {
        lastError = new AppError('LLM_TIMEOUT', '大模型请求超时', {
          retryable: true,
          status: 504
        })
        continue
      }
      lastError = new AppError('LLM_NETWORK', (e && e.message) || '大模型网络错误', {
        retryable: true,
        status: 502
      })
    }
  }

  if (typeof console !== 'undefined' && console.warn) {
    console.warn('[llm] chatJson failed', {
      model,
      messages: redactMessages(opts.messages),
      code: lastError && lastError.code
    })
  }
  throw lastError || new AppError('LLM_FAILED', '大模型调用失败', { retryable: true, status: 502 })
}

module.exports = {
  chatJson,
  extractJsonText,
  redactMessages,
  _setFetchForTest,
  _setConfigForTest,
  _resetTestHooks
}
