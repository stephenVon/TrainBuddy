const { syncRoleBar } = require('../../utils/role')
const { requireLogin } = require('../../utils/guard')
const aiApi = require('../../services/aiApi')
const config = require('../../config')
const interaction = require('../../utils/interaction')

const CONCLUSION_LABEL = {
  no_obvious: '未见明显特征',
  needs_attention: '疑似需关注',
  unable_to_judge: '无法判断'
}

function taskTone(status) {
  if (status === 'succeeded' || status === 'reviewed') return 'ok'
  if (status === 'failed' || status === 'need_retake' || status === 'cancelled') return 'err'
  if (status === 'running' || status === 'queued' || status === 'partial' || status === 'pending' || status === 'submitted' || status === 'draft') return 'warn'
  return 'muted'
}

Page({
  data: {
    directPosture: false,
    role: 'student',
    reduced: false,
    taskLabels: { queued: '等待处理', running: '处理中', succeeded: '已完成', failed: '未完成', partial: '部分完成', need_retake: '请补充照片', draft: '待复核', reviewed: '已复核', pending: '待处理', submitted: '已提交', cancelled: '已取消' },
    providerInfo: null,
    realProviderReady: false,
    mode: 'real',
    frontMediaId: '',
    sideMediaId: '',
    frontPhotoPath: '',
    sidePhotoPath: '',
    goalMediaId: '',
    goalPhotoPath: '',
    postureTask: null,
    postureTaskTone: 'muted',
    postureFailReason: '',
    postureReport: null,
    goalTask: null,
    goalGroup: null,
    goalGenerating: false,
    showGoalConfig: false,
    goalConfig: {
      body_goal: 'balanced_muscular',
      change_level: 'moderate',
      image_style: 'gym_photo'
    },
    bodyGoalOptions: [
      { value: 'lean_toned', label: '精瘦、有线条' },
      { value: 'balanced_muscular', label: '肌肉匀称、体型更健壮' },
      { value: 'athletic', label: '运动员型、力量与体能感' },
      { value: 'lighter_slim', label: '更轻盈、整体更纤细' }
    ],
    changeLevelOptions: [
      { value: 'slight', label: '轻微变化：自然、接近当前体型' },
      { value: 'moderate', label: '中等变化：明显但相对合理' },
      { value: 'strong', label: '强烈变化：更突出理想身材风格' }
    ],
    imageStyleOptions: [
      { value: 'gym_photo', label: '真实健身房照片' },
      { value: 'studio', label: '简洁摄影棚人像' },
      { value: 'brand_promo', label: '运动品牌宣传照' }
    ],
    consultations: [],
    busy: false,
    statusHint: '',
    toolSwiperCurrent: 0,
    toolTabs: [
      { key: 'food', label: '饮食', index: '01', action: '拍照识别', blurb: '估算一餐营养' },
      { key: 'posture', label: '体态', index: '02', action: '上传观察', blurb: '正面与侧面照片' },
      { key: 'goal', label: '目标', index: '03', action: '生成预览', blurb: '激励目标图' }
    ]
  },

  onLoad(query) {
    this.setData({ directPosture: !!query && query.tool === 'posture' })
    const index = ['food', 'posture', 'goal'].indexOf(query && query.tool)
    if (index >= 0) this.setData({ toolSwiperCurrent: index })
  },

  onToolSwiperChange(e) {
    const cur = e.detail && e.detail.current != null ? e.detail.current : 0
    this.setData({ toolSwiperCurrent: cur })
  },

  onPickToolTab(e) {
    const idx = Number(e.currentTarget.dataset.index)
    if (!Number.isFinite(idx) || idx === this.data.toolSwiperCurrent) return
    this.setData({ toolSwiperCurrent: idx })
  },

  onMotion(e) {
    interaction.setReducedMotion(e.detail.value)
    this.setData({ reduced: !!e.detail.value })
  },

  postureFailText(task) {
    if (!task) return ''
    if (task.error && task.error.message) return task.error.message
    if (task.status === 'need_retake') {
      const reasons = (task.result && task.result.quality && task.result.quality.reasons) || []
      return reasons.length ? reasons.join('、') : '请补充侧面或改善拍摄条件'
    }
    return ''
  },

  onShow() {
    if (!requireLogin(this)) return
    syncRoleBar(this)
    const coach = getApp().globalData.role === 'coach'
    wx.setNavigationBarTitle({ title: coach ? 'AI工具' : 'AI助手' })
    this.setData({ reduced: interaction.reducedMotion() })
    this.refreshMeta()
    this.loadConsultations()
  },

  refreshMeta() {
    aiApi
      .providers()
      .then((info) => {
        const active = (info && info.active) || 'unavailable'
        const llm = (info && info.llm) || {}
        const doubaoOk = !!(llm.providers && llm.providers.doubao && llm.providers.doubao.configured)
        const minimaxOk = !!(
          (info.goal_image && info.goal_image.configured) ||
          (llm.providers && llm.providers.minimax && llm.providers.minimax.configured)
        )
        const postureRouted =
          llm.task_routing && llm.task_routing.posture_scan === 'doubao' && doubaoOk
        const ready =
          active === 'mock' || active === 'demo' || doubaoOk || minimaxOk || !!llm.configured
        this.setData({
          providerInfo: info,
          realProviderReady: ready,
          statusHint: postureRouted
            ? '体态→豆包视觉；目标预览→MiniMax 图生图'
            : minimaxOk
              ? '目标预览：MiniMax 已配置；体态需豆包视觉接入点'
              : ready
                ? '真实通道已配置'
                : '真实通道未接入：提交将失败，不会显示成功'
        })
      })
      .catch(() => {
        this.setData({
          realProviderReady: false,
          statusHint: '无法读取 AI 能力状态，请确认 API 已启动'
        })
      })
  },

  onModeChange(e) {
    const mode = e.detail.value
    this.setData({
      mode,
      postureTask: null,
      postureTaskTone: 'muted',
      postureFailReason: '',
      postureReport: null,
      goalTask: null,
      goalGroup: null,
      statusHint:
        mode === 'demo'
          ? '演示模式：结果带 DEMO 标记，与真实任务隔离'
          : this.data.realProviderReady
            ? '真实模式：将调用已配置供应商'
            : '真实模式：未接入能力不得显示成功'
    })
  },

  onFoodCamera() {
    this.openFoodPhoto('camera')
  },

  onFoodAlbum() {
    this.openFoodPhoto('album')
  },

  /** 真机要求 chooseMedia 在用户点击手势内同步调用，不能跳转后再 onShow 唤起 */
  openFoodPhoto(source) {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [source],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0]
        if (!file || !file.tempFilePath) {
          getApp().toast('未能获取照片，请重试')
          return
        }
        getApp().globalData.pendingFoodPhoto = {
          path: file.tempFilePath,
          size: file.size || 100000,
          source
        }
        wx.navigateTo({ url: '/pages/food-photo/index' })
      },
      fail: (err) => {
        if (!/cancel/i.test((err && err.errMsg) || '')) {
          getApp().toast('未能打开相机或相册，请检查权限后重试')
        }
      }
    })
  },

  async onPickFront() {
    await this.pickView('front')
  },

  async onPickSide() {
    await this.pickView('side')
  },

  async pickView(view) {
    const app = getApp()
    if (this.data.mode === 'demo') {
      try {
        this.setData({ busy: true })
        const asset = await aiApi.demoUploadPhoto('posture_input', {
          view,
          person_count: 1,
          has_front: view === 'front',
          has_side: view === 'side'
        })
        if (view === 'front') this.setData({ frontMediaId: asset.media_id })
        else this.setData({ sideMediaId: asset.media_id })
        app.toast(view === 'front' ? '已登记正面（演示）' : '已登记侧面（演示）')
      } catch (e) {
        app.toast((e && e.message) || '上传失败')
      } finally {
        this.setData({ busy: false })
      }
      return
    }

    // 真实：选图登记 + 保留本地路径供识别时读 base64
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: async (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        try {
          this.setData({ busy: true })
          const intent = await aiApi.createUploadIntent({
            purpose: 'posture_input',
            mime: 'image/jpeg',
            size: file.size || 100000,
            is_demo: false
          })
          const asset = await aiApi.completeUpload(intent.media_id, {
            quality: {
              view,
              person_count: 1,
              has_front: view === 'front',
              has_side: view === 'side'
            }
          })
          if (view === 'front') {
            this.setData({
              frontMediaId: asset.media_id,
              frontPhotoPath: file.tempFilePath || ''
            })
          } else {
            this.setData({
              sideMediaId: asset.media_id,
              sidePhotoPath: file.tempFilePath || ''
            })
          }
          app.toast('已上传登记')
        } catch (e) {
          app.toast((e && e.message) || '上传失败')
        } finally {
          this.setData({ busy: false })
        }
      }
    })
  },

  readPhotoBase64(filePath) {
    return new Promise((resolve, reject) => {
      if (!filePath) {
        resolve(null)
        return
      }
      const afterCompress = (path) => {
        wx.getFileSystemManager().readFile({
          filePath: path,
          encoding: 'base64',
          success: (r) => {
            const b64 = r && r.data
            if (!b64) {
              reject(new Error('读取照片失败'))
              return
            }
            if (String(b64).length > 4 * 1024 * 1024) {
              reject(new Error('照片过大，请换一张清晰半身照'))
              return
            }
            resolve(String(b64))
          },
          fail: (err) => reject(err || new Error('读取照片失败'))
        })
      }
      if (!wx.compressImage) {
        afterCompress(filePath)
        return
      }
      wx.compressImage({
        src: filePath,
        quality: 70,
        success: (r) => afterCompress((r && r.tempFilePath) || filePath),
        fail: () => afterCompress(filePath)
      })
    })
  },

  async onScan() {
    const app = getApp()
    if (this.data.busy) return
    if (!this.data.frontMediaId && this.data.mode === 'real') {
      app.toast('请先上传正面照片')
      return
    }

    const mode = this.data.mode
    if (mode === 'real' && !this.data.realProviderReady) {
      wx.showModal({
        title: '能力未接入',
        content:
          '真实体态分析尚未配置供应商。不会显示成功结果。可切换「演示」查看流程，或配置豆包视觉接入点。',
        showCancel: false
      })
    }

    this.setData({
      busy: true,
      postureTask: null,
      postureTaskTone: 'muted',
      postureFailReason: '',
      postureReport: null
    })
    try {
      const input = {
        front_media_id: this.data.frontMediaId || undefined,
        side_media_id: this.data.sideMediaId || undefined,
        quality_hints: {
          has_front: !!this.data.frontMediaId,
          has_side: !!this.data.sideMediaId,
          person_count: 1
        }
      }
      if (mode === 'real') {
        if (this.data.frontPhotoPath) {
          input.front_image_base64 = await this.readPhotoBase64(this.data.frontPhotoPath)
        }
        if (this.data.sidePhotoPath) {
          input.side_image_base64 = await this.readPhotoBase64(this.data.sidePhotoPath)
        }
      }

      const task = await aiApi.createAiTask(
        {
          type: 'posture_scan',
          mode,
          consent_confirmed: true,
          input
        },
        'posture_' + mode + '_' + Date.now()
      )

      this.setData({
        postureTask: task,
        postureTaskTone: taskTone(task.status),
        postureFailReason: this.postureFailText(task)
      })

      if (task.status === 'need_retake') {
        wx.showModal({
          title: '需要重拍',
          content: this.postureFailText(task) || '请补充侧面或改善拍摄条件，不返回默认正常报告',
          showCancel: false
        })
        return
      }

      if (task.status === 'failed') {
        wx.showModal({
          title: '任务未成功',
          content: (task.error && task.error.message) || '分析失败',
          showCancel: false
        })
        return
      }

      if (task.status === 'succeeded' && task.result && task.result.report_id) {
        const report = await aiApi.getPostureReport(task.result.report_id)
        this.setData({
          postureReport: this.formatReport(report)
        })
        if (report.is_demo) {
          app.toast('演示报告已生成（非真实评估）')
        } else {
          app.toast('报告已生成（待教练复核）')
        }
      }
    } catch (e) {
      this.setData({
        postureTask: {
          status: 'failed',
          error: { message: (e && e.message) || '无法创建任务' }
        },
        postureTaskTone: 'err',
        postureFailReason: (e && e.message) || '无法创建任务'
      })
      wx.showModal({
        title: '提交失败',
        content: (e && e.message) || '无法创建任务',
        showCancel: false
      })
    } finally {
      this.setData({ busy: false })
    }
  },

  onRetryPosture() {
    return this.onScan()
  },

  presentGoalGroup(group) {
    if (!group) return null
    const nodes = (group.nodes || []).map((n) =>
      Object.assign({}, n, {
        statusTone: taskTone(n.status),
        statusLabel:
          n.status === 'succeeded'
            ? '已完成'
            : n.status === 'failed'
              ? '失败'
              : n.status === 'running' || n.status === 'queued'
                ? '生成中'
                : n.status || '待处理'
      })
    )
    return Object.assign({}, group, { nodes })
  },

  formatReport(report) {
    const items = (report.items || []).map((it) =>
      Object.assign({}, it, {
        conclusion_label: CONCLUSION_LABEL[it.conclusion] || it.conclusion,
        tone:
          it.conclusion === 'needs_attention'
            ? 'warn'
            : it.conclusion === 'unable_to_judge'
              ? 'muted'
              : 'ok'
      })
    )
    // 不伪造总分或骨架关键点；仅展示接口已有分项结论
    return Object.assign({}, report, { items, overall_score: null, hasSkeleton: false })
  },

  noop() {},

  async onPickGoalPhoto() {
    const app = getApp()
    if (this.data.busy || this.data.goalGenerating) return
    if (this.data.mode === 'demo') {
      try {
        this.setData({ busy: true })
        const asset = await aiApi.demoUploadPhoto('goal_source', { person_count: 1 })
        this.setData({
          goalMediaId: asset.media_id,
          goalPhotoPath: ''
        })
        app.toast('已登记本人照片（演示）')
      } catch (e) {
        app.toast((e && e.message) || '上传失败')
      } finally {
        this.setData({ busy: false })
      }
      return
    }

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        try {
          this.setData({ busy: true })
          const intent = await aiApi.createUploadIntent({
            purpose: 'goal_source',
            mime: 'image/jpeg',
            size: file.size || 100000,
            is_demo: false
          })
          const asset = await aiApi.completeUpload(intent.media_id, {
            quality: { person_count: 1, view: 'front' }
          })
          this.setData({
            goalMediaId: asset.media_id,
            goalPhotoPath: file.tempFilePath || ''
          })
          app.toast('本人照片已准备')
        } catch (e) {
          app.toast((e && e.message) || '上传失败')
        } finally {
          this.setData({ busy: false })
        }
      }
    })
  },

  onGoalGenerate() {
    if (this.data.busy || this.data.goalGenerating) return
    const mode = this.data.mode
    if (!this.data.goalMediaId && !this.data.goalPhotoPath && mode === 'real') {
      getApp().toast('请先拍照或上传本人照片')
      return
    }
    if (mode === 'real') {
      const goalReady =
        this.data.providerInfo &&
        this.data.providerInfo.goal_image &&
        this.data.providerInfo.goal_image.configured
      if (!goalReady && !this.data.realProviderReady) {
        wx.showModal({
          title: '能力未接入',
          content: '请配置 MINIMAX_API_KEY 后重启 API，或切换演示模式。',
          showCancel: false
        })
        return
      }
    }
    this.setData({ showGoalConfig: true })
  },

  onCloseGoalConfig() {
    if (this.data.goalGenerating) return
    this.setData({ showGoalConfig: false })
  },

  onCfgBodyGoal(e) {
    this.setData({ 'goalConfig.body_goal': e.detail.value })
  },

  onCfgChangeLevel(e) {
    this.setData({ 'goalConfig.change_level': e.detail.value })
  },

  onCfgImageStyle(e) {
    this.setData({ 'goalConfig.image_style': e.detail.value })
  },

  async onConfirmGoalConfig() {
    const app = getApp()
    if (this.data.goalGenerating) return
    const mode = this.data.mode
    const cfg = this.data.goalConfig

    // 关闭弹窗，回到主页面异步加载
    this.setData({
      showGoalConfig: false,
      goalGenerating: true,
      goalTask: null,
      goalGroup: null
    })

    try {
      let sourceId = this.data.goalMediaId
      if (!sourceId && mode === 'demo') {
        const asset = await aiApi.demoUploadPhoto('goal_source', { person_count: 1 })
        sourceId = asset.media_id
        this.setData({ goalMediaId: sourceId })
      }

      let sourceBase64 = null
      if (mode === 'real' && this.data.goalPhotoPath) {
        sourceBase64 = await this.readPhotoBase64(this.data.goalPhotoPath)
      }

      if (!sourceId && !sourceBase64) {
        app.toast('请先准备本人照片')
        this.setData({ goalGenerating: false })
        return
      }

      const input = {
        source_media_id: sourceId || undefined,
        source_image_base64: sourceBase64 || undefined,
        mime: 'image/jpeg',
        goal_text: '健身目标激励预览（视觉参考，非成果保证）',
        goal_config: {
          body_goal: cfg.body_goal,
          change_level: cfg.change_level,
          image_style: cfg.image_style
        },
        nodes: mode === 'demo'
          ? [
              { key: 'm2', months: 2 },
              { key: 'm3', months: 3 },
              { key: 'm6', months: 6 }
            ]
          : [{ key: 'goal', months: 3 }],
        fail_nodes: mode === 'demo' ? ['m6'] : []
      }

      const task = await aiApi.createAiTask(
        {
          type: 'goal_image',
          mode,
          consent_confirmed: true,
          input
        },
        'goal_' + mode + '_' + Date.now(),
        { timeout: 180000 }
      )

      this.setData({ goalTask: task })
      let group = null
      if (task.result && task.result.group_id) {
        group = await aiApi.getGoalGroup(task.result.group_id)
      } else if (task.result && task.result.nodes) {
        group = task.result
      }
      if (group && this.data.goalPhotoPath && !group.source_preview_url) {
        group = Object.assign({}, group, { source_preview_url: this.data.goalPhotoPath })
      }
      this.setData({ goalGroup: this.presentGoalGroup(group) })

      if (task.status === 'failed') {
        wx.showModal({
          title: '目标图未成功',
          content: (task.error && task.error.message) || '生成失败',
          showCancel: false
        })
      } else if (task.status === 'partial') {
        app.toast('部分节点成功，可单独重试或对比查看')
      } else if (task.status === 'succeeded') {
        app.toast(mode === 'demo' ? '演示目标图已生成' : '目标预览已生成，可点击对比查看')
      }
    } catch (e) {
      wx.showModal({
        title: '提交失败',
        content: (e && e.message) || '无法创建目标任务',
        showCancel: false
      })
    } finally {
      this.setData({ goalGenerating: false })
    }
  },

  resolveGoalNode(e) {
    const key = e.currentTarget.dataset.key
    const mediaId = e.currentTarget.dataset.media
    const group = this.data.goalGroup || {}
    const nodes = group.nodes || []
    return (
      nodes.find((n) => key && n.key === key) ||
      nodes.find((n) => mediaId && n.result_media_id === mediaId) ||
      null
    )
  },

  onCompareGoal(e) {
    const node = this.resolveGoalNode(e)
    const group = this.data.goalGroup || {}
    const preview = (node && node.preview_url) || ''
    const source = group.source_preview_url || this.data.goalPhotoPath
    const urls = []
    if (source) urls.push(source)
    if (preview) urls.push(preview)
    if (!urls.length) {
      getApp().toast('暂无可预览图片（演示模式可能无像素结果）')
      return
    }
    wx.previewImage({
      current: preview || urls[0],
      urls
    })
  },

  async onRetryNode(e) {
    const key = e.currentTarget.dataset.key
    const task = this.data.goalTask
    if (!task || !key) return
    const app = getApp()
    this.setData({ busy: true })
    try {
      const updated = await aiApi.retryAiTask(task.task_id, {
        node_key: key,
        base_revision: task.revision
      })
      this.setData({ goalTask: updated })
      if (updated.result && updated.result.group_id) {
        const group = await aiApi.getGoalGroup(updated.result.group_id)
        this.setData({ goalGroup: this.presentGoalGroup(group) })
      }
      app.toast('已重试节点 ' + key)
    } catch (err) {
      app.toast((err && err.message) || '重试失败')
    } finally {
      this.setData({ busy: false })
    }
  },

  async onExportNode(e) {
    const app = getApp()
    const node = this.resolveGoalNode(e)
    const mediaId = (node && node.result_media_id) || e.currentTarget.dataset.media
    const preview = (node && node.preview_url) || ''

    if (!preview) {
      // 无像素时仍登记水印合规标记，并提示
      if (mediaId) {
        try {
          await aiApi.exportWatermark(mediaId)
        } catch (_) {}
      }
      app.toast('当前结果无可保存图片（演示模式可能无像素图）')
      return
    }

    this.setData({ busy: true })
    try {
      if (mediaId) {
        try {
          await aiApi.exportWatermark(mediaId)
        } catch (_) {
          /* 合规标记失败不阻断保存 */
        }
      }
      await this.ensureAlbumAuth()
      const filePath = await this.materializeImageFile(preview)
      await this.saveImageToAlbum(filePath)
      wx.showModal({
        title: '已保存到相册',
        content:
          '目标预览图已写入手机相册。\n该图为 AI 模拟视觉参考，不代表真实训练效果。\n分享前请确认接收人与用途范围。',
        showCancel: false
      })
    } catch (err) {
      const msg = (err && err.message) || '导出失败'
      if (err && err.code === 'AUTH_DENIED') {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置中允许「添加到相册」后再试。',
          confirmText: '去设置',
          success: (r) => {
            if (r.confirm) wx.openSetting({})
          }
        })
      } else {
        app.toast(msg)
      }
    } finally {
      this.setData({ busy: false })
    }
  },

  ensureAlbumAuth() {
    return new Promise((resolve, reject) => {
      wx.getSetting({
        success: (res) => {
          const ok = res.authSetting && res.authSetting['scope.writePhotosAlbum']
          if (ok) {
            resolve(true)
            return
          }
          if (ok === false) {
            reject({ code: 'AUTH_DENIED', message: '未授权保存到相册' })
            return
          }
          wx.authorize({
            scope: 'scope.writePhotosAlbum',
            success: () => resolve(true),
            fail: () => reject({ code: 'AUTH_DENIED', message: '未授权保存到相册' })
          })
        },
        fail: () => reject({ message: '无法读取授权状态' })
      })
    })
  },

  materializeImageFile(src) {
    return new Promise((resolve, reject) => {
      if (!src) {
        reject({ message: '缺少图片地址' })
        return
      }
      if (/^https?:\/\//i.test(src)) {
        wx.downloadFile({
          url: src,
          success: (r) => {
            if (r.statusCode >= 200 && r.statusCode < 300 && r.tempFilePath) {
              resolve(r.tempFilePath)
            } else {
              reject({ message: '下载目标图失败' })
            }
          },
          fail: () => reject({ message: '下载目标图失败' })
        })
        return
      }
      if (src.indexOf('data:image') === 0 || /^[A-Za-z0-9+/=]+$/.test(src.slice(0, 80))) {
        const m = String(src).match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/)
        const b64 = m ? m[2] : String(src).replace(/^data:[^;]+;base64,/, '')
        const ext = m && m[1].indexOf('png') >= 0 ? 'png' : 'jpg'
        const filePath = `${wx.env.USER_DATA_PATH}/goal_export_${Date.now()}.${ext}`
        wx.getFileSystemManager().writeFile({
          filePath,
          data: b64,
          encoding: 'base64',
          success: () => resolve(filePath),
          fail: () => reject({ message: '写入临时图片失败' })
        })
        return
      }
      // 本地临时路径
      resolve(src)
    })
  },

  saveImageToAlbum(filePath) {
    return new Promise((resolve, reject) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => resolve(true),
        fail: (e) => {
          const msg = (e && e.errMsg) || ''
          if (/auth deny|authorize|permission/i.test(msg)) {
            reject({ code: 'AUTH_DENIED', message: '未授权保存到相册' })
          } else {
            reject({ message: '保存到相册失败' })
          }
        }
      })
    })
  },

  async onConsult() {
    const app = getApp()
    const group = this.data.goalGroup
    const key = 'consult_once_' + ((group && group.group_id) || 'none')
    this.setData({ busy: true })
    try {
      // AC40：连续点两次同幂等键
      const a = await aiApi.createConsultation(
        {
          goal_group_id: group && group.group_id,
          goal_task_id: this.data.goalTask && this.data.goalTask.task_id,
          note: '想了解可达性与训练建议（咨询方案，非购买）'
        },
        key
      )
      const b = await aiApi.createConsultation(
        {
          goal_group_id: group && group.group_id,
          note: '想了解可达性与训练建议（咨询方案，非购买）'
        },
        key
      )
      if (a.consultation_id !== b.consultation_id) {
        app.toast('幂等异常')
      } else {
        app.toast('已提交咨询（未生成订单）')
      }
      this.loadConsultations()
    } catch (e) {
      wx.showModal({
        title: '咨询未创建',
        content: (e && e.message) || '请先绑定教练',
        showCancel: false
      })
    } finally {
      this.setData({ busy: false })
    }
  },

  loadConsultations() {
    aiApi
      .listConsultations()
      .then((list) => this.setData({ consultations: list || [] }))
      .catch(() => {})
  },

  async onCoachReview() {
    const report = this.data.postureReport
    if (!report) return
    const app = getApp()
    if (getApp().globalData.role !== 'coach') {
      app.toast('请切换教练视角复核')
      return
    }
    try {
      const updated = await aiApi.reviewPosture(report.report_id, {
        decision: 'reviewed',
        note: '同意观察方向，改善计划另发',
        base_revision: report.revision
      })
      this.setData({ postureReport: this.formatReport(updated) })
      app.toast('复核已写入（未覆盖 AI 原文）')
    } catch (e) {
      app.toast((e && e.message) || '复核失败')
    }
  },

  onOpenApiHint() {
    wx.showModal({
      title: '运行说明',
      content:
        'API: ' +
        config.API_BASE_URL +
        '\n演示与真实任务隔离；真实通道默认 AI_PROVIDER=unavailable，不得伪造成功。无 82 分总分。',
      showCancel: false
    })
  }
})
