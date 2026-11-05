# TrainBuddy 开发接手指南

更新：2026-11-05，适用 main 的 V1.6。先读本文，再读 [V1.6 连续浏览](design-archive/V1.6/README.md)、 [V1.5 动作库设计](design-archive/V1.5/README.md)、[V1.4 数据目录](design-archive/V1.4/README.md) 与 [V1.3 设计与审计](design-archive/V1.3/README.md)。动作库现为固定搜索、左侧分类、顶部器械和双列卡片，结果分页由内部 scroll-view 触底驱动，不能只依赖页面 onReachBottom。分页查询使用末尾 bodyPart，视口分类 activeBodyPart 仅用于导航高亮；sectionHistory 保存已完成分类，不要将两者混用。关键词搜索不自动跨分类。本文件记录实现决策与接手步骤；不代表生产发布验收。

## 新电脑第一次启动（Windows PowerShell）

准备 Git、Node.js（已验证 v24.22.1）、随 Node 安装的 npm、微信开发者工具。当前引擎声明 >=18，但本轮没有验证全部 Node 版本。GitHub 私有仓库需要你自己的已有访问权限；不要把密码或令牌写进仓库。

```powershell
git clone https://github.com/tracetocoast/TrainBuddy.git
cd TrainBuddy
git switch main
npm ci --prefix server
node scripts/start-local.cjs
```

保持该终端运行。另开终端在仓库根目录检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

应返回 ok=true、service=trainbuddy-api。首次使用空数据目录会自动生成演示数据；不需要先执行 seed/reset。工作机已有 server/data 时不删除、不重置。换电脑不会自动带走旧电脑的本地 JSON 数据、缓存和登录会话。

首次离线依赖安装需要 npm 镜像可达；失败先检查公司代理或 registry。npm ci 在 server 中运行（或使用上面的 --prefix），根目录没有 package.json。端口占用时先确认哪个进程在用，勿随意结束其他服务。重启后仍需运行上述启动命令，目前没有安装系统开机服务。

## 微信开发者工具

1. 导入仓库根目录，读取根目录 project.config.json，miniprogramRoot 为 miniprogram/。
2. 仓库 AppID 是游客占位符，不是有效的正式项目身份。使用你有开发权限的小程序 AppID，并在工具中完成微信登录；AppID 与服务端正式微信登录配置应一致。不要复制旧电脑的登录缓存、AppSecret 或开发者私钥。
3. 本地调试时由开发者在工具的本地设置启用“不校验合法域名”等开发选项；该选项不代表正式发布可使用 HTTP。
4. scripts/start-local.cjs 按当前电脑网卡生成 miniprogram/config.generated.js；该文件被 Git 忽略，不能复制旧电脑 192.168.x.x 地址当固定配置。然后点击编译。
5. 网卡选错或使用多网卡时，在启动终端设置 `$env:TB_DEV_HOST='当前电脑局域网IP'` 后运行脚本。手机与电脑连同一 Wi-Fi，手机浏览器先访问该 IP 的 /health；必要时由开发者检查本机防火墙。
6. 开发、体验、正式地址由 config.generated.js 的 develop/trial/release 配置；trial/release 需要真实 HTTPS API，空值不会自动变成可用生产环境。不要把 localhost 写死到业务页面。

登录页可使用本地演示账号验证界面。教练入口必须是已授予教练角色的账号；学生不能靠切换按钮自升权限。双角色从首页头像进入个人中心切换。

## 环境与数据

- 没有 .env 也能启动本地演示 API。默认 AI_PROVIDER=unavailable，VOICE_ASR_PROVIDER=mock；界面存在不代表真实 AI/ASR 已开通。
- 如需环境文件，复制 server/.env.example 为 server/.env，仅填写自己的授权配置。真实微信登录、图片和语音供应商密钥只放服务端；不要发到聊天、客户端或 GitHub。此次没有迁移或配置旧电脑密钥。
- main 当前默认是 Node.js/Express＋JSON 文件存储（server/data/store.json），不是已验收的 PostgreSQL 生产部署。历史部署讨论和独立分支文档不能替代当前运行证据。
- .env、server/data、node_modules、config.generated.js、project.private.config.json 不随 Git 同步。需要真实历史数据时单独做授权备份与恢复，不用演示数据覆盖。
- project.config.json 若被本机工具修改，提交前用 git diff 检查；不要顺手把全部本机设置上传。

## 验证与日常协作

```powershell
git status --short
git pull --ff-only origin main
node --test server/test/*.test.js
node scripts/check-interaction-build.cjs
```

拉取前先检查未提交内容。ff-only 失败表示分叉，先审查差异，不强推或覆盖。测试使用隔离临时存储并启动本机端口；系统或沙箱拦截临时文件/监听时记录环境失败，不把它当业务通过。编译脚本默认读取安装在 C:/Program Files (x86)/Tencent/微信web开发者工具 的官方 Windows 编译器；安装位置不同时设置 WECHAT_COMPILER_DIR 为含 wcc.exe/wcsc.exe 的 wcc-exec 目录。Mac 原生工具需按实际环境验证，不能照搬 Windows exe 路径。

本轮干净副本：npm 10.9.2 安装锁文件依赖成功（72 包），165 项测试通过，35 WXML/41 WXSS 编译成功；不含本机密钥和已有业务数据。真实手机、弱网、录音中断和完整多尺寸验收仍未完成。

日常沿用 main；用户明确指定 HYY 时使用既有 hyy_release，不自行新增分支。每版提交同时维护 docs/releases/V版本号.md 和 docs/design-archive/V版本号/，说明具体改动、测试及未验证事项。前端改完同步微信开发者工具。按当前授权，完成测试后直接提交并推送 main；某次任务明确禁止推送时遵守该次限制。

## 文件地图及协作边界

| 区域 | 入口 | 接手要点 |
| --- | --- | --- |
| 三导航与角色 | components/bottom-nav、utils/role、utils/guard | 教练工作台/学员/日程，学员课程/记录/进展；权限由服务端授予 |
| 教练记录 | pages/record、components/voice-input、utils/speechComposer | voice-input 仅展示状态；原文、候选、实际训练组不同层；不要合并成同一份数据 |
| 学员详情 | pages/student-profile | 训练历史和计划优先，授权生活资料折叠；私人备注不得展示给学员 |
| 工作台/日程 | pages/home、booking、schedule-rules | 待确认不是预约成功；演示排班仅 develop 且 demo=1 的显式入口 |
| 体态 | pages/ai?tool=posture | 直达模式；照片仍归当前登录账号，不自动变成所选学员的照片或评估 |
| 动作库 | pages/exercises、exercise-detail、server/src/data/exercise-catalog.json | 公开目录 800+；筛选分页；示范图 jsDelivr；自定义动作不进公开列表 |
| 样式 | styles/tokens、styles/coach、页面 WXSS | Refined Green，教练作用域；不靠连续追加覆盖修样式，不整体换肤 |
| API 与数据 | server/src/routes、services、store；miniprogram/services | 本轮保持契约、数据库与权限逻辑不变 |
| AI/语音协作 | server 的供应商、Prompt 与 ASR 模块 | 若芷负责的接口和 Prompt 不在前端视觉调整中顺手修改；真实服务验收单独记录 |

## 下一步先解决什么

### 微信工具白屏：Babel 辅助模块加载失败

2026-11-04 本机复现 `@babel/runtime/helpers/arrayWithHoles.js is not defined`，界面白屏，但官方 WXML/WXSS 与 JS 语法检查通过。使用工具官方 CLI 关闭当前项目再重新打开后，实际学员列表恢复，控制台未再显示该红色错误；API /health 正常。此结果表明项目重载可以恢复本次异常，尚不能断言所有同类错误都仅由缓存引起。

遇到同类问题先记录第一条红色错误，检查 miniprogramRoot、当前导入目录、工具版本及编译结果，再关闭并重开项目。不要为修复编译产物而清空业务数据或登录缓存，也不要直接修改业务流程或上传本机配置。若重开仍失败，继续检查模块路径和增强编译器输出。

**P0：新课次复用旧 session。** createCoachDraftSession 的固定 cdraft_学生ID 键会命中 24h 响应缓存；还存在草稿恢复语义。前端已补最新 GET，避免已完成记录伪装草稿，但这没有解决创建下一次记录。先按 [接口提案](design-archive/V1.3/audit-plan.md)确认“创建意图、恢复草稿、修订、并发、TTL”再实现，不用时间戳重进就乱建记录。新增真实 HTTP 测试复核了缓存重放和最新查询契约，没有把该问题标为修复。

**P1：同步前自动完成 pending。** record 页先逐组 PATCH done 再 finalize，可能记入未实练组，也可能只完成了一部分就失败。本轮仅逐项披露后果，未改业务规则；需要服务端确认状态语义与事务边界。

随后做真实微信与手机验收：新建有效课次→语音→核对→逐组调整→共享→学员查看；320/375/430px、键盘最后字段、断网重试、录音暂停/中断和角色切换，记录实际设备、时间、截图与失败点。没有真实证据前，不宣称“所有功能可上线”。
