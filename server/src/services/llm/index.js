/**
 * 统一大模型任务入口
 * runTask(taskKey, input, { mode })
 * - demo：本地 fixture，不外网
 * - real + 未配置／未启用：PROVIDER_NOT_CONFIGURED
 * - real + 已配置：OpenAI 兼容调用 + schema 校验
 */

const { AppError } = require('../../lib/errors')
const { publicStatus, isTaskEnabled, resolveForTask } = require('./config')
const client = require('./client')
const nutrition = require('./tasks/nutrition')
const postureScan = require('./tasks/posture_scan')
const voiceStructure = require('./tasks/voice_structure')
const goalImageSpec = require('./tasks/goal_image_spec')

const REGISTRY = {
  nutrition,
  posture_scan: postureScan,
  voice_structure: voiceStructure,
  goal_image_spec: goalImageSpec
}

function listTasks() {
  return Object.keys(REGISTRY).map((key) => ({
    key,
    use_vision: !!REGISTRY[key].useVision,
    enabled: isTaskEnabled(key),
    provider: resolveForTask(key).name
  }))
}

/**
 * @param {string} taskKey
 * @param {object} input
 * @param {{ mode?: 'demo'|'real' }} opts
 */
async function runTask(taskKey, input, opts = {}) {
  const task = REGISTRY[taskKey]
  if (!task) {
    throw new AppError('VALIDATION', '未知 LLM 任务: ' + taskKey)
  }

  const mode = opts.mode === 'demo' ? 'demo' : 'real'

  if (mode === 'demo') {
    return {
      task: taskKey,
      mode: 'demo',
      is_demo: true,
      provider: 'mock',
      data: task.demoFixture(input || {}),
      usage: null
    }
  }

  if (!isTaskEnabled(taskKey)) {
    throw new AppError(
      'PROVIDER_NOT_CONFIGURED',
      '大模型未配置或任务未启用: ' + taskKey,
      { retryable: false, status: 503 }
    )
  }

  const endpoint = resolveForTask(taskKey)
  const messages = task.buildMessages(input || {})
  const coerce =
    typeof task.normalizeResult === 'function'
      ? (raw) => task.normalizeResult(raw, input || {})
      : null
  const result = await client.chatJson({
    messages,
    schema: task.schema,
    coerce,
    model: endpoint.model,
    apiKey: endpoint.apiKey,
    baseUrl: endpoint.baseUrl,
    timeoutMs: endpoint.timeoutMs,
    temperature: 0.2
  })

  // chatJson 已在校验前 coerce；再归一化一次保证出口形状稳定
  let data = result.data
  if (typeof task.normalizeResult === 'function') {
    data = task.normalizeResult(data, input || {})
  }

  return {
    task: taskKey,
    mode: 'real',
    is_demo: false,
    provider: endpoint.name,
    data,
    usage: result.usage,
    model: result.model
  }
}

function getTaskMeta(taskKey) {
  const task = REGISTRY[taskKey]
  if (!task) return null
  return {
    key: task.key,
    system_prompt: task.systemPrompt,
    schema: task.schema,
    use_vision: !!task.useVision
  }
}

module.exports = {
  runTask,
  listTasks,
  getTaskMeta,
  publicStatus,
  isTaskEnabled,
  REGISTRY,
  // 测试钩子
  _client: client
}
