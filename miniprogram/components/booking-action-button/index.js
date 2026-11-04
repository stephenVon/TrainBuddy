Component({
  properties: { state: { type: String, value: 'idle' }, disabled: Boolean, error: String, reduced: Boolean },
  methods: { activate() { if (!this.properties.disabled && ['idle', 'error'].includes(this.properties.state)) this.triggerEvent('activate') } }
})
