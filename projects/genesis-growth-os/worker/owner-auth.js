/** 单用户认领，不开放公共抢注；现有Secret用于pepper及签名，不再是初始化后的登录密码。 */
const ITERATIONS = 100000;
const MIN_LENGTH = 12;
const enc = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = text => Uint8Array.from(text.match(/../g) || [], v => parseInt(v, 16));
export function ownerSetupEnabled(env) { return env.GENESIS_ENABLE_OWNER_SETUP === '1'; }
export async function ownerRecord(env) {
  if (!ownerSetupEnabled(env)) return null;
  return env.DB.prepare('SELECT * FROM genesis_owner_auth WHERE id=1').first();
}
async function mac(message, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}
async function verifyMac(message, signature, secret) {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, unhex(signature), enc.encode(message));
}
export async function createSetupToken(secret, lifetime = 86400) {
  const payload = `${Math.floor(Date.now()/1000)+Math.min(lifetime,86400)}.${crypto.randomUUID()}`;
  return `${payload}.${await mac('genesis-owner-setup:'+payload, secret)}`;
}
export async function validSetupToken(request, env) {
  const value = request.headers.get('X-Genesis-Setup-Token') || '';
  if (!env.GENESIS_VIEW_PASSWORD || value.length > 200) return false;
  const parts = value.split('.'), seconds = Math.floor(Date.now()/1000);
  if (parts.length !== 3 || !/^\d+$/.test(parts[0]) || !/^[a-f0-9-]{36}$/.test(parts[1])) return false;
  if (Number(parts[0]) <= seconds || Number(parts[0]) > seconds+86400) return false;
  return verifyMac('genesis-owner-setup:'+parts[0]+'.'+parts[1], parts[2], env.GENESIS_VIEW_PASSWORD);
}
async function passwordHash(password, salt, env) {
  // Worker WebCrypto迭代上限100000；Secret pepper独立于D1，防止仅数据库泄露时离线猜测。
  const peppered = await mac('genesis-owner-password:'+password, env.GENESIS_VIEW_PASSWORD);
  const key = await crypto.subtle.importKey('raw', unhex(peppered), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unhex(salt),iterations:ITERATIONS},key,256));
}
export function passwordError(password) {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) return `密码至少需要 ${MIN_LENGTH} 个字符，建议使用较长的独特口令。`;
  if (password.length > 256) return '密码不能超过 256 个字符。';
  if (!password.trim() || /^(.)\1+$/.test(password) || /^(password|123456|abcdef|qwerty)/i.test(password)) return '请使用独特口令，不要使用常见或重复密码。';
  return null;
}
export async function initializeOwner(env, password) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await passwordHash(password,salt,env);
  const result = await env.DB.prepare('INSERT OR IGNORE INTO genesis_owner_auth(id,algorithm,iterations,salt,password_hash,session_epoch,created_at) VALUES(1,?,?,?,?,?,?)')
    .bind('pbkdf2-sha256-pepper-v1',ITERATIONS,salt,hash,crypto.randomUUID(),new Date().toISOString()).run();
  return result.meta.changes === 1;
}
export async function verifyOwnerPassword(env, password, record) {
  if (!record || typeof password !== 'string' || password.length < MIN_LENGTH || password.length > 256) return false;
  if (record.algorithm !== 'pbkdf2-sha256-pepper-v1' || record.iterations !== ITERATIONS || !/^[a-f0-9]{64}$/.test(record.salt) || !/^[a-f0-9]{64}$/.test(record.password_hash)) return false;
  const actual = await passwordHash(password,record.salt,env);
  let mismatch = 0;for(let i=0;i<actual.length;i++)mismatch |= actual.charCodeAt(i)^record.password_hash.charCodeAt(i);
  return mismatch === 0;
}
export async function sessionSecret(env) {
  if (!env.GENESIS_VIEW_PASSWORD) return null;
  if (!ownerSetupEnabled(env)) return env.GENESIS_VIEW_PASSWORD;
  const record = await ownerRecord(env);
  return record ? mac('genesis-owner-session:'+record.session_epoch,env.GENESIS_VIEW_PASSWORD) : null;
}
