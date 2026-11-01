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

// the champion who holds each milestone — the real royal title of that
// town's people. Baale = quarter head under an Oba (Lagos neighborhoods),
// Oba/Baale across Yorubaland, Igwe/Eze/Obi in the East, Amanyanabo/Obong
// downriver, then the Emirs, Sultan and Shehu as the road runs north.
export const MILESTONE_BOSSES = [
  'OBA OF LAGOS', 'OBA OF IKOYI', 'BAALE OF SURULERE', 'BAALE OF YABA', 'OBA OF IKEJA',
  'AYANGBUREN OF IKORODU', 'OLOJA OF EPE', 'AHOLU OF BADAGRY', 'BAALE OF AGEGE', 'BAALE OF OSHODI',
  'ALAKE OF EGBALAND', 'OLUBADAN OF IBADAN', 'ATAOJA OF OSOGBO', 'OONI OF IFE', 'DEJI OF AKURE',
  'EWI OF ADO-EKITI', 'OSEMAWE OF ONDO', 'OBA OF BENIN', 'OLU OF WARRI', 'ASAGBA OF ASABA',
  'OBI OF ONITSHA', 'EZE UZU OF AWKA', 'IGWE OF ENUGU', 'IGWE OF ABAKALIKI', 'EZE OF OWERRI',
  'IGWE OF UMUAHIA', 'EZE OF ABA', 'AMANYANABO OF PORT HARCOURT', 'AMANYANABO OF YENAGOA', 'OBONG OF CALABAR',
  'OBONG OF UYO', 'CHIEF OF OGOJA', 'TOR TIV OF MAKURDI', 'MAIGARI OF LOKOJA', 'EMIR OF ILORIN',
  'EMIR OF MINNA', 'ESU OF ABUJA', 'EMIR OF KADUNA', 'EMIR OF ZAZZAU', 'EMIR OF KANO',
  'EMIR OF KATSINA', 'SULTAN OF SOKOTO', 'EMIR OF GWANDU', 'EMIR OF ZAMFARA', 'EMIR OF DUTSE',
  'EMIR OF BAUCHI', 'EMIR OF GOMBE', 'LAMIDO OF ADAMAWA', 'EMIR OF MURI', 'SHEHU OF BORNO',
];

export type ObjectiveKind = 'survive' | 'collect' | 'rescue' | 'refuge' | 'hunt';
// chapter-scaled battlefield twists — each stretch of the road has a mood
export type Mutator = 'night' | 'storm' | 'market' | 'heat' | 'crowd' | 'decoy';
// milestone champions get a signature move that escalates by chapter
export type BossMove = 'summon' | 'rage' | 'blink';

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
  bossMove?: BossMove; // the champion's signature trick
  mutator?: Mutator; // this stop's battlefield twist
  twist?: boolean; // collect levels: leftover drops turn to ice and hunt you
}

const TOWN_FOR = (n: number): { milestone: number; town: string } =>
  n % LEVELS_PER_MILESTONE === 0
    ? { milestone: n / LEVELS_PER_MILESTONE, town: MILESTONE_TOWNS[n / LEVELS_PER_MILESTONE - 1] }
    : { milestone: 0, town: '' };

// Objective + squad rotation inside each 10-pack — the 10th is always a
// boss fight. `mates`/`militia` override the difficulty curve for squad
// variety: some stops stack the squads (4v4 brawl), some leave you alone
// against a pack (lone wolf), some give you numbers over the militia.
interface SlotDef {
  kind: ObjectiveKind;
  mates?: number; // AI teammates (player is the +1) — null = difficulty curve
  militia?: number; // exact chaser count — null = difficulty curve
  twist?: boolean; // collect: drops freeze into hunters, escape through the ring
}
const SLOT_PATTERN: SlotDef[] = [
  { kind: 'survive' }, // 1 — the standard chase
  { kind: 'collect' }, // 2 — grab the water drops
  { kind: 'rescue' }, // 3 — thaw your mates
  { kind: 'survive', mates: 3, militia: 4 }, // 4 — BIG BRAWL: 4v4
  { kind: 'refuge' }, // 5 — SAFE RING: 5s of cover, can't camp it
  { kind: 'collect', mates: 1, militia: 4 }, // 6 — OUTNUMBERED: 2v4 scramble
  { kind: 'survive', mates: 0, militia: 2 }, // 7 — LONE WOLF: just you vs a pair
  { kind: 'rescue', mates: 3, militia: 1 }, // 8 — SQUAD SUPPORT: 4v1 — you have numbers
  { kind: 'collect', mates: 1, militia: 2, twist: true }, // 9 — WATER FIGHTS BACK (2v2)
  { kind: 'survive' }, // 10 — BOSS
];

// Each chapter's battlefield mood — the deeper you push north, the more the
// land itself fights you. Deterministic per level so a stop always plays the same.
const MUTATOR_POOLS: Mutator[][] = [
  [], // I — STREET LEGENDS: clean learning ground
  ['crowd'], // II — COMPOUND WARS: families everywhere
  ['heat'], // III — SCHOOLYARD: afternoon sun drains your sprint
  ['market', 'crowd'], // IV — MARKET MADNESS: items + bodies everywhere
  ['storm'], // V — DANFO & DOWNPOURS: the ground never dries
  ['night'], // VI — FESTIVAL LIGHTS: dusk, spotlight, red glints
  ['decoy', 'night'], // VII — TRICKSTER GAMES: bitter drops among the water
  ['storm', 'heat', 'night'], // VIII — SURVIVAL TRIALS: everything at once
  ['night', 'crowd', 'storm'], // IX — RIVAL ARENAS: hostile territory
  ['storm', 'night', 'decoy', 'heat'], // X — LEGEND: full chaos
];

export function levelDef(n: number): LevelDef {
  const { milestone, town } = TOWN_FOR(n);
  const slot = (n - 1) % LEVELS_PER_MILESTONE;
  const packIdx = Math.floor((n - 1) / LEVELS_PER_MILESTONE);
  const chapterIdx = Math.min(Math.floor((n - 1) / 50), 9);
  const def = SLOT_PATTERN[slot];
  // every other town flips the script on slot 6 — you become the hunter
  const kind: ObjectiveKind =
    slot === 5 && def.kind === 'collect' && packIdx % 2 === 1 ? 'hunt' : def.kind;
  const huntCount = 2 + Math.floor(n / 140); // 2 → 5 runners to tag
  const pool = MUTATOR_POOLS[chapterIdx];
  const mutator = pool.length ? pool[(n * 7) % pool.length] : undefined;
  // champions escalate: early ones summon iceling backup, mid ones rage,
  // the final ones blink onto your back
  const bossMove: BossMove | undefined = milestone
    ? chapterIdx < 3
      ? 'summon'
      : chapterIdx < 6
        ? 'rage'
        : 'blink'
    : undefined;
  // from TRICKSTER GAMES on, the fixed squad matchups field one extra militia
  const militiaBump =
    kind !== 'hunt' && def.militia !== undefined && chapterIdx >= 6 ? 1 : 0;
  return {
    n,
    seed: (n * 2654435761) >>> 0,
    chasers:
      kind === 'hunt'
        ? 0
        : (def.militia ?? Math.min(1 + Math.floor((n - 1) / 60), 6)) +
          militiaBump +
          (milestone ? 1 : 0),
    reinforcements: kind === 'hunt' ? 0 : Math.min(1 + Math.floor(n / 150), 3),
    chaserMult: Math.min(0.85 + n * 0.0013, 1.5),
    seconds: Math.min(45 + Math.round(n * 0.15), 120) + (milestone ? 15 : 0),
    crew: kind === 'hunt' ? huntCount + 2 : (def.mates ?? (n < 100 ? 4 : n < 300 ? 3 : 2)),
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
            : kind === 'hunt'
              ? huntCount
              : 0,
    },
    boss: n % LEVELS_PER_MILESTONE === 0 ? MILESTONE_BOSSES[milestone - 1] : undefined,
    bossMove,
    mutator,
    twist: def.twist || undefined,
  };
}

/** human-readable objective — shared by the map card, HUD and level banner */
export function objectiveText(def: LevelDef): string {
  const o = def.objective;
  if (o.kind === 'collect')
    return def.twist ? `collect ${o.count} drops — then run` : `collect ${o.count} water drops`;
  if (o.kind === 'rescue') return `thaw ${o.count} mates`;
  if (o.kind === 'refuge') return `last ${def.seconds}s · hide in the gold ring`;
  if (o.kind === 'hunt') return `tag ${o.count} runners — you're the chaser`;
  return `last ${def.seconds}s`;
}

/** intro card shown before the round — first taste of each mechanic,
 *  plus a town card at every milestone boss */
export interface LevelIntro {
  title: string;
  body: string;
}
export function levelIntro(def: LevelDef): LevelIntro | null {
  if (def.boss) {
    const moveHint =
      def.bossMove === 'summon'
        ? ' He calls iceling backup.'
        : def.bossMove === 'rage'
          ? ' He rages — do not be near when he boils.'
          : def.bossMove === 'blink'
            ? ' He blinks — watch your back.'
            : '';
    return {
      title: `${def.town.toUpperCase()} — MILESTONE ${def.milestone}`,
      body: `${def.boss} holds this stop.${moveHint}\n${def.chasers} militia on the field — take the crown.`,
    };
  }
  // each new chapter opens with its own card — the land changes its rules
  const CHAPTER_INTRO: Record<number, LevelIntro> = {
    51: {
      title: 'CHAPTER II — COMPOUND WARS',
      body: 'The compounds are packed — extra bodies everywhere.\nMore cover for you. More chaos for everyone.',
    },
    101: {
      title: 'CHAPTER III — SCHOOLYARD SHOWDOWN',
      body: 'Afternoon sun dey burn — sprint drains faster here.\nPace the RUN button or pay for it.',
    },
    151: {
      title: 'CHAPTER IV — MARKET MADNESS',
      body: 'Market day! Slippers, juju, pure water everywhere.\nGrab what you can carry — the militia dey come too.',
    },
    201: {
      title: 'CHAPTER V — DANFO & DOWNPOURS',
      body: 'Rain season — the ground never dries.\nEverybody slides. Learn to drift or learn to fall.',
    },
    251: {
      title: 'CHAPTER VI — FESTIVAL LIGHTS',
      body: 'Dusk has fallen — you run inside your own spotlight.\nThe militia are only red glints in the dark.',
    },
    301: {
      title: 'CHAPTER VII — TRICKSTER GAMES',
      body: 'Not every drop is water — bitter kola wears the same coat.\nWatch the colour before you grab.',
    },
    351: {
      title: 'CHAPTER VIII — SURVIVAL TRIALS',
      body: 'Heat, storm, night — everything at once.\nThe road does not love you anymore.',
    },
    401: {
      title: 'CHAPTER IX — RIVAL ARENAS',
      body: 'Elite militia territory — they blink, they rage,\nand the squads field one extra body. Respect the crown.',
    },
    451: {
      title: 'CHAPTER X — LEGEND OF THE ROAD',
      body: 'Every trick the road taught you, all at once.\nMaiduguri is watching. Finish it.',
    },
  };
  if (CHAPTER_INTRO[def.n]) return CHAPTER_INTRO[def.n];
  const FIRST: Record<number, LevelIntro> = {
    1: {
      title: 'WELCOME TO THE ROAD',
      body: 'They chase. You run. You freeze —\nyour crew can thaw you back.\nSurvive the clock to push north.',
    },
    2: {
      title: 'NEW: WATER DROPS',
      body: 'Grab the drops scattered across the map.\nCollect the count shown before the clock dies.',
    },
    3: {
      title: 'NEW: THAW',
      body: 'Frozen mates need you — touch them to bring them back.\nThaw the count shown to clear the stop.',
    },
    4: {
      title: 'NEW: BIG BRAWL',
      body: '4 vs 4 — full squads on the field.\nYour mates pull heat off you. Use them.',
    },
    5: {
      title: 'NEW: THE SAFE RING',
      body: 'The gold ring makes you untaggable — for 5 seconds.\nCover drains while you hide, cools while you run.\nNo camping.',
    },
    6: {
      title: 'NEW: OUTNUMBERED + STREET CHAOS',
      body: '2 vs 4 — and from here the street fights back too:\ndanfo, NEPA blackouts, rain.',
    },
    7: {
      title: 'NEW: LONE WOLF',
      body: "Just you out there — nobody to thaw you.\nOne freeze and the run is over. Don't get touched.",
    },
    8: {
      title: 'NEW: SQUAD SUPPORT',
      body: '4 vs 1 — your numbers, their lone hunter.\nShame them. Rescue anyone who slips.',
    },
    9: {
      title: 'NEW: WATER FIGHTS BACK',
      body: 'Collect the drops — then the leftovers freeze into hunters.\nReach the gold EXIT ring alive to clear the stop.',
    },
    16: {
      title: "NEW: YOU'RE IT!",
      body: 'The script flips — YOU chase them now.\nTag the count shown before the clock dies.\nFrozen runners stay down on hunt stops.',
    },
  };
  return FIRST[def.n] ?? null;
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

/** write a progress blob straight to storage — used by the cloud-sync
    merge (recordLevel stays the win path, this is for remote merges) */
export function storeProgress(p: AdventureProgress): void {
  try {
    localStorage.setItem(
      ADV_KEY,
      JSON.stringify({
        unlocked: Math.max(1, Math.min(p.unlocked, TOTAL_LEVELS)),
        stars: p.stars ?? {},
      }),
    );
  } catch {
    /* progress is nice-to-have */
  }
}
