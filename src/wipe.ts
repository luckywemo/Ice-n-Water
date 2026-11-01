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
  // shutdown-time callers run inside the scene's SHUTDOWN emit — cameras.main
  // is already gone by then, and a throw here propagates straight into
  // Phaser's processQueue and wedges the whole scene queue. All of this is
  // best-effort cleanup; nothing in it is allowed to throw.
  try {
    scene.cameras.main?.clearMask();
  } catch {
    /* camera manager already torn down */
  }
  const g = wipes.get(scene);
  if (g) {
    try {
      g.destroy();
    } catch {
      /* display list already dead */
    }
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
    // drawWedge throws land inside Phaser's unguarded RAF step — one throw
    // kills the frame loop permanently, so keep the draw itself contained
    onUpdate: (p: number) => {
      try {
        drawWedge(tgt, p);
      } catch {
        /* the watchdog revives a stalled loop; a skipped blade frame is cheap */
      }
    },
  });
  if (!started) {
    // refused (target already RUNNING, either side mid-transition, same key)
    // — a bare start still delivers the scene change. Without this the
    // caller's screen just sits there forever: the DropScene hang.
    //
    // First unlatch two states Phaser can't recover from on its own:
    // - caller's dead _target: a transition that never completed leaves
    //   isTransitioning() true → manager.stop refuses this scene forever
    // - target parked at START..CREATING (2–4): an earlier boot threw
    //   mid-way; manager.start early-returns on that band and the latched
    //   isTransition flag makes manager.stop refuse it too
    const plug = scene.sys.scenePlugin as unknown as { _target: Phaser.Scene | null };
    if (plug._target) plug._target = null;
    const st = tgt.sys.settings.status;
    if (st >= 2 && st <= 4) {
      tgt.sys.settings.isTransition = false;
      scene.scene.stop(key);
    }
    if (key === scene.scene.key) scene.scene.restart(data);
    else scene.scene.start(key, data);
    return true;
  }
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
