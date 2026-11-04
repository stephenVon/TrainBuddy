/**
 * 目标预览：根据用户三大配置组装 MiniMax 图生图提示词
 * 硬控：只调身材，严格保留原图布局／视角／构图
 */

const BODY_GOAL = {
  lean_toned: '精瘦、有线条',
  balanced_muscular: '肌肉匀称、体型更健壮',
  athletic: '运动员型、力量与体能感',
  lighter_slim: '更轻盈、整体更纤细'
}

const CHANGE_LEVEL = {
  slight: { label: '轻微', detail: '自然、接近当前体型' },
  moderate: { label: '中等', detail: '明显但相对合理' },
  strong: { label: '强烈', detail: '更突出理想身材风格' }
}

const IMAGE_STYLE = {
  gym_photo: '真实健身房摄影',
  studio: '简洁摄影棚人像',
  brand_promo: '运动品牌宣传照'
}

function labelOf(map, key, fallback) {
  if (key && map[key] != null) {
    return typeof map[key] === 'string' ? map[key] : map[key].label
  }
  return fallback
}

/**
 * @param {{ body_goal?: string, change_level?: string, image_style?: string, months?: number, goal_text?: string }} cfg
 */
function buildGoalImagePrompt(cfg = {}) {
  const bodyKey = cfg.body_goal || 'balanced_muscular'
  const changeKey = cfg.change_level || 'moderate'
  const styleKey = cfg.image_style || 'gym_photo'

  const bodyLabel = BODY_GOAL[bodyKey] || BODY_GOAL.balanced_muscular
  const change = CHANGE_LEVEL[changeKey] || CHANGE_LEVEL.moderate
  const styleLabel = IMAGE_STYLE[styleKey] || IMAGE_STYLE.gym_photo

  const months = cfg.months != null ? Number(cfg.months) : null
  const monthLine =
    months && Number.isFinite(months) && months > 0
      ? '时间节点参考：约 ' + months + ' 个月训练方向的视觉激励（仅供想象，非预测）。'
      : ''

  const goalText = cfg.goal_text ? String(cfg.goal_text).trim() : ''
  const goalLine = goalText ? '用户补充目标描述：' + goalText.slice(0, 80) : ''

  // MiniMax prompt 最长约 1500 字符
  const prompt = [
    '请以用户上传的照片作为唯一人物与场景参考，生成一张健身目标激励用的写实照片。',
    '',
    '【硬性构图约束——必须遵守】',
    '1. 严格保留原照片的整体布局：人物在画面中的位置、占比、裁切范围尽量一致。',
    '2. 严格保留原照片的拍摄视角与镜头感：机位高度、俯仰角、左右朝向、景深关系不要改变。',
    '3. 严格保留原照片的背景、场景、光影方向与服装款式轮廓；不要换成新场景或重新布景。',
    '4. 禁止重新构图、禁止换机位、禁止全身改半身或半身改全身、禁止镜像翻转。',
    '5. 允许调整的范围仅限：人物身材轮廓、肌肉线条与体脂观感；其余一律贴近原图。',
    '',
    '目标方向：' + bodyLabel + '。',
    '变化幅度：' + change.label + '（' + change.detail + '）。',
    '图片风格参考：' + styleLabel + '（在不改布局与视角的前提下微调质感即可）。',
    monthLine,
    goalLine,
    '',
    '优先保持人物原有的面部特征、发型、肤色、年龄观感及其他可辨认特征。',
    '仅对整体体型与肌肉线条做符合人体结构的适度调整，画面须自然、可信。',
    '',
    '避免夸张肌肉比例、异常肢体、多余手指、不自然皮肤纹理、过度磨皮和明显合成痕迹。',
    '不要添加文字、水印或虚构身体指标。',
    '该图是理想身材视觉参考，不代表真实身体变化预测或训练效果保证。'
  ]
    .filter((line) => line != null && line !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return {
    prompt: prompt.slice(0, 1500),
    labels: {
      body_goal: bodyLabel,
      change_level: change.label,
      change_detail: change.detail,
      image_style: styleLabel
    },
    config: {
      body_goal: bodyKey,
      change_level: changeKey,
      image_style: styleKey
    }
  }
}

module.exports = {
  BODY_GOAL,
  CHANGE_LEVEL,
  IMAGE_STYLE,
  buildGoalImagePrompt,
  labelOf
}
