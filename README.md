# 练搭子 · 微信小程序

面向私教与学员的训练记录协作小程序。当前 main 为 V1.4；AI 演示、真实供应商和正式发布验收分别记录。

**新电脑从这里开始：[开发接手指南](docs/DEVELOPER-HANDOFF.md)。** 包含依赖安装、AppID、环境变量、启动、测试、架构、协作规则及未解决的问题。[V1.4 更新](docs/releases/V1.4.md) · [设计与验收归档](docs/design-archive/V1.4/README.md)。下方历史功能说明不等于所有功能已通过真实环境验收。

## 快速开始

### 1. 启动统一业务 API（必做）

```bash
cd server
npm ci
npm start
# http://127.0.0.1:8787/api/v1
npm test   # AC03–09 / AC10–25 / AC26–32 / AC40 等
```

契约见 `docs/API-server.md`、`docs/API-AI-MEDIA.md`。演示邀请码：`LINYE7D`。

### 2. 打开小程序

1. 安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 导入本仓库根目录（含 `project.config.json`）
3. **详情 → 本地设置 → 勾选「不校验合法域名」**
4. `miniprogram/config.js` 中 `API_BASE_URL` 默认指向本机 `8787`

业务数据在服务端；本地仅缓存登录会话与编辑草稿。

## 功能对照

### 2026-10-19 计划编辑更新

- 动作库真正加入个人草稿，新增组不自动套用示例负荷。
- 支持动作增删排序、逐组参数、草稿恢复及正式发布。
- 计划作者权限、教练草稿隐藏和修订冲突校验已补齐。
- 修复旧数据缺少生成索引时无法自动生成下次计划的问题。
- 接口与边界见 `docs/API-plan-editor.md`。

| 角色 | 底部导航 | 能力 |
| --- | --- | --- |
| 学员 | 课程 / 记录 / 进展 | 课程与教练反馈、自主训练与成长，辅助内容从二级入口进入 |
| 教练 | 工作台 / 学员 / 日程 | 语音课后表、训练历史与计划、排课及体态工具 |

### 已实现：登录与绑定骨架

- 登录页（mock 会话 + 预留微信登录）
- 角色只能使用**服务端已授予**的角色切换，禁止前端自升教练（AC01）
- 邀请码绑定 / 解绑 / 分类授权（AC02、AC33）
- 个人中心：绑定管理、隐私授权、申请教练、生成邀请
- 草稿键按「账户 + 角色 + 学员」隔离（AC38）

测例见 `docs/AC-auth-binding.md`。演示邀请码：`LINYE7D`。

### 已实现：约课排班（文档第 6 节）

- 真实日期空档、确认后才占用、`pending → confirmed` 状态机
- 教练日/周视图、待处理确认/拒绝、改期 ChangeRequest、周规则与例外
- 区间冲突（含缓冲）；无数据不展示示例数字
- Mock 契约见 `docs/API-booking-mock.md`

### 已实现：计划与实际训练（文档第 7 节）

- TrainingPlan / WorkoutSession，每组独立 ActualSet
- 教练课后表草稿不共享，「确认并同步」发正式版
- 规则版下次计划（不默认 +5kg），C05 可编辑发布
- 学员逐组打卡、幂等结束、草稿恢复；修正全局计数问题
- 契约见 `docs/API-training-mock.md`

### 已实现：动作库 / 日记 / 成长（文档第 8 节 · S06–S08）

- **S06 动作库**：800+ 已审核公开动作（free-exercise-db / Unlicense）；搜索、部位/器械筛选、分页、示范图与步骤；可加入个人计划草稿。自定义动作不进入公开库。数据来源见 `server/src/data/README.md`。
- **S07 每日日记**：饮食 / 饮水 / 状态 / 特殊情况 / 休息打卡分实体；按日+类别授权共享
- **S08 成长**：日历同日多标记；指标按 8.4 口径，无数据显示「暂无」
- **教练学员档案**：只读已共享内容 + 点评；看不到显示「记录不可见」

### 已实现：统一业务 API（文档第 16 节）

- Node 服务覆盖 **API01–31**（含媒体／AI／体态／目标图／咨询）
- 幂等键、`REVISION_CONFLICT`、权限矩阵、Asia/Shanghai 业务日
- 小程序 `services/*` 调真实 HTTP；本地只留草稿
- 后端测例：`cd server && npm test`

### 已实现：课后表语音（文档 7.3 · AC11–14）

- 录音 → 可切换转写适配器（`mock` / `wechat`）→ 结构化候选 → 教练确认合并
- 缺字段不擅自补全；冲突保留人工值；同 `segment_id` 不重复；无麦克风可手填
- 详见 `docs/API-voice.md`

### 已实现：媒体 / AI 任务 / 体态 / 目标图 / 咨询（文档 9–10 节 · AC26–32、AC40）

- 上传意图 → 完成 → 短期访问；删除后立即 410，清理任务可查
- AI 任务中心：`posture_scan` / `goal_image`；演示与真实隔离；未接入不得成功
- 体态报告无「82 分」总分；项目含「无法判断」；教练复核不覆盖 AI 原文
- 目标图多节点、水印导出、部分失败单节点重试；撤权迟到回调不发布；账本一次核销
- 咨询「咨询方案」幂等，不生成订单
- 详见 `docs/API-AI-MEDIA.md`

### 已实现：权益账本 / Outbox / 运营后台 / 支付开关（文档 12 节 · AC31、AC34、AC35）

- 预占 → 核销 → 释放；目标图按成功节点扣额度；重复回调不重复核销
- 订阅到期：历史可读，新付费操作 `402`；演示模式不计费
- 通知 outbox：业务成功与渠道投递解耦，失败可运营重试
- 支付默认关闭（`PAYMENT_ENABLED`），不开放真实付款、不模拟付款成功发权益
- 最小运营页：`http://127.0.0.1:8787/ops/`（`ops_admin`）
- 详见 `docs/API-ENTITLEMENTS-OPS.md`

顶部角色切换仅展示已授予角色。

## 目录结构

```
├── project.config.json
├── server/                             # 统一业务 API（Node）
├── docs/API-server.md
├── lianzida_clickable_prototype.html   # 原始可点击原型
├── miniprogram/
│   ├── app.js / app.json / app.wxss
│   ├── components/bottom-nav/          # 双角色自定义底部导航
│   ├── pages/
│   │   ├── home/                       # 学员今天 / 教练工作台
│   │   ├── booking/                    # 约课 / 排课
│   │   ├── workout/                    # 训练打卡
│   │   ├── exercises/                  # 动作库（S06）
│   │   ├── diary/                      # 每日日记（S07）
│   │   ├── ai/                         # AI 体态
│   │   ├── growth/                     # 成长日历与指标（S08）
│   │   ├── record/                     # 课后记录（教练）
│   │   ├── students/                   # 学员列表（教练）
│   │   └── student-profile/            # 学员档案只读+点评
│   ├── services/                       # mock API
│   └── utils/                          # 会话、权限、时间、本地状态
```


## 说明

- 当前为前端演示：无真实登录、支付、云端同步或微信订阅消息
- AI 体态为交互动效与示例报告，非真实分析
- 正式上线前请替换 `appid`，并接入后端、权限与消息能力
