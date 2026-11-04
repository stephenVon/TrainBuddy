# V1.2 实施与真实验证

环境：Windows，Node.js v24.22.1；微信开发者工具 2.02.2609231 RC，控制台显示基础库 3.7.4。基线及分支见本目录 README。开始前执行 git fetch origin，确认与 main 一致。

## 小步提交与文件范围

| 检查点 | 文件与体验变化 | 该阶段验证 |
| --- | --- | --- |
| d4d6dae | 本目录 audit-plan.md：先审计与逐文件计划 | 固定原始 HEAD，未修改业务代码 |
| a124286 | tokens.wxss、coach.wxss、bottom-nav、ui-icon、coach-icons、生成脚本：教练限定风格与图标 | 导航 4 项通过；34 WXML/40 WXSS 编译通过 |
| f45602e | home WXML/WXSS/JSON：语音主入口、课程行、次级工具 | 相关 15 项通过；原生编译通过 |
| 0371436 | voice-input 组件及 record JS/WXML/WXSS/JSON：统一录音和同页渐进披露 | 相关 17 项通过；35 WXML/41 WXSS 编译通过 |
| 6676c99 | students、booking、coach-refinement.test.js：列表、诊断隔离、默认日程 | 相关 28 项通过；原生编译通过 |
| 80537b3 | 原生按钮宽度、组件合法选择器、最新记录读取、错误保留与回归测试 | 最终全量 160/160，通过；35 WXML/41 WXSS 编译通过 |

以上均为本地提交。main 未改动，没有 push 或 merge。全局 base.wxss、server/src、miniprogram/services、speechComposer.js、Prompt 及数据库配置均无本轮差异。

## 执行结果

| 项目 | 状态 | 实际证据或限制 |
| --- | --- | --- |
| node --test server/test/*.test.js | Passed | evidence/tests.txt：160 项，0 失败、0 跳过；测试用隔离临时存储 |
| node scripts/check-interaction-build.cjs | Passed | evidence/compiler.txt：35 WXML、41 WXSS，JSON/JS 0 失败 |
| 原三导航、角色切换授权及学员图标回归 | Passed（自动化） | 原测试＋新增导航角色复用测试；不等于本轮双角色真机通过 |
| 文本、候选、补丁的任务区切换保留 | Passed（自动化） | coach-refinement.test.js；活跃录音不能跳区 |
| 处理失败保留输入与就地错误 | Passed（自动化） | 网络失败用例保留原文、退出 busy 状态并展示错误 |
| 本地 API /health | Passed | HTTP 200，trainbuddy-api，payment_enabled=false |
| 开发者工具同步 | Passed | 初次游客 AppID 打开失败；恢复本机真实配置后官方 CLI 返回 open 成功，截图显示新页面 |
| 工作台、学员、日程（390px 模拟器） | Passed（局部视觉） | 实际打开并观察；发现并修正半宽按钮和日期条宽度，不能据此证明全部业务可用 |
| 当前学员的文本整理 | Failed / 已知限制 | 实测接口拒绝：“已同步记录请走修订”；不能报为 ASR 或候选流程成功 |
| 最新记录状态显示 | Passed（模拟器＋自动化） | 补查既有 GET session 后，同一记录显示已同步、4/4、只读；不改后台规则 |
| 新建下一次教练记录 | Blocked | createCoachDraftSession 的固定 cdraft_学生ID 请求会复用旧记录；需另行设计记录创建／修订入口，本轮不擅改协议或伪造新草稿 |
| 375px 业务页 | Blocked | 已选择 iPhone 12/13 mini；模拟器重启后回登录页，未代操作登录，不能声称该尺寸业务页通过 |
| 320/430px、长文本及长训练表 | Not Executed | 有针对性布局及媒体查询，但没有相应运行证据 |
| 真机键盘、来电/后台、弱网、iOS/Android 麦克风 | Not Executed | 没有可操作的真机及权限；录音状态测试使用原生接口替身，不等同设备实录 |
| 真实 ASR、AI 输出质量 | Not Executed | 当前演示通道，未读取或配置桌面密钥，不将 Mock 当真实能力 |

控制台保留过工具内部 simulator launch failed 历史错误，之后已实际渲染业务页；根因未确认，不宣称已修好开发者工具。另观察到新组件 tag/attribute WXSS 警告，已改为 class 规则；后续真机仍需复核。初始界面曾被其他窗口遮挡，因此没有完整 V1.1 同设备截图，未用 V1.1 线框冒充运行对比。

## 本机配置保留

用户授权仅 stash project.config.json 后建分支。恢复时发现 Git 自动转换换行，已核对并恢复原始字节，SHA256 为 `0D9FD99817C9353B3B2945F7449D28CBBB88A00DA97B0899089D3ED310AD3CB8`。此文件仍为原有未提交修改，没有纳入版本提交。原 stash 保留为恢复备份。

## 后续验收顺序

先解决新记录创建与旧记录修订的入口及幂等范围，再用未完成测试记录复跑：录入→候选补齐/冲突→合并/撤销→逐组编辑→同步→学员可见范围。随后在 320/375/430px、长内容、软键盘及真实 iOS/Android 上检查，记录实际设备、耗时和错误。没有这些证据前，本版不能作为全面上线验收通过。
