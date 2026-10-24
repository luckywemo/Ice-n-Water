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
  private diffChips: Phaser.GameObjects.Container[] = [];
  private joyChips: Phaser.GameObjects.Container[] = [];
  private iceDecos: { img: Phaser.GameObjects.Image; born: number }[] = [];
  private hero3d?: Hero3D;
  private heroImg?: Phaser.GameObjects.Image;
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
    this.diffChips = [];
    this.joyChips = [];
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
      112,
      extrude,
      Number.MAX_SAFE_INTEGER,
      5,
    );
    lock1.place(64);
    const lock2 = this.buildLetters(
      [{ text: 'WATER', fx: 'water', size: 62 }],
      190,
      extrude,
      Number.MAX_SAFE_INTEGER,
      5,
    );
    lock2.place(54);
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
      .text(58, 242, 'SEASON 1 · THE ROAD NORTH', {
        fontFamily: FG_BODY,
        fontSize: '18px',
        fontStyle: 'italic 800',
        color: '#ffffff',
      })
      .setDepth(5)
      .setStroke('#0d3550', 4);

    // --- ROAD PROGRESS (their season-progress block) ---
    this.add
      .text(58, 282, 'ROAD PROGRESS', {
        fontFamily: FG_BODY,
        fontSize: '15px',
        fontStyle: '800',
        color: '#ffffff',
      })
      .setDepth(5)
      .setStroke('#8a6200', 3);
    fgProgressBar(this, 100, 308, 268, 28, (prog.unlocked - 1) / TOTAL_LEVELS, `${prog.unlocked - 1}/${TOTAL_LEVELS}`);
    fgHexBadge(this, 92, 322, 24, `${Math.max(1, prog.unlocked - 1)}`);

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
        .image(podX, podTopY - 244, 'hero_live')
        .setOrigin(0.5)
        .setDepth(6)
        .setAlpha(0);
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
    const nameT = fgNamePlate(this, 40, vh * 0.9, 240, 48, playerName() || 'your runner', () =>
      this.gate(renameRunner),
    );
    this.events.on('runner-renamed', () => nameT.setText(playerName() || 'your runner'));

    // --- invite hint above PLAY (their "Ⓨ Invite Players" analog) ---
    fgKeycapHint(this, vw * 0.83, vh * 0.815, 'Y', 'PLAY WITH FRIENDS', () => this.gate(toOnline));

    // --- PLAY! — bottom-right; left edge is the reference's "/" slant,
    // right end runs off the frame edge cropped ---
    fgButton(this, vw * 0.867, vh * 0.9, 370, 90, 'PLAY!', {
      icon: 'dot',
      slant: true,
      fontSize: 56,
      onDown: () => this.gate(toAdventure),
    });

    // --- settings card (gear toggles — modal over the stage) ---
    this.buildSettingsCard(vw, vh, isTouch);

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

  private buildSettingsCard(vw: number, vh: number, isTouch: boolean) {
    const W = 600;
    const H = 300;
    const cx = vw / 2;
    const cy = vh * 0.52;
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
    const dim = this.add.graphics();
    dim.fillStyle(0x000000, 0.45).fillRect(-vw, -vh, vw * 3, vh * 3);
    card.add([dimZ, dim]);
    // swallows taps on the card body so they don't hit the dim zone
    const swallow = gateZone(
      this.add.zone(cx - W / 2, cy - H / 2, W, H).setOrigin(0, 0).setInteractive(),
    );
    card.add(swallow);

    card.add(panel(this, cx - W / 2, cy - H / 2, W, H, { depth: 0 }));
    card.add(
      this.add
        .text(cx, cy - H / 2 + 40, 'SETTINGS', {
          fontFamily: FG_FONT,
          fontSize: '26px',
          color: '#e84393',
        })
        .setOrigin(0.5)
        .setShadow(0, 3, '#9c2160', 0, true, false),
    );
    card.add(
      this.add
        .text(cx, cy - H / 2 + 68, 'tune the chase', {
          fontFamily: FG_BODY,
          fontSize: '13px',
          fontStyle: '600',
          color: '#7a8a99',
        })
        .setOrigin(0.5),
    );

    // lobby chip — pale recess → cyan with white rim on select
    const makeChip = (
      x: number,
      y: number,
      w: number,
      h: number,
      label: string,
      store: Phaser.GameObjects.Container[],
    ) => {
      const cg = this.add.graphics();
      const txt = this.add
        .text(0, -1, label, { fontFamily: FG_FONT, fontSize: '14px', color: '#1c2a3a' })
        .setOrigin(0.5);
      const draw = (sel: boolean) => {
        cg.clear();
        if (sel) {
          cg.fillStyle(0x0b6a99, 1).fillRoundedRect(-w / 2 + 2, -h / 2 + 3, w, h, h / 2);
          cg.fillStyle(FG.cyan, 1).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
          cg.lineStyle(2.5, 0xffffff, 1).strokeRoundedRect(-w / 2 + 1.5, -h / 2 + 1.5, w - 3, h - 3, h / 2);
          txt.setColor('#ffffff');
        } else {
          cg.fillStyle(0xe8eef4, 1).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
          cg.lineStyle(2, 0xc7d3dc, 1).strokeRoundedRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2, h / 2);
          txt.setColor('#1c2a3a');
        }
      };
      draw(false);
      const cc = this.add.container(x, y, [cg, txt]);
      (cc as unknown as { __redraw: (s: boolean) => void }).__redraw = draw;
      store.push(cc);
      const z = gateZone(
        this.add.zone(x - w / 2, y - h / 2, w, h).setOrigin(0, 0).setInteractive({ useHandCursor: true }),
      );
      card.add([cc, z]);
      return z;
    };

    const label = (x: number, t: string) =>
      card.add(
        this.add
          .text(x, cy - 38, t, {
            fontFamily: FG_BODY,
            fontSize: '12px',
            fontStyle: '800',
            color: '#7a8a99',
          })
          .setOrigin(0.5),
      );

    label(cx - 160, 'DIFFICULTY');
    DIFF_ORDER.forEach((d, i) => {
      makeChip(cx - 160 + (i - 1) * 118, cy + 14, 106, 42, DIFFS[d].label, this.diffChips).on(
        'pointerdown',
        () => {
          this.diff = d;
          this.refreshPicks();
        },
      );
    });
    if (isTouch) {
      label(cx + 170, 'THUMBSTICK');
      JOY_ORDER.forEach((j, i) => {
        makeChip(cx + 170 + (i - 0.5) * 124, cy + 14, 112, 42, JOY_LABEL[j], this.joyChips).on(
          'pointerdown',
          () => {
            this.joy = j;
            this.refreshPicks();
          },
        );
      });
    } else {
      label(cx + 170, 'CONTROLS');
      card.add(
        this.add
          .text(cx + 170, cy + 14, 'arrows — move\nshift — sprint · E — item', {
            fontFamily: FG_BODY,
            fontSize: '14px',
            fontStyle: '700',
            color: '#5a7184',
            align: 'center',
          })
          .setOrigin(0.5),
      );
    }

    // DONE — dark candy pill, same family as the lobby's BACK
    const dg = this.add.graphics();
    const dw = 150, dh = 42, dcx = cx, dcy = cy + H / 2 - 46;
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
    card.add(
      this.add
        .text(cx + W / 2 - 16, cy + H / 2 - 16, 'esc — close', {
          fontFamily: FG_BODY,
          fontSize: '11px',
          fontStyle: '600',
          color: '#b9c4cf',
        })
        .setOrigin(1, 1),
    );
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
    DIFF_ORDER.forEach((d, i) => {
      const selected = d === this.diff;
      const chip = this.diffChips[i];
      (chip as unknown as { __redraw: (s: boolean) => void }).__redraw?.(selected);
      this.tweens.add({ targets: chip, scale: selected ? 1.12 : 1, duration: 140 });
    });
    JOY_ORDER.forEach((j, i) => {
      const selected = j === this.joy;
      const chip = this.joyChips[i];
      if (!chip) return;
      (chip as unknown as { __redraw: (s: boolean) => void }).__redraw?.(selected);
      this.tweens.add({ targets: chip, scale: selected ? 1.12 : 1, duration: 140 });
    });
  }
}
