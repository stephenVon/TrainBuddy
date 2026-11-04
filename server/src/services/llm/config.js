/**
 * LLM 多供应商配置：密钥仅来自环境变量，不落盘到仓库、不进接口响应
 *
 * 默认任务路由：
 * - voice_structure / goal_image_spec → DeepSeek（文本）
 * - nutrition → 豆包 Ark（视觉）；未配 endpoint 时回退 MiniMax
 */

function parseEnabledTasks(raw) {
  const fallback = ['nutrition', 'posture_scan', 'voice_structure', 'goal_image_spec']
  if (!raw || !String(raw).trim()) return fallback
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function env(name, fallback) {
  const v = process.env[name]
  if (v == null || String(v).trim() === '') return fallback
  return String(v).trim()
}

function providerDefs() {
  return {
    deepseek: {
      name: 'deepseek',
      apiKey: env('DEEPSEEK_API_KEY', env('LLM_API_KEY', '')),
      baseUrl: env('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1').replace(/\/$/, ''),
      model: env('DEEPSEEK_MODEL', env('LLM_MODEL', 'deepseek-chat'))
    },
    doubao: {
      name: 'doubao',
      apiKey: env('DOUBAO_API_KEY', env('ARK_API_KEY', '')),
      baseUrl: env(
        'DOUBAO_BASE_URL',
        'https://ark.cn-beijing.volces.com/api/v3'
      ).replace(/\/$/, ''),
      // 火山方舟需接入点 ID，例如 ep-xxxxxxxx
      model: env('DOUBAO_MODEL', env('DOUBAO_ENDPOINT_ID', env('LLM_VISION_MODEL', '')))
    },
    minimax: {
      name: 'minimax',
      apiKey: env('MINIMAX_API_KEY', ''),
      baseUrl: env('MINIMAX_BASE_URL', 'https://api.minimaxi.com/v1').replace(/\/$/, ''),
      model: env('MINIMAX_MODEL', 'MiniMax-Text-01')
    }
  }
}

/** 任务 → 供应商名（可用 LLM_TASK_PROVIDER_<TASK> 覆盖） */
function taskProviderName(taskKey) {
  const override = env('LLM_TASK_PROVIDER_' + String(taskKey || '').toUpperCase(), '')
  if (override) return override.toLowerCase()
  // 视觉任务：饮食／体态 → 豆包（当前推理接入点）
  if (taskKey === 'nutrition' || taskKey === 'posture_scan') {
    const defs = providerDefs()
    if (defs.doubao.apiKey && defs.doubao.model) return 'doubao'
    if (defs.minimax.apiKey) return 'minimax'
    if (defs.deepseek.apiKey) return 'deepseek'
    return 'doubao'
  }
  // 文本任务默认 DeepSeek
  return 'deepseek'
}

function resolveForTask(taskKey) {
  const defs = providerDefs()
  const name = taskProviderName(taskKey)
  const p = defs[name] || defs.deepseek
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 60000)
  const ok = !!(p.apiKey && p.model)
  return {
    name: p.name,
    apiKey: p.apiKey || '',
    baseUrl: p.baseUrl,
    model: p.model || '',
    configured: ok,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60000
  }
}

function loadLlmConfig() {
  const defs = providerDefs()
  const enabledTasks = parseEnabledTasks(process.env.LLM_ENABLED_TASKS)
  const anyKey = Object.keys(defs).some((k) => !!defs[k].apiKey)
  // 兼容旧单客户端字段：优先 DeepSeek
  const primary = defs.deepseek.apiKey
    ? defs.deepseek
    : defs.minimax.apiKey
      ? defs.minimax
      : defs.doubao

  return {
    configured: anyKey,
    apiKey: primary.apiKey || '',
    baseUrl: primary.baseUrl,
    model: primary.model || 'deepseek-chat',
    visionModel: defs.doubao.model || defs.minimax.model || primary.model,
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 60000) || 60000,
    enabledTasks,
    providers: {
      deepseek: !!defs.deepseek.apiKey,
      doubao: !!(defs.doubao.apiKey && defs.doubao.model),
      minimax: !!defs.minimax.apiKey
    }
  }
}

function publicStatus() {
  const c = loadLlmConfig()
  const defs = providerDefs()
  const safeHost = (url) => {
    try {
      return new URL(url).host
    } catch (_) {
      return null
    }
  }
  return {
    configured: c.configured,
    base_url_host: safeHost(c.baseUrl),
    model: c.model,
    vision_model: c.visionModel,
    enabled_tasks: c.enabledTasks.slice(),
    timeout_ms: c.timeoutMs,
    providers: {
      deepseek: {
        configured: !!defs.deepseek.apiKey,
        host: safeHost(defs.deepseek.baseUrl),
        model: defs.deepseek.model || null
      },
      doubao: {
        configured: !!(defs.doubao.apiKey && defs.doubao.model),
        host: safeHost(defs.doubao.baseUrl),
        model: defs.doubao.model || null,
        needs_endpoint_id: !!(defs.doubao.apiKey && !defs.doubao.model)
      },
      minimax: {
        configured: !!defs.minimax.apiKey,
        host: safeHost(defs.minimax.baseUrl),
        model: defs.minimax.model || null
      }
    },
    task_routing: {
      nutrition: taskProviderName('nutrition'),
      posture_scan: taskProviderName('posture_scan'),
      voice_structure: taskProviderName('voice_structure'),
      goal_image_spec: taskProviderName('goal_image_spec')
    }
  }
}

function isTaskEnabled(taskKey) {
  const c = loadLlmConfig()
  if (c.enabledTasks.indexOf(taskKey) < 0) return false
  return resolveForTask(taskKey).configured
}

module.exports = {
  loadLlmConfig,
  publicStatus,
  isTaskEnabled,
  resolveForTask,
  taskProviderName,
  providerDefs
}
