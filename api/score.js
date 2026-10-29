// POST /api/score — submit an adventure score. Server-side only:
// X-session required, the row id is the verified X id (client ids are
// ignored entirely — nobody can post under a handle they don't own),
// rate-limits by account, writes GT-only to Upstash.

import { cors, sessionFrom } from './_lib/xsess.js';

const MAX_LEVEL = 1000; // levels cleared across BOTH campaigns (2 × 500)
const MAX_STARS = 3000; // 1000 levels × 3
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
    const level = Math.floor(Number(b.level));
    const stars = Math.floor(Number(b.stars));
    if (!(level >= 1 && level <= MAX_LEVEL && stars >= 0 && stars <= MAX_STARS))
      return res.status(400).json({ error: 'bad score' });

    const [hits] = await up(env, [
      ['INCR', `rl:${s.id}`],
      ['EXPIRE', `rl:${s.id}`, 3600, 'NX'],
    ]);
    if (Number(hits) > SUBMITS_PER_HOUR) return res.status(429).json({ error: 'slow down' });

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
