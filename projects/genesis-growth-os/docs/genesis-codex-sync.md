# Codex → Genesis 自动同步

Genesis 不调用 LLM。用户说“总结本次开发并同步 Genesis”时，由 Codex 读取当前项目中真实可访问的文件、Git 状态、提交记录和测试输出，生成一个临时的结构化复盘 JSON，再运行：

```powershell
$env:GENESIS_WORKER_URL = "http://127.0.0.1:3198"
$env:GENESIS_AGENT_TOKEN = "从本地 Secret 管理器读取"
node agent/genesis-sync.mjs --review-file <临时复盘.json>
```

`genesis-sync.mjs` 只负责校验和编排，网络请求全部复用 `agent/genesis-connector.mjs`。密钥只能来自环境变量或 Cloudflare Secret，不放进 JSON、前端、Git 或日志。

## 复盘包格式

```json
{
  "project": {
    "source_ref": "codex-sync:<稳定标识>",
    "name": "项目名称",
    "description": "项目描述",
    "status": "active",
    "domain": "ai-product",
    "progress": 0,
    "repo_path": "D:/项目路径",
    "git_commit": "已验证的 commit；未提交工作不得伪造 commit",
    "evidence": [{"path": "server.js", "note": "实际修改并已检查"}],
    "next_steps": ["只写尚未完成的工作"],
    "source_type": "codex_agent",
    "confidence": "verified",
    "visibility": "private"
  },
  "growth": [{
    "source_ref": "codex-sync:<稳定标识>:growth",
    "title": "本次开发复盘",
    "content": "面向展示的简短摘要",
    "details": {
      "completed_work": [],
      "problems": [],
      "solutions": [],
      "learned": [],
      "reusable_assets": [],
      "next_steps": []
    },
    "evidence": [{"path": "test/...", "command": "npm test"}],
    "record_type": "project_review",
    "source_type": "codex_agent",
    "confidence": "verified",
    "visibility": "private"
  }],
  "assets": [{
    "source_ref": "codex-sync:<稳定标识>:asset:<名称>",
    "title": "可复用资产名称",
    "asset_type": "playbook",
    "content": "可复用方法或代码说明",
    "tags": ["tag"],
    "evidence": [{"path": "agent/genesis-connector.mjs"}],
    "source_type": "codex_agent",
    "confidence": "verified",
    "visibility": "private"
  }]
}
```

`completed_work` 只能包含已经在当前上下文和证据中确认完成的内容。计划、建议或待验证事项只能进入 `next_steps`，不应写入完成列表。每条记录都必须有证据；缺少证据时应标记为 `pending_verification`，而不是猜测。

项目先保存，编排器使用服务端返回的真实项目 ID，再保存成长记录和资产。项目、成长记录和资产都使用 `source_ref` 去重；重复执行会返回 `deduplicated`，不会新增重复内容。编排器只有在每个 Connector 调用都返回 `success` 和资源 ID 后才输出成功。
