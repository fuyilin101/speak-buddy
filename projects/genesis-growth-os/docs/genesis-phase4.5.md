# Phase 4.5：PWA 安装支持

Genesis 保留 Express + 单页前端和现有 Cloudflare Worker。该阶段只增加安装与公共静态文件离线支持，不增加数据库、迁移、API 或业务能力，不连接 LLM。

## 安装配置

完善已有 `public/manifest.json`：`name=Genesis AI`、`short_name=Genesis`、`id=/`、`scope=/`、`start_url=/`、`display=standalone`、`lang=zh-CN`。背景与主题为 `#0c0d0f`。

`icon-192.png`、`icon-512.png` 使用页面现有暖金矢量标志和不透明暗色背景，保留 maskable 安全区域；iOS 使用 `apple-touch-icon.png`（180×180）。矢量源为 `genesis-icon.svg`，favicon 同步为该标志。

首页、登录和本地初始化入口加入 Manifest、theme-color、Apple 主屏幕图标和独立窗口声明。PWA 引导放在 `genesis-pwa.js`，仅负责注册与安装事件，避免耦合首页业务。设置页增加安装说明；有真实浏览器安装事件时才显示按钮，不自动打开安装弹窗、不申请推送权限。

## 缓存边界

Service Worker 使用版本化 `genesis-pwa-v1` 缓存。精确白名单包括公共离线 HTML、Manifest、前端 JS/CSS、本地字体、图标。

安装预取使用 `credentials: omit`，不携带账号凭据。响应必须为 200、类型匹配、没有重定向；`private`、`no-store`、`Set-Cookie`、依赖 Cookie/Authorization 的 Vary、opaque 响应不能缓存。未知文件、带非版本参数的 URL、携带 Authorization/Range 的请求不进入缓存。

所有 `/api/` 请求和写入请求不被 Service Worker 接管。成长首页、登录、初始化及其他导航始终优先网络，尊重登录跳转；不缓存其 HTML。断网导航只显示 `offline.html`，其中没有昵称、任务、项目、个人资料或资产内容，不会回放缓存中的个人状态。

静态资源在线优先网络，断网才回退公共缓存。缓存存储故障不改变业务数据或登录会话。激活后只淘汰旧的 `forge-v数字`、`genesis-pwa-v数字` 静态缓存，不清理 Cookie、localStorage、IndexedDB、其他应用缓存或数据库。不强制刷新页面，避免打断正在填写的使命表单。

## Cloudflare 打包

测试环境仍使用 `wrangler.jsonc` 的 `.genesis-cloud-assets` 与 `run_worker_first=true`。构建脚本补齐 Manifest、Worker、离线页和安装图标。Worker 仅补充静态响应头：`sw.js` 不缓存、Manifest 必须重新验证、公共离线 HTML 可缓存；API 和现有认证保持原样。

只运行本地静态构建和 `wrangler deploy --dry-run --env test` 验证打包，不上传 Worker、不操作远程 D1、不进行部署。

## 手机安装与会话

- Android：用支持 PWA 的浏览器访问应用，登录后通过菜单“安装应用”或设置里的安装按钮添加。
- iPhone：Safari 打开应用，分享 → 添加到主屏幕；若出现“作为 Web App 打开”，将其开启，再点添加。
- 通过主屏幕图标进入独立窗口。不同平台可能隔离首次安装的会话，所以首次打开可能需要重新登录；同一应用中后续刷新沿用现有 Cookie 和会话有效期，不使用前端存储密码。

手机需要访问实际可用的 HTTPS 地址。电脑上的 `127.0.0.1` 仅用于电脑本地验证，手机上的同地址指向手机自身；不能将电脑本地测试视作手机安装成功。

## 验证范围

`npm run test:genesis-pwa` 验证 Manifest、图标尺寸、Apple 接入、注册和安装事件分支、独立窗口判断、预缓存、离线静态回退、隐私与 API 排除、旧缓存范围、Cloudflare 静态文件与响应头、本地登录后刷新保持及全库不变。

注册、安装接受事件与独立窗口判断的自动化测试属于逻辑验证，不代表已在手机安装。Android 安装、iOS 添加主屏幕、手机独立窗口与实际会话保持仍需 HTTPS 测试环境和实机验收。当前不具备手机控制环境，不伪称这些步骤已通过。

### 本轮实际结果（2026-10-13）

- `npm run check:syntax`：通过。
- `npm test`：30 个回归测试脚本全部通过，其中包含 PWA 专项验证。
- `npm run test:genesis-pwa`：通过；补充验证了缓存存储失败时，正常在线资源仍可使用。
- `npm run genesis:cloud:build` 和 `wrangler deploy --dry-run --env test --no-autoconfig`：通过。只在本地输出包，没有上传或部署。
- 隔离环境真实浏览器：登录后刷新保持会话；停止本地服务后刷新，显示公共离线页且图标正常加载；恢复服务点击“重新连接”，直接返回已登录首页，再次刷新保持登录。
- 手机尺寸视口：设置页安装说明可读，页面无水平溢出。这是响应式检查，不是手机安装验收。
- 对比操作前后：用户测试库和隔离验证库的全部表结构、全部记录保持不变。

Android 安装、iOS 添加到主屏幕以及手机独立窗口：**待实机验收**。当前远程测试网站尚未更新为本阶段版本。

参考：[MDN 安装条件](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)、[Apple 主屏幕添加说明](https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/ios)、[Cloudflare Worker 优先路由](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)。

## 修改文件

`public/manifest.json`、`public/icon-192.png`、`public/icon-512.png`、`public/apple-touch-icon.png`、`public/favicon.png`、`public/genesis-icon.svg`、`public/offline.html`、`public/sw.js`、`public/genesis-pwa.js`、`public/growth.html`、`public/index.html`、`public/login.html`、`public/setup.html`、`public/genesis-home.js`、`scripts/build-genesis-cloud.mjs`、`worker/index.js`、`test/genesis-pwa.mjs`、`test/genesis-home.mjs`、`package.json`、`README.md`、本文。
