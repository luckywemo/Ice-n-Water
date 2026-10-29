// GET /api/board — top 50 runners + the caller's rank. Session-gated;
// `me` comes from the verified token, not the query — a hand-typed id
// can't probe another runner's rank.

import { cors, sessionFrom } from './_lib/xsess.js';

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

const unpack = (v) => ({ level: Math.floor(v / 2000), stars: Math.round(v % 2000) });

export default async function handler(req, res) {
  cors(res, 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'get only' });

  const s = sessionFrom(req);
  if (!s) return res.status(401).json({ error: 'connect x first' });

  try {
    const env = process.env;
    const me = `x_${s.id}`;
    const cmds = [
      ['ZREVRANGE', 'board', 0, 49, 'WITHSCORES'],
      ['HGETALL', 'names'],
    ];
    if (me) cmds.push(['ZREVRANK', 'board', me], ['ZSCORE', 'board', me]);
    const results = await up(env, cmds);
    const flat = results[0] ?? [];
    const namePairs = results[1] ?? [];
    const names = new Map();
    for (let i = 0; i + 1 < namePairs.length; i += 2) names.set(namePairs[i], namePairs[i + 1]);

    const top = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const { level, stars } = unpack(Number(flat[i + 1]));
      top.push({ rank: top.length + 1, name: names.get(flat[i]) ?? 'runner', level, stars });
    }

    let meOut = null;
    if (me) {
      const rank = results[2];
      const score = results[3];
      if (rank != null && score != null) {
        const { level, stars } = unpack(Number(score));
        meOut = { rank: Number(rank) + 1, name: names.get(me) ?? 'you', level, stars };
      }
    }
    return res.status(200).json({ top, me: meOut });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message ?? e) });
  }
}
