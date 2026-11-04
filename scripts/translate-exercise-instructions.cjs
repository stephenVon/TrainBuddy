#!/usr/bin/env node
/**
 * 离线生成动作步骤中文映射（方案 1）。
 * 输入：server/src/data/exercise-catalog.json
 * 输出：server/src/data/exercise-instructions-zh.json
 * 按 sourceId 幂等续跑；密钥只读 server/.env，不打印。
 *
 * 用法：node scripts/translate-exercise-instructions.cjs
 * 可选：BATCH=8 DELAY_MS=400 node scripts/translate-exercise-instructions.cjs
 */
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const catalogPath = path.join(root, 'server/src/data/exercise-catalog.json')
const outPath = path.join(root, 'server/src/data/exercise-instructions-zh.json')
const progressPath = path.join(root, 'server/src/data/exercise-instructions-zh.progress.json')

require(path.join(root, 'server/src/lib/loadEnv')).loadEnv(path.join(root, 'server/.env'))

const BATCH = Math.max(1, Math.min(12, Number(process.env.BATCH || 6) || 6))
const DELAY_MS = Math.max(0, Number(process.env.DELAY_MS || 350) || 350)
const MAX_RETRIES = 3

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function saveJson(file, data) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 0) + '\n')
  fs.renameSync(tmp, file)
}

function llmConfig() {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || ''
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '')
  const model = process.env.DEEPSEEK_MODEL || process.env.LLM_MODEL || 'deepseek-chat'
  if (!apiKey) throw new Error('缺少 DEEPSEEK_API_KEY / LLM_API_KEY，无法生成中文步骤映射')
  return { apiKey, baseUrl, model }
}

async function chatJson(messages) {
  const { apiKey, baseUrl, model } = llmConfig()
  const res = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages
    })
  })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch (_) { body = { raw: text } }
  if (!res.ok) {
    const msg = (body && body.error && body.error.message) || text.slice(0, 200)
    const err = new Error('LLM_HTTP_' + res.status + ': ' + msg)
    err.status = res.status
    throw err
  }
  const content = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content
  if (!content) throw new Error('LLM 返回空内容')
  return JSON.parse(content)
}

function validateBatch(batch, translated) {
  const byId = new Map((translated.items || []).map((row) => [row.sourceId, row.instructions]))
  const out = {}
  for (const item of batch) {
    const steps = byId.get(item.sourceId)
    if (!Array.isArray(steps) || steps.length !== item.instructions.length) {
      throw new Error('步骤数量不匹配: ' + item.sourceId)
    }
    const cleaned = steps.map((s) => String(s || '').trim()).filter(Boolean)
    if (cleaned.length !== item.instructions.length) throw new Error('存在空步骤: ' + item.sourceId)
    if (cleaned.some((s) => /[A-Za-z]{6,}/.test(s) && /should|your|the |with |from /i.test(s))) {
      // 允许肌肉解剖等专有词，但拒绝明显未翻译英文句
      const enHeavy = cleaned.filter((s) => ((s.match(/[A-Za-z]+/g) || []).join('').length) > s.length * 0.45)
      if (enHeavy.length > cleaned.length * 0.5) throw new Error('中文不足: ' + item.sourceId)
    }
    out[item.sourceId] = cleaned
  }
  return out
}

async function translateBatch(batch) {
  const payload = batch.map((item) => ({
    sourceId: item.sourceId,
    name: item.name,
    instructions: item.instructions
  }))
  const result = await chatJson([
    {
      role: 'system',
      content:
        '你是健身动作教学文案译者。把英文动作步骤译成简体中文，供中国学员阅读。' +
        '要求：1) 只返回 JSON；2) 结构为 {"items":[{"sourceId":"","instructions":["..."]}]}；' +
        '3) 每个动作的 instructions 条数必须与输入完全一致且顺序相同；' +
        '4) 用语自然、专业、简洁，不要夹杂英文整句；专有器械名可保留常见中文译法；' +
        '5) 不要添加原文没有的安全警告或额外步骤。'
    },
    {
      role: 'user',
      content: JSON.stringify({ items: payload })
    }
  ])
  return validateBatch(batch, result)
}

async function main() {
  const catalog = loadJson(catalogPath, null)
  if (!catalog || !Array.isArray(catalog.items)) throw new Error('找不到动作目录 ' + catalogPath)

  const existing = loadJson(outPath, { version: 1, source: catalog.source, items: {} })
  if (!existing.items) existing.items = {}
  const progress = loadJson(progressPath, { failed: [], updatedAt: null })

  const pending = catalog.items.filter((item) => {
    const mapped = existing.items[item.sourceId]
    return !(Array.isArray(mapped) && mapped.length === (item.instructions || []).length)
  })

  console.log('total=' + catalog.items.length + ' done=' + (catalog.items.length - pending.length) + ' pending=' + pending.length + ' batch=' + BATCH)

  let ok = 0
  let fail = 0
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH)
    let translated = null
    let lastError = null
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        translated = await translateBatch(batch)
        break
      } catch (err) {
        lastError = err
        const wait = err.status === 429 ? 20000 * attempt : 1200 * attempt
        console.warn('batch ' + (Math.floor(i / BATCH) + 1) + ' attempt ' + attempt + ' failed: ' + err.message)
        await sleep(wait)
      }
    }
    if (!translated) {
      fail += batch.length
      progress.failed = Array.from(new Set((progress.failed || []).concat(batch.map((b) => b.sourceId))))
      saveJson(progressPath, progress)
      console.error('skip failed batch starting ' + batch[0].sourceId + ': ' + (lastError && lastError.message))
      continue
    }
    Object.assign(existing.items, translated)
    existing.generatedAt = new Date().toISOString()
    existing.count = Object.keys(existing.items).length
    progress.failed = (progress.failed || []).filter((id) => !translated[id])
    progress.updatedAt = existing.generatedAt
    saveJson(outPath, existing)
    saveJson(progressPath, progress)
    ok += batch.length
    const finished = catalog.items.length - pending.length + ok
    console.log('saved ' + finished + '/' + catalog.items.length + ' (+' + batch.length + ')')
    if (DELAY_MS) await sleep(DELAY_MS)
  }

  const missing = catalog.items.filter((item) => !existing.items[item.sourceId]).map((i) => i.sourceId)
  console.log(JSON.stringify({
    written: outPath,
    mapped: Object.keys(existing.items).length,
    newlyTranslated: ok,
    failedThisRun: fail,
    stillMissing: missing.length
  }))
  if (missing.length) process.exitCode = 2
}

main().catch((err) => {
  console.error(err.message || err)
  process.exitCode = 1
})
