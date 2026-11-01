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

interface BakeJob {
  scene: Phaser.Scene;
  key: string;
  hero: Hero3D;
  strip: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  r: number;
  i: number;
  rafId: number;
  resolve: (ok: boolean) => void;
  promise: Promise<boolean>;
}

const jobs = new Map<string, BakeJob>();

function drawPose(job: BakeJob): void {
  const i = job.i;
  job.hero.viewYaw = VIEW_YAW[job.r];
  const kind = i < 8 ? 'run' : i < 12 ? 'idle' : 'splat';
  const ph = kind === 'splat' ? (i - 12) * 0.5 : (i % 8) / 8;
  job.hero.poseFor(kind, ph);
  const cv = job.hero.canvas!;
  job.ctx.drawImage(cv, 0, 0, cv.width, cv.height, i * SIZE, job.r * SIZE, SIZE, SIZE);
  if (++job.i >= TOTAL) {
    job.i = 0;
    job.r++;
  }
}

function finishJob(job: BakeJob, ok: boolean): boolean {
  cancelAnimationFrame(job.rafId);
  if (ok) {
    const ct = job.scene.textures.addCanvas(job.key, job.strip);
    if (ct) job.scene.textures.addSpriteSheet(job.key, ct, { frameWidth: SIZE, frameHeight: SIZE });
    else ok = false;
  }
  job.hero.dispose();
  jobs.delete(job.key);
  job.resolve(ok);
  return ok;
}

/** The same sheet as bakeBeanSheet, but the 56 WebGL poses spread across
 *  real frames (~8ms per step) instead of one blocking burst. DropScene
 *  kicks these off during its theatre so GameScene.create() reads warm
 *  texture cache instead of freezing the handoff for seconds. */
export function bakeBeanSheetAsync(scene: Phaser.Scene, key: string, def: CharDef): Promise<boolean> {
  if (scene.textures.exists(key)) return Promise.resolve(true);
  const pending = jobs.get(key);
  if (pending) return pending.promise;
  const hero = new Hero3D(SIZE * 2, SIZE * 2, 5, 1.3, 1.3, def);
  if (!hero.ok || !hero.canvas) {
    hero.dispose();
    return Promise.resolve(false);
  }
  hero.bakeCam();
  hero.setVariant(def.body, def.skin);
  const strip = document.createElement('canvas');
  strip.width = SIZE * TOTAL;
  strip.height = SIZE * VIEW_YAW.length;
  const ctx = strip.getContext('2d')!;
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  const job: BakeJob = { scene, key, hero, strip, ctx, r: 0, i: 0, rafId: 0, resolve, promise };
  jobs.set(key, job);
  const step = () => {
    try {
      const t0 = performance.now();
      while (job.r < VIEW_YAW.length && performance.now() - t0 < 8) drawPose(job);
      if (job.r < VIEW_YAW.length) job.rafId = requestAnimationFrame(step);
      else finishJob(job, true);
    } catch {
      finishJob(job, false); // a poisoned sheet → callers fall back to the flat sprites
    }
  };
  job.rafId = requestAnimationFrame(step);
  return promise;
}

export function bakeBeanSheet(scene: Phaser.Scene, key: string, def: CharDef): boolean {
  const job = jobs.get(key);
  if (job) {
    // a background bake is mid-flight for this key — run whatever poses are
    // left synchronously instead of spinning up a second rig from scratch
    try {
      while (job.r < VIEW_YAW.length) drawPose(job);
    } catch {
      /* the drain threw — finishJob resolves the pending promise false */
    }
    return finishJob(job, job.r >= VIEW_YAW.length);
  }
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
