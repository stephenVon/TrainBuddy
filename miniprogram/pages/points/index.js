const pointsApi = require('../../services/pointsApi')
const time = require('../../utils/time')

const TYPE_LABEL = {
  earn: '获得',
  reserve: '预占',
  spend: '兑换',
  release: '退回',
  refund: '退款',
  adjust: '补偿'
}

Page({
  data: {
    summary: { available: 0, lifetime_earned: 0, lifetime_spent: 0 },
    ledger: [],
    filter: '',
    loading: true,
    error: ''
  },

  onShow() {
    this.load()
  },

  load() {
    this.setData({ loading: true, error: '' })
    Promise.all([pointsApi.summary(), pointsApi.ledger(this.data.filter)])
      .then(([summary, ledger]) => {
        this.setData({
          summary: summary || this.data.summary,
          ledger: (ledger || []).map(presentRow),
          loading: false
        })
      })
      .catch((err) => {
        this.setData({ loading: false, error: (err && err.message) || '积分读取失败，请重试' })
      })
  },

  onFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.type || '' })
    this.load()
  },

  goAchievements() {
    wx.navigateTo({ url: '/pages/achievements/index' })
  },

  goRewards() {
    wx.navigateTo({ url: '/pages/rewards/index' })
  }
})

function presentRow(row) {
  const sign = row.delta > 0 ? '+' : ''
  return {
    ledger_id: row.ledger_id,
    label: TYPE_LABEL[row.type] || row.type,
    deltaText: row.delta ? sign + row.delta : row.type === 'spend' ? '已兑换' : '0',
    timeText: row.created_at ? time.formatDateLabel(time.shanghaiDateKey(row.created_at)) : ''
  }
}
