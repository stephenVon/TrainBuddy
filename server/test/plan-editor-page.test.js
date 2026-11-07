const { it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const clone = value => JSON.parse(JSON.stringify(value))
function setup() {
  let page, writes = [], publications = [], messages = []
  const app = { globalData: { role: 'student', session: { user: { userId: 'student' } }, drafts: {} }, persist() {}, toast(text) { messages.push(text) } }
  const plan = { plan_id: 'p1', student_id: 'student', can_edit: true, author_role: 'student', current_published_revision: null, published: null, latest_draft: { version: 1, revision: 2, title: '计划', goal: '', planned_date: '2026-12-01', reason: '', exercises: [{ id: 'e1', name: '卧推', loadBasis: 'total', sets: [{ id: 's1', targetWeight: 50, targetReps: 5 }] }] } }
  const api = {
    EXERCISE_LIBRARY: [], getPlan: async () => ({ data: clone(plan) }),
    updatePlanDraft: async (app, id, body) => {
      writes.push(clone(body))
      Object.assign(plan.latest_draft, { revision: 3, exercises: clone(body.exercises), title: body.title, planned_date: body.plannedDate })
      return { data: clone(plan) }
    },
    publishPlan: async (app, id, opts) => { publications.push(opts); plan.published = clone(plan.latest_draft); plan.latest_draft = null; return { data: clone(plan) } }
  }
  const source = fs.readFileSync(path.join(__dirname, '../../miniprogram/pages/plan-edit/index.js'), 'utf8')
  vm.runInNewContext(source, { Page: p => { page = p }, getApp: () => app, wx: { showModal: opts => opts.success({ confirm: true }) }, require: id => id.includes('guard') ? { requireLogin: () => true } : id.includes('interaction') ? require('../../miniprogram/utils/interaction') : api })
  page.setData = function (values) { Object.assign(this.data, values) }
  page.onLoad({ id: 'p1' }); page.applyPlan(clone(plan))
  return { page, api, app, plan, writes, publications, messages }
}
const event = (dataset, value) => ({ currentTarget: { dataset }, detail: { value } })
it('plan editor keeps typing local and publishes the final values using the saved revision', async () => {
  const ctx = setup(), p = ctx.page
  p.onSet(event({ ei: 0, si: 0, field: 'targetWeight' }, '52.5'))
  p.onSet(event({ ei: 0, si: 0, field: 'targetReps' }, '8'))
  assert.equal(ctx.writes.length, 0)
  await p.save(true)
  assert.equal(ctx.writes[0].exercises[0].sets[0].targetWeight, 52.5)
  assert.equal(ctx.writes[0].exercises[0].sets[0].targetReps, 8)
  assert.equal(ctx.publications[0].baseRevision, 3)
  assert.equal(p.data.saving, false)
  assert.equal(p.data.draft, null)
})
it('version conflicts retain local content and prevent publishing', async () => {
  const ctx = setup(), p = ctx.page
  p.onField(event({ field: 'title' }, '未保存内容'))
  ctx.api.updatePlanDraft = async () => { throw { code: 'REVISION_CONFLICT', message: '草稿已更新' } }
  await p.save(true)
  assert.equal(p.data.title, '未保存内容')
  assert.equal(p.data.conflict, true)
  assert.equal(ctx.publications.length, 0)
  assert.equal(p.data.saving, false)
})
it('library picks append named exercises without typing', () => {
  const ctx = setup(), p = ctx.page
  p.addLibraryExercises([{ id: 'squat', name: '杠铃深蹲', icon: '🏋️', defaultSets: 4, defaultReps: 10, defaultWeight: 60 }])
  assert.equal(p.data.exercises.length, 2)
  assert.equal(p.data.exercises[1].name, '杠铃深蹲')
  assert.equal(p.data.exercises[1].loadBasis, 'total')
  assert.equal(p.data.exercises[1].sets.length, 4)
  assert.equal(p.data.changed, true)
})
it('bodyweight library picks select 自重 and still allow extra weight', () => {
  const ctx = setup(), p = ctx.page
  p.addLibraryExercises([{ id: 'situp', name: '仰卧起坐', equipment: 'body only', metricType: 'reps', defaultSets: 3, defaultReps: 15 }])
  const added = p.data.exercises[1]
  assert.equal(added.loadBasis, 'bodyweight')
  assert.equal(added.basisOptions.find((item) => item.on).key, 'bodyweight')
  assert.equal(added.sets[0].targetWeight, 0)
  assert.equal(added.sets[0].targetReps, 15)
  p.onSet(event({ ei: 1, si: 0, field: 'targetWeight' }, '5'))
  assert.equal(p.data.exercises[1].sets[0].targetWeight, '5')
  assert.equal(p.data.exercises[1].sets[2].targetWeight, '5')
})
it('first set targets fill later sets until a later set is customized', () => {
  const ctx = setup(), p = ctx.page
  p.onGroupCount(event({ ei: 0 }, 3))
  p.onSet(event({ ei: 0, si: 0, field: 'targetWeight' }, '40'))
  p.onSet(event({ ei: 0, si: 0, field: 'targetReps' }, '8'))
  assert.equal(p.data.exercises[0].sets[2].targetWeight, '40')
  assert.equal(p.data.exercises[0].sets[2].targetReps, '8')
  p.onSet(event({ ei: 0, si: 1, field: 'targetWeight' }, '45'))
  p.onSet(event({ ei: 0, si: 0, field: 'targetWeight' }, '50'))
  assert.equal(p.data.exercises[0].sets[1].targetWeight, '45')
  assert.equal(p.data.exercises[0].sets[2].targetWeight, '50')
})
it('removing a set updates group count', () => {
  const ctx = setup(), p = ctx.page
  p.onGroupCount(event({ ei: 0 }, 3))
  p.setData({ sheetIndex: 0 })
  p.onRemoveSet(event({ ei: 0, si: 2 }))
  assert.equal(p.data.exercises[0].sets.length, 2)
  assert.equal(p.data.exercises[0].sets[1].setNo, 2)
})
it('frequent chips only include recent catalog exercises and do not pad presets', async () => {
  const ctx = setup(), p = ctx.page
  ctx.api.listSessions = async () => ({ data: [{ exercises: [
    { exerciseId: 'squat', name: '杠铃深蹲' },
    { exerciseId: 'b932c0ad-233c-4db3-8668-d4d18a81b67c', name: '杠铃弯举' }
  ] }] })
  ctx.api.listPlansForStudent = async () => ({ data: [] })
  await p.loadFrequent()
  assert.equal(p.data.frequent.length, 1)
  assert.equal(p.data.frequent[0].id, 'b932c0ad-233c-4db3-8668-d4d18a81b67c')
  assert.equal(p.data.frequent[0].name, '杠铃弯举')
})
it('title chips reuse previous names and custom text input', () => {
  const ctx = setup(), p = ctx.page
  p._titlePresets = ['下肢力量', '我的训练计划']
  p.onPickTitle(event({ label: '下肢力量' }))
  assert.equal(p.data.title, '下肢力量')
  assert.equal(p.data.titleCustom, false)
  p.onPickTitle(event({ label: '自定义' }))
  assert.equal(p.data.titleCustom, true)
  p.onField(event({ field: 'title' }, '晨间力量'))
  assert.equal(p.data.title, '晨间力量')
})
it('schedule chips switch among permanent, range and weekly days', () => {
  const ctx = setup(), p = ctx.page
  p.onScheduleMode(event({ key: 'permanent' }))
  assert.equal(p.data.scheduleType, 'permanent')
  p.onScheduleMode(event({ key: 'repeat' }))
  p.onToggleWeekday(event({ value: 1 }))
  assert.equal(p.data.scheduleType, 'weekly')
  assert.equal(JSON.stringify(p.data.weekdays), '[1]')
  assert.equal(p.snapshot().scheduleType, 'weekly')
})
it('cached plan edits are isolated by account, role and subject', async () => {
  const ctx = setup(), p = ctx.page
  p.onField(event({ field: 'title' }, '本地个人草稿'))
  ctx.app.globalData.role = 'coach'
  await p.reload()
  assert.equal(p.data.title, '计划')
  ctx.app.globalData.role = 'student'
  await p.reload()
  assert.equal(p.data.title, '本地个人草稿')
})
