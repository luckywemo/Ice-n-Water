// playable bean cast — every character is the same rig re-dressed:
// body = vinyl/fur colour, skin = face oval, shape = body silhouette,
// gear = head-mounted extra. Shape/gear change the actual MODEL, not
// just the paint — they build different meshes on the shared skeleton.
import type { BeanGear, BeanMarks, BeanShape } from './hero3d';
import { adventureProgress, LEVELS_PER_MILESTONE, MILESTONE_BOSSES, levelDef } from './adventure';
import type { BossMove } from './adventure';
import { playerName } from './leaderboard';

export interface CharDef {
  id: string;
  name?: string; // personal name — only runners without a boss title carry one
  body: number;
  skin: number;
  shape?: BeanShape; // default 'bean'
  gear?: BeanGear; // default 'none' — the cast wears NOTHING; marks only
  marks?: BeanMarks; // painted regalia — strip, bead dots, footwear
  rage?: boolean; // angry brows
  furLen?: number; // coat strand multiplier — 1 = standard
  unlockAt?: number; // milestone boss (1..50) that frees this runner — unset = free
}

// the cast IS the beaten champion — a gated runner's name is the boss's
// title (charTitle), not a person. Only the free hero keeps a name.
export const CHARACTERS: CharDef[] = [
  { id: 'koko', name: 'NGOZI', body: 0x8a4f24, skin: 0xecc98e }, // the hero — classic chocolate, yours from GO
  {
    id: 'agbalumo',
    body: 0xf2eee2, // the white agbada read — the coat IS the robe
    skin: 0xf2d9a6,
    shape: 'round', // the Baale's settled frame
    unlockAt: 3, // BAALE OF SURULERE
    marks: {
      strip: 0x2f2b6e, // indigo aso-oke embroidery down the chest
      bead: 0xe8622a, // coral dots at the collar — a chief's station
      shoe: 0x2f2b6e, // indigo sandals
      line: 0xbfe8f4, // icy sleeve tips — he holds the stop for ICE
    },
  },
  {
    id: 'kola',
    body: 0x1f5a5a, // deep riverine teal — the water-king's coat
    skin: 0xd9ad78,
    unlockAt: 6, // AYANGBUREN OF IKORODU — the water-king of the riverine town
    marks: {
      strip: 0xd9a02a, // gold aso-oke — Oba-tier embroidery
      bead: 0xe8622a, // coral
      shoe: 0x143d3d,
      line: 0xbfe8f4,
    },
  },
  {
    id: 'zobo',
    body: 0x9a4526, // fired terracotta — a mainland Baale's clay
    skin: 0xecc4a0,
    shape: 'tall', // the lanky elder of Agege
    unlockAt: 9, // BAALE OF AGEGE
    marks: {
      strip: 0x2f2b6e, // indigo aso-oke — the Baale strip, same as Surulere
      bead: 0xe8622a,
      shoe: 0x6e3a1e,
      line: 0xbfe8f4,
    },
  },
  {
    id: 'palmie',
    body: 0x4f6b35, // war-camp green — Ibadan was a soldiers' settlement
    skin: 0xe2cf9e,
    unlockAt: 12, // OLUBADAN OF IBADAN — paramount Oba
    marks: {
      strip: 0xd9a02a, // gold embroidery
      bead: 0xe8622a,
      shoe: 0x354d24,
      line: 0xbfe8f4,
    },
  },
  {
    id: 'asphalt',
    body: 0x6e2f45, // royal wine — the Deji's coral kingdom made cloth
    skin: 0xcfc8b8,
    unlockAt: 15, // DEJI OF AKURE — last of the summoners
    marks: {
      strip: 0xd9a02a,
      bead: 0xe8622a, // Akure wears its coral heavy
      shoe: 0x4a2030,
      line: 0xbfe8f4,
    },
  },
  {
    id: 'danfo',
    body: 0xcf9a1f, // ochre gold — riverine royalty on the Niger
    skin: 0xf2dfae,
    rage: true, // the first rager — his brows say the move before it fires
    unlockAt: 20, // ASAGBA OF ASABA
    marks: {
      strip: 0x2f2b6e, // indigo on gold — the contrast reads royal
      bead: 0xe8622a,
      shoe: 0x7a4a10,
      line: 0xbfe8f4,
    },
  },
  {
    id: 'agbero',
    body: 0x7a2333, // ishi-agu crimson — the lion-head tunic's deep red
    skin: 0xe0bd92,
    rage: true,
    unlockAt: 25, // IGWE OF UMUAHIA
    marks: {
      strip: 0xd9a02a, // gold on red — how the tunic actually reads
      bead: 0xe8622a,
      shoe: 0x4f1a22,
      line: 0xbfe8f4,
    },
  },
  {
    id: 'oba',
    body: 0x5a3a6a, // royal purple — Efik kingship
    skin: 0xe8c9a0,
    shape: 'round',
    rage: true,
    unlockAt: 30, // OBONG OF CALABAR
    marks: {
      strip: 0xd9a02a,
      bead: 0xe8622a,
      shoe: 0x3a2547,
      line: 0xbfe8f4,
    },
  },
  {
    id: 'indigo',
    body: 0x3d3a8c, // Kofar Mata dye-pit indigo
    skin: 0xdfb184,
    shape: 'tall', // the austere frame — northern robes fall long
    unlockAt: 40, // EMIR OF KANO — the blink phantom
    marks: {
      strip: 0x9fc8e0, // pale sky — the babbar riga's pocket-stitch thread
      shoe: 0x2a2660,
      line: 0xbfe8f4,
      // no bead — Emirs don't wear coral; the omission IS the tier
    },
  },
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
