import type { Env } from './index';
import { getGuestId } from './guestSession';

const deny = (status: number, error: string, retryAfter?: number) => new Response(JSON.stringify({ error }), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(retryAfter ? { 'retry-after': String(Math.max(1, Math.ceil(retryAfter))) } : {}) }
});
const decode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));

async function verifyAccess(request: Request, env: Env) {
  if (!env.ACCESS_ISSUER || !env.ACCESS_AUD) return false;
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || request.headers.get('cookie')?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1] || '';
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
    const seconds = Date.now() / 1000;
    if (header.alg !== 'RS256' || claims.iss !== env.ACCESS_ISSUER || !Array.isArray(claims.aud) || !claims.aud.includes(env.ACCESS_AUD) || typeof claims.exp !== 'number' || claims.exp <= seconds || claims.iat > seconds + 60 || claims.nbf > seconds || claims.email !== env.TEST_ALLOWED_EMAIL) return false;
    const response = await fetch(env.ACCESS_ISSUER + '/cdn-cgi/access/certs', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    const certs = await response.json() as { keys: (JsonWebKey & { kid: string })[] };
    const jwk = certs.keys.find(k => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  } catch { return false; }
}

async function incrementUsage(db: D1Database, key: string, minute: string, day: string, minuteLimit: number, dayLimit: number) {
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO test_usage(bucket,count) VALUES(?,0)').bind(`${key}:m:${minute}`),
    db.prepare('INSERT OR IGNORE INTO test_usage(bucket,count) VALUES(?,0)').bind(`${key}:d:${day}`)
  ]);
  const minuteRow = await db.prepare('UPDATE test_usage SET count=count+1 WHERE bucket=? AND count<? RETURNING count').bind(`${key}:m:${minute}`, minuteLimit).first<{ count: number }>();
  if (!minuteRow) return { ok: false, retry: 60 };
  const dayRow = await db.prepare('UPDATE test_usage SET count=count+1 WHERE bucket=? AND count<? RETURNING count').bind(`${key}:d:${day}`, dayLimit).first<{ count: number }>();
  if (!dayRow) return { ok: false, retry: 86400 };
  return { ok: true, minute: minuteRow.count, day: dayRow.count };
}

export async function protectTest(request: Request, env: Env): Promise<Request | Response> {
  if (env.TEST_LOCKDOWN !== 'true') return request;
  if (!env.DB) return deny(503, '测试访问保护尚未配置完成');
  const url = new URL(request.url);
  let ownerId: string | null = null;
  if (env.PUBLIC_GUEST_MODE === 'true') {
    if (request.method === 'GET' && !url.pathname.startsWith('/api/')) return request;
    if (url.pathname === '/api/session' && request.method === 'GET') return new Request(url, request);
    if (!env.GUEST_SESSION_SECRET) return deny(503, '访客会话尚未配置完成');
    ownerId = await getGuestId(request, env.GUEST_SESSION_SECRET);
    if (!ownerId) return deny(401, '访客会话已失效，请刷新页面重试');
  } else {
    if (!env.ACCESS_ISSUER || !env.ACCESS_AUD) return deny(503, '测试访问保护尚未配置完成');
    if (!await verifyAccess(request, env)) return deny(401, '请先通过 Cloudflare Access 登录');
    ownerId = 'test-owner-2270110783-qq-com';
  }
  if (url.pathname.startsWith('/api/') && request.method === 'POST') {
    if (Number(request.headers.get('content-length') || 0) > 8000000) return deny(413, '请求过大');
    const now = new Date();
    const minute = now.toISOString().slice(0, 16);
    const day = minute.slice(0, 10);
    const perVisitor = await incrementUsage(env.DB, env.PUBLIC_GUEST_MODE === 'true' ? ownerId : 'access-test', minute, day, 40, 400);
    if (!perVisitor.ok) return deny(429, perVisitor.retry === 86400 ? '今日测试额度已用完，请明天再试' : '本分钟测试请求已达40次，请稍后重试', perVisitor.retry);
    const global = await incrementUsage(env.DB, 'global-test', minute, day, 400, 4000);
    if (!global.ok) return deny(429, global.retry === 86400 ? '测试服务今日总额度已用完，请明天再试' : '测试服务暂时繁忙，请稍后重试', global.retry);
    console.log(JSON.stringify({ event: 'test_usage', path: url.pathname, subject: env.PUBLIC_GUEST_MODE === 'true' ? 'guest' : 'access', minute_count: perVisitor.minute, day_count: perVisitor.day }));
  }
  url.searchParams.set('userId', ownerId);
  if (request.method === 'POST' && ['/api/profile', '/api/chat', '/api/chat/stream', '/api/learning', '/api/review', '/api/practice'].includes(url.pathname)) {
    const body = await request.json() as Record<string, unknown>;
    body.userId = ownerId;
    return new Request(url, { method: request.method, headers: request.headers, body: JSON.stringify(body), signal: request.signal });
  }
  return new Request(url, request);
}

