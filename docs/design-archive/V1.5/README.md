# V1.5 设计与实施归档：皮肤系统（白色 / 黑色）

2026-11-04。布局、字号、圆角与交互沿用 [V1.4](../V1.4/README.md) 之前的全部设计，不新出线框；本版只做颜色变量化与暗色映射。

- [版本更新](../../releases/V1.5.md)

## 方案

- 白色皮肤 = 现状：`styles/tokens.wxss` 原有 token 全部保留，补充 token 的浅色值即原硬编码值。
- 黑色皮肤 = 墨绿暗色：`styles/skin-dark.wxss` 以 `.skin-dark`（类名重复一次提高优先级，压过页面级 `@import` 的 `.interaction-scope` 同名变量）覆盖全部语义 token，背景 `#0f1512`、表面 `#1a211c`、强调 `#4e9d6f`。
- 切换机制：`utils/theme.js` 读写本地存储 `lianzida_skin`；`app.js` 包装全局 `Page()`，在 onShow 注入 `data.skinClass` 并调用 `wx.setNavigationBarColor` / `wx.setBackgroundColor`；页面根节点 WXML 绑定 `{{skinClass}}`。
- 入口：「个人中心 → 外观」卡片，白色 / 黑色两个选项，选择即时生效并持久化。
- 切换动效：小程序无 View Transitions API，用"圆形扩散遮罩"模拟参考实现的 circle-blur-reveal——新皮肤实色底色（浅色 #f3f5f7 / 暗色 #0f1512）圆形从点击坐标 `scale(0)→scale(N)` 扩散（700ms Material 标准曲线 + `blur(8px)→0` 软边），扩散约 620ms 时真正切换皮肤，随后遮罩 240ms 淡出。曾尝试 `backdrop-filter` 毛玻璃方案后回退为实色遮罩。scale 按点击点到最远屏幕角落距离动态计算，保证任意位置都能盖满全屏。

## 实际落地

- 约 80 处硬编码色值 token 化，映射约 40 个补充语义 token（--tint-1/--blue-*/--warm-*/--green-*/--ok-*/--danger-bg 等），浅色值与原值一致。
- 26 个页面根节点全部绑定 `{{skinClass}}`（含 login/ai/body 系列等非 `.page` 根）。
- `bottom-nav` 从根 view 外移入内部（workout/students/record/coach/booking/home/growth 7 页），保证继承皮肤变量。
- `interaction.wxss` 的 `--ix-*` 与 `body.wxss`、`base.wxss`（hero、done、disabled、error 状态）全部改引语义 token。
- booking 页 `switch` 组件的 `color="#28744e"` 为组件属性，无法用 CSS 变量，双主题下均保留原绿色。

## 未验证

- 本机未安装微信开发者工具，官方 wcc/wcsc 编译未执行；需在工具中编译确认。
- 黑色皮肤真机目测验收（含键盘弹起、下拉刷新底色、暗色下图片对比度）未完成。
- 本地 API 服务在改动前启动，验证皮肤需重启后于开发者工具中确认。
