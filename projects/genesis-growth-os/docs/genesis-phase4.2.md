# Genesis AI Phase 4.2：行动体验融合

本阶段提取原项目的行动体验，统一 Genesis 入口。角色、任务、进度与反馈均服务于真实行动记录；完成行动只修改独立状态，不产生复盘、成长资产或能力证据。

## 实施范围

- 首页、我的角色、今日行动、成长资产库、成长记忆占位及设置统一在 Genesis 界面。
- 系统界面隐藏旧产品入口和所有游戏机制文案。历史任务标题、个人资料、复盘内容与原始数据不改写。
- 角色复用 `Effigy` 绘图，中性展示，不提供游戏进度、历史装饰、交互升阶或回调。
- 行动维度展示“已完成 / 今日计划”，条形图仅表示计划完成比例。无计划时显示空状态，不评价人的能力强弱。
- 今日行动保持分类强调色、时间、投入时长、开始/完成/撤销操作、完成动画与进度条。只在匹配的服务器确认后反馈“行动记录完成”。
- “已沉淀”只作后续说明，不是可写入状态。本阶段不实现 Agent 自动总结与行动资产关联。

## 组件边界

| 文件 | 职责 |
| --- | --- |
| `public/genesis-action-view.mjs` | 纯卡片、进度与视觉反馈，不发起请求 |
| `public/genesis-actions.js` | 显式点击、保存互斥、确认校验、超时及失败提示 |
| `public/genesis-action-model.mjs` | 状态兼容、纯合并及行动维度统计 |
| `public/genesis-character.js` | 角色档案、中性绘图和今日维度展示 |
| `public/effigy.js` | 复用绘图，增加可选中性模式，旧默认接口保持兼容 |
| `public/growth.html`、`public/index.html` | 统一用户入口与导航 |
| `public/css/10-genesis-fusion.css` | 角色、状态按钮、独立页面和响应式布局 |
| `public/genesis-home.js`、`public/genesis-home-model.mjs` | 读取与路由组合，不自动保存 |
| `dashboard-summary.js` | 新增 `buildActionSummary`，只调用原任务计划的纯函数 |
| `server.js` | 三状态接口、统一路由与默认关闭的维护路径 |
| `legacy/forge.html` | 完整保留旧 HTML，移出公开静态目录 |
| `public/sw.js` | 融合入口断网不回退旧界面、不缓存私人状态、不清理既有缓存 |
| `public/setup.html`、`public/setup.js` | 初始化品牌与中文提示 |
| `Dockerfile`、`test/docker-payload.js` | 保留维护源码的容器兼容检查 |
| `scripts/build-genesis-cloud.mjs` | 打包融合页面与组件，不打包旧页面执行入口 |
| `test/genesis-home.mjs`、`test/genesis-actions.mjs`、`test/genesis-fusion.mjs` | 状态、隔离、失败与纯计算边界验证 |
| `package.json`、`README.md` | 自动回归与中文使用说明 |

## 数据与安全

允许状态：`not_started`（待开始）、`in_progress`（进行中）、`completed`（已完成）。

沿用既有 `settings.genesis_action_states` 存储，不新增表或迁移。每条记录以日期和任务 ID 为唯一键，保留来源、`user_stated` 可信状态、`private` 隐私属性及更新时间。保留布尔 `completed` 字段供旧客户端兼容；旧布尔记录在读取时解释，不自动回写迁移。

`POST /api/genesis/action-status` 沿用会话认证与来源保护，只接受当天存在的任务。拒绝未知状态、已沉淀、非法日期、字段、类型以及矛盾的状态/布尔参数。重复提交相同状态返回 `deduplicated: true`，不改变记录或时间戳。历史已完成任务只展示，不能从新界面改动。

页面加载、刷新、切换只读取；只有用户主动点击才写独立状态。综合游戏摘要仍为维护代码保留，但 Genesis 首页与行动接口使用独立 `buildActionSummary`，不计算游戏进度、不调用 `Game.render` 或任何奖励检查。

离线或连接中断时保留原状态并提示尚未确认完成，不入离线写入队列、不自动重试。响应丢失时服务端可能已保存，因此提示联网刷新核实；重试同一状态不会追加数据。重复响应不触发新的完成动画。

旧源文件保留在 `legacy/forge.html`。`/internal/legacy` 默认返回 404，维护时需显式配置 `GENESIS_ENABLE_LEGACY_UI=1` 并登录；正常页面不提供该入口。`/`、`/growth.html`、`/index.html` 及登录后的跳转均进入 Genesis。

## 验证

- 原有 20 项回归，包含 12,000 个随机周用例，保持通过。
- Worker SELECT 适配器 100 次 GET，Express 写入前后各 100 次 GET，数据库内容与结构保持一致。
- 单次完成、撤销、再完成、进行中与重复请求仅更新同一行动键；成长记录、资产、历史训练和其他表不变。
- 客户端验证确认前不更新、重复点击与刷新互斥、认证失败、网络失败、超时、无效及错配响应、不重复触发动画。
- 融合验证通过替换原引擎的游戏计算函数为抛错函数，确认 `buildActionSummary` 不会调用这些计算；旧布尔记录兼容且输入不变。
- 实际浏览器验收使用独立 SQLite 副本：完成、撤销、再完成及连接中断后，行动条目数量不增加，已有成长记录和资产数量不变。
- 100 次实际浏览器刷新及各页面切换后，全部 12 张表与刷新前快照一致，行动状态保留。系统文案与手机宽度检查通过。
- 语法、Worker 回归、云端静态构建及 Wrangler 测试环境 dry-run 通过。dry-run 只打包，不等于远程部署。

## 部署与后续范围

本次仅本地开发与隔离副本验收。原始数据库、真实个人记忆、凭据和截图不提交 Git；未操作远程 D1 或部署任何环境。

Cloudflare 测试站点仍缺少本地行动计划来源，因此当前构建中的行动模块保持空状态，不自动上传本地数据。独立行动记录暂不包含在旧系统的导出备份中，现阶段通过完整 SQLite 副本保留。

后续可使用已预留的 `{date, quest_id}` 行动引用接入 Agent 复盘、成长记录、资产与证据关联；本阶段不执行这些流程。
