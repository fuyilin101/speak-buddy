# Genesis AI Phase 3 云端测试验收报告

验收日期：2026-10-11。仅独立 Cloudflare 测试环境，未部署生产、未同步本地个人记忆、未修改本地数据库、未接入 LLM API。

## 部署状态

- Worker：https://genesis-ai-test.anime-english-mvp.workers.dev
- Wrangler 环境：`test`；Worker 名称：`genesis-ai-test`。
- 独立 D1：`genesis-ai-test`，ID：`b23402ab-31f9-40d7-a757-d81b4bffb9b8`。
- 部署代码：`44101e2`（主实现 `543099c`，验收中修复根路径首页映射）。
- Worker 版本：`12b9880a-9260-4d4f-b817-3f1023bbf3c7`。
- 本地 Express、SQLite 和原有前端保留；云端复用 Genesis 组件展示仓库，未迁移的游戏化写入接口不开放。

## 迁移与数据库

远程迁移 `0001_genesis.sql`、`0002_genesis_connector.sql`、`0003_genesis_private_memory.sql` 全部完成。再次执行提示无待迁移。逐表 PRAGMA 与迁移生成的内存 SQLite 对照，字段名、类型、非空约束和主键一致。

| 表 | 字段数 | 远程记录数 |
|---|---:|---:|
| genesis_projects | 17 | 1 |
| genesis_growth_records | 16 | 1 |
| genesis_assets | 13 | 1 |
| genesis_profile_items | 9 | 0 |
| genesis_goals | 12 | 0 |
| genesis_decisions | 11 | 0 |
| genesis_ingest_keys | 7 | 3 |

个人档案、目标、决策保持空表；本地初始个人记忆没有上传。两份原有本地数据库的 SHA256 与本阶段开始时相同。

## 真实同步证据

Codex 根据 `543099c` 的代码、实际迁移/部署和测试结果生成结构化复盘，通过现有 `npm run genesis:sync -- --review-file data/phase3-review.json` 调用 Connector，认证写入远程 D1。不是固定 Mock 数据。

- 项目 ID：`project-05c1dab7-8908-4dea-9233-6259277ee53d`。
- 成长记录 ID：`record-c010da0c-c239-4e6b-b19e-a3539e5d88c0`。
- 资产 ID：`asset-d8c6c971-bc19-461c-9a1b-118b4e7b08f1`。
- 复盘标题：**Phase 3：Cloudflare 独立测试部署复盘**。
- 资产标题：**独立云端测试部署验收清单**。
- 三条记录关联同一项目，均为 `private`；来源包含稳定项目标识、本次提交及文件证据。
- 首次验收已经写入数据，随后首页检查发现 404。修复静态根路径映射后重新部署，再重复同一同步包：所有操作 `deduplicated: true`，ID 与七张表数量均不变。
- 该复盘是上传时的历史快照，正文“下一步验证上传与网页”保留当时状态；本报告补充完成后的验收事实，不覆盖历史记录。

## 测试结果

| 验证 | 实际结果 |
|---|---|
| health（查询真实 D1） | 200，environment=test |
| Dashboard、项目列表、成长列表、项目详情（认证） | 全部 200 |
| 真实同步与 SQL 复核 | 项目、成长记录、资产各 1 条 |
| 重复同步 | deduplicated=true，数量及 ID 不变 |
| 错误 Token / 缺少 Token | 均为 401，中文认证错误 |
| 查看会话读取 / Agent 写入 | 200 / 401 |
| 非允许来源跨域 / 缺少必填字段 | 403 / 400，中文错误 |
| 网络失败 | 非零退出码、明确中文错误，不返回上传成功 |
| 浏览器实际展示 | 登录后显示中文 Dashboard、发展时间线、完整复盘及个人资产卡片 |
| 原有 npm test | 20 组通过，包含 12000 次随机周回归 |
| check:syntax / test:genesis-worker | 通过 |
| 云端入口构建 / Wrangler dry-run / 实际 test 部署 | 通过 |

复盘包、SQL 核验 JSON、截图及临时验收脚本仅保存在被忽略的 `data/`，不提交 Git。截图：`data/phase3-remote-dashboard.png`。

## 安全与中文化

- `GENESIS_AGENT_TOKEN` 和独立 `GENESIS_VIEW_PASSWORD` 通过 Cloudflare Secret 管理；Secret 列表确认存在，未输出真实值。
- 本机凭据安全副本位于仓库外 `D:/GenesisSecrets/cloudflare-test.json`，仅当前用户与 SYSTEM 有读取权限。
- 查看会话为 HMAC 签名、8 小时有效的 Secure / HttpOnly / SameSite=Strict Cookie，不授予 Agent 写权限。
- Git 跟踪文件及本阶段代码提交扫描未发现实际密钥；数据库、备份、个人记忆和真实环境文件均未提交。
- 云端生成资源扫描未发现 Agent Token、查看密码或 `GENESIS_AGENT_TOKEN` 字段。
- 当前 Genesis 界面、API 错误、README、连接器与测试部署文档中文化；原上游英文 README 仅在 `docs/upstream/` 保留归档。

## 下一阶段建议

等待用户规划 Phase 4。优先限定 GitHub MCP 的只读仓库范围，将 commit、文件路径和证据可信状态串入现有复盘包。正式开放前另行验收登录防滥用、凭据轮换、数据恢复与生产隔离；本次结果不代表生产环境验收。
