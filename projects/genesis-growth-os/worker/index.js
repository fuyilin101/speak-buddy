import { buildGrowthHome } from '../public/genesis-home-model.mjs';
import { createSession, validSession, sessionCookie } from './session.js';
import { chineseError } from './errors.js';
import { Store, ApiError, mutate, projectId, visibleProjects } from './store.js';
import { questToday } from './quests.js';
import { managedPath, managedRead, managedWrite } from './management.js';
import { saveAgent } from './agent.js';
import { ownerSetupEnabled, ownerRecord, validSetupToken, initializeOwner, verifyOwnerPassword, passwordError, sessionSecret } from './owner-auth.js';

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const MAX_AGENT_BODY_BYTES = 256 * 1024;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function json(data, init = {}) {
  if (data.error) data = { ...data, error: chineseError(data.error) };
  return new Response(JSON.stringify(data), { ...init, headers: { ...JSON_HEADERS, ...(init.headers || {}) } });
}
function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function pathOf(request) { return new URL(request.url).pathname; }
function isObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function hasUnsafeKeys(value) {
  if (Array.isArray(value)) return value.some(hasUnsafeKeys);
  if (!isObject(value)) return false;
  return Object.entries(value).some(([key, child]) => UNSAFE_KEYS.has(key) || hasUnsafeKeys(child));
}
function byteLength(value) { return new TextEncoder().encode(value).byteLength; }
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function sameSecret(left, right) {
  const [a, b] = await Promise.all([sha256(left), sha256(right)]);
  let different = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) different |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return different === 0;
}
function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    const requestOrigin = new URL(request.url).origin;
    const configured = String(env.GENESIS_ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
    return origin === requestOrigin || configured.includes(origin);
  } catch (_) { return false; }
}
async function requireAgent(request, env) {
  if (!env.GENESIS_AGENT_TOKEN) return json({ error: "Genesis agent integration is not configured." }, { status: 503 });
  if (!originAllowed(request, env)) return json({ error: "Cross-origin agent requests are not allowed." }, { status: 403 });
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ") || !(await sameSecret(header.slice(7), env.GENESIS_AGENT_TOKEN))) return json({ error: "Genesis agent authentication failed." }, { status: 401 });
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_AGENT_BODY_BYTES) return json({ error: "Genesis agent payload is too large." }, { status: 413 });
  return null;
}
async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return { error: '请求正文不能为空。' };
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_AGENT_BODY_BYTES) { await reader.cancel(); return { error: '请求内容过大。' }; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const raw = new TextDecoder().decode(bytes);
  let body;
  try { body = JSON.parse(raw); } catch (_) { return { error: "Invalid JSON request body." }; }
  if (!isObject(body) || hasUnsafeKeys(body)) return { error: "Payload must be a safe JSON object." };
  return { body, hash: await sha256(raw) };
}
function stringError(value, max, field, required = false) {
  if (value == null || value === "") return required ? `${field} is required.` : "";
  return typeof value === "string" && value.length <= max ? "" : `${field} is invalid or too long.`;
}
function jsonError(value, max, field, array = false) {
  if (value == null) return "";
  if (array && !Array.isArray(value)) return `${field} must be an array.`;
  if (!array && !isObject(value) && !Array.isArray(value)) return `${field} must be an object or array.`;
  return byteLength(JSON.stringify(value)) <= max && !hasUnsafeKeys(value) ? "" : `${field} is invalid or too large.`;
}
function dateError(value, field) {
  if (value == null || value === "") return "";
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? "" : `${field} must be a valid date.`;
}
const CONFIDENCE_VALUES = new Set(["verified", "user_stated", "pending_verification", "inference", "agent_generated", "imported", "legacy"]);
const VISIBILITY_VALUES = new Set(["private", "shared", "public"]);
function metadataError(body) {
  if (body.source_type != null && stringError(body.source_type, 80, "source_type")) return "source_type is invalid.";
  if (body.confidence != null && (!CONFIDENCE_VALUES.has(body.confidence))) return "confidence is invalid.";
  if (body.visibility != null && (!VISIBILITY_VALUES.has(body.visibility))) return "visibility is invalid.";
  return null;
}
function validateProject(body) {
  if (!isObject(body)) return "project payload must be an object.";
  for (const [field, max, required] of [["source_ref", 300, true], ["name", 160, true], ["description", 4000, false], ["domain", 80, false], ["repo_path", 500, false], ["git_commit", 200, false]]) {
    const error = stringError(body[field], max, field, required); if (error) return error;
  }
  if (body.status != null && !["active", "paused", "completed", "archived"].includes(body.status)) return "status is invalid.";
  if (body.progress != null && (!Number.isFinite(Number(body.progress)) || Number(body.progress) < 0 || Number(body.progress) > 100)) return "progress must be between 0 and 100.";
  const metadata = metadataError(body); if (metadata) return metadata;
  const date = dateError(body.target_date, "target_date"); if (date) return date;
  for (const [field, max] of [["evidence", 16000], ["next_steps", 12000]]) { const error = jsonError(body[field], max, field, true); if (error) return error; }
  return null;
}
function validateGrowth(body) {
  if (!isObject(body)) return "growth payload must be an object.";
  for (const [field, max, required] of [["source_ref", 300, true], ["title", 200, true], ["content", 24000, false], ["record_type", 80, false], ["project_id", 120, false], ["metric_unit", 40, false]]) {
    const error = stringError(body[field], max, field, required); if (error) return error;
  }
  if (body.metric_value != null && body.metric_value !== "" && !Number.isFinite(Number(body.metric_value))) return "metric_value must be finite.";
  const metadata = metadataError(body); if (metadata) return metadata;
  const date = dateError(body.recorded_at, "recorded_at"); if (date) return date;
  for (const [field, max, array] of [["details", 24000, false], ["evidence", 16000, true]]) { const error = jsonError(body[field], max, field, array); if (error) return error; }
  return null;
}
function validateAsset(body) {
  if (!isObject(body)) return "asset payload must be an object.";
  for (const [field, max, required] of [["source_ref", 300, true], ["title", 200, true], ["asset_type", 80, false], ["content", 24000, true], ["project_id", 120, false]]) {
    const error = stringError(body[field], max, field, required); if (error) return error;
  }
  for (const [field, max] of [["tags", 4000], ["evidence", 16000]]) { const error = jsonError(body[field], max, field, true); if (error) return error; }
  const metadata = metadataError(body); if (metadata) return metadata;
  return null;
}
function idempotencyKey(request) {
  const key = (request.headers.get("Idempotency-Key") || "").trim();
  return key && key.length <= 200 ? key : null;
}
async function replayIdempotency(request, env, operation, hash) {
  const key = idempotencyKey(request);
  if (!key) return { key: null, hash };
  const row = await env.DB.prepare("SELECT operation, request_hash, response_json FROM genesis_ingest_keys WHERE idempotency_key = ?").bind(key).first();
  if (!row) return { key, hash };
  if (row.operation !== operation || row.request_hash !== hash) return { conflict: true };
  const response = JSON.parse(row.response_json); response.deduplicated = true; response.created = false;
  return { replay: response };
}
async function storeIdempotency(env, context, operation, resourceType, resourceId, response) {
  if (!context?.key) return;
  await env.DB.prepare(`INSERT OR IGNORE INTO genesis_ingest_keys (idempotency_key, operation, request_hash, resource_type, resource_id, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(context.key, operation, context.hash, resourceType, resourceId, JSON.stringify(response), now()).run();
}
async function dashboard(env) {
  const [projectsResult, recordsResult, assetsResult] = await Promise.all([
    env.DB.prepare(`SELECT id, name, description, status, domain, progress, target_date, source_ref, repo_path, git_commit, evidence_json, next_steps_json, source_type, confidence, visibility, created_at, updated_at FROM genesis_projects ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, updated_at DESC`).all(),
    env.DB.prepare(`SELECT id, project_id, record_type, title, content, metric_value, metric_unit, source_ref, evidence_json, details_json, source_type, confidence, visibility, recorded_at, created_at, updated_at FROM genesis_growth_records ORDER BY recorded_at DESC, created_at DESC LIMIT 12`).all(),
    env.DB.prepare(`SELECT id, project_id, title, asset_type, content, tags_json, evidence_json, source_ref, source_type, confidence, visibility, created_at, updated_at FROM genesis_assets ORDER BY updated_at DESC LIMIT 12`).all(),
  ]);
  const projects = env.GENESIS_ENABLE_CLOUD_MANAGEMENT === '1' ? await visibleProjects(new Store(env.DB)) : projectsResult.results || [], growthRecords = recordsResult.results || [], assets = assetsResult.results || [];
  const activeProjects = projects.filter((project) => project.status === "active");
  return { generatedAt: now(), summary: { projectCount: projects.length, activeProjectCount: activeProjects.length, recordCount: growthRecords.length, assetCount: assets.length, averageProgress: activeProjects.length ? Math.round(activeProjects.reduce((sum, project) => sum + Number(project.progress || 0), 0) / activeProjects.length) : 0 }, projects, growthRecords, assets };
}
async function growthHome(env) {
  const [projects,records,assets,profileItems,goals] = await Promise.all([
    env.DB.prepare('SELECT id,name,status,domain,evidence_json FROM genesis_projects').all(),
    env.DB.prepare('SELECT id,project_id,title,content,record_type,metric_value,metric_unit,evidence_json,recorded_at,created_at FROM genesis_growth_records').all(),
    env.DB.prepare('SELECT id,project_id,title,content,evidence_json,updated_at FROM genesis_assets').all(),
    env.DB.prepare("SELECT profile_key,value_json,confidence FROM genesis_profile_items WHERE profile_key IN ('display_name','nickname','callsign','current_stage','current_stage_name','growth_route') ORDER BY updated_at DESC").all(),
    env.DB.prepare("SELECT title,description,status,confidence FROM genesis_goals WHERE status='active' ORDER BY priority DESC,updated_at DESC LIMIT 20").all(),
  ]);
  const enabled=env.GENESIS_ENABLE_CLOUD_MANAGEMENT==='1',store=new Store(env.DB);
  const home=buildGrowthHome({snapshot:{projects:enabled?await visibleProjects(store):projects.results,growthRecords:records.results,assets:assets.results},profileItems:profileItems.results,goals:goals.results,environment:'cloud-test'});
  home.editor={available:enabled};home.questBuilder={available:enabled};home.skillTree={available:enabled};home.training.questBuilder=home.questBuilder;
  if(enabled)Object.assign(home.training,{available:true,source:'Genesis Cloud 使命与执行记录',cloudSynced:true,today:await questToday(store),actionTracking:{writable:true,stateOnly:true,source:'Genesis Cloud 使命执行'}});
  return home;
}

async function resolveCloudProject(db,id){return projectId(new Store(db),id);}

async function projectDetail(env, projectId) {
  if(env.GENESIS_ENABLE_CLOUD_MANAGEMENT==='1')projectId=await resolveCloudProject(env.DB,projectId);
  const project = await env.DB.prepare("SELECT * FROM genesis_projects WHERE id = ?").bind(projectId).first();
  if (!project) return null;
  const [growthResult, assetsResult] = await Promise.all([
    env.DB.prepare("SELECT * FROM genesis_growth_records WHERE project_id = ? ORDER BY recorded_at DESC, created_at DESC").bind(projectId).all(),
    env.DB.prepare("SELECT * FROM genesis_assets WHERE project_id = ? ORDER BY updated_at DESC").bind(projectId).all(),
  ]);
  const growthRecords = growthResult.results || [], assets = assetsResult.results || [];
  const timeline = [...growthRecords.map((record) => ({ kind: "growth", at: record.recorded_at, title: record.title, record })), ...assets.map((asset) => ({ kind: "asset", at: asset.created_at, title: asset.title, asset }))].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { project, growthRecords, assets, timeline };
}
async function saveProject(request, env, body, hash) {
  const context = await replayIdempotency(request, env, "genesis_save_project", hash);
  if (context.conflict) return json({ error: "Idempotency-Key was already used for a different request." }, { status: 409 });
  if (context.replay) return json(context.replay);
  const existing = await env.DB.prepare("SELECT id FROM genesis_projects WHERE source_ref = ?").bind(body.source_ref).first();
  const projectId = existing?.id || id("project");
  const timestamp = now();
  const fields = [body.name.trim(), String(body.description || ""), body.status || "active", String(body.domain || "growth"), Math.round(Number(body.progress || 0)), body.target_date || null, body.repo_path || null, body.git_commit || null, body.evidence == null ? null : JSON.stringify(body.evidence), body.next_steps == null ? null : JSON.stringify(body.next_steps), body.source_type || "agent_generated", body.confidence || "agent_generated", body.visibility || "private"];
  if (existing) await env.DB.prepare(`UPDATE genesis_projects SET name = ?, description = ?, status = ?, domain = ?, progress = ?, target_date = ?, repo_path = ?, git_commit = ?, evidence_json = ?, next_steps_json = ?, source_type = ?, confidence = ?, visibility = ?, updated_at = ? WHERE id = ?`).bind(...fields, timestamp, projectId).run();
  else await env.DB.prepare(`INSERT INTO genesis_projects (id, name, description, status, domain, progress, target_date, source_ref, repo_path, git_commit, evidence_json, next_steps_json, source_type, confidence, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(projectId, ...fields.slice(0, 6), body.source_ref, ...fields.slice(6), timestamp, timestamp).run();
  const project = await env.DB.prepare("SELECT * FROM genesis_projects WHERE id = ?").bind(projectId).first();
  const response = { success: true, operation: "genesis_save_project", created: !existing, deduplicated: Boolean(existing), project };
  await storeIdempotency(env, context, "genesis_save_project", "project", projectId, response);
  return json(response, { status: existing ? 200 : 201 });
}
async function saveGrowth(request, env, body, hash) {
  if (body.project_id && !(await env.DB.prepare("SELECT id FROM genesis_projects WHERE id = ?").bind(body.project_id).first())) return json({ error: "project_id does not reference an existing project." }, { status: 400 });
  const context = await replayIdempotency(request, env, "genesis_add_growth", hash);
  if (context.conflict) return json({ error: "Idempotency-Key was already used for a different request." }, { status: 409 });
  if (context.replay) return json(context.replay);
  const existing = await env.DB.prepare("SELECT id FROM genesis_growth_records WHERE source_ref = ?").bind(body.source_ref).first();
  if (existing) return json({ success: true, operation: "genesis_add_growth", created: false, deduplicated: true, record: await env.DB.prepare("SELECT * FROM genesis_growth_records WHERE id = ?").bind(existing.id).first() });
  const timestamp = now();
  const record = { id: id("record"), project_id: body.project_id || null, record_type: String(body.record_type || "reflection"), title: body.title.trim(), content: String(body.content || ""), metric_value: body.metric_value == null || body.metric_value === "" ? null : Number(body.metric_value), metric_unit: body.metric_unit || null, source_ref: body.source_ref, evidence_json: body.evidence == null ? null : JSON.stringify(body.evidence), details_json: body.details == null ? null : JSON.stringify(body.details), source_type: body.source_type || "agent_generated", confidence: body.confidence || "agent_generated", visibility: body.visibility || "private", recorded_at: body.recorded_at || timestamp, created_at: timestamp, updated_at: timestamp };
  await env.DB.prepare(`INSERT INTO genesis_growth_records (id, project_id, record_type, title, content, metric_value, metric_unit, source_ref, evidence_json, details_json, source_type, confidence, visibility, recorded_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(record.id, record.project_id, record.record_type, record.title, record.content, record.metric_value, record.metric_unit, record.source_ref, record.evidence_json, record.details_json, record.source_type, record.confidence, record.visibility, record.recorded_at, record.created_at, record.updated_at).run();
  const response = { success: true, operation: "genesis_add_growth", created: true, deduplicated: false, record: await env.DB.prepare("SELECT * FROM genesis_growth_records WHERE id = ?").bind(record.id).first() };
  await storeIdempotency(env, context, "genesis_add_growth", "growth", record.id, response);
  return json(response, { status: 201 });
}
async function saveAsset(request, env, body, hash) {
  if (body.project_id && !(await env.DB.prepare("SELECT id FROM genesis_projects WHERE id = ?").bind(body.project_id).first())) return json({ error: "project_id does not reference an existing project." }, { status: 400 });
  const context = await replayIdempotency(request, env, "genesis_save_asset", hash);
  if (context.conflict) return json({ error: "Idempotency-Key was already used for a different request." }, { status: 409 });
  if (context.replay) return json(context.replay);
  const existing = await env.DB.prepare("SELECT id FROM genesis_assets WHERE source_ref = ?").bind(body.source_ref).first();
  if (existing) return json({ success: true, operation: "genesis_save_asset", created: false, deduplicated: true, asset: await env.DB.prepare("SELECT * FROM genesis_assets WHERE id = ?").bind(existing.id).first() });
  const timestamp = now();
  const asset = { id: id("asset"), project_id: body.project_id || null, title: body.title.trim(), asset_type: String(body.asset_type || "playbook"), content: body.content, tags_json: body.tags == null ? null : JSON.stringify(body.tags), evidence_json: body.evidence == null ? null : JSON.stringify(body.evidence), source_ref: body.source_ref, source_type: body.source_type || "agent_generated", confidence: body.confidence || "agent_generated", visibility: body.visibility || "private", created_at: timestamp, updated_at: timestamp };
  await env.DB.prepare(`INSERT INTO genesis_assets (id, project_id, title, asset_type, content, tags_json, evidence_json, source_ref, source_type, confidence, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(asset.id, asset.project_id, asset.title, asset.asset_type, asset.content, asset.tags_json, asset.evidence_json, asset.source_ref, asset.source_type, asset.confidence, asset.visibility, asset.created_at, asset.updated_at).run();
  const response = { success: true, operation: "genesis_save_asset", created: true, deduplicated: false, asset: await env.DB.prepare("SELECT * FROM genesis_assets WHERE id = ?").bind(asset.id).first() };
  await storeIdempotency(env, context, "genesis_save_asset", "asset", asset.id, response);
  return json(response, { status: 201 });
}
async function handleApi(request, env) {
  const path = pathOf(request);
  if (request.method === "GET" && path === "/api/genesis/health") {
    await env.DB.prepare('SELECT 1 AS ready').first();
    if(ownerSetupEnabled(env)&&!(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='genesis_owner_auth'").first()))return json({ok:false,error:'登录初始化迁移尚未完成。'},{status:503});
    if(env.GENESIS_ENABLE_CLOUD_MANAGEMENT==='1'){
      const ready=await env.DB.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('genesis_quests','genesis_quest_runs','genesis_skills','genesis_skill_links','genesis_project_aliases','genesis_edit_history','genesis_cloud_write_state')").first();
      if(ready?.n!==7)return json({ok:false,error:'云端结构迁移尚未完成。'},{status:503});
    }
    return json({ ok: true, service: "genesis-ai", environment: env.GENESIS_ENVIRONMENT || 'local', storage: "cloudflare-d1", generatedAt: now() });
  }
  if(managedPath(path,request.method)){
    if(!(await validSession(request,env)))return json({error:'请先登录后管理你的成长资料。'},{status:401});
    if(env.GENESIS_ENABLE_CLOUD_MANAGEMENT!=='1')return json({error:'当前环境尚未启用云端管理。'},{status:503});
    const origin=request.headers.get('Origin');
    if(origin&&origin!==new URL(request.url).origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'不允许跨站修改成长资料。'},{status:403});
    if(request.method==='GET')return json(await managedRead(env.DB,path,new URL(request.url).searchParams));
    if(!['POST','PATCH','DELETE'].includes(request.method))return json({error:'不支持此操作。'},{status:405});
    const parsed=await readBody(request);if(parsed.error)return json({error:parsed.error},{status:400});
    const result=await managedWrite(env.DB,path,request.method,parsed.body,request.headers.get('Idempotency-Key'));
    return json(result,{status:request.method==='POST'&&['/api/genesis/projects','/api/genesis/growth-records'].includes(path)&&!result.deduplicated?201:200});
  }
  if (!path.startsWith('/api/genesis/agent/')) {
    const bearer = request.headers.get('Authorization') || '';
    const agent = env.GENESIS_AGENT_TOKEN && bearer.startsWith('Bearer ') && await sameSecret(bearer.slice(7), env.GENESIS_AGENT_TOKEN);
    if (!agent && !(await validSession(request, env))) return json({ error: '请先登录 Genesis AI，或提供有效的身份认证。' }, { status: 401 });
  }
  if (request.method === 'GET' && path === '/api/genesis/home') return json(await growthHome(env));
  if (request.method === "GET" && path === "/api/genesis/dashboard") return json(await dashboard(env));
  if (request.method === "GET" && path === "/api/genesis/projects") return json((await dashboard(env)).projects);
  if (request.method === 'GET' && path === '/api/genesis/growth-records') return json((await dashboard(env)).growthRecords);
  if (request.method === "GET" && path.startsWith("/api/genesis/projects/")) {
    const detail = await projectDetail(env, decodeURIComponent(path.slice("/api/genesis/projects/".length)));
    return detail ? json(detail) : json({ error: "Project not found." }, { status: 404 });
  }
  if (!path.startsWith("/api/genesis/agent/")) return json({ error: "Not found" }, { status: 404 });
  const authError = await requireAgent(request, env); if (authError) return authError;
  if (request.method === "GET" && path === "/api/genesis/agent/projects") return json({ success: true, operation: "genesis_get_projects", projects: (await dashboard(env)).projects });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });
  const parsed = await readBody(request); if (parsed.error) return json({ error: parsed.error }, { status: 400 });
  const body = parsed.body;
  if(env.GENESIS_ENABLE_CLOUD_MANAGEMENT==='1'){
    const operations={'/api/genesis/agent/projects':['genesis_save_project',validateProject],'/api/genesis/agent/growth-records':['genesis_add_growth',validateGrowth],'/api/genesis/agent/assets':['genesis_save_asset',validateAsset]};
    const selected=operations[path];if(!selected)return json({error:'接口不存在。'},{status:404});const error=selected[1](body);if(error)return json({error},{status:400});
    const result=await mutate(env.DB,{key:idempotencyKey(request),operation:selected[0],hash:parsed.hash,resourceType:'agent'},store=>saveAgent(store,selected[0],body));
    return json(result,{status:result.created?201:200});
  }
  if (path === "/api/genesis/agent/projects") { const error = validateProject(body); return error ? json({ error }, { status: 400 }) : saveProject(request, env, body, parsed.hash); }
  if (path === "/api/genesis/agent/growth-records") { const error = validateGrowth(body); return error ? json({ error }, { status: 400 }) : saveGrowth(request, env, body, parsed.hash); }
  if (path === "/api/genesis/agent/assets") { const error = validateAsset(body); return error ? json({ error }, { status: 400 }) : saveAsset(request, env, body, parsed.hash); }
  return json({ error: "Not found" }, { status: 404 });
}

export default {
  async fetch(request, env) {
    const path = pathOf(request);
    try {
      if (!originAllowed(request, env) && path.startsWith('/api/')) return json({ error: '不允许此来源的跨域请求。' }, { status: 403 });
      if (request.method === 'OPTIONS' && path.startsWith('/api/genesis/')) {
        const origin = request.headers.get('Origin');
        return new Response(null, { status: 204, headers: {
          ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key'
        }});
      }
      if (path === '/api/setup/status' && request.method === 'GET') {
        if (!ownerSetupEnabled(env)) return json({ setupRequired:false });
        const record=await ownerRecord(env);
        return json({setupRequired:!record,protectedSetup:true,setupAuthorized:!record&&await validSetupToken(request,env),minLength:12});
      }
      if (path === '/api/setup' && request.method === 'POST') {
        if (!ownerSetupEnabled(env)) return json({error:'当前环境未开放首次设置。'},{status:404});
        if (request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.get('Origin')&&request.headers.get('Origin')!==new URL(request.url).origin) return json({error:'不允许跨站设置密码。'},{status:403});
        if (await ownerRecord(env)) return json({error:'密码已经设置，初始化入口已关闭。'},{status:409});
        if (!(await validSetupToken(request,env))) return json({error:'请使用你的专属初始化链接，链接可能已过期。'},{status:403});
        if(env.GENESIS_LOGIN_LIMITER){const limit=await env.GENESIS_LOGIN_LIMITER.limit({key:'setup:'+await sha256(request.headers.get('CF-Connecting-IP')||'unknown')});if(!limit.success)return json({error:'设置尝试过于频繁，请稍后重试。'},{status:429});}
        const parsed=await readBody(request);if(parsed.error)return json({error:parsed.error},{status:400});
        const error=passwordError(parsed.body.password);if(error)return json({error},{status:400});
        if(!(await initializeOwner(env,parsed.body.password)))return json({error:'密码已在另一窗口设置，请直接登录。'},{status:409});
        return json({success:true},{headers:{'Set-Cookie':sessionCookie(await createSession(await sessionSecret(env)))}});
      }
      if (path === '/api/login' && request.method === 'POST') {
        if (!env.GENESIS_VIEW_PASSWORD) return json({ error: '网页查看密码尚未配置。' }, { status: 503 });
        if(env.GENESIS_LOGIN_LIMITER){const limited=await env.GENESIS_LOGIN_LIMITER.limit({key:'login:'+await sha256(request.headers.get('CF-Connecting-IP')||'unknown')});if(!limited.success)return json({error:'登录尝试过于频繁，请稍后重试。'},{status:429,headers:{'Retry-After':'60'}});}
        const parsed = await readBody(request);
        if (parsed.error) return json({ error: parsed.error }, { status: 400 });
        const password = parsed.body.password;
        const record=ownerSetupEnabled(env)?await ownerRecord(env):null;
        if(ownerSetupEnabled(env)&&!record)return json({error:'请先通过专属初始化链接设置你的密码。',setupRequired:true},{status:428});
        const matches=ownerSetupEnabled(env)?await verifyOwnerPassword(env,password,record):typeof password==='string'&&password.length<=256&&await sameSecret(password,env.GENESIS_VIEW_PASSWORD);
        if(!matches)return json({error:'登录密码不正确。'},{status:401});
        return json({ success: true }, { headers: { 'Set-Cookie': sessionCookie(await createSession(await sessionSecret(env))) } });
      }
      if (path === '/api/logout' && request.method === 'POST') return json({ success: true }, { headers: { 'Set-Cookie': sessionCookie('', true) } });
      if (path.startsWith('/api/genesis/')) return await handleApi(request, env);
      if (path.startsWith('/api/')) return json({ error: '此云端接口尚未开放。' }, { status: 404 });
      if (path === '/' || path === '/index.html') {
        if(ownerSetupEnabled(env)&&!(await ownerRecord(env)))return Response.redirect(new URL('/setup.html',request.url).href,302);
        if (!(await validSession(request, env))) return Response.redirect(new URL('/login.html', request.url).href, 302);
      }
      const assetRequest = path === '/' ? new Request(new URL('/index.html', request.url), request) : request;
      const response = await env.ASSETS.fetch(assetRequest);
      const headers = new Headers(response.headers);
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('Referrer-Policy', 'same-origin');
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'");
      if (path === '/sw.js') headers.set('Cache-Control', 'no-store, must-revalidate');
      else if (path === '/manifest.json') headers.set('Cache-Control', 'no-cache, must-revalidate');
      else if (path === '/offline.html') headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
      else if (headers.get('content-type')?.includes('text/html')) headers.set('Cache-Control', 'no-store');
      return new Response(response.body, { status: response.status, headers });
    }
      catch (error) {
        if(error instanceof ApiError)return json({error:error.message},{status:error.status});
        console.error(JSON.stringify({ event: "genesis_api_error", path, error_type: error?.name || "Error" }));
        return json({ error: "Genesis API unavailable." }, { status: 500 });
      }
  },
};
