const COOKIE_NAME = 'speak_buddy_guest';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;

const encodeBytes = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const encode = (value: string) => encodeBytes(new TextEncoder().encode(value));

const decode = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(normalized);
  return new Uint8Array([...binary].map((char) => char.charCodeAt(0)));
};

async function key(secret: string) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function sign(payload: string, secret: string) {
  const signature = await crypto.subtle.sign('HMAC', await key(secret), new TextEncoder().encode(payload));
  return encode(payload) + '.' + encodeBytes(new Uint8Array(signature));
}

async function verify(token: string, secret: string) {
  const [encodedPayload, encodedSignature] = token.split('.');
  if (!encodedPayload || !encodedSignature) return null;
  try {
    const payload = new TextDecoder().decode(decode(encodedPayload));
    const signature = decode(encodedSignature);
    const valid = await crypto.subtle.verify('HMAC', await key(secret), signature, new TextEncoder().encode(payload));
    if (!valid) return null;
    const parsed = JSON.parse(payload) as { id?: string; exp?: number };
    if (!parsed.id || !/^guest_[0-9a-f-]{36}$/.test(parsed.id) || !parsed.exp || parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return parsed.id;
  } catch {
    return null;
  }
}

export function getGuestCookie(request: Request) {
  return request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`))?.[1] || '';
}

export async function getGuestId(request: Request, secret?: string) {
  if (!secret) return null;
  return verify(getGuestCookie(request), secret);
}

export async function createGuestCookie(secret: string, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const id = `guest_${crypto.randomUUID()}`;
  const payload = JSON.stringify({ id, exp: Math.floor(Date.now() / 1000) + ttlSeconds });
  const token = await sign(payload, secret);
  return { id, header: `${COOKIE_NAME}=${token}; Max-Age=${ttlSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax` };
}

export const guestCookieName = COOKIE_NAME;
