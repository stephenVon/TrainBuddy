# V1.2 前端审计和改造计划

日期：2026-11-03。固定基线：`90744282c72beca4c76739e51a6e0cfcb7e5ccc7`，与 fetch 后的 origin/main 一致。实施分支：`feat/coach-ui-refinement-v1-2`。用户已授权仅暂存本机 project.config.json，完成后原样恢复；不 push、不 merge。

## 静态审计结论

1. 教练三导航已正确存在，不重做信息架构。home 主入口仍为文字按钮，课程状态混在辅助文案中；home.wxss 留有旧统计与深色英雄区样式。
2. record 已是点击录音，不能再按长按模式重构。主输入、voice-panel 和公开建议可重复出现结束操作；不支持暂停的通道同时出现“结束本段”和“结束录音”。
3. record.wxss 的 rec-on、aset、aset-line、composer-mic、mini-field 多次声明。composer-mic 旧的 96rpx !important 宽度会压过后加规则。需要整理源规则，不能继续尾部覆盖。
4. 候选、原话、冲突、逐组输入和备注纵向堆叠；高级合并虽已折叠，任务阶段仍不清晰。当前缓存、保存队列、撤销、权限及最终同步规则应保留。
5. students 空搜索与无绑定共用“暂无绑定学员”；开发诊断折叠开关在所有环境显示。现有名单接口没有真实进步指标，不新增数字。
6. booking 的 coachTab 初值为 pending，并非日视图；排班设置占独立标题区，日视图仍有“空档示意”命名。保留真实时段、周视图及预约状态机。
7. tokens 与 interaction-scope 重复定义相同色板；导航 WXSS 末尾覆盖前部定义。共享导航还服务学员，应使用教练作用域精修，不全局换肤。

以上为源码证据，尚不等于本轮真机复现。当前未测键盘遮挡、小屏、长文本和真实语音。

## 分阶段实施与提交

| 阶段 | 实际拟改文件（miniprogram/ 下） | 用户体验及验收 |
| --- | --- | --- |
| 1 视觉基础 | styles/tokens.wxss；新增 styles/coach.wxss；components/bottom-nav/index.{js,wxml,wxss}；pages/record/index.wxss | 复用暖白绿与语义变量；教练限定按钮、圆角、间距；合并重复规则；学员导航视觉不变；支持减少动画 |
| 2 工作台 | pages/home/index.{js,wxml,wxss,json}；轻量原生图标组件 | 唯一主焦点为麦克风图标+记录训练，仍调用 goRecord；课程紧凑行；辅助入口低权重；清晰空载错状态 |
| 3 语音输入 | 新增语音输入展示组件；pages/record/index.{js,wxml,wxss,json} | 同一组件承载文字、录音及状态；单一结束操作；真实计时；保留暂停与分段降级；状态由原 hooks/API 驱动，不改 speechComposer/ASR 服务 |
| 4 核对和编辑 | pages/record/index.{js,wxml,wxss} | 同页四阶段渐进披露；折叠不清空原话或候选；冲突和缺失值保留；公开与私人备注分清；同步前摘要及原确认规则 |
| 5 学员与日程 | pages/students/index.{js,wxml,wxss,json}；pages/booking/index.{js,wxml,wxss,json} | 名单紧凑、搜索空结果准确；诊断仅开发环境显式访问；日程默认日视图；低频排班工具下沉；保留待处理、周视图及接口 |
| 6 验证归档 | server/test 前端测试；docs/releases/V1.2.md；docs/design-archive/V1.2/ | 双角色回归、状态与重复操作测试、官方编译、开发者工具同步；前后截图及未验证项目明确记录 |

共享 base.wxss 优先不改；必要变更须证明不影响学员。每阶段小步提交，不将视觉改造扩展为业务重写，不改后端、Prompt、ASR 协议或数据库。

## 验收清单

- 自动化：保留现有测试；新增组件状态/单一结束按钮、输入模式切换保留内容、阶段切换及保存保护、默认日视图、诊断环境隔离、三导航角色回归。
- 视觉：教练工作台/记录/学员/日程的相同尺寸前后截图；截图不支持或被遮挡时记未验证，不用线框代替运行证据。
- 尺寸：320、375、430 CSS px 宽；长姓名/动作/错误文案、20 动作长表、空载错状态、安全区、键盘及减少动画。
- 业务：绑定学员选择、录音启动/暂停/中断/结束、Mock 提示、候选补齐/冲突/撤销、最后字段未失焦同步、失败重试、待确认预约不能标成功。
- 真机：有可用 iOS/Android 才执行并记录设备、基础库与结果；缺设备、麦克风授权或供应商配置时明确 Blocked/Not Executed。
- 最后恢复 project.config.json 并核对原内容；更新设计归档和精简版本说明；本轮仅本地提交。
