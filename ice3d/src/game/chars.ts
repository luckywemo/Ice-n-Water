// The cast — ported from the original src/characters.ts so the 3D
// version is the same family: same coats, shapes, regalia marks.
export type BeanShape = 'bean' | 'round' | 'tall';
export type BeanGear = 'none' | 'cap' | 'hardhat' | 'band' | 'spikes' | 'crown' | 'frost';
export interface BeanMarks { strip?: number; bead?: number; shoe?: number; line?: number }
export interface CharDef {
  id: string;
  name?: string;
  body: number;
  skin: number;
  shape?: BeanShape;
  gear?: BeanGear;
  marks?: BeanMarks;
  rage?: boolean;
  unlockAt?: number; // kept for the future campaign hookup
}

export const CHARACTERS: CharDef[] = [
  { id: 'koko', name: 'NGOZI', body: 0x8a4f24, skin: 0xecc98e }, // the hero — yours from GO
  {
    id: 'agbalumo', body: 0xf2eee2, skin: 0xf2d9a6, shape: 'round', unlockAt: 3,
    marks: { strip: 0x2f2b6e, bead: 0xe8622a, shoe: 0x2f2b6e, line: 0xbfe8f4 },
  },
  {
    id: 'kola', body: 0x1f5a5a, skin: 0xd9ad78, unlockAt: 6,
    marks: { strip: 0xd9a02a, bead: 0xe8622a, shoe: 0x143d3d, line: 0xbfe8f4 },
  },
  {
    id: 'zobo', body: 0x9a4526, skin: 0xecc4a0, shape: 'tall', unlockAt: 9,
    marks: { strip: 0x2f2b6e, bead: 0xe8622a, shoe: 0x6e3a1e, line: 0xbfe8f4 },
  },
  {
    id: 'palmie', body: 0x4f6b35, skin: 0xe2cf9e, unlockAt: 12,
    marks: { strip: 0xd9a02a, bead: 0xe8622a, shoe: 0x354d24, line: 0xbfe8f4 },
  },
  {
    id: 'asphalt', body: 0x6e2f45, skin: 0xcfc8b8, unlockAt: 15,
    marks: { strip: 0xd9a02a, bead: 0xe8622a, shoe: 0x4a2030, line: 0xbfe8f4 },
  },
  {
    id: 'danfo', body: 0xcf9a1f, skin: 0xf2dfae, rage: true, unlockAt: 20,
    marks: { strip: 0x2f2b6e, bead: 0xe8622a, shoe: 0x7a4a10, line: 0xbfe8f4 },
  },
  {
    id: 'agbero', body: 0x7a2333, skin: 0xe0bd92, rage: true, unlockAt: 25,
    marks: { strip: 0xd9a02a, bead: 0xe8622a, shoe: 0x3d1420, line: 0xbfe8f4 },
  },
  {
    id: 'oba', body: 0x5a3a6a, skin: 0xe8c9a0, shape: 'round', unlockAt: 30,
    marks: { strip: 0xd9a02a, bead: 0xe8622a, shoe: 0x3d2648, line: 0xbfe8f4 },
  },
  {
    id: 'indigo', body: 0x3d3a8c, skin: 0xc9a878, shape: 'tall', unlockAt: 40,
    marks: { strip: 0xd9a02a, bead: 0xe8622a, shoe: 0x2a2870, line: 0xbfe8f4 },
  },
];

export const CREW_DEF: CharDef = { id: 'crew', name: 'CREW', body: 0x2e6f8e, skin: 0xe8c9a0 };
export const MILITIA_DEF: CharDef = {
  id: 'militia', name: 'MILITIA', body: 0x9ccfe8, skin: 0xbfe0f0,
  gear: 'frost', rage: true,
};

// the crew's rescue personalities — same odds as the 2D game's
// COME-SAVE-ME roster: Ngozi always comes, Emeka never does.
export interface CrewMate { name: string; brave: number; def: CharDef }
export const ICE_CREW: CrewMate[] = [
  { name: 'NGOZI', brave: 1.0, def: CHARACTERS[0] },
  { name: 'FATIMA', brave: .8, def: CHARACTERS[3] },
  { name: 'TUNDE', brave: .6, def: CHARACTERS[6] },
  { name: 'EMEKA', brave: .25, def: CHARACTERS[2] },
];
export const MILITIA_NAMES = ['CHIDI', 'BLESSING', 'YUSUF', 'KEMI', 'OBI', 'SOLA', 'AMARA'];

export const charDefById = (id: string) => CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];

// inherited boss moves — the same chain as the 2D game:
// early thrones grant SUMMON, mid RAGE, the last grant BLINK.
export type CharMove = 'summon' | 'rage' | 'blink';
export const charMove = (id: string): CharMove => {
  const u = charDefById(id).unlockAt ?? 0;
  return u >= 40 ? 'blink' : u >= 20 ? 'rage' : 'summon';
};
