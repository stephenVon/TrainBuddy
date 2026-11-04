/**
 * 阿里云百炼 Qwen ASR 适配器
 * - streaming：WebSocket（Qwen-Audio-ASR-Flash-Streaming）
 * - http：录音文件同步识别（qwen3-asr-flash / qwen-audio-3.x-asr-flash）
 *
 * 密钥：QWEN_ASR_API_KEY 或 DASHSCOPE_API_KEY
 */

const { randomUUID } = require('crypto')
const WebSocket = require('ws')

const DEFAULT_WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'
const DEFAULT_HTTP_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
const DEFAULT_STREAM_MODEL = 'qwen-audio-3.1-asr-flash-streaming'
const DEFAULT_HTTP_MODEL = 'qwen3-asr-flash'

function apiKey() {
  return (
    process.env.QWEN_ASR_API_KEY ||
    process.env.DASHSCOPE_API_KEY ||
    ''
  ).trim()
}

function resolveMode(model) {
  const forced = (process.env.QWEN_ASR_MODE || '').toLowerCase().trim()
  if (forced === 'http' || forced === 'streaming' || forced === 'ws') {
    return forced === 'ws' ? 'streaming' : forced
  }
  return /streaming|realtime/i.test(model || '') ? 'streaming' : 'http'
}

function resolveModel(mode) {
  const raw = (process.env.QWEN_ASR_MODEL || '').trim()
  if (raw) return normalizeModelName(raw)
  return mode === 'streaming' ? DEFAULT_STREAM_MODEL : DEFAULT_HTTP_MODEL
}

/** 把产品名归一成控制台模型 ID */
function normalizeModelName(name) {
  const n = String(name).trim()
  const lower = n.toLowerCase().replace(/\s+/g, '-')
  // 用户常用产品名 → 官方模型 ID
  if (
    lower === 'qwen-audio-asr-flash-streaming' ||
    lower === 'qwen-audio-asr-flash' ||
    (lower.includes('qwen-audio') &&
      lower.includes('asr') &&
      lower.includes('streaming') &&
      !/3\.[01]/.test(lower))
  ) {
    return DEFAULT_STREAM_MODEL
  }
  return n
}

function audioMime(format) {
  const f = (format || 'mp3').toLowerCase()
  if (f === 'wav') return 'audio/wav'
  if (f === 'pcm') return 'audio/pcm'
  if (f === 'ogg' || f === 'opus') return 'audio/ogg'
  return 'audio/mpeg'
}

async function transcribe({ audioBase64, mediaUrl, demoPhrase, locale }) {
  const key = apiKey()
  if (!key) {
    const err = new Error(
      'Qwen ASR 未配置：请设置 QWEN_ASR_API_KEY 或 DASHSCOPE_API_KEY'
    )
    err.code = 'ASR_NOT_CONFIGURED'
    err.retryable = false
    throw err
  }

  // 显式 demo 仅用于联调；真实 provider 下优先真实音频
  if (demoPhrase && !audioBase64 && !mediaUrl) {
    return {
      provider: 'qwen',
      text: String(demoPhrase),
      confidence: 0.5,
      durationMs: 0,
      locale: locale || 'zh-CN',
      note: 'demo_phrase（无音频）'
    }
  }

  if (!audioBase64 && !mediaUrl) {
    const err = new Error('缺少音频：请提供 audio_base64 或 media_url')
    err.code = 'ASR_NO_AUDIO'
    err.retryable = false
    throw err
  }

  const format = (process.env.QWEN_ASR_FORMAT || 'mp3').toLowerCase()
  const sampleRate = Number(process.env.QWEN_ASR_SAMPLE_RATE || 16000)
  const modeHint = resolveMode(process.env.QWEN_ASR_MODEL || DEFAULT_STREAM_MODEL)
  const model = resolveModel(modeHint)
  const mode = resolveMode(model)
  const started = Date.now()

  let text = ''
  let raw = null

  if (mode === 'streaming') {
    if (!audioBase64) {
      const err = new Error(
        'Streaming ASR 需要 audio_base64；可改 QWEN_ASR_MODE=http 并用 media_url'
      )
      err.code = 'ASR_NO_AUDIO'
      err.retryable = false
      throw err
    }
    try {
      const out = await transcribeStreaming({
        key,
        model,
        audioBase64,
        format,
        sampleRate
      })
      text = out.text
      raw = out.raw
    } catch (e) {
      // 采样率声明不准等：回退 HTTP 同步识别（录完再传更稳）
      const allowFallback = process.env.QWEN_ASR_HTTP_FALLBACK !== '0'
      if (!allowFallback || !audioBase64) throw e
      const httpModel =
        (process.env.QWEN_ASR_HTTP_FALLBACK_MODEL || DEFAULT_HTTP_MODEL).trim()
      const out = await transcribeHttp({
        key,
        model: httpModel,
        audioBase64,
        mediaUrl,
        format,
        locale
      })
      text = out.text
      raw = {
        streaming_error: { code: e.code, message: e.message },
        http_fallback: out.raw
      }
    }
  } else {
    const out = await transcribeHttp({
      key,
      model,
      audioBase64,
      mediaUrl,
      format,
      locale
    })
    text = out.text
    raw = out.raw
  }

  if (!text && demoPhrase) {
    text = String(demoPhrase)
  }

  return {
    provider: 'qwen',
    text: text || '',
    confidence: text ? 0.9 : 0,
    durationMs: Date.now() - started,
    locale: locale || 'zh-CN',
    model,
    mode,
    raw
  }
}

async function transcribeHttp({ key, model, audioBase64, mediaUrl, format, locale }) {
  const url = (process.env.QWEN_ASR_HTTP_URL || DEFAULT_HTTP_URL).trim()
  let audioRef = mediaUrl
  if (audioBase64) {
    audioRef = `data:${audioMime(format)};base64,${audioBase64}`
  }

  const language =
    process.env.QWEN_ASR_LANGUAGE ||
    (locale && String(locale).toLowerCase().startsWith('zh') ? 'zh' : undefined)

  const body = {
    model,
    input: {
      messages: [
        {
          role: 'user',
          content: [{ audio: audioRef }]
        }
      ]
    },
    parameters: {
      asr_options: {
        enable_itn: process.env.QWEN_ASR_ENABLE_ITN !== '0',
        ...(language ? { language } : {})
      }
    }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  const rawText = await res.text()
  let raw
  try {
    raw = JSON.parse(rawText)
  } catch {
    raw = { raw: rawText }
  }

  if (!res.ok) {
    const msg =
      (raw && (raw.message || raw.code)) ||
      'HTTP ' + res.status
    const err = new Error('Qwen ASR HTTP 失败: ' + msg)
    err.code = 'ASR_FAILED'
    err.retryable = res.status >= 500
    err.raw = raw
    throw err
  }

  const text = extractHttpText(raw)
  return { text, raw }
}

function extractHttpText(raw) {
  if (!raw || typeof raw !== 'object') return ''
  const out = raw.output || {}
  // qwen3-asr-flash / choices 结构
  const choice = out.choices && out.choices[0]
  if (choice && choice.message) {
    const c = choice.message.content
    if (typeof c === 'string') return c.trim()
    if (Array.isArray(c)) {
      return c
        .map((x) => (typeof x === 'string' ? x : x && (x.text || x.transcript)))
        .filter(Boolean)
        .join('')
        .trim()
    }
    if (choice.message.text) return String(choice.message.text).trim()
  }
  // qwen-audio-3.x 同步结构
  if (out.text) return String(out.text).trim()
  if (out.output && out.output.sentence && out.output.sentence.text) {
    return String(out.output.sentence.text).trim()
  }
  if (out.sentence && out.sentence.text) return String(out.sentence.text).trim()
  return ''
}

function transcribeStreaming({ key, model, audioBase64, format, sampleRate }) {
  const url = (process.env.QWEN_ASR_WS_URL || DEFAULT_WS_URL).trim()
  const taskId = randomUUID().replace(/-/g, '').slice(0, 32)
  const timeoutMs = Number(process.env.QWEN_ASR_TIMEOUT_MS || 60000)
  const chunkDelayMs = Number(process.env.QWEN_ASR_CHUNK_DELAY_MS || 40)
  const chunkSize = Number(process.env.QWEN_ASR_CHUNK_SIZE || 3200)
  const buffer = Buffer.from(audioBase64, 'base64')

  return new Promise((resolve, reject) => {
    let settled = false
    const finals = new Map() // sentence_id -> text
    const events = []
    let taskStarted = false

    const fail = (code, message, retryable) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch (_) {}
      const err = new Error(message)
      err.code = code
      err.retryable = !!retryable
      reject(err)
    }

    const done = (text) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch (_) {}
      resolve({ text: (text || '').trim(), raw: { events, finals: [...finals.values()] } })
    }

    const timer = setTimeout(() => {
      fail('ASR_TIMEOUT', 'Qwen ASR WebSocket 超时', true)
    }, timeoutMs)

    const ws = new WebSocket(url, {
      headers: {
        Authorization: 'Bearer ' + key
      }
    })

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          header: {
            action: 'run-task',
            task_id: taskId,
            streaming: 'duplex'
          },
          payload: {
            task_group: 'audio',
            task: 'asr',
            function: 'recognition',
            model,
            parameters: {
              sample_rate: sampleRate,
              format,
              // 近场：教练贴麦口述
              ...(model.includes('3.1')
                ? { vad_model: process.env.QWEN_ASR_VAD_MODEL || 'near_meeting_16k' }
                : {})
            },
            input: {}
          }
        })
      )
    })

    ws.on('message', (data) => {
      let message
      try {
        message = JSON.parse(data.toString())
      } catch {
        return
      }
      events.push(message)
      const event = message.header && message.header.event
      if (event === 'task-started') {
        taskStarted = true
        sendAudioChunks(ws, buffer, chunkSize, chunkDelayMs)
          .then(() => {
            ws.send(
              JSON.stringify({
                header: {
                  action: 'finish-task',
                  task_id: taskId,
                  streaming: 'duplex'
                },
                payload: { input: {} }
              })
            )
          })
          .catch((e) => fail('ASR_FAILED', e.message || '音频发送失败', true))
        return
      }
      if (event === 'result-generated') {
        const sentence =
          (message.payload &&
            message.payload.output &&
            message.payload.output.sentence) ||
          {}
        const sid = sentence.sentence_id != null ? String(sentence.sentence_id) : '0'
        const t = sentence.text || ''
        if (sentence.sentence_end === true || sentence.sentence_end === undefined) {
          // sentence_end 缺省时仍保留最新文本（部分地域响应不全）
          if (t) finals.set(sid, t)
        } else if (t) {
          finals.set(sid, t)
        }
        return
      }
      if (event === 'task-finished') {
        const ordered = [...finals.values()].join('')
        done(ordered)
        return
      }
      if (event === 'task-failed') {
        const msg =
          (message.header &&
            (message.header.error_message || message.header.error_code)) ||
          'task-failed'
        fail('ASR_FAILED', 'Qwen ASR: ' + msg, false)
      }
    })

    ws.on('error', (e) => {
      fail('ASR_FAILED', 'Qwen ASR WebSocket: ' + (e.message || e), true)
    })

    ws.on('close', () => {
      if (settled) return
      if (!taskStarted) {
        fail('ASR_FAILED', 'Qwen ASR：连接关闭且任务未启动（检查密钥／WS URL）', false)
        return
      }
      const ordered = [...finals.values()].join('')
      if (ordered) done(ordered)
      else fail('ASR_FAILED', 'Qwen ASR：连接关闭且无识别结果', true)
    })
  })
}

function sendAudioChunks(ws, buffer, chunkSize, delayMs) {
  return new Promise((resolve, reject) => {
    let offset = 0
    const tick = () => {
      if (ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket 已断开'))
        return
      }
      if (offset >= buffer.length) {
        resolve()
        return
      }
      const end = Math.min(offset + chunkSize, buffer.length)
      ws.send(buffer.subarray(offset, end))
      offset = end
      setTimeout(tick, delayMs)
    }
    tick()
  })
}

module.exports = {
  name: 'qwen',
  transcribe,
  // 测试用
  _normalizeModelName: normalizeModelName,
  _extractHttpText: extractHttpText
}
