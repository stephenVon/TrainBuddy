#!/usr/bin/env node
/**
 * 从 OpenPersonalTraining 的 seed-exercises.ts 生成练搭子动作库 JSON。
 * 数据源：yuhonas/free-exercise-db（Unlicense）；参考实现 MIT。
 * 重复执行覆盖同一输出文件，条目以 source_id 为自然键。
 */
const fs = require('node:fs')
const path = require('node:path')

const SOURCE = process.argv[2] || path.resolve(
  __dirname,
  '../../onepersonTraining/OpenPersonalTraining-main/src/server/seed-exercises.ts'
)
const OUT = process.argv[3] || path.resolve(__dirname, '../server/src/data/exercise-catalog.json')
const IMAGE_COMMIT = 'b0eed061e1c832b3ed815fbaa4b45b3cdc14df49'

const MUSCLE_GROUP = {
  waist: '核心',
  'upper legs': '下肢',
  'lower legs': '下肢',
  chest: '上肢',
  back: '上肢',
  shoulders: '上肢',
  'upper arms': '上肢',
  'lower arms': '上肢',
  neck: '上肢',
  cardio: '全身'
}

function splitInstructions(text) {
  return String(text || '')
    .split(/(?<=\.)\s+/)
    .map((row) => row.trim())
    .filter(Boolean)
}

function parseSecondary(raw) {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

function mapRow(row) {
  const [id, sourceId, name, bodyPart, target, equipment, secondaryRaw, instructions, image] = row
  const normalizedEquipment = String(equipment || '').trim() || 'none'
  return {
    id,
    sourceId,
    name,
    aliases: [],
    muscleGroup: MUSCLE_GROUP[bodyPart] || '全身',
    bodyPart: bodyPart || '',
    target: target || '',
    equipment: normalizedEquipment,
    secondaryMuscles: parseSecondary(secondaryRaw),
    metricType: normalizedEquipment === 'body only' || normalizedEquipment === 'none' ? 'reps' : 'weight_reps',
    instructions: splitInstructions(instructions),
    mediaRef: image || '',
    reviewStatus: 'approved',
    origin: 'free-exercise-db'
  }
}

if (!fs.existsSync(SOURCE)) {
  console.error('找不到参考种子文件：' + SOURCE)
  process.exit(1)
}

const text = fs.readFileSync(SOURCE, 'utf8')
const marker = 'export const EXERCISE_SEED'
const start = text.indexOf(marker)
if (start < 0) {
  console.error('未找到 EXERCISE_SEED')
  process.exit(1)
}
const bracket = text.indexOf('= [', start)
if (bracket < 0) {
  console.error('未找到 EXERCISE_SEED 数组')
  process.exit(1)
}
const end = text.indexOf('\n];', bracket)
if (end < 0) {
  console.error('未找到 EXERCISE_SEED 结束位置')
  process.exit(1)
}
const rows = Function('return (' + text.slice(bracket + 2, end + 2) + ')')()
const bySource = new Map()
rows.forEach((row) => {
  const item = mapRow(row)
  bySource.set(item.sourceId, item)
})
const items = Array.from(bySource.values()).sort((a, b) => a.name.localeCompare(b.name, 'en'))

const payload = {
  source: 'github.com/yuhonas/free-exercise-db',
  license: 'Unlicense',
  referenceImplementation: 'OpenPersonalTraining (MIT)',
  imageCdn: 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@' + IMAGE_COMMIT + '/exercises',
  imageCommit: IMAGE_COMMIT,
  reviewStatus: 'approved',
  reviewReason: '公开领域动作库导入，作为学员教学目录的已审核参考内容；自定义动作不写入本目录。',
  importedAt: '2026-11-04',
  items
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(payload))
console.log('wrote ' + items.length + ' exercises → ' + OUT)
