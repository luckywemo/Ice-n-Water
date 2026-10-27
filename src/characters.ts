// playable bean cast — every character is the same rig re-dressed:
// body = vinyl/fur colour, skin = face oval, shape = body silhouette,
// gear = head-mounted extra. Shape/gear change the actual MODEL, not
// just the paint — they build different meshes on the shared skeleton.
import type { BeanGear, BeanShape } from './hero3d';

export interface CharDef {
  id: string;
  name: string;
  body: number;
  skin: number;
  shape?: BeanShape; // default 'bean'
  gear?: BeanGear; // default 'none'
  rage?: boolean; // angry brows
  furLen?: number; // coat strand multiplier — 1 = standard
}

// the cast takes the named crew's names — every bean is a person, not a
// flavour. Geared models get themed names from the same world.
export const CHARACTERS: CharDef[] = [
  { id: 'koko', name: 'NGOZI', body: 0x8a4f24, skin: 0xecc98e }, // the hero — classic chocolate
  { id: 'agbalumo', name: 'EMEKA', body: 0xb56a26, skin: 0xf2d9a6, shape: 'round' }, // the coward — chubby
  { id: 'kola', name: 'CHIDI', body: 0x553219, skin: 0xd9ad78 }, // steady — dark roast
  { id: 'zobo', name: 'FATIMA', body: 0x8a2f3d, skin: 0xecc4a0, shape: 'tall' }, // the smart one — lanky red
  { id: 'palmie', name: 'TUNDE', body: 0x4f6b35, skin: 0xe2cf9e, gear: 'band' }, // reckless sprinter + sweatband
  { id: 'asphalt', name: 'BLESSING', body: 0x3a3a44, skin: 0xcfc8b8, gear: 'hardhat' }, // the hustler + site helmet
  { id: 'danfo', name: 'MUSA', body: 0xcf9a1f, skin: 0xf2dfae, gear: 'cap' }, // the conductor — bus yellow + cap
  { id: 'agbero', name: 'SULE', body: 0x6e4a2f, skin: 0xe0bd92, gear: 'spikes' }, // the tout — mohawk
  { id: 'oba', name: 'ADE', body: 0x5a3a6a, skin: 0xe8c9a0, shape: 'round', gear: 'crown' }, // royal purple — Ade means crown
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

export function currentChar(): CharDef {
  const p = currentPick();
  const def = CHARACTERS.find((c) => c.id === p.id) ?? CHARACTERS[0];
  return p.body === undefined ? def : { ...def, body: p.body };
}

// body omitted → keep the current coat paint; null → clear the override
export function setChar(id: string, body?: number | null) {
  const keep = body === undefined ? currentPick().body : body ?? undefined;
  localStorage.setItem(KEY, JSON.stringify(keep === undefined ? { id } : { id, body: keep }));
}
