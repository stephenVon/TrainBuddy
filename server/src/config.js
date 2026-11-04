const path = require('path')

module.exports = {
  port: Number(process.env.PORT || 8787),
  timezone: 'Asia/Shanghai',
  dataDir: path.join(__dirname, '..', 'data'),
  storeFile: path.join(__dirname, '..', 'data', 'store.json'),
  /** mock 会话 token 前缀；正式环境换微信 code 换 session */
  sessionTtlMs: 7 * 24 * 3600 * 1000,
  idempotencyTtlMs: 24 * 3600 * 1000,
  /**
   * AI 供应商：unavailable（默认，真实任务不得伪造成功）| mock（本地/演示）
   * 演示任务（mode=demo）始终走 mock，与真实任务隔离。
   * 饮食／语音结构化／目标图规格的大模型见 llm 段与 LLM_* 环境变量。
   */
  aiProvider: process.env.AI_PROVIDER || 'unavailable',
  /**
   * 统一大模型（OpenAI 兼容）。密钥只读环境变量，此处仅放安全摘要字段。
   * 详见 docs/LLM-MODULE.md
   */
  llm: {
    get configured() {
      return !!(process.env.LLM_API_KEY && String(process.env.LLM_API_KEY).trim())
    },
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    visionModel: process.env.LLM_VISION_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini',
    baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1'
  },
  /**
   * 功能开关：支付未决策前默认关闭，不开放真实付款成功路径。
   * PAYMENT_ENABLED=true 仍需另行接入支付渠道；当前仅打开“可调用占位接口”的门闩。
   */
  features: {
    paymentEnabled: String(process.env.PAYMENT_ENABLED || '').toLowerCase() === 'true'
  },
  media: {
    maxBytes: 10 * 1024 * 1024,
    allowedMime: ['image/jpeg', 'image/png', 'image/webp'],
    accessTtlSec: 300,
    watermarkText: 'AI 目标效果模拟，非训练结果保证'
  },
  entitlements: {
    /** 试用默认额度（后台可再发放／补偿） */
    trialDefaults: {
      posture_scan: 5,
      goal_image: 9,
      voice_structure: 30,
      nutrition_scan: 50
    }
  },
  schedule: {
    timezone: 'Asia/Shanghai',
    defaultDurationMin: 60,
    defaultBufferMin: 0,
    openDaysAhead: 14,
    minBookAheadMin: 120,
    cancelOrChangeAheadMin: 12 * 60,
    pendingExpireMin: 120,
    pendingExpireBeforeStartMin: 30,
    rulesVersion: 3,
    courseTypes: [
      {
        id: 'private_strength_60',
        name: '私教力量',
        durationMin: 60,
        location: '私教工作室'
      },
      {
        id: 'private_mobility_50',
        name: '体态与灵活性',
        durationMin: 50,
        location: '私教工作室'
      }
    ]
  }
}
