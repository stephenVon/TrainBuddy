const { requireLogin } = require('../../utils/guard')
const exerciseApi = require('../../services/exerciseApi')

const PAGE_SIZE = 30

Page({
  data: {
    q: '',
    muscle: '',
    bodyPart: '',
    equipment: '',
    list: [],
    total: 0,
    page: 1,
    hasMore: false,
    loading: false,
    loadingMore: false,
    error: '',
    filters: { muscleGroups: ['下肢', '上肢', '核心'], body_parts: [], equipment: [] }
  },

  onShow() {
    if (!requireLogin(this)) return
    this.loadFacets()
    this.reload()
  },

  loadFacets() {
    const app = getApp()
    return exerciseApi.listFacets(app).then((res) => {
      const data = res.data || {}
      this.setData({
        filters: {
          muscleGroups: (data.muscleGroups || []).map((item) => item.label || item.value || item),
          body_parts: data.body_parts || [],
          equipment: data.equipment || []
        }
      })
    }).catch(() => {})
  },

  query() {
    return {
      q: this.data.q,
      muscleGroup: this.data.muscle,
      body_part: this.data.bodyPart,
      equipment: this.data.equipment,
      page: this.data.page,
      limit: PAGE_SIZE
    }
  },

  reload() {
    const app = getApp()
    const sequence = this._sequence = (this._sequence || 0) + 1
    this.setData({ loading: true, error: '', page: 1, list: [] })
    return exerciseApi
      .listExercises(app, Object.assign(this.query(), { page: 1 }))
      .then((res) => {
        if (sequence !== this._sequence) return
        const list = res.data || []
        const total = res.total || list.length
        this.setData({ list, total, page: 1, hasMore: list.length < total })
      })
      .catch((err) => {
        if (sequence === this._sequence) this.setData({ error: err.message || '动作库加载失败，请重试' })
      })
      .then(() => {
        if (sequence === this._sequence) this.setData({ loading: false })
      })
  },

  onReachBottom() {
    this.loadMore()
  },

  loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return Promise.resolve()
    const app = getApp()
    const sequence = this._sequence
    const page = this.data.page + 1
    this.setData({ loadingMore: true })
    return exerciseApi
      .listExercises(app, Object.assign(this.query(), { page }))
      .then((res) => {
        if (sequence !== this._sequence) return
        const extra = res.data || []
        const list = this.data.list.concat(extra)
        const total = res.total || this.data.total
        this.setData({ list, total, page, hasMore: list.length < total })
      })
      .catch((err) => {
        if (sequence === this._sequence) this.setData({ error: err.message || '加载更多失败，请重试' })
      })
      .then(() => {
        if (sequence === this._sequence) this.setData({ loadingMore: false })
      })
  },

  onSearch(e) {
    this.setData({ q: e.detail.value })
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = setTimeout(() => this.reload(), 280)
  },

  onMuscle(e) {
    this.setData({ muscle: e.currentTarget.dataset.v || '', bodyPart: '' })
    this.reload()
  },

  onBodyPart(e) {
    this.setData({ bodyPart: e.currentTarget.dataset.v || '', muscle: '' })
    this.reload()
  },

  onEquipment(e) {
    this.setData({ equipment: e.currentTarget.dataset.v || '' })
    this.reload()
  },

  goDetail(e) {
    wx.navigateTo({
      url: '/pages/exercise-detail/index?id=' + e.currentTarget.dataset.id
    })
  }
})
