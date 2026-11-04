const interaction = require('../../utils/interaction')
Component({
  properties: {
    value: { type: null, value: null }, label: String, unit: String,
    min: { type: Number, value: 0 }, max: { type: Number, value: 1000 },
    step: { type: Number, value: 2.5 }, integer: Boolean, disabled: Boolean,
    showSlider: Boolean, ruler: Boolean, reduced: Boolean,
    sliderMax: { type: Number, value: 40 }
  },
  data: { text: '', invalid: '', sliderValue: 0, ticks: [], slideMax: 40 },
  observers: { 'value, min, max': function (value, min, max) {
    const current = Number(value) || min, step = this.properties.step
    const start = Math.max(min, Math.min(max - step * 8, Math.floor(current / step) * step - step * 4))
    const ticks = Array.from({ length: 9 }, (_, index) => Math.round((start + index * step) * 100) / 100).filter(tick => tick >= min && tick <= max)
    this.setData({ text: value == null ? '' : String(value), sliderValue: current, ticks, slideMax: Math.min(max, Math.max(this.properties.sliderMax, current)) })
  } },
  methods: {
    reset() { this.setData({ text: this.properties.value == null ? '' : String(this.properties.value), sliderValue: Number(this.properties.value) || this.properties.min, invalid: '' }) },
    onTick(e) {
      if (this.properties.disabled) return
      const value = Number(e.currentTarget.dataset.value)
      this.setData({ text: String(value), sliderValue: value, invalid: '' })
      interaction.feedback(); this.triggerEvent('input', { value }); this.triggerEvent('change', { value })
    },
    onInput(e) {
      if (this.properties.disabled) return
      const text = e.detail.value
      this.setData({ text, invalid: '' })
      // Preserve partial typing in the parent draft, including trailing decimal points.
      this.triggerEvent('input', { value: text })
    },
    onCommit() {
      if (this.properties.disabled) return
      try {
        const p = this.properties, value = interaction.numberValue(this.data.text, p.min, p.max, p.integer)
        this.setData({ invalid: '' })
        this.triggerEvent('change', { value })
      } catch (err) { this.setData({ invalid: err.message }) }
    },
    onStep(e) {
      if (this.properties.disabled) return
      const p = this.properties
      const value = interaction.stepValue(this.data.text, Number(e.currentTarget.dataset.direction), p.min, p.max, p.step)
      this.setData({ text: String(value), sliderValue: value, invalid: '' })
      interaction.feedback()
      this.triggerEvent('input', { value }); this.triggerEvent('change', { value })
    },
    onSlide(e) {
      if (this.properties.disabled) return
      const value = e.detail.value
      this.setData({ text: String(value), sliderValue: value, invalid: '' })
      this.triggerEvent('input', { value })
      if (e.type === 'change') { interaction.feedback(); this.triggerEvent('change', { value }) }
    }
  }
})
