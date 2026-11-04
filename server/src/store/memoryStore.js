/**
 * 文件持久化 JSON 存储 + 同步互斥（演示级事务）
 * 正式环境可换 PostgreSQL 事务；语义保持不变。
 */

const fs = require('fs')
const path = require('path')
const config = require('../config')

function emptyState() {
  return {
    users: [],
    userRoles: [],
    sessions: {}, // token -> { userId, createdAt, expiresAt }
    invitations: [],
    bindings: [],
    friends: { invitations: [], relations: [], comments: [] },
    schedule: {
      rulesByCoach: {},
      exceptions: [],
      bookings: [],
      changes: []
    },
    training: {
      plans: [],
      planRevisions: [],
      sessions: [],
      finalizeKeys: {}
    },
    diary: {
      dailyLogs: [],
      meals: [],
      waters: [],
      bodyStates: [],
      feedbacks: [],
      dayShares: {}
    },
    notifications: [],
    voice: { tasks: [], mergeLog: [] },
    media: { assets: [], cleanupTasks: [] },
    ai: { tasks: [], ledger: [], callbackDedup: {} },
    posture: { reports: [] },
    goals: { groups: [] },
    consultations: [],
    nutritionPrefs: {},
    entitlements: {
      balances: [],
      ledger: [],
      subscriptions: []
    },
    outbox: [],
    ops: { audits: [], config: {} },
    idempotency: {},
    exerciseMeta: { favorites: {}, reviews: {} },
    customExercises: [],
    seeded: false
  }
}

class MemoryStore {
  constructor(filePath) {
    this.filePath = filePath || config.storeFile
    this.state = emptyState()
    this._queue = Promise.resolve()
    this.load()
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8')
        this.state = Object.assign(emptyState(), JSON.parse(raw))
      }
    } catch (e) {
      this.state = emptyState()
    }
  }

  persist() {
    const dir = path.dirname(this.filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const tmp = this.filePath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8')
    fs.renameSync(tmp, this.filePath)
  }

  /** 串行事务：同一时刻只有一个写路径 */
  async tx(fn) {
    const run = this._queue.then(async () => {
      const result = await fn(this.state)
      this.persist()
      return result
    })
    this._queue = run.catch(() => {})
    return run
  }

  reset() {
    this.state = emptyState()
    this.persist()
  }
}

module.exports = { MemoryStore, emptyState }
