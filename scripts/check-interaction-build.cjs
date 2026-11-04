// Run from the repository root. Uses the installed official WeChat compilers.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..', 'miniprogram')
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? files(path.join(dir, item.name)) : [path.join(dir, item.name)]) }
const all = files(root)
let failures = 0
for (const file of all.filter(file => file.endsWith('.json'))) JSON.parse(fs.readFileSync(file, 'utf8'))
for (const file of all.filter(file => file.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (result.status) { failures++; console.error(result.stderr) }
}
const bin = process.env.WECHAT_COMPILER_DIR || 'C:/Program Files (x86)/Tencent/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec'
for (const [exe, extension] of [['wcc.exe', '.wxml'], ['wcsc.exe', '.wxss']]) {
  const args = all.filter(file => file.endsWith(extension)).map(file => path.relative(root, file).replace(/\\/g, '/'))
  const result = spawnSync(path.join(bin, exe), args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  console.log(JSON.stringify({ compiler: exe, files: args.length, exit: result.status, error: result.error && result.error.message, stderr: result.stderr }))
  if (result.status !== 0) failures++
}
console.log('JSON parsed and JavaScript syntax checked; failures=' + failures)
process.exitCode = failures ? 1 : 0
