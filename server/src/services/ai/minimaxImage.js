/**
 * MiniMax 图生图（image-01）：人物参考 + 提示词 → 目标预览图
 * POST {MINIMAX_BASE_URL}/image_generation
 */

const { AppError } = require('../../lib/errors')
const { providerDefs } = require('../llm/config')

function toDataUrl(base64, mime) {
  if (!base64) return null
  const raw = String(base64).replace(/^data:[^;]+;base64,/, '')
  if (!raw) return null
  return 'data:' + (mime || 'image/jpeg') + ';base64,' + raw
}

function isConfigured() {
  const p = providerDefs().minimax
  return !!(p.apiKey && p.baseUrl)
}

/**
 * @param {{ prompt: string, referenceImageBase64?: string, referenceImageUrl?: string, mime?: string, aspectRatio?: string }} opts
 */
async function generateGoalImage(opts = {}) {
  const defs = providerDefs()
  const apiKey = defs.minimax.apiKey
  const baseUrl = (defs.minimax.baseUrl || '').replace(/\/$/, '')
  if (!apiKey || !baseUrl) {
    throw new AppError('PROVIDER_NOT_CONFIGURED', 'MiniMax 未配置，无法生成目标图', {
      retryable: false,
      status: 503
    })
  }

  const model = process.env.MINIMAX_IMAGE_MODEL || 'image-01'
  const prompt = String(opts.prompt || '').trim()
  if (!prompt) {
    throw new AppError('VALIDATION', '缺少目标图提示词')
  }

  const refDataUrl = toDataUrl(opts.referenceImageBase64, opts.mime)
  const refUrl = opts.referenceImageUrl && !/mock\.(signed|upload)\.local/i.test(opts.referenceImageUrl)
    ? opts.referenceImageUrl
    : null
  const imageFile = refDataUrl || refUrl
  if (!imageFile) {
    throw new AppError('VALIDATION', '缺少本人参考照片，无法做图生图')
  }

  const body = {
    model,
    prompt: prompt.slice(0, 1500),
    aspect_ratio: opts.aspectRatio || '3:4',
    response_format: 'base64',
    n: 1,
    prompt_optimizer: false,
    subject_reference: [
      {
        type: 'character',
        image_file: imageFile
      }
    ]
  }

  const fetchFn = globalThis.fetch
  if (!fetchFn) {
    throw new AppError('PROVIDER_NOT_CONFIGURED', '当前运行时不支持 fetch', {
      retryable: false,
      status: 503
    })
  }

  const timeoutMs = Number(process.env.MINIMAX_IMAGE_TIMEOUT_MS || 120000)
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer =
    controller &&
    setTimeout(() => {
      try {
        controller.abort()
      } catch (_) {}
    }, timeoutMs)

  let res
  let text
  try {
    res = await fetchFn(baseUrl + '/image_generation', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    })
    text = await res.text()
  } catch (e) {
    if (timer) clearTimeout(timer)
    const aborted = e && (e.name === 'AbortError' || /aborted/i.test(String(e.message || '')))
    throw new AppError(
      aborted ? 'LLM_TIMEOUT' : 'LLM_NETWORK',
      aborted ? 'MiniMax 生图超时，请稍后重试' : 'MiniMax 生图网络错误',
      { retryable: true, status: 502 }
    )
  }
  if (timer) clearTimeout(timer)

  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch (_) {
    throw new AppError('LLM_JSON_PARSE', 'MiniMax 返回无法解析', {
      retryable: true,
      status: 502
    })
  }

  const baseResp = payload && payload.base_resp
  const code = baseResp && baseResp.status_code
  if (code != null && Number(code) !== 0) {
    const msg = (baseResp && baseResp.status_msg) || 'MiniMax 生图失败'
    const map = {
      1002: '触发限流，请稍后再试',
      1004: '账号鉴权失败，请检查 MiniMax API Key',
      1008: '账号余额不足',
      1026: '图片描述涉及敏感内容，请调整配置后重试',
      2013: '参数异常，请检查参考图与提示词',
      2049: '无效的 MiniMax API Key'
    }
    throw new AppError('LLM_PROVIDER_ERROR', map[Number(code)] || msg, {
      retryable: Number(code) === 1002,
      status: 502,
      extra: { minimax_status: code }
    })
  }

  if (!res.ok) {
    throw new AppError(
      'LLM_PROVIDER_ERROR',
      'MiniMax HTTP ' + res.status + (baseResp && baseResp.status_msg ? ': ' + baseResp.status_msg : ''),
      { retryable: res.status >= 500, status: 502 }
    )
  }

  const data = (payload && payload.data) || {}
  const b64List = data.image_base64 || data.imageBase64 || []
  const urlList = data.image_urls || data.imageUrls || []
  let imageBase64 = Array.isArray(b64List) && b64List[0] ? String(b64List[0]) : null
  let imageUrl = Array.isArray(urlList) && urlList[0] ? String(urlList[0]) : null

  if (imageBase64) {
    imageBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '')
  }

  if (!imageBase64 && !imageUrl) {
    throw new AppError('LLM_PROVIDER_ERROR', 'MiniMax 未返回图片数据', {
      retryable: true,
      status: 502
    })
  }

  const dataUrl = imageBase64
    ? 'data:image/jpeg;base64,' + imageBase64
    : imageUrl

  return {
    provider: 'minimax',
    model,
    image_base64: imageBase64,
    image_url: imageUrl,
    data_url: dataUrl,
    generation_id: (payload && payload.id) || null
  }
}

module.exports = {
  generateGoalImage,
  isConfigured,
  toDataUrl
}
