const { requireLogin } = require('../../utils/guard')
const aiApi = require('../../services/aiApi')
const time = require('../../utils/time')

const MEAL_TYPES = [
  { key: 'breakfast', label: '早餐' },
  { key: 'lunch', label: '午餐' },
  { key: 'dinner', label: '晚餐' },
  { key: 'snack', label: '加餐' }
]

function emptyMacros() {
  return { carbs: null, protein: null, fat: null }
}

function macroDisplay(v) {
  return v == null || v === '' ? '—' : String(v)
}

function macroInput(v) {
  return v == null || v === '' ? '' : String(v)
}

const MACRO_META = [
  { key: 'carbs', name: '碳水化合物', shortName: '碳水' },
  { key: 'protein', name: '蛋白质', shortName: '蛋白' },
  { key: 'fat', name: '脂肪', shortName: '脂肪' }
]

Page({
  data: {
    photo: '',
    picking: false,
    busy: false,
    error: '',
    mode: 'demo',
    realProviderReady: false,
    statusHint: '',
    mediaId: '',
    task: null,
    phase: 'pick', // pick | scanning | confirm | done | need_retake | failed
    foodName: '',
    portionAmount: '',
    portionUnit: 'g',
    macros: emptyMacros(),
    macroViews: MACRO_META.map((m) => ({
      key: m.key,
      name: m.name,
      shortName: m.shortName,
      value: '—',
      input: ''
    })),
    isEstimate: true,
    uncertainties: [],
    mealTypes: MEAL_TYPES,
    mealType: 'lunch',
    localDate: '',
    autoSync: false,
    syncHint: '默认关闭。需绑定教练、饮食授权且主动开启。',
    syncEnabled: false,
    saveMessage: '',
    confirmedMeal: null
  },

  onLoad(query) {
    if (query && query.mode === 'real') this.setData({ mode: 'real' })
  },

  onShow() {
    if (!requireLogin(this)) return
    const owner = getApp().globalData.session.user.userId
    if (this.owner && this.owner !== owner) {
      this.resetSession()
    }
    this.owner = owner
    if (!this.data.localDate) {
      this.setData({ localDate: time.todayKey() })
    }
    this.refreshProviders()
    this.refreshSyncSettings()
    this.consumePendingPhoto()
  },

  /** AI 页在用户手势内选好图后经 globalData 传入，避免真机 onShow 调相机失败 */
  consumePendingPhoto() {
    const app = getApp()
    const pending = app.globalData.pendingFoodPhoto
    if (!pending || !pending.path) return
    app.globalData.pendingFoodPhoto = null
    if (this.unloaded) return
    this.setData({
      photo: pending.path,
      photoSize: pending.size || 100000,
      mediaId: '',
      task: null,
      phase: 'pick',
      error: '',
      saveMessage: '',
      confirmedMeal: null,
      foodName: '',
      portionAmount: '',
      macros: emptyMacros(),
      macroViews: this.buildMacroViews(emptyMacros()),
      uncertainties: []
    })
  },

  onUnload() {
    this.unloaded = true
  },

  resetSession() {
    this.setData({
      photo: '',
      mediaId: '',
      task: null,
      phase: 'pick',
      error: '',
      foodName: '',
      portionAmount: '',
      macros: emptyMacros(),
      macroViews: this.buildMacroViews(emptyMacros()),
      uncertainties: [],
      saveMessage: '',
      confirmedMeal: null
    })
  },

  buildMacroViews(macros) {
    const m = macros || emptyMacros()
    return MACRO_META.map((meta) => ({
      key: meta.key,
      name: meta.name,
      shortName: meta.shortName,
      value: macroDisplay(m[meta.key]),
      input: macroInput(m[meta.key])
    }))
  },

  async refreshProviders() {
    try {
      const p = await aiApi.providers()
      const ready = p && p.active && p.active !== 'unavailable'
      this.setData({
        realProviderReady: !!ready,
        statusHint:
          this.data.mode === 'demo'
            ? '演示模式：识别结果为示例估算，需人工确认后才会写入日记。'
            : ready
              ? '正式模式：使用已配置供应商；未知值显示为 —，不会填 0。'
              : '正式模式供应商未接入，识别会明确失败，不会伪造营养数值。可切演示体验流程。'
      })
    } catch (_) {
      this.setData({
        realProviderReady: false,
        statusHint: '无法读取 AI 供应商状态'
      })
    }
  },

  async refreshSyncSettings() {
    try {
      const s = await aiApi.getNutritionSyncSettings()
      this.setData({
        autoSync: !!s.auto_sync,
        syncEnabled: !!(s.binding_active && s.meal_scope_on),
        syncHint:
          s.hint ||
          (s.effective_auto_sync
            ? '已开启：保存后将逐条同步给当前教练（不含原图）'
            : '仅绑定教练、开启饮食授权且主动启用时生效。朋友看不到饮食。')
      })
    } catch (_) {
      this.setData({
        syncEnabled: false,
        syncHint: '同步设置暂不可用'
      })
    }
  },

  onModeChange(e) {
    this.setData({ mode: e.detail.value })
    this.refreshProviders()
  },

  onCamera() {
    this.pick('camera')
  },
  onAlbum() {
    this.pick('album')
  },

  pick(source) {
    if (this.data.picking || this.data.busy) return
    const owner = this.owner
    this.setData({ picking: true, error: '' })
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [source],
      success: (result) => {
        if (this.unloaded) return
        const session = getApp().globalData.session
        if (!session || session.user.userId !== owner) return
        const file = result.tempFiles && result.tempFiles[0]
        if (file && file.tempFilePath) {
          this.setData({
            photo: file.tempFilePath,
            photoSize: file.size || 100000,
            mediaId: '',
            task: null,
            phase: 'pick',
            saveMessage: '',
            confirmedMeal: null,
            foodName: '',
            portionAmount: '',
            macros: emptyMacros(),
            macroViews: this.buildMacroViews(emptyMacros()),
            uncertainties: []
          })
        }
      },
      fail: (err) => {
        if (!this.unloaded && !/cancel/i.test((err && err.errMsg) || '')) {
          this.setData({ error: '未能选择照片，请重试；也可以选择另一种方式。' })
        }
      },
      complete: () => {
        if (!this.unloaded) this.setData({ picking: false })
      }
    })
  },

  onPreview() {
    if (this.data.photo) wx.previewImage({ current: this.data.photo, urls: [this.data.photo] })
  },

  onMealType(e) {
    this.setData({ mealType: e.currentTarget.dataset.key })
  },

  onDateChange(e) {
    this.setData({ localDate: e.detail.value })
  },

  onFoodName(e) {
    this.setData({ foodName: e.detail.value })
  },

  onPortion(e) {
    this.setData({ portionAmount: e.detail.value })
  },

  onMacroInput(e) {
    const key = e.currentTarget.dataset.key
    const raw = e.detail.value
    const macros = Object.assign({}, this.data.macros)
    if (raw === '' || raw == null) macros[key] = null
    else {
      const n = Number(raw)
      macros[key] = Number.isNaN(n) ? null : n
    }
    const macroViews = (this.data.macroViews || []).map((row) => {
      if (row.key !== key) return row
      return Object.assign({}, row, {
        input: raw == null ? '' : String(raw),
        value: macroDisplay(macros[key])
      })
    })
    this.setData({ macros, macroViews })
  },

  async onToggleSync(e) {
    const app = getApp()
    const want = !!(e.detail && e.detail.value)
    if (!this.data.syncEnabled && want) {
      app.toast(this.data.syncHint || '暂无法开启自动同步')
      this.setData({ autoSync: false })
      return
    }
    try {
      this.setData({ busy: true })
      const s = await aiApi.setNutritionSyncSettings({ auto_sync: want })
      this.setData({
        autoSync: !!s.auto_sync,
        syncHint:
          s.hint ||
          (s.effective_auto_sync
            ? '已开启：保存后将逐条同步给当前教练（不含原图）'
            : '仅绑定教练、开启饮食授权且主动启用时生效。')
      })
    } catch (err) {
      app.toast((err && err.message) || '同步设置失败')
      this.setData({ autoSync: !want })
    } finally {
      this.setData({ busy: false })
    }
  },

  readPhotoBase64(filePath) {
    return new Promise((resolve, reject) => {
      const compress = () =>
        new Promise((res, rej) => {
          if (!wx.compressImage) {
            res(filePath)
            return
          }
          wx.compressImage({
            src: filePath,
            quality: 70,
            success: (r) => res((r && r.tempFilePath) || filePath),
            fail: () => res(filePath)
          })
        })
      compress()
        .then((path) => {
          wx.getFileSystemManager().readFile({
            filePath: path,
            encoding: 'base64',
            success: (r) => {
              const b64 = r && r.data
              if (!b64) {
                reject(new Error('读取照片失败'))
                return
              }
              // 约 4MB base64 ≈ 3MB 原图，避免撑爆请求体
              if (String(b64).length > 4 * 1024 * 1024) {
                reject(new Error('照片过大，请换一张或离远一点再拍'))
                return
              }
              resolve(String(b64))
            },
            fail: (err) => reject(err || new Error('读取照片失败'))
          })
        })
        .catch(reject)
    })
  },

  async onScan() {
    const app = getApp()
    if (this.data.busy || !this.data.photo) return
    const mode = this.data.mode
    if (mode === 'real' && !this.data.realProviderReady) {
      wx.showModal({
        title: '能力未接入',
        content:
          '真实营养识别尚未配置供应商。不会返回成功或伪造数值。可切换「演示」查看流程。',
        showCancel: false
      })
    }

    this.setData({ busy: true, error: '', phase: 'scanning', saveMessage: '' })
    try {
      let imageBase64 = null
      if (mode === 'real') {
        imageBase64 = await this.readPhotoBase64(this.data.photo)
      }

      const intent = await aiApi.createUploadIntent({
        purpose: 'nutrition_input',
        mime: 'image/jpeg',
        size: this.data.photoSize || 100000,
        is_demo: mode === 'demo'
      })
      const asset = await aiApi.completeUpload(intent.media_id, {
        quality: { has_food: true }
      })
      const mediaId = asset.media_id
      this.setData({ mediaId })

      const input = {
        media_id: mediaId,
        quality_hints: { has_food: true }
      }
      if (imageBase64) input.image_base64 = imageBase64

      const task = await aiApi.createAiTask(
        {
          type: 'nutrition_scan',
          mode,
          consent_confirmed: true,
          input
        },
        'nutrition_' + Date.now()
      )

      this.applyTask(task)
    } catch (e) {
      this.setData({
        phase: 'failed',
        error: (e && e.message) || '识别失败，未写入饮食记录'
      })
      app.toast((e && e.message) || '识别失败')
    } finally {
      this.setData({ busy: false })
    }
  },

  applyTask(task) {
    const result = (task && task.result) || {}
    if (task.status === 'need_retake') {
      this.setData({
        task,
        phase: 'need_retake',
        error: (result && result.message) || '请重拍更清晰的单餐照片',
        macroViews: this.buildMacroViews(emptyMacros()),
        macros: emptyMacros(),
        uncertainties: (result.quality && result.quality.reasons) || []
      })
      return
    }
    if (task.status === 'failed') {
      this.setData({
        task,
        phase: 'failed',
        error: (task.error && task.error.message) || '识别失败'
      })
      return
    }
    if (task.status === 'needs_confirmation' || task.status === 'confirmed') {
      const items = Array.isArray(result.items) ? result.items : []
      const item = items[0] || {}
      const rawMacros = result.total_macros_g || item.macros_g || {}
      const macros = {
        carbs: rawMacros.carbs == null || rawMacros.carbs === '' ? null : Number(rawMacros.carbs),
        protein:
          rawMacros.protein == null || rawMacros.protein === ''
            ? null
            : Number(rawMacros.protein),
        fat: rawMacros.fat == null || rawMacros.fat === '' ? null : Number(rawMacros.fat)
      }
      Object.keys(macros).forEach((k) => {
        if (Number.isNaN(macros[k])) macros[k] = null
      })
      const portion = item.portion || {}
      const foodName =
        items.length > 1
          ? items
              .map((it) => (it && it.food_name) || '')
              .filter(Boolean)
              .join('、')
          : item.food_name || ''
      const unc = []
      items.forEach((it) => {
        ;(it.uncertainties || []).forEach((u) => {
          if (u && unc.indexOf(u) < 0) unc.push(u)
        })
      })
      this.setData({
        task,
        phase: task.status === 'confirmed' ? 'done' : 'confirm',
        foodName,
        portionAmount: portion.amount != null && portion.amount !== '' ? String(portion.amount) : '',
        portionUnit: portion.unit || 'g',
        macros,
        macroViews: this.buildMacroViews(macros),
        isEstimate: result.is_estimate !== false,
        uncertainties: unc,
        error: ''
      })
      return
    }
    this.setData({ task, phase: 'scanning' })
  },

  async onConfirm() {
    const app = getApp()
    if (this.data.busy || !this.data.task) return
    if (this.data.phase !== 'confirm') return

    this.setData({ busy: true, error: '' })
    try {
      const macros = this.data.macros
      const amount =
        this.data.portionAmount === '' ? null : Number(this.data.portionAmount)
      const items = [
        {
          food_name: this.data.foodName || '未命名食物',
          portion: {
            amount: Number.isNaN(amount) ? null : amount,
            unit: this.data.portionUnit || 'g',
            is_estimated: true
          },
          macros_g: macros,
          basis: 'user_confirmed',
          uncertainties: this.data.uncertainties || []
        }
      ]
      const out = await aiApi.confirmNutritionTask(
        this.data.task.task_id,
        {
          local_date: this.data.localDate,
          meal_type: this.data.mealType,
          items,
          total_macros_g: macros,
          is_estimate: this.data.isEstimate
        },
        'nutri_save_' + this.data.task.task_id
      )

      const sync = out.sync || {}
      let saveMessage = '已记入饮食日记'
      if (sync.status === 'synced') saveMessage = '已记入饮食日记，并同步给教练'
      else if (sync.status === 'sync_failed') {
        saveMessage = sync.message || '已记录，尚未同步'
      } else if (sync.attempted === false && this.data.autoSync) {
        saveMessage = sync.message || '已记录，尚未同步'
      }

      this.setData({
        phase: 'done',
        confirmedMeal: out.meal,
        task: out.task || this.data.task,
        saveMessage
      })
      app.toast(saveMessage)
    } catch (e) {
      this.setData({ error: (e && e.message) || '保存失败，未重复写入' })
      app.toast((e && e.message) || '保存失败')
    } finally {
      this.setData({ busy: false })
    }
  },

  async onRetry() {
    if (!this.data.task || this.data.busy) return
    const app = getApp()
    this.setData({ busy: true, error: '', phase: 'scanning' })
    try {
      const task = await aiApi.retryAiTask(this.data.task.task_id, {
        base_revision: this.data.task.revision,
        input: {
          media_id: this.data.mediaId,
          quality_hints: { has_food: true }
        }
      })
      this.applyTask(task)
    } catch (e) {
      this.setData({
        phase: 'failed',
        error: (e && e.message) || '重试失败'
      })
      app.toast((e && e.message) || '重试失败')
    } finally {
      this.setData({ busy: false })
    }
  },

  goDiary() {
    wx.navigateTo({ url: '/pages/diary/index' })
  }
})
