const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { createTestApp } = require('./helpers')

describe('Plan editor: real library insertion, ownership, revisions and snapshots', () => {
  let ctx, student, coach, other
  beforeEach(async () => {
    ctx = createTestApp()
    student = await ctx.login('student_only')
    coach = await ctx.login('coach_approved')
    other = await ctx.login('student_claim_coach')
  })
  afterEach(async () => { await ctx.cleanup() })
  const clone = value => JSON.parse(JSON.stringify(value))
  async function add(token = student.sessionToken, key = 'library-add', exercise = 'b932c0ad-233c-4db3-8668-d4d18a81b67c') {
    return ctx.request('POST', '/api/v1/plans/personal/exercises', { token, body: { exercise_id: exercise }, headers: { 'Idempotency-Key': key } })
  }
  async function patch(plan, body, token = student.sessionToken) {
    return ctx.request('PATCH', `/api/v1/plans/${plan.plan_id}/draft`, { token, body: Object.assign({ version: plan.latest_draft.version, base_revision: plan.latest_draft.revision }, body) })
  }
  function complete(plan) {
    const exercises = clone(plan.latest_draft.exercises)
    exercises.forEach(ex => { ex.loadBasis = 'total'; ex.sets.forEach(set => { set.targetWeight = 50; set.targetReps = 5 }) })
    return exercises
  }
  async function publish(plan, token = student.sessionToken, extra = {}) {
    return ctx.request('POST', `/api/v1/plans/${plan.plan_id}/publish`, { token, body: Object.assign({ version: plan.latest_draft.version, base_revision: plan.latest_draft.revision, review_confirmation: true }, extra), headers: { 'Idempotency-Key': 'publish-' + plan.plan_id + '-' + plan.latest_draft.version + '-' + plan.latest_draft.revision + '-' + JSON.stringify(extra) } })
  }
  it('lets a student create and edit their own plan', async () => {
    const created = await ctx.request('POST', '/api/v1/plans', { token: student.sessionToken, body: { title: '学员自建计划' } })
    assert.equal(created.status, 200)
    assert.equal(created.body.data.can_edit, true)
    assert.equal(created.body.data.author_role, 'student')
    assert.equal(created.body.data.latest_draft.title, '学员自建计划')
    const saved = await patch(created.body.data, { goal: '自主训练', reason: '学员编辑' })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.data.latest_draft.goal, '自主训练')
  })
  it('lets the author delete a plan and rejects everyone else', async () => {
    const created = await ctx.request('POST', '/api/v1/plans', { token: student.sessionToken, body: { title: '待删计划' } })
    const planId = created.body.data.plan_id
    await ctx.bindStudent(student.sessionToken)
    assert.equal((await ctx.request('DELETE', `/api/v1/plans/${planId}`, { token: coach.sessionToken })).status, 403)
    assert.equal((await ctx.request('DELETE', `/api/v1/plans/${planId}`, { token: other.sessionToken })).status, 403)
    const removed = await ctx.request('DELETE', `/api/v1/plans/${planId}`, { token: student.sessionToken })
    assert.equal(removed.status, 200)
    assert.equal(removed.body.data.deleted, true)
    assert.equal((await ctx.request('GET', `/api/v1/plans/${planId}`, { token: student.sessionToken })).status, 404)
    const listed = await ctx.request('GET', '/api/v1/plans', { token: student.sessionToken })
    assert.equal((listed.body.data || []).some((item) => item.plan_id === planId), false)
  })
  it('inserts the requested approved exercise into a private personal draft and deduplicates retries', async () => {
    const a = await add(), b = await add()
    assert.equal(a.status, 200); assert.equal(b.status, 200)
    assert.equal(a.body.data.plan_id, b.body.data.plan_id)
    assert.equal(b.body.data.published, null)
    assert.equal(b.body.data.latest_draft.exercises.length, 1)
    assert.equal(b.body.data.latest_draft.exercises[0].exerciseId, 'b932c0ad-233c-4db3-8668-d4d18a81b67c')
    assert.equal(b.body.data.latest_draft.exercises[0].sets[0].targetWeight, null)
    assert.equal(b.body.data.latest_draft.exercises[0].sets[0].targetReps, null)
    const invalid = await add(student.sessionToken, 'unapproved', 'does-not-exist')
    assert.equal(invalid.status, 404)
  })
  it('edits order and independent sets, publishes, then preserves an in-progress session snapshot', async () => {
    let plan = (await add()).body.data
    const exercises = complete(plan)
    exercises[0].sets.push({ targetWeight: 45, targetReps: 8, required: true })
    exercises.unshift({ name: '自定义划船', loadBasis: 'per_side', sets: [{ targetWeight: 12.5, targetReps: 10 }] })
    const saved = await patch(plan, { exercises, title: '自主上肢', reason: '按目标调整' })
    assert.equal(saved.status, 200); plan = saved.body.data
    assert.deepEqual(plan.latest_draft.exercises.map(e => e.order), [1, 2])
    assert.deepEqual(plan.latest_draft.exercises[1].sets.map(s => s.targetWeight), [50, 45])
    assert.equal((await publish(plan)).status, 200)
    const start = await ctx.request('POST', `/api/v1/plans/${plan.plan_id}/start-session`, { token: student.sessionToken, headers: { 'Idempotency-Key': 'snapshot-start' } })
    assert.equal(start.status, 200)
    const catalogEx = start.body.data.exercises.find((ex) => ex.exerciseId === 'b932c0ad-233c-4db3-8668-d4d18a81b67c')
    assert.ok(catalogEx)
    assert.ok(catalogEx.imageUrl && catalogEx.imageUrl.indexOf('https://cdn.jsdelivr.net/') === 0)
    const snapshot = clone(start.body.data.exercises)
    const draft = await ctx.request('PATCH', `/api/v1/plans/${plan.plan_id}/draft`, { token: student.sessionToken, body: { version: plan.latest_draft.version } })
    assert.equal(draft.status, 200); plan = draft.body.data
    const newExercises = clone(plan.latest_draft.exercises)
    newExercises.splice(0, 1); newExercises[0].sets[0].targetWeight = 55
    plan = (await patch(plan, { exercises: newExercises })).body.data
    assert.equal((await publish(plan)).status, 200)
    const session = await ctx.request('GET', `/api/v1/sessions/${start.body.data.session_id}`, { token: student.sessionToken })
    assert.deepEqual(session.body.data.exercises, snapshot)
    assert.equal(session.body.data.plan_revision, 1)
  })
  it('rejects foreign read, edits and publication, including a bound coach editing a learner-owned plan', async () => {
    const plan = (await add()).body.data
    await ctx.bindStudent(student.sessionToken)
    for (const token of [other.sessionToken, coach.sessionToken]) {
      assert.equal((await ctx.request('GET', `/api/v1/plans/${plan.plan_id}`, { token })).status, 403)
      assert.equal((await patch(plan, { title: 'foreign edit' }, token)).status, 403)
      assert.equal((await publish(plan, token)).status, 403)
    }
  })
  it('stale revisions cannot overwrite or publish a newer draft', async () => {
    const original = (await add()).body.data
    const current = (await patch(original, { title: 'new title' })).body.data
    assert.equal((await patch(original, { title: 'stale title' })).status, 409)
    assert.equal((await publish(original)).status, 409)
    const fetched = await ctx.request('GET', `/api/v1/plans/${original.plan_id}`, { token: student.sessionToken })
    assert.equal(fetched.body.data.latest_draft.title, current.latest_draft.title)
  })
  it('validates all fields before mutation and requires complete explicit publication', async () => {
    let plan = (await add()).body.data
    const before = clone(ctx.store.state.training)
    assert.equal((await patch(plan, { plannedDate: '2026-02-30', title: 'must not persist' })).status, 422)
    assert.deepEqual(ctx.store.state.training, before)
    const bad = complete(plan); bad[0].sets[0].targetReps = 2.5
    assert.equal((await patch(plan, { exercises: bad })).status, 422)
    assert.deepEqual(ctx.store.state.training, before)
    assert.equal((await publish(plan)).status, 422)
    plan = (await patch(plan, { exercises: complete(plan) })).body.data
    assert.notEqual((await publish(plan, student.sessionToken, { review_confirmation: false })).status, 200)
    assert.equal((await publish(plan)).status, 200)
  })
  it('publishes a legacy past-dated draft as permanent or weekly', async () => {
    let plan = (await add()).body.data
    const rev = ctx.store.state.training.planRevisions.find((row) => row.planId === plan.plan_id)
    rev.plannedDate = '2020-01-01'
    delete rev.scheduleType
    const exercises = complete(plan)
    plan = (await patch(plan, { exercises, scheduleType: 'permanent', plannedDate: null })).body.data
    const published = await publish(plan)
    assert.equal(published.status, 200)
    assert.equal(published.body.data.published.schedule_type, 'permanent')
    const again = await ctx.request('POST', '/api/v1/plans', { token: student.sessionToken, body: { title: '每周一' } })
    let weekly = again.body.data
    const old = ctx.store.state.training.planRevisions.find((row) => row.planId === weekly.plan_id)
    old.plannedDate = '2020-01-01'
    delete old.scheduleType
    weekly = (await patch(weekly, { exercises, scheduleType: 'weekly', weekdays: [1], plannedDate: null })).body.data
    const weeklyPublished = await publish(weekly)
    assert.equal(weeklyPublished.status, 200)
    assert.equal(weeklyPublished.body.data.published.schedule_type, 'weekly')
    assert.deepEqual(weeklyPublished.body.data.published.weekdays, [1])
  })
  it('lets a published permanent plan start even when planned_date is not today', async () => {
    let plan = (await add()).body.data
    plan = (await patch(plan, { exercises: complete(plan), scheduleType: 'permanent' })).body.data
    assert.equal((await publish(plan)).status, 200)
    const rev = ctx.store.state.training.planRevisions.find((row) => row.planId === plan.plan_id && row.status === 'published')
    rev.plannedDate = '2020-01-01'
    rev.scheduleType = 'permanent'
    const start = await ctx.request('POST', `/api/v1/plans/${plan.plan_id}/start-session`, { token: student.sessionToken, headers: { 'Idempotency-Key': 'perm-start' } })
    assert.equal(start.status, 200)
  })
  it('requires weekly days before publishing a repeating plan', async () => {
    let plan = (await add()).body.data
    plan = (await patch(plan, { exercises: complete(plan), scheduleType: 'weekly', weekdays: [] })).body.data
    assert.equal((await publish(plan)).status, 422)
    plan = (await patch(plan, { scheduleType: 'weekly', weekdays: [1, 3] })).body.data
    assert.equal((await publish(plan)).status, 200)
    const got = await ctx.request('GET', `/api/v1/plans/${plan.plan_id}`, { token: student.sessionToken })
    assert.deepEqual(got.body.data.published.weekdays, [1, 3])
    assert.equal(got.body.data.published.schedule_type, 'weekly')
  })
  it('keeps coach drafts private, exposes only the published revision and revokes edits after unbinding', async () => {
    await ctx.bindStudent(student.sessionToken)
    let response = await ctx.request('POST', '/api/v1/sessions', { token: coach.sessionToken, body: { coachDraft: true, student_id: 'u_stu_001', title: '教练训练' } })
    const sid = response.body.data.session_id
    response = await ctx.request('POST', `/api/v1/sessions/${sid}/exercises`, { token: coach.sessionToken, body: { name: '卧推', sets: 1, reps: 5, weight: 50 } })
    await ctx.request('PATCH', `/api/v1/sessions/${sid}/sets/${response.body.data.exercises[0].sets[0].id}`, { token: coach.sessionToken, body: { actualWeight: 50, actualReps: 5, state: 'done' } })
    response = await ctx.request('POST', `/api/v1/sessions/${sid}/finalize`, { token: coach.sessionToken, body: { share: true, completion_key: 'coach-done' } })
    let plan = response.body.data.next_plan
    assert.ok(plan.latest_draft)
    assert.equal((await ctx.request('GET', `/api/v1/plans/${plan.plan_id}`, { token: student.sessionToken })).status, 403)
    assert.equal((await ctx.request('GET', '/api/v1/plans', { token: student.sessionToken })).body.data.length, 0)
    plan = (await patch(plan, { title: '正式教练计划' }, coach.sessionToken)).body.data
    assert.equal((await publish(plan, coach.sessionToken)).status, 200)
    const revision = await ctx.request('PATCH', `/api/v1/plans/${plan.plan_id}/draft`, { token: coach.sessionToken, body: { title: '未发布修改' } })
    assert.equal(revision.status, 200)
    const seen = await ctx.request('GET', `/api/v1/plans/${plan.plan_id}`, { token: student.sessionToken })
    assert.equal(seen.body.data.latest_draft, null)
    assert.equal(seen.body.data.published.title, '正式教练计划')
    assert.equal((await publish(revision.body.data, student.sessionToken)).status, 403)
    ctx.store.state.bindings.forEach(b => { b.status = 'ended' })
    assert.equal((await patch(revision.body.data, { title: 'after unbind' }, coach.sessionToken)).status, 403)
  })
})
