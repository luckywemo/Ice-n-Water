// Adventure mode — a 500-level campaign on one road through Nigeria.
// ICE & WATER (The Road North): freeze/thaw rules. Every level is
// procedurally defined by n: map seed, chasers, speed, time, crew, events,
// objective, chapter, landmark name, boss. The curve IS the design.

import { levelName } from './landmarks';

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

// ---------- the campaign ----------

export interface CampaignMeta {
  title: string;
  start: string; // flavor line on the START marker
  accent: number;
  accentCss: string; // unlocked nodes / guide line
  openCss: string;
  roadCss: string;
}

export const CAMPAIGN: CampaignMeta = {
  title: 'THE ROAD NORTH',
  start: 'LAGOS ISLAND — THE ROAD BEGINS',
  accent: 0x4dd0e1,
  accentCss: '#4dd0e1',
  openCss: 'rgba(127,216,240,0.45)',
  roadCss: 'rgba(127,216,240,0.45)',
};

// 10 chapters × 50 levels — every chapter is 5 towns of the journey.
export const CHAPTERS = [
  'STREET LEGENDS', 'COMPOUND WARS', 'SCHOOLYARD SHOWDOWN', 'MARKET MADNESS',
  'DANFO & DOWNPOURS', 'FESTIVAL LIGHTS', 'TRICKSTER GAMES', 'SURVIVAL TRIALS',
  'RIVAL ARENAS', 'LEGEND OF THE ROAD',
];

const BOSSES = [
  'THE PLAYGROUND CHAMPION', 'THE COMPOUND CAPTAIN', 'THE HEAD PREFECT',
  'THE MARKET CHAMPION', 'THE MOTOR PARK MARSHAL', 'THE FESTIVAL GUARDIAN',
  'THE TRICKSTER KING', 'THE ICE TITAN', 'THE RIVAL SQUAD CAPTAIN', 'THE ICE KING',
];

export type ObjectiveKind = 'survive' | 'collect' | 'rescue';

export interface LevelDef {
  n: number; // 1..500
  seed: number; // deterministic map — same level = same neighborhood
  chasers: number; // militia on the field at GO
  reinforcements: number; // extra militia mid-round
  chaserMult: number; // militia speed multiplier
  seconds: number; // round length
  crew: number; // AI teammates
  events: boolean; // danfo/NEPA/rain enabled
  milestone: number; // 0 for normal levels, else 1..50
  town: string; // milestone town name ('' for normal levels)
  name: string; // landmark name of this stop
  chapter: string; // one of the 10 chapters
  objective: { kind: ObjectiveKind; count: number };
  boss?: string; // set on every 10th level
}

const TOWN_FOR = (n: number): { milestone: number; town: string } =>
  n % LEVELS_PER_MILESTONE === 0
    ? { milestone: n / LEVELS_PER_MILESTONE, town: MILESTONE_TOWNS[n / LEVELS_PER_MILESTONE - 1] }
    : { milestone: 0, town: '' };

// objective rotation inside each 10-pack — the 10th is always a boss fight
const OBJ_PATTERN: ObjectiveKind[] = [
  'survive', 'collect', 'survive', 'rescue', 'survive',
  'collect', 'survive', 'rescue', 'collect', 'survive',
];

export function levelDef(n: number): LevelDef {
  const { milestone, town } = TOWN_FOR(n);
  const slot = (n - 1) % LEVELS_PER_MILESTONE;
  const chapterIdx = Math.min(Math.floor((n - 1) / 50), 9);
  const kind = OBJ_PATTERN[slot];
  return {
    n,
    seed: (n * 2654435761) >>> 0,
    chasers: Math.min(1 + Math.floor((n - 1) / 60), 6) + (milestone ? 1 : 0),
    reinforcements: Math.min(1 + Math.floor(n / 150), 3),
    chaserMult: Math.min(0.85 + n * 0.0013, 1.5),
    seconds: Math.min(45 + Math.round(n * 0.15), 120) + (milestone ? 15 : 0),
    crew: n < 100 ? 4 : n < 300 ? 3 : 2,
    events: n > 5,
    milestone,
    town,
    name: levelName(n),
    chapter: CHAPTERS[chapterIdx],
    objective: {
      kind,
      count:
        kind === 'collect'
          ? 3 + Math.floor(n / 90) // 3 → 8 water drops
          : kind === 'rescue'
            ? 1 + Math.floor(n / 130) // 1 → 4 mates
            : 0,
    },
    boss: n % LEVELS_PER_MILESTONE === 0 ? BOSSES[chapterIdx] : undefined,
  };
}

/** human-readable objective — shared by the map card, HUD and level banner */
export function objectiveText(def: LevelDef): string {
  const o = def.objective;
  if (o.kind === 'collect') return `collect ${o.count} water drops`;
  if (o.kind === 'rescue') return `thaw ${o.count} mates`;
  return `last ${def.seconds}s`;
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
