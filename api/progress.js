// GET|POST /api/progress — the road lives server-side now.
// X-session required; the row key is the verified X id, never a client
// claim. Storage mirrors localStorage's `icenwater_adventure` shape:
//   { unlocked: <highest playable level>, stars: { <level>: 1|2|3 } }
//
// GET  → { progress }
// POST → EVENTS, not state claims. The client reports what it cleared,
//        the server computes the road:
//          { clearedLevel: 12, stars: 3 }        — single clear
//          { events: [{level, stars}, ...] }     — batch (gap replay)
//        Legacy {unlocked, stars:{...}} blobs are normalized into the
//        same pipeline — each stars[k] becomes a "cleared k" event.
//
// Anti-tamper bound: an event only lands when `level <= unlocked`
// (you can't clear a level the road hasn't reached), and each applied
// event advances unlocked by exactly one. A forged body can never
// jump the frontier — worst case it re-reports a clear for a level
// the server already believes.
import { cors, sessionFrom, kv } from './_lib/xsess.js';

const MAX_LEVEL = 1000; // both campaigns (2 × 500) — headroom like score.js
const SAVES_PER_HOUR = 240;
const MAX_EVENTS = 600; // a full-road replay fits in one batch
// frontier throttle — a token bucket on advances. Events are unverifiable
// by nature, so contiguity alone can't be the bound: without this a single
// forged batch {1..500} mints a maxed road. One credit per MS_PER_LEVEL,
// BURST banked — real play never touches it (a level takes a minute+,
// refills every 30s; an offline grinder's replay spends a banked bucket),
// a script stalls to ~4 days for a fake road and lights up the audit trail.
const MS_PER_LEVEL = 30_000;
const BURST = 8;

const int = (v, lo, hi) => {
  const n = Math.floor(Number(v));
  return n >= lo && n <= hi ? n : null;
};

/** normalize any accepted body shape into [{level, stars}, ...] */
function eventsFrom(body) {
  const out = [];
  const push = (level, stars) => {
    const l = int(level, 1, MAX_LEVEL);
    const s = int(stars, 1, 3);
    if (l !== null && s !== null) out.push({ level: l, stars: s });
  };
  if (Array.isArray(body?.events)) {
    for (const e of body.events.slice(0, MAX_EVENTS)) push(e?.level, e?.stars);
  }
  if (body?.clearedLevel !== undefined) push(body.clearedLevel, body.stars);
  // legacy blob: every stars[k] is a "cleared k" event; the bare
  // `unlocked` claim is ignored — the frontier only moves on clears
  const sm = body?.stars;
  if (sm && typeof sm === 'object' && !Array.isArray(sm))
    for (const [k, v] of Object.entries(sm)) push(k, v);
  // dedupe to best-stars-per-level, sort so sequential clears apply in order
  const best = new Map();
  for (const e of out) best.set(e.level, Math.max(best.get(e.level) ?? 0, e.stars));
  return [...best.entries()]
    .map(([level, stars]) => ({ level, stars }))
    .sort((a, b) => a.level - b.level);
}

export default async function handler(req, res) {
  cors(res, 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST')
    return res.status(405).json({ error: 'get or post only' });

  const s = sessionFrom(req);
  if (!s) return res.status(401).json({ error: 'connect x first' });

  try {
    const key = `prog:x_${s.id}`;

    if (req.method === 'GET') {
      const [raw] = (await kv([['GET', key]])) ?? [];
      const stored = raw?.result ? JSON.parse(raw.result) : { unlocked: 1, stars: {} };
      return res.status(200).json({ progress: stored, synced: !!raw?.result });
    }

    const events = eventsFrom(req.body ?? {});
    if (!events.length)
      return res.status(400).json({ error: 'no clears reported' });

    const [hits] =
      (await kv([
        ['INCR', `rl:prog:${s.id}`],
        ['EXPIRE', `rl:prog:${s.id}`, 3600, 'NX'],
      ])) ?? [];
    if (Number(hits?.result) > SAVES_PER_HOUR)
      return res.status(429).json({ error: 'slow down' });

    const [raw] = (await kv([['GET', key]])) ?? [];
    const p = raw?.result
      ? JSON.parse(raw.result)
      : { unlocked: 1, stars: {} };
    p.unlocked = Math.min(Math.max(p.unlocked || 1, 1), MAX_LEVEL);
    p.stars = p.stars ?? {};

    // refill the frontier bucket — records created before the throttle
    // start with a full bank (the burst allowance)
    const nowMs = Date.now();
    const rateAt = typeof p.rateAt === 'number' ? p.rateAt : nowMs;
    let credit = Math.min(BURST, (typeof p.credit === 'number' ? p.credit : BURST) + (nowMs - rateAt) / MS_PER_LEVEL);
    p.rateAt = nowMs;

    // apply in level order — each clear only counts if the road reached it
    let applied = 0;
    for (const e of events) {
      if (e.level > p.unlocked) continue; // can't clear beyond the frontier
      if ((p.stars[e.level] ?? 0) >= e.stars) continue; // already had it
      const advances = e.level >= p.unlocked;
      if (advances && credit < 1) break; // throttle — no more frontier today
      p.stars[e.level] = e.stars;
      applied++;
      if (advances && p.unlocked < MAX_LEVEL) {
        p.unlocked = e.level + 1;
        credit--;
      }
    }
    p.credit = Math.max(0, credit);
    if (applied > 0) await kv([['SET', key, JSON.stringify(p)]]);
    return res.status(200).json({ progress: p, applied });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message ?? e) });
  }
}
