/**
 * 轻量加载 server/.env（不依赖 dotenv 包）
 * 已存在的 process.env 不被覆盖；不打印密钥值
 */

const fs = require('fs')
const path = require('path')

function loadEnv(filePath) {
  const file =
    filePath || path.join(__dirname, '..', '..', '.env')
  if (!fs.existsSync(file)) return { loaded: false, path: file }
  const text = fs.readFileSync(file, 'utf8')
  let count = 0
  text.split(/\n/).forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const eq = trimmed.indexOf('=')
    if (eq <= 0) return
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = val
      count += 1
    }
  })
  return { loaded: true, path: file, keysSet: count }
}

module.exports = { loadEnv }
