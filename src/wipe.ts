import { Sfx } from './audio';
import { REDUCED_MOTION } from './ui';

const sfx = Sfx.inst;

const wipes = new WeakMap<Phaser.Scene, Phaser.GameObjects.Graphics>();

/** did this scene arrive through wipeTo? Read in create()/init() to skip the
 *  one-shot entry fade — the blade already revealed the scene. */
export function viaWipe(data: unknown): boolean {
  return !!(data as { iwWipe?: boolean } | undefined)?.iwWipe;
}

/**
 * The house scene change — a Fall Guys-style diagonal blade reveal. The
 * target scene boots on top of this one under a geometry mask and a hard "/"
 * edge sweeps bottom-right → top-left to uncover it. No fades, the incoming
 * screen is fully formed underneath.
 *
 * Same-scene moves can't use this (scene.transition refuses its own key) —
 * keep scene.restart() for those.
 */
export function wipeTo(
  scene: Phaser.Scene,
  key: string,
  data?: Record<string, unknown>,
  ms = 280,
): boolean {
  const tgt = scene.scene.get(key);
  if (!tgt) return false;
  const started = scene.scene.transition({
    target: key,
    data: { ...data, iwWipe: true },
    duration: REDUCED_MOTION ? Math.min(ms, 140) : ms,
    // moveAbove is named from the CALLER's side: it moves the TARGET above
    // this scene — the blade reveals it over the frozen outgoing screen
    moveAbove: true,
    onUpdate: (p: number) => drawWedge(tgt, p),
  });
  if (!started) return false;
  sfx.swoosh();
  // caller shutdown frees the mask too — normal completion already cleaned it,
  // but a mid-wipe restart (resize, rotation) would leave it stuck half-drawn
  scene.events.once('shutdown', () => cleanupWipe(tgt));
  return true;
}

function cleanupWipe(tgt: Phaser.Scene) {
  const g = wipes.get(tgt);
  if (!g) return;
  tgt.cameras.main.clearMask();
  g.destroy();
  wipes.delete(tgt);
}

function drawWedge(tgt: Phaser.Scene, p: number) {
  if (p >= 1) {
    cleanupWipe(tgt);
    return;
  }
  const cam = tgt.cameras.main;
  const g = wipes.get(tgt);
  const mask = g ?? tgt.add.graphics().setVisible(false);
  if (!g) {
    wipes.set(tgt, mask);
    cam.setMask(mask.createGeometryMask());
  }
  // the edge rides the target camera's world rect — correct under the
  // letterboxed stage zoom instead of raw scale dims
  const wv = cam.worldView;
  const rise = wv.width * 0.4; // "/" slope — the blade angle Fall Guys uses
  const b = wv.right - p * (wv.width + rise); // edge x at the bottom edge
  mask.clear();
  mask.fillStyle(0xffffff);
  mask.fillPoints(
    [
      { x: b, y: wv.bottom },
      { x: wv.right, y: wv.bottom },
      { x: wv.right, y: wv.top },
      { x: b + rise, y: wv.top },
    ],
    true,
  );
}
