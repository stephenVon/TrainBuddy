# V1.12 设计与实施归档

2026-11-06。参考仓库根目录原型：

- `TrainBuddy_训练执行模式2.0_摩天轮选择版.html`（本版主参考）
- `TrainBuddy_训练执行模式2.0_HTML原型.html`（执行卡／组歇样式参考）

色板沿用奶油自然绿与 [V1.4](../V1.4/README.md)。

- [版本更新](../../releases/V1.12.md)

## 设计要点

- 无会话：顶部「配置训练模板」「日记记录」；可执行计划列表；动作库为旁链。
- 有会话：先摩天轮选动作（选中卡放大），再进入锁定执行卡。
- 计划目标只读；临时实际值不回写计划；编辑计划跳转 `plan-edit`。
- 组歇与动作完成层须高于底部导航，并预留底栏安全区。

## 实际落地

- `pages/workout`：`phase` = picker / locked / exerciseDone；`wheelItems` 变换样式；REST 与动作完成层。
- `miniprogram/assets/workout-figure.svg`：执行卡示意图。

## 未改范围

`startSessionFromPlan`、组状态 API、结束／放弃、权限与计划发布未改。

## 未验证

真机滑动手感与多动作（>5）轮盘重叠；部分基础库对本地 SVG 的兼容性。
