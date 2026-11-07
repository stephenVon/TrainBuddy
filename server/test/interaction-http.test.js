const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createTestApp } = require('./helpers')
const interaction = require('../../miniprogram/utils/interaction')

test('real HTTP: booking controller keeps a server-pending request pending and deduplicates rapid submission', async () => {
  const ctx = createTestApp()
  try {
    const login = await ctx.login('student_only')
    await ctx.bindStudent(login.sessionToken)
    const slot = await ctx.findOpenSlot(login.sessionToken, 'coach_001')
    let page, calls = 0
    const app = { globalData: { role: 'student', session: login, drafts: {} }, persist() {}, toast() {} }
    const api = { async createBooking(app, payload, key) {
      calls++
      const response = await ctx.request('POST', '/api/v1/bookings', {
        token: login.sessionToken, body: { coach_id: payload.coachId, start_at: payload.startAt, course_type_id: payload.courseTypeId, accepted_rules_version: payload.acceptedRulesVersion }, headers: { 'Idempotency-Key': key }
      })
      if (response.status >= 400) throw response.body.error
      return response.body
    } }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../miniprogram/pages/booking/index.js'), 'utf8'), {
      Page(p) { page = p }, getApp: () => app, wx: { showModal() {} },
      require: id => id.includes('interaction') ? interaction : id.includes('scheduleConfig') ? require('../../miniprogram/utils/scheduleConfig') : id.includes('bookingApi') ? api : {}
    })
    page.setData = function (values) { Object.assign(this.data, values) }; page.refresh = () => {}
    page.setData({ coachId: 'coach_001' })
    await Promise.all([page.submitBookings([slot]), page.submitBookings([slot])])
    assert.equal(calls, 1); assert.equal(page.data.actionState, 'submitted')
    const rows = await ctx.request('GET', '/api/v1/bookings', { token: login.sessionToken })
    const matches = rows.body.data.filter(row => Date.parse(row.start_at) === slot.startAt)
    assert.equal(matches.length, 1); assert.equal(matches[0].status, 'pending')
  } finally { await ctx.cleanup() }
})

test('real HTTP: native workout controller saves decimal sets, advances and finalizes latest revision', async () => {
  const ctx = createTestApp()
  try {
    const login = await ctx.login('student_only')
    const token = login.sessionToken
    const defaultPlan = await ctx.request('POST', '/api/v1/plans/ensure-default', { token, body: {} })
    assert.equal(defaultPlan.status, 200)
    const started = await ctx.request('POST', '/api/v1/plans/' + defaultPlan.body.data.plan_id + '/start-session', {
      token, headers: { 'Idempotency-Key': 'interaction-http-start' }, body: {}
    })
    assert.equal(started.status, 200)
    const app = { globalData: { role: 'student', session: login, drafts: {} }, persist() {}, toast() {} }
    let page, finalizePromise
    const adapt = async (method, url, body, headers) => {
      const response = await ctx.request(method, '/api/v1' + url, { token, body, headers })
      if (response.status >= 400) throw response.body.error
      return response.body
    }
    const api = {
      updateActualSet: (app, sid, setId, patch) => adapt('PATCH', '/sessions/' + sid + '/sets/' + setId, patch),
      finalizeSession: (app, sid, opts) => {
        finalizePromise = adapt('POST', '/sessions/' + sid + '/finalize', { completion_key: opts.completionKey, base_revision: opts.baseRevision, share: false }, { 'Idempotency-Key': opts.completionKey })
        return finalizePromise
      }
    }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../miniprogram/pages/workout/index.js'), 'utf8'), {
      Page(p) { page = p }, getApp: () => app,
      wx: { pageScrollTo() {}, showModal(options) { if (options.title === '结束训练') options.success({ confirm: true }) } },
      require: id => id.includes('interaction') ? interaction : id.includes('trainingApi') ? api : id.includes('planSchedule') ? require('../../miniprogram/utils/planSchedule') : {}
    })
    page.setData = function (values) { Object.assign(this.data, values) }
    page.applySession(started.body.data, true)
    const [first, second] = page.data.session.exercises[0].sets
    const event = (sid, field, value) => ({ currentTarget: { dataset: { sid, field } }, detail: { value } })
    page.onSetField(event(first.id, 'actualWeight', '52.35'))
    page.onSetField(event(first.id, 'actualReps', '6'))
    await page.onSetState({ currentTarget: { dataset: { sid: first.id, state: 'done' } } })
    assert.equal(page.data.activeSid, second.id)
    assert.equal(page.data.session.exercises[0].sets[0].actualWeight, 52.35)
    page.onSetField(event(second.id, 'actualWeight', '47.5'))
    page.onFinish()
    for (let n = 0; n < 100 && !finalizePromise; n++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.ok(finalizePromise, 'finalize requested after flushing local inputs')
    const finalized = await finalizePromise
    assert.equal(finalized.data.session.status, 'completed')
    assert.equal(finalized.data.session.done_sets, 1)
    const fetched = await ctx.request('GET', '/api/v1/sessions/' + started.body.data.session_id, { token })
    assert.equal(fetched.body.data.exercises[0].sets[1].actualWeight, 47.5)
    assert.equal(fetched.body.data.exercises[0].sets[1].state, 'skipped')
  } finally { await ctx.cleanup() }
})
