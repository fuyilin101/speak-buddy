import { sessionSecret } from './owner-auth.js';
const SESSION_COOKIE = '__Host-genesis_session';
const SESSION_SECONDS = 8 * 60 * 60;

async function signature(message, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`genesis-view:${message}`));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function createSession(secret) {
  const expiry = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `${expiry}.${crypto.randomUUID()}`;
  return `${payload}.${await signature(payload, secret)}`;
}
export async function validSession(request, env) {
  if (!env.GENESIS_VIEW_PASSWORD) return false;
  const cookies = request.headers.get('Cookie') || '';
  const value = cookies.split(';').map(x => x.trim()).find(x => x.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 3 || !/^\d+$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[2])) return false;
  const expiry = Number(parts[0]);
  const seconds = Math.floor(Date.now() / 1000);
  if (expiry <= seconds || expiry > seconds + SESSION_SECONDS) return false;
  const secret = await sessionSecret(env);
  if (!secret) return false;
  const expected = await signature(`${parts[0]}.${parts[1]}`, secret);
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ parts[2].charCodeAt(i);
  return mismatch === 0;
}
export function sessionCookie(value, logout = false) {
  return `${SESSION_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${logout ? 0 : SESSION_SECONDS}`;
}
