// GET /api/auth/poll?sid=<uuid> — the device-flow redeem. The game gate
// generates the sid, polls here while the OAuth dance runs in whatever
// browser context it got handed (installed PWA custom tabs have no
// window.opener, so postMessage can't reach them). The callback parks
// the session under xhs:<sid>; whoever asks first takes it — GETDEL is
// single-redemption, and the key dies in 5min either way. The sid is a
// bearer for exactly one parked session, nothing else.
import { cors, kv } from '../_lib/xsess.js';

export default async function handler(req, res) {
  cors(res, 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method' });
  const sid = String(req.query?.sid ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sid))
    return res.status(400).json({ error: 'bad sid' });
  try {
    const out = await kv([['GETDEL', `xhs:${sid}`]]);
    if (out === null) return res.status(503).json({ error: 'store not configured' });
    const token = out?.[0]?.result;
    if (!token) return res.status(204).end(); // parked nothing yet — keep polling
    return res.status(200).json({ token });
  } catch (e) {
    console.error('[x-auth] poll failed:', e);
    return res.status(503).json({ error: 'store unavailable' });
  }
}
