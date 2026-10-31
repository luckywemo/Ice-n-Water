// POST /api/score — publish your board entry. Server-side only:
// X-session required, the row id is the verified X id — and now the
// SCORE is too: level/stars are derived from the stored `prog:` record,
// never read from the body. A client can claim a name, never a number.
// The only thing a forged post can write is a worse score than the road
// actually earned — and ZADD GT refuses to lower it anyway.

import { cors, sessionFrom } from './_lib/xsess.js';

const SUBMITS_PER_HOUR = 30;

async function up(env, cmds) {
  const res = await fetch(`${env.UPSTASH_REST_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.UPSTASH_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  return (await res.json()).map((r) => r.result);
}

const pack = (level, stars) => level * 2000 + Math.min(stars, 1999);
const cleanName = (n) =>
  String(n ?? 'runner')
    .slice(0, 16)
    .replace(/[^\w \-!'áéíóúñ]/gi, '')
    .trim() || 'runner';

export default async function handler(req, res) {
  cors(res, 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'post only' });

  const s = sessionFrom(req);
  if (!s) return res.status(401).json({ error: 'connect x first' });

  try {
    const env = process.env;

    const b = req.body ?? {};
    const id = `x_${s.id}`; // identity is the verified session, not the body
    const name = cleanName(b.name);

    const [hits] = await up(env, [
      ['INCR', `rl:${s.id}`],
      ['EXPIRE', `rl:${s.id}`, 3600, 'NX'],
    ]);
    if (Number(hits) > SUBMITS_PER_HOUR) return res.status(429).json({ error: 'slow down' });

    // the board mirrors the verified road — body level/stars are ignored
    const [raw] = await up(env, [['GET', `prog:x_${s.id}`]]);
    const prog = raw ? JSON.parse(raw) : null;
    const level = prog ? Math.max(0, (prog.unlocked ?? 1) - 1) : 0;
    const stars = prog
      ? Object.values(prog.stars ?? {}).reduce((a, v) => a + (Number(v) || 0), 0)
      : 0;
    if (level < 1) return res.status(400).json({ error: 'no road on record — clear a level first' });

    const score = pack(level, stars);
    const [wrote, , rank] = await up(env, [
      ['ZADD', 'board', 'GT', score, id],
      ['HSET', 'names', id, name],
      ['ZREVRANK', 'board', id],
    ]);
    return res.status(200).json({
      rank: rank == null ? null : Number(rank) + 1,
      updated: Number(wrote) === 1,
      name,
      level,
      stars,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message ?? e) });
  }
}
