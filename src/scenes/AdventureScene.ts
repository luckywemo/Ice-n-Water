import Phaser from 'phaser';
import { makeTextures } from '../art';
import { Sfx } from '../audio';
import { DISPLAY_FONT, UI_FONT, UI, panel, REDUCED_MOTION } from '../ui';
import {
  TOTAL_LEVELS,
  LEVELS_PER_MILESTONE,
  TOTAL_MILESTONES,
  MILESTONE_TOWNS,
  Track,
  TRACK_META,
  levelDef,
  objectiveText,
  adventureProgress,
  totalStars,
  AdventureProgress,
} from '../adventure';
import { fetchBoard, playerName, setPlayerName, submitAdventureScore } from '../leaderboard';

const sfx = Sfx.inst;

const ROW_H = 112; // vertical space per milestone row (at the start — shrinks with distance)
const COLS = LEVELS_PER_MILESTONE;
const PATH_W = 760; // serpentine path width (at the start — converges with distance)
const TOP_PAD = 150; // room for the header
const NODE_R = 17;
const ROW_PAD = 34; // bleed room above/below a row's own band in its canvas
type WarpObj =
  | Phaser.GameObjects.Image
  | Phaser.GameObjects.Text
  | Phaser.GameObjects.Sprite
  | Phaser.GameObjects.Arc;

/**
 * The journey map — 500 nodes snaking upward through 50 Nigerian towns.
 * Nodes are baked into per-row canvas textures (cheap: 50 images, not 500 objects);
 * interaction is invisible zones. Drag / wheel / arrows to travel.
 */
export class AdventureScene extends Phaser.Scene {
  private campaign: Track = 'ice'; // which campaign skin is on the road
  private prog: AdventureProgress = adventureProgress('ice');
  private worldH = 0;
  private pathW = PATH_W;
  private pathX = 0;
  // ---- live 3D-tilt state ----
  private rowImgs: Phaser.GameObjects.Image[] = [];
  private warps: { o: WarpObj; wx: number; wy: number; bs: number }[] = [];
  private zoneRefs: { z: Phaser.GameObjects.Zone; r: number; px: number; py: number; zr: number }[] = [];

  /** everything on the map registers here — update() re-seats it in perspective */
  private track(o: WarpObj, wx: number, wy: number, bs = 1) {
    this.warps.push({ o, wx, wy, bs });
    return o;
  }

  /** the tilt: screen t (0 top → 1 bottom) → scale & displayed world-y.
   *  far rows crush toward the top, near rows grow past full size. */
  private applyWarp() {
    const cam = this.cameras.main;
    const H = this.scale.height;
    const cx = this.scale.width / 2;
    for (const w of this.warps) {
      if (!w.o.active) continue;
      const t = Phaser.Math.Clamp((w.wy - cam.scrollY) / H, 0, 1.25);
      const s = Phaser.Math.Clamp(1.45 * Math.sqrt(Math.max(t, 0.02)), 0.16, 1.35);
      w.o.x = cx + (w.wx - cx) * s;
      w.o.y = cam.scrollY + H * Math.pow(t, 1.5);
      w.o.setScale(w.bs * s);
    }
    // tap zones sit exactly on their node's rendered position
    for (const zm of this.zoneRefs) {
      const img = this.rowImgs[zm.r];
      if (!img) continue;
      const s = img.scaleX;
      const nx = img.x + (zm.px - this.scale.width / 2) * s;
      const ny = img.y + (zm.py - this.rowTop(zm.r) + 10) * s;
      zm.z.setPosition(nx - zm.zr, ny - zm.zr);
    }
  }

  private rowTop(r: number): number {
    // the road ascends — row 0 (Lagos) at the bottom, Maiduguri at the top
    return TOP_PAD + (TOTAL_MILESTONES - 1 - r) * ROW_H;
  }

  private rowBand(_r: number): number {
    return ROW_H;
  }
  private dragY: number | null = null;
  private camStartY = 0;
  private boardLayer: Phaser.GameObjects.Container | null = null;
  private cardLayer: Phaser.GameObjects.Container | null = null; // level preview card
  private revealIdx = -1; // row whose fog burns off this visit
  private revealLabel: Phaser.GameObjects.Text | null = null;
  private marching = false; // frontier marker is mid-march to the next stop
  private frontierWarps: { o: WarpObj; wx: number; wy: number; bs: number }[] = [];

  constructor() {
    super('adventure');
  }

  /** highest row index the player may see — frontier town + one ahead */
  private clearThrough(): number {
    return Math.min(Math.ceil(this.prog.unlocked / COLS), TOTAL_MILESTONES - 1);
  }

  private nodePos(i: number): { x: number; y: number } {
    // level i (0-based) → row r, column c — serpentine: even rows L→R, odd R→L
    const r = Math.floor(i / COLS);
    const c = i % COLS;
    const col = r % 2 === 0 ? c : COLS - 1 - c;
    const x = this.pathX + 60 + (col * (this.pathW - 120)) / (COLS - 1);
    const y = this.rowTop(r) + Math.sin(col * 1.1) * 10;
    return { x, y };
  }

  create(data?: { board?: boolean; track?: Track; advance?: number }) {
    const { width } = this.scale;
    makeTextures(this);
    this.campaign = data?.track ?? this.campaign ?? 'ice';
    const pal = TRACK_META[this.campaign];
    this.prog = adventureProgress(this.campaign);
    this.boardLayer = null; // scene instance persists across restarts
    this.cardLayer = null;
    this.marching = false;
    this.frontierWarps = [];
    this.warps = [];
    this.zoneRefs = [];
    this.rowImgs = [];
    this.cameras.main.setBackgroundColor(UI.bg);
    this.cameras.main.fadeIn(REDUCED_MOTION ? 120 : 300, 0, 0, 0);

    this.pathW = Math.min(PATH_W, width - 60);
    this.pathX = (width - this.pathW) / 2;

    this.worldH = TOP_PAD + (TOTAL_MILESTONES - 1) * ROW_H + 220;

    // did we just push the frontier into a new row? that fog burns off on entry
    const SEEN_KEY = `icenwater_adv_seen_${this.campaign}`;
    const seen = Number(localStorage.getItem(SEEN_KEY) ?? 0);
    this.revealIdx = -1;
    this.revealLabel = null;
    const ct = this.clearThrough();
    if (this.prog.unlocked > 1 && ct > seen) {
      this.revealIdx = ct;
      localStorage.setItem(SEEN_KEY, String(ct));
    }

    const cam = this.cameras.main;
    cam.setBounds(0, 0, width, this.worldH);

    // the road + nodes bake into each row's canvas so the whole path warps as one

    // ---- soft cloud texture for the drifting fog wall ----
    if (!this.textures.exists('fogpuff')) {
      const ft = this.textures.createCanvas('fogpuff', 160, 160);
      const fc = ft?.getContext();
      if (ft && fc) {
        const g = fc.createRadialGradient(80, 80, 8, 80, 80, 80);
        g.addColorStop(0, 'rgba(170,200,220,0.5)');
        g.addColorStop(0.55, 'rgba(140,170,195,0.26)');
        g.addColorStop(1, 'rgba(140,170,195,0)');
        fc.fillStyle = g;
        fc.fillRect(0, 0, 160, 160);
        ft.refresh();
      }
    }

    // ---- nodes baked per-row + tap zones + milestone gates ----
    for (let r = 0; r < TOTAL_MILESTONES; r++) this.bakeRow(r);

    // ---- the cloud wall: where the known road vanishes into fog ----
    const firstClouded = this.clearThrough() + 1;
    if (firstClouded < TOTAL_MILESTONES && this.textures.exists('fogpuff')) {
      const wallY = this.rowTop(firstClouded) + ROW_H * 0.55;
      for (let i = 0; i < 11; i++) {
        const sc = 1.8 + ((i * 13) % 10) / 7;
        const px = (width / 10) * i + ((i * 37) % 40) - 20;
        const py = wallY + ((i * 23) % 26) - 10;
        const puff = this.track(
          this.add.image(px, py, 'fogpuff').setScale(sc).setAlpha(0.85).setDepth(6),
          px,
          py,
          sc,
        );
        this.tweens.add({
          targets: puff,
          alpha: 0.55,
          duration: 3200 + i * 400,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    }

    // ---- start point marker ----
    const p0 = this.nodePos(0);
    this.track(
      this.add
        .text(p0.x, p0.y + 32, 'START', {
          fontFamily: DISPLAY_FONT,
          fontSize: '13px',
          color: '#7fd8f0',
        })
        .setOrigin(0.5, 0)
        .setDepth(3),
      p0.x,
      p0.y + 32,
    );

    // the finish — Maiduguri
    const pEnd = this.nodePos(TOTAL_LEVELS - 1);
    this.track(
      this.add
        .text(this.pathX + this.pathW / 2, pEnd.y - 74, 'MAIDUGURI — THE JOURNEY\'S END', {
          fontFamily: DISPLAY_FONT,
          fontSize: '18px',
          color: '#f5efe0',
          stroke: '#081420',
          strokeThickness: 5,
        })
        .setOrigin(0.5)
        .setDepth(3),
      this.pathX + this.pathW / 2,
      pEnd.y - 74,
    );

    // ---- fixed HUD ----
    const done = Object.keys(this.prog.stars).length;
    panel(this, 12, 10, Math.min(430, width - 24), 58).setScrollFactor(0).setDepth(40);
    this.add
      .text(26, 16, pal.title, {
        fontFamily: DISPLAY_FONT,
        fontSize: '17px',
        color: pal.accentCss,
      })
      .setScrollFactor(0)
      .setDepth(41);
    this.add
      .text(
        26,
        42,
        `level ${Math.min(this.prog.unlocked, TOTAL_LEVELS)}/${TOTAL_LEVELS}  ·  ★ ${totalStars(this.prog)}  ·  ${done} towns conquered`,
        { fontFamily: UI_FONT, fontSize: '13px', color: '#9db4c4' },
      )
      .setScrollFactor(0)
      .setDepth(41);

    // ---- campaign chips — one road, two campaigns ----
    (['ice', 'police'] as const).forEach((tk, i) => {
      const meta = TRACK_META[tk];
      const on = tk === this.campaign;
      const cw = 150;
      const cx = 14 + i * (cw + 10);
      const cy = 76;
      const g = this.add.graphics().setScrollFactor(0).setDepth(40);
      g.fillStyle(on ? meta.accent : 0x12293f, on ? 0.95 : 0.85);
      g.fillRoundedRect(cx, cy, cw, 28, 14);
      g.lineStyle(2, on ? 0xffffff : meta.accent, on ? 0.8 : 0.4);
      g.strokeRoundedRect(cx + 1, cy + 1, cw - 2, 26, 13);
      this.add
        .text(cx + cw / 2, cy + 14, meta.title, {
          fontFamily: DISPLAY_FONT,
          fontSize: '11px',
          color: on ? '#0d1b2a' : '#9db4c4',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(41);
      this.add
        .zone(cx, cy, cw, 28)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(42)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          if (on) return;
          sfx.pickup();
          this.scene.restart({ track: tk });
        });
    });

    // on narrow screens the nav row tucks under the chips instead of clipping the panel
    const navY = width < 560 ? 112 : 18;
    const back = this.add
      .text(this.scale.width - 16, navY, '← TITLE', {
        fontFamily: DISPLAY_FONT,
        fontSize: '15px',
        color: '#9db4c4',
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(41)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.toTitle());
    back.on('pointerover', () => back.setColor('#f5efe0')).on('pointerout', () => back.setColor('#9db4c4'));

    const board = this.add
      .text(this.scale.width - 96, navY, 'BOARD', {
        fontFamily: DISPLAY_FONT,
        fontSize: '15px',
        color: '#ffd54a',
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(41)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.showBoard());
    board.on('pointerover', () => board.setColor('#f5efe0')).on('pointerout', () => board.setColor('#ffd54a'));

    // keep the board warm — name changes & best runs post once per session
    submitAdventureScore();

    // ---- scroll controls — drag with momentum, wheel, keys ----
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (this.boardLayer || this.cardLayer || this.marching) return;
      this.velY = 0;
      cam.scrollY = Phaser.Math.Clamp(cam.scrollY + dy * 0.9, 0, this.worldH - this.scale.height);
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.boardLayer || this.cardLayer || this.marching) return;
      this.dragY = p.y;
      this.camStartY = cam.scrollY;
      this.velY = 0;
      this.lastMoveY = p.y;
      this.lastMoveT = this.time.now;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.boardLayer || this.cardLayer || this.marching) return;
      if (this.dragY === null || !p.isDown) return;
      const dt = Math.max(1, this.time.now - this.lastMoveT);
      this.velY = (-(p.y - this.lastMoveY) / dt) * 1000; // px per second
      this.lastMoveY = p.y;
      this.lastMoveT = this.time.now;
      cam.scrollY = Phaser.Math.Clamp(
        this.camStartY - (p.y - this.dragY),
        0,
        this.worldH - this.scale.height,
      );
    });
    this.input.on('pointerup', () => (this.dragY = null));
    this.input.keyboard!.on('keydown-ESC', () => {
      if (this.boardLayer) this.closeBoard();
      else if (this.cardLayer) this.closeCard();
      else this.toTitle();
    });
    this.input.keyboard!.on('keydown-ENTER', () => {
      if (!this.marching) this.playLevel(this.prog.unlocked);
    });
    this.keys = this.input.keyboard!.addKeys('UP,DOWN,W,S') as Record<string, Phaser.Input.Keyboard.Key>;

    // ---- frontier marker — you are here ----
    const frontierN = Math.min(this.prog.unlocked, TOTAL_LEVELS);
    const fp = this.nodePos(frontierN - 1);
    const ring = this.track(
      this.add
        .circle(fp.x, fp.y, NODE_R + 7)
        .setStrokeStyle(3, 0xffffff, 0.9)
        .setDepth(4),
      fp.x,
      fp.y,
    );
    this.tweens.add({ targets: ring, alpha: 0.15, duration: 750, yoyo: true, repeat: -1 });
    const walker = this.track(
      this.add.sprite(fp.x, fp.y - 34, 'player').setDepth(5).setScale(0.85),
      fp.x,
      fp.y - 34,
      0.85,
    );
    this.tweens.add({ targets: walker, alpha: 0.55, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.track(
      this.add
        .text(fp.x, fp.y - 52, 'YOU', {
          fontFamily: DISPLAY_FONT,
          fontSize: '11px',
          color: '#ffffff',
          stroke: '#081420',
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setDepth(5),
      fp.x,
      fp.y - 52,
    );
    // the march animation drives these three — last tracked = ring, walker, YOU
    this.frontierWarps = this.warps.slice(-3);

    // `advance` = the level number just cleared (only honored at the true frontier)
    const advance =
      data?.advance !== undefined &&
      data.advance === this.prog.unlocked - 1 &&
      data.advance < TOTAL_LEVELS
        ? data.advance
        : null;

    // ---- the journey-in: rise from START at the bottom up to your frontier ----
    // after a clear we open right on the frontier instead — the march needs it
    const anchorY = advance !== null ? this.nodePos(advance - 1).y : fp.y;
    const targetY = Phaser.Math.Clamp(
      anchorY - this.scale.height * 0.62,
      0,
      this.worldH - this.scale.height,
    );
    const startY = Phaser.Math.Clamp(this.worldH - this.scale.height, 0, this.worldH - this.scale.height);
    cam.scrollY = REDUCED_MOTION || advance !== null ? targetY : startY;
    if (!REDUCED_MOTION && advance === null && Math.abs(targetY - startY) > 40) {
      this.tweens.add({
        targets: cam,
        scrollY: targetY,
        duration: Math.min(700 + Math.abs(targetY - startY) * 0.35, 2600),
        ease: 'Cubic.easeInOut',
      });
    }

    // title-screen LEADERBOARD link lands here — open the board over the map
    if (data?.board) this.time.delayedCall(350, () => this.showBoard());

    // new ground was just opened — let the fog burn off with a little ceremony
    if (this.revealIdx >= 0 && !data?.board) {
      this.tweens.killTweensOf(cam); // stop the journey-in pan
      cam.scrollY = Phaser.Math.Clamp(
        this.rowTop(this.revealIdx) - this.scale.height * 0.35,
        0,
        this.worldH - this.scale.height,
      );
      this.playReveal();
    }
    this.applyWarp(); // seat everything before the first frame

    // fresh off a win — walk YOU from the cleared node to the next stop,
    // then open that level's card so the player clicks PLAY to enter
    if (advance !== null && !data?.board) {
      this.time.delayedCall(REDUCED_MOTION ? 150 : 550, () => this.playAdvance(advance));
    }
  }

  /** walk the frontier marker node `a` → node `a+1` along the road, then
   *  open the next level's card — the player clicks PLAY to enter it */
  private playAdvance(a: number) {
    const from = this.nodePos(a - 1);
    const to = this.nodePos(a);
    this.marching = true;

    // each marker keeps its own vertical offset (ring 0, walker -34, YOU -52)
    const offs = this.frontierWarps.map((w) => w.wy - to.y);
    if (REDUCED_MOTION) {
      this.frontierWarps.forEach((w, i) => {
        w.wx = to.x;
        w.wy = to.y + offs[i];
      });
      this.marching = false;
      this.applyWarp();
      this.showLevelCard(Math.min(a + 1, TOTAL_LEVELS));
      return;
    }

    // stage the marker back on the node just cleared
    this.frontierWarps.forEach((w, i) => {
      w.wx = from.x;
      w.wy = from.y + offs[i];
    });

    // same-row hop = small arc; the serpentine wrap = U-turn bow at the edge
    const sameRow = Math.floor((a - 1) / COLS) === Math.floor(a / COLS);
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const ctrl = sameRow
      ? new Phaser.Math.Vector2(midX, midY - 44)
      : new Phaser.Math.Vector2(midX + (from.x > this.pathX + this.pathW / 2 ? 95 : -95), midY);
    const curve = new Phaser.Curves.QuadraticBezier(
      new Phaser.Math.Vector2(from.x, from.y),
      ctrl,
      new Phaser.Math.Vector2(to.x, to.y),
    );

    const t = { v: 0 };
    this.tweens.add({
      targets: t,
      v: 1,
      duration: sameRow ? 800 : 1150,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        const p = curve.getPoint(t.v);
        this.frontierWarps.forEach((w, i) => {
          w.wx = p.x;
          w.wy = p.y + offs[i];
        });
      },
      onComplete: () => {
        this.marching = false;
        sfx.pickup();
        this.showLevelCard(Math.min(a + 1, TOTAL_LEVELS));
      },
    });
  }

  /** fog overlay over the freshly-opened row burns away; the town name arrives */
  private playReveal() {
    const r = this.revealIdx;
    const { width, height } = this.scale;
    const band = this.rowBand(r) + ROW_H + 44;
    if (this.textures.exists(`reveal${r}`)) this.textures.remove(`reveal${r}`);
    const ft = this.textures.createCanvas(`reveal${r}`, width, band);
    const fc = ft?.getContext();
    if (ft && fc) {
      fc.fillStyle = 'rgba(13,27,42,0.92)';
      fc.fillRect(0, 0, width, band);
      for (let k = 0; k < 6; k++) {
        const px = (r * 97 + k * 211) % width;
        const py = (r * 57 + k * 89) % band;
        const rad = 42 + ((r * 31 + k * 17) % 34);
        const g = fc.createRadialGradient(px, py, 4, px, py, rad);
        g.addColorStop(0, 'rgba(120,150,175,0.32)');
        g.addColorStop(1, 'rgba(120,150,175,0)');
        fc.fillStyle = g;
        fc.beginPath();
        fc.arc(px, py, rad, 0, Math.PI * 2);
        fc.fill();
      }
      ft.refresh();
    }
    const top = this.rowTop(r) - 10;
    const fog = this.track(
      this.add.image(width / 2, top, `reveal${r}`).setOrigin(0.5, 0).setDepth(7),
      width / 2,
      top,
    ) as Phaser.GameObjects.Image;
    this.time.delayedCall(500, () => sfx.pickup());
    this.tweens.add({
      targets: fog,
      alpha: 0,
      duration: 1600,
      delay: 700,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.warps = this.warps.filter((w) => w.o !== fog);
        fog.destroy();
        if (this.textures.exists(`reveal${r}`)) this.textures.remove(`reveal${r}`);
      },
    });
    if (this.revealLabel) {
      const lbl = this.revealLabel;
      this.revealLabel = null;
      this.tweens.add({
        targets: lbl,
        alpha: 1,
        duration: 800,
        delay: 1700,
        onComplete: () =>
          this.tweens.add({
            targets: lbl,
            alpha: 0.55,
            duration: 1600,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          }),
      });
    }
    const town = MILESTONE_TOWNS[r];
    const ban = this.add
      .text(width / 2, height * 0.28, `NEW GROUND — ${town.toUpperCase()}`, {
        fontFamily: DISPLAY_FONT,
        fontSize: '30px',
        color: '#f5efe0',
        stroke: '#081420',
        strokeThickness: 7,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(50)
      .setAlpha(0)
      .setScale(0.8);
    const sub = this.add
      .text(width / 2, height * 0.28 + 40, 'the road opens', {
        fontFamily: UI_FONT,
        fontSize: '15px',
        color: '#7fd8f0',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(50)
      .setAlpha(0);
    this.tweens.add({
      targets: [ban, sub],
      alpha: 1,
      scale: 1,
      duration: 500,
      delay: 500,
      ease: 'Back.easeOut',
    });
    this.tweens.add({ targets: [ban, sub], alpha: 0, duration: 600, delay: 3200 });
  }

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private velY = 0;
  private lastMoveY = 0;
  private lastMoveT = 0;

  update(_t: number, delta: number) {
    const cam = this.cameras.main;
    this.applyWarp();
    const k = this.keys;
    const v = (delta / 1000) * 620;
    if (k?.UP?.isDown || k?.W?.isDown)
      cam.scrollY = Phaser.Math.Clamp(cam.scrollY - v, 0, this.worldH - this.scale.height);
    if (k?.DOWN?.isDown || k?.S?.isDown)
      cam.scrollY = Phaser.Math.Clamp(cam.scrollY + v, 0, this.worldH - this.scale.height);

    // fling momentum — decays like a real scroll
    if (this.dragY === null && Math.abs(this.velY) > 20) {
      cam.scrollY = Phaser.Math.Clamp(
        cam.scrollY + this.velY * (delta / 1000),
        0,
        this.worldH - this.scale.height,
      );
      this.velY *= Math.pow(0.92, delta / 16.7); // frame-rate independent decay
    } else if (this.dragY === null) {
      this.velY = 0;
    }
  }

  /** bake a milestone row's nodes+numbers into one canvas texture;
   *  rows beyond "one town ahead" are swallowed by cloud — ghosts only */
  private bakeRow(r: number) {
    const pal = TRACK_META[this.campaign];
    const { width } = this.scale;
    const rowTop = this.rowTop(r);
    const canvasH = this.rowBand(r) + ROW_H + 44; // ROW_H of bleed below = room for the connector
    const clouded = r > this.clearThrough();
    const revealing = r === this.revealIdx;
    // re-entry: keys persist across scene restarts — drop the stale row first
    if (this.textures.exists(`advrow${r}`)) this.textures.remove(`advrow${r}`);
    const tex = this.textures.createCanvas(`advrow${r}`, width, canvasH);
    const ctx = tex?.getContext();
    if (!tex || !ctx) return;

    const ly = (y: number) => y - rowTop + 10; // world-y → canvas-local

    // the road through this row — thick underlay + ice guide line, incl. the
    // segment that connects up to the previous row's last node
    for (let i = Math.max(1, r * COLS); i <= r * COLS + COLS - 1 && i < TOTAL_LEVELS; i++) {
      const a = this.nodePos(i - 1);
      const b = this.nodePos(i);
      ctx.strokeStyle = 'rgba(42,74,99,0.8)';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(a.x, ly(a.y));
      ctx.lineTo(b.x, ly(b.y));
      ctx.stroke();
      ctx.strokeStyle = pal.roadCss;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, ly(a.y));
      ctx.lineTo(b.x, ly(b.y));
      ctx.stroke();
    }

    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const n = i + 1;
      const p = this.nodePos(i);
      const py = ly(p.y);
      const isMilestone = n % LEVELS_PER_MILESTONE === 0;
      const rad = isMilestone ? NODE_R + 6 : NODE_R;

      if (clouded) {
        // a stop ghosting through the fog — you know the road continues
        ctx.beginPath();
        ctx.arc(p.x, py, rad * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(35,64,90,0.45)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(74,122,159,0.35)';
        ctx.stroke();
        continue;
      }

      const done = this.prog.stars[n] !== undefined;
      const open = n <= this.prog.unlocked;

      // node body — locked nodes still read as stops on the road
      ctx.beginPath();
      ctx.arc(p.x, py, rad, 0, Math.PI * 2);
      ctx.fillStyle = done ? '#f0c04a' : open ? pal.accentCss : '#23405a';
      ctx.fill();
      ctx.lineWidth = isMilestone ? 4 : 3;
      ctx.strokeStyle = n === this.prog.unlocked ? '#ffffff' : done ? '#8a6d3a' : '#4a7a9f';
      ctx.stroke();

      // number / lock
      ctx.fillStyle = done ? '#3a2c10' : open ? '#0d1b2a' : '#7fa8c4';
      ctx.font = `bold ${isMilestone ? 15 : 13}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(open ? String(n) : '🔒', p.x, py + 1);

      // stars under completed nodes
      const s = this.prog.stars[n] ?? 0;
      if (s > 0) {
        ctx.fillStyle = '#f0c04a';
        ctx.font = '10px sans-serif';
        ctx.fillText('★'.repeat(s), p.x, py + rad + 11);
      }
    }

    if (clouded) {
      // the fog itself — covers this row's band + the connector bleed below it
      ctx.fillStyle = 'rgba(13,27,42,0.78)';
      ctx.fillRect(0, 4, width, canvasH - 4);
      for (let k = 0; k < 6; k++) {
        const px = (r * 97 + k * 211) % width;
        const py = 10 + ((r * 57 + k * 89) % (canvasH - 20));
        const rad = 42 + ((r * 31 + k * 17) % 34);
        const g = ctx.createRadialGradient(px, py, 4, px, py, rad);
        g.addColorStop(0, 'rgba(120,150,175,0.30)');
        g.addColorStop(1, 'rgba(120,150,175,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    tex.refresh();
    const img = this.add
      .image(width / 2, rowTop - 10, `advrow${r}`)
      .setOrigin(0.5, 0)
      .setDepth(2);
    this.rowImgs[r] = this.track(img, width / 2, rowTop - ROW_H) as Phaser.GameObjects.Image;

    if (clouded) return; // no town names, no tap zones in the fog

    // milestone gate — the town name beside the big node
    const n = (r + 1) * COLS;
    const p = this.nodePos(n - 1);
    const open = n <= this.prog.unlocked;
    // label sits inward of the gate node so it never clips the canvas edge
    const right = r % 2 === 0;
    const lx = p.x + (right ? -36 : 36);
    const lyy = p.y - 34;
    const townLabel = this.track(
      this.add
        .text(lx, lyy, `${MILESTONE_TOWNS[r].toUpperCase()}`, {
          fontFamily: DISPLAY_FONT,
          fontSize: '14px',
          color: open ? '#f5efe0' : '#4a637a',
          stroke: '#081420',
          strokeThickness: 4,
        })
        .setOrigin(right ? 1 : 0, 0.5)
        .setDepth(3),
      lx,
      lyy,
    ) as Phaser.GameObjects.Text;
    if (revealing) {
      townLabel.setAlpha(0);
      this.revealLabel = townLabel;
    } else if (open) {
      this.tweens.add({
        targets: townLabel,
        alpha: 0.55,
        duration: 1600,
        delay: r * 90,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // tap zones — repositioned each frame onto the node's warped position
    for (let c = 0; c < COLS; c++) {
      const n2 = r * COLS + c + 1;
      const p2 = this.nodePos(n2 - 1);
      const z = this.add
        .zone(p2.x - 21, p2.y - 21, 42, 42)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: n2 <= this.prog.unlocked })
        .on('pointerdown', () => {
          if (!this.marching && n2 <= this.prog.unlocked) this.showLevelCard(n2);
        });
      this.zoneRefs.push({ z, r, px: p2.x, py: p2.y, zr: 21 });
    }
  }

  // ---------- global leaderboard overlay ----------

  private showBoard() {
    if (this.boardLayer) return;
    const { width, height } = this.scale;
    const layer = this.add.container(0, 0).setScrollFactor(0).setDepth(60);
    this.boardLayer = layer;

    const dim = this.add
      .rectangle(width / 2, height / 2, width, height, 0x081420, 0.85)
      .setInteractive(); // swallow taps
    const pw = Math.min(460, width - 40);
    const ph = Math.min(620, height - 40);
    const px = (width - pw) / 2;
    const py = (height - ph) / 2;

    const pnl = panel(this, px, py, pw, ph, { alpha: 0.97 });
    const title = this.add
      .text(width / 2, py + 30, 'TOP RUNNERS', {
        fontFamily: DISPLAY_FONT,
        fontSize: '24px',
        color: '#ffd54a',
      })
      .setOrigin(0.5);
    const sub = this.add
      .text(width / 2, py + 56, 'who is furthest up the road north', {
        fontFamily: UI_FONT,
        fontSize: '12px',
        color: '#9db4c4',
      })
      .setOrigin(0.5);
    const rows = this.add
      .text(px + 30, py + 84, 'reaching the board…', {
        fontFamily: UI_FONT,
        fontSize: '14px',
        color: '#d8e6ee',
        lineSpacing: 8,
      })
      .setName('boardRows');
    const me = this.add
      .text(width / 2, py + ph - 66, '', {
        fontFamily: UI_FONT,
        fontSize: '14px',
        fontStyle: '600',
        color: '#7fd8f0',
      })
      .setOrigin(0.5)
      .setName('boardMe');
    const hint = this.add
      .text(width / 2, py + ph - 44, 'win levels to climb · deeper north = higher rank', {
        fontFamily: UI_FONT,
        fontSize: '11px',
        color: '#5a7184',
      })
      .setOrigin(0.5);
    const close = this.add
      .text(px + pw - 12, py + 10, '✕', {
        fontFamily: DISPLAY_FONT,
        fontSize: '20px',
        color: '#9db4c4',
      })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.closeBoard());
    close.on('pointerover', () => close.setColor('#f5efe0')).on('pointerout', () => close.setColor('#9db4c4'));

    // name row — tap SET to name your runner (shares the online lobby name)
    const nameLbl = this.add
      .text(px + 30, py + ph - 96, `NAME: ${playerName() || '—'}`, {
        fontFamily: UI_FONT,
        fontSize: '13px',
        fontStyle: '600',
        color: '#7d93a5',
      })
      .setOrigin(0, 0.5)
      .setName('boardName');
    const setBtn = this.add
      .text(px + pw - 30, py + ph - 96, 'SET', {
        fontFamily: DISPLAY_FONT,
        fontSize: '14px',
        color: '#4dd0e1',
      })
      .setOrigin(1, 0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        const n = window.prompt('runner name (shows on the board)', playerName());
        if (n === null) return;
        setPlayerName(n);
        nameLbl.setText(`NAME: ${playerName() || '—'}`);
        submitAdventureScore(true);
        this.time.delayedCall(700, () => this.renderBoard()); // let the post land
      });
    setBtn.on('pointerover', () => setBtn.setColor('#f5efe0')).on('pointerout', () => setBtn.setColor('#4dd0e1'));

    layer.add([dim, pnl, title, sub, rows, me, hint, close, nameLbl, setBtn]);

    this.renderBoard();
  }

  private async renderBoard() {
    const rowsObj = this.children.getByName('boardRows') as Phaser.GameObjects.Text | null;
    const meObj = this.children.getByName('boardMe') as Phaser.GameObjects.Text | null;
    try {
      const b = await fetchBoard();
      if (!this.boardLayer || !rowsObj) return; // closed mid-flight
      rowsObj.setText(
        b.top.length
          ? b.top
              .slice(0, 20)
              .map((e) => `${String(e.rank).padStart(2)}  ${e.name.padEnd(14)}  L${e.level}  ·  ★${e.stars}`)
              .join('\n')
          : 'no runners yet — be the first to post a level!',
      );
      meObj?.setText(
        b.me
          ? `you: #${b.me.rank}  ·  L${b.me.level}  ·  ★${b.me.stars}`
          : 'you: unranked — clear a level to join the board',
      );
    } catch {
      rowsObj?.setText(
        'the board is offline right now\n(it lives on our game server — same one as online play)',
      );
      meObj?.setText('');
    }
  }

  private closeBoard() {
    this.boardLayer?.destroy();
    this.boardLayer = null;
  }

  private closeCard() {
    this.cardLayer?.destroy();
    this.cardLayer = null;
  }

  /** bottom sheet — the level's name, chapter, objective, stars, PLAY */
  private showLevelCard(n: number) {
    this.closeCard();
    const def = levelDef(this.campaign, Math.min(n, TOTAL_LEVELS));
    const pal = TRACK_META[this.campaign];
    const { width, height } = this.scale;
    const W = Math.min(440, width - 36);
    const H = 128;
    const x = width / 2 - W / 2;
    const y = height - H - 16;

    const g = this.add.graphics();
    g.fillStyle(UI.panel, 0.96).fillRoundedRect(x, y, W, H, 12);
    g.lineStyle(2, pal.accent, 0.85).strokeRoundedRect(x + 1, y + 1, W - 2, H - 2, 12);

    const stars = this.prog.stars[n] ?? 0;
    const playBtn = this.add
      .text(x + W - 20, y + H - 30, 'PLAY ▶', {
        fontFamily: DISPLAY_FONT,
        fontSize: '17px',
        color: pal.accentCss,
      })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.playLevel(n))
      .on('pointerover', () => playBtn.setColor('#f5efe0'))
      .on('pointerout', () => playBtn.setColor(pal.accentCss));
    const kids = [
      g,
      this.add.text(x + 16, y + 12, `LEVEL ${n} — ${def.name}`, {
        fontFamily: DISPLAY_FONT,
        fontSize: '15px',
        color: '#f5efe0',
      }),
      this.add
        .text(x + W - 44, y + 14, stars ? '★'.repeat(stars) : '—', {
          fontFamily: UI_FONT,
          fontSize: '15px',
          color: '#f0c04a',
        })
        .setOrigin(1, 0),
      this.add.text(x + 16, y + 38, `${def.chapter}${def.town ? '  ·  ' + def.town.toUpperCase() : ''}`, {
        fontFamily: UI_FONT,
        fontSize: '12px',
        fontStyle: '600',
        color: '#9db4c4',
      }),
      this.add.text(x + 16, y + 60, `◆ ${objectiveText(def)}${def.boss ? '  ·  BOSS FIGHT' : ''}`, {
        fontFamily: UI_FONT,
        fontSize: '13px',
        color: pal.accentCss,
      }),
      this.add.text(x + 16, y + 82, `${def.chasers} militia · ${def.seconds}s · crew of ${def.crew}`, {
        fontFamily: UI_FONT,
        fontSize: '12px',
        color: '#7d93a5',
      }),
      playBtn,
      this.add
        .text(x + W - 16, y + 12, '✕', {
          fontFamily: UI_FONT,
          fontSize: '17px',
          fontStyle: '600',
          color: '#7d93a5',
        })
        .setOrigin(1, 0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.closeCard()),
    ];

    const c = this.add.container(0, 0, kids).setScrollFactor(0).setDepth(50);
    if (!REDUCED_MOTION) {
      c.y = 60;
      c.alpha = 0;
      this.tweens.add({ targets: c, y: 0, alpha: 1, duration: 220, ease: 'Cubic.easeOut' });
    }
    this.cardLayer = c;
  }

  private playLevel(n: number) {
    sfx.ensure();
    sfx.shortWhistle();
    this.cameras.main.fadeOut(220, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      this.scene.start('game', { adventure: levelDef(this.campaign, Math.min(n, TOTAL_LEVELS)) }),
    );
  }

  private toTitle() {
    this.cameras.main.fadeOut(220, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      this.scene.start('title'),
    );
  }
}
