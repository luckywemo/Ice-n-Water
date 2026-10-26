// playable bean cast — every character is the same rig re-dressed in a
// different coat. body = the vinyl/fur colour, skin = the face oval.
export interface CharDef {
  id: string;
  name: string;
  body: number;
  skin: number;
}

export const CHARACTERS: CharDef[] = [
  { id: 'koko', name: 'KOKO', body: 0x8a4f24, skin: 0xecc98e }, // the original — milk chocolate
  { id: 'agbalumo', name: 'AGBALUMO', body: 0xb56a26, skin: 0xf2d9a6 }, // african star apple — bright orange-brown
  { id: 'kola', name: 'KOLA', body: 0x553219, skin: 0xd9ad78 }, // dark roast
  { id: 'zobo', name: 'ZOBO', body: 0x8a2f3d, skin: 0xecc4a0 }, // hibiscus red
  { id: 'palmie', name: 'PALMIE', body: 0x4f6b35, skin: 0xe2cf9e }, // palm green
  { id: 'asphalt', name: 'ASPHALT', body: 0x3a3a44, skin: 0xcfc8b8 }, // slate — street grey
];

// fixed team coats — the player's pick never collides with these
export const CREW_DEF: CharDef = { id: 'crew', name: 'CREW', body: 0x2e6f8e, skin: 0xe8c9a0 }; // water blue
export const MILITIA_DEF: CharDef = { id: 'militia', name: 'MILITIA', body: 0x54503e, skin: 0xb8a888 }; // khaki uniform

const KEY = 'iw-char';

export function currentChar(): CharDef {
  const id = localStorage.getItem(KEY);
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

export function setChar(id: string) {
  localStorage.setItem(KEY, id);
}
