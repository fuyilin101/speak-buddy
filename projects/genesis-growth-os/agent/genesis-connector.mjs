#!/usr/bin/env node
/** Minimal connector: agents prepare JSON; this file authenticates and sends it. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const operations = {
  genesis_save_project: { method: "POST", path: "/api/genesis/agent/projects", needsBody: true },
  genesis_add_growth: { method: "POST", path: "/api/genesis/agent/growth-records", needsBody: true },
  genesis_save_asset: { method: "POST", path: "/api/genesis/agent/assets", needsBody: true },
  genesis_get_projects: { method: "GET", path: "/api/genesis/agent/projects", needsBody: false },
};
function fail(message, code = 2) { console.error(`Genesis 连接器失败：${message}`); process.exitCode = code; }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function parseArgs(argv) {
  const [operation, ...rest] = argv, options = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (key === "data" || key === "file" || key === "idempotency-key") {
      options[key] = rest[++i];
      if (!options[key]) throw new Error(`Missing value for --${key}`);
    } else throw new Error(`Unknown option: --${key}`);
  }
  return { operation, options };
}
async function readPayload(options) {
  if (options.file) return JSON.parse(await readFile(options.file, "utf8"));
  if (options.data) return JSON.parse(options.data);
  throw new Error("写入操作需要通过 --data 或 --file 提供 JSON 对象。");
}
async function main() {
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2)); } catch (error) { return fail(error.message); }
  const config = operations[parsed.operation];
  if (!config) return fail(`Unknown operation. Use one of: ${Object.keys(operations).join(", ")}`);
  const baseUrl = String(process.env.GENESIS_WORKER_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
  const token = String(process.env.GENESIS_AGENT_TOKEN || "");
  if (!token) return fail("未设置 GENESIS_AGENT_TOKEN；请从安全文件加载到环境变量，不能通过命令参数传入密钥。");
  let body;
  if (config.needsBody) {
    try { body = await readPayload(parsed.options); } catch (error) { return fail(`Could not read JSON payload: ${error.message}`); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("请求数据必须是 JSON 对象。");
  }
  const headers = { Accept: "application/json", Authorization: `Bearer ${token}` };
  if (config.needsBody) {
    const serialized = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
    headers["Idempotency-Key"] = parsed.options["idempotency-key"] || `genesis:${parsed.operation}:${hash(serialized)}`;
  }
  let response;
  try {
    response = await fetch(`${baseUrl}${config.path}`, { method: config.method, headers, body: config.needsBody ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(Number(process.env.GENESIS_CONNECTOR_TIMEOUT_MS || 10000)) });
  } catch (error) {
    return fail(`网络请求失败（${error.code || error.name || "未知错误"}），请检查 GENESIS_WORKER_URL 和网络连接。`, 1);
  }
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch (_) { data = { error: "Worker 返回了非 JSON 响应。" }; }
  if (!response.ok) return fail(`${response.status} ${data.error || response.statusText || "Worker rejected the request."}`, 1);
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}
main().catch((error) => fail(error.message || "Unexpected connector error", 1));
