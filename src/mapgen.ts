import { CONFIG } from './config';

// Seeded map layouts — same seed → same neighborhood on every client,
// so the server only has to send one number for everyone to agree on
// the round's terrain. Three archetypes rotate by seed.

export interface ObstacleRect {
  x: number; // center-based, like the old config.obstacles
  y: number;
  w: number;
  h: number;
}

/** mulberry32 — small deterministic RNG */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateLayout(seed: number): ObstacleRect[] {
  const { width, height, wall } = CONFIG.arena;
  const rand = seededRng(seed);
  const pick = (a: number, b: number) => a + rand() * (b - a);

  const rects: ObstacleRect[] = [];
  const GAP = 88; // guaranteed lane width between obstacles

  const overlaps = (x: number, y: number, rw: number, rh: number) =>
    rects.some(
      (r) =>
        Math.abs(r.x - x) * 2 < r.w + rw + GAP * 2 &&
        Math.abs(r.y - y) * 2 < r.h + rh + GAP * 2,
    );
  // keep-out: the chaser muster line (bottom-center) stays clear for spawns
  const keepOut = (x: number, y: number, rw: number, rh: number) =>
    y + rh / 2 > height - 200 && Math.abs(x - width / 2) < 380;
  const inside = (x: number, y: number, rw: number, rh: number) =>
    x - rw / 2 > wall + 60 &&
    x + rw / 2 < width - wall - 60 &&
    y - rh / 2 > wall + 60 &&
    y + rh / 2 < height - wall - 60;
  const ok = (x: number, y: number, rw: number, rh: number) =>
    inside(x, y, rw, rh) && !keepOut(x, y, rw, rh) && !overlaps(x, y, rw, rh);
  const tryAdd = (x: number, y: number, rw: number, rh: number) => {
    if (ok(x, y, rw, rh)) {
      rects.push({ x, y, w: rw, h: rh });
      return true;
    }
    return false;
  };

  const archetype = Math.floor(rand() * 3);

  if (archetype === 0) {
    // STREET BLOCKS — a loose 4×3 grid of buildings; the gaps between
    // them become the alleys you duck through mid-chase
    const cols = 4;
    const rows = 3;
    const iw = width - wall * 2 - 120;
    const ih = height - wall * 2 - 120;
    const cellW = iw / cols;
    const cellH = ih / rows;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (rand() < 0.22) continue; // punch a hole — a plaza
        const rw = pick(cellW * 0.45, cellW * 0.68);
        const rh = pick(cellH * 0.45, cellH * 0.68);
        const x = wall + 60 + cellW * (cx + 0.5) + pick(-cellW * 0.1, cellW * 0.1);
        const y = wall + 60 + cellH * (cy + 0.5) + pick(-cellH * 0.1, cellH * 0.1);
        tryAdd(x, y, rw, rh);
      }
    }
  } else if (archetype === 1) {
    // COMPOUNDS — a few L-shaped walls; natural chokepoints + blind corners
    const clusters = 5;
    for (let i = 0; i < clusters; i++) {
      const cw = pick(240, 340);
      const ch = pick(200, 300);
      const cx = pick(wall + 260, width - wall - 260);
      const cyy = pick(wall + 240, height - wall - 240);
      if (!ok(cx, cyy, cw, ch)) continue;
      // vertical leg + horizontal foot — the "L"
      const legW = 66;
      const footH = 66;
      const flipX = rand() < 0.5;
      const flipY = rand() < 0.5;
      rects.push({
        x: cx + (flipX ? 1 : -1) * (cw / 2 - legW / 2),
        y: cyy,
        w: legW,
        h: ch,
      });
      rects.push({
        x: cx,
        y: cyy + (flipY ? 1 : -1) * (ch / 2 - footH / 2),
        w: cw,
        h: footH,
      });
    }
  } else {
    // SCATTER — crates, market stalls, parked wahala all over the yard
    for (let i = 0; i < 26; i++) {
      const rw = pick(60, 210);
      const rh = pick(46, 160);
      tryAdd(
        pick(wall + 140, width - wall - 140),
        pick(wall + 130, height - wall - 130),
        rw,
        rh,
      );
    }
  }

  return rects;
}
