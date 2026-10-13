import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import worker from '../worker/index.js';
import { createSession, sessionCookie, validSession } from '../worker/session.js';
globalThis.crypto ??= webcrypto;
// 仅使用内存绑定验证安全边界；实际 D1 链路单独远程验收。
const env = {
  GENESIS_ENVIRONMENT: 'test',
  GENESIS_AGENT_TOKEN: 'unit-agent-token', GENESIS_VIEW_PASSWORD: 'unit-view-password',
  DB: { prepare() { return { first: async () => ({ ready: 1 }), all: async () => ({ results: [] }) }; } },
  ASSETS: { fetch: async () => new Response('测试页面', { headers: { 'content-type': 'text/html' } }) },
};
const request = (path, options) => new Request(`https://genesis.test${path}`, options);
const call = (path, options) => worker.fetch(request(path, options), env);
assert.equal((await call('/api/genesis/health')).status, 200);
for (const path of ['/api/genesis/home', '/api/genesis/dashboard', '/api/genesis/projects', '/api/genesis/growth-records', '/api/genesis/agent/projects']) {
  assert.equal((await call(path)).status, 401);
  assert.equal((await call(path, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await call(path, { headers: { Authorization: 'Bearer unit-agent-token' } })).status, 200);
}
assert.equal((await call('/')).status, 302);
const badLogin = await call('/api/login', { method: 'POST', body: JSON.stringify({ password: 'wrong' }) });
assert.equal(badLogin.status, 401);
assert.match((await badLogin.json()).error, /密码/);
const login = await call('/api/login', { method: 'POST', body: JSON.stringify({ password: env.GENESIS_VIEW_PASSWORD }) });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie');
assert.match(cookie, /Secure; HttpOnly; SameSite=Strict/);
assert.ok(!cookie.includes(env.GENESIS_AGENT_TOKEN));
const sessionHeaders = { Cookie: cookie.split(';')[0] };
assert.equal((await call('/api/genesis/dashboard', { headers: sessionHeaders })).status, 200);
const pageEnv = { ...env, ASSETS: { fetch: async (request) => {
  assert.equal(new URL(request.url).pathname, '/index.html');
  return new Response('中文首页');
} } };
assert.equal((await worker.fetch(request('/', { headers: sessionHeaders }), pageEnv)).status, 200);
// 查看会话不能写入。
assert.equal((await call('/api/genesis/agent/projects', { method: 'POST', headers: sessionHeaders, body: '{}' })).status, 401);
assert.equal((await call('/api/login', { method: 'POST', headers: { Origin: 'https://evil.test' }, body: '{}' })).status, 403);
assert.equal((await call('/api/genesis/agent/projects', { method: 'OPTIONS', headers: { Origin: 'https://evil.test' } })).status, 403);
assert.equal((await call('/api/genesis/agent/projects', { method: 'POST', headers: { Authorization: 'Bearer unit-agent-token' }, body: '{' })).status, 400);
assert.equal((await call('/api/genesis/agent/projects', { method: 'POST', headers: { Authorization: 'Bearer unit-agent-token' }, body: JSON.stringify({ name: '缺少来源' }) })).status, 400);
const invalidJson = await call('/api/genesis/agent/projects', { method: 'POST', headers: { Authorization: 'Bearer unit-agent-token' }, body: 'x'.repeat(256 * 1024 + 1) });
assert.equal(invalidJson.status, 400);
const session = await createSession(env.GENESIS_VIEW_PASSWORD);
assert.equal(await validSession(request('/', { headers: { Cookie: sessionCookie(session) } }), env), true);
assert.equal(await validSession(request('/', { headers: { Cookie: sessionCookie(session.slice(0, -1) + 'x') } }), env), false);
assert.equal((await call('/api/unknown')).status, 404);
console.log('Genesis Worker：认证、查看会话隔离、跨域、字段校验、正文限制、中文错误均通过。');
