// Global adventure leaderboard. Modes, in preference order:
//   VITE_BOARD_URL   → the deployed board api (worker proxy or vercel
//                      /api) — zero secrets in the client (production)
//   unset            → the Colyseus server's local API (offline dev)
// (There is deliberately no direct-to-Redis tier: a VITE_ token would
// ship in the bundle with write access to the same db that parks
// sign-in handoffs — a leak turned board vandalism into session theft.)

import { adventureProgress, totalStars } from './adventure';
import { SERVER_URL } from './net';
import { authHeaders, session } from './xauth';

const BOARD_URL = (import.meta.env.VITE_BOARD_URL as string | undefined) ?? '';
const USE_WORKER = BOARD_URL.startsWith('https://') || BOARD_URL.startsWith('/');

const SERVER_API = (() => {
  if (SERVER_URL.startsWith('wss://')) return 'https://' + SERVER_URL.slice(6);
  if (SERVER_URL.startsWith('ws://')) return 'http://' + SERVER_URL.slice(5);
  return SERVER_URL;
})();

/** worker/local-server shaped API — both speak the same {top, me} contract */
const REST_API = USE_WORKER ? BOARD_URL : SERVER_API;

const NAME_KEY = 'icenwater_name';

export function playerId(): string {
  // every real player is their verified X id — the auth gate means a
  // session always exists by the time this is called; anonymous ids
  // were retired when progress sync made them orphans
  const x = session();
  return x ? `x_${x.id}` : 'anon';
}

export function playerName(): string {
  return localStorage.getItem(NAME_KEY) || '';
}

export function setPlayerName(n: string) {
  localStorage.setItem(NAME_KEY, n.trim().slice(0, 10)); // runner names cap at 10
}

// pack progress into one sortable number: level decides, stars break ties
const pack = (level: number, stars: number) => level * 2000 + Math.min(stars, 1999);

export interface BoardRow {
  rank: number;
  name: string;
  level: number;
  stars: number;
  pfp?: string; // verified X avatar — board tiles wear it as their face
}

export interface Board {
  top: BoardRow[];
  me: BoardRow | null;
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

  fetch(`${REST_API}${USE_WORKER ? '/score' : '/api/score'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ id, name, level, stars }),
    signal: AbortSignal.timeout(6000),
  }).catch(() => {
    /* scores are flavor, never block the game */
  });
}

export async function fetchBoard(): Promise<Board> {
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
