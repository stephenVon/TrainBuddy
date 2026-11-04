// Start local API and prepare the native mini program's LAN configuration.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const rows = Object.entries(os.networkInterfaces()).flatMap(([name, items]) =>
  (items || []).filter(row => row.family === 'IPv4' && !row.internal && !row.address.startsWith('169.254.') &&
    !/virtual|vEthernet|VPN|docker|loopback/i.test(name)).map(row => ({ name, address: row.address })))
rows.sort((a, b) => Number(/wi-fi|wlan|无线/i.test(b.name)) - Number(/wi-fi|wlan|无线/i.test(a.name)))
const address = process.env.TB_DEV_HOST || (rows[0] && rows[0].address) || '127.0.0.1'
if (!/^[a-zA-Z0-9.-]+$/.test(address)) throw new Error('Invalid TB_DEV_HOST')
const port = Number(process.env.PORT || 8787)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
const file = path.join(root, 'miniprogram/config.generated.js')
const previous = fs.existsSync(file) ? require(file) : {}
fs.writeFileSync(file, 'module.exports = ' + JSON.stringify(Object.assign({}, previous, {
  develop: `http://${address}:${port}/api/v1`
}), null, 2) + '\n')
console.log(`Local API: http://${address}:${port}/api/v1 — recompile the mini program`)
const server = spawn(process.execPath, [path.join(root, 'server/src/server.js')], {
  cwd: path.join(root, 'server'), env: Object.assign({}, process.env, { PORT: String(port) }), stdio: 'inherit'
})
server.on('error', error => { console.error(error.message); process.exitCode = 1 })
server.on('exit', code => { process.exitCode = code == null ? 1 : code })
