// Fall Guys-style UI kit — candy palette, pattern backdrops, chunky widgets.
// Our identity (ICE 'N' WATER / the road north) rendered in their visual language.
import { shade, panel, pillButton, domInput, UI, UI_FONT, DISPLAY_FONT } from './ui';

export const FG_FONT = '"Titan One", "Baloo 2", sans-serif';
export const FG_BODY = '"Baloo 2", "Fredoka", sans-serif';

export const FG = {
  yellow: 0xf7bd14,
  yellowRing: 0xeaa910,
  pink: 0xe84393,
  pinkDeep: 0x9c2160,
  cyan: 0x2bb8f0,
  cyanDeep: 0x0f7fb8,
  sky: 0x62c8f2,
  ink: 0x1a1a22,
  bar: 0x17151f,
  paper: 0xffffff,
  cream: 0xfff6e0,
  podiumTop: 0xf06ac8,
  podiumSide: 0xb8329b,
  gold: 0xffd54a,
};

const rrect = (
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => g.fillRoundedRect(x, y, w, h, Math.min(r, h / 2, w / 2));

// ------- backdrop: base fill + soft concentric rings radiating from a center -------
export function fgRings(
  scene: Phaser.Scene,
  vw: number,
  vh: number,
  cx: number,
  cy: number,
  base: number = FG.yellow,
  ring: number = FG.yellowRing,
) {
  const g = scene.add.graphics().setDepth(-10);
  // symmetric overscan — the visible region outgrows the stage on both axes
  // under a letterboxed zoom (and under camera zoom for scrollFactor(0))
  g.fillStyle(base, 1).fillRect(-vw * 0.4, -vh * 0.5, vw * 1.8, vh * 2);
  const z = scene.cameras.main.zoom || 1;
  const maxR = (Math.hypot(Math.max(cx, vw - cx), Math.max(cy, vh - cy)) + 80) / z;
  for (let r = 58; r < maxR; r += 58) {
    g.lineStyle(34, ring, 0.28).strokeCircle(cx, cy, r);
    g.lineStyle(7, ring, 0.15).strokeCircle(cx, cy, r + 30);
  }
  return g;
}

// ------- menu backdrop: lobby yellow + rings, fills the whole viewport -------
export function fgBackdrop(
  scene: Phaser.Scene,
  w: number,
  h: number,
  cx = w / 2,
  cy = h * 0.45,
) {
  scene.cameras.main.setBackgroundColor(FG.yellow);
  return fgRings(scene, w, h, cx, cy);
}

// ------- crown pattern tile (splash) -------
export function bakeCrownTile(scene: Phaser.Scene) {
  const key = 'fg_crowns';
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, 240, 240);
  const c = tex?.getContext();
  if (!c) return key;
  c.fillStyle = '#f7bd14';
  c.fillRect(0, 0, 240, 240);
  c.strokeStyle = 'rgba(120,70,0,0.18)';
  c.lineWidth = 3;
  c.lineJoin = 'round';
  const crown = (x: number, y: number, s: number, rot: number) => {
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.scale(s, s);
    c.beginPath();
    c.moveTo(-16, 10);
    c.lineTo(-16, -4);
    c.lineTo(-8, 2);
    c.lineTo(-4, -10);
    c.lineTo(0, 0);
    c.lineTo(4, -10);
    c.lineTo(8, 2);
    c.lineTo(16, -4);
    c.lineTo(16, 10);
    c.closePath();
    c.stroke();
    c.restore();
  };
  crown(60, 60, 1, 0.12);
  crown(180, 50, 0.8, -0.18);
  crown(120, 140, 1.1, 0.08);
  crown(40, 200, 0.85, -0.1);
  crown(200, 190, 0.95, 0.16);
  crown(220, 110, 0.7, 0.3);
  crown(10, 120, 0.75, -0.28);
  tex!.refresh();
  return key;
}

// ------- one crown outline stamp (same path as bakeCrownTile, for graphics) -------
function fgCrown(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  s: number,
  rot: number,
  color = 0x784600,
) {
  const PATH = [
    [-16, 10], [-16, -4], [-8, 2], [-4, -10], [0, 0],
    [4, -10], [8, 2], [16, -4], [16, 10], [-16, 10],
  ];
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  g.lineStyle(3, color, 0.18).strokePoints(
    PATH.map(([px, py]) => ({
      x: x + (px * cos - py * sin) * s,
      y: y + (px * sin + py * cos) * s,
    })),
  );
}

// ------- modal underlay: the ONLINE field — yellow, rings, crown stamps -------
// Deterministic stamp grid (no Math.random in render paths). Draws the field
// opaque; callers put a light veil over it if they want modal separation.
export function fgCrownField(
  scene: Phaser.Scene,
  vw: number,
  vh: number,
  cx = vw / 2,
  cy = vh * 0.45,
  base: number = FG.yellow,
  ring: number = FG.yellowRing,
  crown = 0x784600,
) {
  const g = fgRings(scene, vw, vh, cx, cy, base, ring); // opaque fill + rings
  // sf0 objects still scale about the view centre under camera zoom — the
  // stamp grid must overscan into negative space like fgRings' fill does
  const step = 170;
  let i = 0;
  for (let y = -vh * 0.5; y < vh * 1.5; y += step) {
    for (let x = -vw * 0.4; x < vw * 1.4; x += step, i++) {
      fgCrown(
        g,
        x + ((i * 37) % 60) - 30,
        y + ((i * 53) % 50) - 25,
        0.85 + ((i * 29) % 35) / 100,
        (((i * 31) % 60) - 30) / 100,
        crown,
      );
    }
  }
  return g;
}

// ------- icon glyph drawing (top-bar buttons) -------
export type FgIcon = 'play' | 'share' | 'online' | 'board' | 'gear' | 'hanger' | 'sliders' | 'cart' | 'edit' | 'back';

export function drawFgIcon(
  g: Phaser.GameObjects.Graphics,
  type: FgIcon,
  cx: number,
  cy: number,
  s: number,
  color = 0xffffff,
) {
  g.fillStyle(color, 1).lineStyle(Math.max(2, s * 0.14), color, 1);
  switch (type) {
    case 'play':
      g.fillTriangle(cx - s * 0.32, cy - s * 0.45, cx - s * 0.32, cy + s * 0.45, cx + s * 0.48, cy);
      break;
    case 'share':
      // arrow arcing up-right out of a box
      g.lineStyle(Math.max(2.5, s * 0.16), color, 1);
      g.strokeRoundedRect(cx - s * 0.45, cy - s * 0.05, s * 0.6, s * 0.5, s * 0.1);
      g.beginPath();
      g.moveTo(cx - s * 0.05, cy + s * 0.15);
      g.lineTo(cx + s * 0.12, cy - s * 0.28);
      g.lineTo(cx + s * 0.42, cy - s * 0.26);
      g.strokePath();
      g.fillTriangle(
        cx + s * 0.3, cy - s * 0.42,
        cx + s * 0.52, cy - s * 0.3,
        cx + s * 0.28, cy - s * 0.18,
      );
      break;
    case 'online':
      g.fillCircle(cx - s * 0.26, cy - s * 0.18, s * 0.26);
      g.fillCircle(cx + s * 0.28, cy - s * 0.22, s * 0.2);
      rrect(g, cx - s * 0.52, cy + s * 0.12, s * 0.52, s * 0.42, s * 0.16);
      rrect(g, cx + s * 0.06, cy + s * 0.08, s * 0.44, s * 0.36, s * 0.14);
      break;
    case 'board':
      // trophy cup
      rrect(g, cx - s * 0.3, cy - s * 0.4, s * 0.6, s * 0.44, s * 0.14);
      g.fillRect(cx - s * 0.08, cy + s * 0.02, s * 0.16, s * 0.22);
      rrect(g, cx - s * 0.26, cy + s * 0.24, s * 0.52, s * 0.12, s * 0.05);
      break;
    case 'hanger': {
      // clothes hanger — hook up top, triangle body
      g.lineStyle(Math.max(2.5, s * 0.16), color, 1);
      g.strokeCircle(cx, cy - s * 0.3, s * 0.12); // hook
      g.beginPath();
      g.moveTo(cx, cy - s * 0.18);
      g.lineTo(cx, cy - s * 0.05);
      g.strokePath();
      g.beginPath();
      g.moveTo(cx, cy - s * 0.05);
      g.lineTo(cx - s * 0.45, cy + s * 0.42);
      g.lineTo(cx + s * 0.45, cy + s * 0.42);
      g.closePath();
      g.strokePath();
      break;
    }
    case 'sliders': {
      // three horizontal faders, knobs at staggered positions
      g.lineStyle(Math.max(2.5, s * 0.14), color, 1);
      const rows = [-0.32, 0, 0.32];
      const knobs = [-0.15, 0.28, -0.3];
      rows.forEach((dy, i) => {
        g.lineBetween(cx - s * 0.42, cy + s * dy, cx + s * 0.42, cy + s * dy);
        g.fillCircle(cx + s * knobs[i], cy + s * dy, s * 0.14);
      });
      break;
    }
    case 'cart': {
      // shopping cart — basket trapezoid + handle + wheels
      g.lineStyle(Math.max(2.5, s * 0.14), color, 1);
      g.beginPath();
      g.moveTo(cx - s * 0.5, cy - s * 0.32);
      g.lineTo(cx - s * 0.32, cy - s * 0.32);
      g.strokePath();
      g.beginPath();
      g.moveTo(cx - s * 0.32, cy - s * 0.32);
      g.lineTo(cx - s * 0.2, cy + s * 0.18);
      g.lineTo(cx + s * 0.42, cy + s * 0.18);
      g.lineTo(cx + s * 0.5, cy - s * 0.22);
      g.lineTo(cx - s * 0.26, cy - s * 0.22);
      g.strokePath();
      g.fillCircle(cx - s * 0.1, cy + s * 0.4, s * 0.09);
      g.fillCircle(cx + s * 0.32, cy + s * 0.4, s * 0.09);
      break;
    }
    case 'edit': {
      // pencil — fat diagonal stroke + tip
      g.lineStyle(Math.max(3, s * 0.2), color, 1);
      g.lineBetween(cx - s * 0.26, cy + s * 0.26, cx + s * 0.16, cy - s * 0.16);
      g.fillTriangle(
        cx + s * 0.22, cy - s * 0.46,
        cx + s * 0.44, cy - s * 0.24,
        cx + s * 0.1, cy - s * 0.12,
      );
      break;
    }
    case 'gear': {
      g.fillCircle(cx, cy, s * 0.3);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.fillRect(
          cx + Math.cos(a) * s * 0.34 - s * 0.06,
          cy + Math.sin(a) * s * 0.34 - s * 0.06,
          s * 0.12,
          s * 0.12,
        );
      }
      g.fillStyle(0, 0.35).fillCircle(cx, cy, s * 0.13);
      break;
    }
    case 'back': {
      // chunky return arrow — stem + head pointing left
      g.lineStyle(Math.max(3, s * 0.22), color, 1);
      g.lineBetween(cx - s * 0.1, cy, cx + s * 0.34, cy);
      g.fillTriangle(
        cx - s * 0.5, cy,
        cx - s * 0.02, cy - s * 0.34,
        cx - s * 0.02, cy + s * 0.34,
      );
      break;
    }
  }
}

// ------- top bar: LOBBY + icon row + currency counters -------
export function fgTopBar(
  scene: Phaser.Scene,
  vw: number,
  items: { icon: FgIcon; active?: boolean; onDown: () => void }[],
  counters: { crown: number; star: number },
  opts?: { label?: string; scrollLock?: boolean; y0?: number; xL?: number; xR?: number },
) {
  const ui: { setScrollFactor: (n: number) => unknown }[] = [];
  const H = 46;
  // edge anchors — letterboxed stages push stage edges inside the window;
  // callers pass the visible left/right so the bar hugs the real frame
  const exL = opts?.xL ?? 0;
  const exR = opts?.xR ?? vw;
  const g = scene.add.graphics().setDepth(30);
  g.fillStyle(FG.bar, 1).fillRect(exL - vw * 0.4, 0, (exR - exL) + vw * 0.8, H); // overscan — ultrawide margins stay black
  g.lineStyle(2, 0x000000, 0.5).lineBetween(exL - vw * 0.4, H - 1, exR + vw * 0.4, H - 1);
  ui.push(g);
  ui.push(
    scene.add
      .text(exL + 18, H / 2 + 1, opts?.label ?? 'LOBBY', {
        fontFamily: FG_FONT,
        fontSize: '27px',
        fontStyle: 'italic',
        color: '#ffffff',
      })
      .setOrigin(0, 0.5)
      .setDepth(31),
  );

  // centered icon row — first button wider, group ends chamfered "/" and "\"
  const bw = 46;
  const bh = 36;
  const gap = 8;
  const widths = items.map((_, i) => (i === 0 ? bw * 1.35 : bw));
  const total = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
  const bumper = (bx: number, label: string) =>
    scene.add
      .text(bx, H / 2 + 1, label, {
        fontFamily: FG_BODY,
        fontSize: '13px',
        fontStyle: '800',
        color: '#8a8a99',
      })
      .setOrigin(0.5)
      .setDepth(31);
  ui.push(bumper(vw / 2 - total / 2 - 34, 'LB'));
  ui.push(bumper(vw / 2 + total / 2 + 34, 'RB'));
  let x = vw / 2 - total / 2;
  const cham = 7; // "/" slant on the group's outer ends
  const iconBtns: { g: Phaser.GameObjects.Graphics; draw: (on: boolean) => void }[] = [];
  items.forEach((it, i) => {
    const w = widths[i];
    const b = scene.add.graphics().setDepth(31);
    const top = H / 2 - bh / 2;
    // chamfered silhouette: first's left edge and last's right edge slant
    const pts = [
      { x: i === 0 ? x + cham : x, y: top },
      { x: x + w, y: top },
      { x: i === items.length - 1 ? x + w - cham : x + w, y: top + bh },
      { x, y: top + bh },
    ];
    const base = pts.map((p) => ({ x: p.x, y: p.y + 2 }));
    const bx = x; // capture per-button — x is loop-carried; redrawing with the
    // shared x repaints sheen+icon at the row's far edge ("icon jumps away")
    const draw = (on: boolean) => {
      const fill = on ? FG.pink : FG.cyan; // pink = the active tab, like theirs
      b.clear();
      b.fillStyle(shade(fill, -55), 1).fillPoints(base, true);
      b.fillStyle(fill, 1).fillPoints(pts, true);
      b.lineStyle(2.5, 0xffffff, 0.9).strokePoints(pts, true); // thick white rim like theirs
      b.fillStyle(0xffffff, 0.18).fillRoundedRect(bx + 5, top + 3, w - 10, bh * 0.3, 5);
      drawFgIcon(b, it.icon, bx + w / 2, H / 2, 17);
    };
    draw(!!it.active);
    iconBtns.push({ g: b, draw });
    ui.push(b);
    ui.push(
      scene.add
        .zone(x, top, w, bh)
        .setOrigin(0, 0)
        .setDepth(32)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', it.onDown),
    );
    x += w + gap;
  });

  // counters — each in a dark inset chip: icon left, number right, with
  // real padding so neither hugs the edge and the two sit apart
  const chip = (
    iconX: number,
    val: number,
    drawIcon: (ig: Phaser.GameObjects.Graphics, cx: number, cy: number) => void,
    rx: number,
  ) => {
    const pad = 13,
      iconR = 11,
      gapX = 12;
    const t = scene.add
      .text(rx - pad, H / 2 + 1, `${val}`, {
        fontFamily: FG_BODY,
        fontSize: '17px',
        fontStyle: '800',
        color: '#ffffff',
      })
      .setOrigin(1, 0.5)
      .setDepth(31);
    const cw = pad + iconR * 2 + gapX + t.width + pad;
    const cx = rx - cw;
    g.fillStyle(0x000000, 0.4);
    g.fillRoundedRect(cx, H / 2 - 15, cw, 30, 8);
    g.lineStyle(2, 0xffffff, 0.55);
    g.strokeRoundedRect(cx + 1, H / 2 - 14, cw - 2, 28, 8);
    const ig = scene.add.graphics().setDepth(31);
    drawIcon(ig, cx + pad + iconR, H / 2);
    ui.push(t);
    ui.push(ig);
    return cx;
  };
  const starLeft = chip(0, counters.star, (ig, cx, cy) => {
    // purple coin — their kudos-credit glyph
    ig.fillStyle(0x8e3df5, 1).fillCircle(cx, cy, 10);
    ig.fillStyle(0xc07fff, 1).fillCircle(cx, cy, 6);
    ig.fillStyle(0xffffff, 0.7).fillCircle(cx - 2, cy - 2, 2.5);
  }, exR - 14);
  chip(0, counters.crown, (ig, cxx, cy) => {
    ig.fillStyle(FG.gold, 1);
    ig.fillTriangle(cxx - 8, cy + 4, cxx - 8, cy - 6, cxx - 3, cy - 1);
    ig.fillTriangle(cxx - 3, cy - 1, cxx, cy - 9, cxx + 3, cy - 1);
    ig.fillTriangle(cxx + 3, cy - 1, cxx + 8, cy - 6, cxx + 8, cy + 4);
    ig.fillRect(cxx - 8, cy + 4, 16, 3);
  }, starLeft - 16);

  // scroll-locked chrome for scenes whose camera moves (the map's rail)
  if (opts?.scrollLock) ui.forEach((o) => o.setScrollFactor(0));
  // y0 anchors the bar to a visible view edge — world-space bars under a
  // letterboxed stage zoom otherwise drift inside the composition
  if (opts?.y0)
    scene.add.container(
      0,
      opts.y0,
      ui as unknown as Phaser.GameObjects.GameObject[],
    );

  return {
    /** pink = the active tab — their SEASONS screen shows the live section pink */
    setActive(i: number, on: boolean) {
      iconBtns[i]?.draw(on);
    },
  };
}

// ------- big chunky button (PLAY!) -------
export function fgButton(
  scene: Phaser.Scene,
  cx: number,
  cy: number,
  w: number,
  h: number,
  label: string,
  opts: {
    fill?: number;
    icon?: 'dot' | 'none';
    slant?: boolean;
    fontSize?: number;
    textColor?: string;
    onDown: () => void;
  },
) {
  const fill = opts.fill ?? FG.pink;
  const c = scene.add.container(cx, cy).setDepth(20);
  const g = scene.add.graphics();
  const S = opts.slant ? Math.round(h * 0.24) : 0;
  let tx = 0;
  if (opts.slant) {
    // their PLAY! bar — left edge is a "/" slant (parallelogram like the
    // top-bar buttons), rounded joints, right end cropped off-frame
    const xr = (w + S) / 2;
    const xb = -(w + S) / 2;
    const xt = xb + S;
    const ty = -h / 2;
    const by = h / 2 - 4;
    const R = Math.min(16, Math.round(h * 0.18));
    // vertices A(top-left) B(top-right) C(bottom-right) D(bottom-left)
    const A = { x: xt, y: ty };
    const B = { x: xr, y: ty };
    const C = { x: xr, y: by };
    const D = { x: xb, y: by };
    const norm = (v: { x: number; y: number }) => {
      const l = Math.hypot(v.x, v.y) || 1;
      return { x: v.x / l, y: v.y / l };
    };
    // rounded-corner arc points between the two edge tangent points
    const corner = (
      V: { x: number; y: number },
      P: { x: number; y: number },
      N: { x: number; y: number },
    ) => {
      const uPrev = norm({ x: P.x - V.x, y: P.y - V.y });
      const uNext = norm({ x: N.x - V.x, y: N.y - V.y });
      const cosA = uPrev.x * uNext.x + uPrev.y * uNext.y;
      const half = Math.acos(Math.min(1, Math.max(-1, cosA))) / 2;
      const tanD = R / Math.tan(half);
      const bs = norm({ x: uPrev.x + uNext.x, y: uPrev.y + uNext.y });
      const cc = { x: V.x + bs.x * (R / Math.sin(half)), y: V.y + bs.y * (R / Math.sin(half)) };
      const t1 = { x: V.x + uPrev.x * tanD, y: V.y + uPrev.y * tanD };
      const t2 = { x: V.x + uNext.x * tanD, y: V.y + uNext.y * tanD };
      const a1 = Math.atan2(t1.y - cc.y, t1.x - cc.x);
      const a2 = Math.atan2(t2.y - cc.y, t2.x - cc.x);
      let da = a2 - a1;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const pts = [t1];
      for (let i = 1; i < 6; i++) {
        const a = a1 + (da * i) / 6;
        pts.push({ x: cc.x + Math.cos(a) * R, y: cc.y + Math.sin(a) * R });
      }
      pts.push(t2);
      return { t1, t2, pts };
    };
    const cA = corner(A, D, B);
    const cD = corner(D, C, A);
    const face = [
      cA.t2,
      B,
      C,
      cD.t1,
      ...cD.pts.slice(1),
      cA.t1,
      ...cA.pts.slice(1),
    ];
    g.fillStyle(shade(fill, -52), 1);
    g.fillPoints(face.map((p) => ({ x: p.x, y: p.y + 5 })), true);
    g.fillStyle(fill, 1);
    g.fillPoints(face, true);
    g.lineStyle(3, 0xffffff, 0.9);
    g.strokePoints(face, true);
    // top sheen following the slant
    const hs = (by - ty) * 0.36;
    g.fillStyle(0xffffff, 0.2);
    g.fillPoints(
      [
        { x: xt + R * 0.6, y: ty + 6 },
        { x: xr - 10, y: ty + 6 },
        { x: xr - 10, y: ty + 6 + hs },
        { x: xb + R * 0.6 + 8, y: ty + 6 + hs },
      ],
      true,
    );
    tx = h * 0.16;
  } else {
    g.fillStyle(shade(fill, -52), 1);
    rrect(g, -w / 2, -h / 2 + 5, w, h, h / 2);
    g.fillStyle(fill, 1);
    rrect(g, -w / 2, -h / 2, w, h - 4, h / 2);
    g.lineStyle(2.5, 0xffffff, 0.9);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h - 4, h / 2);
    g.fillStyle(0xffffff, 0.22);
    rrect(g, -w / 2 + 8, -h / 2 + 5, w - 16, h * 0.34, h * 0.17);
  }
  c.add(g);
  if (opts.icon === 'dot') {
    const ax = opts.slant ? -w / 2 + S / 2 + h * 0.5 : -w / 2 + h * 0.52;
    const d = scene.add.graphics();
    d.fillStyle(FG.ink, 0.88).fillCircle(ax, -2, h * 0.34);
    c.add(d);
    // the "A" keycap letter inside the circle — Xbox-A green
    const a = scene.add
      .text(ax, -2, 'A', {
        fontFamily: FG_BODY,
        fontSize: `${Math.round(h * 0.36)}px`,
        fontStyle: '800',
        color: '#3ddb8f',
      })
      .setOrigin(0.5);
    c.add(a);
    tx = opts.slant ? h * 0.16 : h * 0.2;
  }
  const t = scene.add
    .text(tx, -3, label, {
      fontFamily: FG_FONT,
      fontSize: `${opts.fontSize ?? 26}px`,
      color: opts.textColor ?? '#ffffff',
    })
    .setOrigin(0.5)
    .setShadow(0, 4, '#a1126c', 0, true, false);
  c.add(t);
  const zw = opts.slant ? w + S + 20 : w;
  const z = scene.add
    .zone(cx - zw / 2, cy - h / 2, zw, h)
    .setOrigin(0, 0)
    .setDepth(21)
    .setInteractive({ useHandCursor: true });
  z.on('pointerdown', () => {
    scene.tweens.add({ targets: c, scaleY: 0.92, scaleX: 1.03, duration: 70, yoyo: true });
    opts.onDown();
  });
  return c;
}

// ------- hexagonal level badge + progress bar -------
export function fgHexBadge(
  scene: Phaser.Scene,
  cx: number,
  cy: number,
  r: number,
  label: string,
  fill: number = FG.pink,
) {
  const g = scene.add.graphics().setDepth(20);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  g.fillStyle(0xffffff, 1);
  g.fillPoints(pts.map(p => ({ x: cx + p.x * 1.16, y: cy + p.y * 1.16 })), true);
  g.fillStyle(shade(fill, -30), 1);
  g.fillPoints(pts.map(p => ({ x: cx + p.x, y: cy + p.y + 2 })), true);
  g.fillStyle(fill, 1);
  g.fillPoints(pts.map(p => ({ x: cx + p.x, y: cy + p.y })), true);
  const label_ = scene.add
    .text(cx, cy + 1, label, {
      fontFamily: FG_BODY,
      fontSize: `${Math.round(r * 1.05)}px`,
      fontStyle: '800',
      color: '#ffffff',
    })
    .setOrigin(0.5)
    .setDepth(21);
  return [g, label_];
}

export function fgProgressBar(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  countText: string,
) {
  const g = scene.add.graphics().setDepth(20);
  const sl = 16; // angled right cap like theirs
  // white outline — left end rounded (badge covers it), right end slanted
  g.fillStyle(0xffffff, 1).fillPoints(
    [
      { x: x - 4, y: y - 4 },
      { x: x + w + 4, y: y - 4 },
      { x: x + w + 4 - sl, y: y + h + 4 },
      { x: x - 4, y: y + h + 4 },
    ],
    true,
  );
  g.fillStyle(FG.ink, 0.92).fillPoints(
    [
      { x, y },
      { x: x + w, y },
      { x: x + w - sl, y: y + h },
      { x, y: y + h },
    ],
    true,
  );
  // white progress fill ending in a slanted pink tip
  const fw = Math.max(h * 1.4, w * Math.min(1, Math.max(0.02, frac)));
  g.fillStyle(0xffffff, 1).fillPoints(
    [
      { x, y },
      { x: x + fw, y },
      { x: x + fw - sl, y: y + h },
      { x, y: y + h },
    ],
    true,
  );
  g.fillStyle(FG.pink, 1).fillPoints(
    [
      { x: x + fw - sl * 0.45, y },
      { x: x + fw, y },
      { x: x + fw - sl, y: y + h },
      { x: x + fw - sl * 0.45 - sl, y: y + h },
    ],
    true,
  );
  // count sits inside the bar, right end — like their 609/800
  const count = scene.add
    .text(x + w - sl - 10, y + h / 2 + 1, countText, {
      fontFamily: FG_BODY,
      fontSize: '15px',
      fontStyle: 'italic 800',
      color: '#ffffff',
    })
    .setOrigin(1, 0.5)
    .setDepth(21);
  return [g, count];
}

// ------- name plate (bottom-left, the "Fall Guy 2005" analog) -------
export function fgNamePlate(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  onDown: () => void,
) {
  const g = scene.add.graphics().setDepth(20);
  g.fillStyle(shade(FG.cyanDeep, -30), 1);
  rrect(g, x, y + 4, w, h, 10);
  g.fillStyle(FG.cyan, 1);
  rrect(g, x, y, w, h - 3, 10);
  g.lineStyle(2, 0xffffff, 0.5);
  g.strokeRoundedRect(x + 1.5, y + 1.5, w - 3, h - 6, 9);
  // crown glyph
  const cxx = x + 24;
  const cy = y + h / 2;
  g.fillStyle(FG.gold, 1);
  g.fillTriangle(cxx - 8, cy + 4, cxx - 8, cy - 5, cxx - 3, cy - 1);
  g.fillTriangle(cxx - 3, cy - 1, cxx, cy - 8, cxx + 3, cy - 1);
  g.fillTriangle(cxx + 3, cy - 1, cxx + 8, cy - 5, cxx + 8, cy + 4);
  g.fillRect(cxx - 8, cy + 4, 16, 3);
  const t = scene.add
    .text(x + 44, cy + 1, name, {
      fontFamily: FG_BODY,
      fontSize: '17px',
      fontStyle: 'italic 800',
      color: '#ffffff',
    })
    .setOrigin(0, 0.5)
    .setDepth(21);
  scene.add
    .zone(x, y, w, h)
    .setOrigin(0, 0)
    .setDepth(21)
    .setInteractive({ useHandCursor: true })
    .on('pointerdown', onDown);
  return t;
}

// ------- keycap hint — "Ⓟ PLAY ONLINE" (their "Ⓨ Invite Players" analog) -------
export function fgKeycapHint(
  scene: Phaser.Scene,
  x: number,
  y: number,
  key: string,
  label: string,
  onDown: () => void,
) {
  const g = scene.add.graphics().setDepth(20);
  g.fillStyle(FG.ink, 0.9).fillCircle(x, y, 12);
  g.lineStyle(2, 0xffffff, 0.85).strokeCircle(x, y, 12);
  const kt = scene.add
    .text(x, y + 1, key, { fontFamily: FG_BODY, fontSize: '13px', fontStyle: '800', color: '#f2c531' })
    .setOrigin(0.5)
    .setDepth(21);
  const lt = scene.add
    .text(x + 22, y + 1, label, {
      fontFamily: FG_BODY,
      fontSize: '18px',
      fontStyle: 'italic 800',
      color: '#ffffff',
    })
    .setOrigin(0, 0.5)
    .setDepth(21)
    .setShadow(0, 3, '#7a5800', 4, true, false);
  const w = 22 + lt.width + 14;
  scene.add
    .zone(x - 14, y - 16, w, 32)
    .setOrigin(0, 0)
    .setDepth(21)
    .setInteractive({ useHandCursor: true })
    .on('pointerdown', onDown);
  return { kt, lt };
}

// ------- plaque label (SEASON 1 / FALL MOUNTAIN style) -------
export function fgPlaque(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  opts: { fill?: number; fontSize?: number; depth?: number } = {},
) {
  const d = opts.depth ?? 20;
  const fill = opts.fill ?? FG.pink;
  const g = scene.add.graphics().setDepth(d);
  g.fillStyle(0xffffff, 1);
  rrect(g, x - 4, y - 4, w + 8, h + 8, 12);
  g.fillStyle(shade(fill, -35), 1);
  rrect(g, x, y + 3, w, h, 9);
  g.fillStyle(fill, 1);
  rrect(g, x, y, w, h, 9);
  scene.add
    .text(x + w / 2, y + h / 2 + 1, text, {
      fontFamily: FG_FONT,
      fontSize: `${opts.fontSize ?? 18}px`,
      color: '#ffffff',
    })
    .setOrigin(0.5)
    .setDepth(d + 1);
}

/**
 * ONLINE-language text prompt — crown field + rings underlay, paper card,
 * pink header, white pill input, candy OK / dark CANCEL. Replaces
 * window.prompt so modals stay on-style. Resolves the trimmed value,
 * '' if confirmed empty, or null on cancel. Scroll-factor-0 throughout
 * so it works over scrolling scenes.
 */
export function promptModal(
  scene: Phaser.Scene,
  opts: {
    title: string;
    sub?: string;
    label?: string; // micro-label over the input — the ONLINE card's RULESET pattern
    placeholder?: string;
    value?: string;
    maxLen?: number;
    okLabel?: string;
    depth?: number;
    field?: { base: number; ring: number; crown: number }; // underlay palette — cyan on the map
  },
): Promise<string | null> {
  const {
    title, sub = '', label = '', placeholder = '', value = '', maxLen = 16,
    okLabel = 'OK', depth = 80, field,
  } = opts;
  const { width: vw, height: vh } = scene.scale;
  const cx = vw / 2;
  const cy = vh / 2;
  const parts: Phaser.GameObjects.GameObject[] = [];
  const track = <T extends Phaser.GameObjects.GameObject>(o: T, d = depth): T => {
    (o as { setScrollFactor?: (n: number) => unknown }).setScrollFactor?.(0);
    (o as { setDepth?: (n: number) => unknown }).setDepth?.(d);
    // laid out in raw screen px on purpose — scenes that wrap chrome in a
    // stage-coord container must leave these at the display root
    (o as { setData?: (k: string, v: unknown) => unknown }).setData?.('screenFixed', 1);
    parts.push(o);
    return o;
  };

  // the ONLINE underlay: yellow field + concentric rings + crown stamps,
  // then a light veil so the modal reads over the field. Overscan is large
  // because scrollFactor(0) still scales about the view centre under zoom.
  track(fgCrownField(scene, vw, vh, cx, cy, field?.base, field?.ring, field?.crown));
  const dim = track(
    scene.add.rectangle(-vw, -vh, vw * 3, vh * 3, 0x081420, 0.22).setOrigin(0).setInteractive(),
  );
  const pw = Math.min(440, vw - 40);
  const ph = 250;
  track(panel(scene, cx - pw / 2, cy - ph / 2, pw, ph), depth + 1);
  // header — pink Titan One, deep-pink shadow: the ONLINE card's signature
  track(
    scene.add
      .text(cx, cy - ph / 2 + 46, title, {
        fontFamily: DISPLAY_FONT,
        fontSize: '30px',
        color: '#e84393',
      })
      .setOrigin(0.5)
      .setShadow(0, 4, '#9c2160', 0, true, false),
    depth + 2,
  );
  if (sub) {
    track(
      scene.add
        .text(cx, cy - ph / 2 + 78, sub, {
          fontFamily: UI_FONT,
          fontSize: '14px',
          fontStyle: '600',
          color: '#7a8a99',
        })
        .setOrigin(0.5),
      depth + 2,
    );
  }
  if (label) {
    track(
      scene.add
        .text(cx, cy - ph / 2 + 108, label, {
          fontFamily: UI_FONT,
          fontSize: '12px',
          fontStyle: '800',
          color: '#7a8a99',
        })
        .setOrigin(0.5),
      depth + 2,
    );
  }
  // close affordance — dark rimmed dot, top-right like every modal
  const cdG = track(scene.add.graphics(), depth + 2);
  cdG.fillStyle(UI.shade, 0.5).fillCircle(cx + pw / 2 - 27, cy - ph / 2 + 27, 15);
  cdG.fillStyle(UI.ink, 1).fillCircle(cx + pw / 2 - 28, cy - ph / 2 + 26, 14);
  cdG.lineStyle(2, 0xffffff, 0.85).strokeCircle(cx + pw / 2 - 28, cy - ph / 2 + 26, 13);
  const closeT = track(
    scene.add
      .text(cx + pw / 2 - 28, cy - ph / 2 + 25, '✕', {
        fontFamily: DISPLAY_FONT,
        fontSize: '13px',
        color: '#f5efe0',
      })
      .setOrigin(0.5)
      .setPadding(10)
      .setInteractive({ useHandCursor: true }),
    depth + 3,
  );
  track(
    scene.add
      .text(cx + pw / 2 - 16, cy + ph / 2 - 14, 'esc — cancel', {
        fontFamily: UI_FONT,
        fontSize: '11px',
        fontStyle: '600',
        color: '#b9c4cf',
      })
      .setOrigin(1, 1),
    depth + 2,
  );

  const { el, dom } = domInput(scene, cx - 120, cy - 8, placeholder, maxLen, 240);
  el.value = value;
  dom.setScrollFactor(0).setDepth(depth + 2);
  window.setTimeout(() => el.focus(), 60); // let the DOM element mount first

  return new Promise<string | null>((resolve) => {
    let done = false;
    const cleanup = (v: string | null) => {
      if (done) return;
      done = true;
      scene.input.keyboard?.off('keydown-ESC', onEsc);
      el.removeEventListener('keydown', onKey);
      for (const p of parts) p.destroy();
      dom.destroy();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation(); // keep Phaser's global key handlers out of the field
      if (e.key === 'Enter') cleanup(el.value.trim());
      else if (e.key === 'Escape') cleanup(null);
    };
    const onEsc = () => cleanup(null);
    el.addEventListener('keydown', onKey);
    scene.input.keyboard?.on('keydown-ESC', onEsc);
    scene.events.once('shutdown', () => cleanup(null)); // never leak the DOM el
    dim.on('pointerdown', () => cleanup(null)); // tap outside = cancel
    closeT.on('pointerdown', () => cleanup(null));

    const ok = pillButton(scene, cx - 78, cy + ph / 2 - 50, 140, okLabel, {
      fill: UI.danfo,
      textColor: UI.ink,
      fontSize: 15,
      depth: depth + 2,
      onDown: () => cleanup(el.value.trim()),
    });
    const cancel = pillButton(scene, cx + 78, cy + ph / 2 - 50, 140, 'CANCEL', {
      fill: UI.ink,
      fontSize: 15,
      depth: depth + 2,
      onDown: () => cleanup(null),
    });
    track(ok.container, depth + 2);
    track(cancel.container, depth + 2);
  });
}
