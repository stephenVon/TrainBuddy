/**
 * 小程序运行时配置
 * 开发者工具 / 真机调试：详情 → 本地设置 → 勾选「不校验合法域名、web-view、TLS」
 * 真机与电脑须同一 Wi-Fi；仅模拟器可用 127.0.0.1
 */
let environments = {}
try { environments = require('./config.generated') } catch (_) {}
let environment = 'develop'
try { environment = wx.getAccountInfoSync().miniProgram.envVersion || 'develop' } catch (_) {}
const configured = environments[environment]
module.exports = {
  API_BASE_URL: environment === 'develop'
    ? (configured || 'http://127.0.0.1:8787/api/v1')
    : (/^https:\/\//.test(configured || '') ? configured : ''),
  /** 使用真实后端（false 时才回退到历史 mock，正式交付应保持 true） */
  USE_REMOTE_API: true
}
