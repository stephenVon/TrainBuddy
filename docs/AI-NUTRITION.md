# AI 拍照记饮食 · 接入约定与验收

2026-10-22，来源于用户需求：从 AI 页直接拍照或选择照片，分析碳水、蛋白质、脂肪并记录，在允许的情况下自动同步绑定教练。

## 已实现流程

1. 选择食物照片 → 上传意图 + 完成（本人私有媒体，`purpose: nutrition_input`）。未完成上传不能开始识别。
2. 创建 `nutrition_scan` AI 任务（`mode: demo | real`）。排队／识别中／`needs_confirmation`／`need_retake`／`failed`／`confirmed`。
3. 供应商未配置（无 `LLM_API_KEY` 且 `AI_PROVIDER=unavailable`）时 real 模式明确失败，不返回成功或伪造营养数值。配置 `LLM_API_KEY` 后走统一大模型模块（见 [LLM-MODULE.md](./LLM-MODULE.md)）。演示模式返回带 DEMO／估算标记的候选。
4. 用户确认或修正食物、份量、餐次与日期后，`POST /nutrition-tasks/:id/confirm` 幂等写入本人饮食。识别失败或只选照片不写日记。未知宏量营养素保留 `null`，不当作 `0`。
5. 自动同步须同时满足：有效教练绑定、饮食授权、用户主动开启。默认关闭。保存时服务端再校验；只逐条共享该条记录，不静默整天共享；原图默认不共享。

## API 摘要

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/ai-tasks` | `type=nutrition_scan`，`input.media_id` |
| POST | `/nutrition-tasks/:id/confirm` | 确认入库（幂等） |
| GET/PUT | `/nutrition-sync-settings` | 自动同步偏好 |
| POST | `/meals/:id/share` | 逐条共享给主教练 |
| POST | `/meals/:id/unshare` | 撤回该条共享 |

## 营养结果结构

```json
{
  "task_id": "...",
  "media_id": "...",
  "status": "needs_confirmation",
  "items": [{
    "food_name": "...",
    "portion": { "amount": null, "unit": "g", "is_estimated": true },
    "macros_g": { "carbs": null, "protein": null, "fat": null },
    "basis": "identified_portion",
    "uncertainties": []
  }],
  "total_macros_g": { "carbs": null, "protein": null, "fat": null },
  "is_estimate": true,
  "model_version": "..."
}
```

三大营养素单位为克。保存时身份以会话为准，客户端不能指定他人 `studentId`。

## 自动同步授权边界

- 有效教练绑定 + 饮食授权 + 主动开启「自动同步」，三者同时成立。不复用「曾经共享过一天」作为持续授权。
- 开启时锁定当时的主教练；换教练、解绑或撤回授权后立即停止，不自动转给新教练。
- 饮食保存成功但同步失败时返回「已记录，尚未同步」，不诱导重复保存。
- 只同步获准的这条营养记录；原图默认不共享。朋友模块不接收饮食数据。
- 停止自动同步只影响后续；已共享内容用 `/meals/:id/unshare` 明确撤回。

## 小程序

`/pages/food-photo/index`：拍照／相册 → 识别 → 可编辑确认 → 保存；自动同步开关读取服务端设置。

## 验收要点

拍照／相册取消、无食物／模糊、份量不明、未知营养值、人工修正、重复确认、供应商不可用、授权关闭、解绑或换教练、保存成功但同步失败、原图与朋友隔离、逐条共享不连带当天其他手动记录。

测例：`server/test/ac-nutrition.test.js`。
