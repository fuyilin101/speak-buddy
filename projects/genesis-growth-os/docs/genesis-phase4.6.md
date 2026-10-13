# Phase 4.6：完整云端迁移

本阶段保留 Express 与 SQLite 开发测试版，Cloudflare 测试 Worker 和 D1 提供同一套 Genesis 功能，供电脑与手机 PWA 使用。没有 LLM 调用，没有个人数据导入，没有生产部署。

## Phase A：接口差异

基线为 `6d266f2`。`server.js` 及三个 Genesis 模块共有 28 个方法／路径组合；Worker 覆盖其中 9 个，另有健康检查。需要补齐 Quest 六个、Skill 六个、Editor 四个和浏览器创建两个接口。旧 `/action-status` 依赖 Forge 周记录，保留本地兼容，不在云端开启。

现有 Worker 还需补齐：人工项目修改保护、项目别名解析、合并过滤、首页使命摘要，以及业务／审计／幂等原子写入。Goal 和 Decision 保留当前资料和关联能力，不额外开发新页面。

## 实施边界

- 本地数据库及 Forge 存档保持原样；不用本地 SQLite 作为云端数据来源。
- D1 的增量迁移只增加 Quest、Run、Skill、Link、编辑支持和内部写入协调结构。
- Run 首次执行快照不被撤销、再次完成或规则编辑替换。
- 网页会话操作个人管理接口；Agent 使用已有 Secret 和 Connector 接口，不自动取得角色／使命编辑权限。
- 首页、刷新、导航和其他读取不会创建业务记录。PWA 不缓存 API 或个人数据。
- 远程验收只使用明确标识的非个人测试数据及公开工程证据。

## 计划阶段

A 核查契约；B Worker API 与本地 D1 运行时验证；C 正式增量迁移；D 前端按服务端能力接入；E 独立测试环境部署及远程验证。Android／iOS 实机安装须独立验收，桌面响应式检查不能替代实机结果。

以下记录各阶段结果。本文件不包含密钥、个人资料或备份内容。

## Phase B：Worker 实现与本地 D1 验证

新增纯规则、D1 Store、Quest、Skill、Editor 和 Agent 模块。业务写入与审计、幂等结果组成一个 D1 batch。内部 `genesis_cloud_write_state` 只有一条版本记录，CHECK 约束把版本比较失败变成 SQL 失败并回滚整个批次；它不是成长数值，不在页面显示，也不由读取更新。冲突重新读取后仍校验用户提交的实体版本。无需进程内锁或新的 Agent 框架。

使用已安装 Wrangler 所匹配的 Miniflare／workerd 运行真实本地 D1。测试支持结构暂放在 `test/fixtures`；不是远程迁移，不包含用户资料。

验证通过：8 个并发重复创建只保存一条；数据库约束失败完整回滚；旧版本返回409；完整 API 中的使命开始、完成、撤销、再次完成和规则编辑保留首次快照；暂停、删除不删历史；并发技能互相设父节点不能形成循环；四类关联、解除关联、编辑审计和合并别名正确；人工项目内容不被 Agent 覆盖；100 次首页读取全库保持不变。

Phase B 的语法检查与全部 32 个回归脚本通过，提交 `ba22341`。

## Phase C：正式增量结构

顶层迁移新增 `0004_genesis_quests.sql`、`0005_genesis_quest_history.sql`、`0006_genesis_skills.sql` 和 `0007_genesis_editing_support.sql`，本地 `migrations/local/` 完全保留。基础七张表不重建；新增四张使命／技能表、两张编辑支持表和一张内部协调表，共 14 张 Genesis 表。

实际用 Wrangler 在临时目录的本地 D1 中先应用0001–0003并放入非个人旧记录，再增量升级到0007。全部七项进入迁移账本，旧记录内容保持一致；再次应用无重复迁移，无使命执行或技能数据生成。完整 Worker 测试改用正式迁移后再次通过。未运行远程迁移。

Phase C 提交 `fbc69ad`。该阶段当时仅验证本地 D1，远程执行结果见 Phase E。

## Phase D：前端按真实云端能力接入

使命、技能和人工编辑不再要求 `environment=local`，而是读取服务端 available／writable 状态；服务端仍独立检查本人会话和同源。保留既有 HTML、组件、时间轴和完成反馈，不新增导航。角色、行动与设置中的来源文案区分 SQLite 和 D1；不会把云端保存说成本地已双向同步。

测试 Wrangler 环境显式启用 `GENESIS_ENABLE_CLOUD_MANAGEMENT=1`，保留独立测试 DB 与 Worker 名。两项原有 Secret 声明为必需，没有替换密钥值。登录使用独立 Cloudflare Rate Limiting binding，每个 Cloudflare 地点、每来源键10次/60秒；它是防滥用辅助，不用于业务并发锁。

PWA 公共缓存升为 v2，首页脚本版本升为10。没有缓存个人数据、清除 Cookie 或添加离线写入队列。语法、全部33个测试脚本、静态构建与本地 Worker dry-run 通过。

Phase D 提交 `64b7724`。

## Phase E：实际测试部署与远程验证

2026-10-13 已部署至 [Genesis 测试云端](https://genesis-ai-test.anime-english-mvp.workers.dev/)。Worker 和 D1 均为 `genesis-ai-test`，使用原独立测试数据库 ID；部署代码为 `64b7724`，Worker 版本为 `d6e0aa08-0a1b-4240-bccb-a02080334570`。仅测试环境，没有生产部署，也没有 Git push。

远程迁移前先完整导出测试 D1，备份留在仓库外受保护目录。应用0004–0007后，账本含0001–0007；再次检查没有待执行迁移。没有导出本地个人资料到云端。两项已有 Secret 保留，没有替换；网页不会取得 Agent Token。

### 已验证结果

| 检查 | 实际结果 |
| --- | --- |
| health、home、dashboard、项目、成长记录、使命、执行历史、技能、编辑读取 | 200；管理能力标识启用 |
| Manifest、Service Worker、离线页、192/512及Apple图标 | HTTPS路径200；Manifest standalone；SW响应no-store |
| 认证与同源 | 错误及缺失Agent Token401；Agent不能访问本人管理接口；跨站写入403 |
| 使命 | 并发重复只创建一条；完成、撤销、再完成、暂停、软删除与历史保留通过 |
| 历史 | 首次执行快照不因定义修改、再完成、项目合并而改变 |
| 技能 | 父节点循环拒绝；使命、项目、资产关联及解除通过 |
| 人工编辑 | 资产编辑和项目合并、别名解析通过；来源与历史保留 |
| 角色 | 远程旧版本返回409且全量回滚，没有写入角色资料；成功写入路径在真实本地D1验证 |
| 只读 | 100次远程首页GET后成长记录、Run数量和内部写入版本不变 |
| 原有记录 | 临时验收记录清理后，迁移前七张表的全部原记录与备份一致 |
| 本地用户数据库 | 完整表结构和记录与开发前基线一致 |

四类技能关联及角色成功编辑已在真实本地 D1 回归中验证。远程目标表保持为空，未为验证目标关联而上传个人目标。远程临时数据均明确标为非个人，清理只选择本轮生成的ID与请求标识。

### 真实工程复盘同步

Codex 从本阶段实际提交、文件和测试结果生成结构化复盘，复用已有项目的稳定 `source_ref=repository:genesis-ai`，通过原 `genesis-sync.mjs` 和 Connector 上传测试 Worker。未创建第二个同名 Genesis 项目。原项目当前工程证据和提交更新为本阶段事实；旧复盘与资产仍保留。

- 项目：`project-05c1dab7-8908-4dea-9233-6259277ee53d`
- 新复盘：`record-23af4631-fc78-48c8-9d69-42f8b52e9890`，标题“Genesis Phase 4.6 完整云端迁移复盘”。
- 新资产：`asset-f85e7ffc-6fca-4690-a37c-c16aae6a5aeb`，标题“D1 原子写入与幂等验收方法”。
- 重复同一复盘包返回 `deduplicated:true`，项目、复盘和资产ID与数量均不变。

复盘包、验收日志与页面截图留在仓库外，没有提交私有复盘文件。只上传工程事实，没有上传个人画像、目标、访谈或本地数据库。

同步后的远程数量（不包含 Cloudflare 内部表）：

| 表 | 数量 |
| --- | ---: |
| genesis_projects | 1 |
| genesis_growth_records | 2 |
| genesis_assets | 2 |
| genesis_profile_items | 0 |
| genesis_goals | 0 |
| genesis_decisions | 0 |
| genesis_ingest_keys | 6 |
| genesis_quests | 0 |
| genesis_quest_runs | 0 |
| genesis_skills | 0 |
| genesis_skill_links | 0 |
| genesis_project_aliases | 0 |
| genesis_edit_history | 0 |
| genesis_cloud_write_state | 1 |

使命和技能为空是临时验收数据已清理的结果，不代表相关API未部署。内部协调表的一行只用于并发版本控制，不代表成长分数。

### PWA 验收边界

实际浏览器已确认云端使命、技能和角色编辑入口，查看了本次上传的完整复盘与资产，刷新后会话保持。390×844视口检查首页及资产库，内容宽度375、滚动宽度375，没有横向溢出，结束后恢复视口。公共缓存继续排除API、Cookie认证响应与个人资料；没有离线写入队列。

Android安装、iOS添加主屏幕、真机独立窗口与登录保持尚待用户在真实手机完成。响应式截图、Manifest和部署成功都不能替代这些验收。电脑与手机应使用同一个HTTPS测试地址；旧localhost仍只连接本地SQLite，没有自动双向同步。

## 修改文件与最终检查

- Worker：`worker/index.js`，新增 `store.js`、`domain.js`、`quests.js`、`skills.js`、`editor.js`、`agent.js`、`management.js`。
- 数据库／配置：顶层迁移0004–0007、`wrangler.jsonc`；本地迁移及用户SQLite未修改。
- 前端：`genesis-quest-builder.js`、`genesis-editor.js`、`genesis-skills.js`、`genesis-home.js`、`genesis-action-view.mjs`、`genesis-character.js`、`growth.html`、`index.html`、`sw.js`；保留已有组件和暖金视觉。
- 测试／构建：`test/genesis-cloud-store.mjs`、`test/genesis-cloud-api.mjs`、`test/genesis-cloud-migrations.mjs`、`test/fixtures/genesis-cloud-support.sql`、`package.json`和锁文件。
- 中文文档：本报告、README及测试部署指南。

最终扫描244个Git跟踪文件和云端静态文件，没有发现本机真实Secret值；没有跟踪数据库、私有运行时、复盘包或备份。远程Secret列表确认两项Secret存在。最后的文档提交仅记录验收结果，不包含部署代码变化，不需要再次部署。
