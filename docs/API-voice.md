# 语音录入与合并（设计文档 7.3 · AC11–14）

## 流程

```
点击开始／结束录音 / 文字录入（以当前 voice-input 为准）
  → POST /sessions/{id}/voice-tasks（记录 base_revision）
  → 转写适配器 → 结构化候选
  → 展示差异 / 缺失字段
  → 教练确认 POST .../merge（append | supplement | replace_sets）
  → 可选撤销 undo-merge
```

识别等待期间可继续改表；拉取任务时重算冲突，**不自动覆盖人工值**。

## 转写适配器

环境变量 `VOICE_ASR_PROVIDER`：

| 值 | 说明 |
| --- | --- |
| `mock`（默认） | 本地可测；可用 `demo_phrase` 指定文案 |
| `wechat` | 需配置 `WECHAT_ASR_ENDPOINT`（及可选 `WECHAT_ASR_TOKEN`） |
| `qwen` | 阿里云百炼 Qwen ASR；需 `QWEN_ASR_API_KEY` 或 `DASHSCOPE_API_KEY` |

Qwen 常用配置：

| 变量 | 说明 |
| --- | --- |
| `QWEN_ASR_MODEL` | 默认 `qwen-audio-3.1-asr-flash-streaming`（产品名 Qwen-Audio-ASR-Flash-Streaming） |
| `QWEN_ASR_MODE` | `streaming`（WebSocket）或 `http`（`qwen3-asr-flash` 同步） |
| `QWEN_ASR_WS_URL` | 默认 `wss://dashscope.aliyuncs.com/api-ws/v1/inference`；新版 MaaS 可用 `wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference` |
| `QWEN_ASR_FORMAT` / `QWEN_ASR_SAMPLE_RATE` | 小程序录音多为 `mp3` / `16000` |

`GET /api/v1/voice/providers` 查看当前可用适配器。

## 合并规则（7.3）

1. 新动作候选默认 **append**；同名不自动覆盖  
2. 可选 **supplement**（补组）/ **replace_sets**（替换组）  
3. 冲突字段默认 **keep_human**，AI 值为可采纳候选  
4. 同一 `segment_id` 不重复合并（AC13）  
5. 可撤销最近一次合并  
6. 语音中的姓名仅提示，归属以页面选定学员为准  

## 验收

```bash
cd server && npm test
# 含 test/ac-voice.test.js → AC11–14
```

| 用例 | 期望 |
| --- | --- |
| AC11 | 「50公斤 5次」缺组数与动作，不补默认组数 |
| AC12 | 等待中人工改重量 → 冲突提示，人工值保留 |
| AC13 | 同 segment 合并两次只加一次 |
| AC14 | 转写失败/无麦克风 → 草稿仍在，文字可用 |

## 小程序

课后记录页 `pages/record`：按住录音、文字解析、候选补齐、合并方式、撤销。
