import { Sfx } from './audio';
import { REDUCED_MOTION } from './ui';

const sfx = Sfx.inst;

const wipes = new WeakMap<Phaser.Scene, Phaser.GameObjects.Graphics>();

/** did this scene arrive through wipeTo? Read in create()/init() to skip the
 *  one-shot entry fade — the blade already revealed the scene. */
export function viaWipe(data: unknown): boolean {
  return !!(data as { iwWipe?: boolean } | undefined)?.iwWipe;
}

/** clear a blade mask off a scene's camera + free the mask graphics —
 *  safe anytime. Scene entry calls this so a wipe interrupted mid-draw
 *  (target restart on mobile viewport churn) can't leave the camera
 *  masked = blank screen. */
export function clearWipe(scene: Phaser.Scene) {
  const g = wipes.get(scene);
  scene.cameras.main.clearMask();
  if (g) {
    g.destroy();
    wipes.delete(scene);
  }
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
  scene.events.once('shutdown', () => clearWipe(tgt));
  // same on the TARGET side: a restart (mobile resize/orientation churn)
  // destroys its display list — without this the fresh create inherits a
  // half-drawn blade mask and the screen reads blank
  tgt.events.once('shutdown', () => clearWipe(tgt));
  return true;
}

function drawWedge(tgt: Phaser.Scene, p: number) {
  if (p >= 1) {
    clearWipe(tgt);
    return;
  }
  const cam = tgt.cameras.main;
  let g = wipes.get(tgt);
  // a target that restarted between draws leaves its graphics orphaned —
  // drop it and rebuild rather than keep masking against a dead object
  if (g && !g.displayList) {
    clearWipe(tgt);
    g = undefined;
  }
  // scrollFactor(0): the mask is evaluated in screen space, not through the
  // camera — drawing in worldView coords would under/over-cover whenever the
  // target is zoomed (mobile boost) or scrolled (the map's rail)
  const mask = g ?? tgt.add.graphics().setVisible(false).setScrollFactor(0);
  if (!g) {
    wipes.set(tgt, mask);
    cam.setMask(mask.createGeometryMask());
  }
  const w = tgt.scale.width;
  const h = tgt.scale.height;
  const rise = w * 0.4; // "/" slope — the blade angle Fall Guys uses
  const b = w - p * (w + rise); // edge x at the bottom edge
  mask.clear();
  mask.fillStyle(0xffffff);
  mask.fillPoints(
    [
      { x: b, y: h },
      { x: w, y: h },
      { x: w, y: 0 },
      { x: b + rise, y: 0 },
    ],
    true,
  );
}
