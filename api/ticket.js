// GET /api/ticket — trade a session for a short-lived room ticket.
// The game server can't read this api's cookies or the client's
// localStorage, so the client posts this signed blob in its colyseus
// join options; GameRoom.onAuth verifies it with the shared
// SESSION_SECRET. 90 seconds covers join retries without being
// replayable for long.
import { cors, sessionFrom, signPayload } from './_lib/xsess.js';

export default async function handler(req, res) {
  cors(res, 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'get only' });
  const s = sessionFrom(req);
  if (!s) return res.status(401).json({ error: 'connect x first' });
  const exp = Math.floor(Date.now() / 1000) + 90;
  return res.status(200).json({
    ticket: signPayload({ id: s.id, h: s.handle, iat: exp - 90, exp }),
    exp,
  });
}
