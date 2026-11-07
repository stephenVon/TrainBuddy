const { test } = require('node:test')
const assert = require('node:assert/strict')
const { isOpenOnDate, scheduleType } = require('../src/lib/planSchedule')
const client = require('../../miniprogram/utils/planSchedule')

test('permanent plans are open every day', () => {
  assert.equal(isOpenOnDate({ scheduleType: 'permanent' }, '2026-11-07'), true)
  assert.equal(client.isOpenOnDate({ schedule_type: 'permanent' }, '2020-01-01'), true)
})

test('legacy once plans only open on planned_date', () => {
  const pub = { planned_date: '2026-11-07' }
  assert.equal(scheduleType(pub), 'once')
  assert.equal(isOpenOnDate(pub, '2026-11-07'), true)
  assert.equal(isOpenOnDate(pub, '2026-11-08'), false)
})

test('range weekly and monthly match the selected days', () => {
  assert.equal(isOpenOnDate({ scheduleType: 'range', plannedDate: '2026-11-01', scheduleEnd: '2026-11-10' }, '2026-11-07'), true)
  assert.equal(isOpenOnDate({ scheduleType: 'range', plannedDate: '2026-11-01', scheduleEnd: '2026-11-10' }, '2026-11-11'), false)
  assert.equal(isOpenOnDate({ schedule_type: 'weekly', weekdays: [6] }, '2026-11-07'), true)
  assert.equal(isOpenOnDate({ scheduleType: 'weekly', weekdays: [1] }, '2026-11-07'), false)
  assert.equal(isOpenOnDate({ scheduleType: 'monthly', monthDays: [7] }, '2026-11-07'), true)
  assert.equal(client.scheduleLabel({ schedule_type: 'permanent' }), '永久')
})
