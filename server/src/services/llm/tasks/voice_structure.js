/**
 * 课后语音／文字 → 会话总结 + 结构化训练 JSON（coach_session_summary.v1）
 * 规则：不编造、不确定数值为 null、区分陈述与推断、无医学诊断
 */

const SCHEMA_VERSION = 'coach_session_summary.v1'

const SCHEMA = {
  type: 'object',
  required: [
    'session_summary',
    'coach_record',
    'exercises',
    'coach_feedback',
    'needs_confirmation'
  ],
  properties: {
    schema_version: { type: 'string' },
    // 学员可查看的易读总结
    session_summary: { type: 'string' },
    // 教练可查看的详细记录
    coach_record: { type: 'string' },
    exercises: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'sets'],
        properties: {
          name: { type: 'string' },
          sets: {
            type: 'array',
            items: {
              type: 'object',
              required: ['weight_kg', 'reps', 'set_count'],
              properties: {
                weight_kg: { type: ['number', 'null'], nullable: true },
                reps: { type: ['number', 'null'], nullable: true },
                set_count: { type: ['number', 'null'], nullable: true }
              }
            }
          },
          performance: { type: ['string', 'null'], nullable: true },
          form_issues: { type: ['string', 'null'], nullable: true },
          next_session_suggestion: { type: ['string', 'null'], nullable: true }
        }
      }
    },
    // 疲劳、不适（非诊断）
    fatigue_or_discomfort: { type: ['string', 'null'], nullable: true },
    // 教练明确给出的反馈原文归纳
    coach_feedback: { type: 'string' },
    // 模型推断（原文未明说）的说明；不得写入数值字段
    model_inferences: {
      type: 'array',
      items: { type: 'string' }
    },
    needs_confirmation: {
      type: 'array',
      items: { type: 'string' }
    }
  }
}

const SYSTEM_PROMPT = `你是健身教练的训练记录助手。根据语音转写文本，整理本次训练记录，并只输出一个符合 schema 的 JSON 对象。

【提取内容】
1. 训练动作名称
2. 每组重量、次数、组数（同重量＋同次数合并为 sets 中一条）
3. 学员训练表现
4. 疲劳、不适及动作问题（只记口述现象，不做医学诊断）
5. 教练给出的反馈
6. 下一次训练建议

【输出字段】
- session_summary：学员可查看的易读总结（2～5 句，温和清晰，不含私人苛责或未确认数值）
- coach_record：教练可查看的详细记录（可含完整组次、表现、问题与反馈要点）
- exercises[]：
  - name：动作名（能识别则用规范名，如「杠铃深蹲」）
  - sets[]：weight_kg / reps / set_count（数字或 null）
  - performance：该动作表现（仅原文有依据时填写）
  - form_issues：动作问题／不稳定等（仅原文有依据时填写）
  - next_session_suggestion：针对该动作的下次建议（仅原文有依据时填写）
- fatigue_or_discomfort：疲劳或不适的口述归纳；无则空字符串
- coach_feedback：教练明确反馈的归纳；无则空字符串
- model_inferences[]：模型基于上下文的合理推断（须标注为推断，禁止写进数值字段）
- needs_confirmation[]：待教练确认的模糊点
- schema_version 固定为 "${SCHEMA_VERSION}"（可省略，服务端会补）

【硬性规则】
1. 不得编造原文中没有的信息；不确定的数值必须为 null，禁止擅自补默认组数／次数／重量（例如不要把「50×5」补成 3 组）。
2. 区分「教练明确陈述」与「模型推断」：明确陈述写入 exercises／coach_feedback／fatigue_or_discomfort；推断只放 model_inferences，并写清推断依据。
3. 不输出医学诊断或治疗建议；不适仅复述口述现象（如「诉说膝盖不适」），不写病名。
4. 「哑铃 16」等无 kg／单侧／总重说明时，重量可填数字但须把重量口径列入 needs_confirmation，不得臆造口径。
5. 同一动作不同重量分多条 sets，不要拆成多个 exercises。
6. 无法归入动作的句子写入 needs_confirmation，不要丢弃也不要瞎编动作。
7. 同时生成 session_summary（学员向）与 coach_record（教练向）；二者信息同源，详略不同。
8. 无有效训练内容时：exercises=[]，两段总结简要说明原因，needs_confirmation 列出待确认点。
9. 只输出 JSON，不要 Markdown。`

function examplePayload() {
  return {
    session_summary:
      '本次以深蹲为主，后半段重量有所增加；教练提醒注意动作稳定性，下次先保证标准再考虑加重。',
    coach_record:
      '主项杠铃深蹲：40kg×8×2 后加至 50kg×8×2。教练观察后两组末段稳定性下降；口述无明显不适。反馈：优先动作标准再决定是否加重量。',
    exercises: [
      {
        name: '杠铃深蹲',
        sets: [
          { weight_kg: 40, reps: 8, set_count: 2 },
          { weight_kg: 50, reps: 8, set_count: 2 }
        ],
        performance: '后两组最后几次动作稳定性不足',
        form_issues: '末段稳定性下降',
        next_session_suggestion: '优先保持动作标准，再决定是否增加重量'
      }
    ],
    fatigue_or_discomfort: '',
    coach_feedback: '优先保持动作标准，再决定是否增加重量',
    model_inferences: [],
    needs_confirmation: []
  }
}

function buildMessages(input) {
  const taskId = input.taskId || 'seg'
  const text = String(input.text || '')
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        'taskId=' +
        taskId +
        '\n请根据以下语音转写文本整理训练记录：\n---\n' +
        text +
        '\n---\n返回符合 schema 的 JSON。形状参考：\n' +
        JSON.stringify(examplePayload())
    }
  ]
}

function demoFixture(input) {
  const text = String((input && input.text) || '').trim()
  return {
    schema_version: SCHEMA_VERSION,
    session_summary: text
      ? '（演示）已收到口述，正式模式将生成学员向总结与结构化训练表。'
      : '（演示）暂无口述内容。',
    coach_record: text
      ? '（演示）教练详记占位：正式模式将由大模型生成完整记录。'
      : '（演示）暂无口述内容。',
    exercises: text
      ? [
          {
            name: '示例动作',
            sets: [{ weight_kg: null, reps: null, set_count: null }],
            performance: '',
            form_issues: '',
            next_session_suggestion: '请改用正式模式或手工确认字段'
          }
        ]
      : [],
    fatigue_or_discomfort: '',
    coach_feedback: '',
    model_inferences: text ? ['演示数据，非正式识别结果'] : [],
    needs_confirmation: text ? ['演示数据，请人工确认全部字段'] : ['缺少口述文本']
  }
}

function asNumberOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function asText(v) {
  if (v == null) return ''
  return String(v).trim()
}

function normalizeSet(raw) {
  const s = raw && typeof raw === 'object' ? raw : {}
  return {
    weight_kg: asNumberOrNull(s.weight_kg != null ? s.weight_kg : s.weight),
    reps: asNumberOrNull(s.reps != null ? s.reps : s.candidate_reps_per_set),
    set_count: asNumberOrNull(s.set_count != null ? s.set_count : s.sets)
  }
}

function normalizeExercise(raw) {
  const ex = raw && typeof raw === 'object' ? raw : {}
  const name = String(ex.name || ex.display_name || '').trim() || '（待确认动作）'
  let sets = Array.isArray(ex.sets) ? ex.sets.map(normalizeSet) : []
  if (!sets.length && (ex.weight_kg != null || ex.reps != null || ex.set_count != null)) {
    sets = [normalizeSet(ex)]
  }
  if (!sets.length) {
    sets = [{ weight_kg: null, reps: null, set_count: null }]
  }
  return {
    name,
    sets,
    performance: asText(ex.performance),
    form_issues: asText(ex.form_issues != null ? ex.form_issues : ex.movement_issues),
    next_session_suggestion: asText(ex.next_session_suggestion)
  }
}

function normalizeStringList(v) {
  if (Array.isArray(v)) {
    return v.map((x) => asText(x)).filter(Boolean)
  }
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}

function normalizeResult(data) {
  const out = data && typeof data === 'object' ? Object.assign({}, data) : {}
  out.schema_version = SCHEMA_VERSION
  out.session_summary = asText(out.session_summary)
  out.coach_record = asText(out.coach_record)
  out.fatigue_or_discomfort = asText(out.fatigue_or_discomfort)
  out.coach_feedback = asText(out.coach_feedback)
  out.model_inferences = normalizeStringList(out.model_inferences)
  out.needs_confirmation = normalizeStringList(out.needs_confirmation)
  out.exercises = Array.isArray(out.exercises)
    ? out.exercises.map(normalizeExercise).filter((ex) => ex.name)
    : []

  out.exercises.forEach((ex) => {
    ex.sets.forEach((s, i) => {
      if (s.weight_kg == null) {
        out.needs_confirmation.push(ex.name + ' 第' + (i + 1) + '档重量待确认')
      }
      if (s.reps == null) {
        out.needs_confirmation.push(ex.name + ' 第' + (i + 1) + '档次数待确认')
      }
      if (s.set_count == null) {
        out.needs_confirmation.push(ex.name + ' 第' + (i + 1) + '档组数待确认')
      }
    })
    if (ex.name === '（待确认动作）') {
      out.needs_confirmation.push('存在未命名动作，请确认动作名')
    }
  })

  out.needs_confirmation = Array.from(new Set(out.needs_confirmation))
  out.model_inferences = Array.from(new Set(out.model_inferences))

  if (!out.session_summary && out.exercises.length) {
    out.session_summary =
      '本次训练包含：' + out.exercises.map((e) => e.name).join('、') + '。'
  }
  if (!out.coach_record && (out.session_summary || out.exercises.length)) {
    const lines = []
    if (out.session_summary) lines.push(out.session_summary)
    out.exercises.forEach((ex) => {
      const setDesc = ex.sets
        .map((s) => {
          const w = s.weight_kg != null ? s.weight_kg + 'kg' : '?kg'
          const r = s.reps != null ? s.reps + '次' : '?次'
          const c = s.set_count != null ? s.set_count + '组' : '?组'
          return w + '×' + r + '×' + c
        })
        .join('；')
      lines.push(ex.name + '：' + setDesc)
      if (ex.performance) lines.push('表现：' + ex.performance)
      if (ex.form_issues) lines.push('动作问题：' + ex.form_issues)
      if (ex.next_session_suggestion) lines.push('下次建议：' + ex.next_session_suggestion)
    })
    if (out.coach_feedback) lines.push('教练反馈：' + out.coach_feedback)
    if (out.fatigue_or_discomfort) lines.push('疲劳／不适：' + out.fatigue_or_discomfort)
    out.coach_record = lines.join('\n')
  }
  return out
}

module.exports = {
  key: 'voice_structure',
  schema: SCHEMA,
  systemPrompt: SYSTEM_PROMPT,
  buildMessages,
  demoFixture,
  normalizeResult,
  useVision: false,
  SCHEMA_VERSION
}
