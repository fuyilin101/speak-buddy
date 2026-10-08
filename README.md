# 动漫角色英语口语 AI · V0.1

Cloudflare Workers + React/Vite 的手机网页/PWA MVP。首版只实现文字聊天、角色设置、即时纠错和错误记录；模型、语音、视觉与角色素材通过边界接口预留。

## 本地启动

```bash
npm install
npm run dev
```

需要 Node.js 20+。没有配置模型密钥时，Worker 使用演示回复，方便先走通产品流程。

## 接入真实 LLM

复制 `.dev.vars.example` 为 `.dev.vars`，填写 Cloudflare AI Gateway 或兼容 OpenAI Chat Completions 的接口地址与令牌：

```text
AI_GATEWAY_URL=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
AI_GATEWAY_TOKEN=你的百炼API-Key
AI_MODEL=qwen-plus
AI_VISION_MODEL=qwen3-vl-plus
```

Worker 会优先调用真实模型；请求失败或未配置时自动回退到演示回复。生产环境请使用 Wrangler secret，不要把令牌写进源码。

## 部署

```bash
npm run build
npm run deploy
```

在 Cloudflare 控制台创建 D1 数据库后，将数据库绑定名设为 `DB`，再执行 `wrangler d1 execute english-ai --remote --file=./schema.sql`。


## 当前接口

- `POST /api/chat`：文字聊天、即时纠错和错误记录。
- `POST /api/vision`：接收照片和当前对话上下文，返回自然英文回复；原图不写入数据库。单张图片请求上限约 8 MB。
- `GET /api/mistakes`：读取错误记录。

## 使用通义千问（阿里云百炼）

项目使用百炼的 OpenAI 兼容接口：文字默认 `qwen-plus`，图片默认 `qwen3-vl-plus`。北京地域使用 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`；如果使用业务空间或其他地域，请替换为百炼控制台提供的对应地址。
