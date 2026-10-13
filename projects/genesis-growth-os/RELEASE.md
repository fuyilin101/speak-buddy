# Genesis Growth OS 发布包

来源提交：`2bcba544779875f7289acd2e33362c2f71869375`，源分支：`genesis-ai-phase1`。

这是 Genesis AI 个人成长操作系统的完整源码快照，包含本地 Express + SQLite 和 Cloudflare Worker + D1 测试实现。Genesis 本身不调用 LLM API。

## 分类

| 目录或文件 | 内容 |
| --- | --- |
| public/ | 驾驶舱、角色、每日使命、成长之树、资产库和 PWA |
| worker/ | 云端 API、认证和 D1 数据访问 |
| server.js、genesis-*.cjs | 本地 Express 与 SQLite 实现 |
| migrations/ | 云端测试数据库增量迁移 |
| migrations/local/ | 本地增量迁移 |
| agent/ | Connector 和 Codex 同步工具 |
| test/ | 回归测试及非个人测试夹具 |
| docs/ | 中文使用说明、设计及阶段验收 |
| legacy/、docs/upstream/ | 保留的 The Forge 参考实现和文档 |
| deploy/ | 原有自托管部署资料 |

## 使用

从当前项目目录运行 `npm ci` 和 `npm start`。本地编辑、使命和技能树按 README 的开关启用。测试及部署命令见 README 和 docs。根仓库的 npm 命令属于其他项目，不要从根目录运行本项目。

## 发布安全

不包含真实个人档案、数据库、备份、运行时状态、测试预览凭据或密钥。保留 MIT 许可和上游来源。仅导出当前代码，不上传开发历史中的未审核对象。

发布包的 wrangler.jsonc 已将测试 D1 ID改为占位符，并移除作者的自定义域名和登录限流绑定。部署前创建自己的独立测试数据库，配置限流绑定和 Cloudflare Secrets；其他环境原样保留。不要直接部署占位配置。此打包不执行部署或迁移。

## 已有验收

Phase 5.1 已完成 36 个回归脚本和真实浏览器 100 次只读刷新检查；具体见 docs/genesis-phase5.1.md。本次打包另进行语法、静态构建、文件一致性和敏感内容检查。Android/iOS 真机安装仍待验收。
