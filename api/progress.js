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
// Attestation: frontier advances want a RUN TICKET — POST {start:N}
// mints a signed {id,lvl,t0,exp} only while N <= unlocked. A clear's
// ticket must verify, match the level, and prove real elapsed time
// (now - t0 >= MIN_CLEAR_MS — every campaign level runs a >=45s clock,
// so no legit win is faster). Forged clears can't be attested: the
// client can't mint tickets, and a real one forces ~a level's worth of
// wall-clock per advance plus a daily frontier cap — a fake road costs
// a week of conspicuous scripted traffic, not one request.
// Unticketed clears (fully-offline play) get a small daily slot so
// honest progress still syncs without reopening the hole.
import { cors, sessionFrom, kv, signPayload, verifyBlob } from './_lib/xsess.js';

const MAX_LEVEL = 1000; // both campaigns (2 × 500) — headroom like score.js
const SAVES_PER_HOUR = 240;
const MAX_EVENTS = 600; // a full-road replay fits in one batch
const MIN_CLEAR_MS = 35_000; // < every level's real clock (45s min)
const TICKET_TTL_S = 48 * 3600; // covers long-offline runs
const DAY_CAP = 80; // frontier advances/day — past real play (a level takes ~a minute+)
const TKLESS_CAP = 5; // unticketed advances/day — offline grace, not a road
// token bucket on advances — second layer under the ticket/day bounds.
const MS_PER_LEVEL = 30_000;
const BURST = 8;

const int = (v, lo, hi) => {
  const n = Math.floor(Number(v));
  return n >= lo && n <= hi ? n : null;
};

/** normalize any accepted body shape into [{level, stars, ticket?}, ...] */
function eventsFrom(body) {
  const out = [];
  const push = (level, stars, ticket) => {
    const l = int(level, 1, MAX_LEVEL);
    const s = int(stars, 1, 3);
    if (l !== null && s !== null)
      out.push({
        level: l,
        stars: s,
        ticket: typeof ticket === 'string' ? ticket.slice(0, 600) : undefined,
      });
  };
  if (Array.isArray(body?.events)) {
    for (const e of body.events.slice(0, MAX_EVENTS))
      push(e?.level, e?.stars, e?.ticket);
  }
  if (body?.clearedLevel !== undefined)
    push(body.clearedLevel, body.stars, body.ticket);
  // legacy blob: every stars[k] is a "cleared k" event; the bare
  // `unlocked` claim is ignored — the frontier only moves on clears
  const sm = body?.stars;
  if (sm && typeof sm === 'object' && !Array.isArray(sm))
    for (const [k, v] of Object.entries(sm)) push(k, v);
  // dedupe to best-stars-per-level, sort so sequential clears apply in order
  const best = new Map();
  for (const e of out) {
    const cur = best.get(e.level);
    // best stars wins; on a stars tie prefer the entry carrying a ticket
    if (!cur || e.stars > cur.stars || (e.stars === cur.stars && e.ticket && !cur.ticket))
      best.set(e.level, e);
  }
  return [...best.values()].sort((a, b) => a.level - b.level);
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

    // run-ticket mint — proof a real attempt started. Level must be at or
    // below the stored frontier; the blob is stateless (no write needed)
    // and carries the mint time the clear's elapsed is measured against.
    if (req.body?.start !== undefined) {
      const lvl = int(req.body.start, 1, MAX_LEVEL);
      if (lvl === null) return res.status(400).json({ error: 'bad level' });
      const [raw0] = (await kv([['GET', key]])) ?? [];
      const p0 = raw0?.result ? JSON.parse(raw0.result) : { unlocked: 1 };
      // +2 headroom lets the client stock tickets for offline runs — the
      // clear still has to reach the level through the frontier anyway
      if (lvl > (p0.unlocked ?? 1) + 2)
        return res.status(403).json({ error: 'beyond the frontier' });
      const now = Date.now();
      return res.status(200).json({
        ticket: signPayload({
          id: s.id,
          lvl,
          t0: now,
          exp: Math.floor(now / 1000) + TICKET_TTL_S,
        }),
      });
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

    // day caps — reset when the UTC day rolls over
    const today = new Date(nowMs).toISOString().slice(0, 10);
    if (p.day !== today) {
      p.day = today;
      p.dayAdv = 0;
      p.dayTk = 0;
    }

    // apply in level order — each clear only counts if the road reached it
    let applied = 0;
    let denied = 0;
    for (const e of events) {
      if (e.level > p.unlocked) continue; // can't clear beyond the frontier
      if ((p.stars[e.level] ?? 0) >= e.stars) continue; // already had it
      const advances = e.level >= p.unlocked;
      if (advances) {
        if (credit < 1 || (p.dayAdv ?? 0) >= DAY_CAP) {
          denied++;
          break;
        }
        // attested = a run ticket for THIS level proving real elapsed play
        const t = e.ticket ? verifyBlob(e.ticket) : null;
        const attested =
          !!t &&
          t.id === s.id &&
          t.lvl === e.level &&
          t.t0 <= nowMs + 60_000 &&
          nowMs - t.t0 >= MIN_CLEAR_MS;
        if (!attested) {
          if ((p.dayTk ?? 0) >= TKLESS_CAP) {
            denied++;
            break;
          }
          p.dayTk = (p.dayTk ?? 0) + 1;
        }
        p.dayAdv = (p.dayAdv ?? 0) + 1;
        credit--;
      }
      p.stars[e.level] = e.stars;
      applied++;
      if (advances && p.unlocked < MAX_LEVEL) p.unlocked = e.level + 1;
    }
    p.credit = Math.max(0, credit);
    if (applied > 0) await kv([['SET', key, JSON.stringify(p)]]);
    return res.status(200).json({ progress: p, applied, denied });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message ?? e) });
  }
}
