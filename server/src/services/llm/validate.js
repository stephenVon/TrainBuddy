/**
 * 轻量 JSON Schema 子集校验（type / required / properties / items / enum / nullable）
 */

function validate(data, schema, path) {
  const p = path || '$'
  if (!schema || typeof schema !== 'object') {
    return { ok: true, errors: [] }
  }

  const errors = []
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : null

  if (data === null) {
    if (schema.nullable || (types && types.indexOf('null') >= 0)) {
      return { ok: true, errors: [] }
    }
    if (types && types.indexOf('null') < 0) {
      errors.push(p + ': expected non-null')
      return { ok: false, errors }
    }
  }

  if (types && data !== null && data !== undefined) {
    const actual = Array.isArray(data) ? 'array' : typeof data
    const mapped = actual === 'number' && Number.isInteger(data) ? 'integer' : actual
    const okType =
      types.indexOf(mapped) >= 0 ||
      (mapped === 'integer' && types.indexOf('number') >= 0) ||
      (mapped === 'number' && types.indexOf('integer') >= 0 && Number.isInteger(data))
    if (!okType) {
      errors.push(p + ': expected ' + types.join('|') + ', got ' + mapped)
      return { ok: false, errors }
    }
  }

  if (schema.enum && data !== null && data !== undefined) {
    if (schema.enum.indexOf(data) < 0) {
      errors.push(p + ': value not in enum')
    }
  }

  if (schema.type === 'object' || (types && types.indexOf('object') >= 0)) {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const required = schema.required || []
      required.forEach((key) => {
        if (data[key] === undefined) errors.push(p + '.' + key + ': required')
      })
      const props = schema.properties || {}
      Object.keys(props).forEach((key) => {
        if (data[key] === undefined) return
        const sub = validate(data[key], props[key], p + '.' + key)
        errors.push(...sub.errors)
      })
    }
  }

  if (schema.type === 'array' || (types && types.indexOf('array') >= 0)) {
    if (Array.isArray(data) && schema.items) {
      data.forEach((item, i) => {
        const sub = validate(item, schema.items, p + '[' + i + ']')
        errors.push(...sub.errors)
      })
    }
  }

  return { ok: errors.length === 0, errors }
}

module.exports = { validate }
