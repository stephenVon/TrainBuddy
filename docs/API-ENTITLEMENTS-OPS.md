# 权益账本 · 通知 Outbox · 运营后台 · 支付开关

对齐设计文档第 12 节与 **AC31、AC34、AC35**。

## 权益账本（API30）

| 动作 | 时机 | 说明 |
|------|------|------|
| `reserve` 预占 | 真实 AI 任务创建 | 同一幂等键只预占一次；额度不足 → `ENTITLEMENT_EXHAUSTED` |
| `charge` 核销 | 成功交付（按节点） | 同一 `charge_key`／回调最多一次（AC31） |
| `release` 释放 | 失败／取消／未交付节点 | 不扣余额，只退回 reserved |
| `grant` 发放 | 运营试用／补偿 | **不是**付款成功 |

接口：

- `GET /entitlements` — 余额、预占、可用、订阅状态；附带 `payment_enabled`
- `GET /usage-ledger` — 本人用量流水

目标图按**成功节点**核销；部分成功只扣成功部分，其余释放。

### AC34 订阅到期

- `subscription.status = expired` 后：历史报告／导出／权益查询仍可读
- 新的真实付费 AI 任务 → `402 SUBSCRIPTION_EXPIRED`
- 演示模式（`mode=demo`）不计费，仍可用

## 通知 Outbox（AC35）

业务写成功后：

1. 写入站内 `notifications`（本人可查）
2. 写入 `outbox` 渠道投递项
3. 投递失败 → `outbox.status=failed`，**不回滚**预约／记录
4. 运营 `POST /admin/outbox/{id}/retry` 可重试

预约创建支持测试字段 `fail_notify: true` 强制首投失败。

## 支付开关

```bash
# 默认关闭
PAYMENT_ENABLED=   # 或未设置

# 仅打开门闩；仍不接入真实渠道，confirm 拒绝伪造成功
PAYMENT_ENABLED=true
```

- `GET /payments/status`
- `POST /payments/checkout` → 关闭时 `FEATURE_DISABLED`；打开时仍返回 `not_integrated`，不发权益
- `POST /payments/confirm` → 拒绝

首轮额度由种子试用 + 运营后台发放，**不模拟付款成功**。

## 最小运营后台

静态页：`http://127.0.0.1:8787/ops/`（`/ops` 同样打开）  
账号：`accountKey=ops_admin`（角色 `ops`）。学员和教练不能领取该角色。小程序登录后只提示在浏览器打开此地址，不进入学员或教练导航。

教练申请写入 `coachProfile.approvalStatus=pending`，通过审核后才授予 `coach`。

| 能力 | 路径 |
|------|------|
| 账号列表 | `GET /admin/accounts` |
| 账号停用／启用 | `POST /admin/accounts/disable` · `/enable`（不能作用于当前运营本人） |
| 教练申请列表 | `GET /admin/coach-applications?status=pending` |
| 教练审核 | `POST /admin/coach-reviews` |
| 关系强制结束 | `POST /admin/bindings/force-end` |
| 动作审核 | `POST /admin/exercises/review` |
| 指定用户权益 | `GET /admin/entitlements?user_id=` |
| 额度补偿／试用 | `POST /admin/entitlements/grant` · `/trial` |
| 订阅到期 | `POST /admin/subscriptions/expire` |
| AI 任务元数据／重试 | `GET /admin/ai-tasks` · `GET/POST /admin/ai-tasks/...`（列表不含结果正文） |
| 站内通知 | `GET /admin/notifications?user_id=` |
| 失败通知队列 | `GET /admin/outbox` · `POST .../retry` |
| 参数与审计 | `GET/PATCH /admin/config` · `GET /admin/audits` |

敏感操作须带 `ticket_id`（工单号），写入审计。

## 测例

```bash
cd server && AI_PROVIDER=mock npm test -- test/ac-entitlements.test.js test/ops-admin.test.js
```
