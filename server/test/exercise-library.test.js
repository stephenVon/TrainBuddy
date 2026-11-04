const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { createTestApp } = require('./helpers')
const exerciseService = require('../src/services/exerciseService')
const { IMAGE_COMMIT, exerciseImageUrl } = require('../src/lib/exerciseImage')

describe('exercise library import', () => {
  test('seed is idempotent by sourceId and keeps pending items out of the student catalog', async () => {
    const ctx = createTestApp()
    try {
      const first = exerciseService.seedExerciseCatalog(ctx.store.state)
      const second = exerciseService.seedExerciseCatalog(ctx.store.state)
      assert.equal(first.idempotent, true)
      assert.equal(second.count, first.count)
      assert.ok(first.approved >= 800)
      assert.equal(first.count, second.count)
      const student = await ctx.login('student_only', 'student')
      const listed = await ctx.request('GET', '/api/v1/exercises?limit=100', { token: student.sessionToken })
      assert.equal(listed.status, 200)
      assert.ok(listed.body.total >= 800)
      assert.equal(listed.body.page, 1)
      assert.equal(listed.body.limit, 100)
      assert.ok(!listed.body.data.some((row) => row.id === 'draft_unreviewed' || /未审核/.test(row.name)))
      assert.ok(!listed.body.data.some((row) => row.origin === 'custom'))
    } finally {
      await ctx.cleanup()
    }
  })

  test('search, body part, equipment filters and facets work', async () => {
    const ctx = createTestApp()
    try {
      const student = await ctx.login('student_only', 'student')
      const barbell = await ctx.request('GET', '/api/v1/exercises?search=Barbell%20Curl&limit=20', { token: student.sessionToken })
      assert.equal(barbell.status, 200)
      assert.ok(barbell.body.data.length >= 1)
      assert.ok(barbell.body.data.some((row) => /弯举/.test(row.name) || /barbell curl/i.test(row.nameEn)))

      const chest = await ctx.request('GET', '/api/v1/exercises?body_part=chest&limit=10', { token: student.sessionToken })
      assert.equal(chest.status, 200)
      assert.ok(chest.body.total > 0)
      chest.body.data.forEach((row) => assert.equal(row.bodyPart, 'chest'))

      const machines = await ctx.request('GET', '/api/v1/exercises?equipment=barbell&limit=10', { token: student.sessionToken })
      assert.equal(machines.status, 200)
      machines.body.data.forEach((row) => assert.equal(row.equipment, 'barbell'))

      const lower = await ctx.request('GET', '/api/v1/exercises?muscleGroup=' + encodeURIComponent('下肢') + '&limit=5', { token: student.sessionToken })
      assert.equal(lower.status, 200)
      lower.body.data.forEach((row) => assert.equal(row.muscleGroup, '下肢'))

      const facets = await ctx.request('GET', '/api/v1/exercises/facets', { token: student.sessionToken })
      assert.equal(facets.status, 200)
      assert.ok(facets.body.data.body_parts.some((item) => item.value === 'chest'))
      assert.ok(facets.body.data.equipment.some((item) => item.value === 'dumbbell'))
      assert.ok(facets.body.data.muscleGroups.some((item) => (item.value || item) === '上肢'))
    } finally {
      await ctx.cleanup()
    }
  })

  test('detail returns Chinese name, steps, CDN image; old curated ids are gone; pending is hidden', async () => {
    const ctx = createTestApp()
    try {
      const student = await ctx.login('student_only', 'student')
      const listed = await ctx.request('GET', '/api/v1/exercises?search=Barbell%20Deadlift&limit=5', { token: student.sessionToken })
      const row = listed.body.data.find((item) => item.sourceId === 'Barbell_Deadlift') || listed.body.data[0]
      assert.ok(row)
      const detail = await ctx.request('GET', '/api/v1/exercises/' + row.id, { token: student.sessionToken })
      assert.equal(detail.status, 200)
      assert.ok(Array.isArray(detail.body.data.instructions) && detail.body.data.instructions.length > 0)
      assert.ok(/[\u4e00-\u9fff]/.test(detail.body.data.name))
      assert.ok(detail.body.data.instructions.every((line) => /[\u4e00-\u9fff]/.test(line)))
      assert.equal(detail.body.data.instructions[0], '站在装有杠铃片的杠铃前。')
      assert.ok(detail.body.data.imageUrl.indexOf('https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@' + IMAGE_COMMIT) === 0)
      assert.equal(detail.body.data.imageUrl, exerciseImageUrl(detail.body.data.mediaRef))
      assert.equal(detail.body.data.reviewStatus, 'approved')

      const removed = await ctx.request('GET', '/api/v1/exercises/bench', { token: student.sessionToken })
      assert.equal(removed.status, 404)
      const oldSquat = await ctx.request('GET', '/api/v1/exercises/squat', { token: student.sessionToken })
      assert.equal(oldSquat.status, 404)
      const page = await ctx.request('GET', '/api/v1/exercises?limit=30', { token: student.sessionToken })
      assert.ok(page.body.data.every((row) => row.id !== 'squat' && row.id !== 'bench' && row.id !== 'rdl' && row.id !== 'hip_thrust' && row.id !== 'core'))

      const hidden = await ctx.request('GET', '/api/v1/exercises/draft_unreviewed', { token: student.sessionToken })
      assert.equal(hidden.status, 404)
    } finally {
      await ctx.cleanup()
    }
  })

  test('custom exercises in store never appear in the public teaching list', async () => {
    const ctx = createTestApp()
    try {
      ctx.store.state.customExercises.push({
        id: 'custom_secret',
        sourceId: 'custom:secret',
        name: '私有弹力带实验',
        origin: 'custom',
        reviewStatus: 'approved',
        muscleGroup: '上肢',
        equipment: 'bands'
      })
      const student = await ctx.login('student_only', 'student')
      const listed = await ctx.request('GET', '/api/v1/exercises?search=' + encodeURIComponent('私有弹力带') , { token: student.sessionToken })
      assert.equal(listed.body.total, 0)
      const detail = await ctx.request('GET', '/api/v1/exercises/custom_secret', { token: student.sessionToken })
      assert.equal(detail.status, 404)
    } finally {
      await ctx.cleanup()
    }
  })
})
