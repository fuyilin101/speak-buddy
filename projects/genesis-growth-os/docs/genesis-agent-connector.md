# Genesis Agent 连接器

Genesis 不在 Worker 内调用 LLM。Codex 或其他 Agent 先从当前可访问的代码、Git 提交和对话上下文整理事实，再通过 `agent/genesis-connector.mjs` 写入 Genesis。

## 本地调用

先启动 Worker 或本地 Express 服务，并只在当前进程设置 Token：

```powershell
$env:GENESIS_WORKER_URL = "http://127.0.0.1:8787"
$env:GENESIS_AGENT_TOKEN = "本地临时密钥"
```

四个操作分别对应：

```powershell
node agent/genesis-connector.mjs genesis_get_projects
node agent/genesis-connector.mjs genesis_save_project --file .\project-review.json
node agent/genesis-connector.mjs genesis_add_growth --data '{"source_ref":"repo:commit:review","title":"项目复盘","content":"已验证的总结","details":{"completed_work":["..."],"problems":["..."],"solutions":["..."],"learned":["..."],"reusable_assets":["..."],"next_steps":["..."]},"evidence":["server.js:100-120"]}'
node agent/genesis-connector.mjs genesis_save_asset --file .\asset.json
```

`GENESIS_AGENT_TOKEN` 只从环境变量或 Cloudflare Secret 读取，不能写进前端、仓库或命令行参数。Connector 对相同操作和内容生成确定性的 `Idempotency-Key`，Worker 还会按 `source_ref` 去重。

## 项目复盘字段

项目应提供 `source_ref`、`name`、`description`、`status`、`progress`，以及可验证时的 `repo_path`、`git_commit`、`evidence`、`next_steps`。成长记录的 `details` 使用 `completed_work`、`problems`、`solutions`、`learned`、`reusable_assets`、`next_steps`。不能从当前上下文或文件确认的内容要写入“待确认”，不要猜测完成情况。

## Cloudflare 测试环境

先创建独立的测试 D1 并把返回的 ID 写入 `wrangler.jsonc` 的 `env.test.d1_databases`；不要修改生产绑定：

```powershell
npx wrangler d1 create genesis-ai-test
npx wrangler d1 migrations apply genesis-ai-test --env test --remote
npx wrangler secret put GENESIS_AGENT_TOKEN --env test
npx wrangler secret put GENESIS_ALLOWED_ORIGINS --env test
npx wrangler deploy --env test
```

Phase 3 已授权独立测试部署。具体 Secret 配置、网页登录、构建和验收方式见 [测试部署指南](genesis-cloudflare-test.md)。部署后将 `GENESIS_WORKER_URL` 指向已验证的测试 Worker 地址，再用相同 Connector 命令验证写入和重复上传。

