# V1.4 设计与实施归档

2026-11-04。视觉沿用 [V1.3](../V1.3/README.md) 与既有 S06 动作库页面，不新出线框。功能是把参考项目 OpenPersonalTraining 的 Exercise Library 数据接入当前 Express + JSON 存储，而不是迁移其 Cloudflare / Hono 技术栈。

- [版本更新](../../releases/V1.4.md)
- 数据说明：[动作库种子](../../../server/src/data/README.md)

## 实际落地

- 模型对齐 Exercise：`name`、`aliases`、`muscle_group`、`equipment`、`metric_type`、`instructions`、`media_ref`、`review_status`；`body_part` / `target` 作为筛选扩展。
- `muscle_group` 由 `body_part` 归入下肢 / 上肢 / 核心 / 全身；示范图 `media_ref` 拼 jsDelivr 固定 commit。
- 本批公开领域目录直接 `approved`，理由见种子 README；自定义动作留在 `customExercises`，不进入公开列表。
- 未改 Workout Builder、Clients、Schedule、Payments、Share PDF。
- 步骤中文走离线映射 `exercise-instructions-zh.json`（按 sourceId），非运行时调用翻译接口。
- 基础视觉：`tokens/base/coach/interaction` 统一暖白自然绿；首页学员侧重本周训练与下一次课程，教练侧重记录入口与今日任务概览，不新增无数据来源的待办。

## 未验证

真机加载 jsDelivr 图片、正式环境 download 合法域名、弱网分页。正式发布前需在微信后台配置 `cdn.jsdelivr.net`。首页真机视觉与减动效开关需在微信开发者工具再确认。
