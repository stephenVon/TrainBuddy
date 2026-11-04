/**
 * 拍照饮食识别：视觉 → JSON（三大营养素单位：克）
 */

const SCHEMA = {
  type: 'object',
  required: ['status', 'items', 'total_macros_g', 'is_estimate'],
  properties: {
    status: { type: 'string', enum: ['needs_confirmation', 'need_retake'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['food_name', 'portion', 'macros_g'],
        properties: {
          food_name: { type: 'string' },
          portion: {
            type: 'object',
            properties: {
              amount: { type: ['number', 'null'], nullable: true },
              unit: { type: 'string' },
              is_estimated: { type: 'boolean' }
            }
          },
          macros_g: {
            type: 'object',
            required: ['carbs', 'protein', 'fat'],
            properties: {
              carbs: { type: ['number', 'null'], nullable: true },
              protein: { type: ['number', 'null'], nullable: true },
              fat: { type: ['number', 'null'], nullable: true }
            }
          },
          basis: { type: 'string' },
          uncertainties: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    total_macros_g: {
      type: 'object',
      required: ['carbs', 'protein', 'fat'],
      properties: {
        carbs: { type: ['number', 'null'], nullable: true },
        protein: { type: ['number', 'null'], nullable: true },
        fat: { type: ['number', 'null'], nullable: true }
      }
    },
    is_estimate: { type: 'boolean' },
    model_version: { type: 'string' },
    quality: { type: 'object', nullable: true },
    message: { type: 'string' }
  }
}

const SYSTEM_PROMPT = `你是健身教练助理的饮食识别模块。根据食物照片估算本餐的碳水化合物、蛋白质、脂肪。

硬性规则：
1. 三大营养素单位一律为「本餐克数」(macros_g)，不要输出每 100g，不要用 kcal 冒充克。
2. 不确定的数值必须用 JSON null，禁止用 0 填充未知。
3. is_estimate 必须为 true；结果仅供用户确认，不得声称精确。
4. 若无明显食物、过模糊、多餐无法拆分：status=need_retake，items=[]，total_macros_g 全 null，并给出 message。
5. 否则 status=needs_confirmation，列出 items（可多项），并汇总 total_macros_g。
6. 只输出一个 JSON 对象，不要 Markdown。`

function buildMessages(input) {
  const hints = input.qualityHints || {}
  const userText =
    '请识别这张餐食照片并按 schema 输出 JSON。质量提示：' +
    JSON.stringify(hints) +
    '。schema 字段：status, items[{food_name,portion{amount,unit,is_estimated},macros_g{carbs,protein,fat},basis,uncertainties}], total_macros_g, is_estimate, message。'

  const content = [{ type: 'text', text: userText }]
  const mime = input.mime || 'image/jpeg'
  let dataUrl = null
  if (input.imageBase64) {
    const raw = String(input.imageBase64).replace(/^data:[^;]+;base64,/, '')
    dataUrl = 'data:' + mime + ';base64,' + raw
  } else if (
    input.imageUrl &&
    (/^data:image\//i.test(input.imageUrl) || /^https?:\/\//i.test(input.imageUrl)) &&
    !/mock\.(signed|upload)\.local/i.test(input.imageUrl)
  ) {
    dataUrl = input.imageUrl
  }

  if (dataUrl) {
    // 豆包视觉：图在前、文在后更稳
    content.unshift({ type: 'image_url', image_url: { url: dataUrl } })
  } else {
    content.push({
      type: 'text',
      text: '（无可用图片：请 need_retake，不要编造营养数值）'
    })
  }

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content }
  ]
}

function demoFixture() {
  return {
    status: 'needs_confirmation',
    items: [
      {
        food_name: '示例：鸡胸肉沙拉',
        portion: { amount: 250, unit: 'g', is_estimated: true },
        macros_g: { carbs: 12, protein: 35, fat: 8 },
        basis: 'identified_portion',
        uncertainties: ['份量为演示估算，请人工确认']
      }
    ],
    total_macros_g: { carbs: 12, protein: 35, fat: 8 },
    is_estimate: true,
    model_version: 'demo-nutrition-v0'
  }
}

module.exports = {
  key: 'nutrition',
  schema: SCHEMA,
  systemPrompt: SYSTEM_PROMPT,
  buildMessages,
  demoFixture,
  useVision: true
}
