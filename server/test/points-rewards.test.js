const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { createTestApp } = require('./helpers')

describe('points, achievements, redemptions', () => {
  let ctx
  let stu
  let coach
  let ops

  before(async () => {
    ctx = createTestApp()
    stu = await ctx.login('student_only')
    coach = await ctx.login('coach_approved')
    ops = await ctx.login('ops_admin')
  })

  after(async () => {
    await ctx.cleanup()
  })

  async function completePlanSession(dateKey) {
    const plan = await ctx.request('POST', '/api/v1/plans/ensure-default', { token: stu.sessionToken })
    assert.equal(plan.status, 200, JSON.stringify(plan.body))
    const started = await ctx.request('POST', '/api/v1/plans/' + plan.body.data.plan_id + '/start-session', {
      token: stu.sessionToken,
      headers: { 'Idempotency-Key': 'pts_start_' + dateKey + '_' + Math.random() }
    })
    assert.equal(started.status, 200, JSON.stringify(started.body))
    const sid = started.body.data.session_id
    const setId = started.body.data.exercises[0].sets[0].id
    const patched = await ctx.request('PATCH', '/api/v1/sessions/' + sid + '/sets/' + setId, {
      token: stu.sessionToken,
      body: { state: 'done', actualWeight: 20, actualReps: 8 }
    })
    assert.equal(patched.status, 200, JSON.stringify(patched.body))
    const row = ctx.store.state.training.sessions.find((item) => item.id === sid)
    row.businessDate = dateKey
    const fin = await ctx.request('POST', '/api/v1/sessions/' + sid + '/finalize', {
      token: stu.sessionToken,
      body: { share: false, completion_key: 'pts_fin_' + dateKey },
      headers: { 'Idempotency-Key': 'pts_fin_' + dateKey }
    })
    assert.equal(fin.status, 200, JSON.stringify(fin.body))
    return { sid, fin }
  }

  it('rewards a published plan session once and ignores ineligible sessions', async () => {
    const day = ctx.time.addDays(ctx.time.todayKey(), -9)
    const first = await completePlanSession(day)
    assert.equal(first.fin.body.data.reward.awarded, true)
    assert.equal(first.fin.body.data.reward.points, 10)
    const again = await ctx.request('POST', '/api/v1/sessions/' + first.sid + '/finalize', {
      token: stu.sessionToken,
      body: { share: false, completion_key: 'pts_fin_' + day },
      headers: { 'Idempotency-Key': 'pts_fin_again_' + day }
    })
    assert.equal(again.status, 200)
    assert.equal(again.body.data.reward.already, true)
    const earns = ctx.store.state.points.ledger.filter(
      (row) => row.sourceType === 'training_completed' && row.sourceId === first.sid
    )
    assert.equal(earns.length, 1)

    const draft = await ctx.request('POST', '/api/v1/sessions', {
      token: coach.sessionToken,
      body: { coachDraft: true, student_id: 'u_stu_001', title: '自由课' },
      headers: { 'Idempotency-Key': 'pts_free' }
    })
    const sid = draft.body.data.session_id
    await ctx.request('POST', '/api/v1/sessions/' + sid + '/exercises', {
      token: coach.sessionToken,
      body: { name: '深蹲', sets: 1, reps: 5, weight: 20 }
    })
    const cur = await ctx.request('GET', '/api/v1/sessions/' + sid, { token: coach.sessionToken })
    const setId = cur.body.data.exercises[0].sets[0].id
    await ctx.request('PATCH', '/api/v1/sessions/' + sid + '/sets/' + setId, {
      token: coach.sessionToken,
      body: { state: 'done', actualWeight: 20, actualReps: 5 }
    })
    const before = (await ctx.request('GET', '/api/v1/points', { token: stu.sessionToken })).body.data.available
    const free = await ctx.request('POST', '/api/v1/sessions/' + sid + '/finalize', {
      token: coach.sessionToken,
      body: { share: true, completion_key: 'pts_free_fin' }
    })
    assert.equal(free.status, 200)
    assert.equal(free.body.data.reward.awarded, false)
    const after = (await ctx.request('GET', '/api/v1/points', { token: stu.sessionToken })).body.data.available
    assert.equal(after, before)

    const empty = await ctx.request('POST', '/api/v1/plans/ensure-default', { token: stu.sessionToken })
    const started = await ctx.request('POST', '/api/v1/plans/' + empty.body.data.plan_id + '/start-session', {
      token: stu.sessionToken,
      headers: { 'Idempotency-Key': 'pts_zero' }
    })
    const zero = await ctx.request('POST', '/api/v1/sessions/' + started.body.data.session_id + '/finalize', {
      token: stu.sessionToken,
      body: { completion_key: 'pts_zero_fin' }
    })
    assert.equal(zero.status, 400)
    assert.equal(zero.body.error.code, 'NO_COMPLETED_SETS')
    await ctx.request('POST', '/api/v1/sessions/' + started.body.data.session_id + '/abandon', {
      token: stu.sessionToken
    })
  })

  it('grants count and streak achievements without double credit', async () => {
    for (let i = 8; i >= 0; i--) {
      await completePlanSession(ctx.time.addDays(ctx.time.todayKey(), -i))
    }
    const view = await ctx.request('GET', '/api/v1/achievements', { token: stu.sessionToken })
    const byKey = {}
    view.body.data.forEach((item) => {
      byKey[item.key] = item
    })
    assert.equal(byKey.first_plan_training.earned, true)
    assert.equal(byKey.plan_training_10.earned, true)
    assert.equal(byKey.plan_streak_3.earned, true)
    assert.equal(byKey.booking_no_show_streak_2.visibility, 'self')
    const coachView = await ctx.request('GET', '/api/v1/achievements', { token: coach.sessionToken })
    const coachStreak = coachView.body.data.find((item) => item.key === 'plan_streak_3')
    assert.equal(coachStreak.earned, false)
    const trainingEarns = ctx.store.state.points.ledger.filter((row) => row.sourceType === 'training_completed')
    assert.equal(trainingEarns.length, 10)
  })

  it('rewards booking completion once and keeps no-show from changing points', async () => {
    await ctx.bindStudent(stu.sessionToken)
    const before = (await ctx.request('GET', '/api/v1/points', { token: stu.sessionToken })).body.data.available
    const slot = await ctx.findOpenSlot(stu.sessionToken, 'coach_001')
    const created = await ctx.request('POST', '/api/v1/bookings', {
      token: stu.sessionToken,
      body: {
        coach_id: 'coach_001',
        start_at: slot.startAt,
        course_type_id: 'private_strength_60',
        accepted_rules_version: ctx.config.schedule.rulesVersion
      },
      headers: { 'Idempotency-Key': 'pts_book' }
    })
    assert.equal(created.status, 200, JSON.stringify(created.body))
    const id = created.body.data.booking_id
    const accepted = await ctx.request('POST', '/api/v1/bookings/' + id + '/accept', {
      token: coach.sessionToken,
      body: { revision: created.body.data.revision },
      headers: { 'Idempotency-Key': 'pts_acc' }
    })
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body))
    const started = await ctx.request('POST', '/api/v1/bookings/' + id + '/attendance', {
      token: coach.sessionToken,
      body: { status: 'in_progress' },
      headers: { 'Idempotency-Key': 'pts_att_start' }
    })
    assert.equal(started.status, 200, JSON.stringify(started.body))
    const denied = await ctx.request('POST', '/api/v1/bookings/' + id + '/attendance', {
      token: stu.sessionToken,
      body: { status: 'completed' },
      headers: { 'Idempotency-Key': 'pts_att_student' }
    })
    assert.equal(denied.status, 403)
    const done = await ctx.request('POST', '/api/v1/bookings/' + id + '/attendance', {
      token: coach.sessionToken,
      body: { status: 'completed' },
      headers: { 'Idempotency-Key': 'pts_att_done' }
    })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.equal(done.body.data.reward.points, 20)
    const mid = (await ctx.request('GET', '/api/v1/points', { token: stu.sessionToken })).body.data.available
    assert.equal(mid, before + 30)

    const slot2 = await ctx.findOpenSlot(stu.sessionToken, 'coach_001')
    const missed = await ctx.request('POST', '/api/v1/bookings', {
      token: stu.sessionToken,
      body: {
        coach_id: 'coach_001',
        start_at: slot2.startAt,
        course_type_id: 'private_strength_60',
        accepted_rules_version: ctx.config.schedule.rulesVersion
      },
      headers: { 'Idempotency-Key': 'pts_miss_1' }
    })
    await ctx.request('POST', '/api/v1/bookings/' + missed.body.data.booking_id + '/accept', {
      token: coach.sessionToken,
      body: { revision: missed.body.data.revision },
      headers: { 'Idempotency-Key': 'pts_miss_acc_1' }
    })
    await ctx.request('POST', '/api/v1/bookings/' + missed.body.data.booking_id + '/attendance', {
      token: coach.sessionToken,
      body: { status: 'no_show' },
      headers: { 'Idempotency-Key': 'pts_miss_att_1' }
    })
    const slot3 = await ctx.findOpenSlot(stu.sessionToken, 'coach_001')
    const missed2 = await ctx.request('POST', '/api/v1/bookings', {
      token: stu.sessionToken,
      body: {
        coach_id: 'coach_001',
        start_at: slot3.startAt,
        course_type_id: 'private_strength_60',
        accepted_rules_version: ctx.config.schedule.rulesVersion
      },
      headers: { 'Idempotency-Key': 'pts_miss_2' }
    })
    await ctx.request('POST', '/api/v1/bookings/' + missed2.body.data.booking_id + '/accept', {
      token: coach.sessionToken,
      body: { revision: missed2.body.data.revision },
      headers: { 'Idempotency-Key': 'pts_miss_acc_2' }
    })
    await ctx.request('POST', '/api/v1/bookings/' + missed2.body.data.booking_id + '/attendance', {
      token: coach.sessionToken,
      body: { status: 'no_show' },
      headers: { 'Idempotency-Key': 'pts_miss_att_2' }
    })
    const afterMiss = (await ctx.request('GET', '/api/v1/points', { token: stu.sessionToken })).body.data.available
    assert.equal(afterMiss, mid)
    const ach = await ctx.request('GET', '/api/v1/achievements', { token: stu.sessionToken })
    const negative = ach.body.data.find((item) => item.key === 'booking_no_show_streak_2')
    assert.equal(negative.earned, true)
    assert.equal(negative.point_reward, 0)
  })

  it('rejects other roles from adjustments and records an ops adjustment', async () => {
    const denied = await ctx.request('POST', '/api/v1/admin/points/adjustments', {
      token: stu.sessionToken,
      body: { user_id: 'u_stu_001', delta: 5, ticket_id: 'TKT-PTS', reason: 'no' }
    })
    assert.equal(denied.status, 403)
    const before = (await ctx.request('GET', '/api/v1/points', { token: stu.sessionToken })).body.data.available
    const adjusted = await ctx.request('POST', '/api/v1/admin/points/adjustments', {
      token: ops.sessionToken,
      body: { user_id: 'u_stu_001', delta: 5, ticket_id: 'TKT-PTS', reason: '补偿' }
    })
    assert.equal(adjusted.status, 200, JSON.stringify(adjusted.body))
    const after = (await ctx.request('GET', '/api/v1/points', { token: stu.sessionToken })).body.data.available
    assert.equal(after, before + 5)
    const audits = await ctx.request('GET', '/api/v1/admin/audits?ticket_id=TKT-PTS', { token: ops.sessionToken })
    assert.ok(audits.body.data.some((row) => row.action === 'points_adjust'))
  })

  it('redeems a plan draft once, refunds a failed fulfillment, and does not repeat an uncertain grant', async () => {
    const short = await ctx.request('POST', '/api/v1/redemptions', {
      token: stu.sessionToken,
      body: { sku: 'missing' },
      headers: {}
    })
    assert.equal(short.status, 422)

    const broke = await ctx.request('POST', '/api/v1/redemptions', {
      token: coach.sessionToken,
      body: { sku: 'plan_draft' },
      headers: { 'Idempotency-Key': 'pts_poor' }
    })
    assert.equal(broke.status, 422)

    const order = await ctx.request('POST', '/api/v1/redemptions', {
      token: stu.sessionToken,
      body: { sku: 'plan_draft' },
      headers: { 'Idempotency-Key': 'pts_plan' }
    })
    assert.equal(order.status, 200, JSON.stringify(order.body))
    assert.equal(order.body.data.status, 'fulfilled')
    assert.ok(order.body.data.fulfillment_ref.plan_id)
    const replay = await ctx.request('POST', '/api/v1/redemptions', {
      token: stu.sessionToken,
      body: { sku: 'plan_draft' },
      headers: { 'Idempotency-Key': 'pts_plan' }
    })
    assert.equal(replay.body.data.order_id, order.body.data.order_id)
    const foreign = await ctx.request('GET', '/api/v1/redemptions/' + order.body.data.order_id, {
      token: coach.sessionToken
    })
    assert.equal(foreign.status, 404)

    ctx.store.state.rewards.catalog.push({
      sku: 'fail_once',
      title: '失败商品',
      description: '测试履约失败',
      pointsPrice: 10,
      fulfillmentType: 'fail_closed',
      fulfillmentPayload: {},
      enabled: true,
      startsAt: null,
      endsAt: null,
      perUserLimit: null,
      stock: null,
      revision: 1
    })
    const avail = (await ctx.request('GET', '/api/v1/points', { token: stu.sessionToken })).body.data.available
    const failed = await ctx.request('POST', '/api/v1/redemptions', {
      token: stu.sessionToken,
      body: { sku: 'fail_once' },
      headers: { 'Idempotency-Key': 'pts_fail' }
    })
    assert.equal(failed.body.data.status, 'failed')
    const restored = (await ctx.request('GET', '/api/v1/points', { token: stu.sessionToken })).body.data.available
    assert.equal(restored, avail)

    ctx.store.state.rewards.catalog.push({
      sku: 'hold_once',
      title: '待核验',
      description: '结果不确定',
      pointsPrice: 10,
      fulfillmentType: 'needs_review',
      fulfillmentPayload: {},
      enabled: true,
      startsAt: null,
      endsAt: null,
      perUserLimit: null,
      stock: null,
      revision: 1
    })
    const held = await ctx.request('POST', '/api/v1/redemptions', {
      token: stu.sessionToken,
      body: { sku: 'hold_once' },
      headers: { 'Idempotency-Key': 'pts_hold' }
    })
    assert.equal(held.body.data.status, 'needs_review')
    const retry = await ctx.request('POST', '/api/v1/admin/redemptions/' + held.body.data.order_id + '/retry', {
      token: ops.sessionToken,
      body: { ticket_id: 'TKT-RDM', reason: '核对后完成' }
    })
    assert.equal(retry.body.data.status, 'fulfilled')
    const again = await ctx.request('POST', '/api/v1/admin/redemptions/' + held.body.data.order_id + '/retry', {
      token: ops.sessionToken,
      body: { ticket_id: 'TKT-RDM-2', reason: '再次重试' }
    })
    assert.equal(again.body.data.fulfillment_ref.id, retry.body.data.fulfillment_ref.id)
    const spends = ctx.store.state.points.ledger.filter(
      (row) => row.type === 'spend' && row.relatedOrderId === held.body.data.order_id
    )
    assert.equal(spends.length, 1)
  })

  it('grants nutrition credits and a membership without creating a payment', async () => {
    const enable = (sku) => ctx.request('PATCH', '/api/v1/admin/rewards/' + sku, {
      token: ops.sessionToken,
      body: { ticket_id: 'TKT-' + sku, reason: '测试上架', patch: { enabled: true } }
    })
    assert.equal((await enable('nutrition_scan_3')).status, 200)
    assert.equal((await enable('membership_30d')).status, 200)
    const before = await ctx.request('GET', '/api/v1/entitlements', { token: stu.sessionToken })
    const scanBefore = before.body.data.features.find((item) => item.feature === 'nutrition_scan').available
    const nutrition = await ctx.request('POST', '/api/v1/redemptions', {
      token: stu.sessionToken,
      body: { sku: 'nutrition_scan_3' },
      headers: { 'Idempotency-Key': 'pts_scan' }
    })
    assert.equal(nutrition.body.data.status, 'fulfilled', JSON.stringify(nutrition.body))
    const after = await ctx.request('GET', '/api/v1/entitlements', { token: stu.sessionToken })
    const scanAfter = after.body.data.features.find((item) => item.feature === 'nutrition_scan').available
    assert.equal(scanAfter, scanBefore + 3)
    const member = await ctx.request('POST', '/api/v1/redemptions', {
      token: stu.sessionToken,
      body: { sku: 'membership_30d' },
      headers: { 'Idempotency-Key': 'pts_member' }
    })
    assert.equal(member.body.data.status, 'fulfilled', JSON.stringify(member.body))
    const entitlements = await ctx.request('GET', '/api/v1/entitlements', { token: stu.sessionToken })
    assert.equal(entitlements.body.data.subscription.source, 'points_redemption')
  })
})
