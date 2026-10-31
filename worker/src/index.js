// Ice 'N' Water — leaderboard proxy (Cloudflare Worker, free tier).
// The game never sees Upstash credentials: this worker holds them,
// validates every score, rate-limits by IP, and writes GT-only.

const SUBMITS_PER_HOUR = 30; // generous — real clients post ~1 per level win

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const json = (body, code = 200) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'Content-Type': 'application/json', ...cors },
  });

/** batch of Redis commands → array of results */
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
const unpack = (v) => ({ level: Math.floor(v / 2000), stars: Math.round(v % 2000) });

const cleanName = (n) =>
  String(n ?? 'runner')
    .slice(0, 16)
    .replace(/[^\w \-!'áéíóúñ]/gi, '')
    .trim() || 'runner';

// ---------- session verify (v1.payload.sig, SESSION_SECRET) ----------
// same blob as api/_lib/xsess.js — verified here with WebCrypto since
// node:crypto doesn't exist in the worker runtime.

const te = new TextEncoder();
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function sessionId(req, env) {
  const h = req.headers.get('Authorization') ?? '';
  const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!env.SESSION_SECRET || !tok.startsWith('v1.')) return null;
  const dot = tok.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = tok.slice(3, dot);
  const key = await crypto.subtle.importKey(
    'raw',
    te.encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = b64url(await crypto.subtle.sign('HMAC', key, te.encode(payload)));
  const got = tok.slice(dot + 1);
  // constant-time-ish compare — workers lack timingSafeEqual
  if (sig.length !== got.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ got.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const s = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof s.id !== 'string' || typeof s.exp !== 'number') return null;
    if (s.exp * 1000 < Date.now()) return null;
    return s.id;
  } catch {
    return null;
  }
}

async function handleScore(req, env) {
  const ip = req.headers.get('cf-connecting-ip') ?? 'anon';
  const sid = await sessionId(req, env);
  if (!sid) return json({ error: 'connect x first' }, 401);
  const id = `x_${sid}`; // verified session, never the body's claim

  let b;
  try {
    b = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const name = cleanName(b.name);

  // hourly cap per IP — INCR + first hit sets the window
  const [hits] = await up(env, [
    ['INCR', `rl:${ip}`],
    ['EXPIRE', `rl:${ip}`, 3600, 'NX'],
  ]);
  if (Number(hits) > SUBMITS_PER_HOUR) return json({ error: 'slow down' }, 429);

  // the board mirrors the verified road — level/stars come from the
  // stored progress record, not the request body
  const [raw] = await up(env, [['GET', `prog:x_${sid}`]]);
  const prog = raw ? JSON.parse(raw) : null;
  const level = prog ? Math.max(0, (prog.unlocked ?? 1) - 1) : 0;
  const stars = prog
    ? Object.values(prog.stars ?? {}).reduce((a, v) => a + (Number(v) || 0), 0)
    : 0;
  if (level < 1) return json({ error: 'no road on record — clear a level first' }, 400);

  const score = pack(level, stars);
  const [wrote, , rank] = await up(env, [
    ['ZADD', 'board', 'GT', score, id],
    ['HSET', 'names', id, name],
    ['ZREVRANK', 'board', id],
  ]);
  return json({
    rank: rank == null ? null : Number(rank) + 1,
    updated: Number(wrote) === 1,
    name,
    level,
    stars,
  });
}

async function handleBoard(url, env) {
  const me = url.searchParams.get('me') ?? '';
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
  return json({ top, me: meOut });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === '/score' && req.method === 'POST') return await handleScore(req, env);
      if (url.pathname === '/board' && req.method === 'GET') return await handleBoard(url, env);
      if (url.pathname === '/health') return json({ ok: true });
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e?.message ?? e) }, 500);
    }
  },
};
