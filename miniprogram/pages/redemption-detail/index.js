const pointsApi = require('../../services/pointsApi')

const STATUS = {
  reserved: '已预占',
  fulfilling: '交付中',
  fulfilled: '已完成',
  failed: '交付失败，积分已退回',
  needs_review: '等待人工核对，不会重复发放'
}

Page({
  data: { order: null, error: '' },
  onLoad(query) {
    this.orderId = query.id
    this.load()
  },
  load() {
    if (!this.orderId) {
      this.setData({ error: '缺少订单编号' })
      return
    }
    this.setData({ error: '' })
    pointsApi.order(this.orderId)
      .then((order) => {
        const ref = order.fulfillment_ref
        let detail = ''
        if (ref && ref.plan_id) detail = '已创建计划草稿 ' + ref.plan_id
        else if (ref && ref.feature) detail = '已发放 ' + ref.feature + ' 额度'
        else if (ref && ref.subscription_id) detail = '已开通会员资格'
        this.setData({
          order: {
            sku: order.sku,
            points_price: order.points_price,
            statusText: STATUS[order.status] || order.status,
            failure_code: order.failure_code,
            detail
          }
        })
      })
      .catch((err) => this.setData({ error: (err && err.message) || '订单读取失败，请重试' }))
  }
})
