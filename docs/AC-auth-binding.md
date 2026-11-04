# 登录与绑定 · 前端可测验收（AC01 / AC02 / AC33 / AC38）

> 对应设计文档第 1 步骨架。演示账号仍可用；配置微信后走真实 openid。

## 快速路径

1. 打开小程序 → 进入登录页  
2. 勾选隐私说明  
3. 按下列测例操作  

演示邀请码：`LINYE7D`（林野教练）

---

### 真实微信登录

1. 微信公众平台拿到小程序 **AppID / AppSecret**
2. `miniprogram/project.config.json` 的 `appid` 与之一致
3. `server/.env`：

```bash
WECHAT_APPID=wx...
WECHAT_APPSECRET=...
```

4. 重启 API；登录页 `GET /auth/wechat-status` 应 `configured: true`
5. 点「微信一键登录」→ `wx.login` → `POST /auth/wechat-session` `{ code }`  
   - 服务端 `jscode2session` 换 `openid`  
   - 无用户则注册（默认仅 `student` + 试用额度）  
   - `session_key` 不下发客户端  

未配置 AppSecret 时返回 `WECHAT_LOGIN_NOT_CONFIGURED`（503），不假装成功。

演示登录仍传 `accountKey`（如 `student_only`），与真实微信用户相互独立。

---

### AC01 前端不能自升教练

| 步骤 | 操作 | 期望 |
| --- | --- | --- |
| 1 | 点「AC01 测例 · 周子墨自称教练」 | 弹窗拒绝，提示无法获取教练角色 |
| 2 | 用「学员 · 陈佳宁」登录 | 角色切换器仅出现「我是学员」 |
| 3 | 用「教练 · 林野」登录 | 可在学员 / 教练间切换（二者均已授予） |

---

### AC02 教练无法访问未绑定学员

| 步骤 | 操作 | 期望 |
| --- | --- | --- |
| 1 | 林野登录 → 学员 Tab | 列表为空或仅含已绑定学员 |
| 2 | 输入 `u_stu_unbound_999` → 尝试访问 | 显示 FORBIDDEN / 无权访问 |
| 3 | 陈佳宁绑定 `LINYE7D` 后，林野刷新学员列表 | 仅出现陈佳宁 |

---

### AC33 解绑后照片签名 URL 拒绝

| 步骤 | 操作 | 期望 |
| --- | --- | --- |
| 1 | 陈佳宁绑定林野，并在隐私页打开「原始照片」 | 授权保存成功 |
| 2 | 陈佳宁解绑 | 提示解绑成功 |
| 3 | 林野 → 个人中心 →「AC33 测例 · 解绑后取照片」 | 返回 BINDING_INACTIVE 或 CONSENT_REVOKED |

---

### AC38 双角色 / 切学员草稿不串档

| 步骤 | 操作 | 期望 |
| --- | --- | --- |
| 1 | 林野切到教练，给学员 A 在课后记录写草稿 | 本地草稿键含 `userId:coach:studentId` |
| 2 | 切换另一绑定学员 | 输入框变为该学员草稿（或空），不带入 A 的正文 |
| 3 | 切回学员视角开练打卡 | 训练草稿与教练课后草稿相互独立 |

草稿键格式：`账户:角色:学员对象:类型:记录ID`

---

## 接口

- `GET /auth/wechat-status` → `{ configured, appid_set }`
- `POST /auth/wechat-session` → `{ code }` 真微信，或 `{ accountKey }` 演示
- `services/bindingApi.*` → 对齐 API03 / ConsentGrant  
