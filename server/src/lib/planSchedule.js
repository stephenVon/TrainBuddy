function pick(obj, camel, snake, fallback) {
  if (!obj) return fallback
  if (obj[camel] != null && obj[camel] !== '') return obj[camel]
  if (snake && obj[snake] != null && obj[snake] !== '') return obj[snake]
  return fallback
}

function weekdayMon1(dateKey) {
  const d = new Date(String(dateKey) + 'T12:00:00+08:00')
  if (!Number.isFinite(d.getTime())) return 0
  const day = d.getUTCDay()
  return day === 0 ? 7 : day
}

function monthDay(dateKey) {
  return Number(String(dateKey).slice(8, 10))
}

function scheduleType(pub) {
  return pick(pub, 'scheduleType', 'schedule_type', 'once') || 'once'
}

function isOpenOnDate(pub, dateKey) {
  if (!pub || !dateKey) return false
  const type = scheduleType(pub)
  if (type === 'permanent') return true
  if (type === 'range') {
    const start = pick(pub, 'plannedDate', 'planned_date', '')
    const end = pick(pub, 'scheduleEnd', 'schedule_end', start)
    return !!(start && end && start <= dateKey && dateKey <= end)
  }
  if (type === 'weekly') {
    const days = pick(pub, 'weekdays', 'weekdays', []) || []
    return days.indexOf(weekdayMon1(dateKey)) >= 0
  }
  if (type === 'monthly') {
    const days = pick(pub, 'monthDays', 'month_days', []) || []
    return days.indexOf(monthDay(dateKey)) >= 0
  }
  return pick(pub, 'plannedDate', 'planned_date', '') === dateKey
}

module.exports = { isOpenOnDate, scheduleType, weekdayMon1 }
