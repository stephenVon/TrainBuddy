/**
 * 微信风格语音转文字：
 * - 若已配置并可加载 WechatSI 同声传译插件，则边说边出字
 * - 否则降级为录音 → 服务端 ASR → 写回输入框（mock 下边录边模拟出字）
 * 注意：同声传译要求非个人主体，且类目含「IT科技 > 软件服务提供商」；个人/试用号常报 89260。
 */
const MOCK_DEMO = '深蹲 60公斤 10次 4组'

function createSpeechComposer(hooks) {
  const h = hooks || {}
  let mode = 'none'
  let siManager = null
  let recorder = null
  let baseText = ''
  let mockTimer = null
  let recording = false
  let recTempPath = ''

  function clearMock() {
    if (mockTimer) {
      clearInterval(mockTimer)
      mockTimer = null
    }
  }

  function tryInitWechatSI() {
    try {
      if (typeof requirePlugin !== 'function') return false
      const plugin = requirePlugin('WechatSI')
      if (!plugin || typeof plugin.getRecordRecognitionManager !== 'function') return false
      siManager = plugin.getRecordRecognitionManager()
      siManager.onRecognize = (res) => {
        const piece = (res && res.result) || ''
        if (h.onPartial) h.onPartial(joinText(baseText, piece))
      }
      siManager.onStop = (res) => {
        recording = false
        clearMock()
        const piece = (res && res.result) || ''
        const finalText = joinText(baseText, piece)
        if (h.onFinal) h.onFinal(finalText)
        if (h.onEnd) h.onEnd({ mode: 'wechatSI' })
      }
      siManager.onError = (err) => {
        recording = false
        clearMock()
        if (h.onError) h.onError(err || { message: '语音识别失败' })
        if (h.onEnd) h.onEnd({ mode: 'wechatSI', error: true })
      }
      mode = 'wechatSI'
      return true
    } catch (_) {
      siManager = null
      return false
    }
  }

  function initRecorderFallback() {
    try {
      recorder = wx.getRecorderManager()
      recorder.onStop((res) => {
        recording = false
        clearMock()
        recTempPath = (res && res.tempFilePath) || ''
        if (!recTempPath) {
          if (h.onError) h.onError({ message: '未拿到录音文件' })
          if (h.onEnd) h.onEnd({ mode: 'recorder', error: true })
          return
        }
        if (h.onNeedAsr) {
          h.onNeedAsr({
            tempFilePath: recTempPath,
            baseText,
            finish: (transcript) => {
              const finalText = joinText(baseText, transcript || '')
              typewriter(finalText, () => {
                if (h.onFinal) h.onFinal(finalText)
                if (h.onEnd) h.onEnd({ mode: 'recorder' })
              })
            },
            fail: (err) => {
              if (h.onError) h.onError(err || { message: '转写失败' })
              if (h.onEnd) h.onEnd({ mode: 'recorder', error: true })
            }
          })
        } else if (h.onEnd) {
          h.onEnd({ mode: 'recorder' })
        }
      })
      recorder.onError(() => {
        recording = false
        clearMock()
        if (h.onError) h.onError({ message: '录音失败', micDenied: true })
        if (h.onEnd) h.onEnd({ mode: 'recorder', error: true })
      })
      mode = 'recorder'
      return true
    } catch (_) {
      mode = 'none'
      return false
    }
  }

  function typewriter(full, done) {
    const start = baseText.length
    let i = start
    clearMock()
    if (!full || full.length <= start) {
      if (h.onFinal) h.onFinal(full || baseText)
      done && done()
      return
    }
    mockTimer = setInterval(() => {
      i += 1
      if (h.onPartial) h.onPartial(full.slice(0, i))
      if (i >= full.length) {
        clearMock()
        if (h.onFinal) h.onFinal(full)
        done && done()
      }
    }, 28)
  }

  function startMockPartial() {
    clearMock()
    let i = 0
    mockTimer = setInterval(() => {
      i += 1
      if (h.onPartial) h.onPartial(joinText(baseText, MOCK_DEMO.slice(0, i)))
      if (i >= MOCK_DEMO.length) clearMock()
    }, 70)
  }

  function ensureReady() {
    if (mode === 'wechatSI' || mode === 'recorder') return mode !== 'none'
    if (tryInitWechatSI()) return true
    return initRecorderFallback()
  }

  function start(currentText, opts) {
    if (recording) return false
    if (!ensureReady()) {
      if (h.onError) h.onError({ message: '设备不支持录音', micDenied: true })
      return false
    }
    baseText = currentText || ''
    recording = true
    if (h.onStart) h.onStart({ mode })
    if (mode === 'wechatSI') {
      try {
        siManager.start({ duration: 60000, lang: 'zh_CN' })
        return true
      } catch (e) {
        recording = false
        if (h.onError) h.onError(e)
        return false
      }
    }
    // recorder 降级：mock 边录边出演示文案；真实 ASR 等松手后写入
    if (opts && opts.simulatePartial) startMockPartial()
    else if (h.onPartial) h.onPartial(baseText)
    try {
      recorder.start({
        duration: 60000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: 'mp3'
      })
      return true
    } catch (e) {
      recording = false
      clearMock()
      if (h.onError) h.onError(e)
      return false
    }
  }

  function stop() {
    if (!recording) return
    if (mode === 'wechatSI' && siManager) {
      try {
        siManager.stop()
      } catch (_) {
        recording = false
        if (h.onEnd) h.onEnd({ mode: 'wechatSI' })
      }
      return
    }
    if (mode === 'recorder' && recorder) {
      try {
        recorder.stop()
      } catch (_) {
        recording = false
        clearMock()
        if (h.onEnd) h.onEnd({ mode: 'recorder', error: true })
      }
    }
  }

  function destroy() {
    clearMock()
    if (recording) stop()
    siManager = null
    recorder = null
    mode = 'none'
  }

  return {
    start,
    stop,
    destroy,
    getMode: () => mode,
    isRecording: () => recording,
    MOCK_DEMO
  }
}

function joinText(base, piece) {
  const b = String(base || '')
  const p = String(piece || '')
  if (!p) return b
  if (!b) return p
  if (b.endsWith(p)) return b
  const needSpace = !/\s$/.test(b) && !/^[,.，。、\s]/.test(p)
  return b + (needSpace ? (/\n$/.test(b) ? '' : ' ') : '') + p
}

module.exports = { createSpeechComposer, MOCK_DEMO }
