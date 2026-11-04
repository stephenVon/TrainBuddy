const path = require('path')
const express = require('express')
const cors = require('cors')
const { MemoryStore } = require('./store/memoryStore')
const { seed } = require('./seed')
const { attachRequestId, errorHandler } = require('./middleware/errors')
const { buildRouter } = require('./routes')

function createApp(options = {}) {
  const store = options.store || new MemoryStore(options.storeFile)
  if (!store.state.seeded) seed(store)

  const app = express()
  app.locals.store = store

  app.use(cors())
  // 饮食识别会附带压缩后的照片 base64
  app.use(express.json({ limit: '8mb' }))
  app.use(attachRequestId)

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      timezone: 'Asia/Shanghai',
      service: 'trainbuddy-api',
      payment_enabled: require('./config').features.paymentEnabled
    })
  })

  // 最小运营后台静态页
  app.use('/ops', express.static(path.join(__dirname, '..', 'public')))
  app.get('/ops', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'))
  })

  app.use('/api/v1', buildRouter())

  app.use(errorHandler)
  return app
}

module.exports = { createApp }
