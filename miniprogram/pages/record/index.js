const { syncRoleBar } = require('../../utils/role')
const { requireCoachRole } = require('../../utils/guard')
const { canCoachReadStudent } = require('../../utils/permission')
const bindingApi = require('../../services/bindingApi')
const trainingApi = require('../../services/trainingApi')
const voiceApi = require('../../services/voiceApi')
const { createSpeechComposer, MOCK_DEMO } = require('../../utils/speechComposer')

Page({
  data: {
    role: 'coach',
    students: [],
    student: '',
    studentId: '',
    session: null,
    library: trainingApi.EXERCISE_LIBRARY,
    textInput: '',
    publicNote: '',
    privateNote: '',
    syncing: false,
    nextPlanId: '',
    showLibrary: false,
    asrProvider: 'mock',
    micDenied: false,
    recording: false,
    noteRecording: false,
    voiceBusy: false,
    voiceTask: null,
    segments: [],
    segmentPatches: {},
    mergeMode: 'append',
    syncError: '', speechState: 'idle', speechTarget: 'entry', speechSeconds: 0, canPause: false, saveError: '', savingFields: false, advancedMerge: false, showPrivate: false, studentError: '', studentLoading: true, draftError: ''
  },

  entrySpeech: null,
  noteSpeech: null,

  onLoad(query) {
    this._pickStudent = !!(query && query.pick); this._unloaded = false
    this.initSpeechComposers()
  },

  onUnload() {
    this.saveLocalDraft(); this._unloaded = true; clearInterval(this._voiceClock)
    if (this.entrySpeech) this.entrySpeech.destroy()
    if (this.noteSpeech) this.noteSpeech.destroy()
  },

  onShow() {
    if (!requireCoachRole(this)) return
    const app = getApp()
    syncRoleBar(this)
    this.setData({ studentLoading: true, studentError: '' })
    voiceApi.listProviders().then((p) => {
      if (this._unloaded) return
      this.setData({ asrProvider: (p && p.active) || 'mock' })
    }).catch(() => {})

    bindingApi.listBoundStudentsForCoachAsync(app).then((bound) => {
      let studentId = app.globalData.activeSubjectId
      let student = app.globalData.student
      if (this._unloaded) return
      if (this._pickStudent || !(bound || []).some(b => b.studentId === studentId)) { studentId = ''; student = '' }
      this._pickStudent = false
      this.setData({
        studentLoading: false,
        students: bound || [],
        studentId: studentId || '',
        student: student || ''
      })
      if (studentId && (!this.data.session || this.data.session.student_id !== studentId)) this.loadDraftSession(studentId, student)
    }).catch(err => { if (!this._unloaded) this.setData({ studentLoading: false, studentError: err.message || '学员列表读取失败' }) })
  },

  initSpeechComposers() {
    this.entrySpeech = createSpeechComposer(this.speechHooks('entry'))
    this.noteSpeech = createSpeechComposer(this.speechHooks('note'))
  },
  speechHooks(target) {
    const field = target === 'entry' ? 'textInput' : 'publicNote'
    return {
      onRequest: () => this.setData({ speechTarget: target, speechState: 'requesting' }),
      onStart: info => {
        this._tickAt = Date.now(); this._elapsed = 0
        this.setData({ speechTarget: target, speechState: 'recording', canPause: !!info.canPause, speechSeconds: 0, recording: target === 'entry', noteRecording: target === 'note' })
        clearInterval(this._voiceClock)
        this._voiceClock = setInterval(() => {
          if (this._unloaded || this.data.speechState !== 'recording') return
          this._elapsed += Date.now() - this._tickAt; this._tickAt = Date.now()
          this.setData({ speechSeconds: Math.floor(this._elapsed / 1000) })
        }, 1000)
      },
      onPause: info => { this._elapsed += Date.now() - this._tickAt; this.setData({ speechState: info && info.interrupted ? 'interrupted' : 'paused' }) },
      onResume: () => { this._tickAt = Date.now(); this.setData({ speechState: 'recording' }) },
      onStopping: () => this.setData({ speechState: 'stopping' }),
      onProcessing: () => this.setData({ recording: false, noteRecording: false, speechState: 'processing', voiceBusy: true }),
      onPartial: text => this.setData({ [field]: text }),
      onFinal: text => { this.setData({ [field]: text }); this.saveLocalDraft() },
      onEnd: info => { clearInterval(this._voiceClock); this.setData({ recording: false, noteRecording: false, voiceBusy: false, speechState: info.error ? 'error' : 'reviewing' }); if (target === 'note') this.saveNotes() },
      onError: err => { this.setData({ micDenied: !!(err && err.micDenied), syncError: (err && err.message) || '录音失败，请重试或手填' }); getApp().toast((err && err.message) || '语音录入失败') },
      onNeedAsr: job => this.transcribeAudioToText(job, { applyTask: target === 'entry', ...(target === 'note' ? { demoPhrase: '肩胛再稳定一些，下次先降一点重量。' } : {}) })
    }
  },
  onVoiceToggle() {
    if (this.voiceActive() && this.data.speechTarget !== 'entry') return
    if (['requesting','recording','paused','interrupted'].includes(this.data.speechState)) return this.stopSpeech()
    this.beginSpeech('entry')
  },
  onNoteVoiceToggle() {
    if (this.voiceActive() && this.data.speechTarget !== 'note') return
    if (['requesting','recording','paused','interrupted'].includes(this.data.speechState)) return this.stopSpeech()
    this.beginSpeech('note')
  },
  stopSpeech() {
    const speech = this.data.speechTarget === 'note' ? this.noteSpeech : this.entrySpeech
    if (speech) speech.stop()
  },
  onPauseSpeech() {
    const speech = this.data.speechTarget === 'note' ? this.noteSpeech : this.entrySpeech
    if (!speech) return
    if (!this.data.canPause) return this.stopSpeech()
    if (['paused','interrupted'].includes(this.data.speechState)) speech.resume()
    else speech.pause()
  },
  canLeave() {
    if (!this.commitFieldInputs()) return false
    if (this.voiceActive() || this.data.savingFields || this.data.syncing || Object.keys(this._pendingWrites || {}).length) { getApp().toast('请先结束录音并保存当前内容'); return false }
    this.saveLocalDraft(); return true
  },
  voiceActive() { return ['requesting','recording','paused','interrupted','stopping','processing'].includes(this.data.speechState) || this.data.voiceBusy },
  onHide() { this.saveLocalDraft(); if (this.data.recording || this.data.noteRecording) this.stopSpeech() },
  onAdvancedMerge() { this.setData({ advancedMerge: !this.data.advancedMerge }) },
  onLibraryToggle() { this.setData({ showLibrary: !this.data.showLibrary }) },
  onPrivateToggle() { this.setData({ showPrivate: !this.data.showPrivate }) },
  goInvite() { wx.navigateTo({ url: '/pages/profile/index' }) },
  saveLocalDraft() {
    if (!this.data.studentId || !this.data.session || this.data.session.status === 'completed') return
    const app = getApp(), user = app.globalData.session && app.globalData.session.user
    if (!user) return
    app.globalData.drafts = app.globalData.drafts || {}
    app.globalData.drafts['coach-entry:' + user.userId + ':' + this.data.studentId + ':' + this.data.session.session_id] = { textInput: this.data.textInput, publicNote: this.data.publicNote, privateNote: this.data.privateNote }
    if (typeof app.persist === 'function') app.persist()
  },
  queueWrite(key, operation) {
    this._pendingWrites = this._pendingWrites || {}; this._pendingWrites[key] = operation
    return this.flushWrites()
  },
  flushWrites() {
    if (this._draining) return this._draining
    const run = async () => {
      this.setData({ savingFields: true, saveError: '' })
      try {
        while (Object.keys(this._pendingWrites || {}).length) {
          const key = Object.keys(this._pendingWrites)[0], operation = this._pendingWrites[key]
          const response = await operation()
          if (this._unloaded) return false
          this.setData({ session: response.data })
          if (this._pendingWrites[key] === operation) delete this._pendingWrites[key]
        }
        return true
      } catch (err) { if (!this._unloaded) this.setData({ saveError: err.message || '保存失败，输入已保留，请重试' }); return false }
      finally { if (!this._unloaded) this.setData({ savingFields: false }) }
    }
    this._draining = Promise.resolve().then(run).finally(() => { this._draining = null }); return this._draining
  },
  onRetrySave() { this.flushWrites() },

  onRequestMic() {
    wx.authorize({
      scope: 'scope.record',
      success: () => this.setData({ micDenied: false }),
      fail: () => {
        this.setData({ micDenied: true })
        getApp().toast('仍无麦克风权限，可继续文字录入')
      }
    })
  },

  beginSpeech(which) {
    if (!this.data.session || this.data.session.status === 'completed' || this.voiceActive() || this.data.syncing) return
    this.setData({ speechState: 'requesting', speechTarget: which })
    if (which === 'entry' && this.data.noteRecording) return
    if (which === 'note' && this.data.recording) return
    const app = getApp()
    const start = () => {
      if (this._unloaded) return
      const speech = which === 'note' ? this.noteSpeech : this.entrySpeech
      const current = which === 'note' ? this.data.publicNote : this.data.textInput
      const simulatePartial = (this.data.asrProvider || 'mock') === 'mock'
      if (!speech.start(current, { simulatePartial })) this.setData({ speechState: 'error' })
    }
    wx.getSetting({
      success: (set) => {
        if (set.authSetting['scope.record'] === false) {
          this.setData({ micDenied: true })
          this.setData({ speechState: 'error' }); app.toast('无麦克风权限，可改用文字录入')
          return
        }
        start()
      },
      fail: () => start()
    })
  },

  onRecStart() {
    this.beginSpeech('entry')
  },

  onRecEnd() {
    if (this.entrySpeech) this.entrySpeech.stop()
  },

  onNoteRecStart() {
    this.beginSpeech('note')
  },

  onNoteRecEnd() {
    if (this.noteSpeech) this.noteSpeech.stop()
  },

  /** 降级路径：录音转写后写回输入框；动作录入可选同步结构化候选 */
  transcribeAudioToText(job, opts) {
    const options = opts || {}
    const session = this.data.session
    if (!session) {
      job.fail && job.fail({ message: '会话未就绪' })
      return
    }
    const scope = session.session_id
    const current = () => !this._unloaded && this.data.session && this.data.session.session_id === scope
    const demoPhrase = options.demoPhrase || MOCK_DEMO
    this.setData({ voiceBusy: true })
    const fs = wx.getFileSystemManager()
    fs.readFile({
      filePath: job.tempFilePath,
      encoding: 'base64',
      success: (file) => {
        if (!current()) return
        const payload = {
          source: 'voice',
          base_revision: session.revision,
          audio_base64: file.data,
          name_hint: this.data.student
        }
        if ((this.data.asrProvider || 'mock') === 'mock') {
          payload.demo_phrase = demoPhrase
        }
        voiceApi
          .createTask(session.session_id, payload, 'voice_asr_' + session.session_id + '_' + Date.now())
          .then((res) => {
            if (!current()) return
            const task = res.data
            const transcript =
              (task.transcript && task.transcript.text) ||
              ((this.data.asrProvider || 'mock') === 'mock' ? demoPhrase : '')
            if (task.status === 'failed') {
              this.setData({ voiceBusy: false })
              job.fail && job.fail(task.error || { message: '转写失败' })
              return
            }
            if (options.applyTask) this.applyVoiceTask(task)
            else this.setData({ voiceBusy: false })
            job.finish && job.finish(transcript)
          })
          .catch((err) => {
            if (!current()) return
            this.setData({ voiceBusy: false })
            job.fail && job.fail(err || { message: '转写失败' })
          })
      },
      fail: () => {
        if (!current()) return
        this.setData({ voiceBusy: false })
        job.fail && job.fail({ message: '读取录音失败' })
      }
    })
  },

  applyVoiceTask(task) {
    const merged = task.merged_segment_ids || []
    const segments = ((task.structured && task.structured.segments) || []).map((s) =>
      Object.assign({}, s, {
        merged: merged.indexOf(s.segment_id) !== -1,
        missing_fields_label: (s.missing_fields || []).join('、')
      })
    )
    this.setData({
      voiceBusy: false,
      voiceTask: task,
      segments,
      segmentPatches: {}
    })
    if (task.status === 'failed') {
      getApp().toast((task.error && task.error.message) || '识别失败')
    }
  },

  coachId() {
    const u = getApp().globalData.session.user
    return (u.coachProfile && u.coachProfile.coachId) || u.userId
  },

  onPickStudent(e) {
    if (!this.canLeave()) return
    const app = getApp()
    const studentId = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name
    const check = canCoachReadStudent(app, app.globalData.session.user.userId, studentId)
    if (!check.ok) {
      app.toast(check.message || '无权访问')
      return
    }
    app.globalData.activeSubjectId = studentId
    app.globalData.student = name
    app.persist()
    this.setData({
      studentId,
      student: name,
      session: null, publicNote: '', privateNote: '', saveError: '', syncError: '', speechState: 'idle',
      textInput: '',
      voiceTask: null,
      segments: [],
      nextPlanId: ''
    })
    this.loadDraftSession(studentId, name)
  },

  loadDraftSession(studentId, studentName) {
    const app = getApp()
    this.setData({ draftError: '' })
    const generation = this._loadGeneration = (this._loadGeneration || 0) + 1
    trainingApi
      .createCoachDraftSession(app, {
        studentId,
        studentName,
        coachId: this.coachId(),
        title: '课后训练表'
      })
      .then((res) => {
        if (this._unloaded || generation !== this._loadGeneration || this.data.studentId !== studentId) return
        this.setData({
          session: res.data,
          publicNote: res.data.public_note || '',
          privateNote: res.data.private_note || ''
        })
        const cached = (app.globalData.drafts || {})['coach-entry:' + app.globalData.session.user.userId + ':' + studentId + ':' + res.data.session_id]
        if (cached && res.data.status !== 'completed') this.setData(cached)
        if (res.data.status === 'completed') {
          this.findNextPlan(studentId, res.data.session_id)
        }
      })
      .catch((err) => { if (!this._unloaded && generation === this._loadGeneration) this.setData({ draftError: (err && err.message) || '加载草稿失败' }) })
  },
  onRetryDraft() { if (this.data.studentId) this.loadDraftSession(this.data.studentId, this.data.student) },

  findNextPlan(studentId) {
    trainingApi.listPlansForStudent(getApp(), studentId).then((res) => {
      const hit = (res.data || []).find(
        (p) =>
          (p.source_type === 'next_from_session' || p.source_type === 'rule_copy') &&
          p.latest_draft
      )
      this.setData({ nextPlanId: (hit && hit.plan_id) || '' })
    })
  },

  onAddLib(e) {
    if (!this.data.session || this.data.syncing || this.data.session.status === 'completed' || this.voiceActive()) return
    const app = getApp()
    trainingApi.addExercise(app, this.data.session.session_id, {
        exerciseId: e.currentTarget.dataset.id
      }).then(res => { if (!this._unloaded) this.setData({ session: res.data }) })
      .catch(err => app.toast((err && err.message) || '添加失败，请先核对训练表再重试'))
  },

  onRemoveEx(e) {
    if (this.data.syncing || this.voiceActive() || this.data.session.status === 'completed') return
    const id = e.currentTarget.dataset.id
    trainingApi.removeExercise(getApp(), this.data.session.session_id, id)
      .then(res => { if (!this._unloaded) this.setData({ session: res.data }) })
      .catch(err => getApp().toast((err && err.message) || '删除失败，请核对后重试'))
  },

  onTextInput(e) {
    this.setData({ textInput: e.detail.value }); this.saveLocalDraft()
  },

  onParseText() {
    if (this.voiceActive() || !this.data.session || this.data.session.status === 'completed') return
    const scope = this.data.session.session_id
    const app = getApp()
    const text = (this.data.textInput || '').trim()
    if (!text) {
      app.toast('请输入文字')
      return
    }
    this.setData({ voiceBusy: true })
    voiceApi
      .createTask(
        this.data.session.session_id,
        {
          source: 'text',
          text,
          base_revision: this.data.session.revision,
          name_hint: this.data.student
        },
        'text_' + Date.now()
      )
      .then((res) => { if (!this._unloaded && this.data.session.session_id === scope) this.applyVoiceTask(res.data) })
      .catch((err) => {
        if (this._unloaded || this.data.session.session_id !== scope) return
        this.setData({ voiceBusy: false })
        app.toast((err && err.message) || '解析失败')
      })
  },

  onMergeMode(e) {
    this.setData({ mergeMode: e.currentTarget.dataset.m })
  },

  onSegPatch(e) {
    const sid = e.currentTarget.dataset.sid
    const f = e.currentTarget.dataset.f
    let val = e.detail.value
    if (f === 'set_count' || f === 'candidate_reps_per_set') {
      val = val === '' ? null : parseInt(val, 10)
    }
    const patches = Object.assign({}, this.data.segmentPatches)
    patches[sid] = Object.assign({}, patches[sid] || {}, { [f]: val })
    // 同步到展示
    const segments = this.data.segments.map((s) => {
      if (s.segment_id !== sid) return s
      const next = Object.assign({}, s, patches[sid])
      const missing = []
      if (next.set_count == null) missing.push('set_count')
      if (next.candidate_reps_per_set == null) missing.push('reps')
      if (!next.display_name || next.display_name === '（待确认动作）') {
        missing.push('exercise_name')
      }
      next.requires_confirmation = missing.length > 0
      next.missing_fields = missing
      next.missing_fields_label = missing.join('、')
      return next
    })
    this.setData({ segmentPatches: patches, segments })
  },

  onMergeOne(e) {
    this.doMerge([e.currentTarget.dataset.sid])
  },

  onMergeAllReady() {
    const ids = this.data.segments
      .filter((s) => !s.merged && !s.requires_confirmation)
      .map((s) => s.segment_id)
    if (!ids.length) {
      getApp().toast('没有可合并项，请先补齐缺失字段')
      return
    }
    this.doMerge(ids)
  },

  doMerge(segmentIds) {
    if (this.voiceActive()) return
    if (this._draining || Object.keys(this._pendingWrites || {}).length) return this.flushWrites().then(ok => { if (ok) this.doMerge(segmentIds) })
    const app = getApp()
    const task = this.data.voiceTask
    if (!task) {
      app.toast('请先解析或录音')
      return
    }
    this.setData({ voiceBusy: true })
    voiceApi
      .mergeTask(
        this.data.session.session_id,
        task.task_id,
        {
          base_revision: this.data.session.revision,
          mode: this.data.mergeMode,
          segment_ids: segmentIds,
          segment_patches: this.data.segmentPatches,
          resolutions: {} // 默认 keep_human
        },
        'merge_' + task.task_id + '_' + segmentIds.join('_')
      )
      .then((res) => {
        const skipped = res.data.skipped || []
        if (skipped.length) {
          const msg = skipped
            .map((s) => s.segment_id + ':' + (s.message || s.reason))
            .join('；')
          app.toast(msg.slice(0, 40))
        }
        this.setData({
          session: res.data.session,
          voiceBusy: false
        })
        this.applyVoiceTask(res.data.task)
      })
      .catch((err) => {
        this.setData({ voiceBusy: false })
        app.toast((err && err.message) || '合并失败')
      })
  },

  onUndoMerge() {
    if (this.voiceActive()) return
    if (this._draining || Object.keys(this._pendingWrites || {}).length) return this.flushWrites().then(ok => { if (ok) this.onUndoMerge() })
    const app = getApp()
    voiceApi
      .undoMerge(this.data.session.session_id)
      .then((res) => {
        this.setData({ session: res.data.session })
        if (this.data.voiceTask) {
          voiceApi
            .getTask(this.data.session.session_id, this.data.voiceTask.task_id)
            .then((t) => this.applyVoiceTask(t.data))
        }
        app.toast('已撤销上次合并')
      })
      .catch((err) => app.toast((err && err.message) || '无法撤销'))
  },

  onSetField(e) {
    if (this.data.syncing || this.data.session.status === 'completed') return
    const app = getApp()
    const setId = e.currentTarget.dataset.sid
    const field = e.currentTarget.dataset.field
    let val = e.detail.value
    if (val === '' || val == null) return
    val = Number(val)
    if (!Number.isFinite(val) || val < 0 || (field === 'actualReps' && !Number.isInteger(val))) { getApp().toast('请输入有效的非负数，次数须为整数'); return }
    const patch = {}
    patch[field] = val
    if (this._fieldInputs) delete this._fieldInputs[setId + ':' + field]
    this.queueWrite('set:' + setId + ':' + field, () => trainingApi.updateActualSet(app, this.data.session.session_id, setId, patch))
  },
  onFieldInput(e) {
    this._fieldInputs = this._fieldInputs || {}
    const d = e.currentTarget.dataset
    this._fieldInputs[d.sid + ':' + d.field] = { sid: d.sid, field: d.field, value: e.detail.value }
  },
  commitFieldInputs() {
    const inputs = Object.values(this._fieldInputs || {})
    for (const item of inputs) {
      const n = Number(item.value)
      if (item.value === '' || !Number.isFinite(n) || n < 0 || (item.field === 'actualReps' && !Number.isInteger(n))) { getApp().toast('请先补全有效的重量和次数'); return false }
    }
    for (const item of inputs) this.onSetField({ currentTarget: { dataset: item }, detail: { value: item.value } })
    return true
  },

  onMarkDone(e) {
    if (this.data.syncing || this.data.session.status === 'completed') return
    const setId = e.currentTarget.dataset.sid
    this.queueWrite('done:' + setId, () => trainingApi.updateActualSet(getApp(), this.data.session.session_id, setId, { state: 'done' }))
  },

  onPublicNote(e) {
    if (this.data.syncing) return
    this.setData({ publicNote: e.detail.value })
    this.saveNotes()
  },

  onPrivateNote(e) {
    if (this.data.syncing) return
    this.setData({ privateNote: e.detail.value })
    this.saveNotes()
  },

  saveNotes() {
    const app = getApp()
    if (!this.data.session || this.data.session.status === 'completed') return
    this.saveLocalDraft()
    this.queueWrite('notes', () => trainingApi.patchSessionMeta(app, this.data.session.session_id, { publicNote: this.data.publicNote, privateNote: this.data.privateNote }))
  },

  onFinalize() {
    if (this.data.syncing || this._finalizeModal || this.voiceActive()) return
    if (!this.commitFieldInputs()) return
    if (this._draining || Object.keys(this._pendingWrites || {}).length) {
      return this.flushWrites().then(ok => { if (ok) this.onFinalize() })
    }
    const app = getApp()
    const session = this.data.session
    if (!session.exercises.length) {
      app.toast('请先添加训练动作')
      return
    }
    this._finalizeModal = true
    wx.showModal({
      title: '确认并同步',
      content:
        '将同步训练表和公开建议，私人备注不共享。本次会将 ' + (session.total_sets - session.done_sets) + ' 个待完成组标为完成，请先核对。下次计划仅生成草稿。',
      confirmText: '确认同步',
      success: (res) => {
        this._finalizeModal = false
        if (!res.confirm) return
        this.setData({ syncing: true, syncError: '' })
        let marks = Promise.resolve()
        session.exercises.forEach((ex) => {
          ;(ex.sets || []).forEach((set) => {
            if (set.state === 'pending') {
              marks = marks.then(() => trainingApi.updateActualSet(app, session.session_id, set.id, {
                  state: 'done'
                })).then(result => this.setData({ session: result.data }))
            }
          })
        })
        marks
          .then(() =>
            trainingApi.finalizeSession(app, session.session_id, {
              completionKey: session.session_id + ':coach_sync',
              share: true,
              actorRole: 'coach',
              baseRevision: this.data.session.revision
            })
          )
          .then((resp) => {
            this.setData({
              syncing: false,
              session: resp.data.session,
              nextPlanId: (resp.data.next_plan && resp.data.next_plan.plan_id) || ''
            })
            const tip = resp.data.next_plan_error
              ? resp.data.next_plan_error
              : resp.data.next_plan
                ? '训练表已同步，下次计划草稿已生成。'
                : '训练表已同步。'
            wx.showModal({
              title: resp.data.idempotent ? '已同步（幂等）' : '同步成功',
              content: tip,
              confirmText: resp.data.next_plan ? '编辑下次计划' : '完成',
              showCancel: !!resp.data.next_plan,
              cancelText: '稍后',
              success: (r) => {
                if (r.confirm && resp.data.next_plan) {
                  wx.navigateTo({
                    url: '/pages/plan-edit/index?id=' + resp.data.next_plan.plan_id
                  })
                }
              }
            })
          })
          .catch((err) => {
            this.setData({ syncing: false, syncError: (err && err.message) || '同步失败，请重试' })
            app.toast((err && err.message) || '同步失败')
          })
      }, fail: () => { this._finalizeModal = false }
    })
  },

  goNextPlan() {
    if (!this.data.nextPlanId) return
    wx.navigateTo({ url: '/pages/plan-edit/index?id=' + this.data.nextPlanId })
  }
})
