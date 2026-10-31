import Phaser from 'phaser';
import { UI_FONT, DISPLAY_FONT, UI, HudItem, pinHud, layoutHud, screenToHudWorld, viewZoom, hudFactor } from './ui';
import { JoyMode, loadPicks } from './meta';

// Virtual joystick (left thumb) + sprint/water buttons (right thumb).
// Only exists on touch devices — dead simple to ignore on desktop.
//
// Two coordinate spaces matter here:
//   SCREEN — pointer positions, hit tests, joystick math (what the thumb sees)
//   WORLD  — where objects must be placed so the zoomed follow-camera
//            renders them at that screen point (screenToHudWorld)

export class TouchControls {
  readonly enabled: boolean;
  readonly dir = new Phaser.Math.Vector2();
  sprint = false;

  private scene: Phaser.Scene;
  private active = true; // false during the result screen — dash owns the taps
  private joyPointerId = -1;
  private sprintPointerId = -1;
  private joyCenter = new Phaser.Math.Vector2(); // SCREEN coords
  private readonly sticky: boolean;
  private base!: Phaser.GameObjects.Arc;
  private thumb!: Phaser.GameObjects.Arc;
  private sprintBtn!: Phaser.GameObjects.Container;
  private waterBtn!: Phaser.GameObjects.Container;
  private restartBtn!: Phaser.GameObjects.Container;
  private pauseBtn: Phaser.GameObjects.Container | null = null;
  private hudItems: HudItem[] = [];
  private relayout: () => void = () => {};
  private hs = 1; // rendered scale of authored px under live zoom + HUD shrink
  private hf = 1; // HUD shrink factor (small screens)

  static isTouchDevice(): boolean {
    // primary-input check, not capability — a touchscreen laptop still has a
    // fine primary pointer (mouse/trackpad) and wants the desktop treatment;
    // only a coarse primary (phone/tablet thumb) counts as touch
    const mq = (q: string) => window.matchMedia?.(q).matches ?? false;
    if (mq('(pointer: coarse)')) return true;
    if (mq('(pointer: fine)')) return false;
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0; // fallback
  }

  constructor(
    scene: Phaser.Scene,
    cbs: { onWater: () => void; onRestart: () => void; onPause?: () => void },
    joy: JoyMode = 'floating',
  ) {
    this.scene = scene;
    this.enabled = TouchControls.isTouchDevice();
    this.sticky = joy === 'sticky';
    if (!this.enabled) return;

    scene.input.addPointer(2);

    this.hf = hudFactor(scene.scale.width, scene.scale.height);
    this.hs = this.hf / viewZoom(scene.scale.width, scene.scale.height);
    this.base = scene.add
      .circle(0, 0, 62, 0x12293f, 0.4)
      .setStrokeStyle(2, UI.ice, 0.5)
      .setDepth(30)
      .setVisible(false)
      .setScale(this.hs)
      .setScrollFactor(0);
    this.thumb = scene.add
      .circle(0, 0, 26, UI.ice, 0.55)
      .setDepth(31)
      .setVisible(false)
      .setScale(this.hs)
      .setScrollFactor(0);

    this.sprintBtn = this.makeButton(scene, 44, 'RUN', 0xf7bd14, '#17151f');
    this.waterBtn = this.makeButton(scene, 36, 'H₂O', 0x29b6f6);
    this.restartBtn = this.makeButton(scene, 22, '↻', 0x17151f); // beside the HUD panel — minimap owns top-right
    // pause only exists where a handler is supplied — net play never gets one
    if (cbs.onPause) this.pauseBtn = this.makeButton(scene, 22, 'II', 0x17151f);

    // pin: sprint bottom-right, water just above-left of it, restart top-left
    this.pin(this.sprintBtn, 1, 1, -80, -96);
    this.pin(this.waterBtn, 1, 1, -180, -150);
    this.pin(this.restartBtn, 0, 0, 384, 34); // hugs the HUD card's right edge
    if (this.pauseBtn) this.pin(this.pauseBtn, 0, 0, 438, 34);

    this.relayout = () => {
      const w = scene.scale.width;
      const h = scene.scale.height;
      const z = viewZoom(w, h);
      this.hf = hudFactor(w, h);
      this.hs = this.hf / z;
      layoutHud(this.hudItems, w, h, z, this.hf);
      this.base.setScale(this.hs);
      this.thumb.setScale(this.hs);
      if (this.sticky) {
        this.joyCenter.set(120 * this.hf, h - 118 * this.hf); // fixed home in screen coords
        this.placeAt(this.base, this.joyCenter.x, this.joyCenter.y);
        this.placeAt(this.thumb, this.joyCenter.x, this.joyCenter.y);
      }
    };
    scene.scale.on('resize', this.relayout);
    scene.events.once('shutdown', () => scene.scale.off('resize', this.relayout));
    this.relayout();

    if (this.sticky) {
      this.base.setVisible(true);
      this.thumb.setVisible(true);
    }

    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.active) return;
      const w = scene.scale.width;
      const h = scene.scale.height;
      // floating: stick spawns where the thumb lands on the left side;
      // sticky: stick stays put — thumb must land near its fixed home
      const inZone = this.sticky
        ? Phaser.Math.Distance.Between(p.x, p.y, this.joyCenter.x, this.joyCenter.y) <= 95 * this.hf
        : p.x < w * 0.55 && p.y > h * 0.35;
      if (this.joyPointerId < 0 && inZone) {
        this.joyPointerId = p.id;
        if (!this.sticky) {
          this.joyCenter.set(p.x, p.y);
          this.placeAt(this.base, p.x, p.y).setVisible(true);
          this.placeAt(this.thumb, p.x, p.y);
        }
        this.thumb.setVisible(true);
      }
      if (this.sprintPointerId < 0 && this.inside(p, this.sprintBtn, 52 * this.hf)) {
        this.sprintPointerId = p.id;
        this.sprint = true;
        this.sprintBtn.setScale(0.9 * this.hs);
      }
      if (this.inside(p, this.waterBtn, 46 * this.hf)) {
        cbs.onWater();
        this.tapFlash(scene, this.waterBtn);
      }
      if (this.inside(p, this.restartBtn, 30 * this.hf)) {
        cbs.onRestart();
        this.tapFlash(scene, this.restartBtn);
      }
      if (this.pauseBtn && this.inside(p, this.pauseBtn, 30 * this.hf)) {
        cbs.onPause?.();
        this.tapFlash(scene, this.pauseBtn);
      }
    });

    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.active || p.id !== this.joyPointerId || !p.isDown) return;
      const v = new Phaser.Math.Vector2(p.x - this.joyCenter.x, p.y - this.joyCenter.y);
      const max = 62 * this.hf;
      if (v.length() > max) v.setLength(max);
      this.dir.copy(v).scale(1 / max);
      this.placeAt(this.thumb, this.joyCenter.x + v.x, this.joyCenter.y + v.y);
    });

    const release = (p: Phaser.Input.Pointer) => {
      if (p.id === this.joyPointerId) {
        this.joyPointerId = -1;
        this.dir.set(0, 0);
        this.placeAt(this.thumb, this.joyCenter.x, this.joyCenter.y);
        if (!this.sticky) {
          this.base.setVisible(false);
          this.thumb.setVisible(false);
        }
      }
      if (p.id === this.sprintPointerId) {
        this.sprintPointerId = -1;
        this.sprint = false;
        this.sprintBtn.setScale(this.hs);
      }
    };
    scene.input.on('pointerup', release);
    scene.input.on('pointerupoutside', release);
  }

  /** is this pointer currently driving the joystick? lets the camera orbit
   *  handler skip stick drags */
  isJoyPointer(p: Phaser.Input.Pointer) {
    return p.id === this.joyPointerId;
  }

  /** freeze every pad + hide the buttons — e.g. when the result dashboard is up */
  setActive(on: boolean) {
    this.active = on;
    if (!this.enabled) return;
    this.joyPointerId = -1;
    this.sprintPointerId = -1;
    this.dir.set(0, 0);
    this.sprint = false;
    this.base.setVisible(on && this.sticky);
    this.thumb.setVisible(on && this.sticky);
    this.sprintBtn.setVisible(on);
    this.waterBtn.setVisible(on);
    this.restartBtn.setVisible(on);
    this.pauseBtn?.setVisible(on);
  }

  private pin<T extends HudItem['obj']>(obj: T, ax: number, ay: number, ox: number, oy: number): T {
    return pinHud(this.hudItems, obj, ax, ay, ox, oy) as T;
  }

  /** place an object so it RENDERS at screen point (sx, sy) despite camera zoom */
  private placeAt<T extends { setPosition: (x: number, y: number) => T }>(
    obj: T,
    sx: number,
    sy: number,
  ): T {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const pos = screenToHudWorld(sx, sy, w, h, viewZoom(w, h));
    return obj.setPosition(pos.x, pos.y);
  }

  private makeButton(
    scene: Phaser.Scene,
    r: number,
    label: string,
    face: number,
    labelColor = '#ffffff',
  ): Phaser.GameObjects.Container {
    // candy anatomy like every other control: dark base, white rim,
    // colored face, sheen — not a flat translucent disc
    const g = scene.add.graphics();
    g.fillStyle(0x0a1420, 0.55).fillCircle(2, 5, r); // drop base
    g.fillStyle(0xffffff, 1).fillCircle(0, 0, r + 3); // rim
    g.fillStyle(face, 1).fillCircle(0, 0, r); // face
    g.fillStyle(0xffffff, 0.28).fillEllipse(0, -r * 0.42, r * 1.15, r * 0.5); // sheen
    const text = scene.add
      .text(0, 1, label, {
        fontFamily: DISPLAY_FONT,
        fontSize: `${Math.max(13, r * 0.36)}px`,
        color: labelColor,
      })
      .setOrigin(0.5);
    const c = scene.add.container(0, 0, [g, text]).setDepth(30).setScrollFactor(0);
    return c;
  }

  /** hit-test in SCREEN coords — the pin stores the authored screen pos */
  private inside(p: Phaser.Input.Pointer, btn: Phaser.GameObjects.Container, r: number): boolean {
    const it = this.hudItems.find((i) => i.obj === (btn as unknown as HudItem['obj']));
    if (!it) return false;
    const sx = it.ax * this.scene.scale.width + it.ox * this.hf;
    const sy = it.ay * this.scene.scale.height + it.oy * this.hf;
    return Phaser.Math.Distance.Between(p.x, p.y, sx, sy) <= r;
  }

  private tapFlash(scene: Phaser.Scene, btn: Phaser.GameObjects.Container) {
    scene.tweens.add({ targets: btn, scale: 0.85 * this.hs, duration: 80, yoyo: true });
  }
}

/** keyboard-hint chrome — never renders on touch (there are no keys);
 *  desktop users can kill it in Settings › GAME › Key hints */
export function keyHintsOn(): boolean {
  return !TouchControls.isTouchDevice() && loadPicks().hints;
}

/** virtual-stage zoom with a bounded cover boost: on landscape touch screens
 *  the exact fit shrinks chrome below comfortable tap size, so zoom up to
 *  ~1.22x and let the stage crop a little instead. Safe because all chrome
 *  anchors to the visible edges (visT/visB/visL/visR) — the crop can only
 *  eat stage margin, never the UI. Portrait's width constraint makes the
 *  same boost crop the sides, so it stays exact-fit; desktop (fine pointer)
 *  keeps letterbox too — small windows there are transient, not the device. */
export function fitZoom(w: number, h: number, vw: number, vh: number): number {
  const fit = Math.min(w / vw, h / vh);
  return w > h && TouchControls.isTouchDevice() ? fit * 1.22 : fit;
}
