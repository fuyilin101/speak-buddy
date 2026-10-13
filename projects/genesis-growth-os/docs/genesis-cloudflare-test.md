# Cloudflare 独立测试部署

Genesis AI 的云端测试只使用 `test` Wrangler 环境：Worker 与 D1 均为 `genesis-ai-test`。顶层本地配置和 SQLite 数据不迁移、不覆盖。个人记忆和本地备份不上传。

## 准备与部署

```powershell
npx wrangler d1 export genesis-ai-test --remote --env test --output <仓库外受保护备份文件>
npm run genesis:cloud:build
npx wrangler d1 migrations apply genesis-ai-test --remote --env test
npx wrangler deploy --dry-run --env test
npx wrangler deploy --env test
```

测试 D1 已通过配置绑定独立 ID。数据库 ID 是资源标识，不是认证凭据。迁移由 Wrangler 账本记录；再次执行无待应用迁移时不会重复执行 `ALTER TABLE`。禁止对生产数据库执行这些命令。

## 密钥与网页认证

- `GENESIS_AGENT_TOKEN`：Cloudflare Secret，仅供外部 Agent 认证读写。
- `GENESIS_VIEW_PASSWORD`：旧查看密码Secret。启用首次设置后，保留作为初始化证明、密码pepper及会话签名根密钥；初始化后的登录使用本人新密码，不能再使用该Secret值登录，也不能随意删除它。本人会话可管理使命、技能、角色和资产，但不能替代 Agent Token。
- 本机安全副本：`D:/GenesisSecrets/cloudflare-test.json`，位于仓库外并设置仅当前用户和 SYSTEM 可读。
- 不将真实值放进 Git、前端、复盘包、命令参数或日志。配置 Secret 用 Wrangler 的标准输入或受保护文件机制。
- 网页会话是 HMAC 签名、8 小时有效的 `Secure`、`HttpOnly`、`SameSite=Strict` Cookie；API 不将 Token 返回前端。
- 登录页发送查看密码至本环境的 `/api/login`；`health` 可公开，其余数据读取需认证。

## Codex 同步

在 Codex 当前可访问的项目中生成真实复盘，放入忽略的 `data/` 或系统临时目录。记录稳定项目 `source_ref`，每次复盘使用提交/工作批次对应的唯一 `source_ref`。按需求标记可信状态和 `private`，不要把计划写成已完成。

```powershell
$credentials = Get-Content -LiteralPath D:/GenesisSecrets/cloudflare-test.json -Raw | ConvertFrom-Json
$env:GENESIS_AGENT_TOKEN = $credentials.GENESIS_AGENT_TOKEN
$env:GENESIS_WORKER_URL = '<已验证的测试 Worker 地址>'
npm run genesis:sync -- --review-file <复盘文件>
```

不要输出 `$credentials` 或 Token。网页版使用本人初始化时设置的密码，不要输入Agent Token。首次初始化须使用专属链接，见 [首次密码设置](genesis-owner-setup.md)。

## 验收

1. `GET /api/genesis/health` 返回 200 且确认 D1 可查询。
2. 认证后 `dashboard`、`projects`、`growth-records` 和项目详情均返回 200。
3. 通过现有 Connector 写入项目、成长记录、可复用资产，再通过远程 SQL 查询 ID/数量。
4. 重复提交返回 `deduplicated: true`；资源 ID 和各表数量不变。
5. 错误/缺失 Agent Token 返回 401；Agent Token 不能访问本人管理接口；浏览器写入必须经过本人会话、同源与幂等检查。
6. 浏览器显示中文项目仓库、复盘时间线、学习成果与个人资产；网络请求不携带 Agent Token。

## 当前限制

仅测试部署，尚未完成正式环境和多人权限。测试登录已接入 Rate Limiting binding（每个 Cloudflare 地点、每来源键10次/60秒），它不是全局限流或业务锁。正式开放前仍需要评估 Cloudflare Access、凭据轮换与数据恢复演练。不要把本次测试通过当成生产验收。

原有前端与本地 Express 功能保留。测试云端已包含 Genesis 驾驶舱、每日使命与历史、技能树与关联、项目、复盘、资产、人工编辑和 Agent 同步；旧 Forge 周计划、XP、奖励写入接口没有迁移。

`test` 环境开启 `GENESIS_ENABLE_CLOUD_MANAGEMENT=1` 和 `GENESIS_ENABLE_OWNER_SETUP=1`，并保留独立 D1 ID、静态资源 binding、登录限流 binding 及两项 Secret。顶层迁移0001–0008全部应用后健康检查才会确认管理与认证结构可用。重复运行使用 Wrangler 迁移账本，不直接重放 ALTER TABLE 文件。

2026-10-13 的部署和远程验收结果见 [Phase 4.6 报告](genesis-phase4.6.md)。Android／iOS 真机安装、独立窗口和登录保持仍需单独验收。

## 参考

[静态资源与 Worker 优先路由](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)、[D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)、[Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。
