// playable bean cast — every character is the same rig re-dressed:
// body = vinyl/fur colour, skin = face oval, shape = body silhouette,
// gear = head-mounted extra. Shape/gear change the actual MODEL, not
// just the paint — they build different meshes on the shared skeleton.
import type { BeanGear, BeanShape } from './hero3d';
import { adventureProgress, LEVELS_PER_MILESTONE, MILESTONE_BOSSES, levelDef } from './adventure';
import type { BossMove } from './adventure';
import { playerName } from './leaderboard';

export interface CharDef {
  id: string;
  name?: string; // personal name — only runners without a boss title carry one
  body: number;
  skin: number;
  shape?: BeanShape; // default 'bean'
  gear?: BeanGear; // default 'none'
  rage?: boolean; // angry brows
  furLen?: number; // coat strand multiplier — 1 = standard
  unlockAt?: number; // milestone boss (1..50) that frees this runner — unset = free
}

// the cast IS the beaten champion — a gated runner's name is the boss's
// title (charTitle), not a person. Only the free hero keeps a name.
export const CHARACTERS: CharDef[] = [
  { id: 'koko', name: 'NGOZI', body: 0x8a4f24, skin: 0xecc98e }, // the hero — classic chocolate, yours from GO
  { id: 'agbalumo', body: 0xb56a26, skin: 0xf2d9a6, shape: 'round', unlockAt: 3 }, // BAALE OF SURULERE — chubby
  { id: 'kola', body: 0x553219, skin: 0xd9ad78, unlockAt: 6 }, // AYANGBUREN OF IKORODU — dark roast
  { id: 'zobo', body: 0x8a2f3d, skin: 0xecc4a0, shape: 'tall', unlockAt: 9 }, // BAALE OF AGEGE — lanky red
  { id: 'palmie', body: 0x4f6b35, skin: 0xe2cf9e, gear: 'band', unlockAt: 12 }, // OLUBADAN OF IBADAN — sweatband
  { id: 'asphalt', body: 0x3a3a44, skin: 0xcfc8b8, gear: 'hardhat', unlockAt: 15 }, // DEJI OF AKURE — site helmet
  { id: 'danfo', body: 0xcf9a1f, skin: 0xf2dfae, gear: 'cap', unlockAt: 20 }, // ASAGBA OF ASABA — conductor cap
  { id: 'agbero', body: 0x6e4a2f, skin: 0xe0bd92, gear: 'spikes', unlockAt: 25 }, // IGWE OF UMUAHIA — mohawk
  { id: 'oba', body: 0x5a3a6a, skin: 0xe8c9a0, shape: 'round', gear: 'crown', unlockAt: 30 }, // OBONG OF CALABAR — royal purple
  { id: 'indigo', body: 0x3d3a8c, skin: 0xdfb184, shape: 'tall', unlockAt: 40 }, // EMIR OF KANO — Kofar Mata dye-pit indigo; the blink phantom
];

// fixed team coats — the player's pick never collides with these
export const CREW_DEF: CharDef = { id: 'crew', name: 'CREW', body: 0x2e6f8e, skin: 0xe8c9a0 }; // water blue
// the chasers ARE the ice — pale frozen fur, angry brows, icicle fringe,
// a shaggier coat. Water crew vs ice militia finally reads on sight.
export const MILITIA_DEF: CharDef = {
  id: 'militia',
  name: 'MILITIA',
  body: 0x9ccfe8,
  skin: 0xf4f2e8,
  gear: 'frost',
  rage: true,
  furLen: 1.45,
};

// milestone champions — the ice militia's named elite. Spread over
// MILITIA_DEF so they keep the frozen coat/brows/icicles, but each boss
// gets a silhouette + headgear you can read at a glance. Keyed by the
// royal title from MILESTONE_BOSSES: crowns for the great thrones, caps
// (fila/turban) for lesser obas + emirs, bands for young baales, spikes
// for the warrior titles, tall for the northern robes.
export const BOSS_MODELS: Record<string, Partial<CharDef>> = {
  // — Lagos + Yorubaland
  'OBA OF LAGOS': { gear: 'crown' }, // the first champion wears the real crown
  'OBA OF IKOYI': { gear: 'cap' },
  'BAALE OF SURULERE': { gear: 'band' }, // quarter heads — no crown yet
  'BAALE OF YABA': { gear: 'band' },
  'OBA OF IKEJA': { gear: 'cap' },
  'AYANGBUREN OF IKORODU': { gear: 'cap' },
  'OLOJA OF EPE': { gear: 'cap' },
  'AHOLU OF BADAGRY': { gear: 'cap' },
  'BAALE OF AGEGE': { gear: 'band' },
  'BAALE OF OSHODI': { gear: 'band' },
  'ALAKE OF EGBALAND': { gear: 'crown' },
  'OLUBADAN OF IBADAN': { gear: 'crown', shape: 'round' }, // the big man
  'ATAOJA OF OSOGBO': { gear: 'crown' },
  'OONI OF IFE': { gear: 'crown', shape: 'tall' }, // the senior throne
  'DEJI OF AKURE': { gear: 'cap' },
  'EWI OF ADO-EKITI': { gear: 'cap' },
  'OSEMAWE OF ONDO': { gear: 'cap' },
  'OBA OF BENIN': { gear: 'crown' }, // the legendary throne
  'OLU OF WARRI': { gear: 'crown', shape: 'round' },
  'ASAGBA OF ASABA': { gear: 'cap' },
  // — the East + the rivers
  'OBI OF ONITSHA': { gear: 'crown' }, // a serious throne
  'EZE UZU OF AWKA': { gear: 'cap' },
  'IGWE OF ENUGU': { gear: 'spikes' }, // coal city muscle
  'IGWE OF ABAKALIKI': { gear: 'cap' },
  'EZE OF OWERRI': { gear: 'cap' },
  'IGWE OF UMUAHIA': { gear: 'cap' },
  'EZE OF ABA': { gear: 'spikes' },
  'AMANYANABO OF PORT HARCOURT': { gear: 'cap', shape: 'round' }, // river kings run wide
  'AMANYANABO OF YENAGOA': { gear: 'cap', shape: 'round' },
  'OBONG OF CALABAR': { gear: 'crown', shape: 'round' },
  'OBONG OF UYO': { gear: 'cap', shape: 'round' },
  // — the middle belt
  'CHIEF OF OGOJA': { gear: 'band' },
  'TOR TIV OF MAKURDI': { gear: 'spikes' }, // the warrior federation
  'MAIGARI OF LOKOJA': { gear: 'cap' },
  'EMIR OF ILORIN': { gear: 'cap', shape: 'tall' }, // first northern throne — the robes run long
  // — the North
  'EMIR OF MINNA': { gear: 'cap', shape: 'tall' },
  'ESU OF ABUJA': { gear: 'cap', shape: 'tall' },
  'EMIR OF KADUNA': { gear: 'cap', shape: 'tall' },
  'EMIR OF ZAZZAU': { gear: 'spikes', shape: 'tall' }, // the warrior emirate
  'EMIR OF KANO': { gear: 'crown', shape: 'tall' }, // the great northern throne
  'EMIR OF KATSINA': { gear: 'cap', shape: 'tall' },
  'SULTAN OF SOKOTO': { gear: 'crown', shape: 'tall' }, // the supreme throne
  'EMIR OF GWANDU': { gear: 'cap', shape: 'tall' },
  'EMIR OF ZAMFARA': { gear: 'cap', shape: 'tall' },
  'EMIR OF DUTSE': { gear: 'cap', shape: 'tall' },
  'EMIR OF BAUCHI': { gear: 'cap', shape: 'tall' },
  'EMIR OF GOMBE': { gear: 'cap', shape: 'tall' },
  'LAMIDO OF ADAMAWA': { gear: 'cap', shape: 'tall' },
  'EMIR OF MURI': { gear: 'cap', shape: 'tall' },
  'SHEHU OF BORNO': { gear: 'crown', shape: 'tall', furLen: 1.7 }, // the finale — a shaggy ice monster king
};

const KEY = 'iw-char';

// the wardrobe pick — id chooses the runner, body optionally repaints
// their coat (the outfit screen's COLOUR tab). Legacy values were bare
// id strings — read both.
export interface CharPick {
  id: string;
  body?: number;
}

export function currentPick(): CharPick {
  const raw = localStorage.getItem(KEY);
  if (raw?.startsWith('{')) {
    try {
      const p = JSON.parse(raw) as CharPick;
      if (p.id) return { id: p.id, body: p.body };
    } catch {
      /* fall through */
    }
  }
  return { id: raw ?? CHARACTERS[0].id };
}

/** a runner is yours once their milestone's boss has fallen — check the
 *  boss level's star, not `unlocked`, so a level can't be farmed early */
export function charUnlocked(def: CharDef): boolean {
  if (!def.unlockAt) return true;
  return (adventureProgress().stars[def.unlockAt * LEVELS_PER_MILESTONE] ?? 0) > 0;
}

export function unlockedChars(): CharDef[] {
  return CHARACTERS.filter(charUnlocked);
}

/** the champion's full title — 'BAALE OF SURULERE', 'SHEHU OF BORNO' */
export function charTitle(def: CharDef): string {
  return def.unlockAt ? MILESTONE_BOSSES[def.unlockAt - 1] : '';
}

/** just the noun — 'BAALE', 'EMIR', 'SHEHU' */
export function charTitleShort(def: CharDef): string {
  return charTitle(def).split(' OF ')[0];
}

/** who the runner IS — beaten champions take the player's name + title:
 *  'MUHAMMAD | BAALE'. The free hero is just you: 'MUHAMMAD'. With no
 *  username yet, a champion answers to their full boss title. */
export function runnerName(def: CharDef): string {
  const who = (playerName() || def.name || '').toUpperCase().slice(0, 10);
  if (!def.unlockAt) return who;
  return who ? `${who} | ${charTitleShort(def)}` : charTitle(def);
}

/** the beaten champion's signature passes to the runner — you inherit
 *  the move of the boss you beat to unlock them ('summon'/'rage'/'blink') */
export function charMove(def: CharDef): BossMove | undefined {
  return def.unlockAt ? levelDef(def.unlockAt * LEVELS_PER_MILESTONE).bossMove : undefined;
}

export function currentChar(): CharDef {
  const p = currentPick();
  const found = CHARACTERS.find((c) => c.id === p.id);
  // a stored pick can outlive a save wipe — fall back to the free hero
  const def = found && charUnlocked(found) ? found : CHARACTERS[0];
  return p.body === undefined ? def : { ...def, body: p.body };
}

// body omitted → keep the current coat paint; null → clear the override
export function setChar(id: string, body?: number | null) {
  const keep = body === undefined ? currentPick().body : body ?? undefined;
  localStorage.setItem(KEY, JSON.stringify(keep === undefined ? { id } : { id, body: keep }));
}
