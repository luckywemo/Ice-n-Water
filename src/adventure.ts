// Adventure mode — a 500-level journey through Nigeria.
// Every level is procedurally defined by its number: mode, map seed,
// militia count/speed, round length, crew size. No hand-authored content —
// the difficulty curve IS the design.

import { Mode } from './meta';

export const TOTAL_LEVELS = 500;
export const LEVELS_PER_MILESTONE = 10;
export const TOTAL_MILESTONES = TOTAL_LEVELS / LEVELS_PER_MILESTONE;

// The journey itself — 50 neighborhoods, south to north.
// Each milestone (10 levels) is one town on the road north.
export const MILESTONE_TOWNS = [
  'Lagos Island', 'Ikoyi', 'Surulere', 'Yaba', 'Ikeja',
  'Ikorodu', 'Epe', 'Badagry', 'Agege', 'Oshodi',
  'Abeokuta', 'Ibadan', 'Osogbo', 'Ile-Ife', 'Akure',
  'Ado-Ekiti', 'Ondo', 'Benin City', 'Warri', 'Asaba',
  'Onitsha', 'Awka', 'Enugu', 'Abakaliki', 'Owerri',
  'Umuahia', 'Aba', 'Port Harcourt', 'Yenagoa', 'Calabar',
  'Uyo', 'Ogoja', 'Makurdi', 'Lokoja', 'Ilorin',
  'Minna', 'Abuja', 'Kaduna', 'Zaria', 'Kano',
  'Katsina', 'Sokoto', 'Birnin Kebbi', 'Gusau', 'Dutse',
  'Bauchi', 'Gombe', 'Yola', 'Jalingo', 'Maiduguri',
];

export interface LevelDef {
  n: number; // 1..500
  mode: Mode;
  seed: number; // deterministic map — same level = same neighborhood
  chasers: number; // militia on the field at GO
  reinforcements: number; // extra militia mid-round
  chaserMult: number; // militia speed multiplier
  seconds: number; // round length
  crew: number; // AI teammates
  events: boolean; // danfo/NEPA/rain enabled
  milestone: number; // 0 for normal levels, else 1..50
  town: string; // milestone town name ('' for normal levels)
}

const TOWN_FOR = (n: number): { milestone: number; town: string } =>
  n % LEVELS_PER_MILESTONE === 0
    ? { milestone: n / LEVELS_PER_MILESTONE, town: MILESTONE_TOWNS[n / LEVELS_PER_MILESTONE - 1] }
    : { milestone: 0, town: '' };

export function levelDef(n: number): LevelDef {
  const { milestone, town } = TOWN_FOR(n);
  return {
    n,
    // every 5th level (incl. all milestones) is police & thief night patrol
    mode: n % 5 === 0 ? 'police' : 'ice',
    seed: (n * 2654435761) >>> 0,
    chasers: Math.min(1 + Math.floor((n - 1) / 60), 6) + (milestone ? 1 : 0),
    reinforcements: Math.min(1 + Math.floor(n / 150), 3),
    chaserMult: Math.min(0.85 + n * 0.0013, 1.5),
    seconds: Math.min(45 + Math.round(n * 0.15), 120) + (milestone ? 15 : 0),
    crew: n < 100 ? 4 : n < 300 ? 3 : 2,
    events: n > 5,
    milestone,
    town,
  };
}

// ---------- progress (localStorage) ----------

const ADV_KEY = 'icenwater_adventure';

export interface AdventureProgress {
  unlocked: number; // highest level number available to play
  stars: Record<number, 1 | 2 | 3>;
}

export function adventureProgress(): AdventureProgress {
  try {
    const raw = localStorage.getItem(ADV_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { unlocked: Math.max(1, p.unlocked ?? 1), stars: p.stars ?? {} };
    }
  } catch {
    /* corrupted — fresh journey */
  }
  return { unlocked: 1, stars: {} };
}

/** call when a level is won — unlocks the next, keeps the best star rating */
export function recordLevel(n: number, stars: 1 | 2 | 3): AdventureProgress {
  const p = adventureProgress();
  p.unlocked = Math.max(p.unlocked, Math.min(n + 1, TOTAL_LEVELS));
  p.stars[n] = Math.max(p.stars[n] ?? 0, stars) as 1 | 2 | 3;
  try {
    localStorage.setItem(ADV_KEY, JSON.stringify(p));
  } catch {
    /* progress is nice-to-have */
  }
  return p;
}

export function totalStars(p: AdventureProgress): number {
  return Object.values(p.stars).reduce((a, b) => a + b, 0);
}
