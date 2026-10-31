// Bakes the 3D bean rig into a Phaser spritesheet — the lobby's live
// character becomes the game's top-down sprites at 2D cost. Sheet layout:
//   frames 0–7   run cycle (one full stride)
//   frames 8–11  idle sway
//   frames 12–13 splat (flat + half-up — used when frozen)
import Phaser from 'phaser';
import { Hero3D } from './hero3d';
import { CharDef } from './characters';

const SIZE = 96;
const TOTAL = 14;
// row order on the strip — row 0 keeps the legacy front-facing frames
// 0–13 so Phaser-side anims stay valid; the pitch billboards pick a row
// by the ent's camera-space travel direction
const VIEW_YAW = [0, -Math.PI / 2, Math.PI, Math.PI / 2]; // front left back right

/** resolve a baked key to the strip canvas the pitch stage wears as a
 *  2.5D billboard — square cells: frames = width/SIZE, rows = height/SIZE */
export function sheetCanvas(
  scene: Phaser.Scene,
  key: string,
): { canvas: HTMLCanvasElement; frames: number; rows: number } | undefined {
  const img = scene.textures.get(key)?.getSourceImage();
  return img instanceof HTMLCanvasElement
    ? {
        canvas: img,
        frames: Math.round(img.width / SIZE),
        rows: Math.round(img.height / SIZE),
      }
    : undefined;
}

export function bakeBeanSheet(scene: Phaser.Scene, key: string, def: CharDef): boolean {
  if (scene.textures.exists(key)) return true;
  const hero = new Hero3D(SIZE * 2, SIZE * 2, 5, 1.3, 1.3, def);
  if (!hero.ok || !hero.canvas) {
    hero.dispose();
    return false; // no WebGL — callers fall back to the flat sprites
  }
  hero.bakeCam();
  hero.setVariant(def.body, def.skin);

  const strip = document.createElement('canvas');
  strip.width = SIZE * TOTAL;
  strip.height = SIZE * VIEW_YAW.length;
  const ctx = strip.getContext('2d')!;
  for (let r = 0; r < VIEW_YAW.length; r++) {
    hero.viewYaw = VIEW_YAW[r];
    for (let i = 0; i < TOTAL; i++) {
      const kind = i < 8 ? 'run' : i < 12 ? 'idle' : 'splat';
      const ph = kind === 'splat' ? (i - 12) * 0.5 : (i % 8) / 8;
      hero.poseFor(kind, ph);
      ctx.drawImage(
        hero.canvas,
        0,
        0,
        hero.canvas.width,
        hero.canvas.height,
        i * SIZE,
        r * SIZE,
        SIZE,
        SIZE,
      );
    }
  }
  // addSpriteSheet slices frames directly into a Texture source under ITS
  // key — so the canvas becomes the sheet itself, no wrapper needed
  const ct = scene.textures.addCanvas(key, strip);
  if (!ct) {
    hero.dispose();
    return false;
  }
  scene.textures.addSpriteSheet(key, ct, { frameWidth: SIZE, frameHeight: SIZE });
  hero.dispose();
  return true;
}
