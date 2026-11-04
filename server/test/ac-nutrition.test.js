/**
 * 营养识别：任务 → 确认入库 → 逐条同步；供应商不可用不伪造
 */
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { createTestApp } = require('./helpers')

describe('nutrition_scan · meal item share · auto sync', () => {
  let ctx
  let coach
  let stu
  const prevProvider = process.env.AI_PROVIDER

  before(async () => {
    process.env.AI_PROVIDER = 'mock'
    ctx = createTestApp()
    coach = await ctx.login('coach_approved')
    stu = await ctx.login('student_only')
    await ctx.bindStudent(stu.sessionToken, {
      workout_self: true,
      meal: true,
      body_state: true,
      special: false
    })
  })

  after(async () => {
    if (prevProvider == null) delete process.env.AI_PROVIDER
    else process.env.AI_PROVIDER = prevProvider
    await ctx.cleanup()
  })

  async function uploadFood(token, quality) {
    const intent = await ctx.request('POST', '/api/v1/media/upload-intents', {
      token,
      body: { purpose: 'nutrition_input', mime: 'image/jpeg', size: 100000, is_demo: true }
    })
    assert.equal(intent.status, 200)
    const mediaId = intent.body.data.media_id
    const done = await ctx.request('POST', `/api/v1/media/${mediaId}/complete`, {
      token,
      body: { quality: quality || { has_food: true } }
    })
    assert.equal(done.status, 200)
    return mediaId
  }

  it('demo 识别返回 needs_confirmation，未知不填 0；确认后写入本人饮食', async () => {
    const mediaId = await uploadFood(stu.sessionToken)
    const create = await ctx.request('POST', '/api/v1/ai-tasks', {
      token: stu.sessionToken,
      body: {
        type: 'nutrition_scan',
        mode: 'demo',
        input: { media_id: mediaId, quality_hints: { has_food: true } }
      },
      headers: { 'Idempotency-Key': 'nutri_demo_' + Date.now() }
    })
    assert.equal(create.status, 200)
    assert.equal(create.body.data.status, 'needs_confirmation')
    assert.equal(create.body.data.type, 'nutrition_scan')
    assert.ok(create.body.data.result)
    assert.ok(Array.isArray(create.body.data.result.items))
    assert.equal(create.body.data.result.is_estimate, true)

    const taskId = create.body.data.task_id
    const confirm = await ctx.request('POST', `/api/v1/nutrition-tasks/${taskId}/confirm`, {
      token: stu.sessionToken,
      body: {
        local_date: ctx.time.todayKey(),
        meal_type: 'lunch',
        items: create.body.data.result.items,
        total_macros_g: create.body.data.result.total_macros_g
      },
      headers: { 'Idempotency-Key': 'nutri_confirm_' + taskId }
    })
    assert.equal(confirm.status, 200)
    assert.ok(confirm.body.data.meal)
    assert.equal(confirm.body.data.meal.meal_type, 'lunch')
    assert.equal(confirm.body.data.task.status, 'confirmed')
    assert.equal(confirm.body.data.sync.status, 'none')

    const again = await ctx.request('POST', `/api/v1/nutrition-tasks/${taskId}/confirm`, {
      token: stu.sessionToken,
      body: { local_date: ctx.time.todayKey(), meal_type: 'dinner' },
      headers: { 'Idempotency-Key': 'nutri_confirm_again_' + taskId }
    })
    assert.equal(again.status, 200)
    assert.equal(again.body.data.duplicated, true)
    assert.equal(again.body.data.meal.id, confirm.body.data.meal.id)
  })

  it('模糊／无食物 → need_retake，不返回默认营养数值，不写饮食', async () => {
    const mediaId = await uploadFood(stu.sessionToken, { blurry: true, no_food: true })
    const res = await ctx.request('POST', '/api/v1/ai-tasks', {
      token: stu.sessionToken,
      body: {
        type: 'nutrition_scan',
        mode: 'demo',
        input: {
          media_id: mediaId,
          quality_hints: { blurry: true, no_food: true }
        }
      },
      headers: { 'Idempotency-Key': 'nutri_retake_' + Date.now() }
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.status, 'need_retake')
    const macros = res.body.data.result.total_macros_g
    assert.equal(macros.carbs, null)
    assert.equal(macros.protein, null)
    assert.equal(macros.fat, null)
    assert.equal((res.body.data.result.items || []).length, 0)
  })

  it('供应商 unavailable 时 real 模式失败，不伪造成功', async () => {
    process.env.AI_PROVIDER = 'unavailable'
    const mediaId = await uploadFood(stu.sessionToken)
    const res = await ctx.request('POST', '/api/v1/ai-tasks', {
      token: stu.sessionToken,
      body: {
        type: 'nutrition_scan',
        mode: 'real',
        consent_confirmed: true,
        input: { media_id: mediaId }
      },
      headers: { 'Idempotency-Key': 'nutri_unavail_' + Date.now() }
    })
    process.env.AI_PROVIDER = 'mock'
    assert.equal(res.status, 200)
    assert.equal(res.body.data.status, 'failed')
    assert.ok(
      res.body.data.error &&
        (res.body.data.error.code === 'PROVIDER_NOT_CONFIGURED' ||
          res.body.data.error.code === 'AI_FAILED')
    )
  })

  it('自动同步：开启后确认逐条共享，不静默整天共享其他餐', async () => {
    const date = ctx.time.todayKey()
    const manual = await ctx.request('POST', '/api/v1/meals', {
      token: stu.sessionToken,
      body: { date, mealType: 'breakfast', foodText: '手动燕麦' }
    })
    assert.equal(manual.status, 200)

    const prefs = await ctx.request('PUT', '/api/v1/nutrition-sync-settings', {
      token: stu.sessionToken,
      body: { auto_sync: true }
    })
    assert.equal(prefs.status, 200)
    assert.equal(prefs.body.data.auto_sync, true)
    assert.equal(prefs.body.data.effective_auto_sync, true)

    const mediaId = await uploadFood(stu.sessionToken)
    const create = await ctx.request('POST', '/api/v1/ai-tasks', {
      token: stu.sessionToken,
      body: {
        type: 'nutrition_scan',
        mode: 'demo',
        input: { media_id: mediaId }
      },
      headers: { 'Idempotency-Key': 'nutri_sync_' + Date.now() }
    })
    assert.equal(create.body.data.status, 'needs_confirmation')
    const taskId = create.body.data.task_id
    const confirm = await ctx.request('POST', `/api/v1/nutrition-tasks/${taskId}/confirm`, {
      token: stu.sessionToken,
      body: {
        local_date: date,
        meal_type: 'lunch',
        items: create.body.data.result.items,
        total_macros_g: create.body.data.result.total_macros_g
      },
      headers: { 'Idempotency-Key': 'nutri_sync_confirm_' + taskId }
    })
    assert.equal(confirm.status, 200)
    assert.equal(confirm.body.data.sync.status, 'synced')
    assert.equal(confirm.body.data.meal.sync_status, 'synced')
    assert.equal(confirm.body.data.meal.media_shared, false)

    const coachView = await ctx.request(
      'GET',
      `/api/v1/daily-logs?student_id=${stu.user.userId}&date=${date}`,
      { token: coach.sessionToken }
    )
    assert.equal(coachView.status, 200)
    const meals = coachView.body.data.visible.meals || []
    assert.equal(meals.length, 1)
    assert.ok(meals[0].item_shared)
    assert.equal(meals[0].media_id, null)
    assert.equal(!!coachView.body.data.visible.item_shared_only, true)
    // 未整天共享时，手动早餐不可见
    assert.ok(!meals.some((m) => (m.foodText || m.food_text) === '手动燕麦'))
  })

  it('关闭自动同步只影响后续；撤回逐条共享后教练不可见', async () => {
    const off = await ctx.request('PUT', '/api/v1/nutrition-sync-settings', {
      token: stu.sessionToken,
      body: { auto_sync: false }
    })
    assert.equal(off.status, 200)
    assert.equal(off.body.data.auto_sync, false)

    const date = ctx.time.todayKey()
    const mediaId = await uploadFood(stu.sessionToken)
    const create = await ctx.request('POST', '/api/v1/ai-tasks', {
      token: stu.sessionToken,
      body: {
        type: 'nutrition_scan',
        mode: 'demo',
        input: { media_id: mediaId }
      },
      headers: { 'Idempotency-Key': 'nutri_unshare_' + Date.now() }
    })
    const taskId = create.body.data.task_id
    const confirm = await ctx.request('POST', `/api/v1/nutrition-tasks/${taskId}/confirm`, {
      token: stu.sessionToken,
      body: {
        local_date: date,
        meal_type: 'snack',
        items: create.body.data.result.items,
        total_macros_g: create.body.data.result.total_macros_g
      },
      headers: { 'Idempotency-Key': 'nutri_unshare_confirm_' + taskId }
    })
    assert.equal(confirm.body.data.sync.status, 'none')
    const mealId = confirm.body.data.meal.id

    await ctx.request('POST', `/api/v1/meals/${mealId}/share`, {
      token: stu.sessionToken,
      body: {},
      headers: { 'Idempotency-Key': 'meal_share_' + mealId }
    })
    let coachView = await ctx.request(
      'GET',
      `/api/v1/daily-logs?student_id=${stu.user.userId}&date=${date}`,
      { token: coach.sessionToken }
    )
    assert.ok((coachView.body.data.visible.meals || []).some((m) => m.id === mealId))

    await ctx.request('POST', `/api/v1/meals/${mealId}/unshare`, {
      token: stu.sessionToken,
      body: {}
    })
    coachView = await ctx.request(
      'GET',
      `/api/v1/daily-logs?student_id=${stu.user.userId}&date=${date}`,
      { token: coach.sessionToken }
    )
    const meals = coachView.body.data.visible.meals || []
    assert.ok(!meals.some((m) => m.id === mealId))
  })
})
