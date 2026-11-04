class AppError extends Error {
  constructor(code, message, opts = {}) {
    super(message)
    this.code = code
    this.retryable = !!opts.retryable
    this.status = opts.status || mapStatus(code)
    this.fields = opts.fields || null
    this.extra = opts.extra || null
  }
}

function mapStatus(code) {
  const map = {
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    REVISION_CONFLICT: 409,
    IDEMPOTENCY_CONFLICT: 409,
    SLOT_CONFLICT: 409,
    BOOKING_EXPIRED: 409,
    INVALID_STATE: 409,
    PRIMARY_COACH_EXISTS: 409,
    BINDING_INACTIVE: 403,
    CONSENT_REQUIRED: 403,
    CONSENT_REVOKED: 403,
    ROLE_NOT_GRANTED: 403,
    VALIDATION: 422,
    BACKFILL_CLOSED: 422,
    FUTURE_CHECKIN: 422,
    RATE_LIMIT: 429,
    MEDIA_DELETED: 410,
    PROVIDER_NOT_CONFIGURED: 503,
    WECHAT_LOGIN_NOT_CONFIGURED: 503,
    WECHAT_LOGIN_FAILED: 401,
    NODE_GENERATION_FAILED: 502,
    ENTITLEMENT_EXHAUSTED: 402,
    SUBSCRIPTION_EXPIRED: 402,
    FEATURE_DISABLED: 403
  }
  return map[code] || 400
}

function fail(code, message, opts) {
  throw new AppError(code, message, opts)
}

module.exports = { AppError, fail, mapStatus }
