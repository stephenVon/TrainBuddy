/**
 * Obsolete: Precision Daylight migration.
 * Current product palette is warm natural green (see miniprogram/styles/tokens.wxss).
 * Kept as a no-op so accidental runs do not reintroduce blue daylight colors.
 */
console.log(JSON.stringify({
  skipped: true,
  reason: 'Daylight theme disabled; use green tokens in styles/tokens.wxss'
}, null, 2))
