const http = require('../utils/http')

function listExercises(app, query) {
  return http
    .get('/exercises', {
      q: query && query.q,
      search: query && query.search,
      muscleGroup: query && query.muscleGroup,
      body_part: query && query.body_part,
      target: query && query.target,
      equipment: query && query.equipment,
      page: query && query.page,
      limit: query && query.limit
    })
    .then((res) => ({
      data: res.data,
      total: res.total,
      page: res.page,
      limit: res.limit,
      request_id: res.request_id
    }))
}

function getExercise(app, id) {
  return http
    .get('/exercises/' + encodeURIComponent(id))
    .then((res) => ({ data: res.data, request_id: res.request_id }))
}

function listFacets(app) {
  return http.get('/exercises/facets').then((res) => ({ data: res.data, request_id: res.request_id }))
}

function toggleFavorite(app, id) {
  return Promise.resolve({ data: { favorited: true }, request_id: 'local' })
}

function filters() {
  return {
    muscleGroups: ['下肢', '上肢', '核心'],
    body_parts: [],
    equipment: []
  }
}

module.exports = { listExercises, getExercise, listFacets, toggleFavorite, filters }
