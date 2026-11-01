import Phaser from 'phaser';
import { makeTextures } from '../art';
import { Sfx } from '../audio';
import { REDUCED_MOTION, bakeLogoLetter, shade, panel, UI, textInputFocused, pillButton } from '../ui';
import { IceFxPipeline, WaterFxPipeline } from '../logofx';
import { loadStats, loadPicks, savePicks, DIFFS, Difficulty, JoyMode, PERF_ORDER, PERF_LABEL, PERF_MS, FUR_Q, PerfMode } from '../meta';
import { adventureProgress, totalStars, TOTAL_LEVELS } from '../adventure';
import { playerName, setPlayerName } from '../leaderboard';
import { pushProfile } from '../cloudsave';
import { session, signOut } from '../xauth';
import { TouchControls, keyHintsOn, fitZoom } from '../mobile';
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
import { CHARACTERS, charTitleShort, charUnlocked, currentChar, setChar } from '../characters';
import { viaWipe, wipeTo } from '../wipe';

const sfx = Sfx.inst;

const DIFF_ORDER: Difficulty[] = ['easy', 'normal', 'hard'];
const JOY_ORDER: JoyMode[] = ['floating', 'sticky'];
const JOY_LABEL: Record<JoyMode, string> = { floating: 'FLOATING', sticky: 'STICKY' };
// logo letters tilt alternately like the FALL GUYS lockup
const TILTS = [-0.07, 0.04, -0.03, 0.06, -0.05, 0.03, -0.06, 0.05, -0.02, 0.04, -0.03];

export class TitleScene extends Phaser.Scene {
  private diff: Difficulty = 'normal';
  private joy: JoyMode = 'floating';
  private perf: PerfMode = 'balanced';
  private hints = true; // key-hint chrome — Settings › GAME › Key hints
  private diffVal?: Phaser.GameObjects.Text; // chevron selector readouts in settings
  private joyVal?: Phaser.GameObjects.Text;
  private soundVal?: Phaser.GameObjects.Text;
  private perfVal?: Phaser.GameObjects.Text;
  private hintsVal?: Phaser.GameObjects.Text;
  private settingsFoot?: Phaser.GameObjects.Text;
  private iceDecos: { img: Phaser.GameObjects.Image; born: number }[] = [];
  private hero3d?: Hero3D;
  private heroImg?: Phaser.GameObjects.Image;
  private charLock?: Phaser.GameObjects.Container; // padlock over the podium bean while previewing a locked runner
  private heroGaze?: { x: number; y: number };
  private heroGazeP = { x: 0, y: 0 };
  private heroDragX?: number;
  private heroTex?: Phaser.Textures.CanvasTexture;
  private heroSrc?: HTMLCanvasElement; // three's webgl canvas — blitted into heroTex
  private heroCtx?: CanvasRenderingContext2D;
  private heroLastT = 0; // throttle on the fur composite
  private heroMs = 33; // ms between composites — user-tuned in settings
  private started = false;
  private splash?: Phaser.GameObjects.Container;
  private settingsCard?: Phaser.GameObjects.Container;
  private settingsOpen = false;
  private topBar?: ReturnType<typeof fgTopBar>;
  private promptOpen = false;
  private cardZones: Phaser.GameObjects.Zone[] = [];
  private lobbyArm?: (t0: number) => void;
  private lobbyDrop?: (delayBase: number) => void;
  private charIdx = 0;
  private charName?: Phaser.GameObjects.Text;
  private charTitle?: Phaser.GameObjects.Text; // TITLE line under the runner's name on the podium
  private refreshCharPlate?: () => void;
  private askName?: () => void; // the NAME YOUR RUNNER modal — reused for the first-run gate

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

  create(data?: { iwWipe?: boolean }) {
    const { width, height } = this.scale;
    makeTextures(this);
    const fromWipe = viaWipe(data);
    const picks = loadPicks();
    this.diff = picks.difficulty;
    this.joy = picks.joy;
    this.perf = picks.perf;
    this.hints = picks.hints;
    this.heroMs = PERF_MS[this.perf];
    this.diffVal = undefined;
    this.joyVal = undefined;
    this.hintsVal = undefined;
    this.soundVal = undefined;
    this.perfVal = undefined;
    this.iceDecos = [];
    this.lobbyArm = undefined;
    this.lobbyDrop = undefined;
    this.started = fromWipe;
    this.settingsOpen = false;

    this.cameras.main.setBackgroundColor(FG.yellow);
    // fade from the boot screen's yellow — seamless handoff into the splash.
    // a wipe arrival is already revealed by the blade, and skips the intro
    if (!fromWipe) this.cameras.main.fadeIn(REDUCED_MOTION ? 120 : 350, 247, 189, 20);
    // fixed 1280×800 virtual stage — uniform scale in BOTH directions so the
    // composition is identical on any window (no max width, no reflow)
    const vw = 1280;
    const vh = 800;
    const stageZoom = fitZoom(width, height, vw, vh);
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
      // soft keyboard = a fake resize while typing — restarting here
      // destroys the open prompt (and the DOM input with it)
      if (textInputFocused()) return;
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
      wipeTo(this, 'adventure');
    };
    const startClassic = () => {
      sfx.ensure();
      sfx.shortWhistle();
      savePicks(this.diff, this.joy, this.perf, this.hints);
      pushProfile();
      wipeTo(this, 'drop', { game: { difficulty: this.diff } });
    };
    const toOnline = () => {
      sfx.ensure();
      sfx.pickup();
      wipeTo(this, 'lobby');
    };
    const openBoard = () => {
      sfx.ensure();
      sfx.pickup();
      wipeTo(this, 'adventure', { board: true });
    };

    // ================= LOBBY =================
    const podX = vw * 0.52;
    const podTopY = vh * 0.81;
    fgRings(this, vw, vh, podX, vh * 0.45);

    const renameRunner = (required = false) => {
      this.promptOpen = true;
      void promptModal(this, {
        title: 'NAME YOUR RUNNER',
        sub: required
          ? 'first things first — pick the name the board knows you by'
          : 'max 10 letters — shows on the board + in online lobbies',
        label: 'RUNNER NAME',
        placeholder: 'your name',
        // a verified handle prefills the field — still fully editable
        value: playerName() || (session()?.handle ?? '').slice(0, 10),
        maxLen: 10,
        okLabel: 'SAVE',
        required,
      }).then((n) => {
        this.promptOpen = false;
        if (n === null) return;
        setPlayerName(n);
        pushProfile();
        this.events.emit('runner-renamed');
      });
    };
    this.askName = () => renameRunner(true);

    this.topBar = fgTopBar(
      this,
      vw,
      [
        { icon: 'play', active: true, onDown: () => this.gate(startClassic) },
        {
          icon: 'hanger',
          onDown: () =>
            this.gate(() => {
              wipeTo(this, 'outfit');
            }),
        },
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

    // roomy buffer + deeper camera — hops and flap tips keep margin, same
    // px/world density as the map bean so it displays identical size
    this.charIdx = Math.max(
      0,
      CHARACTERS.findIndex((c) => c.id === currentChar().id),
    );
    this.hero3d = new Hero3D(640, 700, 6.5, 1.3, 1.3, CHARACTERS[this.charIdx]);
    this.hero3d.furQ = FUR_Q[this.perf]; // the Bean FPS pick carries the coat
    if (this.hero3d.ok) this.hero3d.setVariant(currentChar().body, currentChar().skin);
    if (this.hero3d.ok && this.hero3d.canvas) {
      // Phaser's CanvasTexture needs a 2d context — a webgl canvas returns null
      // and kills scene boot. Blit three's frame into a plain 2d canvas instead.
      this.heroSrc = this.hero3d.canvas;
      const copy = document.createElement('canvas');
      copy.width = 640;
      copy.height = 700;
      this.heroCtx = copy.getContext('2d')!;
      if (this.textures.exists('hero_live')) this.textures.remove('hero_live'); // stale = dead canvas
      this.heroTex = this.textures.addCanvas('hero_live', copy) ?? undefined;
      this.heroImg = this.add
        .image(podX, podTopY - 240, 'hero_live') // feet planted on the podium face
        .setOrigin(0.5)
        .setDepth(6)
        .setAlpha(0)
        // hit-test the bean's body, not the transparent 640×700 canvas —
        // the full-texture rect reached the top bar and ate its taps
        .setInteractive({
          hitArea: new Phaser.Geom.Circle(320, 380, 235),
          hitAreaCallback: Phaser.Geom.Circle.Contains,
          useHandCursor: true,
        });
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

    // character picker — the podium bean IS the selector; ‹ › cycles the cast
    if (this.hero3d.ok) {
      // plate block centered on the podium's front face — but clamped to the
      // visible bottom: the cover-boosted zoom crops stage space below visB
      const pickY = Math.min(podTopY + 74, visB - 52);
      const arrowStyle = {
        fontFamily: FG_FONT,
        fontSize: '44px',
        color: '#ffffff',
        stroke: '#8a3b5c',
        strokeThickness: 7,
      };
      for (const dir of [-1, 1] as const) {
        this.add
          .text(podX + dir * 128, pickY, dir < 0 ? '‹' : '›', arrowStyle)
          .setOrigin(0.5)
          .setDepth(6)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => this.gate(() => this.cycleChar(dir)));
      }
      // stacked plate — username on top, TITLE under it; the plate itself
      // is the switch: click cycles the whole cast, locked ones preview
      const whoOf = () => (playerName() || CHARACTERS[this.charIdx].name || 'RUNNER').toUpperCase();
      const lockedOf = () => !charUnlocked(CHARACTERS[this.charIdx]);
      const titleOf = () => {
        const c = CHARACTERS[this.charIdx];
        return lockedOf() ? `LOCKED · ${charTitleShort(c)}` : charTitleShort(c) || 'RUNNER';
      };
      this.charName = this.add
        .text(podX, pickY - 12, whoOf(), {
          fontFamily: FG_FONT,
          fontSize: '26px',
          color: '#ffffff',
          stroke: '#8a3b5c',
          strokeThickness: 6,
        })
        .setOrigin(0.5)
        .setDepth(6)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.gate(() => this.cycleChar(1)));
      this.charTitle = this.add
        .text(podX, pickY + 18, titleOf(), {
          fontFamily: FG_FONT,
          fontSize: '16px',
          fontStyle: 'italic',
          color: '#ffd54f',
          stroke: '#8a3b5c',
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setDepth(6)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.gate(() => this.cycleChar(1)));
      // padlock on the bean's chest while a locked runner previews — the
      // podiums's "disabled" read, same glyph as the outfit grid's tiles
      const lockG = this.add.graphics();
      lockG.fillStyle(0x0a2030, 0.5).fillCircle(0, 6, 42);
      lockG.lineStyle(7, 0xffffff, 0.95).strokeCircle(0, -4, 14); // shackle
      lockG.fillStyle(0xffffff, 0.95).fillRoundedRect(-19, -4, 38, 34, 8); // body — centred on the disc
      lockG.fillStyle(0x0a2030, 1).fillCircle(0, 11, 5).fillRect(-3, 14, 6, 11); // keyhole
      this.charLock = this.add
        .container(podX, podTopY - 262, [lockG])
        .setDepth(7)
        .setVisible(false);
      this.refreshCharPlate = () => {
        const locked = lockedOf();
        this.charName?.setText(whoOf());
        this.charTitle?.setText(titleOf()).setColor(locked ? '#ffb3c8' : '#ffd54f');
        // locked preview — the bean itself reads disabled: cooled tint,
        // faded back, padlock on
        if (locked) this.heroImg?.setTint(0x9fb0c3).setAlpha(0.62);
        else this.heroImg?.clearTint().setAlpha(1);
        this.charLock?.setVisible(locked);
      };
    }

    // --- name plate — bottom-left ---
    const sess = session();
    const plate = fgNamePlate(this, visL + 40, visB - 80, 240, 48, playerName() || 'your runner', () =>
      this.gate(renameRunner), { handle: sess?.handle });
    // verified X avatar in the glyph slot — fetched as a blob so the object
    // URL is same-origin and can't taint the WebGL texture
    if (sess?.pfp)
      fetch(sess.pfp)
        .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            URL.revokeObjectURL(url);
            if (!this.scene.isActive()) return;
            this.textures.addImage('x-pfp', img);
            plate.setAvatar('x-pfp');
          };
          img.src = url;
        })
        .catch(() => {}); // no pfp — the crown stays
    this.events.on('runner-renamed', () => {
      this.refreshCharPlate?.();
    });

    // --- install CTA — sits over the name plate while the browser still
    //  defers an install prompt (not installed yet). Same pink as the
    //  rotate screen's button; the sheet itself is the browser's own.
    //  bip can arrive after create(), so visibility follows bip-change.
    type Bip = { prompt(): Promise<void>; userChoice: Promise<unknown> };
    const bip = () => (window as { __bip?: Bip }).__bip;
    const installBtn = pillButton(this, visL + 160, visB - 118, 220, 'INSTALL TO PLAY', {
      fill: FG.pink,
      fontSize: 15,
      onDown: async () => {
        const e = bip();
        if (!e) return;
        await e.prompt();
        await e.userChoice;
        (window as { __bip?: Bip }).__bip = undefined;
        dispatchEvent(new Event('bip-change'));
      },
    });
    const syncInstall = () => installBtn.container.setVisible(!!bip());
    syncInstall();
    addEventListener('bip-change', syncInstall);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      removeEventListener('bip-change', syncInstall),
    );

    // --- invite above PLAY (their "Ⓨ Invite Players" analog) ---
    // same chrome everywhere — the circle carries a Y keycap where keys
    // exist, the online glyph where they don't
    fgKeycapHint(
      this,
      visR - 218,
      visB - 152,
      keyHintsOn() ? 'Y' : undefined,
      'PLAY WITH FRIENDS',
      () => this.gate(toOnline),
      { icon: 'online' },
    );

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
    // look), then the splash auto-dismisses into the lobby. A wipe arrival
    // is a menu return, not a fresh boot — skip the splash container but
    // still run the reveal (bean fade-in, logo letters, name gate).
    if (fromWipe) this.revealLobby();
    else this.buildSplash(vw, vh, extrude, now);

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
    this.input.keyboard!.on('keydown-LEFT', () => this.gate(() => this.cycleChar(-1)));
    this.input.keyboard!.on('keydown-RIGHT', () => this.gate(() => this.cycleChar(1)));
  }

  private cycleChar(dir: -1 | 1) {
    // the whole cast previews on the podium — a locked runner shows itself
    // but doesn't equip; setChar only fires when a free one lands
    this.charIdx = (this.charIdx + dir + CHARACTERS.length) % CHARACTERS.length;
    const ch = CHARACTERS[this.charIdx];
    this.refreshCharPlate?.();
    if (charUnlocked(ch)) {
      setChar(ch.id);
      pushProfile();
    }
    // shape/gear change the mesh itself — retint can't do it, so the rig
    // is rebuilt and the frame-blit picks up the new canvas automatically
    if (this.hero3d) {
      this.hero3d.dispose();
      this.hero3d = new Hero3D(640, 700, 6.5, 1.3, 1.3, ch);
      if (this.hero3d.ok) {
        this.hero3d.setVariant(ch.body, ch.skin);
        this.heroSrc = this.hero3d.canvas;
      } else {
        this.heroSrc = undefined;
      }
    }
    this.hero3d?.poke(); // little bounce so the swap feels alive
    sfx.pickup();
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
    // first run — nobody enters the lobby unnamed. The modal owns input
    // (promptOpen blocks the gates) until a name lands or they cancel.
    if (!playerName()) this.askName?.();
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
    const FOOT = 76; // pinned DONE row — card content scrolls above it
    // touch runs the same world units on a smaller canvas — scale the
    // type and the row pitch or every label reads tiny on a phone
    const fs = isTouch ? 1.32 : 1;
    const rs = isTouch ? 1.34 : 1;
    const fz = (n: number) => `${Math.round(n * fs)}px`;
    const S = (n: number) => Math.round(n * rs);
    const visW = vis.r - vis.l;
    const visH = vis.b - vis.t;
    const cx = vis.l + visW * 0.66;
    const cy = vis.t + visH * 0.5;
    const cardMax = visH - 36; // the face never exceeds the visible field
    const top = cy - cardMax / 2 + 14; // content flows from the view top
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
    // footer hints — their Select Ⓛ / Back Ⓑ row (touch devices get no
    // key legend; desktop users can hide it via the Key hints pick —
    // visibility refreshed live from refreshPicks so the toggle lands now)
    this.settingsFoot = this.add
      .text(vis.r - 18, vis.b - 16, '❮ ❯ — change   ·   esc — close', {
        fontFamily: FG_BODY,
        fontSize: '12px',
        fontStyle: '700',
        color: '#eef2ff',
      })
      .setOrigin(1, 1)
      .setVisible(keyHintsOn());
    card.add(this.settingsFoot);
    // swallows taps on the card body so they don't hit the dim zone —
    // resized to the final card height once content is measured
    const swallow = gateZone(
      this.add.zone(cx - W / 2, 0, W, 10).setOrigin(0, 0).setInteractive(),
    );
    card.add(swallow);
    // ---- the cyan card — drawn at the final height after measurement ----
    const cg = this.add.graphics();
    card.add(cg);
    // scroll port — every row lives in `inner`, clipped by a geometry mask
    const inner = this.add.container(0, 0);
    card.add(inner);

    // ---- section bar — dark beveled tag like MOUSE SETTINGS/CONTROL BINDING ----
    const section = (y: number, title: string) => {
      const sg = this.add.graphics();
      const bx = cx - W / 2 + 22;
      const bw = (W - 44) * 0.75;
      sg.fillStyle(0x17151f, 1).fillPoints(
        [
          { x: bx, y },
          { x: bx + bw, y },
          { x: bx + bw - 12, y: y + S(26) },
          { x: bx, y: y + S(26) },
        ],
        true,
      );
      inner.add(sg);
      inner.add(
        this.add
          .text(cx - W / 2 + 38, y + S(13), title, {
            fontFamily: FG_FONT,
            fontSize: fz(14),
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
        y - S(21),
        W - 20,
        S(42),
        8,
      );
      inner.add(hl);
      const rowZ = gateZone(
        this.add
          .zone(cx - W / 2 + 10, y - S(21), W - 20, S(42))
          .setOrigin(0, 0)
          .setInteractive(),
      );
      rowZ.on('pointerover', () => hl.setAlpha(1));
      rowZ.on('pointerout', () => hl.setAlpha(0));
      inner.add(rowZ);
      inner.add(
        this.add
          .text(cx - W / 2 + 38, y, label, {
            fontFamily: FG_FONT,
            fontSize: fz(16),
            color: '#ffffff',
          })
          .setOrigin(0, 0.5),
      );
      const val = this.add
        .text(cx + W / 2 - 130, y, get(), {
          fontFamily: FG_FONT,
          fontSize: fz(14),
          color: '#ffffff',
        })
        .setOrigin(0.5);
      inner.add(val);
      const chev = (sx: number, dir: 1 | -1) => {
        const t = this.add
          .text(cx + W / 2 + sx, y - 2, dir < 0 ? '❮' : '❯', {
            fontFamily: FG_BODY,
            fontSize: fz(18),
            fontStyle: '800',
            color: '#ffffff',
          })
          .setOrigin(0.5)
          .setAlpha(0.9);
        inner.add(t);
        const z = gateZone(
          this.add
            .zone(cx + W / 2 + sx - S(16), y - S(16), S(32), S(32))
            .setOrigin(0, 0)
            .setInteractive({ useHandCursor: true }),
        );
        z.on('pointerdown', () => {
          step(dir);
          sfx.pickup();
          this.tweens.add({ targets: val, scale: 1.15, duration: 90, yoyo: true });
        });
        inner.add(z);
      };
      chev(-210, -1);
      chev(-50, 1);
      return val;
    };

    // ---- keycap chip — the D/A/W/S/SPC style ----
    const keycap = (x: number, y: number, cap: string) => {
      const cw = cap.length * 10 * fs;
      const kg = this.add.graphics();
      kg.fillStyle(0x0a0710, 0.45).fillRoundedRect(x - 2, y - 2, cw + 22, S(26), 6);
      kg.fillStyle(0x2a2733, 1).fillRoundedRect(x, y - 4, cw + 18, S(26), 6);
      kg.lineStyle(1.5, 0xffffff, 0.25).strokeRoundedRect(x, y - 4, cw + 18, S(26), 6);
      inner.add(kg);
      inner.add(
        this.add
          .text(x + (cw + 18) / 2, y + S(9), cap, {
            fontFamily: FG_BODY,
            fontSize: fz(12),
            fontStyle: '800',
            color: '#ffffff',
          })
          .setOrigin(0.5),
      );
    };

    let y = top + S(34);
    section(y, 'GAME');
    y += S(48);
    this.diffVal = selector(y, 'Difficulty', () => DIFFS[this.diff].label, (dir) => {
      this.cycleDiff(dir);
    });
    y += S(46);
    this.soundVal = selector(y, 'Sound', () => (sfx.isMuted ? 'OFF' : 'ON'), () => {
      const off = sfx.toggleMute();
      this.soundVal?.setText(off ? 'OFF' : 'ON');
    });
    y += S(46);
    this.perfVal = selector(y, 'Bean FPS', () => PERF_LABEL[this.perf], (dir) => {
      const i = PERF_ORDER.indexOf(this.perf);
      this.perf = PERF_ORDER[(i + dir + PERF_ORDER.length) % PERF_ORDER.length];
      this.heroMs = PERF_MS[this.perf];
      if (this.hero3d) this.hero3d.furQ = FUR_Q[this.perf]; // live coat swap
      this.refreshPicks();
    });
    if (!isTouch) {
      // desktop-only row — there are no keys to hint on touch
      y += S(46);
      this.hintsVal = selector(y, 'Key hints', () => (this.hints ? 'ON' : 'OFF'), () => {
        this.hints = !this.hints;
        this.refreshPicks();
      });
    }
    if (isTouch) {
      y += S(46);
      this.joyVal = selector(y, 'Thumbstick', () => JOY_LABEL[this.joy], (dir) => {
        const i = JOY_ORDER.indexOf(this.joy);
        this.joy = JOY_ORDER[(i + dir + JOY_ORDER.length) % JOY_ORDER.length];
        this.refreshPicks();
      });
    }
    y += S(54);
    section(y, 'CONTROLS');
    y += S(44);
    if (isTouch) {
      inner.add(
        this.add
          .text(cx, y + S(22), 'left thumb — move   ·   RUN — sprint\nH₂O — item   ·   ↻ — restart   ·   II — pause', {
            fontFamily: FG_BODY,
            fontSize: fz(14),
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
        const ry = y + i * S(38);
        inner.add(
          this.add
            .text(cx - W / 2 + 38, ry, label, {
              fontFamily: FG_BODY,
              fontSize: fz(14),
              fontStyle: '700',
              color: '#ffffff',
            })
            .setOrigin(0, 0.5),
        );
        keycap(cx + W / 2 - 38 - (cap.length * 10 * fs + 18), ry - S(9), cap);
      });
    }

    // ---- ACCOUNT — verified identity, road/stats readout, sign-out ----
    y += isTouch ? S(60) : 4 * S(38) + S(44); // clear the controls block
    section(y, 'ACCOUNT');
    y += S(44);
    const sess = session();
    const who = sess?.handle
      ? `@${sess.handle}${playerName() ? `  ·  ${playerName()}` : ''}`
      : 'not connected — sign-in is required to play';
    inner.add(
      this.add
        .text(cx - W / 2 + 38, y, who, {
          fontFamily: FG_BODY,
          fontSize: fz(14),
          fontStyle: '800',
          color: '#ffffff',
        })
        .setOrigin(0, 0.5),
    );
    if (sess) {
      // log-out pill — two taps: first arms it (SURE?), second signs out
      const loW = 108;
      const loH = 32;
      const lox = cx + W / 2 - 24 - loW / 2;
      const lg = this.add.graphics();
      lg.fillStyle(0x0a0710, 1).fillRoundedRect(lox - loW / 2, y - loH / 2 + 3, loW, loH, loH / 2);
      lg.fillStyle(0xd94f3d, 1).fillRoundedRect(lox - loW / 2, y - loH / 2 - 4, loW, loH - 2, loH / 2);
      lg.fillStyle(0xffffff, 0.14).fillRoundedRect(lox - loW / 2 + 7, y - loH / 2 - 4, loW - 14, 11, 6);
      inner.add(lg);
      const loT = this.add
        .text(lox, y - 3, 'LOG OUT', { fontFamily: FG_FONT, fontSize: fz(12), color: '#f5efe0' })
        .setOrigin(0.5);
      inner.add(loT);
      let armed = false;
      const loZ = gateZone(
        this.add
          .zone(lox - loW / 2, y - loH / 2 - 4, loW, loH + 4)
          .setOrigin(0, 0)
          .setInteractive({ useHandCursor: true }),
      );
      loZ.on('pointerdown', () => {
        if (armed) {
          signOut();
          location.reload(); // re-gates at boot — the overlay is the gate
          return;
        }
        armed = true;
        loT.setText('SURE?');
        this.time.delayedCall(2500, () => {
          armed = false;
          loT.setText('LOG OUT');
        });
      });
      inner.add(loZ);
    }
    y += S(38);
    // runner name — the board + lobby display name; settings is the only
    // place it edits now
    inner.add(
      this.add
        .text(cx - W / 2 + 38, y, 'RUNNER', {
          fontFamily: FG_BODY,
          fontSize: fz(12),
          fontStyle: '700',
          color: '#9fd8ea',
        })
        .setOrigin(0, 0.5),
    );
    const nmT = this.add
      .text(cx - W / 2 + 38 + S(120), y, (playerName() || '—').toUpperCase(), {
        fontFamily: FG_BODY,
        fontSize: fz(14),
        fontStyle: '800',
        color: '#ffffff',
      })
      .setOrigin(0, 0.5);
    inner.add(nmT);
    // EDIT pill — same candy shape as LOG OUT, cyan face
    const edW = 74,
      edH = 32;
    const edx = cx + W / 2 - 24 - edW / 2;
    const eg = this.add.graphics();
    eg.fillStyle(0x0a0710, 1).fillRoundedRect(edx - edW / 2, y - edH / 2 + 3, edW, edH, edH / 2);
    eg.fillStyle(0x1fa9e8, 1).fillRoundedRect(edx - edW / 2, y - edH / 2 - 4, edW, edH - 2, edH / 2);
    eg.fillStyle(0xffffff, 0.14).fillRoundedRect(edx - edW / 2 + 7, y - edH / 2 - 4, edW - 14, 11, 6);
    inner.add(eg);
    const edT = this.add
      .text(edx, y - 3, 'EDIT', { fontFamily: FG_FONT, fontSize: fz(12), color: '#ffffff' })
      .setOrigin(0.5);
    inner.add(edT);
    const edZ = gateZone(
      this.add
        .zone(edx - edW / 2, y - edH / 2 - 4, edW, edH + 4)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true }),
    );
    edZ.on('pointerdown', () => {
      if (this.promptOpen) return;
      this.promptOpen = true;
      void promptModal(this, {
        title: 'NAME YOUR RUNNER',
        sub: 'max 10 letters — shows on the board + in online lobbies',
        label: 'RUNNER NAME',
        placeholder: 'your name',
        value: playerName() || (sess?.handle ?? '').slice(0, 10),
        maxLen: 10,
        okLabel: 'SAVE',
      }).then((n) => {
        this.promptOpen = false;
        if (n === null) return;
        setPlayerName(n);
        pushProfile();
        nmT.setText((playerName() || '—').toUpperCase());
        this.events.emit('runner-renamed');
      });
    });
    inner.add(edZ);
    y += S(36);
    const prog = adventureProgress();
    const st = loadStats();
    inner.add(
      this.add
        .text(
          cx - W / 2 + 38,
          y,
          `road ${Math.max(0, prog.unlocked - 1)}/${TOTAL_LEVELS}  ·  ★${totalStars(prog)}  ·  ${st.wins}w/${st.games}g  ·  streak ${st.streak}  ·  best ${st.bestSurvived}s`,
          {
            fontFamily: FG_BODY,
            fontSize: fz(12),
            fontStyle: '700',
            color: '#eaf6fb',
          },
        )
        .setOrigin(0, 0.5),
    );

    // ---- measure → size the card → wire the scroll ----
    const contentBot = y + S(18);
    const viewH = Math.min(contentBot - top + FOOT, cardMax);
    const vt = cy - viewH / 2; // card top in world coords
    cg.fillStyle(0x0a0710, 0.5).fillRoundedRect(cx - W / 2 + 6, vt + 8, W, viewH, 18);
    cg.fillStyle(0xffffff, 1).fillRoundedRect(cx - W / 2 - 2, vt - 2, W + 4, viewH + 4, 18);
    cg.fillStyle(FG.cyan, 1).fillRoundedRect(cx - W / 2, vt, W, viewH, 16);
    cg.fillStyle(0xffffff, 0.12).fillRoundedRect(cx - W / 2 + 8, vt + 6, W - 16, 30, 10);
    swallow.setPosition(cx - W / 2, vt).setSize(W, viewH);

    const scrollH = viewH - FOOT - 12; // the port above the DONE row
    const over = Math.max(0, contentBot - (vt + 12) - scrollH);
    const mg = this.make.graphics();
    mg.fillRect(cx - W / 2 + 4, vt + 4, W - 8, scrollH + 8);
    inner.setMask(mg.createGeometryMask());
    const baseY = vt + 14 - top; // content top lands under the card lip
    let scroll = 0;
    let thumb: Phaser.GameObjects.Rectangle | null = null;
    const applyScroll = () => {
      inner.y = baseY - scroll;
      if (thumb) {
        const th = thumb.height;
        thumb.y = vt + 14 + th / 2 + (over ? (scroll / over) * (scrollH - th) : 0);
      }
    };
    applyScroll();
    if (over > 0) {
      const inCard = (p: Phaser.Input.Pointer) =>
        p.x >= cx - W / 2 && p.x <= cx + W / 2 && p.y >= vt && p.y <= vt + scrollH + 10;
      let dragY = 0;
      let dragScroll = 0;
      let dragging = false;
      const onDown = (p: Phaser.Input.Pointer) => {
        if (!this.settingsOpen || !inCard(p)) return;
        dragging = true;
        dragY = p.y;
        dragScroll = scroll;
      };
      const onMove = (p: Phaser.Input.Pointer) => {
        if (!dragging) return;
        scroll = Phaser.Math.Clamp(dragScroll - (p.y - dragY), 0, over);
        applyScroll();
      };
      const onUp = () => (dragging = false);
      const onWheel = (
        _p: Phaser.Input.Pointer,
        _o: unknown,
        _dx: number,
        dy: number,
      ) => {
        if (!this.settingsOpen) return;
        scroll = Phaser.Math.Clamp(scroll + dy * 0.5, 0, over);
        applyScroll();
      };
      this.input.on('pointerdown', onDown);
      this.input.on('pointermove', onMove);
      this.input.on('pointerup', onUp);
      this.input.on('wheel', onWheel);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.input.off('pointerdown', onDown);
        this.input.off('pointermove', onMove);
        this.input.off('pointerup', onUp);
        this.input.off('wheel', onWheel);
      });
      // scroll thumb — right edge of the port, position tracks the drag
      const thLen = Math.max(30, (scrollH * scrollH) / (contentBot - top));
      thumb = this.add.rectangle(cx + W / 2 - 11, 0, 6, thLen, 0xffffff, 0.35);
      card.add(thumb);
      applyScroll();
    }

    // DONE — dark candy pill, same family as the lobby's BACK — pinned
    // below the scroll port, always reachable
    const dg = this.add.graphics();
    const dw = 150, dh = 42, dcx = cx, dcy = vt + viewH - 40;
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
    this.topBar?.setActive(3, this.settingsOpen); // the sliders tab goes pink while its card is open
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
    // fur + idle anims need no more than the user's Bean FPS pick — the
    // throttle halves the getImageData readback, strokes, and texture upload
    if (this.time.now - this.heroLastT < this.heroMs) return;
    this.heroLastT = this.time.now;
    this.hero3d?.update(this.time.now);
    if (this.heroSrc && this.heroCtx && this.heroTex) {
      /* rest of the hero composite — nothing else lives below */
      // same-task read after render — the webgl buffer is still valid
      this.heroCtx.clearRect(0, 0, 640, 700);
      this.heroCtx.drawImage(this.heroSrc, 0, 0);
      // pettable strand fringe along the rendered silhouette
      if (this.heroImg && !REDUCED_MOTION) {
        const lx = p ? p.worldX - this.heroImg.x + 320 : -1;
        const ly = p ? p.worldY - this.heroImg.y + 350 : -1;
        this.hero3d?.drawFur(this.heroCtx, lx, ly);
      }
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
    this.perfVal?.setText(PERF_LABEL[this.perf]);
    this.hintsVal?.setText(this.hints ? 'ON' : 'OFF');
    savePicks(this.diff, this.joy, this.perf, this.hints);
    pushProfile(); // difficulty/hints sync; joy/perf stay per-device
    this.settingsFoot?.setVisible(keyHintsOn());
  }
}
