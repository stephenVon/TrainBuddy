/**
 * 体态观察：正面／侧面照片 → JSON 报告（无总分）
 */

const ITEM_KEYS = [
  { key: 'round_shoulders', label: '圆肩倾向', views: ['front'] },
  { key: 'lateral_trunk', label: '侧面躯干姿态', views: ['side'] },
  { key: 'uneven_shoulders', label: '高低肩倾向', views: ['front'] },
  { key: 'pelvic_posture', label: '骨盆姿态', views: ['side'] }
]

const CONCLUSIONS = ['no_obvious', 'needs_attention', 'unable_to_judge']

const SCHEMA = {
  type: 'object',
  required: ['status', 'overall_score', 'items', 'improvement_hints'],
  properties: {
    status: { type: 'string', enum: ['draft', 'need_retake'] },
    overall_score: { type: ['number', 'null'], nullable: true },
    model_version: { type: 'string' },
    message: { type: ['string', 'null'], nullable: true },
    quality: { type: 'object', nullable: true },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'label', 'conclusion', 'basis', 'reliability'],
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          conclusion: { type: 'string', enum: CONCLUSIONS },
          // 模型常把依据写成字符串；校验放宽，normalizeResult 再收成对象
          basis: {
            type: ['object', 'string'],
            properties: {
              views: { type: 'array', items: { type: 'string' } },
              notes: { type: 'string' }
            }
          },
          reliability: { type: 'string' }
        }
      }
    },
    improvement_hints: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'note'],
        properties: {
          title: { type: 'string' },
          note: { type: 'string' }
        }
      }
    }
  }
}

const SYSTEM_PROMPT = `你是健身教练助理的体态观察模块。根据站姿正面／侧面照片给出结构化观察，供教练复核。

硬性规则：
1. overall_score 必须为 null，禁止输出总分或百分制评分。
2. 每项 conclusion 只能是：no_obvious（未见明显特征）｜needs_attention（疑似需关注）｜unable_to_judge（无法判断）。
3. 信息不足、遮挡、角度差、缺侧面时，对应项用 unable_to_judge，reliability 用 insufficient；不要编造「正常」。
4. 必须覆盖这 4 个 key：round_shoulders、lateral_trunk、uneven_shoulders、pelvic_posture。
5. improvement_hints 给 1～3 条一般性训练方向，注明需教练复核，禁止医疗诊断措辞。
6. 照片明显不合格（无人、多人、严重模糊）时 status=need_retake，items=[]，并写 message（字符串）。合格时 message 可省略或用空字符串，不要输出 null。
7. 否则 status=draft。只输出一个 JSON 对象，不要 Markdown。
8. 每项 basis 必须是对象：{"views":["front"|"side"],"notes":"简短依据"}，不要把 basis 写成纯字符串。`

function imagePart(dataUrl) {
  return { type: 'image_url', image_url: { url: dataUrl } }
}

function toDataUrl(base64, mime) {
  if (!base64) return null
  const raw = String(base64).replace(/^data:[^;]+;base64,/, '')
  return 'data:' + (mime || 'image/jpeg') + ';base64,' + raw
}

function buildMessages(input) {
  const frontUrl =
    toDataUrl(input.frontImageBase64, input.mime) ||
    (input.frontImageUrl && !/mock\.(signed|upload)\.local/i.test(input.frontImageUrl)
      ? input.frontImageUrl
      : null)
  const sideUrl =
    toDataUrl(input.sideImageBase64, input.mime) ||
    (input.sideImageUrl && !/mock\.(signed|upload)\.local/i.test(input.sideImageUrl)
      ? input.sideImageUrl
      : null)

  const content = []
  if (frontUrl) {
    content.push({ type: 'text', text: '【正面站姿照片】' })
    content.push(imagePart(frontUrl))
  }
  if (sideUrl) {
    content.push({ type: 'text', text: '【侧面站姿照片】' })
    content.push(imagePart(sideUrl))
  }

  content.push({
    type: 'text',
    text:
      '请按 schema 输出体态观察 JSON。质量提示：' +
      JSON.stringify(input.qualityHints || {}) +
      (input.forcePelvicUnable
        ? '；强制：骨盆姿态 conclusion 必须为 unable_to_judge。'
        : '') +
      ' 记住 overall_score 必须为 null。'
  })

  if (!frontUrl && !sideUrl) {
    content.push({
      type: 'text',
      text: '（无可用图片：请 status=need_retake，不要编造观察结论）'
    })
  }

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content }
  ]
}

function demoFixture(input) {
  const forcePelvicUnable = !!(input && input.forcePelvicUnable)
  const pelvicConclusion = forcePelvicUnable ? 'unable_to_judge' : 'needs_attention'
  return {
    status: 'draft',
    overall_score: null,
    model_version: 'demo-posture-v0',
    items: [
      {
        key: 'round_shoulders',
        label: '圆肩倾向',
        conclusion: 'needs_attention',
        basis: { views: ['front'], notes: '肩峰相对可见位置' },
        reliability: 'demo_only'
      },
      {
        key: 'lateral_trunk',
        label: '侧面躯干姿态',
        conclusion: 'no_obvious',
        basis: { views: ['side'], notes: '躯干相对垂直参考' },
        reliability: 'demo_only'
      },
      {
        key: 'uneven_shoulders',
        label: '高低肩倾向',
        conclusion: 'no_obvious',
        basis: { views: ['front'], notes: '双侧肩峰高度差不明显' },
        reliability: 'demo_only'
      },
      {
        key: 'pelvic_posture',
        label: '骨盆姿态',
        conclusion: pelvicConclusion,
        basis: {
          views: ['side'],
          notes:
            pelvicConclusion === 'unable_to_judge'
              ? '关键点遮挡或角度不足，无法判断'
              : '演示样本疑似前倾倾向'
        },
        reliability: pelvicConclusion === 'unable_to_judge' ? 'insufficient' : 'demo_only'
      }
    ],
    improvement_hints: [
      { title: '核心稳定', note: '候选方向，待教练复核后个性化' },
      { title: '髋踝活动度', note: '一般性说明，非已确认计划' }
    ]
  }
}

function coerceBasis(rawBasis, defaultViews) {
  if (typeof rawBasis === 'string') {
    return { views: defaultViews.slice(), notes: rawBasis }
  }
  if (rawBasis && typeof rawBasis === 'object' && !Array.isArray(rawBasis)) {
    const views = Array.isArray(rawBasis.views) && rawBasis.views.length
      ? rawBasis.views.map(String)
      : defaultViews.slice()
    const notes =
      rawBasis.notes != null
        ? String(rawBasis.notes)
        : rawBasis.note != null
          ? String(rawBasis.note)
          : ''
    return { views, notes }
  }
  return { views: defaultViews.slice(), notes: '' }
}

function normalizeResult(data, opts) {
  const out = data && typeof data === 'object' ? Object.assign({}, data) : {}
  out.overall_score = null
  if (out.message == null) {
    delete out.message
  } else {
    out.message = String(out.message)
  }
  if (out.status === 'need_retake') {
    out.items = []
    out.improvement_hints = Array.isArray(out.improvement_hints) ? out.improvement_hints : []
    if (!out.message) out.message = '照片质量不足，请按指引重拍'
    return out
  }
  out.status = 'draft'
  const byKey = {}
  ;(out.items || []).forEach((it) => {
    if (it && it.key) byKey[it.key] = it
  })
  out.items = ITEM_KEYS.map((meta) => {
    const raw = byKey[meta.key] || {}
    let conclusion = CONCLUSIONS.indexOf(raw.conclusion) >= 0 ? raw.conclusion : 'unable_to_judge'
    if (meta.key === 'pelvic_posture' && opts && opts.forcePelvicUnable) {
      conclusion = 'unable_to_judge'
    }
    return {
      key: meta.key,
      label: raw.label || meta.label,
      conclusion,
      basis: coerceBasis(raw.basis, meta.views),
      reliability:
        raw.reliability ||
        (conclusion === 'unable_to_judge' ? 'insufficient' : 'model_estimate')
    }
  })
  if (!Array.isArray(out.improvement_hints) || !out.improvement_hints.length) {
    out.improvement_hints = [
      { title: '姿态意识', note: '日常站姿与训练中保持中立脊柱，需教练复核' }
    ]
  } else {
    out.improvement_hints = out.improvement_hints
      .filter((h) => h && (h.title || h.note))
      .map((h) => ({
        title: String(h.title || '训练方向'),
        note: String(h.note || '')
      }))
  }
  return out
}

module.exports = {
  key: 'posture_scan',
  schema: SCHEMA,
  systemPrompt: SYSTEM_PROMPT,
  buildMessages,
  demoFixture,
  normalizeResult,
  useVision: true,
  ITEM_KEYS,
  CONCLUSIONS
}
