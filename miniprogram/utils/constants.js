/** 授权类别：共享给教练时需逐类确认 */
const CONSENT_CATEGORIES = [
  { key: 'workout_self', label: '自主训练' },
  { key: 'meal', label: '饮食' },
  { key: 'body_state', label: '身体状态' },
  { key: 'special', label: '特殊情况' },
  { key: 'posture_report', label: '体态报告' },
  { key: 'raw_photo', label: '原始照片' }
]

const ROLE_LABEL = {
  student: '学员',
  coach: '教练',
  ops: '运营'
}

/** 邀请码默认有效天数（设计约定） */
const INVITE_EXPIRE_DAYS = 7

module.exports = {
  CONSENT_CATEGORIES,
  ROLE_LABEL,
  INVITE_EXPIRE_DAYS
}
