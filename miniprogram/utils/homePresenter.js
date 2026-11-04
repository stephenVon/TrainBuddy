// Present existing API data; do not invent scheduled workouts or performance.
function trainingOverview(active, plans, today, sessions) {
  const published = (plans || []).filter((plan) => plan.published)
  const planned = published.find((plan) => plan.published.planned_date === today) || null
  const completedToday = (sessions || []).filter(
    (row) =>
      row.status === 'completed' &&
      row.business_date === today &&
      row.source_type === 'from_plan'
  )
  const donePlanIds = {}
  completedToday.forEach((row) => {
    if (row.plan_id) donePlanIds[row.plan_id] = row
  })
  const plannedDone = !!(planned && donePlanIds[planned.plan_id])
  const content = active || (planned && planned.published)
  const exercises = content ? content.exercises || [] : []
  const total = exercises.reduce((count, exercise) => count + (exercise.sets || []).length, 0)
  const doneSession = plannedDone ? donePlanIds[planned.plan_id] : null
  return {
    activeSession: active || null,
    todayPlan: planned,
    todayPlanDone: plannedDone,
    trainingTitle: content ? content.title : '还没有今日训练计划',
    trainingSubtitle: content
      ? exercises
          .map((ex) => ex.name)
          .slice(0, 3)
          .join(' / ')
      : '选择已有计划，或从动作库编排你的训练。',
    exerciseCount: exercises.length,
    totalSets: total,
    doneSets: active
      ? active.done_sets || 0
      : doneSession
        ? doneSession.done_sets || 0
        : 0,
    progressPercent: active && total
      ? Math.min(100, Math.round(((active.done_sets || 0) / total) * 100))
      : plannedDone
        ? 100
        : 0,
    trainingAction: active
      ? '继续训练'
      : plannedDone
        ? '今日已完成'
        : planned
          ? '开始训练'
          : '选择训练计划',
    planCount: published.length
  }
}
function upcoming(bookings, now) {
  return (
    (bookings || [])
      .filter((row) => ['pending', 'confirmed'].includes(row.status) && row.startAt > now)
      .sort((a, b) => a.startAt - b.startAt)[0] || null
  )
}
module.exports = { trainingOverview, upcoming }
