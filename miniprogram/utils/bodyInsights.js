const bodyApi = require('../services/bodyMeasurementApi')
const time = require('./time')

/** 数值升高通常表示围度/重量增加；不把升降映射为健康好坏 */
const SIZE_METRICS = {
  weight: 1,
  targetWeight: 1,
  bodyFat: 1,
  waist: 1,
  hip: 1,
  chest: 1,
  neck: 1,
  shoulder: 1,
  shoulderWidth: 1,
  muscleMass: 0,
  height: 0
}

function chartView(records, key, unit, period, start, end, today) {
  const metric = bodyApi.METRICS.find((item) => item.key === key) || bodyApi.METRICS[0]
  const factor = metric.unit === 'kg' && unit === 'jin' ? 2 : 1
  const unitLabel = metric.unit === 'kg' ? (factor === 2 ? '斤' : '公斤') : metric.unit
  const to = end || today
  const from = start || time.addDays(to, 1 - ({ day: 1, week: 7, month: 30, year: 365 }[period] || 30))
  const rows = records
    .filter((row) => row.date >= from && row.date <= to)
    .map((row) =>
      Object.assign({}, row, {
        values: Object.assign({}, row.values, {
          [metric.key]: row.values[metric.key] == null ? null : row.values[metric.key] * factor
        })
      })
    )
  const trend = bodyApi.trend(rows, metric.key)
  if (!trend.count) {
    return Object.assign({}, trend, {
      metric: Object.assign({}, metric, { unit: unitLabel }),
      dots: [],
      lines: [],
      labels: [],
      axes: [],
      from,
      to,
      latest: '—',
      previous: '—',
      average: '—',
      previousChange: '—',
      previousChangeLabel: '至少两次记录后显示变化',
      changeTone: 'flat',
      changeDirection: 'none'
    })
  }

  const values = trend.dots.map((point) => point.value)
  const span = Math.max(trend.max - trend.min, metric.unit === '%' ? 1 : 0.5)
  const low = trend.min - span * 0.2
  const high = trend.max + span * 0.2
  const dots = trend.dots.map((point) =>
    Object.assign({}, point, {
      x: Number((12 + ((point.x - 10) / 580) * 398).toFixed(2)),
      y: Number((270 - ((point.value - low) / (high - low)) * 240).toFixed(2)),
      label: Number(point.value.toFixed(2)),
      showLabel: false
    })
  )
  dots.forEach((point, index) => {
    point.showLabel =
      index === 0 ||
      index === dots.length - 1 ||
      index % Math.max(1, Math.ceil(dots.length / 5)) === 0
  })
  const lines = dots.slice(1).map((point, index) => {
    const previous = dots[index]
    const dx = point.x - previous.x
    const dy = point.y - previous.y
    return {
      id: point.id,
      style:
        'left:' +
        previous.x +
        'rpx;top:' +
        previous.y +
        'rpx;width:' +
        Math.sqrt(dx * dx + dy * dy) +
        'rpx;transform:rotate(' +
        (Math.atan2(dy, dx) * 180) / Math.PI +
        'deg)'
    }
  })
  const previousValue = values.length > 1 ? values[values.length - 2] : null
  const delta =
    previousValue == null ? null : Number((trend.latest - previousValue).toFixed(2))
  const labels = dots
    .filter(
      (point, index) =>
        index === 0 ||
        index === dots.length - 1 ||
        (dots.length > 4 && index === Math.floor(dots.length / 2))
    )
    .map((point) => ({
      id: point.id,
      text: point.date.slice(5).replace('-', '/'),
      x: point.x
    }))

  let changeTone = 'flat'
  let changeDirection = 'none'
  let previousChangeLabel = '需至少两次记录'
  if (delta == null) {
    previousChangeLabel = '需至少两次记录'
  } else if (delta === 0) {
    previousChangeLabel = '与上次相同'
    changeTone = 'flat'
  } else {
    changeDirection = delta > 0 ? 'up' : 'down'
    changeTone = changeDirection
    const abs = Math.abs(delta)
    const suffix = key === 'bodyFat' ? ' 个百分点' : ' ' + unitLabel
    previousChangeLabel =
      (delta > 0 ? '较上次增加 ' : '较上次减少 ') + abs + suffix
  }

  return Object.assign({}, trend, {
    metric: Object.assign({}, metric, { unit: unitLabel }),
    dots,
    lines,
    labels,
    from,
    to,
    latest: Number(Number(trend.latest).toFixed(2)),
    previous: previousValue == null ? '—' : Number(previousValue.toFixed(2)),
    average: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
    previousChange: delta == null ? '—' : (delta > 0 ? '+' : '') + delta,
    previousChangeLabel,
    changeTone,
    changeDirection,
    sizeMetric: !!SIZE_METRICS[key],
    axes: Array.from({ length: 5 }, (_, index) => ({
      key: index,
      y: 30 + index * 60,
      value: Number((high - ((high - low) * index) / 4).toFixed(2))
    }))
  })
}

function moveMonth(month, step) {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + step, 1))
  return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0')
}

/** 展示用周柱：按本周最大组数归一，零值保留底座；不改服务端 sets 口径 */
function presentWeekBars(bars) {
  const rows = Array.isArray(bars) ? bars : []
  const max = rows.reduce((m, row) => Math.max(m, Number(row.sets) || 0), 0)
  return rows.map((row) => {
    const sets = Number(row.sets) || 0
    return Object.assign({}, row, {
      displayHeight: max ? Math.max(12, Math.round((sets / max) * 160)) : 8,
      isZero: sets === 0,
      valueLabel: sets ? String(sets) : ''
    })
  })
}

/**
 * 从已完成会话中提取近期最高负荷卡片。
 * 仅使用 actualWeight/actualReps 真实字段；无线上成绩则返回空。
 */
function recentLoadHighlights(sessions) {
  const best = {}
  ;(sessions || []).forEach((session) => {
    ;(session.exercises || []).forEach((exercise) => {
      ;(exercise.sets || []).forEach((set) => {
        if (set.state && set.state !== 'done' && set.state !== 'completed') return
        const weight = set.actualWeight
        const reps = set.actualReps
        if (weight == null || reps == null) return
        const name = exercise.name || '动作'
        const prev = best[name]
        if (
          !prev ||
          weight > prev.weight ||
          (weight === prev.weight && reps > prev.reps)
        ) {
          best[name] = {
            id: name + '_' + (session.business_date || session.session_id || ''),
            name,
            weight,
            reps,
            date: session.business_date || '',
            text: name + ' · ' + weight + 'kg × ' + reps
          }
        }
      })
    })
  })
  return Object.values(best)
    .sort((a, b) => b.weight - a.weight || b.reps - a.reps)
    .slice(0, 3)
}

module.exports = { chartView, moveMonth, presentWeekBars, recentLoadHighlights }
