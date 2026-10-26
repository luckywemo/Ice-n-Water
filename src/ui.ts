import Phaser from 'phaser';
import { CONFIG } from './config';

export const DISPLAY_FONT = '"Titan One", "Baloo 2", sans-serif';
export const UI_FONT = '"Baloo 2", "Fredoka", sans-serif';

/** Honor prefers-reduced-motion — gate all decorative motion on this. */
export const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export const UI = {
  bg: 0x0d1b2a,
  ice: 0x7fd8f0,
  water: 0x4dd0e1,
  paper: 0xf5efe0,
  sand: 0xb7a98c,
  panel: 0x12293f,
  danger: 0xe84848,
  // Obakeidoro-meets-danfo: warm near-black panels, candy accents,
  // thick outlines. Every lip is `shade(fill, -35)` — the press sink.
  ink: 0x1c1626, // dark warm panel base
  rim: 0xf5efe0, // cream outline on dark panels
  danfo: 0xffc93c, // signature Lagos bus yellow — primary CTA
  leaf: 0x4ecb71, // runner green — secondary action
  grape: 0xb388ff, // charm purple — tertiary
  shade: 0x0a0710, // deepest shade — lips, inset floors
} as const;

/** darken/lighten a 0xRRGGBB int by percent (-100..100) — drives lips+shades */
export function shade(color: number, pct: number): number {
  const t = pct < 0 ? 0 : 255;
  const p = Math.abs(pct) / 100;
  const r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
  const f = (c: number) => Math.round((t - c) * p + c);
  return (f(r) << 16) | (f(g) << 8) | f(b);
}
export const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

/** Elastic pop-in for text/sprites — a gentle fade under reduced motion. */
export function popIn(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.GameObject,
  opts: { delay?: number; from?: number; duration?: number } = {},
) {
  const { delay = 0, from = 0.3, duration = 420 } = opts;
  const obj = target as unknown as { setScale: (v: number) => void; setAlpha: (v: number) => void };
  obj.setAlpha(0);
  if (REDUCED_MOTION) {
    scene.tweens.add({ targets: target, alpha: 1, delay, duration: 160 });
    return;
  }
  obj.setScale(from);
  scene.tweens.add({
    targets: target,
    scale: 1,
    alpha: 1,
    delay,
    duration,
    ease: 'Back.easeOut',
  });
}

/**
 * Subtle hover lift for a zone + target — 140ms ease-out, transform only.
 * No-op under reduced motion.
 */
export function hoverLift(
  zone: Phaser.GameObjects.Zone,
  target: Phaser.GameObjects.GameObject,
  lift = 1.035,
) {
  if (REDUCED_MOTION) return;
  const base = (target as { scaleX?: number }).scaleX ?? 1;
  zone.on('pointerover', () =>
    zone.scene.tweens.add({ targets: target, scale: base * lift, duration: 140 }),
  );
  zone.on('pointerout', () =>
    zone.scene.tweens.add({ targets: target, scale: base, duration: 140 }),
  );
}

/** Keyboard key-cap chip (rounded rect + letter). Returns container width for layout. */
export function keyChip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  fontSize = 14,
): { container: Phaser.GameObjects.Container; width: number } {
  const pad = 9;
  const text = scene.add
    .text(0, 0, label, {
      fontFamily: UI_FONT,
      fontSize: `${fontSize}px`,
      fontStyle: '600',
      color: '#f5efe0',
    })
    .setOrigin(0.5);
  const w = Math.max(text.width + pad * 2, 30);
  const h = fontSize + 14;

  const g = scene.add.graphics();
  g.fillStyle(0x1a1a22, 1);
  g.fillRoundedRect(0, 0, w, h, 7);
  g.lineStyle(2, 0xffffff, 0.8);
  g.strokeRoundedRect(1, 1, w - 2, h - 2, 7);
  // little bottom "keycap" shadow line
  g.lineStyle(2, 0x000000, 0.35);
  g.lineBetween(4, h - 1, w - 4, h - 1);

  text.setPosition(w / 2, h / 2);
  const container = scene.add.container(x, y, [g, text]);
  return { container, width: w };
}

// ---------- screen-pinned HUD ----------
// The camera follows the player AND zooms — scrollFactor(0) alone isn't
// enough because zoom still pushes objects outward from screen center.
// HudItems store an ANCHOR (0..1 of the canvas) + pixel offset, and
// layoutHud() converts that to the compensated world position.

export interface HudItem {
  obj: {
    setPosition: (x: number, y: number) => unknown;
    setScale?: (x: number, y?: number) => unknown;
    scaleX: number;
  };
  ax: number; // 0 = left/top, 0.5 = center, 1 = right/bottom
  ay: number;
  ox: number; // pixel offset from the anchor, in authored screen coords
  oy: number;
  baseScale: number;
}

/** register an object to be pinned; call layoutHud() to place it */
export function pinHud(
  items: HudItem[],
  obj: HudItem['obj'],
  ax: number,
  ay: number,
  ox = 0,
  oy = 0,
): HudItem['obj'] {
  const it: HudItem = { obj, ax, ay, ox, oy, baseScale: obj.scaleX || 1 };
  items.push(it);
  (obj as { setScrollFactor?: (n: number) => unknown }).setScrollFactor?.(0);
  return obj;
}

/** place all pinned items for the given canvas size + camera zoom.
 *  hf shrinks the whole HUD on small screens — offsets and scale both. */
export function layoutHud(
  items: HudItem[],
  w: number,
  h: number,
  zoom: number,
  hf = 1,
) {
  // Camera transform for sf=0 objects: screen = center + zoom·(pos - center)
  // (zoom pivots around the view midpoint even without scroll).
  // Inverting: pos = center + (screen - center)/zoom.
  const cx = w / 2;
  const cy = h / 2;
  for (const it of items) {
    const sx = it.ax * w + it.ox * hf;
    const sy = it.ay * h + it.oy * hf;
    it.obj.setPosition(cx + (sx - cx) / zoom, cy + (sy - cy) / zoom);
    it.obj.setScale?.((it.baseScale * hf) / zoom);
  }
}

/** screen → camera-world: where a screen point lives in follow-camera space */
export function screenToHudWorld(
  sx: number,
  sy: number,
  w: number,
  h: number,
  zoom: number,
): { x: number; y: number } {
  return { x: w / 2 + (sx - w / 2) / zoom, y: h / 2 + (sy - h / 2) / zoom };
}

export const HUD_SCALE = 1 / CONFIG.camera.zoom; // legacy fixed-zoom scale — new code should use viewZoom()/hudFactor()

/** responsive follow-camera zoom — 1280×800 keeps the authored 1.15,
 *  smaller screens zoom out so the field doesn't fill the whole phone */
export function viewZoom(w: number, h: number): number {
  return Math.min(1.15, Math.max(0.58, Math.min(w / 1100, h / 700) * 1.15));
}

/** how much to shrink pinned HUD on small screens (1 = authored size) */
export function hudFactor(w: number, h: number): number {
  return Math.min(1, Math.max(0.62, Math.min(w / 900, h / 560)));
}

/**
 * The schoolyard at dusk — shared menu backdrop. Gradient sky, painted
 * ground band, silhouette props (danfo, poles, wires), drifting dust.
 * Requires makeTextures() to have run (uses 'bus', 'dot').
 */
export function backdrop(
  scene: Phaser.Scene,
  w: number,
  h: number,
): Phaser.GameObjects.Container {
  const c = scene.add.container(0, 0).setDepth(0);
  const g = scene.add.graphics();
  // dusk sky — deep navy bleeding to warm horizon
  g.fillGradientStyle(0x0b1724, 0x0b1724, 0x2a2438, 0x2a2438, 1);
  g.fillRect(0, 0, w, h);
  // dusty ground band — the schoolyard floor
  const gh = Math.max(90, h * 0.14);
  const gy = h - gh;
  g.fillStyle(0x2e2418, 1).fillRect(0, gy, w, gh);
  g.fillGradientStyle(0x2e2418, 0x2e2418, 0x453520, 0x453520, 1);
  g.fillRect(0, gy, w, gh * 0.55);
  // chalk court line across the ground
  g.lineStyle(2, 0xf5efe0, 0.1).lineBetween(0, gy + gh * 0.5, w, gy + gh * 0.5);
  // utility poles + sagging wires — Lagos skyline shorthand
  g.lineStyle(3, 0x060a10, 0.9);
  for (const px of [w * 0.12, w * 0.88]) {
    g.lineBetween(px, gy, px, gy - h * 0.34);
    g.lineBetween(px - 14, gy - h * 0.3, px + 14, gy - h * 0.3);
  }
  g.lineStyle(2, 0x060a10, 0.7);
  {
    const x1 = w * 0.12, x2 = w * 0.88, wy = gy - h * 0.3, sag = h * 0.08;
    let px = x1, py = wy;
    for (let i = 1; i <= 16; i++) {
      const t = i / 16;
      const nx = x1 + (x2 - x1) * t;
      const ny = wy + sag * 4 * t * (1 - t); // parabola — the sag
      g.lineBetween(px, py, nx, ny);
      px = nx; py = ny;
    }
  }
  // low block skyline silhouettes
  g.fillStyle(0x0a1018, 0.85);
  for (const [bx, bw2, bh2] of [
    [w * 0.02, 110, 60], [w * 0.18, 80, 42], [w * 0.72, 95, 52], [w * 0.92, 75, 38],
  ] as const) {
    g.fillRect(bx, gy - bh2, bw2, bh2);
    // lit window
    g.fillStyle(0xffc93c, 0.16).fillRect(bx + bw2 * 0.3, gy - bh2 + 10, 12, 10);
    g.fillStyle(0x0a1018, 0.85);
  }
  c.add(g);
  // danfo parked at the curb — silhouette + dim headlight
  if (scene.textures.exists('bus')) {
    const bus = scene.add
      .image(w * 0.32, gy - 8, 'bus')
      .setOrigin(0.5, 1)
      .setTint(0x10161f)
      .setAlpha(0.9);
    c.add(bus);
  }
  // drifting dust — ambient life, static under reduced motion
  for (let i = 0; i < 12; i++) {
    const d = scene.add
      .sprite(Phaser.Math.Between(16, w - 16), Phaser.Math.Between(16, h - 16), 'dot')
      .setTint(i % 3 === 0 ? UI.ice : UI.danfo)
      .setAlpha(Phaser.Math.FloatBetween(0.05, 0.16))
      .setScale(Phaser.Math.FloatBetween(0.5, 1.5));
    c.add(d);
    if (!REDUCED_MOTION) {
      scene.tweens.add({
        targets: d,
        y: d.y - Phaser.Math.Between(20, 50),
        duration: Phaser.Math.Between(1800, 3400),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }
  return c;
}

/**
 * Card panel — FG language: warm paper face on a cyan-deep drop base, thin
 * dark rim, top sheen. Same card as the lobby settings modal everywhere.
 */
export function panel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { alpha?: number; depth?: number; color?: number; rim?: number } = {},
): Phaser.GameObjects.Graphics {
  const { alpha = 0.97, depth = 9, color = 0xfdf8ec, rim = 0x1d2a44 } = opts;
  const g = scene.add.graphics();
  // cyan-deep drop base — the chunky offset shadow every FG card sits on
  g.fillStyle(shade(0x0f7fb8, -35), 1);
  g.fillRoundedRect(x, y + 5, w, h, 16);
  // paper face
  g.fillStyle(color, alpha);
  g.fillRoundedRect(x, y, w, h, 16);
  // top sheen
  g.fillStyle(0xffffff, 0.45);
  g.fillRoundedRect(x + 4, y + 4, w - 8, Math.max(10, h * 0.2), 10);
  // thin dark rim
  g.lineStyle(2.5, rim, 0.18);
  g.strokeRoundedRect(x + 1.5, y + 1.5, w - 3, h - 3, 14);
  g.setDepth(depth);
  return g;
}

/** Fall Guys button language: candy pill, bottom lip, top sheen, press-sink. */
export interface PillOpts {
  fill?: number; // body color — danfo for primary CTAs
  textColor?: number;
  fontSize?: number;
  font?: string;
  depth?: number;
  onDown?: () => void;
  disabled?: boolean;
  icon?: string; // small text/glyph before the label
}
export interface PillHandle {
  container: Phaser.GameObjects.Container;
  setEnabled: (on: boolean) => void;
  setLabel: (t: string) => void;
}
export function pillButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  label: string,
  opts: PillOpts = {},
): PillHandle {
  const {
    fill = 0xe84393,
    textColor = 0xffffff,
    fontSize = 18,
    font = DISPLAY_FONT,
    depth = 10,
    onDown,
    disabled = false,
    icon = '',
  } = opts;
  const h = Math.max(44, fontSize * 2.5); // ≥44px — landscape thumb target
  const r = h / 2;
  const lipH = Math.min(9, Math.round(h * 0.18));

  const g = scene.add.graphics();
  const draw = (sunk: boolean) => {
    g.clear();
    const lift = sunk ? lipH - 2 : 0; // press = slide down into the lip
    // lip — a clearly separated darker base the body sits on
    g.fillStyle(shade(fill, -48), 1);
    g.fillRoundedRect(-w / 2, -h / 2 + lift - 2, w, h, r);
    // body sits raised on the lip — shrinks visually when sunk
    g.fillStyle(fill, disabled ? 0.45 : 1);
    g.fillRoundedRect(-w / 2, -h / 2 - lipH + lift, w, h - 2, r);
    // darker body edge — separates candy from lip at the seam
    g.lineStyle(2, shade(fill, -30), 0.9);
    g.strokeRoundedRect(-w / 2 + 1, -h / 2 - lipH + lift + 1, w - 2, h - 4, r - 1);
    // sheen band — wide soft candy gloss
    if (!disabled) {
      g.fillStyle(0xffffff, 0.26);
      g.fillRoundedRect(-w / 2 + 5, -h / 2 - lipH + lift + 3, w - 10, Math.max(9, h * 0.38), {
        tl: r - 3, tr: r - 3, bl: 5, br: 5,
      });
    }
  };
  draw(false);

  const text = scene.add
    .text(0, -lipH / 2 - 1, (icon ? icon + '  ' : '') + label, {
      fontFamily: font,
      fontSize: `${fontSize}px`,
      color: hex(textColor),
    })
    .setOrigin(0.5)
    .setShadow(0, 3, hex(shade(fill, -45)), 0, true, false); // soft drop shadow, FG style
  if (disabled) text.setAlpha(0.5);

  const container = scene.add.container(x, y, [g, text]).setDepth(depth);
  const zone = scene.add.zone(0, 0, w, h + lipH).setInteractive({ useHandCursor: !disabled });
  container.add(zone);

  let enabled = !disabled;
  zone.on('pointerdown', () => {
    if (!enabled) return;
    draw(true);
    text.setY(-lipH / 2 + lipH - 4);
    if (!REDUCED_MOTION)
      scene.tweens.add({ targets: container, scale: 0.97, duration: 60 });
    onDown?.();
  });
  const release = () => {
    draw(false);
    text.setY(-lipH / 2 - 1);
    container.setScale(1);
  };
  zone.on('pointerup', release);
  zone.on('pointerout', () => {
    release();
  });
  hoverLift(zone, container, 1.04);

  return {
    container,
    setLabel: (t: string) => text.setText((icon ? icon + '  ' : '') + t),
    setEnabled: (on: boolean) => {
      enabled = on;
      zone.disableInteractive();
      if (on) zone.setInteractive({ useHandCursor: true });
      draw(false);
      text.setAlpha(on ? 1 : 0.5);
    },
  };
}

/**
 * Slow gloss stripe sliding across a pill — the candy-shop hero shimmer.
 * Call on the pill's container; masked to the pill shape. REDUCED_MOTION-safe.
 */
export function sheenSweep(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  w: number,
  h: number,
) {
  if (REDUCED_MOTION) return;
  const stripe = scene.add
    .rectangle(0, 0, 26, h * 1.6, 0xffffff, 0.28)
    .setAngle(18)
    .setVisible(false);
  container.add(stripe);
  const maskG = scene.add.graphics();
  maskG.fillStyle(0xffffff).fillRoundedRect(-w / 2, -h / 2 - 9, w, h, h / 2);
  // invisible but still a child — the mask uses its geometry, not its pixels
  maskG.setVisible(false);
  container.add(maskG);
  stripe.setMask(maskG.createGeometryMask());
  const run = () => {
    stripe.setX(-w / 2 - 30).setVisible(true);
    scene.tweens.add({
      targets: stripe,
      x: w / 2 + 30,
      duration: 900,
      ease: 'Sine.easeInOut',
      onComplete: () => stripe.setVisible(false),
    });
  };
  scene.time.delayedCall(1200, run);
  scene.time.addEvent({ delay: 3600, callback: run, loop: true });
}

/** Painted sign ribbon — ink band, danfo rim, bolt caps, slight tilt. */
export function ribbon(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  // drop shade
  g.fillStyle(UI.shade, 0.55).fillRoundedRect(-w / 2 + 4, -h / 2 + 6, w, h, 14);
  // ink band
  g.fillStyle(UI.ink, 0.98).fillRoundedRect(-w / 2, -h / 2, w, h, 14);
  // danfo rim — the painted edge
  g.lineStyle(3.5, UI.danfo, 1).strokeRoundedRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 12);
  // inner pinstripe — sign-painter detail
  g.lineStyle(1.5, UI.danfo, 0.35).strokeRoundedRect(-w / 2 + 8, -h / 2 + 8, w - 16, h - 16, 8);
  // bolt caps
  for (const bx of [-w / 2 + 14, w / 2 - 14]) {
    g.fillStyle(UI.danfo, 1).fillCircle(bx, 0, 4);
    g.fillStyle(UI.shade, 0.6).fillCircle(bx, 0, 1.8);
  }
  const c = scene.add.container(x, y, [g]).setAngle(-2);
  return c;
}

/** Staggered rise-in for a row of objects — menu entries settle in order. */
export function staggerIn(
  scene: Phaser.Scene,
  items: Phaser.GameObjects.GameObject[],
  opts: { dy?: number; step?: number; delay?: number } = {},
) {
  const { dy = 22, step = 55, delay = 0 } = opts;
  items.forEach((o, i) => {
    const t = o as unknown as { y: number; setAlpha: (n: number) => void };
    const home = t.y;
    if (REDUCED_MOTION) {
      t.setAlpha(0);
      scene.tweens.add({ targets: o, alpha: 1, delay: delay + i * 30, duration: 160 });
      return;
    }
    (o as unknown as { setY: (n: number) => void }).setY(home + dy);
    t.setAlpha(0);
    scene.tweens.add({
      targets: o,
      y: home,
      alpha: 1,
      delay: delay + i * step,
      duration: 380,
      ease: 'Cubic.easeOut',
    });
  });
}

/** Status chip — frozen/caught/ready badge, paper card with icon dot. */
export function statusChip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  accent: number,
  fontSize = 12,
): Phaser.GameObjects.Container {
  const text = scene.add
    .text(0, 0, label, {
      fontFamily: UI_FONT,
      fontSize: `${fontSize}px`,
      fontStyle: '700',
      color: hex(UI.paper),
    })
    .setOrigin(0.5);
  const pad = 12;
  const w = text.width + pad * 2 + 12;
  const h = fontSize + 14;
  const g = scene.add.graphics();
  g.fillStyle(UI.shade, 0.5).fillRoundedRect(-w / 2 + 2, -h / 2 + 3, w, h, h / 2);
  g.fillStyle(UI.ink, 0.95).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
  g.lineStyle(2, 0xffffff, 0.9).strokeRoundedRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2, h / 2);
  g.fillStyle(accent, 1).fillCircle(-w / 2 + pad - 2, 0, 3.5);
  text.setPosition(6, 0);
  return scene.add.container(x, y, [g, text]);
}

/** HUD plate — dark pill with inset floor for numbers (timer/score). */
export function plate(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  accent: number = UI.ice,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(UI.shade, 0.55).fillRoundedRect(x + 2, y + 4, w, h, h / 2);
  g.fillStyle(UI.ink, 0.95).fillRoundedRect(x, y, w, h, h / 2);
  g.fillStyle(UI.shade, 0.35).fillRoundedRect(x + 5, y + h * 0.45, w - 10, h * 0.45, h / 4);
  g.lineStyle(2, 0xffffff, 0.85).strokeRoundedRect(x + 1, y + 1, w - 2, h - 2, h / 2);
  g.lineStyle(1, accent, 0.5).strokeRoundedRect(x + 4, y + 4, w - 8, h - 8, h / 2);
  return g;
}

/**
 * Bake one logo letter into a canvas texture, painted per effect:
 *  'ice'   — frost gradient, jagged snow cap, glints. Icicles bake into a
 *    separate overlay texture (`decoKey`) so the caller can fade them in
 *    with the freeze cycle — drips exist only while frozen, not when thawed.
 *  'water' — deep-sea gradient, wave-warped lower half, specular squiggle
 *  'plain' — ink rim + cream fill (the hinge: 'N')
 * Everything is deterministic — icicle/drip runs come from scanning real ink
 * pixels, never Math.random.
 */
export function bakeLogoLetter(
  scene: Phaser.Scene,
  ch: string,
  px: number,
  fx: 'ice' | 'water' | 'plain',
  extrude?: string,
): { key: string; decoKey?: string } {
  const key = `logo_${fx}_${ch}_${px}${extrude ? '_x' : ''}`;
  const decoKey = `logo_dec_${fx}_${ch}_${px}`;
  if (scene.textures.exists(key)) {
    return { key, decoKey: fx === 'ice' && scene.textures.exists(decoKey) ? decoKey : undefined };
  }

  const font = `${px}px ${DISPLAY_FONT}`;
  const meas = document.createElement('canvas').getContext('2d');
  if (!meas) return { key };
  meas.font = font;
  const mw = Math.ceil(meas.measureText(ch).width);
  const padX = 14;
  const w = Math.max(12, mw + padX * 2);
  const baseline = Math.round(px * 0.86);
  const h = baseline + (fx === 'plain' ? 10 : 34); // drip/icicle room below

  const tex = scene.textures.createCanvas(key, w, h);
  const ctx = tex?.getContext();
  if (!tex || !ctx) return { key };

  const drawShape = (c: CanvasRenderingContext2D, stops: [number, string][]) => {
    c.font = font;
    c.lineJoin = 'round';
    if (extrude) {
      c.fillStyle = extrude;
      for (let d = Math.round(px * 0.14); d >= 1; d--) c.fillText(ch, padX + d, baseline + d);
    }
    c.strokeStyle = extrude ? '#ffffff' : '#0a1420';
    c.lineWidth = Math.max(7, px * 0.13);
    c.strokeText(ch, padX, baseline);
    const g = c.createLinearGradient(0, baseline - px * 0.8, 0, baseline + 8);
    for (const [o, col] of stops) g.addColorStop(o, col);
    c.fillStyle = g;
    c.fillText(ch, padX, baseline);
  };

  // contiguous x-runs where glyph ink reaches the baseline — drip anchors
  const bottomRuns = (c: CanvasRenderingContext2D) => {
    const data = c.getImageData(0, 0, w, h).data;
    const runs: { x0: number; x1: number; y: number }[] = [];
    let x0 = -1;
    let my = 0;
    for (let x = 0; x <= w; x++) {
      let fy = -1;
      if (x < w) {
        for (let y = Math.min(h - 1, baseline + 14); y > baseline - px * 0.85; y--) {
          if (data[(y * w + x) * 4 + 3] > 100) {
            fy = y;
            break;
          }
        }
      }
      if (fy >= 0) {
        if (x0 < 0) x0 = x;
        my = Math.max(my, fy);
      } else if (x0 >= 0) {
        if (x - x0 >= 5) runs.push({ x0, x1: x - 1, y: my });
        x0 = -1;
        my = 0;
      }
    }
    return runs.sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0));
  };

  if (fx === 'plain') {
    drawShape(ctx, [
      [0, '#fdf6e3'],
      [1, '#e2cfa6'],
    ]);
    tex.refresh();
    return { key };
  }

  if (fx === 'ice') {
    drawShape(ctx, [
      [0, '#f4feff'],
      [0.45, '#a5ecfb'],
      [0.8, '#4cc2e8'],
      [1, '#1f6ea0'],
    ]);
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    // frost cap — jagged snow band across the crown, clipped to ink
    ctx.fillStyle = 'rgba(240,252,255,0.92)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let x = 0; x <= w; x += 6) {
      ctx.lineTo(x, baseline - px * 0.52 - Math.abs(Math.sin(x * 1.7 + ch.charCodeAt(0))) * 7);
    }
    ctx.lineTo(w, 0);
    ctx.closePath();
    ctx.fill();
    // glints on the frost
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    const glints: [number, number, number][] = [
      [0.22, 0.2, 3.5],
      [0.66, 0.36, 2.5],
      [0.5, 0.1, 3],
    ];
    for (const [gx, gy, s] of glints) {
      const cx = gx * w;
      const cy = baseline - px * 0.72 + gy * px * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx - s, cy);
      ctx.lineTo(cx + s, cy);
      ctx.moveTo(cx, cy - s);
      ctx.lineTo(cx, cy + s);
      ctx.stroke();
    }
    ctx.restore();
    // icicles — pointed drips off the widest baseline ink runs, baked into a
    // same-size overlay so they can fade in/out with the freeze cycle
    const runs = bottomRuns(ctx).slice(0, 3);
    let deco: string | undefined;
    const dtex = scene.textures.createCanvas(decoKey, w, h);
    const dctx = dtex?.getContext();
    if (dtex && dctx) {
      runs.forEach((r, i) => {
        const iw = Math.min((r.x1 - r.x0) * 0.6, 9);
        const ix = r.x0 + (r.x1 - r.x0) * (0.3 + 0.4 * ((i + ch.charCodeAt(0)) % 2));
        const len = 13 + ((i * 5 + ch.charCodeAt(0)) % 13);
        const g = dctx.createLinearGradient(0, r.y, 0, r.y + len);
        g.addColorStop(0, 'rgba(225,248,255,0.95)');
        g.addColorStop(0.7, 'rgba(150,220,250,0.5)');
        g.addColorStop(1, 'rgba(140,210,245,0)');
        dctx.fillStyle = g;
        dctx.beginPath();
        dctx.moveTo(ix - iw / 2, r.y - 2);
        dctx.lineTo(ix + iw / 2, r.y - 2);
        dctx.lineTo(ix, r.y + len);
        dctx.closePath();
        dctx.fill();
      });
      dtex.refresh();
      deco = decoKey;
    }
    tex.refresh();
    return { key, decoKey: deco };
  }

  // ---- water: build on a temp canvas, then slice it in with a wave ----
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext('2d');
  if (tctx) {
    drawShape(tctx, [
      [0, '#d6f8ff'],
      [0.5, '#4fd0ec'],
      [0.85, '#1e90d4'],
      [1, '#0f5fb0'],
    ]);
    tctx.globalCompositeOperation = 'source-atop';
    // specular squiggle inside the letters — reads as a waterline shine
    tctx.strokeStyle = 'rgba(245,255,255,0.7)';
    tctx.lineWidth = Math.max(2.5, px * 0.045);
    tctx.beginPath();
    for (let x = padX; x < w - padX; x += 4) {
      const y = baseline - px * 0.4 + Math.sin(x * 0.3) * 2.6;
      if (x === padX) tctx.moveTo(x, y);
      else tctx.lineTo(x, y);
    }
    tctx.stroke();
    // submerged band at the very bottom
    tctx.fillStyle = 'rgba(10,70,140,0.25)';
    tctx.fillRect(0, baseline - 3, w, h);
    tctx.globalCompositeOperation = 'source-over';
  }
  // slice the glyph into strips — the lower a strip, the harder the wave hits.
  // low frequency keeps edges liquid instead of torn
  const waveTop = baseline - px * 0.5;
  const waveSpan = Math.max(1, baseline + 10 - waveTop);
  for (let y = 0; y < h; y += 2) {
    const d = Math.max(0, (y - waveTop) / waveSpan);
    const ox = Math.sin(y * 0.18 + ch.charCodeAt(0) * 1.3) * 2.6 * Math.min(1, d * 1.4);
    if (tctx) ctx.drawImage(tmp, 0, y, w, 2, ox, y, w, 2);
  }
  tex.refresh();
  return { key };
}

// ---------- DOM pill input (the lobby's white recessed field) ----------

/** Shared CSS for the white pill inputs the online lobby uses. */
export const domInputCss = (width = 160) => `width:${width}px;padding:11px 14px;border-radius:999px;
  border:2.5px solid #0f7fb8;background:#ffffff;color:#1c2a3a;
  font-family:${UI_FONT};font-size:16px;font-weight:700;outline:none;
  text-align:center;box-shadow:0 3px 0 #0b6a99;caret-color:#0f7fb8;`;

/** Create a DOM text input styled like the lobby fields. Caller owns cleanup. */
export function domInput(
  scene: Phaser.Scene,
  x: number,
  y: number,
  placeholder: string,
  maxLen: number,
  width = 160,
): { el: HTMLInputElement; dom: Phaser.GameObjects.DOMElement } {
  const el = document.createElement('input');
  el.placeholder = placeholder;
  el.maxLength = maxLen;
  el.style.cssText = domInputCss(width);
  const dom = scene.add.dom(x, y, el).setOrigin(0, 0);
  return { el, dom };
}

// promptModal lives in fgui.ts — the ONLINE-card modal needs the crown
// backdrop, and fgui already imports this file (avoid a ui↔fgui cycle).
