# V1.13 设计与实施归档：皮肤系统（白色 / 黑色）

2026-11-06。布局、字号、圆角与交互沿用原仓库 V1.12 及之前的全部设计，不新出线框；本版只做颜色变量化与暗色映射。版本号原为 V1.5，因原仓库已独立使用 V1.5（动作库浏览改版），调整为 V1.13。

- [版本更新](../../releases/V1.13.md)

## 方案

- 白色皮肤 = 现状：`styles/tokens.wxss` 语义 token 全部保留，补充 token 的浅色值即原硬编码值。
- 黑色皮肤 = 墨绿暗色：`styles/skin-dark.wxss` 以 `.skin-dark`（类名重复一次提高优先级）覆盖全部语义 token，背景 `#0f1512`、表面 `#1a211c`、强调 `#4e9d6f`。
- 切换机制：`utils/theme.js` 读写本地存储 `lianzida_skin`；`app.js` 包装全局 `Page()`，在 onShow 注入 `data.skinClass` 并调用 `wx.setNavigationBarColor` / `wx.setBackgroundColor`；页面根节点 WXML 绑定 `{{skinClass}}`。
- 入口：「个人中心 → 外观」卡片，滑块式分段开关（绿色高亮块左右滑动），选择即时生效并持久化。
- 切换动效：小程序无 View Transitions API，用"圆形扩散遮罩"模拟参考实现的 circle-blur-reveal——新皮肤实色底色（浅色 #f3f5f7 / 暗色 #0f1512，55% 不透明度）圆形从点击坐标 `scale(0)→scale(N)` 扩散（233ms Material 标准曲线 + `blur(14px)→0` 软边），扩散约 207ms 时真正切换皮肤，随后遮罩 80ms 淡出。曾尝试 `backdrop-filter` 毛玻璃方案后回退。scale 按点击点到最远屏幕角落距离动态计算。

## 与上游 V1.6-V1.12 合并的落地

- 上游重构了 token 体系（`--ix-*` 改为语义别名、新增 `--soft`/`--ok-soft`/`--warn-*` 状态浅底），皮肤体系与其兼容；`skin-dark` 对上游新 token 一并给出暗色值。
- 上游新设计的色板（亚麻纸 `--linen-*`、薄荷 `--mint-*`、松绿 `--pine-*`、玫瑰 `--rose-*`、玻璃底 `--glass-*`、钢蓝 `--steel-ink`）已建 token 并双主题映射。
- 冲突页面以上游新版为基础重新接入：根节点补回 `{{skinClass}}`（exercises 页根为 `exercise-library`，模板内不绑定）；`bottom-nav` 重新移入 7 个页面根 view。
- 修复 workout 页合并产生的 2 处自引用 token（`--accent: var(--accent)`、`--signal: var(--signal)`）。
- 白色半透明文字 rgba（作用于绿色/深色底）双主题通用，保留不动。

## 未验证

- 本机未安装微信开发者工具，官方 wcc/wcsc 编译未执行；需在工具中编译确认。
- 黑色皮肤真机目测验收（含 V1.12 摩天轮训练页、动作库双栏浏览、键盘弹起、下拉刷新底色）未完成。
- 本地 API 服务需重启以加载上游 V1.6-V1.12 的服务端改动。
