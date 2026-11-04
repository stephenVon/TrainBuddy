# 动作库种子

`exercise-catalog.json` 由 `scripts/import-exercise-catalog.cjs` 从 OpenPersonalTraining 的 `seed-exercises.ts` 生成，重复执行按 `sourceId` 去重覆盖。

| 项 | 说明 |
| --- | --- |
| 数据源 | [yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db)，许可证 Unlicense（公共领域） |
| 参考实现 | OpenPersonalTraining，许可证 MIT；只借鉴表结构、种子与图片 URL，未引入其运行时 |
| 示范图 | jsDelivr，commit `b0eed061e1c832b3ed815fbaa4b45b3cdc14df49` |
| 审核 | 本批导入统一 `review_status=approved`。理由：公开领域参考目录，用作学员教学列表；自定义动作不写入本文件 |

运行时不要把此目录拷进 `server/data/store.json`。自定义动作走 `customExercises`，不会出现在公开列表。
