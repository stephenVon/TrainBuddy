const http = require('../utils/http')

function summary() {
  return http.get('/points').then((res) => res.data)
}

function ledger(type) {
  return http.get('/points/ledger', type ? { type } : {}).then((res) => res.data || [])
}

function achievements() {
  return http.get('/achievements').then((res) => res.data || [])
}

function rewards() {
  return http.get('/rewards').then((res) => res.data || [])
}

function redeem(sku, idempotencyKey) {
  return http.post('/redemptions', { sku }, { idempotencyKey }).then((res) => res.data)
}

function orders() {
  return http.get('/redemptions').then((res) => res.data || [])
}

function order(id) {
  return http.get('/redemptions/' + id).then((res) => res.data)
}

module.exports = { summary, ledger, achievements, rewards, redeem, orders, order }
