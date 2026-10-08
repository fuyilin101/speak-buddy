# Cloudflare 测试环境准备

这份文件只描述测试环境，不会创建资源或修改生产配置。

## 目标资源

- Worker：`anime-english-mvp-test`
- D1：`english-ai-test`
- URL：部署后使用 Cloudflare 分配的 `https://anime-english-mvp-test.<workers.dev 子域>.workers.dev`
- 模型：`qwen-plus`
- 数据库：独立于生产 `english-ai` 的新 D1

先复制 `wrangler.test.jsonc.example` 为 `wrangler.test.jsonc`，把新建 D1 返回的 ID 填入 `database_id`。不要把 API Key 写进这个文件。

## 用户确认后执行的步骤

```bash
npx wrangler d1 create english-ai-test
npx wrangler d1 migrations apply english-ai-test --remote --config wrangler.test.jsonc --env test
npx wrangler versions secret put AI_GATEWAY_TOKEN --name anime-english-mvp-test --config wrangler.test.jsonc --env test
npm run build
npx wrangler deploy --config wrangler.test.jsonc --env test
```

`versions secret put` 需要安全地从交互输入或受保护的输入源提供百炼 Key；不要把 Key 放在命令参数、仓库或前端代码中。

## 小范围访问保护

测试 Worker 目前没有应用层登录和限流。正式邀请体验者前，应在 Cloudflare Zero Trust 中为 `anime-english-mvp-test` 配置 Access 自托管应用，只允许指定邮箱；再配置 Worker/API 限流或 AI Gateway 的用量控制。否则任何拿到 URL 的人都可能消耗 Qwen 额度。

## 验证清单

- 手机打开测试 URL，完成儿童、青少年、成人画像设置。
- 验证 A1/B1/C1、学习目标、修改画像、Streaming、记忆和纠错。
- 检查流式失败时 JSON 回退只展示一次、只保存一次。
- 在 Workers Logs 中记录 Worker 总耗时、Qwen 耗时、首字时间和失败率。
- 测试环境 D1 只检查测试数据，不导入生产数据。
