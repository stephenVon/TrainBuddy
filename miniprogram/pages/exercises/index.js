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
    filterError: '', selectedLabel: '全部动作', resultScrollTop: 0,
    filters: { muscleGroups: ['下肢', '上肢', '核心'], body_parts: [], equipment: [] }
  },

  onShow() {
    if (!requireLogin(this)) return
    const user = getApp().globalData.session.user
    const owner = user.userId
    if (this._owner === owner) return
    this._owner = owner
    this._unloaded = false
    this.loadFacets()
    this.reload()
  },
  onUnload() { this._unloaded = true; this._sequence = (this._sequence || 0) + 1; clearTimeout(this._searchTimer) },

  loadFacets() {
    this.setData({ filterError: '' })
    const app = getApp()
    return exerciseApi.listFacets(app).then((res) => {
      const data = res.data || {}
      if (this._unloaded) return
      this.setData({
        filters: {
          muscleGroups: (data.muscleGroups || []).map((item) => item.label || item.value || item),
          body_parts: data.body_parts || [],
          equipment: data.equipment || []
        }
      })
    }).catch(() => { if (!this._unloaded) this.setData({ filterError:'分类加载失败，可继续搜索', }) })
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
    clearTimeout(this._searchTimer)
    this.setData({ loading: true, loadingMore: false, error: '', page: 1, list: [], resultScrollTop: this.data.resultScrollTop === 0 ? 1 : 0 })
    return exerciseApi
      .listExercises(app, Object.assign(this.query(), { page: 1 }))
      .then((res) => {
        if (sequence !== this._sequence) return
        const list = res.data || []
        const total = res.total == null ? list.length : res.total
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
    this.setData({ loadingMore: true, error: '' })
    return exerciseApi
      .listExercises(app, Object.assign(this.query(), { page }))
      .then((res) => {
        if (sequence !== this._sequence) return
        const extra = res.data || []
        const list = this.data.list.concat(extra)
        const total = res.total == null ? this.data.total : res.total
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
    this._sequence = (this._sequence || 0) + 1
    this.setData({ loading:true, loadingMore:false, error:'', list:[] })
    this.setData({ q: e.detail.value })
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = setTimeout(() => this.reload(), 280)
  },

  onMuscle(e) {
    const value = e.currentTarget.dataset.v || ''
    this.setData({ muscle: value, bodyPart: '', selectedLabel: value || '全部动作' })
    this.reload()
  },

  onBodyPart(e) {
    const value = e.currentTarget.dataset.v || ''
    const item = this.data.filters.body_parts.find(row => row.value === value)
    this.setData({ bodyPart: value, muscle: '', selectedLabel: item ? item.label : '全部动作' })
    this.reload()
  },

  onEquipment(e) {
    this.setData({ equipment: e.currentTarget.dataset.v || '' })
    this.reload()
  },
  onClearSearch() { clearTimeout(this._searchTimer); this.setData({q:''}); return this.reload() },
  onRetry() { return this.data.list.length ? this.loadMore() : this.reload() },
  onImageError(e) { const id=e.currentTarget.dataset.id; this.setData({list:this.data.list.map(item=>item.id===id?Object.assign({},item,{imageFailed:true}):item)}) },

  goDetail(e) {
    wx.navigateTo({
      url: '/pages/exercise-detail/index?id=' + e.currentTarget.dataset.id
    })
  }
})
