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
