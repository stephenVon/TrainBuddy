Component({
  properties: { mode: { type: String, value: 'selector' }, label: String, value: { type: null, value: '' }, start: String, end: String, options: Array, disabled: Boolean, placeholder: { type: String, value: '请选择' } },
  methods: { select(e) { if (!this.properties.disabled) this.triggerEvent('change', { value: e.detail.value }) } }
})
