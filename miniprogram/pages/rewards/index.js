const pointsApi = require('../../services/pointsApi')

Page({
  data: { items: [], available: 0, loading: true, error: '', busy: false },
  onShow() { this.load() },
  load() {
    this.setData({ loading: true, error: '' })
    Promise.all([pointsApi.summary(), pointsApi.rewards()])
      .then(([summary, items]) => {
        this.setData({
          loading: false,
          available: summary ? summary.available : 0,
          items: items || []
        })
      })
      .catch((err) => this.setData({ loading: false, error: (err && err.message) || '商品读取失败，请重试' }))
  },
  onRedeem(e) {
    if (this.data.busy) return
    const sku = e.currentTarget.dataset.sku
    const item = (this.data.items || []).find((row) => row.sku === sku)
    if (!item) return
    if (this.data.available < item.points_price) {
      this.setData({ error: '积分不足，无法兑换。' })
      return
    }
    wx.showModal({
      title: '确认兑换',
      content: item.title + '\n' + item.description + '\n将扣除 ' + item.points_price + ' 积分。',
      success: (res) => {
        if (!res.confirm) return
        this.setData({ busy: true, error: '' })
        pointsApi.redeem(item.sku, 'redeem_' + item.sku + '_' + Date.now())
          .then((order) => {
            this.setData({ busy: false })
            wx.navigateTo({ url: '/pages/redemption-detail/index?id=' + order.order_id })
          })
          .catch((err) => {
            this.setData({ busy: false, error: (err && err.message) || '兑换失败，请重试' })
          })
      }
    })
  }
})
