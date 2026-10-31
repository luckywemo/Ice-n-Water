// Cloud save — adventure progress mirrors to /api/progress for signed-in
// players. localStorage stays the source of truth mid-session (offline
// play never blocks); the server is the cross-device backup.
//
//   pullProgress()  → GET, merge remote∨local, store winner. Called once
//                     at boot after requireAuth — late-landing merges
//                     still write storage, so scenes created after the
//                     call see fresh progress.
//   pushProgress()  → POST local, server merges, winner stored back.
//                     Fire-and-forget on every level clear.
//
// Both merge with the same rule the api enforces: unlocked takes max,
// stars take per-level max — replaying stale saves is a no-op, two
// devices converge without losing a star.

import {
  AdventureProgress,
  adventureProgress,
  storeProgress,
  TOTAL_LEVELS,
} from './adventure';
import { loadStats, storeStats, loadPicks, savePicks, Stats } from './meta';
import { currentPick, setChar } from './characters';
import { playerName, setPlayerName } from './leaderboard';
import { API_URL, authHeaders, session } from './xauth';

export function mergeProgress(
  a: AdventureProgress,
  b: AdventureProgress,
): AdventureProgress {
  const stars: AdventureProgress['stars'] = { ...a.stars };
  for (const [k, v] of Object.entries(b.stars))
    stars[Number(k)] = Math.max(stars[Number(k)] ?? 0, v) as 1 | 2 | 3;
  return {
    unlocked: Math.max(a.unlocked, b.unlocked),
    stars,
  };
}

const same = (a: AdventureProgress, b: AdventureProgress) =>
  a.unlocked === b.unlocked &&
  Object.keys(a.stars).length === Object.keys(b.stars).length &&
  Object.entries(a.stars).every(([k, v]) => b.stars[Number(k)] === v);

/** pull remote → merge → persist, then replay any local clears the
    server hasn't seen (offline play) as events. remote stays truth —
    localStorage is the read cache. never throws. */
export async function pullProgress(timeoutMs = 4000): Promise<boolean> {
  if (!session() || !API_URL) return false;
  try {
    const res = await Promise.race([
      fetch(`${API_URL}/api/progress`, { headers: authHeaders() }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('timeout')), timeoutMs),
      ),
    ]);
    if (!res.ok) return false;
    const body = (await res.json()) as { progress?: AdventureProgress };
    const remote = body.progress;
    if (!remote) return false;
    const local = adventureProgress();
    const merged = mergeProgress(local, {
      unlocked: Math.min(remote.unlocked ?? 1, TOTAL_LEVELS),
      stars: remote.stars ?? {},
    });
    if (!same(merged, local)) storeProgress(merged);

    // gap replay — local knows clears the server hasn't recorded
    // (offline wins). report them as events, never as claimed state;
    // the server applies each only at-or-below its own frontier.
    const events = Object.entries(local.stars)
      .map(([k, v]) => ({ level: Number(k), stars: v }))
      .filter(
        (e) =>
          e.level < local.unlocked &&
          (e.level >= (remote.unlocked ?? 1) ||
            (remote.stars?.[e.level] ?? 0) < e.stars),
      );
    if (events.length) {
      fetch(`${API_URL}/api/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ events }),
      })
        .then(async (r) => {
          if (!r.ok) return;
          const b = (await r.json()) as { progress?: AdventureProgress };
          if (!b.progress) return;
          const m = mergeProgress(adventureProgress(), b.progress);
          if (!same(m, adventureProgress())) storeProgress(m);
        })
        .catch(() => {});
    }
    return true;
  } catch {
    return false; // offline, slow redis, dev — progress is nice-to-have
  }
}

/** report a cleared level — an event, not a state claim. the server
    advances the frontier itself; a rejected event (frontier behind)
    is re-covered by the pull-time gap replay. never throws. */
export function pushProgress(clearedLevel: number, stars: 1 | 2 | 3): void {
  if (!session() || !API_URL) return;
  fetch(`${API_URL}/api/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ clearedLevel, stars }),
  })
    .then(async (r) => {
      if (!r.ok) return;
      const body = (await r.json()) as { progress?: AdventureProgress };
      if (!body.progress) return;
      const merged = mergeProgress(adventureProgress(), body.progress);
      if (!same(merged, adventureProgress())) storeProgress(merged);
    })
    .catch(() => {
      /* offline — pull-time replay covers it */
    });
}

// ---------- profile (name / char / stats / picks / seen-flags) ----------

interface CloudProfile {
  name?: string;
  char?: { id: string; body?: number };
  stats?: Stats;
  statsEvents?: { won: boolean; s: number }[];
  picks?: { difficulty?: string; hints?: boolean };
  advSeen?: number;
  hintSeen?: number;
}

// ---------- stats event journal ----------
// localStorage holds a REPLAY LOG, never claimed state: match results
// queue here until the server acks them. Forging the queue reports at
// most 100 fake one-game outcomes through a rate-limited pipe — it can
// never write a total. Server recomputes streaks itself, on its clock.
const STATS_QUEUE = 'iw-stats-pending';
const QUEUE_CAP = 100;

const readJournal = (): { won: boolean; s: number }[] => {
  try {
    const q = JSON.parse(localStorage.getItem(STATS_QUEUE) ?? '[]');
    return Array.isArray(q) ? q.slice(-QUEUE_CAP) : [];
  } catch {
    return [];
  }
};

const writeJournal = (q: { won: boolean; s: number }[]) => {
  try {
    localStorage.setItem(STATS_QUEUE, JSON.stringify(q.slice(-QUEUE_CAP)));
  } catch {
    /* queue is nice-to-have */
  }
};

/** call at match end — journals the result, then flushes. the flush is
    pushProfile (prefs + pending events in one POST). never throws. */
export function recordStatsEvent(won: boolean, survivedSec: number): void {
  if (!session() || !API_URL) return;
  const q = readJournal();
  q.push({ won, s: Math.round(survivedSec) });
  writeJournal(q);
  pushProfile();
}

/** gather the scattered localStorage keys into one profile blob —
    stats deliberately absent: they're reported as events, not claimed */
function localProfile(): CloudProfile {
  const p = currentPick();
  const picks = loadPicks();
  return {
    name: playerName() || undefined,
    char: p.body === undefined ? { id: p.id } : { id: p.id, body: p.body },
    picks: { difficulty: picks.difficulty, hints: picks.hints },
    advSeen: Number(localStorage.getItem('icenwater_adv_seen') ?? 0) || undefined,
    hintSeen: Number(localStorage.getItem('iw-hint-seen') ?? 0) || undefined,
  };
}

/** write remote-merged fields back through the same setters the UI uses —
    per-device picks (joy/perf) are preserved, never overwritten */
function applyProfile(p: CloudProfile): void {
  if (p.name && p.name !== playerName()) setPlayerName(p.name);
  if (p.char) {
    const cur = currentPick();
    if (p.char.id !== cur.id || p.char.body !== cur.body)
      setChar(p.char.id, p.char.body ?? null);
  }
  if (p.stats) {
    const local = loadStats();
    const merged: Stats = {
      games: Math.max(local.games, p.stats.games ?? 0),
      wins: Math.max(local.wins, p.stats.wins ?? 0),
      bestStreak: Math.max(local.bestStreak, p.stats.bestStreak ?? 0),
      bestSurvived: Math.max(local.bestSurvived, p.stats.bestSurvived ?? 0),
      streak:
        (p.stats.updatedAt ?? 0) > (local.updatedAt ?? 0)
          ? (p.stats.streak ?? local.streak)
          : local.streak,
      updatedAt: Math.max(p.stats.updatedAt ?? 0, local.updatedAt ?? 0),
    };
    storeStats(merged);
  }
  if (p.picks) {
    const local = loadPicks();
    const difficulty = (p.picks.difficulty as typeof local.difficulty) ?? local.difficulty;
    const hints = p.picks.hints ?? local.hints;
    if (difficulty !== local.difficulty || hints !== local.hints)
      savePicks(difficulty, local.joy, local.perf, hints);
  }
  if (p.advSeen)
    localStorage.setItem(
      'icenwater_adv_seen',
      String(Math.max(p.advSeen, Number(localStorage.getItem('icenwater_adv_seen') ?? 0))),
    );
  if (p.hintSeen)
    localStorage.setItem(
      'iw-hint-seen',
      String(Math.max(p.hintSeen, Number(localStorage.getItem('iw-hint-seen') ?? 0))),
    );
}

/** pull remote → merge into the scattered local keys. never throws. */
export async function pullProfile(timeoutMs = 4000): Promise<boolean> {
  if (!session() || !API_URL) return false;
  try {
    const res = await Promise.race([
      fetch(`${API_URL}/api/profile`, { headers: authHeaders() }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('timeout')), timeoutMs),
      ),
    ]);
    if (!res.ok) return false;
    const body = (await res.json()) as { profile?: CloudProfile };
    if (!body.profile) return false;
    applyProfile(body.profile);
    return true;
  } catch {
    return false;
  }
}

let lastPush = 0;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
/** fire-and-forget on every profile write site — debounced 1.5s with a
    trailing call so a burst of setter calls coalesces without losing
    the last write. never throws. */
export function pushProfile(): void {
  if (!session() || !API_URL) return;
  const wait = 1500 - (Date.now() - lastPush);
  if (wait > 0) {
    if (pushTimer) return; // a trailing push is already queued
    pushTimer = setTimeout(() => {
      pushTimer = null;
      lastPush = 0; // force the immediate path below
      pushProfile();
    }, wait);
    return;
  }
  lastPush = Date.now();
  const sent = readJournal(); // events this POST reports — clear on ack
  fetch(`${API_URL}/api/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ...localProfile(), statsEvents: sent }),
  })
    .then(async (r) => {
      if (!r.ok) return;
      writeJournal(readJournal().slice(sent.length)); // drop what server took
      const body = (await r.json()) as { profile?: CloudProfile };
      if (body.profile) applyProfile(body.profile); // absorb remote wins
    })
    .catch(() => {
      /* offline — journal retries on next write */
    });
}
