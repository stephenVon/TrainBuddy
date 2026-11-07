const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const interaction = require('../../miniprogram/utils/interaction')
const clone = value => JSON.parse(JSON.stringify(value))
const event = (dataset, value) => ({ currentTarget: { dataset }, detail: { value } })
const tick = () => new Promise(resolve => setImmediate(resolve))
function setup(name, api = {}) {
  let page
  const app = { globalData: { role: 'student', session: { user: { userId: 's1', displayName: '测试' } }, drafts: {} }, persist() {}, toast() {} }
  const modals = []
  const wx = { showModal(opts) { modals.push(opts) }, pageScrollTo() {}, navigateTo() {} }
  const deps = {
    '../../utils/guard': { requireLogin: () => true }, '../../utils/role': { syncRoleBar() {} },
    '../../utils/interaction': interaction, '../../services/trainingApi': api,
    '../../services/bookingApi': api, '../../services/bindingApi': api,
    '../../utils/time': require('../../miniprogram/utils/time'),
    '../../utils/scheduleConfig': require('../../miniprogram/utils/scheduleConfig'),
    '../../utils/planSchedule': require('../../miniprogram/utils/planSchedule')
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../miniprogram/pages', name, 'index.js'), 'utf8'), {
    Page(p) { page = p }, wx, getApp: () => app, require: id => { if (!(id in deps)) throw Error(id); return deps[id] }
  })
  page.setData = function (data) { Object.assign(this.data, data) }
  return { page, app, modals, wx }
}
function session() { return { session_id: 'session1', revision: 1, status: 'in_progress', exercises: [{ id: 'ex1', sets: [
  { id: 'a', state: 'pending', actualWeight: 50, actualReps: 5 },
  { id: 'b', state: 'pending', actualWeight: 60, actualReps: 4 }
] }] } }
test('number control preserves decimal precision and rejects invalid boundaries', () => {
  assert.equal(interaction.stepValue(52.35, 1, 0, 2000, 2.5), 54.85)
  assert.equal(interaction.stepValue(0, -1, 0, 2000, 2.5), 0)
  assert.equal(interaction.stepValue(1999, 1, 0, 2000, 2.5), 2000)
  assert.equal(interaction.numberValue('52.', 0, 2000, false), 52)
  assert.equal(interaction.numberValue('', 0, 2000, false), null)
  for (const value of ['-1', 'NaN', 'Infinity', '12abc', '52.125', '2001']) assert.throws(() => interaction.numberValue(value, 0, 2000, false))
  assert.throws(() => interaction.numberValue('5.5', 1, 1000, true))
})
test('booking status uses server business status, never a simulated timer', () => {
  assert.equal(interaction.bookingState({ booking_id: 'b1', status: 'pending' }), 'submitted')
  assert.equal(interaction.bookingState({ booking_id: 'b1', status: 'confirmed' }), 'confirmed')
  assert.throws(() => interaction.bookingState({ status: 'pending' }))
  assert.throws(() => interaction.bookingState({ booking_id: 'b1', status: 'cancelled' }))
})
test('rapid booking taps issue one request and pending never becomes confirmed', async () => {
  let calls = 0, resolve
  const ctx = setup('booking', { createBooking() { calls++; return new Promise(r => { resolve = r }) } }), p = ctx.page
  p.setData({ coachId: 'c1' }); p.refresh = () => {}
  const first = p.submitBookings([{ startAt: Date.now() + 60000, courseTypeId: 'course1' }])
  await p.submitBookings([{ startAt: Date.now() + 60000, courseTypeId: 'course1' }])
  assert.equal(calls, 1); assert.equal(p.data.actionState, 'submitting')
  resolve({ data: { booking_id: 'b1', status: 'pending' } }); await first
  assert.equal(p.data.actionState, 'submitted'); assert.equal(p.data.submitting, false)
})
test('network retry preserves booking idempotency key; failures stay visible', async () => {
  const keys = [], ctx = setup('booking', { createBooking(app, body, key) { keys.push(key); return Promise.reject({ code: 'NETWORK', message: '断网' }) } }), p = ctx.page
  p.setData({ coachId: 'c1' })
  await p.submitBookings([{ startAt: 1234, courseTypeId: 'course1' }]); assert.equal(p.data.actionState, 'error')
  assert.match(p.data.bookingError, /断网/)
  await p.submitBookings([{ startAt: 1234, courseTypeId: 'course1' }]); assert.equal(keys[0], keys[1])
  assert.equal(p._bookingBusy, false)
})
test('batch booking continues after conflict and retry never duplicates successful slots', async () => {
  const calls=[]
  let conflict=true
  const ctx=setup('booking',{createBooking(app,body,key){
    calls.push({start:body.startAt,key})
    if(body.startAt===2 && conflict)return Promise.reject({code:'SLOT_CONFLICT',message:'时段冲突'})
    return Promise.resolve({data:{booking_id:'b'+body.startAt,status:'pending'}})
  }}),p=ctx.page
  p.setData({coachId:'c1'});p.refresh=()=>{}
  await p.submitBookings([1,2,3].map(startAt=>({startAt,courseTypeId:'course'})))
  assert.deepEqual(calls.map(x=>x.start),[1,2,3])
  assert.equal(p.data.actionState,'error');assert.equal(p._retryBookingList.length,1)
  assert.equal(p._retryBookingList[0].startAt,2)
  conflict=false;await p.submitBookings(p._retryBookingList)
  assert.deepEqual(calls.map(x=>x.start),[1,2,3,2]);assert.equal(calls[1].key,calls[3].key)
  assert.equal(p.data.actionState,'submitted')
})

test('out-of-order date responses cannot replace the selected date slots', async () => {
  const responses = [], ctx = setup('booking', {
    refreshMe: async () => ({ primaryBinding: { coachId: 'c1', coachName: '教练' } }),
    getSlots() { return new Promise(resolve => responses.push(resolve)) },
    listBookings: async () => ({ data: [] })
  }), p = ctx.page
  p.setData({ selectedDate: '2026-12-01' }); p.refreshStudent(); await tick()
  p.setData({ selectedDate: '2026-12-02' }); p.refreshStudent(); await tick()
  const slot = n => ({ startAt: Date.now() + n, courseTypeId: 'c', status: 'open' })
  responses[1]({ data: { slots: [slot(120000)] } }); await tick()
  const current = p.data.daySlots[0].startAt
  responses[0]({ data: { slots: [slot(60000)] } }); await tick()
  assert.equal(p.data.daySlots[0].startAt, current)
})
test('workout typing persists locally with no request; double completion writes once and advances', async () => {
  let calls = 0, resolve
  const ctx = setup('workout', { updateActualSet(app, id, sid, patch) { calls++; return new Promise(r => { resolve = () => { const s = session(); Object.assign(s.exercises[0].sets[0], patch); s.revision = 2; r({ data: s }) } }) } }), p = ctx.page
  p.applySession(session(), true)
  p.onSetField(event({ sid: 'a', field: 'actualWeight' }, '52.5'))
  assert.equal(calls, 0)
  assert.equal(ctx.app.globalData.drafts[p.draftKey(p.data.session)].payload.a.actualWeight, '52.5')
  const first = p.onSetState(event({ sid: 'a', state: 'done' }))
  await p.onSetState(event({ sid: 'a', state: 'done' }))
  assert.equal(calls, 1); resolve(); await first
  assert.equal(p.data.activeSid, 'b'); assert.equal(p.data.session.exercises[0].sets[0].actualWeight, 52.5)
  assert.equal(p.data.pending.a, undefined)
})
test('failed set save retains raw draft and never advances or marks completion', async () => {
  const ctx = setup('workout', { updateActualSet: async () => { throw Error('网络中断') } }), p = ctx.page
  p.applySession(session(), true); p.onSetField(event({ sid: 'a', field: 'actualReps' }, '8'))
  await p.onSetState(event({ sid: 'a', state: 'done' }))
  assert.equal(p.data.activeSid, 'a'); assert.equal(p.data.pending.a.actualReps, '8')
  assert.equal(p.data.session.exercises[0].sets[0].state, 'pending'); assert.match(p.data.saveError, /网络中断/)
  assert.equal(p.data.savingSet, false)
})
test('invalid or empty completed set is rejected before HTTP; raw input remains', async () => {
  let calls = 0
  const p = setup('workout', { updateActualSet: async () => { calls++ } }).page
  p.applySession(session(), true); p.onSetField(event({ sid: 'a', field: 'actualReps' }, '5.5'))
  await p.onSetState(event({ sid: 'a', state: 'done' }))
  assert.equal(calls, 0); assert.equal(p.data.pending.a.actualReps, '5.5')
})
test('workout reload restores drafts by account and session; previous set can be copied', () => {
  const { page: p, app } = setup('workout')
  p.applySession(session(), true); p.onSetField(event({ sid: 'a', field: 'actualWeight' }, '57.5'))
  p.applySession(session(), true); assert.equal(p.data.session.exercises[0].sets[0].actualWeight, '57.5')
  p.onCopyPrevious(event({ sid: 'b' })); assert.equal(p.data.pending.b.actualWeight, '57.5')
  app.globalData.session.user.userId = 's2'; p.applySession(session(), true)
  assert.equal(p.data.session.exercises[0].sets[0].actualWeight, 50)
})
test('finish flushes drafts sequentially and finalizes with latest returned revision', async () => {
  const order = [], current = session()
  const ctx = setup('workout', {
    async updateActualSet(app, id, sid, patch) { order.push(sid); Object.assign(current.exercises[0].sets.find(s => s.id === sid), patch); current.revision++; return { data: clone(current) } },
    async finalizeSession(app, id, opts) { order.push('finish'); assert.equal(opts.baseRevision, 3); return { data: { session: { done_sets: 0 } } } }
  }), p = ctx.page
  p.applySession(session(), true)
  p.onSetField(event({ sid: 'a', field: 'actualWeight' }, '52.5')); p.onSetField(event({ sid: 'b', field: 'actualReps' }, '6'))
  p.onFinish(); ctx.modals[0].success({ confirm: true }); await tick(); await tick()
  assert.deepEqual(order, ['a', 'b', 'finish']); assert.equal(p.data.session, null)
})
test('plan duplication regenerates all identifiers and sorting keeps set parameters intact', () => {
  const p = setup('plan-edit', { EXERCISE_LIBRARY: [] }).page
  p.onLoad({ id: 'p1' }); p.applyPlan({ can_edit: true, student_id: 's1', latest_draft: { version: 1, revision: 1, exercises: session().exercises } })
  p.onDuplicateExercise(event({ ei: 0 }))
  assert.notEqual(p.data.exercises[0].id, p.data.exercises[1].id)
  assert.notEqual(p.data.exercises[0].sets[0].id, p.data.exercises[1].sets[0].id)
  const copyId = p.data.exercises[1].id
  p.onMove(event({ ei: 1, step: -1 })); assert.equal(p.data.exercises[0].id, copyId)
  p.onDuplicateSet(event({ ei: 0, si: 0 })); assert.equal(p.data.exercises[0].sets.length, 3)
  assert.equal(p.data.exercises[0].sets[0].actualWeight, 50)
})
test('group count is bounded, copies last targets and requires confirmation before truncating', () => {
  const { page: p, modals } = setup('plan-edit', { EXERCISE_LIBRARY: [] })
  p.onLoad({ id: 'p1' }); p.applyPlan({ can_edit: true, student_id: 's1', latest_draft: { version: 1, revision: 1, exercises: [{ id: 'e', sets: [{ id: 's', targetWeight: 52.5, targetReps: 8 }] }] } })
  p.onGroupCount(event({ ei: 0 }, 31)); assert.equal(p.data.exercises[0].sets.length, 1)
  p.onGroupCount(event({ ei: 0 }, 4)); assert.equal(p.data.exercises[0].sets.length, 4)
  assert.equal(p.data.exercises[0].sets[3].targetWeight, 52.5)
  assert.equal(new Set(p.data.exercises[0].sets.map(s => s.id)).size, 4)
  p.onGroupCount(event({ ei: 0 }, 2)); assert.equal(p.data.exercises[0].sets.length, 4)
  modals[0].success({ confirm: false }); assert.equal(p.data.exercises[0].sets.length, 4)
  p.onGroupCount(event({ ei: 0 }, 2)); modals[1].success({ confirm: true })
  assert.equal(p.data.exercises[0].sets.length, 2)
})
test('drag sorts by nearest visible row and retains accessible up/down fallback', () => {
  const { page: p } = setup('plan-edit', { EXERCISE_LIBRARY: [] })
  p.onLoad({ id: 'p1' }); p.applyPlan({ can_edit: true, student_id: 's1', latest_draft: { version: 1, revision: 1, exercises: [{ id: 'a', sets: [] }, { id: 'b', sets: [] }, { id: 'c', sets: [] }] } })
  p._drag = { id: 'c', y: 250, currentY: 145, rects: [{ top: 0, height: 100 }, { top: 100, height: 100 }, { top: 200, height: 100 }] }
  p.onDragEnd(); assert.equal(p.data.exercises[1].id, 'c')
  p.onMove(event({ ei: 1, step: -1 })); assert.equal(p.data.exercises[0].id, 'c')
})
test('component refuses events while disabled and retains partial or invalid numeric input', () => {
  let definition
  const source = fs.readFileSync(path.join(__dirname, '../../miniprogram/components/training-number-control/index.js'), 'utf8')
  vm.runInNewContext(source, { Component(c) { definition = c }, require: () => interaction })
  const events = [], c = Object.assign({ properties: { min: 0, max: 2000, step: 2.5, integer: false, disabled: false }, data: { text: '' }, setData(values) { Object.assign(this.data, values) }, triggerEvent(name, detail) { events.push({ name, detail }) } }, definition.methods)
  c.onInput({ detail: { value: '52.' } }); assert.equal(events[0].detail.value, '52.')
  c.onCommit(); assert.equal(events[1].detail.value, 52)
  c.onInput({ detail: { value: 'wrong' } }); const count = events.length
  c.onCommit(); assert.equal(events.length, count); assert.match(c.data.invalid, /数字/)
  c.properties.disabled = true; c.onStep(event({ direction: 1 })); c.onInput({ detail: { value: '9' } })
  assert.equal(events.length, count)
})
test('booking action button emits only idle/error, never pending or confirmed', () => {
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../miniprogram/components/booking-action-button/index.js'), 'utf8'), { Component(c) { definition = c } })
  let count = 0
  const c = { properties: { disabled: false, state: 'idle' }, triggerEvent() { count++ } }
  for (const state of ['idle', 'submitting', 'submitted', 'confirmed', 'error']) { c.properties.state = state; definition.methods.activate.call(c) }
  assert.equal(count, 2)
  c.properties.disabled = true; definition.methods.activate.call(c); assert.equal(count, 2)
})
