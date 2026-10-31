// Shared leaderboard — the game server now reads and writes the SAME
// Upstash `board` ZSET / `names` hash as api/score.js + the worker.
// One store, many writers. No more leaderboard.json on an ephemeral disk.
//
// Auth mirrors api/score.js: POST requires the X session blob
// (verified locally with SESSION_SECRET, same signature as tickets);
// the row id is x_<session id> — body-supplied ids are ignored.
// GET stays open ({top, me?}) — boards are public reads.
//
// Dev fallbacks, matching xticket.ts conventions: no SESSION_SECRET →
// body id accepted (local dev). No UPSTASH env → an in-memory board so
// `npm run dev` still shows a table; nothing pretends to persist.

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface BoardRow {
  rank?: number;
  name: string;
  level: number;
  stars: number;
}

const MAX_LEVEL = 1000;
const MAX_STARS = 3000;
const pack = (level: number, stars: number) => level * 2000 + Math.min(stars, 1999);
const unpack = (score: number) => ({
  level: Math.floor(score / 2000),
  stars: score % 2000,
});
const cleanName = (n: unknown) =>
  String(n ?? 'runner')
    .slice(0, 16)
    .replace(/[^\w \-!'áéíóúñ]/gi, '')
    .trim() || 'runner';

// ---------- session verify (v1.payload.sig, SESSION_SECRET) ----------

function secret(): string | null {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') return null;
  return 'icenwater-dev-secret';
}

function verifySession(tok: unknown): { id: string } | null {
  if (!process.env.SESSION_SECRET && process.env.NODE_ENV !== 'production')
    return { id: 'dev' }; // dev pass — matches xticket.ts
  const s = secret();
  if (!s || typeof tok !== 'string' || !tok.startsWith('v1.')) return null;
  const dot = tok.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = tok.slice(3, dot);
  const a = Buffer.from(tok.slice(dot + 1));
  const b = Buffer.from(
    createHmac('sha256', s).update(payload).digest('base64url'),
  );
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof p.id !== 'string' || typeof p.exp !== 'number') return null;
    if (p.exp * 1000 < Date.now()) return null;
    return { id: p.id };
  } catch {
    return null;
  }
}

const bearer = (auth: string | undefined) =>
  auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';

// ---------- stores ----------

interface Store {
  readTop(meId?: string): Promise<{ top: BoardRow[]; me: BoardRow | null }>;
  writeScore(id: string, name: string, level: number, stars: number): Promise<BoardRow>;
}

async function up(cmds: unknown[][]): Promise<unknown[]> {
  const res = await fetch(`${process.env.UPSTASH_REST_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  return (await res.json()).map((r: { result: unknown }) => r.result);
}

const redisStore: Store = {
  async readTop(meId) {
    const cmds: unknown[][] = [
      ['ZREVRANGE', 'board', 0, 49, 'WITHSCORES'],
      ['HGETALL', 'names'],
    ];
    if (meId) cmds.push(['ZREVRANK', 'board', meId], ['ZSCORE', 'board', meId]);
    const [flat, pairs, rank, score] = await up(cmds);
    const names = new Map<string, string>();
    const arr = (pairs as string[]) ?? [];
    for (let i = 0; i + 1 < arr.length; i += 2) names.set(arr[i], arr[i + 1]);
    const rows = (flat as string[]) ?? [];
    const top: BoardRow[] = [];
    for (let i = 0; i + 1 < rows.length; i += 2) {
      const { level, stars } = unpack(Number(rows[i + 1]));
      top.push({
        rank: top.length + 1,
        name: names.get(rows[i]) ?? 'runner',
        level,
        stars,
      });
    }
    let me: BoardRow | null = null;
    if (meId && rank != null && score != null) {
      const { level, stars } = unpack(Number(score));
      me = { rank: Number(rank) + 1, name: names.get(meId) ?? 'you', level, stars };
    }
    return { top, me };
  },
  async writeScore(id, name, level, stars) {
    const [wrote, , rank] = await up([
      ['ZADD', 'board', 'GT', pack(level, stars), id],
      ['HSET', 'names', id, name],
      ['ZREVRANK', 'board', id],
    ]);
    return {
      rank: rank == null ? undefined : Number(rank) + 1,
      name,
      level,
      stars,
      ...(Number(wrote) === 0 ? {} : {}),
    };
  },
};

// in-memory dev board — no disk, no pretense of persistence
const mem = new Map<string, { name: string; level: number; stars: number }>();
const memRanked = () =>
  [...mem.entries()].sort(
    (a, b) => pack(b[1].level, b[1].stars) - pack(a[1].level, a[1].stars),
  );
const memStore: Store = {
  async readTop(meId) {
    const top = memRanked()
      .slice(0, 50)
      .map(([id, e], i) => ({ rank: i + 1, name: e.name, level: e.level, stars: e.stars }));
    let me: BoardRow | null = null;
    if (meId && mem.has(meId)) {
      const idx = memRanked().findIndex(([id]) => id === meId);
      const e = mem.get(meId)!;
      me = { rank: idx + 1, name: e.name, level: e.level, stars: e.stars };
    }
    return { top, me };
  },
  async writeScore(id, name, level, stars) {
    const prev = mem.get(id);
    if (prev && pack(prev.level, prev.stars) >= pack(level, stars)) {
      const idx = memRanked().findIndex(([i]) => i === id);
      return { rank: idx + 1, name: prev.name, level: prev.level, stars: prev.stars };
    }
    mem.set(id, { name, level, stars });
    const idx = memRanked().findIndex(([i]) => i === id);
    return { rank: idx + 1, name, level, stars };
  },
};

const useRedis = !!(process.env.UPSTASH_REST_URL && process.env.UPSTASH_REST_TOKEN);
const store: Store = useRedis ? redisStore : memStore;
if (!useRedis)
  console.warn('[leaderboard] UPSTASH_REST_* unset — in-memory board only (dev)');

// ---------- handlers ----------

export async function getBoard(meId: string | null) {
  return store.readTop(meId ?? undefined);
}

/** score derives from the stored `prog:` record — the client claims a
    name, never a number. dev-mode (no UPSTASH) can't read the record,
    so it accepts body values: dev is already wide-open by convention. */
export async function postScore(
  auth: string | undefined,
  body: Record<string, unknown>,
): Promise<{ code: number; out: unknown }> {
  const sess = verifySession(bearer(auth));
  if (!sess) return { code: 401, out: { error: 'connect x first' } };
  const id = `x_${sess.id}`; // verified session, never the body's claim
  const name = cleanName(body.name);

  let level: number;
  let stars: number;
  if (useRedis) {
    const [raw] = await up([['GET', `prog:x_${sess.id}`]]);
    const prog = raw ? (JSON.parse(raw as string) as { unlocked?: number; stars?: Record<string, number> }) : null;
    level = prog ? Math.max(0, (prog.unlocked ?? 1) - 1) : 0;
    stars = prog
      ? Object.values(prog.stars ?? {}).reduce((a, v) => a + (Number(v) || 0), 0)
      : 0;
    if (level < 1)
      return { code: 400, out: { error: 'no road on record — clear a level first' } };
  } else {
    level = Math.floor(Number(body.level));
    stars = Math.floor(Number(body.stars));
    if (!(level >= 1 && level <= MAX_LEVEL && stars >= 0 && stars <= MAX_STARS))
      return { code: 400, out: { error: 'bad score' } };
  }

  const row = await store.writeScore(id, name, level, stars);
  return { code: 200, out: { rank: row.rank ?? null, updated: true, ...row } };
}
