// GET|POST /api/profile — the player's portable identity.
// Collapses the small scattered localStorage keys into one record per
// verified X id: display name, character pick, lifetime stats, synced
// settings, seen-flags. Progress stays on /api/progress — it's the big
// per-level map; this stays small and hot.
//
// Merge semantics are per-field, not max-everything:
//   name / char / picks   → last POST wins (preferences)
//   stats                 → EVENT-DERIVED, never claimed. body.statsEvents
//                           is a journal of match results — [{won, s}]
//                           applied in order (recordResult server-side:
//                           streaks reset on loss, updatedAt is server
//                           time). A forged event reports at most one
//                           fake match outcome, never fake totals.
//   advSeen / hintSeen    → max (seen-up-to markers)
// A POST also refreshes `names` on the board hash, so a rename shows
// on the leaderboard without waiting for the next win.
import { cors, sessionFrom, kv } from './_lib/xsess.js';

const SAVES_PER_HOUR = 120;
const MAX_EVENTS = 200; // a full offline journal fits one POST
const DIFFS = new Set(['easy', 'normal', 'hard']);

/** server-side recordResult — the only writer of streak math. */
const applyEvent = (stats, ev) => {
  const s = { games: 0, wins: 0, streak: 0, bestStreak: 0, bestSurvived: 0, ...stats };
  s.games++;
  s.bestSurvived = Math.max(s.bestSurvived, ev.s);
  if (ev.won) {
    s.wins++;
    s.streak++;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
  } else {
    s.streak = 0;
  }
  s.updatedAt = Date.now(); // server time — client clocks don't count
  return s;
};

const int = (v, lo, hi) => {
  const n = Math.floor(Number(v));
  return n >= lo && n <= hi ? n : null;
};

const cleanName = (n) =>
  String(n ?? '')
    .slice(0, 16)
    .replace(/[^\w \-!'áéíóúñ]/gi, '')
    .trim()
    .slice(0, 10) || null; // runner names cap at 10 — see leaderboard.ts

/** scrub a client blob into a legal Profile */
export function clean(p) {
  const out = {};
  const name = cleanName(p?.name);
  if (name) out.name = name;
  if (p?.char && typeof p.char === 'object') {
    const id = String(p.char.id ?? '');
    if (/^[\w-]{1,32}$/.test(id)) {
      out.char = { id };
      const body = int(p.char.body, 0, 999);
      if (body !== null) out.char.body = body;
    }
  }
  // body.stats is deliberately ignored — stats are event-derived,
  // claimed aggregates can't write anything here
  if (Array.isArray(p?.statsEvents)) {
    const evs = [];
    for (const e of p.statsEvents.slice(0, MAX_EVENTS)) {
      const s = int(e?.s ?? e?.survivedSec, 0, 86400);
      if (typeof e?.won === 'boolean' && s !== null) evs.push({ won: e.won, s });
    }
    if (evs.length) out.statsEvents = evs;
  }
  if (p?.picks && typeof p.picks === 'object') {
    const picks = {};
    if (DIFFS.has(p.picks.difficulty)) picks.difficulty = p.picks.difficulty;
    if (typeof p.picks.hints === 'boolean') picks.hints = p.picks.hints;
    if (Object.keys(picks).length) out.picks = picks;
  }
  const advSeen = int(p?.advSeen, 0, 100);
  if (advSeen !== null) out.advSeen = advSeen;
  const hintSeen = int(p?.hintSeen, 0, 10);
  if (hintSeen !== null) out.hintSeen = hintSeen;
  return out;
}

export function merge(stored, incoming) {
  const out = { ...stored };
  if (incoming.name) out.name = incoming.name; // scalar — last POST wins
  if (incoming.char) out.char = incoming.char; // id+body travel together
  if (incoming.picks)
    out.picks = { ...(stored.picks ?? {}), ...incoming.picks };
  // stats events apply in journal order — server recomputes, never merges
  if (incoming.statsEvents?.length) {
    let s = stored.stats ?? {};
    for (const ev of incoming.statsEvents) s = applyEvent(s, ev);
    out.stats = s;
  }
  for (const k of ['advSeen', 'hintSeen']) {
    const v = Math.max(stored[k] ?? 0, incoming[k] ?? 0);
    if (v) out[k] = v;
  }
  return out;
}

export default async function handler(req, res) {
  cors(res, 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST')
    return res.status(405).json({ error: 'get or post only' });

  const s = sessionFrom(req);
  if (!s) return res.status(401).json({ error: 'connect x first' });

  try {
    const key = `profile:x_${s.id}`;
    const id = `x_${s.id}`;

    if (req.method === 'GET') {
      // lazy avatar backfill — every boot sync refreshes the board's pfp
      const [raw] =
        (await kv([
          ['GET', key],
          ...(s.pfp ? [['HSET', 'avatars', id, s.pfp]] : []),
        ])) ?? [];
      const profile = raw?.result ? JSON.parse(raw.result) : {};
      return res.status(200).json({ profile, synced: !!raw?.result });
    }

    const incoming = clean(req.body ?? {});
    const [hits] =
      (await kv([
        ['INCR', `rl:profile:${s.id}`],
        ['EXPIRE', `rl:profile:${s.id}`, 3600, 'NX'],
      ])) ?? [];
    if (Number(hits?.result) > SAVES_PER_HOUR)
      return res.status(429).json({ error: 'slow down' });

    const [raw] = (await kv([['GET', key]])) ?? [];
    const stored = raw?.result ? JSON.parse(raw.result) : {};
    const merged = merge(stored, incoming);

    const cmds = [['SET', key, JSON.stringify(merged)]];
    if (merged.name) cmds.push(['HSET', 'names', id, merged.name]); // board stays fresh
    if (s.pfp) cmds.push(['HSET', 'avatars', id, s.pfp]);
    await kv(cmds);
    return res.status(200).json({ profile: merged });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message ?? e) });
  }
}
