const os = require('os')
const { loadEnv } = require('./lib/loadEnv')
loadEnv()

const { createApp } = require('./app')
const config = require('./config')
const llm = require('./services/llm')

function lanIPv4() {
  const ifs = os.networkInterfaces()
  for (const list of Object.values(ifs)) {
    for (const row of list || []) {
      if (row && row.family === 'IPv4' && !row.internal) return row.address
    }
  }
  return null
}

const app = createApp()
// 0.0.0.0：允许真机经局域网访问（不仅限本机回环）
app.listen(config.port, '0.0.0.0', () => {
  const lan = lanIPv4()
  console.log(`[trainbuddy-api] http://127.0.0.1:${config.port}/api/v1`)
  if (lan) {
    console.log(`[trainbuddy-api] LAN  http://${lan}:${config.port}/api/v1`)
    console.log(`[trainbuddy-api] health http://${lan}:${config.port}/health`)
  } else {
    console.log(`[trainbuddy-api] health http://127.0.0.1:${config.port}/health`)
  }
  console.log(`[trainbuddy-api] timezone Asia/Shanghai · demo invite LINYE7D`)
  const st = llm.publicStatus()
  console.log(
    `[trainbuddy-api] llm configured=${st.configured} model=${st.model}`
  )
})
