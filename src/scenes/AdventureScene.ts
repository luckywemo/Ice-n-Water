import Phaser from 'phaser';
import { makeTextures } from '../art';
import { Sfx } from '../audio';
import { DISPLAY_FONT, UI_FONT, UI, panel, REDUCED_MOTION, shade, textInputFocused } from '../ui';
import { promptModal, fgCrownField, fgRings, fgHexBadge, fgProgressBar, fgTopBar, FG, FG_FONT } from '../fgui';
import { fitZoom } from '../mobile';
import { viaWipe, wipeTo } from '../wipe';
import { Hero3D } from '../hero3d';
import { currentChar } from '../characters';
import { loadStats, perfInterval, furQuality, loadPicks } from '../meta';
import {
  TOTAL_LEVELS,
  LEVELS_PER_MILESTONE,
  TOTAL_MILESTONES,
  MILESTONE_TOWNS,
  levelDef,
  objectiveText,
  adventureProgress,
  totalStars,
  AdventureProgress,
} from '../adventure';
import { fetchBoard, playerName, setPlayerName, submitAdventureScore } from '../leaderboard';
import { pushProfile } from '../cloudsave';

const sfx = Sfx.inst;

const COLS = LEVELS_PER_MILESTONE;
const CARD_W = 96; // tier card face — the seasons-screen rail
const CARD_H = 110;
const CARD_GAP = 118; // centre-to-centre spacing on the rail
const CARD_PAD = 40; // strip margin so badges/rims don't clip the canvas
const BADGE_H = 34; // hexagon overhang above each card
const TOWN_H = 30; // town label below each strip's milestone card
const STRIP_W = CARD_PAD * 2 + (COLS - 1) * CARD_GAP + CARD_W;
const STRIP_H = BADGE_H + CARD_H + TOWN_H;

// same virtual stage as the lobby — the whole scene composes at 1280×800
// and letterboxes uniformly on any window instead of laying out in raw px
const VW = 1280;
const VH = 800;

/**
 * The journey map — 500 tier cards on a horizontal rail through 50 Nigerian
 * towns, styled on the seasons/progress screen. Cards bake into per-town
 * canvas strips (50 images, not 500 objects); taps are resolved by math.
 * Drag / wheel / arrows to travel.
 */
export class AdventureScene extends Phaser.Scene {
  private prog: AdventureProgress = adventureProgress();
  private worldW = 0;
  private zoomK = 1; // stage zoom — screen px ÷ zoomK = world px
  private visW = VW; // visible world size after letterboxing
  // Phaser zooms around the viewport centre, so cam.scroll sits
  // off *behind* the view's top-left corner: viewLeft = scrollX + offX
  private offX = 0;
  private offY = 0;
  private visT = 0;
  private scrollLo = 0; // allowed scrollX range under the zoomed camera
  private scrollHi = 0;
  // all screen-fixed UI rides inside this container — positioned at
  // (offX, offY) it exactly cancels the centre-zoom shift, so children
  // keep plain stage coords and land at stage*zoom regardless of scroll
  private chrome!: Phaser.GameObjects.Container;
  // the live podium bean — same WebGL + fur pipeline as the lobby
  private hero3d?: Hero3D;
  private heroCv?: HTMLCanvasElement;
  private heroCtx?: CanvasRenderingContext2D;
  private heroImg?: Phaser.GameObjects.Image;
  private heroLastT = 0; // throttle on the composite
  private heroMs = 33; // ms between composites — the Bean FPS pick
  private visH = VH;
  private railY = 0;
  private railX0 = 68; // first card's centre-x — viewLeft is 0, so it hugs the screen edge
  private stripImgs: Phaser.GameObjects.Image[] = [];
  private selected = 0; // rail selection — 0-based level index
  private selRing?: Phaser.GameObjects.Graphics;
  private frontier!: Phaser.GameObjects.Container; // YOU marker group
  private detailLayer: Phaser.GameObjects.Container | null = null;

  /** 0-based level index → card centre-x on the rail */
  private cardX(i: number): number {
    return this.railX0 + i * CARD_GAP;
  }

  private boardLayer: Phaser.GameObjects.Container | null = null;
  private boardTiles: {
    c: Phaser.GameObjects.Container;
    face: Phaser.GameObjects.Graphics;
    rank: Phaser.GameObjects.Text;
    name: Phaser.GameObjects.Text;
    stat: Phaser.GameObjects.Text;
  }[] = [];
  private boardBanner?: Phaser.GameObjects.Text;
  private boardMeTxt?: Phaser.GameObjects.Text;
  private modalOpen = false; // DOM prompt owns input — mute global handlers
  // screen-space tap rects for overlay buttons — container-children input is
  // unreliable under the camera scroll, so taps are checked manually
  private cardHit: { x: number; y: number; w: number; h: number; fn: () => void }[] = [];
  private boardHit: { x: number; y: number; w: number; h: number; fn: () => void }[] = [];
  private revealIdx = -1; // town whose banner plays this visit
  private marching = false; // frontier marker is mid-march to the next stop
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private dragX: number | null = null;
  private camStartX = 0;
  private velX = 0;
  private lastMoveX = 0;
  private lastMoveT = 0;
  private tapStart: { x: number; y: number } | null = null;

  constructor() {
    super('adventure');
  }

  /** strip index holding the frontier card — where the rail opens */
  private frontierTown(): number {
    return Math.min(Math.ceil(this.prog.unlocked / COLS), TOTAL_MILESTONES - 1);
  }

  /** strip index → world-x of its left edge on the rail */
  private stripX(r: number): number {
    return this.railX0 - CARD_PAD - CARD_W / 2 + r * COLS * CARD_GAP;
  }

  create(data?: { board?: boolean; advance?: number }) {
    const { width, height } = this.scale;
    makeTextures(this);
    this.prog = adventureProgress();
    this.boardLayer = null; // scene instance persists across restarts
    this.detailLayer = null;
    this.cardHit = [];
    this.boardHit = [];
    this.marching = false;
    this.stripImgs = [];
    this.heroMs = perfInterval(); // re-read per create — the pick can change
    this.cameras.main.setBackgroundColor(FG.cyan);
    if (!viaWipe(data)) this.cameras.main.fadeIn(REDUCED_MOTION ? 120 : 300, 0x2b, 0xb8, 0xf0);

    // the lobby's virtual stage — uniform zoom, centred, letterboxed. The
    // rail lives in world space past the stage edge; fixed chrome uses
    // stage coords + scrollFactor(0), same as TitleScene.
    const zoomK = (this.zoomK = fitZoom(width, height, VW, VH));
    this.visW = width / zoomK;
    const visH = (this.visH = height / zoomK);
    this.offX = (width - this.visW) / 2; // viewLeft = scrollX + offX
    this.offY = (height - visH) / 2;
    this.visT = VH / 2 - visH / 2;
    this.chrome = this.add
      .container(this.offX, this.offY)
      .setScrollFactor(0)
      .setDepth(40);
    const cam = this.cameras.main;
    cam.setZoom(zoomK);
    cam.centerOn(VW / 2, VH / 2);
    // Phaser RESIZE fires after create() as the window settles (mobile URL
    // bar, orientation) — without this the zoom goes stale and the stage
    // center-crops. Same approach as the lobby: restart on real resizes.
    let lastW = width;
    let lastH = height;
    const onResize = (sz: Phaser.Structs.Size) => {
      // soft keyboard = a fake resize while typing — restarting here
      // destroys the open prompt (and the DOM input with it)
      if (textInputFocused()) return;
      if (Math.abs(sz.width - lastW) > 24 || Math.abs(sz.height - lastH) > 24) {
        lastW = sz.width;
        lastH = sz.height;
        this.scene.restart();
      }
    };
    this.scale.on('resize', onResize);
    // scale listeners are global — they survive restarts; detach on shutdown
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.scale.off('resize', onResize),
    );

    // the seasons field — cyan rings radiating behind the podium. No crowns:
    // crowns are the boot tile's flourish, gameplay screens get rings only.
    // the spiral field emanates from behind the bean — its rings' centre
    // sits at the statue's mid-body. Like the podium it's a root-level
    // sf0 object, so the drawn centre takes +off to cancel centre-zoom
    fgRings(this, this.visW, visH, VW * 0.66 + this.offX, VH * 0.66 - 150 + this.offY, FG.cyan, 0x1fa9e8)
      .setScrollFactor(0)
      // pure background — stays at display root UNDER the rail; its
      // overscan already covers the centre-zoom shift
      .setData('screenFixed', 1);

    this.railY = VH * 0.8;
    this.worldW = this.railX0 + (TOTAL_LEVELS - 1) * CARD_GAP + 140;

    // did we just push the frontier into a new town? its name gets a banner
    const SEEN_KEY = `icenwater_adv_seen`;
    const seen = Number(localStorage.getItem(SEEN_KEY) ?? 0);
    this.revealIdx = -1;
    const ft = this.frontierTown();
    if (this.prog.unlocked > 1 && ft > seen) {
      this.revealIdx = ft;
      localStorage.setItem(SEEN_KEY, String(ft));
    }

    // bounds must not fight the letterbox: clampX slides the allowed
    // scrollX range by (visW - width)/2 — x=0/width=worldW anchors the
    // rail's start flush to the screen's left edge at min scroll; the
    // y/height pair pins the vertically-centred stage.
    this.scrollLo = -this.offX; // viewLeft = 0 — rail starts at screen edge
    this.scrollHi = this.worldW - this.visW - this.offX;
    cam.setBounds(0, this.visT, this.worldW, visH);

    // ---- seasons chrome: header block + podium bean, both screen-fixed ----
    this.buildHeader(VW, VH);
    this.buildPodium(VW, VH);

    // ---- the rail: one baked strip per town — 10 tier cards + town label ----
    for (let r = 0; r < TOTAL_MILESTONES; r++) this.bakeStrip(r);

    // ---- frontier marker — walker + YOU above the live card; the gold rim
    //  already singles it out, a ring would ape the white progress line ----
    const frontierN = Math.min(this.prog.unlocked, TOTAL_LEVELS);
    const fWalker = this.add.sprite(0, -CARD_H / 2 - 26, 'player').setScale(0.8);
    const fYou = this.add
      .text(0, -CARD_H / 2 - 50, 'YOU', {
        fontFamily: DISPLAY_FONT,
        fontSize: '11px',
        color: '#1c2a3a',
        stroke: '#ffffff',
        strokeThickness: 4,
      })
      .setOrigin(0.5);
    this.frontier = this.add
      .container(this.cardX(frontierN - 1), this.railY, [fWalker, fYou])
      .setDepth(6);
    this.tweens.add({
      targets: fWalker,
      alpha: 0.55,
      duration: 420,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // ---- selection ring — a halo *behind* the cards (depth < strips); the
    //  baked strip canvas masks it, so it never crosses badges or faces ----
    this.selRing = this.add.graphics().setDepth(1.5);
    this.selRing
      .lineStyle(7, 0x0f7fb8, 0.4)
      .strokeRoundedRect(-CARD_W / 2 - 7, -CARD_H / 2 - 7, CARD_W + 14, CARD_H + 14, 17)
      .lineStyle(3, 0xffffff, 0.95)
      .strokeRoundedRect(-CARD_W / 2 - 5, -CARD_H / 2 - 5, CARD_W + 10, CARD_H + 10, 15);
    this.selectLevel(frontierN, false);

    // ---- the seasons top bar — dark strip, icon row with the map tab pink,
    // crown/star counters. scrollLock keeps it pinned while the rail moves.
    fgTopBar(
      this,
      VW,
      [
        { icon: 'back', onDown: () => this.gated(() => this.toTitle()) },
        { icon: 'edit', onDown: () => this.gated(() => this.renameRunner()) },
        {
          icon: 'play',
          active: true, // the pink active tab — you are on the journey screen
          onDown: () => this.gated(() => this.focusFrontier()),
        },
        { icon: 'board', onDown: () => this.gated(() => this.showBoard()) },
        { icon: 'online', onDown: () => this.gated(() => this.toLobby()) },
      ],
      { crown: loadStats().wins, star: totalStars(this.prog) },
      {
        label: 'MAP',
        scrollLock: true,
        // chrome children render at stage*zoom — the view edges in
        // stage coords are 0..visW (overscan covers the letterbox)
        xL: 0,
        xR: this.visW,
      },
    );

    // keep the board warm — name changes & best runs post once per session
    submitAdventureScore();

    // ---- scroll controls — horizontal: drag with momentum, wheel, keys ----
    this.input.on('wheel', (_p: unknown, _o: unknown, dx: number, dy: number) => {
      if (this.boardLayer || this.marching) return;
      this.velX = 0;
      cam.scrollX = Phaser.Math.Clamp(
        cam.scrollX + ((dy || dx) * 0.9) / this.zoomK,
        this.scrollLo,
        this.scrollHi,
      );
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.boardLayer || this.marching) return;
      this.dragX = p.x;
      this.camStartX = cam.scrollX;
      this.velX = 0;
      this.lastMoveX = p.x;
      this.lastMoveT = this.time.now;
      this.tapStart = { x: p.x, y: p.y };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.boardLayer || this.marching) return;
      if (this.dragX === null || !p.isDown) return;
      const dt = Math.max(1, this.time.now - this.lastMoveT);
      this.velX = (-(p.x - this.lastMoveX) / dt) * 1000 / this.zoomK; // world px/s
      this.lastMoveX = p.x;
      this.lastMoveT = this.time.now;
      cam.scrollX = Phaser.Math.Clamp(
        this.camStartX - (p.x - this.dragX) / this.zoomK,
        this.scrollLo,
        this.scrollHi,
      );
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      this.dragX = null;
      // a tap that didn't travel = a rail selection, not a scroll
      const t = this.tapStart;
      this.tapStart = null;
      if (!t || this.boardLayer || this.marching) return;
      if (Math.abs(p.x - t.x) > 10 || Math.abs(p.y - t.y) > 10) return;
      const wx = p.worldX; // worldX already folds in zoom + scroll
      const i = Math.round((wx - this.railX0) / CARD_GAP);
      if (
        i >= 0 &&
        i < TOTAL_LEVELS &&
        Math.abs(wx - this.cardX(i)) <= CARD_W / 2 + 8 &&
        Math.abs(p.worldY - this.railY) <= CARD_H / 2 + 14
      ) {
        this.selectLevel(i + 1, true);
      }
    });
    this.input.on('pointerdown', this.onOverlayTap, this);
    this.events.once('shutdown', () => this.input.off('pointerdown', this.onOverlayTap, this));
    this.input.keyboard!.on('keydown-ESC', () => {
      if (this.modalOpen) return;
      if (this.boardLayer) this.closeBoard();
      else this.toTitle();
    });
    this.input.keyboard!.on('keydown-ENTER', () => {
      if (this.boardLayer || this.marching || this.modalOpen) return;
      const n = this.selected + 1;
      if (n <= this.prog.unlocked) this.playLevel(n);
    });
    this.keys = this.input.keyboard!.addKeys(
      'LEFT,RIGHT,A,D',
    ) as Record<string, Phaser.Input.Keyboard.Key>;

    // `advance` = the level number just cleared (only honored at the true frontier)
    const advance =
      data?.advance !== undefined &&
      data.advance === this.prog.unlocked - 1 &&
      data.advance < TOTAL_LEVELS
        ? data.advance
        : null;

    // ---- the journey-in: slide along the rail from START to your frontier ----
    // after a clear we open right on the frontier instead — the march needs it.
    // anchor keeps the focused card right of the detail card even on narrow screens
    const anchorI = advance !== null ? advance : frontierN - 1;
    const focusX = this.visW * this.focusFrac();
    // targetX is the view's LEFT edge in world units — scrollX trails it
    // by offX under zoom
    const targetX =
      Phaser.Math.Clamp(this.cardX(anchorI) - focusX, 0, this.worldW - this.visW) - this.offX;
    cam.scrollX = REDUCED_MOTION || advance !== null ? targetX : this.scrollLo;
    if (!REDUCED_MOTION && advance === null && targetX + this.offX > 60) {
      this.tweens.add({
        targets: cam,
        scrollX: targetX,
        duration: Math.min(700 + (targetX + this.offX) * 0.16, 2600),
        ease: 'Cubic.easeInOut',
      });
    }

    // title-screen LEADERBOARD link lands here — open the board over the map
    if (data?.board) this.time.delayedCall(350, () => this.showBoard());

    // new ground was just opened — the new town gets a little ceremony
    if (this.revealIdx >= 0 && !data?.board) this.playReveal();

    // fresh off a win — walk YOU from the cleared card to the next stop,
    // then select it so the player clicks PLAY to enter
    if (advance !== null && !data?.board) {
      this.time.delayedCall(REDUCED_MOTION ? 150 : 550, () => this.playAdvance(advance));
    }

    this.collectChrome();
  }

  /** slide the frontier marker card `a` → `a+1` along the rail, panning the
   *  camera with it, then land the selection on the newly-unlocked card */
  private playAdvance(a: number) {
    this.marching = true;
    const toX = this.cardX(a); // a+1's card is the new frontier
    const cam = this.cameras.main;
    const camX =
      Phaser.Math.Clamp(toX - this.visW * this.focusFrac(), 0, this.worldW - this.visW) -
      this.offX;
    const done = () => {
      this.marching = false;
      sfx.pickup();
      this.selectLevel(Math.min(a + 1, TOTAL_LEVELS), false);
    };
    if (REDUCED_MOTION) {
      this.frontier.x = toX;
      cam.scrollX = camX;
      done();
      return;
    }
    this.frontier.x = this.cardX(a - 1); // stage on the card just cleared
    this.tweens.add({ targets: this.frontier, x: toX, duration: 650, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: cam, scrollX: camX, duration: 650, ease: 'Sine.easeInOut' });
    this.time.delayedCall(680, done);
  }

  /** the new town's name lands with a little ceremony — no fog on this map,
   *  locked content stays visible by design */
  private playReveal() {
    const r = this.revealIdx;
    const town = MILESTONE_TOWNS[r];
    this.time.delayedCall(500, () => sfx.pickup());
    const ban = this.add
      .text(this.visW / 2, this.visH * 0.28, `NEW GROUND — ${town.toUpperCase()}`, {
        fontFamily: DISPLAY_FONT,
        fontSize: '30px',
        color: '#e84393', // pink header + deep-pink shadow, like every card
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(50)
      .setAlpha(0)
      .setScale(0.8)
      .setShadow(0, 4, '#9c2160', 0, true, false);
    const sub = this.add
      .text(this.visW / 2, this.visH * 0.28 + 40, 'the road opens', {
        fontFamily: UI_FONT,
        fontSize: '15px',
        fontStyle: '600',
        color: '#ffffff',
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

  update(_t: number, delta: number) {
    const cam = this.cameras.main;
    const k = this.keys;
    // screen-feel scroll speed — world units stretch under the stage zoom
    const v = ((delta / 1000) * 620) / this.zoomK;
    if (k?.LEFT?.isDown || k?.A?.isDown)
      cam.scrollX = Phaser.Math.Clamp(cam.scrollX - v, this.scrollLo, this.scrollHi);
    if (k?.RIGHT?.isDown || k?.D?.isDown)
      cam.scrollX = Phaser.Math.Clamp(cam.scrollX + v, this.scrollLo, this.scrollHi);

    // fling momentum — decays like a real scroll
    if (this.dragX === null && Math.abs(this.velX) > 20) {
      cam.scrollX = Phaser.Math.Clamp(
        cam.scrollX + this.velX * (delta / 1000),
        this.scrollLo,
        this.scrollHi,
      );
      this.velX *= Math.pow(0.92, delta / 16.7); // frame-rate independent decay
    } else if (this.dragX === null) {
      this.velX = 0;
    }

    // live bean — same pipeline as the lobby: WebGL frame + fur composite
    // re-uploaded at the user's Bean FPS; full-rate churns ~120MB/s of canvas
    if (this.hero3d?.ok && this.hero3d.canvas && this.heroCtx && this.heroImg && this.time.now - this.heroLastT >= this.heroMs) {
      this.heroLastT = this.time.now;
      this.hero3d.update(this.time.now);
      this.heroCtx.clearRect(0, 0, 560, 700);
      this.heroCtx.drawImage(this.hero3d.canvas, 0, 0);
      const b = this.heroImg.getBounds();
      const p = this.input.activePointer;
      const px = ((p.x - b.x) / b.width) * 560,
        py = ((p.y - b.y) / b.height) * 700;
      const inside = px >= 0 && px < 560 && py >= 0 && py < 700;
      this.hero3d.setGaze(
        ((p.x - (b.x + b.width / 2)) / (b.width / 2)) * 0.85,
        ((p.y - (b.y + b.height / 2)) / (b.height / 2)) * 0.85,
      );
      this.hero3d.drawFur(this.heroCtx, inside ? px : -1, inside ? py : -1);
      (this.textures.get('adv_hero') as Phaser.Textures.CanvasTexture).refresh();
    }

    // late-built chrome (board modal, detail rebuild, reveal banner,
    // name prompt) joins the container — cheap sweep, never misses
    this.collectChrome();
  }

  /** bake one town's rail segment into a single canvas — the whole 500-card
   *  rail is 50 images, not 500 sprites. Locked tiers keep their content
   *  visible (badged with a padlock, never hidden), like the seasons rail. */
  private bakeStrip(r: number) {
    const top = this.railY - BADGE_H - CARD_H / 2;
    // re-entry: keys persist across scene restarts — drop the stale strip first
    if (this.textures.exists(`advstrip${r}`)) this.textures.remove(`advstrip${r}`);
    const tex = this.textures.createCanvas(`advstrip${r}`, STRIP_W, STRIP_H);
    const ctx = tex?.getContext();
    if (!tex || !ctx) return;

    const cardCy = BADGE_H + CARD_H / 2;
    const cardCx = (c: number) => CARD_PAD + CARD_W / 2 + c * CARD_GAP;
    const frontierN = Math.min(this.prog.unlocked, TOTAL_LEVELS);

    // ---- the timeline behind the cards — thin, rides just below center,
    //  white on claimed ground, dark ahead ----
    const lineY = cardCy + 8;
    const LINE_W = 12;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(23,21,31,0.85)';
    ctx.lineWidth = LINE_W;
    ctx.beginPath();
    ctx.moveTo(0, lineY);
    ctx.lineTo(STRIP_W, lineY);
    ctx.stroke();
    let claimX = -1;
    for (let c = 0; c < COLS; c++) {
      const n = r * COLS + c + 1;
      if (n > TOTAL_LEVELS) break;
      if (this.prog.stars[n] !== undefined) claimX = cardCx(c) + CARD_GAP * 0.6;
    }
    if (claimX > 0) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = LINE_W;
      ctx.beginPath();
      ctx.moveTo(0, lineY);
      ctx.lineTo(Math.min(claimX, STRIP_W), lineY);
      ctx.stroke();
    }

    const hex = (cx: number, cy: number, rad: number) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const px = cx + Math.cos(a) * rad;
        const py = cy + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };

    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const n = i + 1;
      if (n > TOTAL_LEVELS) break;
      const cx = cardCx(c);
      const left = cx - CARD_W / 2;
      const top0 = cardCy - CARD_H / 2;
      const done = this.prog.stars[n] !== undefined;
      const open = n <= this.prog.unlocked;
      const isFrontier = n === frontierN;
      const isMilestone = n % COLS === 0;

      // claimed cards shrink — the rail reads "done = past, next = ahead"
      if (done) {
        ctx.save();
        ctx.translate(cx, cardCy);
        ctx.scale(0.8, 0.8);
        ctx.translate(-cx, -cardCy);
      }
      // drop base — the thick solid "card on a coaster" shadow from the ref
      ctx.fillStyle = 'rgba(12,10,22,0.55)';
      ctx.beginPath();
      ctx.roundRect(left + 7, top0 + 10, CARD_W, CARD_H, 14);
      ctx.fill();
      // rim — fat white like theirs; the frontier card wears fat gold instead
      const rim = isFrontier ? '#ffc93c' : '#ffffff';
      const rimW = isFrontier ? 5 : 4;
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.roundRect(left - rimW, top0 - rimW, CARD_W + rimW * 2, CARD_H + rimW * 2, 18);
      ctx.fill();
      // face — uniform cyan like theirs; state lives in the content, not the card
      ctx.fillStyle = '#5cc9ea';
      ctx.beginPath();
      ctx.roundRect(left, top0, CARD_W, CARD_H, 14);
      ctx.fill();
      // gloss sheen across the top
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.roundRect(left + 5, top0 + 4, CARD_W - 10, 22, 9);
      ctx.fill();

      // hexagon tier badge overlapping the card's top edge — pink like theirs
      const bx = cx;
      const by = top0 - 1;
      ctx.fillStyle = '#9c2160'; // deep-pink under-edge
      hex(bx, by + 3, 22);
      ctx.fill();
      ctx.fillStyle = '#e84393';
      hex(bx, by, 22);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      hex(bx, by, 22);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 ${n >= 100 ? 15 : 19}px "Baloo 2", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n), bx, by + 1);

      // face content — big like their reward art: three star slots, earned
      // stars filled gold, the rest ghosted; boss tiers get the gold crown
      const s = this.prog.stars[n] ?? 0;
      const star5 = (sx: number, sy: number, sr: number) => {
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const a = -Math.PI / 2 + (k * Math.PI) / 5;
          const rr = k % 2 === 0 ? sr : sr * 0.45;
          const px = sx + Math.cos(a) * rr;
          const py = sy + Math.cos(a) * 0 + Math.sin(a) * rr;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      };
      for (let k = 0; k < 3; k++) {
        const sx = cx - 26 + k * 26;
        const sy = cardCy + 22;
        star5(sx, sy, 12);
        if (k < s) {
          ctx.fillStyle = '#f7bd14';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#c98a00';
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = open ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.45)';
          ctx.stroke();
        }
      }
      if (levelDef(n).boss) {
        // the gold crown — same glyph as their crown-reward card
        const kx = cx;
        const ky = cardCy - 16;
        ctx.fillStyle = '#ffc93c';
        ctx.beginPath();
        ctx.moveTo(kx - 14, ky + 8);
        ctx.lineTo(kx - 14, ky - 4);
        ctx.lineTo(kx - 7, ky + 2);
        ctx.lineTo(kx, ky - 7);
        ctx.lineTo(kx + 7, ky + 2);
        ctx.lineTo(kx + 14, ky - 4);
        ctx.lineTo(kx + 14, ky + 8);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(kx - 14, ky + 9, 28, 4);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#c98a00';
        ctx.stroke();
        ctx.fillStyle = 'rgba(10,8,18,0.55)';
        ctx.font = '800 9px "Baloo 2", sans-serif';
        ctx.fillText('BOSS', kx, ky + 22);
      }

      // padlock — big white lock straddling the top-right rim, like theirs
      if (!open) {
        const lx = left + CARD_W - 14;
        const ly = top0 + 4;
        ctx.fillStyle = 'rgba(10,8,18,0.35)'; // soft offset shadow under the lock
        ctx.beginPath();
        ctx.roundRect(lx - 8, ly + 7, 19, 15, 4);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(lx + 1, ly + 6, 7, Math.PI, 0);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(lx - 9, ly + 6, 19, 15, 4);
        ctx.fill();
        ctx.fillStyle = '#0f7fb8'; // keyhole
        ctx.beginPath();
        ctx.arc(lx, ly + 13, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // the strip's milestone card carries the town nameplate underneath
      if (isMilestone) {
        const label = MILESTONE_TOWNS[r].toUpperCase();
        ctx.font = '800 13px "Baloo 2", sans-serif';
        const tw = ctx.measureText(label).width + 24;
        const ty = cardCy + CARD_H / 2 + 8;
        ctx.fillStyle = 'rgba(10,8,18,0.35)';
        ctx.beginPath();
        ctx.roundRect(cx - tw / 2 + 2, ty + 2, tw, 22, 11);
        ctx.fill();
        ctx.fillStyle = '#fdf8ec';
        ctx.beginPath();
        ctx.roundRect(cx - tw / 2, ty, tw, 22, 11);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = open ? '#0f7fb8' : '#8a97a5';
        ctx.beginPath();
        ctx.roundRect(cx - tw / 2 + 1, ty + 1, tw - 2, 20, 10);
        ctx.stroke();
        ctx.fillStyle = open ? '#1c2a3a' : '#5a6978';
        ctx.fillText(label, cx, ty + 12);
      }
      if (done) ctx.restore();
    }
    tex.refresh();
    this.stripImgs[r] = this.add
      .image(this.stripX(r), top, `advstrip${r}`)
      .setOrigin(0, 0)
      .setDepth(2);
  }

  // ---------- global leaderboard overlay ----------

  private showBoard() {
    if (this.boardLayer) return;
    const width = this.visW,
      height = this.visH;
    const layer = this.add.container(0, 0).setScrollFactor(0).setDepth(60);
    this.boardLayer = layer;

    // the seasons underlay — cyan crown field + rings, then a light veil
    const bg = fgCrownField(this, width, height, width / 2, height * 0.45, FG.cyan, 0x1fa9e8, 0x0f7fb8);
    const dim = this.add
      .rectangle(width / 2, height / 2, width + 60, height + 60, 0x081420, 0.22)
      .setInteractive(); // swallow taps — sized to the letterboxed view

    // ---- the standings board, styled on their 43-QUALIFIED screen: a cyan
    // scoreboard prop on yellow posts, a lime count-banner over its top edge,
    // and a 4×8 tile grid — green for ranked runners, pink for open slots ----
    const pw = Math.min(880, width - 48);
    const ph = Math.min(548, height - 84);
    const px = (width - pw) / 2;
    const py = (height - ph) / 2 + 20;

    // suspending posts + rope lattice under the board (carnival-sign garnish)
    const posts = this.add.graphics();
    const postY = py + ph;
    for (const fx of [px + pw * 0.12, px + pw * 0.88]) {
      posts.fillStyle(0x8a5a1e, 1).fillRect(fx - 9, postY + 8, 18, height - postY);
      posts.fillStyle(0xe8b23a, 1).fillRect(fx - 9, postY, 18, height - postY);
    }
    posts.lineStyle(3, 0xf7d774, 0.55);
    for (let i = 0; i <= 10; i++) {
      const nx = px + pw * 0.08 + (pw * 0.84 * i) / 10;
      posts.lineBetween(nx, postY + 4, nx + 26, postY + 56);
      posts.lineBetween(nx + 26, postY + 4, nx, postY + 56);
    }
    posts.lineStyle(4, 0xe8b23a, 0.9).lineBetween(px + pw * 0.06, postY + 6, px + pw * 0.94, postY + 6);

    // the board face — cyan slab, deeper rim, white hairline, dark under-shadow
    const board = this.add.graphics();
    board.fillStyle(0x0a0710, 0.4).fillRoundedRect(px + 6, py + 8, pw, ph, 22);
    board.fillStyle(FG.cyanDeep, 1).fillRoundedRect(px - 3, py - 3, pw + 6, ph + 6, 24);
    board.fillStyle(FG.cyan, 1).fillRoundedRect(px, py, pw, ph, 20);
    board.lineStyle(3, 0xffffff, 0.55).strokeRoundedRect(px + 8, py + 8, pw - 16, ph - 16, 14);

    // lime count-banner overlapping the board's top edge — "NN ON THE BOARD!"
    const bw = 400,
      bh = 58,
      bx = width / 2 - bw / 2,
      by = py - 24;
    const banG = this.add.graphics();
    banG.fillStyle(0x2e7d1f, 1).fillRoundedRect(bx + 3, by + 5, bw, bh, 14);
    banG.fillStyle(0x5fd62a, 1).fillRoundedRect(bx, by, bw, bh, 14);
    banG.lineStyle(3, 0xffffff, 0.85).strokeRoundedRect(bx + 2, by + 2, bw - 4, bh - 4, 12);
    this.boardBanner = this.add
      .text(width / 2, by + bh / 2 - 2, 'TOP RUNNERS', {
        fontFamily: FG_FONT,
        fontSize: '30px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setShadow(0, 3, '#2e7d1f', 0, true, false);

    // ---- 4×8 tile grid — green = a ranked runner, pink = open slot ----
    const COLS_N = 8,
      ROWS_N = 4; // top 32 only
    const gx = px + 26,
      gy = py + 54;
    const gw = pw - 52,
      gh = ph - 54 - 86; // footer keeps ~86px
    const cw = gw / COLS_N,
      ch = gh / ROWS_N;
    const tw = Math.min(cw - 8, 96),
      th = Math.min(ch - 8, 78);
    this.boardTiles = [];
    for (let i = 0; i < COLS_N * ROWS_N; i++) {
      const tx = gx + (i % COLS_N) * cw + (cw - tw) / 2;
      const ty = gy + Math.floor(i / COLS_N) * ch + (ch - th) / 2;
      const face = this.add.graphics(); // repainted per state
      const paint = (fill: number, deep: number) => {
        face.clear();
        face.fillStyle(deep, 1).fillRoundedRect(tx, ty + 3, tw, th, 8);
        face.fillStyle(fill, 1).fillRoundedRect(tx, ty, tw, th - 2, 8);
      };
      paint(FG.pink, FG.pinkDeep); // open slot until a runner lands
      const rank = this.add
        .text(tx + 7, ty + 6, '', { fontFamily: UI_FONT, fontSize: '10px', fontStyle: '800', color: '#0b4f10' })
        .setOrigin(0, 0);
      const name = this.add
        .text(tx + tw / 2, ty + th / 2 - 6, '', {
          fontFamily: FG_FONT,
          fontSize: '13px',
          color: '#ffffff',
        })
        .setOrigin(0.5)
        .setShadow(0, 2, '#0b4f10', 0, true, false);
      const stat = this.add
        .text(tx + tw / 2, ty + th - 16, '', {
          fontFamily: UI_FONT,
          fontSize: '10px',
          fontStyle: '700',
          color: '#d8ffd0',
        })
        .setOrigin(0.5);
      const c = this.add.container(0, 0, [face, rank, name, stat]);
      this.boardTiles.push({ c, face, rank, name, stat });
      // stash per-tile paint coords for renderBoard
      c.setData('px', tx).setData('py', ty).setData('pw', tw).setData('ph', th);
    }
    const me = this.boardMeTxt = this.add
      .text(width / 2, py + ph - 62, '', {
        fontFamily: UI_FONT,
        fontSize: '14px',
        fontStyle: '700',
        color: '#083048',
      })
      .setOrigin(0.5);
    const hint = this.add
      .text(width / 2, py + ph - 38, 'win levels to climb · deeper north = higher rank', {
        fontFamily: UI_FONT,
        fontSize: '11px',
        fontStyle: '600',
        color: '#085070',
      })
      .setOrigin(0.5);
    // close affordance — dark rimmed dot, same as every modal's
    const cdG = this.add.graphics();
    cdG.fillStyle(UI.shade, 0.5).fillCircle(px + pw - 27, py + 27, 15);
    cdG.fillStyle(UI.ink, 1).fillCircle(px + pw - 28, py + 26, 14);
    cdG.lineStyle(2, 0xffffff, 0.85).strokeCircle(px + pw - 28, py + 26, 13);
    const close = this.add
      .text(px + pw - 28, py + 25, '✕', {
        fontFamily: DISPLAY_FONT,
        fontSize: '13px',
        color: '#f5efe0',
      })
      .setOrigin(0.5)
      .setPadding(8)
      .setInteractive({ useHandCursor: true });
    close.on('pointerover', () => close.setColor('#ffc93c')).on('pointerout', () => close.setColor('#f5efe0'));

    // name row — tap SET to name your runner (shares the online lobby name)
    const nameLbl = this.add
      .text(px + 34, py + ph - 62, `NAME: ${playerName() || '—'}`, {
        fontFamily: UI_FONT,
        fontSize: '12px',
        fontStyle: '700',
        color: '#085070',
      })
      .setOrigin(0, 0.5);
    const doSet = () => {
      this.modalOpen = true;
      void promptModal(this, {
        title: 'NAME YOUR RUNNER',
        sub: 'shows on the board',
        label: 'RUNNER NAME',
        placeholder: 'your name',
        value: playerName(),
        maxLen: 14,
        okLabel: 'SAVE',
        depth: 80,
        field: { base: FG.cyan, ring: 0x1fa9e8, crown: 0x0f7fb8 },
      }).then((n) => {
        this.modalOpen = false;
        if (n === null) return;
        setPlayerName(n);
        pushProfile();
        nameLbl.setText(`NAME: ${playerName() || '—'}`);
        submitAdventureScore(true);
        this.time.delayedCall(700, () => this.renderBoard()); // let the post land
      });
    };
    // SET — small cyan candy pill like the lobby's join action
    const sbw = 64, sbh = 34, scx = px + pw - 46, scy = py + ph - 62;
    const sg = this.add.graphics();
    sg.fillStyle(0x0b6a99, 1).fillRoundedRect(scx - sbw / 2, scy - sbh / 2 + 2, sbw, sbh, sbh / 2);
    sg.fillStyle(0xffffff, 1).fillRoundedRect(scx - sbw / 2, scy - sbh / 2 - 3, sbw, sbh - 2, sbh / 2);
    sg.fillStyle(FG.cyan, 1).fillRoundedRect(scx - sbw / 2 + 3, scy - sbh / 2, sbw - 6, sbh - 6, sbh / 2 - 2);
    const setBtn = this.add
      .text(scx, scy - 2, 'SET', {
        fontFamily: DISPLAY_FONT,
        fontSize: '14px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setShadow(0, 2, '#0b6a99', 0, true, false)
      .setPadding(10, 8, 10, 8)
      .setInteractive({ useHandCursor: true });
    // screen-space tap rects — board sits in an sf0 container, children miss input
    this.boardHit = [
      { x: px + pw - 58, y: py + 4, w: 56, h: 44, fn: () => this.closeBoard() },
      { x: scx - 36, y: scy - 22, w: 72, h: 44, fn: doSet },
    ];

    layer.add([bg, dim, posts, board, banG, this.boardBanner, ...this.boardTiles.map((t) => t.c), me, hint, cdG, close, nameLbl, sg, setBtn]);

    this.renderBoard();
  }

  private async renderBoard() {
    try {
      const b = await fetchBoard();
      if (!this.boardLayer || !this.boardTiles.length) return; // closed mid-flight
      const top = b.top.slice(0, 32);
      const myRank = b.me?.rank ?? 0;
      this.boardBanner?.setText(top.length ? `${top.length} ON THE BOARD!` : 'BE THE FIRST!');
      for (let i = 0; i < this.boardTiles.length; i++) {
        const t = this.boardTiles[i];
        const e = top[i];
        const tx = t.c.getData('px') as number,
          ty = t.c.getData('py') as number,
          tw = t.c.getData('pw') as number,
          th = t.c.getData('ph') as number;
        t.face.clear();
        if (!e) {
          // open slot stays flat pink — the reference's empty squares
          t.face.fillStyle(FG.pinkDeep, 1).fillRoundedRect(tx, ty + 3, tw, th, 8);
          t.face.fillStyle(FG.pink, 1).fillRoundedRect(tx, ty, tw, th - 2, 8);
          t.rank.setText('');
          t.name.setText('');
          t.stat.setText('');
          continue;
        }
        const mine = e.rank === myRank;
        // green = ranked; your own tile goes blue + white rim, like their
        // local-player highlight
        const fill = mine ? 0x2f7fd0 : 0x43d43c;
        const deep = mine ? 0x18508e : 0x2fa01f;
        t.face.fillStyle(deep, 1).fillRoundedRect(tx, ty + 3, tw, th, 8);
        t.face.fillStyle(fill, 1).fillRoundedRect(tx, ty, tw, th - 2, 8);
        if (mine) t.face.lineStyle(3, 0xffffff, 0.95).strokeRoundedRect(tx + 1.5, ty + 1.5, tw - 3, th - 5, 7);
        t.rank.setText(`#${e.rank}`).setColor(mine ? '#ffffff' : '#0b4f10');
        t.name.setText(e.name.slice(0, 10));
        t.stat.setText(`L${e.level} · ★${e.stars}`).setColor(mine ? '#ffffff' : '#d8ffd0');
        // cascade pop — qualified tiles land one after another
        if (!REDUCED_MOTION) {
          t.c.setScale(0.6).setAlpha(0);
          this.tweens.add({
            targets: t.c,
            scale: 1,
            alpha: 1,
            duration: 160,
            delay: 24 * i,
            ease: 'Back.easeOut',
          });
        }
      }
      this.boardMeLine(top, b.me);
    } catch {
      if (!this.boardLayer) return;
      this.boardBanner?.setText('BOARD OFFLINE');
      for (const t of this.boardTiles) {
        const tx = t.c.getData('px') as number,
          ty = t.c.getData('py') as number,
          tw = t.c.getData('pw') as number,
          th = t.c.getData('ph') as number;
        t.face.clear();
        t.face.fillStyle(FG.pinkDeep, 1).fillRoundedRect(tx, ty + 3, tw, th, 8);
        t.face.fillStyle(FG.pink, 1).fillRoundedRect(tx, ty, tw, th - 2, 8);
      }
      this.boardMeLine([], null, 'the board is offline right now — it lives on our game server');
    }
  }

  /** the "you" line — below the grid, always visible even unranked */
  private boardMeLine(top: { rank: number }[], me: { rank: number; level: number; stars: number } | null, err?: string) {
    const el = this.boardMeTxt;
    if (!el) return;
    el.setText(
      err ??
        (me
          ? me.rank <= 32
            ? `you're on the board — #${me.rank} · L${me.level} · ★${me.stars}`
            : `you: #${me.rank} — just outside the top 32 · L${me.level} · ★${me.stars}`
          : top.length
            ? 'you: unranked — clear a level to join the board'
            : 'no runners yet — be the first to post a level!'),
    );
  }

  private closeBoard() {
    this.boardLayer?.destroy();
    this.boardLayer = null;
    this.boardTiles = [];
    this.boardBanner = undefined;
    this.boardMeTxt = undefined;
    this.boardHit = [];
  }

  /** any root object marked scrollFactor(0) is screen-fixed chrome — move
   *  it into `chrome` (offset by offX/offY) so the centre-zoom shift cancels
   *  and plain stage coords land at stage*zoom. Descendants keep sf0 too,
   *  otherwise their scrollFactor would subtract camera scroll inside the
   *  container and fixed UI would drift with the rail. */
  private collectChrome() {
    type SF = Phaser.GameObjects.Components.ScrollFactor;
    const sf = (o: Phaser.GameObjects.GameObject) => o as unknown as SF;
    const mark = (o: Phaser.GameObjects.GameObject) => {
      if (o.type === 'DOMElement') return;
      sf(o).setScrollFactor(0, 0);
      if (o instanceof Phaser.GameObjects.Container)
        o.each((c: Phaser.GameObjects.GameObject) => mark(c));
    };
    for (const o of [...this.children.list]) {
      if (
        o === this.chrome ||
        o.parentContainer !== null ||
        sf(o).scrollFactorX !== 0 ||
        o.type === 'DOMElement' ||
        o.getData?.('screenFixed')
      )
        continue;
      this.chrome.add(o);
      mark(o);
    }
  }

  /** manual overlay hit test — board zones win over card zones */
  private onOverlayTap(p: Phaser.Input.Pointer) {
    if (this.marching || this.modalOpen) return;
    // hit rects live in stage coords — worldX folds in zoom + scroll, and
    // scrollFactor(0) chrome ignores scroll, so un-scroll the pointer.
    // offX/offY are the centre-zoom offsets: viewLeft = scroll + off
    const hx = p.worldX - this.cameras.main.scrollX - this.offX;
    const hy = p.worldY - this.cameras.main.scrollY - this.offY;
    for (const z of [...this.boardHit, ...this.cardHit]) {
      if (hx >= z.x && hx <= z.x + z.w && hy >= z.y && hy <= z.y + z.h) {
        z.fn();
        return;
      }
    }
  }

  /** left column width — header + detail card share it, ~half the view */
  private colW(): number {
    return Math.min(500, this.visW * 0.48);
  }

  /** camera anchor keeps the focused card clear of the left column */
  private focusFrac(): number {
    return Math.min(0.72, Math.max(0.42, (34 + this.colW() + 60) / this.visW));
  }

  /** seasons header — wordmark stack + hex level badge + angled progress bar
   *  + the earn-stars line, all screen-fixed over the cyan field */
  private buildHeader(width: number, _height: number) {
    const lvl = Math.min(this.prog.unlocked, TOTAL_LEVELS);
    const colW = this.colW();
    this.add
      .text(34, 60, `ICE 'N' WATER`, {
        fontFamily: DISPLAY_FONT,
        fontSize: '40px',
        color: '#ffffff',
      })
      .setScrollFactor(0)
      .setDepth(41)
      .setShadow(0, 4, '#0f7fb8', 0, true, false);
    this.add
      .text(34, 110, 'SEASON 1 — THE ROAD NORTH', {
        fontFamily: DISPLAY_FONT,
        fontSize: '24px',
        fontStyle: 'italic',
        color: '#e84393',
      })
      .setScrollFactor(0)
      .setDepth(41)
      .setShadow(0, 3, '#9c2160', 0, true, false);
    this.add
      .text(34, 144, `ends at ${MILESTONE_TOWNS[TOTAL_MILESTONES - 1]} — ${TOTAL_LEVELS} stops`, {
        fontFamily: UI_FONT,
        fontSize: '18px',
        fontStyle: 'italic 700',
        color: 'rgba(255,255,255,0.9)',
      })
      .setScrollFactor(0)
      .setDepth(41);

    // bar first, then the hex badge — it sits ON the left cap, not under it
    fgProgressBar(
      this,
      78,
      196,
      colW - 44,
      28,
      (lvl - 1) / (TOTAL_LEVELS - 1),
      `${lvl - 1}/${TOTAL_LEVELS}`,
    ).forEach((o) => o.setScrollFactor(0).setDepth(41));
    fgHexBadge(this, 78, 210, 30, `${lvl}`).forEach((o) => o.setScrollFactor(0).setDepth(41));

    // earn-stars line — their "Earn FAME by competing in Shows!"
    const star = this.add.graphics().setScrollFactor(0).setDepth(41);
    star.fillStyle(FG.pink, 1);
    star.fillCircle(42, 246, 12);
    star.lineStyle(2.5, 0xffffff, 0.85).strokeCircle(42, 246, 12);
    this.add
      .text(42, 246, '★', { fontFamily: UI_FONT, fontSize: '15px', color: '#ffffff' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(42);
    this.add
      .text(60, 236, `earn STARS — crown the north  ·  ★ ${totalStars(this.prog)}`, {
        fontFamily: UI_FONT,
        fontSize: '17px',
        fontStyle: 'italic 700',
        color: '#ffffff',
      })
      .setScrollFactor(0)
      .setDepth(41);
  }

  /** magenta podium + a one-shot bean render — static texture, zero per-frame
   *  three.js cost on this screen (the title lobby keeps the live one) */
  private buildPodium(width: number, height: number) {
    const podX = width * 0.66; // stage is always 1280 wide now
    const podTopY = height * 0.66;
    // the podium lives BEHIND the rail — root-level sf0 at depth 1 (rail
    // strips are depth 2), positioned at stage+off so the centre-zoom
    // shift cancels and stage coords still land at stage*zoom
    const ox = this.offX,
      oy = this.offY;
    const pod = this.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(1)
      .setData('screenFixed', 1);
    pod.fillStyle(FG.podiumSide, 1).fillRect(ox + podX - 170, oy + podTopY, 340, height - podTopY + 80);
    pod.fillStyle(FG.podiumTop, 1).fillEllipse(ox + podX, oy + podTopY, 340, 54);
    pod.fillStyle(0xffffff, 0.34).fillEllipse(ox + podX, oy + podTopY - 4, 288, 34);
    pod.lineStyle(4, FG.pinkDeep, 0.5).strokeEllipse(ox + podX, oy + podTopY, 340, 54);
    pod.fillStyle(FG.pinkDeep, 0.32).fillEllipse(ox + podX, oy + podTopY + 10, 124, 17);

    // bigger buffer + deeper camera than the lobby — the pratfall launches
    // ~0.65 world-units and flips around the body centre, so the frame
    // needs real headroom (visible world top 3.29) and flap room (±1.59)
    const pc = currentChar();
    const hero = (this.hero3d = new Hero3D(560, 700, 6.5, 1.3, 1.3, pc));
    hero.furQ = furQuality(); // the Bean FPS pick carries the coat
    if (hero.ok && hero.canvas) {
      hero.trickOn = true; // the map bean does the pratfall routine
      hero.setVariant(pc.body, pc.skin); // the statue wears your picked coat
      const copy = (this.heroCv = document.createElement('canvas'));
      copy.width = 560;
      copy.height = 700;
      this.heroCtx = copy.getContext('2d')!;
      if (this.textures.exists('adv_hero')) this.textures.remove('adv_hero');
      this.textures.addCanvas('adv_hero', copy);
      // feet sit ~20% up the taller buffer, not ~11% — lift compensates so
      // they stay planted on the podium top (lands the bean at podTop-155)
      this.heroImg = this.add
        .image(ox + podX, oy + podTopY + 34 - 350 * 0.7 + 56, 'adv_hero')
        .setOrigin(0.5)
        .setScale(0.7) // feet planted on the podium, head clear of the top bar
        .setScrollFactor(0)
        .setDepth(1)
        .setData('screenFixed', 1)
        .setInteractive();
      this.heroImg.on('pointerdown', () => hero.poke());
      this.events.once('shutdown', () => {
        this.hero3d?.dispose();
        this.hero3d = undefined;
        if (this.textures.exists('adv_hero')) this.textures.remove('adv_hero');
      });
    }
  }

  /** move the rail cursor + rebuild the detail card for level `n` */
  private selectLevel(n: number, tap: boolean) {
    this.selected = n - 1;
    this.selRing?.setPosition(this.cardX(n - 1), this.railY);
    if (tap) sfx.pickup();
    this.buildDetail();
  }

  /** the reward-detail card — cyan face, white rim, drop base: level name,
   *  town, status chip, stats and the PLAY pill, wired to the selection */
  private buildDetail() {
    this.detailLayer?.destroy();
    const height = VH; // stage coords — the card is screen-fixed
    const n = this.selected + 1;
    const def = levelDef(n);
    const stars = this.prog.stars[n] ?? 0;
    const open = n <= this.prog.unlocked;
    const done = this.prog.stars[n] !== undefined;
    const isFrontier = n === Math.min(this.prog.unlocked, TOTAL_LEVELS);

    const W = this.colW();
    const H = 148;
    const x = 34;
    // sits under the header, clear of the rail — the frontier anchors right of it
    const y = Phaser.Math.Clamp(height * 0.44, 262, 280);

    const g = this.add.graphics();
    g.fillStyle(0x081420, 0.3).fillRoundedRect(x + 5, y + 7, W, H, 16); // drop base
    g.fillStyle(0xffffff, 1).fillRoundedRect(x - 4, y - 4, W + 8, H + 8, 19); // white rim
    g.fillStyle(0x4dd0e1, 1).fillRoundedRect(x, y, W, H, 15); // cyan face like theirs
    g.fillStyle(0xffffff, 0.25).fillRoundedRect(x + 10, y + 6, W - 20, 34, 12); // sheen

    // status chip — CLEARED / NEXT UP / LOCKED
    const chipT = done ? `CLEARED ${'★'.repeat(stars)}` : isFrontier ? 'NEXT UP' : open ? 'UNLOCKED' : 'LOCKED';
    const chipFill = done ? 0xffc93c : open ? 0x0f7fb8 : 0x3a4656;
    const cw = Math.max(96, chipT.length * 10 + 28);
    const cg = this.add.graphics();
    cg.fillStyle(0x081420, 0.35).fillRoundedRect(x + W - cw - 16, y + 18 + 2, cw, 30, 15);
    cg.fillStyle(chipFill, 1).fillRoundedRect(x + W - cw - 16, y + 18, cw, 30, 15);
    cg.lineStyle(2, 0xffffff, 0.6).strokeRoundedRect(x + W - cw - 15, y + 19, cw - 2, 28, 14);

    const kids: Phaser.GameObjects.GameObject[] = [
      g,
      cg,
      this.add
        .text(x + 20, y + 16, `LEVEL ${n}`, {
          fontFamily: DISPLAY_FONT,
          fontSize: '30px',
          color: '#ffffff',
        })
        .setShadow(0, 4, '#0f7fb8', 0, true, false),
      this.add.text(x + 20, y + 56, `${def.name} — ${def.town || def.chapter}`, {
        fontFamily: UI_FONT,
        fontSize: '17px',
        fontStyle: 'italic 700',
        color: 'rgba(255,255,255,0.92)',
      }),
      this.add.text(x + 20, y + 86, `◆ ${objectiveText(def)}${def.boss ? '  ·  BOSS FIGHT' : ''}`, {
        fontFamily: UI_FONT,
        fontSize: '16px',
        fontStyle: '700',
        color: '#0f7fb8',
      }),
      this.add.text(x + 20, y + 114, `${def.chasers} militia · ${def.seconds}s · crew of ${def.crew}`, {
        fontFamily: UI_FONT,
        fontSize: '15px',
        fontStyle: '700',
        color: 'rgba(255,255,255,0.75)',
      }),
      this.add
        .text(x + W - cw - 16 + cw / 2, y + 33, chipT, {
          fontFamily: DISPLAY_FONT,
          fontSize: '14px',
          color: done ? '#1c1626' : '#ffffff',
        })
        .setOrigin(0.5),
    ];

    // PLAY pill — right column under the status chip; danfo when playable,
    // dead-gray when locked
    const pbw = 148;
    const pbh = 50;
    const pbx = x + W - pbw - 16;
    const pby = y + 62;
    const pg = this.add.graphics();
    const pfill = open ? 0xffc93c : 0x8a97a5;
    pg.fillStyle(shade(pfill, -48), 1).fillRoundedRect(pbx, pby + 4, pbw, pbh, pbh / 2);
    pg.fillStyle(pfill, 1).fillRoundedRect(pbx, pby - 4, pbw, pbh - 3, pbh / 2);
    pg.fillStyle(0xffffff, 0.22).fillRoundedRect(pbx + 8, pby + 1, pbw - 16, 15, 7);
    kids.push(
      pg,
      this.add
        .text(pbx + pbw / 2, pby + pbh / 2 - 4, open ? 'PLAY ▶' : 'LOCKED', {
          fontFamily: DISPLAY_FONT,
          fontSize: '19px',
          color: open ? '#1c1626' : '#e8eef4',
        })
        .setOrigin(0.5)
        .setShadow(0, 3, open ? '#c98a00' : '#3a4656', 0, true, false),
    );

    this.cardHit = open
      ? [{ x: pbx, y: pby - 4, w: pbw, h: pbh + 8, fn: () => this.playLevel(n) }]
      : [];

    this.detailLayer = this.add.container(0, 0, kids).setScrollFactor(0).setDepth(46);
  }

  private playLevel(n: number) {
    sfx.ensure();
    sfx.shortWhistle();
    wipeTo(this, 'drop', {
      game: {
        adventure: levelDef(Math.min(n, TOTAL_LEVELS)),
        difficulty: loadPicks().difficulty,
      },
    });
  }

  /** top-bar icons share one guard — no actions while a modal owns input or
   *  the frontier marker is mid-march */
  private gated(fn: () => void) {
    if (this.modalOpen || this.boardLayer || this.marching) return;
    fn();
  }

  /** the pink active tab — jump the rail back to the frontier card */
  private focusFrontier() {
    const frontierN = Math.min(this.prog.unlocked, TOTAL_LEVELS);
    const cam = this.cameras.main;
    const focusX = this.visW * this.focusFrac();
    const targetX =
      Phaser.Math.Clamp(this.cardX(frontierN - 1) - focusX, 0, this.worldW - this.visW) -
      this.offX;
    this.tweens.add({ targets: cam, scrollX: targetX, duration: REDUCED_MOTION ? 0 : 500, ease: 'Cubic.easeOut' });
    this.selectLevel(frontierN, false);
  }

  /** pencil tab — name your runner without opening the board first */
  private renameRunner() {
    this.modalOpen = true;
    void promptModal(this, {
      title: 'NAME YOUR RUNNER',
      sub: 'shows on the board',
      label: 'RUNNER NAME',
      placeholder: 'your name',
      value: playerName(),
      maxLen: 10,
      okLabel: 'SAVE',
      depth: 80,
      field: { base: FG.cyan, ring: 0x1fa9e8, crown: 0x0f7fb8 },
    }).then((n) => {
      this.modalOpen = false;
      if (n === null) return;
      setPlayerName(n);
      pushProfile();
      submitAdventureScore(true);
    });
  }

  private toLobby() {
    wipeTo(this, 'lobby');
  }

  private toTitle() {
    wipeTo(this, 'title');
  }
}
