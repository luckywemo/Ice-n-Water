// X session core — shared by every api function. The game is a static
// bundle (itch iframe, vercel, wherever), so third-party cookies are
// dead to it: instead of a cookie session we mint an HMAC-signed bearer
// token the client stores and sends as `Authorization: Bearer <tok>`.
//
//   token  = "v1.<b64url(payload)>.<b64url(hmac-sha256 payload)>"
//   payload = { id, handle, pfp, createdAt, tweets, iat, exp }
//
// The same signature signs colyseus room tickets (api/ticket.js) which
// the game server verifies with the shared SESSION_SECRET.
import { createHmac, timingSafeEqual, randomBytes, createHash } from 'node:crypto';

const MAX_AGE_S = 60 * 60 * 24 * 30; // session lives 30d

export function secret() {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET is required in production');
  }
  return 'icenwater-dev-secret'; // dev only — never ships
}

const sign = (payload) =>
  createHmac('sha256', secret()).update(payload).digest('base64url');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const unb64 = (s) => JSON.parse(Buffer.from(s, 'base64url').toString());

export function signPayload(obj) {
  const payload = b64(obj);
  return `v1.${payload}.${sign(payload)}`;
}

export function issueToken(session) {
  const now = Math.floor(Date.now() / 1000);
  return signPayload({ ...session, iat: now, exp: now + MAX_AGE_S });
}

/** verify a "v1.payload.sig" blob (session token or room ticket).
    Returns the payload or null — expired counts as invalid. */
export function verifyBlob(tok) {
  if (typeof tok !== 'string' || !tok.startsWith('v1.')) return null;
  const dot = tok.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = tok.slice(3, dot);
  const a = Buffer.from(tok.slice(dot + 1));
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = unb64(payload);
    if (typeof s.id !== 'string' || typeof s.exp !== 'number') return null;
    if (s.exp * 1000 < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

/** Authorization: Bearer <tok> → session payload | null */
export function sessionFrom(req) {
  const h = req.headers?.authorization ?? '';
  const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  return verifyBlob(tok);
}

// ---------- tiny shared plumbing ----------

export function cors(res, methods = 'GET,POST,OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export const proto = (req) =>
  (req.headers['x-forwarded-proto'] ?? 'https').split(',')[0].trim();
export const origin = (req) => `${proto(req)}://${req.headers.host}`;

export function setCookie(res, name, value, maxAge, secure) {
  res.setHeader(
    'Set-Cookie',
    `${name}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}` +
      (secure ? '; Secure' : ''),
  );
}
export function readCookie(req, name) {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}
export const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};
export const rand = (n = 16) => randomBytes(n).toString('base64url');

/** postMessage targets must be the game's own origin — a hand-typed
    opener would otherwise receive the token. X_ALLOWED_ORIGINS adds
    deploys (comma-separated); localhost is always allowed in dev. */
export function safeNext(raw, selfOrigin) {
  try {
    const u = new URL(raw);
    const list = (process.env.X_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u.origin);
    const built = /\.itch\.zone$|\.itch\.io$/.test(u.hostname);
    if (u.origin === selfOrigin || local || built || list.includes(u.origin)) {
      return u.toString();
    }
  } catch {}
  return '';
}
