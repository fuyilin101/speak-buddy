# Genesis AI（新生）

Build the next version of yourself. 构建下一个版本的自己。

Genesis 是由外部 AI Agent 驱动的个人成长系统，融合 The Forge 成长体验与个人成长资产仓库。它存储项目经验、成长记录与可复用资产；Genesis 自身不调用 LLM API。外部 Codex 分析当前可访问的代码和提交证据，再通过 Connector 认证写入。

## 当前架构

- 本地：保留 The Forge 的 Express + 单页前端和 SQLite。
- 云端测试：Cloudflare Workers + 独立 D1；包含驾驶舱、使命与执行历史、技能树与关联、项目、复盘、资产、人工编辑和 Agent Connector。
- 网页登录使用独立密码和 HttpOnly 本人会话；Agent Token 仅在服务端 Secret 与外部 Agent 环境变量中使用，两类权限分离。
- 未迁移本地个人记忆，未部署生产环境。

测试云端支持首次由本人设置登录密码。通过专属初始化链接打开设置页，输入并确认新密码；成功后旧查看密码与初始化入口失效。Agent Token不变。本地Express保留原认证实现。详见 [首次密码设置](docs/genesis-owner-setup.md)。

## 个人成长首页

默认入口展示角色状态、当前主线、今日行动、最近成长和能力积累。所有数据标明来源；缺少训练 XP 或已确认资料时显示空状态。页面加载、刷新与导航只读。今日行动支持手动完成和撤销，状态独立保存，不触发 XP 或奖励。项目统计与复盘保留在成长资产库；Phase 4.1 当时保留了旧入口，现已由 Phase 4.2 统一。

详见 [Phase 4.1 范围与验收](docs/genesis-phase4.1.md)。

### Phase 4.2：Genesis 行动体验融合

当前用户入口已统一。角色使用中性形象，今日行动支持待开始、进行中、已完成，以及完成与撤销反馈。页面读取和切换不会自动保存；手动操作只记录状态，不自动生成复盘或资产。已沉淀状态预留。原实现源码继续保留，维护入口默认关闭。

详见 [Phase 4.2 范围与验收](docs/genesis-phase4.2.md)。该阶段只做本地融合；Phase 4.6 已接入独立云端使命定义和执行历史。

## 本地启动

运行 npm ci，然后 npm start。SQLite 默认位于忽略的 data/ 目录。APP_PASSWORD 和 GENESIS_AGENT_TOKEN 从环境变量读取；不要提交真实值。

## Codex 自动同步

对可访问此项目的 Codex 说：**总结本次开发并同步 Genesis**。

Codex 应核实实际文件、Git 提交和测试结果，生成临时复盘 JSON，执行 npm run genesis:sync -- --review-file <文件>。已完成与下一步分开；未经验证的内容标记为待确认。

详见 [同步格式](docs/genesis-codex-sync.md) 和 [连接器说明](docs/genesis-agent-connector.md)。

## Cloudflare 测试环境

仅使用 wrangler.jsonc 的 test 环境。先 npm run genesis:cloud:build，再运行测试迁移与部署。具体操作、身份认证和验收见 [测试部署指南](docs/genesis-cloudflare-test.md)。默认顶层配置保留本地开发占位符，不能用于正式部署。

Phase 4.6 已部署至 [Genesis 测试云端](https://genesis-ai-test.anime-english-mvp.workers.dev/)，电脑与手机访问同一测试 D1。完整接口、真实工程复盘上传和去重已验证；Android／iOS 真机安装仍待验收。本地个人资料没有导入。详见 [完整云端迁移报告](docs/genesis-phase4.6.md)。

## 验证

npm run check:syntax；npm test；npm run test:genesis-home；npm run test:genesis-worker；npm run genesis:cloud:build；npx wrangler deploy --dry-run --env test。

测试通过不等同于远程部署或生产验收，必须单独记录 Worker 地址、数据库、写入 ID、重复请求和认证失败结果。

## 许可与原项目

基于 [The Forge](https://github.com/ycianno/the-forge) 改造，保留原架构、UI 组件与 MIT 版权文件。历史英文文档存放在 docs/upstream/README.en.md，仅作上游参考；当前 Genesis 使用说明以中文文档为准。

### 每日使命（Phase 4.2.1）

“今日行动”升级为 Genesis Quest（每日使命），提供当日总览、计划时间轴、使命卡片与保存确认后的完成反馈。完成仅保存独立行动状态，历史完成记录仍为只读。详见 [每日使命说明](docs/genesis-phase4.2.1.md)。

### 每日使命编辑器（Phase 4.2.2）

使用独立使命定义与每日执行记录，支持创建、编辑、成长维度、重复计划、目标关联、暂停及可恢复删除，按时间展示。首次开始或完成保存快照，后续修改规则不改写历史，可按使命、日期和状态查询。本地以 `GENESIS_ENABLE_QUEST_BUILDER=1` 启用，启动升级前自动备份 SQLite。Phase 4.6 的测试云端以 `GENESIS_ENABLE_CLOUD_MANAGEMENT=1` 开放同类能力。详见 [每日使命管理系统](docs/genesis-phase4.2.2.md)。

### 本地成长档案编辑

本地测试预览可以设置 `GENESIS_ENABLE_LOCAL_EDITING=1`，在成长资产库编辑项目、成长记录和可复用资产，在设置或角色卡编辑昵称、阶段和路线。默认关闭；浏览器会话认证与跨站保护继续生效。编辑保留原始证据与私有修改前记录，不生成经验值或奖励。详情见 [本地界面与编辑说明](docs/genesis-local-editing.md)。

## 技能树：我的成长路线

以 `GENESIS_ENABLE_SKILL_TREE=1` 启用本地简化技能树：手动创建和编辑节点、父子层级、阶段与四类关联（目标、使命、项目、资产）。启动新增两张独立表前自动备份，不改变已有数据；读取不写入，状态不自动评分。导航“成长记忆”改为“技能树”，记忆数据保留。Phase 4.6 已补齐测试云端接口。详见 [Phase 4.3 技能树说明](docs/genesis-phase4.3.md)。

## Dashboard 2.0：成长驾驶舱

首页聚合角色与方向、今日使命、技能分支和最近项目/资产，使命与技能摘要最多显示 3 项。首页只读取和跳转，失败卡片可独立重试；没有内容显示空状态，不推断能力或生成成长记录。复用现有三个读取接口，不新增数据库或数据模型。Phase 4.6 已连接同一套云端读取接口。详见 [Phase 4.4 驾驶舱说明](docs/genesis-phase4.4.md)。

## 成长之树（Phase 5.1）

技能树采用暖金节点、SVG枝干和关联项目／资产的成果展示；点击节点查看侧栏，原编辑和关联规则不变。手机使用逐层折叠树，首页提供“查看成长之树”入口。状态仍由用户设置，不增加评分、经验或数据库结构。详见 [成长之树验收](docs/genesis-phase5.1.md)。

## PWA：添加到手机桌面

Genesis 已接入 Manifest、暖金安装图标和公共静态资源缓存。Android 可从浏览器菜单安装；iPhone 可在 Safari 分享菜单添加到主屏幕。设置页提供安装说明。个人数据与 API 响应不缓存，断网只显示公共离线页；安装后的会话沿用现有认证。手机实机安装需要可访问的 HTTPS 测试地址，本地构建不代表已部署或手机验收通过。详见 [Phase 4.5 PWA 说明](docs/genesis-phase4.5.md)。
