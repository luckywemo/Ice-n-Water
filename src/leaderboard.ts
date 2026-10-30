// Global adventure leaderboard. Modes, in preference order:
//   VITE_BOARD_URL   → our Cloudflare Worker proxy — zero secrets in the
//                      client, server-side sanity + rate limits (production)
//   VITE_UPSTASH_*   → direct Upstash Redis (token visible in the JS — dev)
//   neither          → the Colyseus server's local API (offline dev)

import { adventureProgress, totalStars } from './adventure';
import { SERVER_URL } from './net';
import { authHeaders, session } from './xauth';

const BOARD_URL = (import.meta.env.VITE_BOARD_URL as string | undefined) ?? '';
const UP_URL = (import.meta.env.VITE_UPSTASH_REST_URL as string | undefined) ?? '';
const UP_TOKEN = (import.meta.env.VITE_UPSTASH_REST_TOKEN as string | undefined) ?? '';
const USE_WORKER = BOARD_URL.startsWith('https://') || BOARD_URL.startsWith('/');
const USE_UPSTASH = !USE_WORKER && UP_URL.startsWith('https://') && UP_TOKEN.length > 10;

const SERVER_API = (() => {
  if (SERVER_URL.startsWith('wss://')) return 'https://' + SERVER_URL.slice(6);
  if (SERVER_URL.startsWith('ws://')) return 'http://' + SERVER_URL.slice(5);
  return SERVER_URL;
})();

/** worker/local-server shaped API — both speak the same {top, me} contract */
const REST_API = USE_WORKER ? BOARD_URL : SERVER_API;

const PID_KEY = 'icenwater_pid';
const NAME_KEY = 'icenwater_name';

export function playerId(): string {
  // signed-in runners are their verified X id — the api enforces the
  // same binding server-side, so a forged body can never post as you
  const x = session();
  if (x) return `x_${x.id}`;
  let id = localStorage.getItem(PID_KEY);
  if (!id) {
    id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(PID_KEY, id);
  }
  return id;
}

export function playerName(): string {
  return localStorage.getItem(NAME_KEY) || '';
}

export function setPlayerName(n: string) {
  localStorage.setItem(NAME_KEY, n.trim().slice(0, 10)); // runner names cap at 10
}

// pack progress into one sortable number: level decides, stars break ties
const pack = (level: number, stars: number) => level * 2000 + Math.min(stars, 1999);
const unpack = (v: number) => ({ level: Math.floor(v / 2000), stars: Math.round(v % 2000) });

export interface BoardRow {
  rank: number;
  name: string;
  level: number;
  stars: number;
}

export interface Board {
  top: BoardRow[];
  me: BoardRow | null;
}

/** run a batch of Redis commands — returns each command's result array */
async function upstash(cmds: (string | number)[][]): Promise<unknown[]> {
  const res = await fetch(`${UP_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmds),
    signal: AbortSignal.timeout(6000), // fail fast, never hang the UI
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  const out = (await res.json()) as { result?: unknown }[];
  return out.map((r) => r.result);
}

let lastSubmit = 0;
let lastScore = -1;

/** fire-and-forget — call after a level is cleared; only posts on a new best unless forced */
export function submitAdventureScore(force = false) {
  const prog = adventureProgress();
  const level = prog.unlocked - 1;
  if (level <= 0) return; // nothing cleared yet — don't post an empty run
  const stars = totalStars(prog);
  const score = pack(level, stars);
  const now = Date.now();
  if (!force && (now - lastSubmit < 2500 || score <= lastScore)) return;
  lastSubmit = now;
  lastScore = score;

  const id = playerId();
  const name = playerName() || `runner-${id.slice(0, 4)}`;

  if (USE_UPSTASH) {
    // GT — only writes when the score beats what's stored
    void upstash([
      ['ZADD', 'board', 'GT', score, id],
      ['HSET', 'names', id, name],
    ]).catch(() => {});
  } else {
    fetch(`${REST_API}${USE_WORKER ? '/score' : '/api/score'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ id, name, level, stars }),
      signal: AbortSignal.timeout(6000),
    }).catch(() => {
      /* scores are flavor, never block the game */
    });
  }
}

export async function fetchBoard(): Promise<Board> {
  if (USE_UPSTASH) {
    const [range, myRank, namePairs] = await upstash([
      ['ZREVRANGE', 'board', 0, 49, 'WITHSCORES'],
      ['ZREVRANK', 'board', playerId()],
      ['HGETALL', 'names'],
    ]);
    const flat = (range as string[]) ?? [];
    const names = new Map<string, string>();
    const np = (namePairs as string[]) ?? [];
    for (let i = 0; i + 1 < np.length; i += 2) names.set(np[i], np[i + 1]);

    const top: BoardRow[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const { level, stars } = unpack(Number(flat[i + 1]));
      top.push({
        rank: top.length + 1,
        name: names.get(flat[i]) ?? flat[i].slice(0, 10),
        level,
        stars,
      });
    }
    let me: BoardRow | null = null;
    if (typeof myRank === 'number' || (typeof myRank === 'string' && myRank !== '')) {
      const r = Number(myRank);
      const myScore = top.find((e) => e.rank === r + 1);
      // own entry may sit outside the top-50 — pull it if so
      if (myScore) me = { ...myScore };
      else {
        const [zs] = await upstash([['ZSCORE', 'board', playerId()]]);
        if (zs != null) {
          const { level, stars } = unpack(Number(zs));
          me = { rank: r + 1, name: names.get(playerId()) ?? 'you', level, stars };
        }
      }
    }
    return { top, me };
  }

  // two contracts: the deployed api (vercel/worker) takes the session
  // and derives `me` itself; the local colyseus dev api takes ?me=<id>
  const res = await fetch(
    USE_WORKER
      ? `${REST_API}/board`
      : `${REST_API}/api/leaderboard?me=${playerId()}`,
    { headers: authHeaders(), signal: AbortSignal.timeout(6000) },
  );
  if (!res.ok) throw new Error(`board ${res.status}`);
  return (await res.json()) as Board;
}
