# Speak Buddy AI 英语陪练

## 项目用途

动漫角色陪伴式 AI 英语练习，支持自然聊天、情景对话、语音识别、MeloTTS、中文翻译、英语纠错、学习记录和复习功能。

## 技术栈

- React + Vite
- Cloudflare Workers
- Cloudflare D1
- 阿里云百炼 Qwen
- Cloudflare Workers AI MeloTTS

## 环境

- 测试 Worker：`anime-english-mvp-test`
- 测试 D1：`english-ai-test`
- 测试网址：https://test.101mcloud.com
- 生产环境：仅作为背景记录，禁止从此目录说明直接执行生产部署

## 当前代码位置

当前可部署源码暂时保留在仓库根目录，包括：

- `src/`：React 前端
- `worker/`：Cloudflare Worker 后端
- `migrations/`：D1 迁移
- `public/`：静态资源
- `wrangler.jsonc`：正式配置
- `wrangler.test.jsonc`：测试配置（本地文件，不纳入 Git）

这样可以避免移动源码后破坏现有构建和部署命令。后续如果仓库增加第二个独立项目，应在 `projects/` 下新增对应说明目录，并为其配置独立构建入口。

## 安全说明

- `.dev.vars`、Worker Secret 和测试 Wrangler 配置不上传仓库。
- API Key 只应保存在服务端 Secret 中。
- 公开仓库中只能保留示例配置和占位符。
