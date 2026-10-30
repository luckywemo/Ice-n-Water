import { createHmac, timingSafeEqual } from 'node:crypto';

// Room tickets — minted by /api/ticket on the game's api deployment,
// verified here with the shared SESSION_SECRET. The game server sits
// on a different origin and can never see the api's cookies or the
// client's token store, so the ticket is the proof an X session exists.
//
//   ticket = "v1.<b64url(payload)>.<b64url(hmac-sha256 payload)>"
//   payload = { id: x-account-id, h: handle, iat, exp } (90s ttl)

export interface Ticket {
  id: string;
  h: string;
}

function secret(): string | null {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') return null; // fail closed
  return 'icenwater-dev-secret'; // matches api/_lib/xsess.js dev value
}

/** null = invalid or expired. When no SESSION_SECRET exists at all in
    dev, EVERY ticket is accepted ({id:'dev',h:'dev'}) so local rooms
    work before the api deployment is configured. */
export function verifyTicket(tok: unknown): Ticket | null {
  const s = secret();
  if (!s) return null; // prod without a secret rejects everyone
  if (!process.env.SESSION_SECRET) return { id: 'dev', h: 'dev' }; // dev pass
  if (typeof tok !== 'string' || !tok.startsWith('v1.')) return null;
  const dot = tok.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = tok.slice(3, dot);
  const a = Buffer.from(tok.slice(dot + 1));
  const b = Buffer.from(createHmac('sha256', s).update(payload).digest('base64url'));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof p.id !== 'string' || typeof p.exp !== 'number') return null;
    if (p.exp * 1000 < Date.now()) return null;
    return { id: p.id, h: typeof p.h === 'string' ? p.h : '' };
  } catch {
    return null;
  }
}
