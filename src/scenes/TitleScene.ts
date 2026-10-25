import Phaser from 'phaser';
import { makeTextures } from '../art';
import { Sfx } from '../audio';
import { REDUCED_MOTION, bakeLogoLetter, shade, panel, UI } from '../ui';
import { IceFxPipeline, WaterFxPipeline } from '../logofx';
import { loadStats, loadPicks, savePicks, DIFFS, Difficulty, JoyMode } from '../meta';
import { adventureProgress, totalStars, TOTAL_LEVELS } from '../adventure';
import { playerName, setPlayerName } from '../leaderboard';
import { TouchControls } from '../mobile';
import {
  FG,
  FG_FONT,
  FG_BODY,
  fgRings,
  bakeCrownTile,
  fgTopBar,
  fgButton,
  fgHexBadge,
  fgProgressBar,
  fgNamePlate,
  fgKeycapHint,
  promptModal,
} from '../fgui';
import { Hero3D } from '../hero3d';

const sfx = Sfx.inst;

const DIFF_ORDER: Difficulty[] = ['easy', 'normal', 'hard'];
const JOY_ORDER: JoyMode[] = ['floating', 'sticky'];
const JOY_LABEL: Record<JoyMode, string> = { floating: 'FLOATING', sticky: 'STICKY' };
// logo letters tilt alternately like the FALL GUYS lockup
const TILTS = [-0.07, 0.04, -0.03, 0.06, -0.05, 0.03, -0.06, 0.05, -0.02, 0.04, -0.03];

export class TitleScene extends Phaser.Scene {
  private diff: Difficulty = 'normal';
  private joy: JoyMode = 'floating';
  private diffVal?: Phaser.GameObjects.Text; // chevron selector readouts in settings
  private joyVal?: Phaser.GameObjects.Text;
  private soundVal?: Phaser.GameObjects.Text;
  private iceDecos: { img: Phaser.GameObjects.Image; born: number }[] = [];
  private hero3d?: Hero3D;
  private heroImg?: Phaser.GameObjects.Image;
  private heroGaze?: { x: number; y: number };
  private heroGazeP = { x: 0, y: 0 };
  private heroDragX?: number;
  private heroTex?: Phaser.Textures.CanvasTexture;
  private heroSrc?: HTMLCanvasElement; // three's webgl canvas — blitted into heroTex
  private heroCtx?: CanvasRenderingContext2D;
  private started = false;
  private splash?: Phaser.GameObjects.Container;
  private settingsCard?: Phaser.GameObjects.Container;
  private settingsOpen = false;
  private topBar?: ReturnType<typeof fgTopBar>;
  private promptOpen = false;
  private cardZones: Phaser.GameObjects.Zone[] = [];
  private lobbyArm?: (t0: number) => void;
  private lobbyDrop?: (delayBase: number) => void;

  constructor() {
    super('title');
  }

  // letters land with a staggered drop — used by both the splash emblem and
  // the lobby lockup. Returns controls: place() sets the row's x origin,
  // arm() starts the material timelines, drop() runs the landing animation.
  private buildLetters(
    parts: { text: string; fx: 'ice' | 'water' | 'plain'; size: number }[],
    cy: number,
    extrude: Record<'ice' | 'water' | 'plain', string>,
    base: number,
    depth: number,
    parent?: Phaser.GameObjects.Container,
  ): {
    width: number;
    place: (x0: number) => void;
    arm: (t0: number) => void;
    drop: (delayBase: number) => void;
  } {
    const webgl = this.game.renderer.type === Phaser.WEBGL;
    const imgs: Phaser.GameObjects.Image[] = [];
    const arms: ((t0: number) => void)[] = [];
    let cursor = 0;
    for (const part of parts) {
      for (const ch of part.text) {
        const baked = bakeLogoLetter(this, ch, part.size, part.fx, extrude[part.fx]);
        const idx = imgs.length;
        const t = this.add
          .image(0, cy, baked.key)
          .setOrigin(0.5)
          .setDepth(depth)
          .setData('fx', part.fx);
        parent?.add(t);
        const landAt = base + 520 + idx * 50;
        t.setData('born', landAt);
        if (webgl && part.fx === 'water') {
          t.setPostPipeline(WaterFxPipeline);
          const p = t.getPostPipeline(WaterFxPipeline) as WaterFxPipeline;
          arms.push((t0) => (p.born = t0 + 520 + idx * 50));
        }
        if (webgl && part.fx === 'ice') {
          t.setPostPipeline(IceFxPipeline);
          const p = t.getPostPipeline(IceFxPipeline) as IceFxPipeline;
          p.seed = ch.charCodeAt(0) * 0.37;
          arms.push((t0) => (p.born = t0 + 520 + idx * 50));
        }
        imgs.push(t);
        cursor += (t.width - 20) * 0.84;
        if (baked.decoKey) t.setData('deco', baked.decoKey);
      }
      cursor += part.size * 0.42;
    }
    let x = 0;
    imgs.forEach((t, i) => {
      x += (t.width - 20) * 0.42;
      t.setPosition(x, cy).setAlpha(0).setAngle(TILTS[i % TILTS.length]).setData('rx', x);
      const decoKey = t.getData('deco') as string | undefined;
      if (decoKey) {
        const deco = this.add
          .image(x, cy, decoKey)
          .setOrigin(0.5)
          .setDepth(depth + 1)
          .setAlpha(0);
        parent?.add(deco);
        t.setData('decoImg', deco);
        this.iceDecos.push({ img: deco, born: t.getData('born') as number });
      }
      x += (t.width - 20) * 0.42 + 2;
    });
    return {
      width: cursor,
      place: (x0) =>
        imgs.forEach((t) => {
          const rx = t.getData('rx') as number;
          t.setX(rx + x0);
          (t.getData('decoImg') as Phaser.GameObjects.Image | undefined)?.setX(rx + x0);
        }),
      arm: (t0) => arms.forEach((a) => a(t0)),
      drop: (delayBase) =>
        imgs.forEach((t, i) => {
          const homeY = t.y;
          t.setY(homeY - 120).setAlpha(0);
          this.tweens.add({
            targets: t,
            y: homeY,
            alpha: 1,
            delay: delayBase + i * 50,
            duration: 500,
            ease: 'Back.easeOut',
            onComplete: () => {
              if (t.getData('fx') !== 'water' || REDUCED_MOTION) return;
              this.tweens.add({
                targets: t,
                y: homeY - 6,
                duration: 900,
                delay: i * 70,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
              });
            },
          });
        }),
    };
  }

  create() {
    const { width, height } = this.scale;
    makeTextures(this);
    const picks = loadPicks();
    this.diff = picks.difficulty;
    this.joy = picks.joy;
    this.diffVal = undefined;
    this.joyVal = undefined;
    this.soundVal = undefined;
    this.iceDecos = [];
    this.lobbyArm = undefined;
    this.lobbyDrop = undefined;
    this.started = false;
    this.settingsOpen = false;

    this.cameras.main.setBackgroundColor(FG.yellow);
    // fade from the boot screen's yellow — seamless handoff into the splash
    this.cameras.main.fadeIn(REDUCED_MOTION ? 120 : 350, 247, 189, 20);
    // fixed 1280×800 virtual stage — uniform scale in BOTH directions so the
    // composition is identical on any window (no max width, no reflow)
    const vw = 1280;
    const vh = 800;
    const stageZoom = Math.min(width / vw, height / vh);
    this.cameras.main.setZoom(stageZoom);
    this.cameras.main.centerOn(vw / 2, vh / 2);
    // visible world edges — the stage letterboxes on one axis, so edge-anchored
    // elements must target the real view edges, not stage 0/vw/vh
    const visL = vw / 2 - width / (2 * stageZoom);
    const visR = vw / 2 + width / (2 * stageZoom);
    const visT = vh / 2 - height / (2 * stageZoom);
    const visB = vh / 2 + height / (2 * stageZoom);
    let lastW = width;
    let lastH = height;
    this.scale.on('resize', (sz: Phaser.Structs.Size) => {
      if (Math.abs(sz.width - lastW) > 24 || Math.abs(sz.height - lastH) > 24) {
        lastW = sz.width;
        lastH = sz.height;
        this.scene.restart();
      }
    });
    // the hero is a texture-backed Image — a normal display-list object that
    // dies with the scene and sits UNDER modals. Only the WebGL renderer
    // needs explicit disposal; no DOM node exists to leak.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.hero3d?.dispose());

    const prog = adventureProgress();
    const stars = totalStars(prog);
    const s = loadStats();
    const isTouch = TouchControls.isTouchDevice();
    const now = this.time.now;

    const toAdventure = () => {
      sfx.ensure();
      sfx.pickup();
      this.cameras.main.fadeOut(220, 0, 0, 0);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
        this.scene.start('adventure'),
      );
    };
    const startClassic = () => {
      sfx.ensure();
      sfx.shortWhistle();
      savePicks(this.diff, this.joy);
      this.cameras.main.fadeOut(220, 0, 0, 0);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
        this.scene.start('game', { difficulty: this.diff }),
      );
    };
    const toOnline = () => {
      sfx.ensure();
      sfx.pickup();
      this.cameras.main.fadeOut(220, 0, 0, 0);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
        this.scene.start('lobby'),
      );
    };
    const openBoard = () => {
      sfx.ensure();
      sfx.pickup();
      this.scene.start('adventure', { board: true });
    };

    // ================= LOBBY =================
    const podX = vw * 0.52;
    const podTopY = vh * 0.81;
    fgRings(this, vw, vh, podX, vh * 0.45);

    const renameRunner = () => {
      this.promptOpen = true;
      void promptModal(this, {
        title: 'NAME YOUR RUNNER',
        sub: 'shows on the board + in online lobbies',
        label: 'RUNNER NAME',
        placeholder: 'your name',
        value: playerName(),
        maxLen: 14,
        okLabel: 'SAVE',
      }).then((n) => {
        this.promptOpen = false;
        if (n === null) return;
        setPlayerName(n);
        this.events.emit('runner-renamed');
      });
    };

    this.topBar = fgTopBar(
      this,
      vw,
      [
        { icon: 'play', active: true, onDown: () => this.gate(startClassic) },
        { icon: 'edit', onDown: () => this.gate(renameRunner) },
        {
          icon: 'sliders',
          onDown: () => {
            if (!this.started) return this.dismissSplash();
            if (!this.promptOpen) this.toggleSettings();
          },
        },
        { icon: 'board', onDown: () => this.gate(openBoard) },
        { icon: 'online', onDown: () => this.gate(toOnline) },
      ],
      { crown: s.wins, star: stars },
      { y0: visT, xL: visL, xR: visR },
    );

    // pipelines registered once for every logo letter on this scene
    if (this.game.renderer.type === Phaser.WEBGL) {
      const pm = (this.renderer as Phaser.Renderer.WebGL.WebGLRenderer).pipelines;
      pm.addPostPipeline('IceFx', IceFxPipeline);
      pm.addPostPipeline('WaterFx', WaterFxPipeline);
    }
    const extrude = { ice: '#0d3550', water: '#0d3550', plain: '#5a4517' };

    // --- logo lockup, top-left — two stacked rows like FALL over GUYS ---
    const lock1 = this.buildLetters(
      [
        { text: 'ICE', fx: 'ice', size: 46 },
        { text: "'N'", fx: 'plain', size: 26 },
      ],
      visT + 112,
      extrude,
      Number.MAX_SAFE_INTEGER,
      5,
    );
    lock1.place(visL + 64);
    const lock2 = this.buildLetters(
      [{ text: 'WATER', fx: 'water', size: 62 }],
      visT + 190,
      extrude,
      Number.MAX_SAFE_INTEGER,
      5,
    );
    lock2.place(visL + 54);
    this.lobbyArm = (t0) => {
      lock1.arm(t0);
      lock2.arm(t0 + 160);
    };
    this.lobbyDrop = (d) => {
      lock1.drop(d);
      lock2.drop(d + 160);
    };

    // SEASON 1-style plain white line under the logo — no plaque
    this.add
      .text(visL + 58, visT + 242, 'SEASON 1 · THE ROAD NORTH', {
        fontFamily: FG_BODY,
        fontSize: '18px',
        fontStyle: 'italic 800',
        color: '#ffffff',
      })
      .setDepth(5)
      .setStroke('#0d3550', 4);

    // --- ROAD PROGRESS (their season-progress block) ---
    this.add
      .text(visL + 58, visT + 282, 'ROAD PROGRESS', {
        fontFamily: FG_BODY,
        fontSize: '15px',
        fontStyle: '800',
        color: '#ffffff',
      })
      .setDepth(5)
      .setStroke('#8a6200', 3);
    fgProgressBar(this, visL + 100, visT + 308, 268, 28, (prog.unlocked - 1) / TOTAL_LEVELS, `${prog.unlocked - 1}/${TOTAL_LEVELS}`);
    fgHexBadge(this, visL + 92, visT + 322, 24, `${Math.max(1, prog.unlocked - 1)}`);

    // --- podium + 3D hero ---
    const pod = this.add.graphics().setDepth(4);
    pod.fillStyle(FG.podiumSide, 1).fillRect(podX - 170, podTopY, 340, vh - podTopY + 80); // body runs off the bottom edge like theirs
    pod.fillStyle(FG.podiumTop, 1).fillEllipse(podX, podTopY, 340, 54); // top face
    pod.fillStyle(0xffffff, 0.34).fillEllipse(podX, podTopY - 4, 288, 34); // gloss
    pod.lineStyle(4, FG.pinkDeep, 0.5).strokeEllipse(podX, podTopY, 340, 54);
    // contact shadow the hero stands in
    pod.fillStyle(FG.pinkDeep, 0.32).fillEllipse(podX, podTopY + 10, 124, 17);

    this.hero3d = new Hero3D(440, 540);
    if (this.hero3d.ok && this.hero3d.canvas) {
      // Phaser's CanvasTexture needs a 2d context — a webgl canvas returns null
      // and kills scene boot. Blit three's frame into a plain 2d canvas instead.
      this.heroSrc = this.hero3d.canvas;
      const copy = document.createElement('canvas');
      copy.width = 440;
      copy.height = 540;
      this.heroCtx = copy.getContext('2d')!;
      if (this.textures.exists('hero_live')) this.textures.remove('hero_live'); // stale = dead canvas
      this.heroTex = this.textures.addCanvas('hero_live', copy) ?? undefined;
      this.heroImg = this.add
        .image(podX, podTopY - 226, 'hero_live')
        .setOrigin(0.5)
        .setDepth(6)
        .setAlpha(0)
        .setInteractive({ useHandCursor: true });
      this.heroImg.on('pointerdown', (p: Phaser.Input.Pointer) => {
        this.hero3d?.poke();
        this.heroDragX = p.x;
      });
      this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (this.heroDragX !== undefined && p.isDown) {
          this.hero3d?.spin(p.x - this.heroDragX);
          this.heroDragX = p.x;
        }
      });
      this.input.on('pointerup', () => (this.heroDragX = undefined));
    } else {
      // no WebGL for three — fall back to the baked sprite
      const heroImg = this.add
        .image(podX, podTopY + 8, 'hero')
        .setOrigin(0.5, 1)
        .setDepth(5)
        .setAlpha(0);
      this.tweens.add({ targets: heroImg, alpha: 1, duration: 400, delay: 400 });
    }

    // --- name plate — bottom-left ---
    const nameT = fgNamePlate(this, visL + 40, visB - 80, 240, 48, playerName() || 'your runner', () =>
      this.gate(renameRunner),
    );
    this.events.on('runner-renamed', () => nameT.setText(playerName() || 'your runner'));

    // --- invite hint above PLAY (their "Ⓨ Invite Players" analog) ---
    fgKeycapHint(this, visR - 218, visB - 152, 'Y', 'PLAY WITH FRIENDS', () => this.gate(toOnline));

    // --- PLAY! — bottom-right; left edge is the reference's "/" slant,
    // right end runs off the frame edge cropped ---
    fgButton(this, visR - 170, visB - 80, 370, 90, 'PLAY!', {
      icon: 'dot',
      slant: true,
      fontSize: 56,
      onDown: () => this.gate(toAdventure),
    });

    // --- settings card (gear toggles — modal over the stage) ---
    this.buildSettingsCard(vw, vh, isTouch, { l: visL, t: visT, r: visR, b: visB });

    // the loading screen — #boot hands off seamlessly (same yellow crown
    // look), then the splash auto-dismisses into the lobby
    this.buildSplash(vw, vh, extrude, now);

    this.refreshPicks();

    // ------- input — every action reachable without a mouse -------
    this.input.keyboard!.on('keydown-SPACE', () => this.gate(toAdventure));
    this.input.keyboard!.on('keydown-ENTER', () => this.gate(toAdventure));
    this.input.keyboard!.on('keydown-UP', () => this.gate(() => this.cycleDiff(-1)));
    this.input.keyboard!.on('keydown-DOWN', () => this.gate(() => this.cycleDiff(1)));
    this.input.keyboard!.on('keydown-A', () => this.gate(toAdventure));
    this.input.keyboard!.on('keydown-Q', () => this.gate(startClassic));
    this.input.keyboard!.on('keydown-P', () => this.gate(toOnline));
    this.input.keyboard!.on('keydown-L', () => this.gate(openBoard));
    this.input.keyboard!.on('keydown-ESC', () => {
      if (this.settingsOpen) this.toggleSettings();
    });
  }

  private gate(fn: () => void) {
    // modals own the input while open — no nav keys firing behind them
    if (this.promptOpen || this.settingsOpen) return;
    if (!this.started) this.dismissSplash();
    else fn();
  }

  private buildSplash(
    vw: number,
    vh: number,
    extrude: Record<'ice' | 'water' | 'plain', string>,
    now: number,
  ) {
    const c = this.add.container(0, 0).setDepth(50);
    const tile = this.add
      .tileSprite(vw / 2, vh / 2, vw * 1.8, vh, bakeCrownTile(this))
      .setAlpha(1);
    c.add(tile);

    // stacked emblem — ICE 'N' over a bigger WATER, like FALL / GUYS
    const row1 = this.buildLetters(
      [
        { text: 'ICE', fx: 'ice', size: 62 },
        { text: "'N'", fx: 'plain', size: 36 },
      ],
      vh * 0.3,
      extrude,
      now + 200,
      51,
      c,
    );
    row1.place(vw / 2 - row1.width / 2);
    const row2 = this.buildLetters(
      [{ text: 'WATER', fx: 'water', size: 78 }],
      vh * 0.44,
      extrude,
      now + 400,
      51,
      c,
    );
    row2.place(vw / 2 - row2.width / 2);
    // splash letters animate immediately — arm borns now, drop them in
    row1.arm(now);
    row2.arm(now);
    row1.drop(150);
    row2.drop(350);

    const tag = this.add
      .text(vw / 2, vh * 0.55, 'the playground chase game', {
        fontFamily: FG_BODY,
        fontSize: '22px',
        fontStyle: '800',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setDepth(51)
      .setStroke('#8a6200', 4);
    c.add(tag);

    const dots = this.add.graphics().setDepth(51);
    for (let i = 0; i < 3; i++) dots.fillStyle(0xffffff, 0.9).fillCircle(vw / 2 - 18 + i * 18, vh * 0.62, 4);
    c.add(dots);

    // timed intro — a few seconds, then the lobby reveals itself (tap skips)
    const z = this.add
      .zone(0, 0, vw, vh)
      .setOrigin(0, 0)
      .setDepth(60)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.dismissSplash());
    c.add(z);
    this.splash = c;
    // wall-clock dismiss — the scene timer stalls when the RAF loop panics
    // on big deltas (background tabs), setTimeout doesn't
    window.setTimeout(() => this.dismissSplash(), REDUCED_MOTION ? 1000 : 2400);
  }

  private dismissSplash() {
    if (this.started) return;
    this.started = true;
    sfx.ensure();
    sfx.pickup();
    const c = this.splash;
    if (c) {
      this.tweens.add({
        targets: c,
        alpha: 0,
        duration: REDUCED_MOTION ? 120 : 380,
        onComplete: () => c.destroy(true),
      });
      // RAF-throttled tabs can stall the tween — guarantee removal (wall clock)
      window.setTimeout(() => {
        if (c.active) c.destroy(true);
      }, 700);
    }
    this.revealLobby();
  }

  private revealLobby() {
    const now = this.time.now;
    this.lobbyArm?.(now);
    // lockup icicle decos ride the reveal timeline, not create-time
    for (const d of this.iceDecos) {
      if (d.born > now + 60000) d.born = now + 520;
    }
    this.lobbyDrop?.(0);
    if (this.heroImg) {
      this.tweens.add({ targets: this.heroImg, alpha: 1, duration: 600, delay: 250 });
    }
  }

  private buildSettingsCard(
    vw: number,
    vh: number,
    isTouch: boolean,
    vis: { l: number; t: number; r: number; b: number },
  ) {
    const W = 560;
    const H = isTouch ? 430 : 510;
    const visW = vis.r - vis.l;
    const visH = vis.b - vis.t;
    const cx = vis.l + visW * 0.66;
    const cy = vis.t + visH * 0.5;
    const top = cy - H / 2;
    const card = this.add.container(0, 0).setDepth(45).setVisible(false).setAlpha(0);

    // zones gated by cardZones — enabled only while the card is open
    const gateZone = (z: Phaser.GameObjects.Zone) => {
      z.input!.enabled = false;
      this.cardZones.push(z);
      return z;
    };
    // dim — tap outside the card closes it. Overscan: sf0 still scales about
    // the view centre under this camera's zoom, so small margins leak bands.
    const dimZ = gateZone(
      this.add.zone(-vw, -vh, vw * 3, vh * 3).setOrigin(0, 0).setInteractive(),
    );
    dimZ.on('pointerdown', () => this.toggleSettings());
    // FG settings is a full takeover — periwinkle field + rings + gear stamps,
    // not a dimmed lobby. Zone stays clear so taps off the card still close.
    const field = this.add.graphics();
    field.fillStyle(0x9db2ef, 1).fillRect(-vw, -vh, vw * 3, vh * 3);
    // rings radiate from behind the card, not the cogs
    field.lineStyle(3, 0xffffff, 0.08);
    for (let r = 70; r < visW * 1.1; r += 74) field.strokeCircle(cx, cy, r);
    field.lineStyle(2, 0xffffff, 0.05);
    for (let r = 80; r < visW * 0.9; r += 96)
      field.strokeCircle(vis.l + visW * 0.95, vis.t + visH * 0.04, r);
    // SETTINGS header tab — their top-left chamfered label, white-rimmed
    const tabPts = [
      { x: vis.l, y: vis.t },
      { x: vis.l + 176, y: vis.t },
      { x: vis.l + 176, y: vis.t + 32 },
      { x: vis.l + 160, y: vis.t + 48 },
      { x: vis.l, y: vis.t + 48 },
    ];
    field.fillStyle(0x000000, 1).fillPoints(tabPts, true);
    field.lineStyle(2.5, 0xffffff, 0.9).strokePoints(tabPts, true);
    card.add([dimZ, field]);
    const gear = (gx: number, gy: number, gr: number, teeth: number) => {
      const key = `fg_gear_${Math.round(gr)}`;
      const c = gr + 6;
      if (!this.textures.exists(key)) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = Math.ceil(c * 2);
        const ctx = cv.getContext('2d')!;
        const step = (Math.PI * 2) / teeth;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        for (let t = 0; t < teeth; t++) {
          const a = t * step;
          for (const [rr, da] of [
            [gr * 0.82, 0],
            [gr, step * 0.18],
            [gr, step * 0.55],
            [gr * 0.82, step * 0.73],
          ])
            ctx.lineTo(c + Math.cos(a + da) * rr, c + Math.sin(a + da) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(c, c, gr * 0.4, 0, Math.PI * 2);
        ctx.fill();
        this.textures.addCanvas(key, cv);
      }
      card.add(this.add.image(gx, gy, key).setAlpha(0.92));
    };
    // diagonal cluster — small cog nests down-right of the big one
    gear(vis.l + visW * 0.16, vis.t + visH * 0.36, Math.min(visW, visH) * 0.15, 9);
    gear(vis.l + visW * 0.28, vis.t + visH * 0.58, Math.min(visW, visH) * 0.095, 8);
    card.add(
      this.add
        .text(vis.l + 16, vis.t + 23, 'SETTINGS', {
          fontFamily: FG_FONT,
          fontSize: '20px',
          color: '#ffffff',
        })
        .setOrigin(0, 0.5),
    );
    // footer hints — their Select Ⓛ / Back Ⓑ row
    card.add(
      this.add
        .text(vis.r - 18, vis.b - 16, '❮ ❯ — change   ·   esc — close', {
          fontFamily: FG_BODY,
          fontSize: '12px',
          fontStyle: '700',
          color: '#eef2ff',
        })
        .setOrigin(1, 1),
    );
    // swallows taps on the card body so they don't hit the dim zone
    const swallow = gateZone(
      this.add.zone(cx - W / 2, cy - H / 2, W, H).setOrigin(0, 0).setInteractive(),
    );
    card.add(swallow);

    // ---- the cyan card — their settings face, not our paper ----
    const cg = this.add.graphics();
    cg.fillStyle(0x0a0710, 0.5).fillRoundedRect(cx - W / 2 + 6, cy - H / 2 + 8, W, H, 18);
    cg.fillStyle(0xffffff, 1).fillRoundedRect(cx - W / 2 - 2, cy - H / 2 - 2, W + 4, H + 4, 18);
    cg.fillStyle(FG.cyan, 1).fillRoundedRect(cx - W / 2, cy - H / 2, W, H, 16);
    cg.fillStyle(0xffffff, 0.12).fillRoundedRect(cx - W / 2 + 8, cy - H / 2 + 6, W - 16, 30, 10);
    card.add(cg);



    // ---- section bar — dark beveled tag like MOUSE SETTINGS/CONTROL BINDING ----
    const section = (y: number, title: string) => {
      const sg = this.add.graphics();
      const bx = cx - W / 2 + 22;
      const bw = (W - 44) * 0.75;
      sg.fillStyle(0x17151f, 1).fillPoints(
        [
          { x: bx, y },
          { x: bx + bw, y },
          { x: bx + bw - 12, y: y + 26 },
          { x: bx, y: y + 26 },
        ],
        true,
      );
      card.add(sg);
      card.add(
        this.add
          .text(cx - W / 2 + 38, y + 13, title, {
            fontFamily: FG_FONT,
            fontSize: '14px',
            color: '#ffffff',
          })
          .setOrigin(0, 0.5),
      );
    };

    // ---- chevron row — label left, ‹ value › selector right ----
    const selector = (
      y: number,
      label: string,
      get: () => string,
      step: (dir: 1 | -1) => void,
    ): Phaser.GameObjects.Text => {
      // focused-row band — their light-cyan highlight on the selected row
      const hl = this.add.graphics().setAlpha(0);
      hl.fillStyle(0xffffff, 0.18).fillRoundedRect(
        cx - W / 2 + 10,
        y - 21,
        W - 20,
        42,
        8,
      );
      card.add(hl);
      const rowZ = gateZone(
        this.add
          .zone(cx - W / 2 + 10, y - 21, W - 20, 42)
          .setOrigin(0, 0)
          .setInteractive(),
      );
      rowZ.on('pointerover', () => hl.setAlpha(1));
      rowZ.on('pointerout', () => hl.setAlpha(0));
      card.add(rowZ);
      card.add(
        this.add
          .text(cx - W / 2 + 38, y, label, {
            fontFamily: FG_FONT,
            fontSize: '16px',
            color: '#ffffff',
          })
          .setOrigin(0, 0.5),
      );
      const val = this.add
        .text(cx + W / 2 - 130, y, get(), {
          fontFamily: FG_FONT,
          fontSize: '14px',
          color: '#ffffff',
        })
        .setOrigin(0.5);
      card.add(val);
      const chev = (sx: number, dir: 1 | -1) => {
        const t = this.add
          .text(cx + W / 2 + sx, y - 2, dir < 0 ? '❮' : '❯', {
            fontFamily: FG_BODY,
            fontSize: '18px',
            fontStyle: '800',
            color: '#ffffff',
          })
          .setOrigin(0.5)
          .setAlpha(0.9);
        card.add(t);
        const z = gateZone(
          this.add
            .zone(cx + W / 2 + sx - 16, y - 16, 32, 32)
            .setOrigin(0, 0)
            .setInteractive({ useHandCursor: true }),
        );
        z.on('pointerdown', () => {
          step(dir);
          sfx.pickup();
          this.tweens.add({ targets: val, scale: 1.15, duration: 90, yoyo: true });
        });
        card.add(z);
      };
      chev(-210, -1);
      chev(-50, 1);
      return val;
    };

    // ---- keycap chip — the D/A/W/S/SPC style ----
    const keycap = (x: number, y: number, cap: string) => {
      const kg = this.add.graphics();
      kg.fillStyle(0x0a0710, 0.45).fillRoundedRect(x - 2, y - 2, cap.length * 9.5 + 22, 26, 6);
      kg.fillStyle(0x2a2733, 1).fillRoundedRect(x, y - 4, cap.length * 9.5 + 18, 26, 6);
      kg.lineStyle(1.5, 0xffffff, 0.25).strokeRoundedRect(x, y - 4, cap.length * 9.5 + 18, 26, 6);
      card.add(kg);
      card.add(
        this.add
          .text(x + (cap.length * 9.5 + 18) / 2, y + 9, cap, {
            fontFamily: FG_BODY,
            fontSize: '12px',
            fontStyle: '800',
            color: '#ffffff',
          })
          .setOrigin(0.5),
      );
    };

    let y = top + 34;
    section(y, 'GAME');
    y += 48;
    this.diffVal = selector(y, 'Difficulty', () => DIFFS[this.diff].label, (dir) => {
      this.cycleDiff(dir);
    });
    y += 46;
    this.soundVal = selector(y, 'Sound', () => (sfx.isMuted ? 'OFF' : 'ON'), () => {
      const off = sfx.toggleMute();
      this.soundVal?.setText(off ? 'OFF' : 'ON');
    });
    if (isTouch) {
      y += 46;
      this.joyVal = selector(y, 'Thumbstick', () => JOY_LABEL[this.joy], (dir) => {
        const i = JOY_ORDER.indexOf(this.joy);
        this.joy = JOY_ORDER[(i + dir + JOY_ORDER.length) % JOY_ORDER.length];
        this.refreshPicks();
      });
    }
    y += 54;
    section(y, 'CONTROLS');
    y += 44;
    if (isTouch) {
      card.add(
        this.add
          .text(cx, y + 22, 'left thumb — move   ·   RUN — sprint\nH₂O — item   ·   ↻ — restart   ·   II — pause', {
            fontFamily: FG_BODY,
            fontSize: '14px',
            fontStyle: '700',
            color: '#eaf6fb',
            align: 'center',
            lineSpacing: 8,
          })
          .setOrigin(0.5),
      );
    } else {
      const binds: [string, string][] = [
        ['Move', 'WASD'],
        ['Sprint', 'SHIFT'],
        ['Pure water', 'E'],
        ['Restart', 'R'],
        ['Pause', 'ESC'],
      ];
      binds.forEach(([label, cap], i) => {
        const ry = y + i * 36;
        card.add(
          this.add
            .text(cx - W / 2 + 38, ry, label, {
              fontFamily: FG_BODY,
              fontSize: '14px',
              fontStyle: '700',
              color: '#ffffff',
            })
            .setOrigin(0, 0.5),
        );
        keycap(cx + W / 2 - 38 - (cap.length * 9.5 + 18), ry - 9, cap);
      });
    }

    // DONE — dark candy pill, same family as the lobby's BACK
    const dg = this.add.graphics();
    const dw = 150, dh = 42, dcx = cx, dcy = cy + H / 2 - 40;
    dg.fillStyle(0x0a0710, 1).fillRoundedRect(dcx - dw / 2, dcy - dh / 2 + 3, dw, dh, dh / 2);
    dg.fillStyle(UI.ink, 1).fillRoundedRect(dcx - dw / 2, dcy - dh / 2 - 4, dw, dh - 2, dh / 2);
    dg.fillStyle(0xffffff, 0.14).fillRoundedRect(dcx - dw / 2 + 7, dcy - dh / 2, dw - 14, 13, 7);
    card.add(dg);
    card.add(
      this.add
        .text(dcx, dcy - 4, 'DONE', { fontFamily: FG_FONT, fontSize: '15px', color: '#f5efe0' })
        .setOrigin(0.5),
    );
    const doneZ = gateZone(
      this.add
        .zone(dcx - dw / 2, dcy - dh / 2 - 4, dw, dh + 4)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true }),
    );
    doneZ.on('pointerdown', () => this.toggleSettings());
    card.add(doneZ);
    this.settingsCard = card;
  }

  private toggleSettings() {
    if (!this.settingsCard) return;
    this.settingsOpen = !this.settingsOpen;
    this.topBar?.setActive(2, this.settingsOpen); // the sliders tab goes pink while its card is open
    const card = this.settingsCard;
    // kill any in-flight close tween — its onComplete would setVisible(false)
    // on a card we just reopened (rapid tap-tap-tap left an invisible modal)
    this.tweens.killTweensOf(card);
    if (this.settingsOpen) {
      card.setVisible(true);
      this.cardZones.forEach((z) => (z.input!.enabled = true));
      this.tweens.add({ targets: card, alpha: 1, duration: 160 });
    } else {
      this.cardZones.forEach((z) => (z.input!.enabled = false));
      this.tweens.add({
        targets: card,
        alpha: 0,
        duration: 140,
        onComplete: () => card.setVisible(false),
      });
    }
  }

  update() {
    for (const d of this.iceDecos) {
      if (d.img.scene) d.img.setAlpha(IceFxPipeline.cycle(this.time.now, d.born));
    }
    const p = this.input.activePointer;
    if (p && (p.x !== 0 || p.y !== 0) && (p.x !== this.heroGazeP.x || p.y !== this.heroGazeP.y)) {
      this.heroGazeP = { x: p.x, y: p.y };
      this.heroGaze = {
        x: (p.x - this.scale.width / 2) / (this.scale.width / 2),
        y: (p.y - this.scale.height / 2) / (this.scale.height / 2),
      };
    }
    if (this.heroGaze) this.hero3d?.setGaze(this.heroGaze.x, this.heroGaze.y);
    this.hero3d?.update(this.time.now);
    if (this.heroSrc && this.heroCtx && this.heroTex) {
      // same-task read after render — the webgl buffer is still valid
      this.heroCtx.clearRect(0, 0, 440, 540);
      this.heroCtx.drawImage(this.heroSrc, 0, 0);
      this.heroTex.refresh();
    }
  }

  private cycleDiff(step: number) {
    const i = DIFF_ORDER.indexOf(this.diff);
    this.diff = DIFF_ORDER[(i + step + DIFF_ORDER.length) % DIFF_ORDER.length];
    this.refreshPicks();
  }

  private refreshPicks() {
    this.diffVal?.setText(DIFFS[this.diff].label);
    this.joyVal?.setText(JOY_LABEL[this.joy]);
    savePicks(this.diff, this.joy);
  }
}
