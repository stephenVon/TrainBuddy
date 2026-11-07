# 积分 · 成就 · 兑换

积分是可兑换余额，和 AI 权益账本分开。客户端不能提交分数。

## 学员

- `GET /points` 当前可用、预占、累计获得、累计兑换
- `GET /points/ledger?type=earn|redeem|refund|adjust`
- `GET /achievements` 仅当前用户。负面成就只在这里出现
- `GET /rewards` 只返回上架商品
- `POST /redemptions` 必须带 `Idempotency-Key`
- `GET /redemptions` 与 `GET /redemptions/:id` 只返回本人订单

计划训练完成 +10，教练把课程记为 `completed` +20。重复完成返回已领取。缺席不发分。

## 运营

均需 `ops` 角色。写操作带 `ticket_id` 并记审计。

- `GET/PATCH /admin/points/rules`
- `POST /admin/points/adjustments`
- `GET/PATCH /admin/achievements/:key`
- `GET/POST/PATCH /admin/rewards`
- `GET /admin/redemptions`
- `POST /admin/redemptions/:id/retry`

首版上架商品是训练计划草稿。饮食识别次数和 30 天会员默认下架，履约不走支付。
