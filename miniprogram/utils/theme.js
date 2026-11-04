/**
 * V1.5 皮肤系统：白色（默认，现状不变）/ 黑色两套皮肤。
 * 通过页面根节点 skinClass 挂 .skin-dark 切换 CSS 变量；页面 JS 无需感知。
 */
const STORAGE_KEY = 'lianzida_skin'

const SKINS = {
  light: {
    skinClass: '',
    navBg: '#f3f5f7',
    navFront: '#000000',
    winBg: '#f3f5f7'
  },
  dark: {
    skinClass: 'skin-dark',
    navBg: '#0f1512',
    navFront: '#ffffff',
    winBg: '#0f1512'
  }
}

function getSkin() {
  try {
    return wx.getStorageSync(STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch (e) {
    return 'light'
  }
}

function setSkin(skin) {
  const value = skin === 'dark' ? 'dark' : 'light'
  try {
    wx.setStorageSync(STORAGE_KEY, value)
  } catch (e) {
    // 存储失败时仅本次会话生效
  }
  return value
}

/** 在页面 onShow 中调用：注入根节点 class 并同步导航栏/窗口底色 */
function applyToPage(page) {
  if (!page || !page.setData) return getSkin()
  const skin = getSkin()
  const conf = SKINS[skin]
  if (page.data.skinClass !== conf.skinClass) {
    page.setData({ skinClass: conf.skinClass })
  }
  try {
    wx.setNavigationBarColor({
      frontColor: conf.navFront,
      backgroundColor: conf.navBg,
      fail: () => {}
    })
    wx.setBackgroundColor({ backgroundColor: conf.winBg, fail: () => {} })
  } catch (e) {
    // 部分环境不支持时忽略，页面内配色仍由 skinClass 生效
  }
  return skin
}

module.exports = { getSkin, setSkin, applyToPage }
