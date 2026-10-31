// unified input: WASD/arrows + shift sprint + space jump + E shout + P pause
// + pointer-drag camera orbit/zoom + virtual joystick/buttons on touch.
import { $, clamp } from './util';

export interface InputState {
  mx: number; mz: number;      // move vector, camera-relative applied later, magnitude ≤1
  sprint: boolean;
  jumpDown: boolean;           // edge
  shoutDown: boolean;          // edge
  skillDown: boolean;          // edge — inherited move (F / ⚡)
  pauseDown: boolean;          // edge
  camDelta: number;            // yaw delta this frame (radians)
  zoomDelta: number;           // wheel ticks
}

const keys = new Set<string>();
let camDelta = 0, zoomDelta = 0;
let jumpE = false, shoutE = false, pauseE = false, skillE = false;

// joystick state
let joyId = -1, joyX = 0, joyY = 0;
let tSprint = false, tJump = false, tShout = false, tSkill = false;

export const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export function initInput(canvas: HTMLElement) {
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === ' ') { jumpE = true; e.preventDefault(); }
    if (k === 'e') shoutE = true;
    if (k === 'f') skillE = true;
    if (k === 'p' || k === 'escape') pauseE = true;
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());

  // camera drag (mouse on canvas, or right-touch zone on mobile)
  let dragId = -1, lx = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (isTouch()) return; // touch camera comes from right-half drag below
    if (dragId < 0) { dragId = e.pointerId; lx = e.clientX; canvas.setPointerCapture(e.pointerId); }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === dragId) { camDelta += (e.clientX - lx) * .006; lx = e.clientX; }
  });
  const endDrag = (e: PointerEvent) => { if (e.pointerId === dragId) dragId = -1; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => { zoomDelta += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });

  // ---- touch: joystick + right-half camera drag
  const stick = $('stick'), knob = $('knob');
  const stickRect = () => stick.getBoundingClientRect();
  const setKnob = (dx: number, dy: number) => {
    knob.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
  };
  stick.addEventListener('pointerdown', (e) => {
    joyId = e.pointerId; stick.setPointerCapture(e.pointerId); e.preventDefault();
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== joyId) return;
    const r = stickRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const m = Math.hypot(dx, dy);
    const c = m > 1 ? 1 / m : 1;
    joyX = dx * c; joyY = dy * c;
    setKnob(joyX, joyY);
  });
  const joyEnd = (e: PointerEvent) => {
    if (e.pointerId !== joyId) return;
    joyId = -1; joyX = joyY = 0; setKnob(0, 0);
  };
  stick.addEventListener('pointerup', joyEnd);
  stick.addEventListener('pointercancel', joyEnd);

  // right-half of canvas = camera drag on touch
  canvas.addEventListener('pointerdown', (e) => {
    if (!isTouch()) return;
    if (e.clientX < innerWidth * .45) return; // joystick side
    if (dragId < 0) { dragId = e.pointerId; lx = e.clientX; }
  });

  // buttons
  const bind = (id: string, set: (v: boolean) => void) => {
    const el = $(id);
    el.addEventListener('pointerdown', (e) => { set(true); e.preventDefault(); });
    el.addEventListener('pointerup', () => set(false));
    el.addEventListener('pointercancel', () => set(false));
  };
  bind('tSprint', (v) => tSprint = v);
  bind('tJump', (v) => { if (v) tJump = true; });
  bind('tShout', (v) => { if (v) tShout = true; });
  bind('tSkill', (v) => { if (v) tSkill = true; });
}

export function readInput(): InputState {
  // mz convention: +1 = away from camera (forward), -1 = toward camera
  let mx = 0, mz = 0;
  if (keys.has('w') || keys.has('arrowup')) mz += 1;
  if (keys.has('s') || keys.has('arrowdown')) mz -= 1;
  if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
  if (keys.has('d') || keys.has('arrowright')) mx += 1;
  mx += joyX; mz -= joyY; // joyY is screen-space down-positive
  const m = Math.hypot(mx, mz);
  if (m > 1) { mx /= m; mz /= m; }
  const sprint = keys.has('shift') || tSprint;
  const st: InputState = {
    mx, mz, sprint,
    jumpDown: jumpE || tJump, shoutDown: shoutE || tShout, skillDown: skillE || tSkill, pauseDown: pauseE,
    camDelta, zoomDelta,
  };
  jumpE = shoutE = pauseE = skillE = tJump = tShout = tSkill = false;
  camDelta = 0; zoomDelta = 0;
  return st;
}

export function camYawDelta() { const d = camDelta; camDelta = 0; return d; }
export const clampMag = (x: number, z: number) => { const m = Math.hypot(x, z); return m > 1 ? { x: x / m, z: z / m } : { x, z }; };
export { clamp };
