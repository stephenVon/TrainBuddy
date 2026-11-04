/**
 * 健身目标图：LLM 只产出 JSON 生成规格，不直接出像素图
 */

const SCHEMA = {
  type: 'object',
  required: [
    'node_key',
    'months',
    'prompt',
    'negative_prompt',
    'watermark_text',
    'identity_notes',
    'safety_flags'
  ],
  properties: {
    node_key: { type: 'string' },
    months: { type: 'number' },
    prompt: { type: 'string' },
    negative_prompt: { type: 'string' },
    watermark_text: { type: 'string' },
    identity_notes: { type: 'string' },
    safety_flags: {
      type: 'object',
      properties: {
        identity_consistent: { type: 'boolean' },
        medical_claim: { type: 'boolean' },
        before_after_exaggeration: { type: 'boolean' }
      }
    },
    preview_label: { type: 'string' }
  }
}

const SYSTEM_PROMPT = `你是健身目标效果模拟的提示词工程师。根据学员目标描述与时间节点，产出供后续图像模型使用的 JSON 规格。

硬性规则：
1. 必须强调「AI 模拟、非训练结果保证」，watermark_text 使用或包含该含义。
2. 禁止医疗承诺、夸张前后对比承诺；safety_flags.medical_claim 应为 false；若用户原文含医疗承诺，在 identity_notes 标明需弱化。
3. prompt 描述真实自然的健身进度外观，保持同一人物身份一致性（identity_consistent=true）。
4. negative_prompt 排除色情、畸形肢体、虚假体脂秤数字、医疗诊断字样。
5. 只输出 JSON，不要 Markdown。`

function buildMessages(input) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        node_key: input.nodeKey || input.node_key,
        months: input.months,
        goal_text: input.goalText || input.goal_text || '',
        watermark_hint: input.watermarkText || 'AI 目标效果模拟，非训练结果保证'
      })
    }
  ]
}

function demoFixture(input) {
  const months = (input && input.months) || 3
  const nodeKey = (input && (input.nodeKey || input.node_key)) || 'm3'
  return {
    node_key: nodeKey,
    months,
    prompt:
      '同一人物在健身房自然光线下的全身站姿，约 ' +
      months +
      ' 个月力量训练后的健康体态进步，真实摄影风格',
    negative_prompt: 'nude, deformed hands, medical chart, fake scale numbers, text overlay clutter',
    watermark_text: 'AI 目标效果模拟，非训练结果保证',
    identity_notes: '保持面部与体型身份一致；演示规格',
    safety_flags: {
      identity_consistent: true,
      medical_claim: false,
      before_after_exaggeration: false
    },
    preview_label: '示例'
  }
}

module.exports = {
  key: 'goal_image_spec',
  schema: SCHEMA,
  systemPrompt: SYSTEM_PROMPT,
  buildMessages,
  demoFixture,
  useVision: false
}
