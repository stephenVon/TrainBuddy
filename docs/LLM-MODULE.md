# 统一大模型管理模块

服务端模块：[`server/src/services/llm/`](../server/src/services/llm/)。负责安全管理 API 密钥、按业务预置提示词与 JSON Schema，并通过 OpenAI 兼容协议调用大模型。

## 覆盖能力

| 任务 key | 业务 | 输入 | 输出 |
|----------|------|------|------|
| `nutrition` | 拍照记饮食 | 图片 URL／Base64 + 质量提示 | 营养 JSON（克） |
| `posture_scan` | 体态观察 | 正面／侧面 Base64 | 观察项 JSON（无总分） |
| `voice_structure` | 课后口述结构化 | 转写／文字 | `coach_session_summary.v1`（总结＋exercises；并派生 segments 供合并） |
| `goal_image_spec` | 健身目标图规格（无 MiniMax 时回退） | 节点月份／目标文案 | **生成规格 JSON** |

语音 **ASR 听写** 走 `VOICE_ASR_PROVIDER`（`mock` / `wechat` / `qwen`；Qwen 见 `services/voice/adapters/qwen.js`）。目标预览**像素图**优先走 MiniMax `image-01` 图生图（`subject_reference` + 三大配置提示词），见 `services/ai/minimaxImage.js` / `goalPrompt.js`。

## 安全

- 密钥只放环境变量 `LLM_API_KEY`（可选本地 [`server/.env`](../server/.env.example)，已 gitignore）。
- 不写 MemoryStore、不进小程序、不进接口响应；ops 配置只返回 `llm.configured` 与模型名。
- 客户端日志脱敏：不打印 key、不打印完整图片 base64。

## 环境变量

见 [`server/.env.example`](../server/.env.example)。支持多供应商：

| 供应商 | 用途 | 关键变量 |
|--------|------|----------|
| DeepSeek | `voice_structure`、`goal_image_spec` | `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` |
| 豆包 Ark | `nutrition`／`posture_scan`（视觉） | `DOUBAO_API_KEY` + **`DOUBAO_MODEL`（视觉理解接入点 ep-…，勿用 Seedream）** |
| MiniMax | **目标预览图生图**；饮食回退 | `MINIMAX_API_KEY` / `MINIMAX_IMAGE_MODEL=image-01` |

可用 `LLM_TASK_PROVIDER_<TASK>=deepseek|doubao|minimax` 覆盖路由。

未配置对应密钥时：`runTask(..., { mode: 'real' })` 抛 `PROVIDER_NOT_CONFIGURED`；饮食／目标图可回退 `AI_PROVIDER=mock`；语音结构化 **回退规则引擎**（AC11 不变）。

## 目录

```
server/src/services/llm/
  config.js              # 读环境变量、publicStatus
  client.js              # chatJson + 校验失败重试
  validate.js            # 轻量 JSON Schema
  index.js               # runTask / listTasks
  tasks/nutrition.js
  tasks/voice_structure.js
  tasks/goal_image_spec.js
```

每个 `tasks/*.js` 含：`systemPrompt`、`schema`、`buildMessages`、`demoFixture`。

## 调用

```js
const llm = require('./services/llm')

// demo：不外网
await llm.runTask('nutrition', { qualityHints: {} }, { mode: 'demo' })

// real：需 LLM_API_KEY
await llm.runTask('voice_structure', { text: '深蹲 3×8 60kg', taskId: 't1' }, { mode: 'real' })
```

业务接入点：

- 饮食：[`providers.runNutritionScan`](../server/src/services/ai/providers.js)
- 语音：[`structureTextWithLlm`](../server/src/services/voice/structure.js)
- 目标图：[`providers.runGoalNode`](../server/src/services/ai/providers.js) → `result_payload.goal_image_spec`

## 新增第四个任务

1. 在 `tasks/` 新增文件（prompt + schema + buildMessages + demoFixture）。
2. 注册到 `index.js` 的 `REGISTRY`。
3. 把 key 加入 `LLM_ENABLED_TASKS` 默认列表（或仅环境变量灰度）。
4. 在业务适配器中调用 `runTask`，保持 `mode=demo` 不外网。

## 测例

```bash
cd server && node --test test/llm-module.test.js
```
