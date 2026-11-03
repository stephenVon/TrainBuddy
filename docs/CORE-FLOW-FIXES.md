# 本地连接与预约流程修复

基于 main `6704865`，修复日期 2026年11月3日，分支 `fix/core-flow-blockers`。

## 本地启动

在仓库根目录执行 `node scripts/start-local.cjs`。脚本优先选择 WLAN IPv4，更新被 Git 忽略的 `miniprogram/config.generated.js` 中 develop 地址，并启动本地 API。自定义网络时设置 `TB_DEV_HOST`，端口可通过 `PORT` 设置。现有 trial/release 配置保留，不读取桌面的密钥文件。

小程序 config.js 根据微信 envVersion 读取 generated 配置；没有本地配置时开发环境默认回环地址，体验/正式环境必须配置 HTTPS 地址，否则请求返回明确的 API_NOT_CONFIGURED，不回退开发地址。启动后在微信工具重新编译；手机与电脑需连接同一局域网。该命令运行期间后端才保持可用，不代表已配置开机启动或生产部署。

## 业务修复

- 批量预约按每个时段独立提交，遇到时段冲突继续处理后续选项；失败列表用于重试，成功项不再重提，各项继续复用原幂等键。
- 排班例外写入前要求有效教练角色及本人 coachProfile 与路径 coachId 一致；非法时间范围和类型返回项目现有的 422 验证错误，越权返回 403，不写入数据。
- 原预约测试更新为当前 submitBookings 入口；日记测试改为验证当前手风琴展开与收起，不再断言已删除的旧锚点。

## 验证记录

- 全量 Node 回归 141/141 通过，包含中间时段冲突、剩余失败项重试、成功项不重复提交、学员/其他教练/无档案越权及非法参数不写入测试。
- 隔离本机 HTTP 业务链 27/27 通过，原有排班越权复现现返回 403。
- 微信官方 33 WXML / 38 WXSS 编译通过。
- 本机及 WLAN 地址的 /health 均返回 200；当前小程序配置实际解析为本机 WLAN 地址。
- 启动前后 server/data/store.json SHA256 一致；没有清除、重置或迁移原始业务数据。

原始本机日志位于仓库外 output/trainbuddy-flow-20261103。未执行手机真机重新扫码验证；未配置 AI 密钥或修改生产环境。先前测试报告保留为修复前证据，修复后结果以 tests-after-fixes.txt、workflow-after-fixes.txt 为准。
