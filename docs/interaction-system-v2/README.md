# TrainBuddy Interaction System 2.0

本轮基于 main `6c0bc9e6b5780b56fe6e16ac61d8c50842aee975`，在 `feat/interaction-system-v2` 实施。限定为原生小程序交互与对应测试；不修改服务端业务、数据库、部署、首页品牌及导航。

## 现状审计与设计映射

| 页面 / 原始文件 | 原交互问题 | 已接入方案 | 原生实现 | 风险与验收 |
| --- | --- | --- | --- | --- |
| `miniprogram/pages/plan-edit/index.*` | 组参数全堆在小输入框里；只支持上下移；删除后难核对 | 动作摘要列表、逐动作参数面板、独立组参数、复制、拖动与按钮排序 | TrainingNumberControl、slider、固定底部面板、限定拖动手柄、原生离页提示及草稿缓存 | 拖动不触发输入；排序后 ID/重量/次数不变；缩减组数须确认；草稿保存失败可见 |
| `miniprogram/pages/booking/index.*` | 横向日期难找；发请求没有持续结果状态；旧日期响应可能覆盖新日期 | 日期快速查找、可用时间滚轮、状态按钮、乱序响应隔离 | TrainingPicker 的原生 date/selector picker；BookingActionButton 只呈现父页面的 API 状态 | 切日期清除旧选择；只列有效选项；冲突重载并重新确认；pending 不显示成功 |
| `miniprogram/pages/workout/index.*` | 每次失焦立即请求；重量/状态请求可交错；失败不保留显式草稿；结束时未带最新修订号 | 当前组展开、其余组紧凑显示、逐组本机暂存、明确保存/完成、底部单手完成条 | TrainingNumberControl、串行保存、账号/角色/会话草稿键、完成后自动定位下一组 | 重复点击只有一个在途写操作；失败不推进；历史组可重新选中；结束先保存剩余输入，再使用最新 revision |

既有入口继续保留：计划元数据、重量口径、动作库/自定义动作、逐组移除与添加、保存草稿和发布、预约列表与详情、教练排班/待办、跳过、结束/放弃、角色切换与底部导航。预约条件、训练完成规则、发布权限仍由既有 API 决定。

## 参考阅读及兼容性决定

阅读时间：2026-10-28；网页与公开源码只用于交互原理研究，本仓库实现未复制 React/TSX 源码。

| 来源 | 阅读到的机制 | 采用 / 不采用 |
| --- | --- | --- |
| [Range Slider](https://beui.dev/components/motion/range-slider) | `snapSliderValue`、边界保护、受控值、刻度、减少动效分支 | 原生 slider 控制小范围；重量用可点选的局部刻度、步进及精确输入；不移植 pointer/DOM hooks |
| [Wheel Picker](https://beui.dev/components/motion/wheel-picker) | 连续位置与最终选项分离；停止后吸附到整数索引；禁用状态 | 使用系统 picker 承担滚轮惯性和吸附；日期变更后重新请求并清除旧时间 |
| [Action Swap](https://beui.dev/components/motion/action-swap) | 通过值切换文字/图标，减少动效时简化过渡 | API 状态控制文字；保留状态文本，动画不触发业务成功 |
| [Arc Picker](https://beui.dev/components/motion/arc-picker) | 弧形排列、选项禁用、键盘/选择语义 | 不用于本轮精确数值或约课；避免为了造型增加手势负担 |
| [Motion 索引](https://beui.dev/components/motion) / [Sortable Stack](https://beui.dev/components/motion/sortable-stack) | 稳定 item identity，手柄触发拖动，替代排序操作 | ID 保持稳定，只有手柄接收拖动；继续保留上移/下移 |
| [Bottom Sheet](https://beui.dev/components/motion/bottom-sheet) / [Morphing Modal](https://beui.dev/components/motion/morphing-modal) | 面板进入、背景遮罩、明确关闭、内容滚动 | 使用原生 fixed 面板和 scroll-view；不引入 portal、DOM focus trap、布局测量动画 |
| [Universe](https://universe.io) | 此次访问只返回占位图片，没有可核查的组件说明或源码 | 不将其列为组件来源，也未擅自将该域名替换成其他网站 |

beUI 公开仓库为 [starc007/ui-components](https://github.com/starc007/ui-components)，查阅其 [MIT License](https://github.com/starc007/ui-components/blob/main/LICENSE)。本轮为独立原生实现，无新增运行时依赖；未来直接复用第三方代码时须保留相应许可声明。

## 可复用组件协议

### TrainingNumberControl

路径：`miniprogram/components/training-number-control/index.*`。

- 属性：`value / label / unit / min / max / step / integer / disabled / showSlider / sliderMax / ruler / reduced`。
- `input({value})` 保存原始编辑值，允许保留 `52.` 等中间输入；不触发 HTTP。
- `change({value})` 是明确的滑动结束、步进、刻度点选或合法输入提交；组数控件只监听此事件。
- 重量 0–2000 kg，精度最多两位小数，步进 2.5 kg；精确输入不强制对齐到 2.5。范围属于前端输入保护，不代表推荐训练负重。
- 次数 1–1000 的整数；高频滑杆默认覆盖 1–40，超过 40 可精确输入，随后滑杆上限随值扩展。组数 1–30。
- 重量局部刻度围绕当前重量排列，可以横向查看并点选；不是虚假的装饰刻度。
- 触觉最多每 120ms 一次，API 不可用时忽略；启用减少效果后关闭触觉。

### BookingActionButton

路径：`miniprogram/components/booking-action-button/index.*`。

`idle → submitting → submitted / confirmed / error`。`submitted` 表示服务端 `pending`；只有 `confirmed` 才表示预约成功。组件仅触发 `activate`，不发网络请求，不设成功计时器。提交期间锁定重复激活；失败理由持续展示。

父页面有同步在途锁，网络重试沿用稳定请求键。时段冲突或预约窗口关闭时清除旧选择、重载时间并再次确认。当前沿用既有请求键策略，取消后对同一时段重新预约的体验仍需结合后端幂等保留策略单独验证，不能把本轮前端锁当作全系统幂等保证。

### TrainingPicker

路径：`miniprogram/components/training-picker/index.*`。

属性 `mode / label / value / start / end / options / disabled / placeholder`，事件 `change({value})`。日期使用 `date`，时间使用 `selector`，由系统处理 iOS / Android 滚轮。时间 options 只含服务端开放且尚未过期的时段，完整不可约状态仍保留在时段列表中。

## 交互 Tokens 与状态规范

公共文件 `miniprogram/styles/interaction.wxss`，只导入本轮三个页面。

| Token | 值 / 规则 |
| --- | --- |
| ink / muted / surface | `#17202B / #526071 / #FFFFFF` |
| accent / line / error | `#214BEB / #DCE2E8 / #B42332` |
| 当前组完成条 | 石墨底、少量 `#C7F36B` 行动色；不全页荧光 |
| 数字 | 大号、tabular-nums；保留单位与目标值；输入与步进按钮相邻 |
| 圆角 | 输入/按钮 12–16rpx；面板顶部 32rpx；列表用分隔线 |
| 即时反馈 | 100ms，轻微 scale；不阻塞连续操作 |
| 状态切换 | 200ms，opacity/transform；loading 与文本独立表达业务状态 |
| 面板 | 280ms，translateY + opacity；不使用大幅回弹或高度循环测量 |
| 减少效果 | 三页提供开关，持久化到 `trainbuddy_reduce_motion_v1`；关闭自定义过渡和触觉，滚动定位 duration=0 |
| 点击目标 | 数值步进最小 44px；完成条最小 48px；保留文字与禁用状态，不只靠颜色 |

没有可靠接入系统“减少动态效果”识别；目前提供手动替代，不宣称自动适配。原生 picker/slider 的系统过渡不由自定义 CSS 控制。

## 数据一致性与恢复

训练组本机草稿使用 `账号:展示角色:workout-v2:session_id`。输入立即更新本地草稿；保存中冻结数值控件，按完整组数据提交。只有成功返回才清除此组 pending；其他组的 pending 会叠加到服务端返回快照，避免被覆盖。完成后按动作顺序寻找下一未完成组；重新选中历史组可修改并保存。结束先串行保存所有 pending，再提交最新 revision；失败保留剩余输入且不显示完成。

计划继续使用既有版本/修订号与本地草稿规则。复制动作和组重新生成 ID；排序只移动整体对象。缩减组数需要确认，取消会恢复显示值。设备支持时启用原生未保存离页提示；不支持时仍逐次缓存。面板收起不会发布，保存草稿与发布是两个明确动作。

限制：本机暂存不等于云端备份，尚未保存的数据不能跨设备恢复；退出登录的既有清理策略可能删除本机草稿。既有 `utils/store.js` 会吞掉存储写入错误，本轮未修改该通用逻辑，不能保证系统存储满时仍能恢复。跨设备同时编辑训练组的冲突机制属于既有后端边界，本轮不宣称解决。

## 验证与证据

见 [验证记录与人工验收](verification.md)。[改造前后结构对比](comparison.svg) 为根据源码绘制的示意图，**不是真机截图，不用于证明性能或端到端通过**。

复现命令（仓库根 / server）：

```powershell
node scripts/check-interaction-build.cjs
# 在 server 目录
node --test test/*.test.js
```

编译脚本使用本机安装的微信官方 wcc/wcsc；其他安装位置可通过 `WECHAT_COMPILER_DIR` 指定。不会构建 React、不发版、不上传。

## 文件范围与后续顺序

1. 三个页面：`plan-edit / booking / workout` 的 JS、WXML、WXSS、JSON。
2. 三个组件、`utils/interaction.js`、`styles/interaction.wxss`。
3. `server/test/interaction-system.test.js`、`interaction-http.test.js`，以及既有 `plan-editor-page.test.js` 的依赖加载适配。服务端业务代码未动。
4. 编译脚本和本目录说明。

下一批按收益排序：先完成双平台真机验收及触控宽度/软键盘调整；再将相同数值控件接入教练课后 `record` 页面（需特别检查其保存与 finalize 修订号路径）；再做教练批量模板编排；最后才考虑长列表跨屏拖动、撤销栈、复杂手势或更多动效。本轮拖动仅处理当前可见列表范围，无跨屏自动滚动；上移/下移按钮可完成跨屏排序。

回滚：回退本分支提交即可。无数据库迁移。已通过 API 保存的真实业务数据不会因回退前端而被清除；本轮测试仅使用隔离数据。
