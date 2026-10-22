import Phaser from 'phaser';
import { CONFIG } from './config';

export const DISPLAY_FONT = '"Bungee", sans-serif';
export const UI_FONT = '"Fredoka", sans-serif';

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
} as const;

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
  g.fillStyle(0x12293f, 1);
  g.fillRoundedRect(0, 0, w, h, 7);
  g.lineStyle(2, 0x7fd8f0, 0.5);
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

/** place all pinned items for the given canvas size + camera zoom */
export function layoutHud(items: HudItem[], w: number, h: number, zoom: number) {
  // Camera transform for sf=0 objects: screen = center + zoom·(pos - center)
  // (zoom pivots around the view midpoint even without scroll).
  // Inverting: pos = center + (screen - center)/zoom.
  const cx = w / 2;
  const cy = h / 2;
  for (const it of items) {
    const sx = it.ax * w + it.ox;
    const sy = it.ay * h + it.oy;
    it.obj.setPosition(cx + (sx - cx) / zoom, cy + (sy - cy) / zoom);
    it.obj.setScale?.(it.baseScale / zoom);
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

export const HUD_SCALE = 1 / CONFIG.camera.zoom;

/** Rounded dark panel graphic. */
export function panel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { alpha?: number; depth?: number; color?: number } = {},
): Phaser.GameObjects.Graphics {
  const { alpha = 0.72, depth = 9, color = UI.panel } = opts;
  const g = scene.add.graphics();
  g.fillStyle(color, alpha);
  g.fillRoundedRect(x, y, w, h, 10);
  g.lineStyle(2, UI.ice, 0.18);
  g.strokeRoundedRect(x + 1, y + 1, w - 2, h - 2, 10);
  g.setDepth(depth);
  return g;
}
