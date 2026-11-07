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
    sectionHistory: [], activeBodyPart: '', sidebarInto: '', nextBodyPartLabel: '', resultsInto: '',
    filterError: '', selectedLabel: '全部动作', resultScrollTop: 0,
    filters: { muscleGroups: ['下肢', '上肢', '核心'], body_parts: [], equipment: [] },
    pickMode: false,
    pickedIds: {},
    pickedCount: 0
  },

  onLoad(q) {
    const pickMode = !!(q && (q.pick === '1' || q.pick === 1))
    this.setData({ pickMode, pickedIds: {}, pickedCount: 0 })
    if (pickMode && typeof wx.setNavigationBarTitle === 'function') {
      wx.setNavigationBarTitle({ title: '选择动作' })
    }
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
  onUnload() { this._unloaded = true; this._sequence = (this._sequence || 0) + 1; clearTimeout(this._searchTimer); clearTimeout(this._scrollTimer) },

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
      this.updateContinuation()
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
    this._nextPartFailed=false
    const app = getApp()
    const sequence = this._sequence = (this._sequence || 0) + 1
    clearTimeout(this._searchTimer)
    this.setData({ loading: true, loadingMore: false, error: '', page: 1, list: [], sectionHistory: [], activeBodyPart:this.data.bodyPart, nextBodyPartLabel:'', resultsInto:'', resultScrollTop: this.data.resultScrollTop === 0 ? 1 : 0 })
    return exerciseApi
      .listExercises(app, Object.assign(this.query(), { page: 1 }))
      .then((res) => {
        if (sequence !== this._sequence) return
        const list = res.data || []
        const total = res.total == null ? list.length : res.total
        this.setData({ list, total, page: 1, hasMore: list.length < total })
        this.updateContinuation()
      })
      .catch((err) => {
        if (sequence === this._sequence) this.setData({ error: err.message || '动作库加载失败，请重试' })
      })
      .then(() => {
        if (sequence === this._sequence) { this.setData({ loading: false }); this.fillViewport() }
      })
  },

  onReachBottom() {
    this.loadMore()
  },

  loadMore() {
    if (this.data.loading || this.data.loadingMore) return Promise.resolve()
    if (!this.data.hasMore) return this.loadNextPart()
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
        this.setData({ list, total, page, hasMore: extra.length > 0 && list.length < total })
        this.updateContinuation()
      })
      .catch((err) => {
        if (sequence === this._sequence) this.setData({ error: err.message || '加载更多失败，请重试' })
      })
      .then(() => {
        if (sequence === this._sequence) { this.setData({ loadingMore: false }); this.fillViewport() }
      })
  },

  onSearch(e) {
    if (this.data.activeBodyPart) {
      const current=this.data.filters.body_parts.find(item=>item.value===this.data.activeBodyPart)
      this.setData({bodyPart:this.data.activeBodyPart,selectedLabel:current?current.label:this.data.selectedLabel})
    }
    this._sequence = (this._sequence || 0) + 1
    this.setData({ loading:true, loadingMore:false, error:'', list:[], sectionHistory:[], nextBodyPartLabel:'' })
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
    const loaded=this.data.sectionHistory.findIndex(group=>group.key===value)
    if(!this.data.loading && !this.data.q && (loaded>=0 || (value===this.data.bodyPart && this.data.list.length))) {
      this.setData({activeBodyPart:value,resultsInto:loaded>=0?'section-'+loaded:'section-current'})
      return
    }
    const item = this.data.filters.body_parts.find(row => row.value === value)
    this.setData({ bodyPart: value, muscle: '', selectedLabel: item ? item.label : '全部动作' })
    this.reload()
  },

  onEquipment(e) {
    if (this.data.activeBodyPart) {
      const item = this.data.filters.body_parts.find(row => row.value === this.data.activeBodyPart)
      this.setData({bodyPart:this.data.activeBodyPart,selectedLabel:item ? item.label : this.data.selectedLabel})
    }
    this.setData({ equipment: e.currentTarget.dataset.v || '' })
    this.reload()
  },
  nextPart() {
    if (this.data.q.trim() || this.data.muscle || !this.data.bodyPart) return null
    const parts=this.data.filters.body_parts, index=parts.findIndex(item=>item.value===this.data.bodyPart)
    return index>=0 ? parts[index+1] || null : null
  },
  updateContinuation() { const next=this.nextPart(); this.setData({nextBodyPartLabel:next ? next.label : ''}) },
  loadNextPart() {
    const next=this.nextPart()
    if (!next || this.data.loading || this.data.loadingMore) return Promise.resolve()
    const sequence=this._sequence
    this._nextPartFailed=false
    this.setData({loadingMore:true,error:''})
    return exerciseApi.listExercises(getApp(),Object.assign(this.query(),{body_part:next.value,page:1})).then(res=>{
      if(sequence!==this._sequence)return
      const history=this.data.sectionHistory.concat([{key:this.data.bodyPart,label:this.data.selectedLabel,total:this.data.total,list:this.data.list}])
      const list=res.data||[],total=res.total==null?list.length:res.total
      this.setData({sectionHistory:history,bodyPart:next.value,selectedLabel:next.label,list,total,page:1,hasMore:list.length<total})
      this.updateContinuation()
    }).catch(err=>{if(sequence===this._sequence){this._nextPartFailed=true;this.setData({error:err.message||'下一部位加载失败，请重试'})}})
      .then(()=>{if(sequence===this._sequence){this.setData({loadingMore:false});this.fillViewport()}})
  },
  fillViewport() {
    if(typeof wx.nextTick!=='function'||typeof wx.createSelectorQuery!=='function'||this.data.error)return
    const sequence=this._sequence
    wx.nextTick(()=>{
      if(this._unloaded||sequence!==this._sequence||this.data.loading||this.data.loadingMore)return
      const query=wx.createSelectorQuery();query.select('.results-scroll').boundingClientRect();query.selectAll('.body-section').boundingClientRect()
      query.exec(result=>{
        if(this._unloaded||sequence!==this._sequence||this.data.error||!result[0]||!result[1]||!result[1].length)return
        if(result[1][result[1].length-1].bottom<=result[0].bottom+160)this.loadMore()
      })
    })
  },
  onResultsScroll() {
    if(this.data.resultsInto)this.setData({resultsInto:''})
    if(typeof wx.createSelectorQuery!=='function'||this._unloaded||this.data.loading)return
    clearTimeout(this._scrollTimer)
    const delay=100-(Date.now()-(this._lastScrollMeasure||0))
    if(delay>0){this._scrollTimer=setTimeout(()=>{this._lastScrollMeasure=0;this.onResultsScroll()},delay);return}
    this._lastScrollMeasure=Date.now()
    const sequence=this._sequence,query=wx.createSelectorQuery()
    query.select('.results-scroll').boundingClientRect()
    query.selectAll('.body-section').boundingClientRect()
    query.exec(result=>{
      if(sequence!==this._sequence||this._unloaded||!result[0]||!result[1]||!result[1].length)return
      const groups=this.data.sectionHistory.concat([{key:this.data.bodyPart}]);let selected=0
      result[1].forEach((rect,index)=>{if(rect.top<=result[0].top+40)selected=index})
      const group=groups[selected];if(!group||group.key===this.data.activeBodyPart)return
      const index=this.data.filters.body_parts.findIndex(item=>item.value===group.key)
      this.setData({activeBodyPart:group.key,sidebarInto:index>=0?'body-nav-'+index:''})
    })
  },
  onClearSearch() { clearTimeout(this._searchTimer); this.setData({q:''}); return this.reload() },
  onRetry() { return this._nextPartFailed ? this.loadNextPart() : this.data.list.length ? this.loadMore() : this.reload() },
  onImageError(e) { const id=e.currentTarget.dataset.id; const mark=item=>item.id===id?Object.assign({},item,{imageFailed:true}):item; this.setData({list:this.data.list.map(mark),sectionHistory:this.data.sectionHistory.map(group=>Object.assign({},group,{list:group.list.map(mark)}))}) },

  goDetail(e) {
    wx.navigateTo({
      url: '/pages/exercise-detail/index?id=' + e.currentTarget.dataset.id
    })
  },

  onTileTap(e) {
    if (this.data.pickMode) this.onTogglePick(e)
    else this.goDetail(e)
  },

  findPickedItem(id) {
    let found = null
    const scan = (list) => {
      ;(list || []).forEach((item) => { if (item.id === id) found = item })
    }
    scan(this.data.list)
    ;(this.data.sectionHistory || []).forEach((group) => scan(group.list))
    return found
  },

  onTogglePick(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const pickedIds = Object.assign({}, this.data.pickedIds)
    if (pickedIds[id]) delete pickedIds[id]
    else pickedIds[id] = this.findPickedItem(id) || { id }
    this.setData({ pickedIds, pickedCount: Object.keys(pickedIds).length })
  },

  pickedItems() {
    return Object.keys(this.data.pickedIds || {}).map((id) => {
      const stored = this.data.pickedIds[id]
      return stored && stored.name ? stored : this.findPickedItem(id) || { id, name: '动作' }
    })
  },

  onConfirmPick() {
    const items = this.pickedItems()
    if (!items.length) return
    let channel = null
    try { if (typeof this.getOpenerEventChannel === 'function') channel = this.getOpenerEventChannel() } catch (_) {}
    if (channel && typeof channel.emit === 'function') channel.emit('selectExercises', items)
    else if (typeof getCurrentPages === 'function') {
      const pages = getCurrentPages()
      const prev = pages[pages.length - 2]
      if (prev && typeof prev.addLibraryExercises === 'function') prev.addLibraryExercises(items)
    }
    wx.navigateBack()
  }
})
