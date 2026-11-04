# 日记 / 成长 / 动作库 Mock 契约（S06 / S07 / S08）

对应设计文档第 8 节。本地演示，数据写入 `globalData.diary` / `training` / `exerciseMeta`，经 `store` 持久化（`lianzida_state_v5`）。

## S06 动作库 `exerciseApi`

| 方法 | 说明 |
| --- | --- |
| `listExercises(app, { q / search, muscleGroup, body_part, target, equipment, page, limit })` | 仅返回已审核公开动作；分页默认 30 |
| `listFacets` | `GET /exercises/facets`，部位 / 目标肌群 / 器械 |
| `getExercise(app, id)` | 详情：步骤、示范图 CDN、要点；未审核与自定义动作 404 |
| `addExerciseToPersonalPlan`（在 `trainingApi`） | 写入个人计划**草稿**，不改已发布快照 |

公开目录种子见 `server/src/data/exercise-catalog.json`（free-exercise-db / Unlicense；示范图 jsDelivr 固定 commit）。自定义动作不进入本列表。历史训练组使用 `nameSnapshot`，改名不覆盖已完成记录。

页面：`pages/exercises`、`pages/exercise-detail`。

## S07 每日日记 `diaryApi`

实体拆分：`dailyLogs` / `meals` / `waters` / `bodyStates` / `dayShares` / `feedbacks`。

| 方法 | 说明 |
| --- | --- |
| `getDailyView` | 学员当日聚合视图 |
| `setRestDay` | 休息打卡；未来日拒绝；超 30 天补录窗口拒绝 |
| `addMeal` / `deleteMeal` | 饮食；软删 |
| `addWater` | 分次累加毫升，避免与总量双计 |
| `upsertBodyState` | 睡眠/疲劳/酸痛；特殊情况同表但**单独授权** |
| `shareDayCategory` / `revokeDayCategory` | 按「学员+日+类别」逐次共享，不回溯历史 |
| `getSharedDailyForCoach` | 教练只读；需绑定有效 + 类别 scope + 当日 dayShare |
| `addFeedback` / `listFeedback` | 教练点评 |
| `getCalendarMarkers` | 同日可多项：训练/休息/饮食/状态/计划未完成 |

共享类别：`workout_self` | `meal` | `body_state` | `special`。

页面：`pages/diary`；教练侧 `pages/student-profile`。

## S08 成长 `growthApi`

口径对齐设计文档 **8.4**：

| 字段 | 规则 | 无数据 |
| --- | --- | --- |
| `sessionCount` | 区间内 completed 且 done_sets>0 | `—` / 暂无 |
| `trainingDays` | 有完成训练的业务日数 | — |
| `diaryStreak` | 从今天往前连续有日记/饮食/状态/训练的天数 | — |
| `planCompletionRate` | 已到期计划日必做组全部完成占比；分母为 0 | **暂无** |
| `volumeKg` | 仅重量动作 Σ weight×reps | 暂无 |
| 力量进步% | 需同动作同口径 | 固定 **暂无**（不做无依据结论） |

日历：多色点标记，点击看当日摘要并可进日记。

页面：`pages/growth`。

## 验收要点

- AC22/AC23：教练看不到未共享类别；UI 文案「记录不可见」，不把缺失当零运动。
- 疲劳未填 ≠ 良好。
- 特殊情况默认私密，需显式共享。
