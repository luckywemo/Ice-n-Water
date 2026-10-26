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
}

export const CHARACTERS: CharDef[] = [
  { id: 'koko', name: 'KOKO', body: 0x8a4f24, skin: 0xecc98e }, // the original — milk chocolate
  { id: 'agbalumo', name: 'AGBALUMO', body: 0xb56a26, skin: 0xf2d9a6, shape: 'round' }, // star apple — chubby
  { id: 'kola', name: 'KOLA', body: 0x553219, skin: 0xd9ad78 }, // dark roast
  { id: 'zobo', name: 'ZOBO', body: 0x8a2f3d, skin: 0xecc4a0, shape: 'tall' }, // hibiscus red — lanky
  { id: 'palmie', name: 'PALMIE', body: 0x4f6b35, skin: 0xe2cf9e, gear: 'band' }, // palm green + sweatband
  { id: 'asphalt', name: 'ASPHALT', body: 0x3a3a44, skin: 0xcfc8b8, gear: 'hardhat' }, // site grey + helmet
  { id: 'danfo', name: 'DANFO', body: 0xcf9a1f, skin: 0xf2dfae, gear: 'cap' }, // bus yellow + conductor cap
  { id: 'agbero', name: 'AGBERO', body: 0x6e4a2f, skin: 0xe0bd92, gear: 'spikes' }, // street punk — mohawk
  { id: 'oba', name: 'OBA', body: 0x5a3a6a, skin: 0xe8c9a0, shape: 'round', gear: 'crown' }, // the king — royal purple
];

// fixed team coats — the player's pick never collides with these
export const CREW_DEF: CharDef = { id: 'crew', name: 'CREW', body: 0x2e6f8e, skin: 0xe8c9a0 }; // water blue
export const MILITIA_DEF: CharDef = { id: 'militia', name: 'MILITIA', body: 0x54503e, skin: 0xb8a888, gear: 'hardhat' }; // khaki uniform + site helmet

const KEY = 'iw-char';

export function currentChar(): CharDef {
  const id = localStorage.getItem(KEY);
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

export function setChar(id: string) {
  localStorage.setItem(KEY, id);
}
