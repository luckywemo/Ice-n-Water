// GET /api/me — who is connected. The client calls this once at boot
// to refresh identity (handle may have changed since the token was
// minted is fine — the token IS the proof; this endpoint exists so the
// UI can render the verified handle + avatar without decoding itself).
import { cors, sessionFrom } from './_lib/xsess.js';

export default async function handler(req, res) {
  cors(res, 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'get only' });
  const s = sessionFrom(req);
  if (!s) return res.status(401).json({ error: 'connect x first' });
  return res.status(200).json({
    x: { id: s.id, handle: s.handle, pfp: s.pfp ?? null },
    exp: s.exp,
  });
}
