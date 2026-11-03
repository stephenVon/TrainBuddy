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
    asrProvider: 'mock',
    micDenied: false,
    recording: false,
    noteRecording: false,
    voiceBusy: false,
    voiceTask: null,
    segments: [],
    segmentPatches: {},
    mergeMode: 'append',
    syncError: ''
  },

  entrySpeech: null,
  noteSpeech: null,

  onLoad() {
    this.initSpeechComposers()
  },

  onUnload() {
    if (this.entrySpeech) this.entrySpeech.destroy()
    if (this.noteSpeech) this.noteSpeech.destroy()
  },

  onShow() {
    if (!requireCoachRole(this)) return
    const app = getApp()
    syncRoleBar(this)
    voiceApi.listProviders().then((p) => {
      this.setData({ asrProvider: (p && p.active) || 'mock' })
    }).catch(() => {})

    bindingApi.listBoundStudentsForCoachAsync(app).then((bound) => {
      let studentId = app.globalData.activeSubjectId
      let student = app.globalData.student
      if (bound.length && !bound.find((b) => b.studentId === studentId)) {
        studentId = bound[0].studentId
        student = bound[0].name
      }
      this.setData({
        students: bound || [],
        studentId: studentId || '',
        student: student || ''
      })
      if (studentId) this.loadDraftSession(studentId, student)
    })
  },

  initSpeechComposers() {
    this.entrySpeech = createSpeechComposer({
      onStart: () => this.setData({ recording: true }),
      onPartial: (text) => this.setData({ textInput: text }),
      onFinal: (text) => this.setData({ textInput: text, recording: false }),
      onEnd: () => this.setData({ recording: false, voiceBusy: false }),
      onError: (err) => {
        const micDenied = !!(err && err.micDenied)
        this.setData({ recording: false, voiceBusy: false, micDenied: micDenied || this.data.micDenied })
        getApp().toast((err && err.message) || '语音识别失败，可继续打字')
      },
      onNeedAsr: (job) => this.transcribeAudioToText(job, { applyTask: true })
    })
    this.noteSpeech = createSpeechComposer({
      onStart: () => this.setData({ noteRecording: true }),
      onPartial: (text) => this.setData({ publicNote: text }),
      onFinal: (text) => this.setData({ publicNote: text, noteRecording: false }),
      onEnd: () => this.setData({ noteRecording: false }),
      onError: (err) => {
        const micDenied = !!(err && err.micDenied)
        this.setData({ noteRecording: false, micDenied: micDenied || this.data.micDenied })
        getApp().toast((err && err.message) || '语音识别失败，可继续打字')
      },
      // 课后建议只回填文字，不触发动作结构化
      onNeedAsr: (job) => this.transcribeAudioToText(job, { applyTask: false, demoPhrase: '肩胛再稳定一些，下次先降一点重量。' })
    })
  },

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
    if (!this.data.session || this.data.session.status === 'completed' || this.data.voiceBusy || this.data.syncing) return
    if (which === 'entry' && this.data.noteRecording) return
    if (which === 'note' && this.data.recording) return
    const app = getApp()
    const start = () => {
      const speech = which === 'note' ? this.noteSpeech : this.entrySpeech
      const current = which === 'note' ? this.data.publicNote : this.data.textInput
      const simulatePartial = (this.data.asrProvider || 'mock') === 'mock'
      speech.start(current, { simulatePartial })
    }
    wx.getSetting({
      success: (set) => {
        if (set.authSetting['scope.record'] === false) {
          this.setData({ micDenied: true })
          app.toast('无麦克风权限，请用手填（AC14）')
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
    const demoPhrase = options.demoPhrase || MOCK_DEMO
    this.setData({ voiceBusy: true })
    const fs = wx.getFileSystemManager()
    fs.readFile({
      filePath: job.tempFilePath,
      encoding: 'base64',
      success: (file) => {
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
            this.setData({ voiceBusy: false })
            job.fail && job.fail(err || { message: '转写失败' })
          })
      },
      fail: () => {
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
    if (this.data.syncing) return
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
      textInput: '',
      voiceTask: null,
      segments: [],
      nextPlanId: ''
    })
    this.loadDraftSession(studentId, name)
  },

  loadDraftSession(studentId, studentName) {
    const app = getApp()
    trainingApi
      .createCoachDraftSession(app, {
        studentId,
        studentName,
        coachId: this.coachId(),
        title: '课后训练表'
      })
      .then((res) => {
        this.setData({
          session: res.data,
          publicNote: res.data.public_note || '',
          privateNote: res.data.private_note || ''
        })
        if (res.data.status === 'completed') {
          this.findNextPlan(studentId, res.data.session_id)
        }
      })
      .catch((err) => app.toast((err && err.message) || '加载草稿失败'))
  },

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
    if (this.data.syncing) return
    const app = getApp()
    trainingApi
      .addExercise(app, this.data.session.session_id, {
        exerciseId: e.currentTarget.dataset.id
      })
      .then((res) => this.setData({ session: res.data }))
      .catch((err) => app.toast((err && err.message) || '添加失败'))
  },

  onRemoveEx(e) {
    if (this.data.syncing) return
    trainingApi
      .removeExercise(getApp(), this.data.session.session_id, e.currentTarget.dataset.id)
      .then((res) => this.setData({ session: res.data }))
  },

  onTextInput(e) {
    this.setData({ textInput: e.detail.value })
  },

  onParseText() {
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
      .then((res) => this.applyVoiceTask(res.data))
      .catch((err) => {
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
    val = field === 'actualReps' ? parseInt(val, 10) : parseFloat(val)
    if (isNaN(val)) return
    const patch = {}
    patch[field] = val
    trainingApi
      .updateActualSet(app, this.data.session.session_id, setId, patch)
      .then((res) => this.setData({ session: res.data }))
  },

  onMarkDone(e) {
    if (this.data.syncing || this.data.session.status === 'completed') return
    trainingApi
      .updateActualSet(getApp(), this.data.session.session_id, e.currentTarget.dataset.sid, {
        state: 'done'
      })
      .then((res) => this.setData({ session: res.data }))
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
    trainingApi
      .patchSessionMeta(app, this.data.session.session_id, {
        publicNote: this.data.publicNote,
        privateNote: this.data.privateNote
      })
      .then((res) => this.setData({ session: res.data }))
  },

  onFinalize() {
    if (this.data.syncing || this._finalizeModal) return
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
        '将生成正式版本并同步给学员（私人备注不同步）。同时按规则生成下次计划草稿，不会自动加 5kg。',
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
