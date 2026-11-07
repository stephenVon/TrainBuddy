const pointsApi = require('../../services/pointsApi')

Page({
  data: { items: [], loading: true, error: '' },
  onShow() { this.load() },
  load() {
    this.setData({ loading: true, error: '' })
    pointsApi.achievements()
      .then((rows) => {
        this.setData({
          loading: false,
          items: (rows || []).map((item) => ({
            key: item.key,
            title: item.title,
            description: item.description,
            polarity: item.polarity,
            progressText: (item.earned ? '已获得' : '进行中') + ' ' + item.progress + '/' + item.threshold,
            rewardText: item.polarity === 'negative' || !item.point_reward ? '无积分奖励' : '奖励 ' + item.point_reward + ' 积分'
          }))
        })
      })
      .catch((err) => this.setData({ loading: false, error: (err && err.message) || '成就读取失败，请重试' }))
  }
})
