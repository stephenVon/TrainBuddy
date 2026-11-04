// Native interaction helpers; no DOM or animation dependency.
const PREFERENCE_KEY = 'trainbuddy_reduce_motion_v1'
function numberValue(raw, min, max, integer) {
  if (raw === '' || raw == null) return null
  if (!/^\d+(\.\d{0,2})?$/.test(String(raw))) throw Error('请输入有效数字（最多两位小数）')
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw Error('请输入 ' + min + '–' + max + (integer ? ' 的整数' : ' 之间的数值'))
  }
  return value
}
function stepValue(raw, direction, min, max, step) {
  const current = Number(raw)
  return Math.min(max, Math.max(min, Math.round(((Number.isFinite(current) ? current : min) + direction * step) * 100) / 100))
}
function reducedMotion() { try { return !!wx.getStorageSync(PREFERENCE_KEY) } catch (_) { return false } }
function setReducedMotion(value) { wx.setStorageSync(PREFERENCE_KEY, !!value) }
let lastHaptic = 0
function feedback() {
  if (reducedMotion() || Date.now() - lastHaptic < 120) return
  lastHaptic = Date.now()
  try {
    if (typeof wx !== 'undefined' && typeof wx.vibrateShort === 'function') wx.vibrateShort({ type: 'light', fail() {} })
  } catch (_) { /* Feedback must never turn a successful save into a failure. */ }
}
function bookingState(booking) {
  if (!booking || !booking.booking_id) throw Error('服务器未返回预约编号，请查看预约列表后重试')
  if (booking.status === 'confirmed') return 'confirmed'
  if (booking.status === 'pending') return 'submitted'
  throw Error('预约当前状态：' + booking.status + '，请查看预约详情')
}
module.exports = { numberValue, stepValue, reducedMotion, setReducedMotion, feedback, bookingState }
