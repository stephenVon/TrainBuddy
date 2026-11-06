const { requireLogin } = require('../../utils/guard')
const bodyApi = require('../../services/bodyMeasurementApi')
const insights = require('../../utils/bodyInsights')
const time = require('../../utils/time')

Page({
  data: {
    metric: bodyApi.METRICS[0],
    range: '90',
    chart: insights.chartView([], 'weight', 'kg', 'month', '', '', time.todayKey()),
    history: [],
    loading: true,
    error: '',
    ranges: [
      { key: '30', label: '30 天' },
      { key: '90', label: '90 天' },
      { key: 'all', label: '全部' }
    ]
  },
  onLoad(query) {
    const metric = bodyApi.METRICS.find((item) => item.key === query.key) || bodyApi.METRICS[0]
    this.setData({ metric })
    wx.setNavigationBarTitle({ title: metric.label })
  },
  onShow() {
    if (requireLogin(this)) this.reload()
  },
  reload() {
    const owner = getApp().globalData.session.user.userId
    this.rows = []
    this.setData({
      loading: true,
      error: '',
      history: [],
      chart: insights.chartView([], this.data.metric.key, 'kg', 'month', '', '', time.todayKey())
    })
    return bodyApi
      .list()
      .then((res) => {
        const session = getApp().globalData.session
        if (!session || session.user.userId !== owner) return
        this.rows = res.data || []
        this.render()
      })
      .catch((err) => this.setData({ error: err.message || '读取失败，请重试' }))
      .then(() => this.setData({ loading: false }))
  },
  render() {
    const today = time.todayKey()
    const start = this.data.range === 'all' ? '2000-01-01' : time.addDays(today, 1 - Number(this.data.range))
    const key = this.data.metric.key
    const chart = insights.chartView(this.rows || [], key, 'kg', 'month', start, today, today)
    const rows = (this.rows || []).filter(
      (row) => (!start || row.date >= start) && row.values[key] != null
    )
    this.setData({
      chart,
      history: rows
        .slice()
        .reverse()
        .map((row) => ({
          id: row.id || row.date,
          date: row.date,
          time: row.time || '时间未记录',
          value: row.values[key]
        }))
    })
  },
  onRange(e) {
    this.setData({ range: e.currentTarget.dataset.range })
    this.render()
  },
  onRecord() {
    wx.navigateTo({ url: '/pages/body-record/index?key=' + this.data.metric.key })
  }
})
