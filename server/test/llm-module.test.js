/**
 * 统一 LLM 模块：密钥隔离、schema、demo／unavailable、注入假客户端
 */
const { describe, it, before, after, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const llm = require('../src/services/llm')
const { validate } = require('../src/services/llm/validate')
const client = require('../src/services/llm/client')
const { structureText, structureTextWithLlm } = require('../src/services/voice/structure')
const { runNutritionScan, runGoalNode } = require('../src/services/ai/providers')

describe('llm module', () => {
  const prev = {
    key: process.env.LLM_API_KEY,
    base: process.env.LLM_BASE_URL,
    model: process.env.LLM_MODEL,
    tasks: process.env.LLM_ENABLED_TASKS,
    ai: process.env.AI_PROVIDER
  }

  after(() => {
    restoreEnv(prev)
    client._resetTestHooks()
  })

  beforeEach(() => {
    client._resetTestHooks()
  })

  afterEach(() => {
    client._resetTestHooks()
    delete process.env.LLM_API_KEY
    delete process.env.LLM_BASE_URL
    delete process.env.LLM_MODEL
    delete process.env.LLM_ENABLED_TASKS
  })

  it('publicStatus 不含 api key', () => {
    process.env.LLM_API_KEY = 'sk-secret-should-not-leak'
    process.env.LLM_MODEL = 'test-model'
    const st = llm.publicStatus()
    assert.equal(st.configured, true)
    assert.equal(st.model, 'test-model')
    const dumped = JSON.stringify(st)
    assert.ok(dumped.indexOf('sk-secret') < 0)
  })

  it('缺密钥时 real 抛 PROVIDER_NOT_CONFIGURED', async () => {
    delete process.env.LLM_API_KEY
    await assert.rejects(
      () => llm.runTask('nutrition', { qualityHints: {} }, { mode: 'real' }),
      (e) => e.code === 'PROVIDER_NOT_CONFIGURED'
    )
  })

  it('demo 模式不外网，返回 nutrition fixture', async () => {
    delete process.env.LLM_API_KEY
    const out = await llm.runTask('nutrition', {}, { mode: 'demo' })
    assert.equal(out.is_demo, true)
    assert.equal(out.data.status, 'needs_confirmation')
    assert.equal(out.data.is_estimate, true)
    assert.ok(Array.isArray(out.data.items))
  })

  it('nutrition / voice / goal schema 能校验合法样例', () => {
    const nutri = llm.getTaskMeta('nutrition')
    const v1 = validate(llm.REGISTRY.nutrition.demoFixture(), nutri.schema)
    assert.equal(v1.ok, true, v1.errors.join('; '))

    const voiceSample = llm.REGISTRY.voice_structure.normalizeResult({
      session_summary: '本次深蹲为主，组次完成较好。',
      coach_record: '杠铃深蹲 60kg×8×3；表现稳定。',
      exercises: [
        {
          name: '杠铃深蹲',
          sets: [{ weight_kg: 60, reps: 8, set_count: 3 }],
          performance: '整体稳定',
          form_issues: '',
          next_session_suggestion: '可维持当前重量'
        }
      ],
      fatigue_or_discomfort: '',
      coach_feedback: '动作标准，下周维持',
      model_inferences: [],
      needs_confirmation: []
    })
    const v2 = validate(voiceSample, llm.getTaskMeta('voice_structure').schema)
    assert.equal(v2.ok, true, v2.errors.join('; '))

    const goal = llm.REGISTRY.goal_image_spec.demoFixture({ months: 3, nodeKey: 'm3' })
    const v3 = validate(goal, llm.getTaskMeta('goal_image_spec').schema)
    assert.equal(v3.ok, true, v3.errors.join('; '))
  })

  it('chatJson：假客户端返回合法 JSON 并通过 schema', async () => {
    process.env.LLM_API_KEY = 'test-key'
    process.env.LLM_BASE_URL = 'https://example.test/v1'
    client._setConfigForTest({
      configured: true,
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      model: 'fake',
      visionModel: 'fake',
      timeoutMs: 5000,
      enabledTasks: ['nutrition']
    })
    client._setFetchForTest(async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  status: 'needs_confirmation',
                  items: [
                    {
                      food_name: '米饭',
                      portion: { amount: 150, unit: 'g', is_estimated: true },
                      macros_g: { carbs: 40, protein: 4, fat: 1 },
                      basis: 'identified_portion',
                      uncertainties: []
                    }
                  ],
                  total_macros_g: { carbs: 40, protein: 4, fat: 1 },
                  is_estimate: true
                })
              }
            }
          ],
          usage: { total_tokens: 10 }
        })
      }
    }))

    const out = await llm.runTask(
      'nutrition',
      { qualityHints: { has_food: true } },
      { mode: 'real' }
    )
    assert.equal(out.data.status, 'needs_confirmation')
    assert.equal(out.data.total_macros_g.carbs, 40)
  })

  it('schema 无效时重试后仍失败', async () => {
    process.env.LLM_API_KEY = 'test-key'
    client._setConfigForTest({
      configured: true,
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      model: 'fake',
      visionModel: 'fake',
      timeoutMs: 5000,
      enabledTasks: ['nutrition']
    })
    let calls = 0
    client._setFetchForTest(async () => {
      calls += 1
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ status: 'oops' }) } }]
          })
        }
      }
    })
    await assert.rejects(
      () => llm.runTask('nutrition', {}, { mode: 'real' }),
      (e) => e.code === 'LLM_SCHEMA_INVALID' || e.code === 'LLM_JSON_PARSE'
    )
    assert.ok(calls >= 2)
  })

  it('无 LLM_KEY 时语音结构化回退规则引擎（AC11）', async () => {
    delete process.env.LLM_API_KEY
    const parsed = await structureTextWithLlm('50公斤 5次', { taskId: 't1' })
    assert.equal(parsed.schema_version, 'coach_session_summary.v1')
    assert.ok(parsed.segments.length >= 1)
    assert.ok(Array.isArray(parsed.exercises))
    assert.ok(parsed.segments[0].missing_fields.indexOf('set_count') >= 0)
    const rule = structureText('50公斤 5次', { taskId: 't1' })
    assert.deepEqual(parsed.segments[0].missing_fields, rule.segments[0].missing_fields)
  })

  it('无 LLM 时 nutrition real + AI_PROVIDER=mock 仍可用', async () => {
    delete process.env.LLM_API_KEY
    process.env.AI_PROVIDER = 'mock'
    const out = await runNutritionScan({
      mode: 'real',
      qualityHints: { has_food: true }
    })
    assert.equal(out.status, 'needs_confirmation')
    assert.equal(out.is_estimate, true)
  })

  it('demo goal_node 带 goal_image_spec', async () => {
    delete process.env.LLM_API_KEY
    process.env.AI_PROVIDER = 'mock'
    const out = await runGoalNode({
      mode: 'demo',
      nodeKey: 'm3',
      months: 3,
      goalText: '增肌'
    })
    assert.ok(out.result_payload.goal_image_spec)
    assert.equal(out.result_payload.goal_image_spec.months, 3)
    assert.ok(out.watermark_text)
  })
})

function restoreEnv(prev) {
  setOrDel('LLM_API_KEY', prev.key)
  setOrDel('LLM_BASE_URL', prev.base)
  setOrDel('LLM_MODEL', prev.model)
  setOrDel('LLM_ENABLED_TASKS', prev.tasks)
  setOrDel('AI_PROVIDER', prev.ai)
}

function setOrDel(k, v) {
  if (v == null) delete process.env[k]
  else process.env[k] = v
}
