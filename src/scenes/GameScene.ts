import Phaser from 'phaser';
import { CONFIG } from '../config';
import { makeTextures, decorateYard } from '../art';
import { Sfx } from '../audio';
import { DISPLAY_FONT, UI_FONT, UI, panel, pinHud, layoutHud, HUD_SCALE, HudItem, REDUCED_MOTION, shade } from '../ui';
import {
  LevelDef,
  levelIntro,
  Mutator,
  objectiveText,
  recordLevel,
  TOTAL_LEVELS,
} from '../adventure';
import { submitAdventureScore } from '../leaderboard';
import { DIFFS, Difficulty, DiffPreset, recordResult, loadPicks } from '../meta';
import { TouchControls } from '../mobile';
import { generateLayout, seededRng } from '../mapgen';
import { bakeBeanSheet } from '../beanbake';
import { charMove, currentChar, CREW_DEF, MILITIA_DEF } from '../characters';
import type { BossMove } from '../adventure';

type Body = Phaser.Physics.Arcade.Body;
type Sprite = Phaser.Physics.Arcade.Sprite;

interface RunnerState {
  isPlayer: boolean;
  frozen: boolean;
  immuneUntil: number;
  stamina: number;
  sprinting: boolean;
  slipperUntil: number;
  skillUntil?: number; // inherited champion skill — rage burst window
  backupUntil?: number; // summoned mate peels off after this
  charm: boolean;
  water: number;
  aiDir: Phaser.Math.Vector2;
  decideIn: number;
  shadow: Phaser.GameObjects.Sprite;
  iceBlock: Phaser.GameObjects.Sprite | null;
  dustIn: number;
  trailIn: number;
  bobPhase: number;
  label: Phaser.GameObjects.Text;
  personality: Personality;
  sheet?: string; // baked bean sheet key — anims instead of the flat circle
}

interface ChaserState {
  decideIn: number;
  strafeUntil: number;
  strafeDir: Phaser.Math.Vector2;
  lastPos: Phaser.Math.Vector2;
  checkIn: number;
  nextDashAt: number;
  warnUntil: number;
  dashUntil: number;
  desired: Phaser.Math.Vector2;
  nextBarkAt: number;
  shadow: Phaser.GameObjects.Sprite;
  speedMult: number; // boss chasers run hot
  tint?: number; // boss body color (warn flash overrides it temporarily)
  tag?: Phaser.GameObjects.Text; // floating boss name
  rageUntil?: number; // boss move — boiling red, runs you down harder
  sheet?: string; // baked bean sheet key
  noTagUntil?: number; // icelings get a warm-up before their touch freezes
}

type ItemType = 'slippers' | 'charm' | 'water';
type Phase = 'countdown' | 'play' | 'over';
type EventKind = 'danfo' | 'nepa' | 'rain';
type Personality = (typeof CONFIG.crew)[number] | null;
type BarkKind = keyof typeof CONFIG.barks;

const sfx = Sfx.inst;
const REFUGE_COVER_MS = 5000;
const REFUGE_RADIUS = 120;
const MUT_LABEL: Record<Mutator, string> = {
  night: 'NIGHT',
  storm: 'STORM',
  market: 'MARKET DAY',
  heat: 'HEAT WAVE',
  crowd: 'CROWDED',
  decoy: 'BITTER DROPS',
};

export class GameScene extends Phaser.Scene {
  private player!: Sprite;
  private runners: Sprite[] = [];
  private chasers: Sprite[] = [];
  private rState = new Map<Sprite, RunnerState>();
  private cState = new Map<Sprite, ChaserState>();

  private wallBodies: Phaser.GameObjects.Rectangle[] = [];
  private obstacleGroup!: Phaser.Physics.Arcade.StaticGroup;
  private obstacleRects: Phaser.Geom.Rectangle[] = [];
  private mapSeed = 0;
  private arenaW: number = CONFIG.arena.width;
  private arenaH: number = CONFIG.arena.height;
  private minimap!: Phaser.GameObjects.Graphics; // radar chrome
  private minimapMaskGfx!: Phaser.GameObjects.Graphics; // circle clip mask
  private minimapDots!: Phaser.GameObjects.Graphics; // masked contents
  private hudItems: HudItem[] = [];
  private itemGroup!: Phaser.Physics.Arcade.Group;
  private itemType = new Map<Sprite, ItemType>();

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  private phase: Phase = 'countdown';
  private countdownLeft = 0;
  private countdownShown = 0;
  private timeLeft = 0;
  private reinforced = false;
  private hitstopUntil = 0;
  private nextThumpAt = 0;
  private adrenalineOn = false;
  private transitioning = false;
  private lastShownSec = -1;
  private bannerTween: Phaser.Tweens.Tween | null = null;

  // difficulty
  private diff: DiffPreset = DIFFS.normal;
  private chaserSpeed: number = CONFIG.chaser.speed;
  private roundSeconds: number = CONFIG.round.seconds;
  private crewSize: number = CONFIG.aiRunners;
  private reinforceFrac: number = CONFIG.round.reinforceAt;
  private level: LevelDef | null = null; // set when running an adventure level
  private initialChasers = 1;
  private reinforceCount = 1;
  private eventsEnabled = true;

  // random events
  private nextEventAt = 0;
  private lastEvent: EventKind | null = null;
  private slipperyUntil = 0;
  private helpUntil = 0; // COME SAVE ME ping — brave mates come running
  private playerMove?: BossMove; // inherited from the beaten champion
  private moveReadyAt = 0; // champion skills run a 14s cooldown
  private lastDir = new Phaser.Math.Vector2(1, 0); // blink dashes where you're headed
  private backup?: Sprite; // the summoned mate — one helper at a time
  private nepaUntil = 0;
  private playerLight: Phaser.GameObjects.Light | null = null;
  private chaserLights: Phaser.GameObjects.Light[] = [];
  private bus: Sprite | null = null;
  private busCollider: Phaser.Physics.Arcade.Collider | null = null;

  private touch: TouchControls | null = null;

  private playerFreezes = 0;
  private playerRescues = 0;
  private lastResult: { won: boolean; survived: number } | null = null;
  private endButtons: Phaser.GameObjects.Container[] = []; // result dashboard
  private endHitZones: { ax: number; ay: number; ox: number; oy: number; bw: number; bh: number; go: () => void }[] = [];
  private paused = false; // single-player only — net play never pauses
  private pauseObjs: { destroy: () => void }[] = [];
  private pauseHitZones: { ax: number; ay: number; ox: number; oy: number; bw: number; bh: number; go: () => void }[] = [];

  // adventure objectives — collect tokens / rescue mates beyond raw survival
  private objGot = 0;
  private collectGroup!: Phaser.Physics.Arcade.Group;

  // refuge levels — the gold ring grants ~5s of untaggable cover that
  // drains while you hide and cools back while you run
  private refugePos: { x: number; y: number; r: number } | null = null;
  private refugeGfx: Phaser.GameObjects.Graphics | null = null;
  private refugeLabel: Phaser.GameObjects.Text | null = null;
  private refugeMs = REFUGE_COVER_MS;

  // collect-twist levels — grabbing the quota freezes the leftover drops
  // into hunters and opens the gold exit ring
  private collectPhase2 = false;
  private huntMode = false;
  private mutator?: Mutator;
  private duskMode = false;
  private nextStormAt = 0;
  private staminaDrainMult = 1;
  private nextBossMoveAt = 0;
  private decoys = new Set<Sprite>();
  private sheetPlayer: string | null = null;
  private sheetCrew: string | null = null;
  private sheetMilitia: string | null = null;
  private exitPos: { x: number; y: number; r: number } | null = null;
  private exitGfx: Phaser.GameObjects.Graphics | null = null;

  // mechanic intro card — pauses the countdown until dismissed
  private introObjs: Phaser.GameObjects.GameObject[] = [];
  private introActive = false;

  private timeText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private objText!: Phaser.GameObjects.Text;
  private itemText!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;
  private subBannerText!: Phaser.GameObjects.Text;
  private countText!: Phaser.GameObjects.Text;
  private staminaGfx!: Phaser.GameObjects.Graphics;
  private teamDots: Phaser.GameObjects.Sprite[] = [];
  private vignette!: Phaser.GameObjects.Image;

  constructor() {
    super('game');
  }

  init(data: { difficulty?: Difficulty; adventure?: LevelDef }) {
    this.diff = DIFFS[data.difficulty ?? 'normal'] ?? DIFFS.normal;
    this.level = data.adventure ?? null;
  }

  create() {
    // reset all per-round state (fields survive scene.restart())
    this.runners = [];
    this.chasers = [];
    this.rState.clear();
    this.cState.clear();
    this.itemType.clear();
    this.wallBodies = [];
    this.obstacleRects = [];
    this.teamDots = [];
    this.reinforced = false;
    this.hitstopUntil = 0;
    this.nextThumpAt = 0;
    this.adrenalineOn = false;
    this.transitioning = false;
    this.lastShownSec = -1;
    this.playerFreezes = 0;
    this.playerRescues = 0;
    this.objGot = 0;
    this.lastResult = null;
    this.endButtons = [];
    this.endHitZones = [];
    this.paused = false;
    this.pauseObjs = [];
    this.pauseHitZones = [];
    this.phase = 'countdown';
    this.countdownLeft = CONFIG.round.countdownSec;
    this.countdownShown = 0;
    this.nextEventAt = 0;
    this.lastEvent = null;
    this.slipperyUntil = 0;
    this.nepaUntil = 0;
    this.playerLight = null;
    this.chaserLights = [];
    this.bus = null;
    this.busCollider = null;
    this.refugePos = null;
    this.refugeGfx = null;
    this.refugeLabel = null;
    this.refugeMs = REFUGE_COVER_MS;
    this.collectPhase2 = false;
    this.huntMode = this.level?.objective.kind === 'hunt';
    this.mutator = this.level?.mutator;
    this.duskMode = false;
    this.staminaDrainMult = this.mutator === 'heat' ? 1.7 : 1;
    this.nextStormAt = this.mutator === 'storm' ? this.time.now + 1500 : 0;
    this.nextBossMoveAt = this.time.now + 9000;
    this.decoys.clear();
    this.exitPos = null;
    this.exitGfx = null;
    this.introObjs = [];
    this.introActive = false;

    // apply the picked difficulty — adventure levels override everything
    if (this.level) {
      const L = this.level;
      this.chaserSpeed = CONFIG.chaser.speed * L.chaserMult;
      this.roundSeconds = L.seconds;
      this.crewSize = L.crew;
      this.initialChasers = L.chasers;
      this.reinforceCount = L.reinforcements;
      this.eventsEnabled = L.events;
      this.mapSeed = L.seed; // same level = same neighborhood, every time
    } else {
      this.chaserSpeed = CONFIG.chaser.speed * this.diff.chaserMult;
      this.roundSeconds = this.diff.seconds;
      this.crewSize = this.diff.aiRunners;
      this.reinforceFrac = this.diff.reinforceAt;
      this.initialChasers = 1;
      this.reinforceCount = 1;
      this.eventsEnabled = true;
      // fresh neighborhood every run
      this.mapSeed = Math.floor(Math.random() * 0xffffffff);
    }

    // battlefield size — seeded per level so the same stop always has the
    // same sprawl, and the road north gets bigger as you go
    const growRng = seededRng(this.mapSeed ^ 0x5f3759df);
    const grow =
      1.12 + growRng() * 0.38 + (this.level ? Math.min(this.level.n * 0.0006, 0.3) : 0);
    this.arenaW = Math.round((CONFIG.arena.width * grow) / 16) * 16;
    this.arenaH = Math.round((CONFIG.arena.height * grow) / 16) * 16;

    // world bounds = the big arena, not the viewport
    this.physics.world.setBounds(0, 0, this.arenaW, this.arenaH);

    makeTextures(this);

    // baked bean sheets — the 3D lobby rig pre-posed into sprite frames.
    // First entry pays a few hundred ms; sheets persist in the texture
    // manager for every later level. No WebGL → flat circles stay.
    const me = currentChar();
    this.playerMove = charMove(me); // beaten champions pass their boss's skill
    const youKey = `bean-you-${me.id}-${me.body.toString(16)}`; // per-look key — a swapped pick or repaint can't reuse a stale sheet
    this.sheetPlayer = bakeBeanSheet(this, youKey, me) ? youKey : null;
    this.sheetCrew = bakeBeanSheet(this, 'bean-crew', CREW_DEF) ? 'bean-crew' : null;
    this.sheetMilitia = bakeBeanSheet(this, 'bean-militia', MILITIA_DEF)
      ? 'bean-militia'
      : null;
    for (const k of [this.sheetPlayer, this.sheetCrew, this.sheetMilitia])
      if (k) this.makeBeanAnims(k);

    this.buildArena();
    decorateYard(
      this,
      this.obstacleRects,
      seededRng(this.mapSeed ^ 0x9e3779b9),
      this.arenaW,
      this.arenaH,
    );

    this.itemGroup = this.physics.add.group({ allowGravity: false, immovable: true });
    this.spawnEntities();
    this.spawnInitialItems();
    if (this.level?.objective.kind === 'collect') this.spawnCollectTokens();
    if (this.level?.objective.kind === 'refuge') this.spawnRefuge();

    // camera lives on the player — the world is bigger than the screen now
    this.cameras.main
      .setBounds(0, 0, this.arenaW, this.arenaH)
      .setZoom(CONFIG.camera.zoom)
      .setDeadzone(CONFIG.camera.deadzone.w, CONFIG.camera.deadzone.h)
      .startFollow(this.player, true, 0.1, 0.1);

    // lighting pipeline — NEPA events dim the world around the player
    this.lights.enable().setAmbientColor(0xffffff);
    for (const obj of this.children.list) {
      (obj as unknown as { setPipeline?: (p: string) => void }).setPipeline?.('Light2D');
    }

    // chapter mutators — dusk needs the light pipeline live, decoys need
    // the collect group to exist first
    if (this.mutator === 'night') this.applyDusk();
    if (this.mutator === 'decoy') this.spawnDecoys();

    this.touch = new TouchControls(
      this,
      {
        onWater: () => this.useItem(this.player),
        onRestart: () => {
          // after an adventure win, ↻ means "on to the next stop" — same as SPACE
          if (this.phase === 'over' && this.lastResult?.won && this.level && this.level.n < TOTAL_LEVELS) {
            this.transitionToNextLevel();
          } else {
            this.transitionTo('game', true);
          }
        },
        onPause: () => this.togglePause(),
      },
      loadPicks().joy,
    );

    this.physics.add.overlap(this.chasers, this.runners, (a, b) =>
      this.tryTag(a as Sprite, b as Sprite),
    );
    if (this.huntMode) {
      this.player.setTint(0xffb0a0); // you're IT — wear the red
      this.physics.add.overlap(this.player, this.runners, (_p, b) =>
        this.tryHuntTag(b as Sprite),
      );
    }
    this.physics.add.overlap(this.runners, this.itemGroup, (a, b) =>
      this.pickupItem(a as Sprite, b as Sprite),
    );

    this.keys = this.input.keyboard!.addKeys(
      'W,A,S,D,SHIFT,E,R,T,M,F,UP,DOWN,LEFT,RIGHT,SPACE,ESC',
    ) as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard!.addCapture([
      Phaser.Input.Keyboard.KeyCodes.UP,
      Phaser.Input.Keyboard.KeyCodes.DOWN,
      Phaser.Input.Keyboard.KeyCodes.LEFT,
      Phaser.Input.Keyboard.KeyCodes.RIGHT,
      Phaser.Input.Keyboard.KeyCodes.SPACE,
    ]);
    this.input.keyboard!.on('keydown', () => sfx.ensure());
    this.input.on('pointerdown', () => sfx.ensure());

    this.vignette = this.add
      .image(0, 0, 'vignette')
      .setDepth(17)
      .setAlpha(0)
      .setScrollFactor(0);
    this.scale.on('resize', this.relayout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.relayout, this));
    this.input.on('pointerdown', this.onEndTap, this);
    this.events.once('shutdown', () => this.input.off('pointerdown', this.onEndTap, this));
    this.input.on('pointerdown', this.onPauseTap, this);
    this.events.once('shutdown', () => this.input.off('pointerdown', this.onPauseTap, this));

    this.cameras.main.fadeIn(280, 0, 0, 0);

    this.timeLeft = this.roundSeconds;
    this.nextEventAt =
      this.time.now +
      Phaser.Math.Between(CONFIG.events.delayMs.min, CONFIG.events.delayMs.max) +
      CONFIG.round.countdownSec * 1000;
    this.buildHud();
    this.relayout();
    this.events.once('shutdown', () => sfx.stopMusic());

    // mechanic intro card — first-of-type levels and every milestone boss
    if (this.level) {
      const intro = levelIntro(this.level);
      if (intro) this.showIntro(intro);
    }
  }

  // ---------- mechanic intro card ----------

  private introDismiss: (() => void) | null = null;

  private showIntro(intro: { title: string; body: string }) {
    this.introActive = true;
    this.touch?.setActive(false);

    const w = this.scale.width;
    const h = this.scale.height;
    const z = CONFIG.camera.zoom;
    const dim = this.add
      .rectangle(w / 2, h / 2, (w * 1.5) / z, (h * 1.5) / z, 0x081420, 0.62)
      .setDepth(28)
      .setScrollFactor(0);

    const pw = Math.min(560 / z, (w * 0.86) / z);
    const ph = 250;
    const card = panel(this, -pw / 2, -ph / 2, pw, ph, { depth: 0 });
    const title = this.add
      .text(0, -ph / 2 + 30, intro.title, {
        fontFamily: DISPLAY_FONT,
        fontSize: '22px',
        color: '#0f7fb8',
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setDepth(1);
    const body = this.add
      .text(0, -ph / 2 + 76, intro.body, {
        fontFamily: UI_FONT,
        fontSize: '15px',
        fontStyle: '600',
        color: '#1c2a3a',
        align: 'center',
        lineSpacing: 7,
      })
      .setOrigin(0.5, 0)
      .setDepth(1);
    const hint = this.add
      .text(0, ph / 2 - 38, 'TAP TO PLAY', {
        fontFamily: DISPLAY_FONT,
        fontSize: '15px',
        color: '#c98a00',
      })
      .setOrigin(0.5)
      .setDepth(1);
    const wrap = this.add.container(0, 0, [card, title, body, hint]).setDepth(29);
    this.pin(wrap, 0.5, 0.5);
    this.introObjs.push(dim, wrap);
    this.relayout(); // pin() registers — layoutHud only places on relayout

    if (!REDUCED_MOTION) {
      this.tweens.add({ targets: hint, alpha: 0.3, duration: 550, yoyo: true, repeat: -1 });
      wrap.setAlpha(0);
      this.tweens.add({ targets: wrap, alpha: 1, duration: 200 });
    }

    this.introDismiss = () => this.dismissIntro();
    this.input.on('pointerdown', this.introDismiss);
    this.input.keyboard?.on('keydown', this.introDismiss);
    this.events.once('shutdown', () => this.dropIntroListeners());
  }

  private dropIntroListeners() {
    if (this.introDismiss) {
      this.input.off('pointerdown', this.introDismiss);
      this.input.keyboard?.off('keydown', this.introDismiss);
      this.introDismiss = null;
    }
  }

  private dismissIntro() {
    if (!this.introActive) return;
    this.introActive = false;
    this.dropIntroListeners();
    const dead = new Set(this.introObjs as unknown[]);
    this.hudItems = this.hudItems.filter((h) => !dead.has(h.obj));
    for (const o of this.introObjs) o.destroy();
    this.introObjs = [];
    this.touch?.setActive(true);
  }

  // ---------- world building ----------

  private buildArena() {
    const { colors } = CONFIG;
    const { wall } = CONFIG.arena;
    const width = this.arenaW;
    const height = this.arenaH;

    this.add.rectangle(width / 2, height / 2, width, height, colors.ground);

    // outer walls — permanent
    const walls = [
      { x: width / 2, y: wall / 2, w: width, h: wall },
      { x: width / 2, y: height - wall / 2, w: width, h: wall },
      { x: wall / 2, y: height / 2, w: wall, h: height },
      { x: width - wall / 2, y: height / 2, w: wall, h: height },
    ];
    for (const r of walls) {
      const rect = this.add.rectangle(r.x, r.y, r.w, r.h, colors.wall);
      this.physics.add.existing(rect, true);
      this.wallBodies.push(rect);
    }

    // seeded neighborhood blocks — the layout that changes every game
    this.obstacleGroup = this.physics.add.staticGroup();
    for (const o of generateLayout(this.mapSeed, width, height)) {
      const rect = this.add.rectangle(o.x, o.y, o.w, o.h, colors.obstacle);
      this.obstacleGroup.add(rect);
      this.obstacleRects.push(
        new Phaser.Geom.Rectangle(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h),
      );
    }
  }

  private lit<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    (obj as unknown as { setPipeline: (p: string) => void }).setPipeline('Light2D');
    return obj;
  }

  private spawnEntities() {
    const { arena } = CONFIG;

    this.player = this.physics.add.sprite(
      this.arenaW * 0.65,
      this.arenaH * 0.5,
      this.sheetPlayer ?? 'player',
    );
    this.dressBean(this.player, this.sheetPlayer);
    this.runners.push(this.player);
    const pSt = this.freshRunner(this.player, 'YOU', null);
    pSt.sheet = this.sheetPlayer ?? undefined;
    this.rState.set(this.player, pSt);
    if (this.sheetPlayer) this.player.play(this.sheetPlayer + '-idle');

    // crowd mutator packs the field with extra bodies — compound streets
    const crowdBonus = this.mutator === 'crowd' ? 3 : 0;
    for (let i = 0; i < this.crewSize + crowdBonus; i++) {
      const p = this.randomFreePos(this.arenaW * 0.35, this.arenaW - 60);
      const r = this.physics.add.sprite(p.x, p.y, this.sheetCrew ?? 'runner');
      this.dressBean(r, this.sheetCrew);
      this.runners.push(r);
      const who = CONFIG.crew[i % CONFIG.crew.length];
      const st = this.freshRunner(r, who.name, who);
      st.sheet = this.sheetCrew ?? undefined;
      this.rState.set(r, st);
      if (this.sheetCrew) r.play(this.sheetCrew + '-idle');
    }

    // militia — adventure levels can field a whole squad from the first whistle
    for (let i = 0; i < this.initialChasers; i++) {
      const y = (this.arenaH / (this.initialChasers + 1)) * (i + 1);
      const chaser = this.physics.add.sprite(
        arena.wall + 40,
        y,
        this.sheetMilitia ?? 'chaser',
      );
      this.dressBean(chaser, this.sheetMilitia);
      this.chasers.push(chaser);
      const cst = this.freshChaser(chaser);
      cst.sheet = this.sheetMilitia ?? undefined;
      // milestone levels are boss fights — the named champion is bigger,
      // hotter, and wears their title over their head
      if (this.level?.boss && i === 0) {
        chaser.setScale(1.45);
        cst.speedMult = 1.15;
        cst.tint = 0xff8080;
        cst.tag = this.add
          .text(chaser.x, chaser.y - 44, this.level.boss, {
            fontFamily: DISPLAY_FONT,
            fontSize: '13px',
            color: '#ffb0b0',
            stroke: '#2b0e0e',
            strokeThickness: 4,
          })
          .setOrigin(0.5, 1)
          .setDepth(8);
      }
      this.cState.set(chaser, cst);
    }

    for (const r of this.runners) this.collideWithWorld(r);
    for (const c of this.chasers) this.collideWithWorld(c);
  }

  /** bean sprites are 96px frames around a small hitbox — scale down,
   *  re-center the body circle on the character's belly */
  private dressBean(spr: Sprite, sheet: string | null) {
    if (!sheet) return;
    spr.setScale(0.8);
    (spr.body as Body).setCircle(20, 48 - 20, 54 - 20);
  }

  private makeBeanAnims(key: string) {
    if (this.anims.exists(key + '-run')) return;
    this.anims.create({
      key: key + '-run',
      frames: this.anims.generateFrameNumbers(key, { start: 0, end: 7 }),
      frameRate: 13,
      repeat: -1,
    });
    this.anims.create({
      key: key + '-idle',
      frames: this.anims.generateFrameNumbers(key, { start: 8, end: 11 }),
      frameRate: 6,
      repeat: -1,
    });
    this.anims.create({
      key: key + '-splat',
      frames: this.anims.generateFrameNumbers(key, { start: 12, end: 13 }),
      frameRate: 5,
      repeat: -1,
    });
  }

  /** drive a bean sprite's run/idle anim + face it along travel */
  private beanAnim(spr: Sprite, sheet: string | undefined, vx: number, speedSq: number) {
    if (!sheet) return;
    if (this.rState.get(spr)?.frozen) return; // splat owns the sprite
    const want = sheet + (speedSq > 900 ? '-run' : '-idle');
    if (spr.anims.currentAnim?.key !== want) spr.play(want);
    if (Math.abs(vx) > 12) spr.setFlipX(vx < 0);
  }

  private collideWithWorld(sprite: Sprite) {
    for (const wall of this.wallBodies) {
      this.physics.add.collider(sprite, wall);
    }
    this.physics.add.collider(sprite, this.obstacleGroup);
    (sprite.body as Body).setCollideWorldBounds(true);
  }

  private freshRunner(sprite: Sprite, name: string, personality: Personality): RunnerState {
    const shadow = this.add.sprite(sprite.x, sprite.y + CONFIG.runner.radius, 'shadow');
    shadow.setDepth(1.5);
    const label = this.add
      .text(sprite.x, sprite.y - 26, name, {
        fontFamily: UI_FONT,
        fontSize: '11px',
        fontStyle: '600',
        color: '#ffffff',
        stroke: '#2b2115',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(8);
    return {
      isPlayer: name === 'YOU',
      frozen: false,
      immuneUntil: 0,
      stamina: 1,
      sprinting: false,
      slipperUntil: 0,
      skillUntil: 0,
      charm: false,
      water: 0,
      aiDir: new Phaser.Math.Vector2(0, 0),
      decideIn: 0,
      shadow,
      iceBlock: null,
      dustIn: 0,
      trailIn: 0,
      bobPhase: Math.random() * Math.PI * 2,
      label,
      personality,
    };
  }

  private freshChaser(sprite: Sprite): ChaserState {
    const shadow = this.add.sprite(sprite.x, sprite.y + CONFIG.chaser.radius, 'shadow');
    shadow.setDepth(1.5).setScale(1.15);
    return {
      decideIn: 0,
      strafeUntil: 0,
      strafeDir: new Phaser.Math.Vector2(0, 0),
      lastPos: new Phaser.Math.Vector2(sprite.x, sprite.y),
      checkIn: 0,
      nextDashAt: this.time.now + CONFIG.chaser.dash.cooldownMs,
      warnUntil: 0,
      dashUntil: 0,
      desired: new Phaser.Math.Vector2(0, 0),
      nextBarkAt: this.time.now + Phaser.Math.Between(2500, 5000),
      shadow,
      speedMult: 1,
    };
  }

  private randomFreePos(minX = 60, maxX?: number): Phaser.Math.Vector2 {
    const { arena } = CONFIG;
    const x2 = maxX ?? this.arenaW - 60;
    for (let i = 0; i < 60; i++) {
      const x = Phaser.Math.Between(minX, x2);
      const y = Phaser.Math.Between(arena.wall + 50, this.arenaH - arena.wall - 50);
      const blocked = this.obstacleRects.some((r) =>
        Phaser.Geom.Rectangle.Contains(
          new Phaser.Geom.Rectangle(r.x - 30, r.y - 30, r.width + 60, r.height + 60),
          x,
          y,
        ),
      );
      if (!blocked) return new Phaser.Math.Vector2(x, y);
    }
    return new Phaser.Math.Vector2(this.arenaW / 2, this.arenaH / 2);
  }

  private spawnInitialItems() {
    const { items } = CONFIG;
    const spawn = (type: ItemType, count: number) => {
      for (let i = 0; i < count; i++) {
        const p = this.randomFreePos();
        const s = this.lit(this.itemGroup.create(p.x, p.y, type) as Sprite);
        s.setDepth(1.6);
        this.itemType.set(s, type);
        this.tweens.add({
          targets: s,
          y: s.y - 4,
          duration: 700 + Math.random() * 300,
          yoyo: true,
          repeat: -1,
        });
      }
    };
    // market-day mutator floods the field with pickups
    const itemMult = this.mutator === 'market' ? 2 : 1;
    spawn('slippers', items.slippers.count * itemMult);
    spawn('charm', items.charm.count * itemMult);
    // pure water — ranged thaw item
    spawn('water', items.water.count * itemMult);
  }

  /** collect-objective levels — scattered water drops */
  private spawnCollectTokens() {
    const need = this.level!.objective.count;
    // two spare pickups so nothing can soft-lock behind a bad spawn
    const total = need + 2;
    if (!this.textures.exists('lvltoken')) {
      const g = this.add.graphics();
      const c = 0x7fd8f0;
      g.fillStyle(c, 1).fillCircle(12, 12, 10);
      g.fillStyle(0xffffff, 0.35).fillCircle(9, 8, 4);
      g.lineStyle(2, 0x081420, 0.7).strokeCircle(12, 12, 9);
      g.generateTexture('lvltoken', 24, 24);
      g.destroy();
    }
    this.collectGroup = this.physics.add.group({ allowGravity: false, immovable: true });
    for (let i = 0; i < total; i++) {
      const p = this.randomFreePos();
      const s = this.lit(this.collectGroup.create(p.x, p.y, 'lvltoken') as Sprite).setDepth(1.6);
      if (!REDUCED_MOTION) {
        this.tweens.add({
          targets: s,
          y: s.y - 5,
          duration: 650 + Math.random() * 350,
          yoyo: true,
          repeat: -1,
        });
      }
    }
    this.physics.add.overlap(this.player, this.collectGroup, (_p, t) =>
      this.collectToken(t as Sprite),
    );
  }

  /** trickster mutator — bitter kola drops dressed as water */
  private spawnDecoys() {
    if (!this.collectGroup || this.level?.objective.kind !== 'collect') return;
    const fake = this.level.objective.count; // a trap for every real drop
    for (let i = 0; i < fake; i++) {
      const p = this.randomFreePos();
      const s = this.lit(
        this.collectGroup.create(p.x, p.y, 'lvltoken') as Sprite,
      ).setDepth(1.6);
      s.setTint(0xc9a06a); // browner tint — sharp eyes can tell
      this.decoys.add(s);
      if (!REDUCED_MOTION) {
        this.tweens.add({
          targets: s,
          y: s.y - 5,
          duration: 650 + Math.random() * 350,
          yoyo: true,
          repeat: -1,
        });
      }
    }
  }

  /** night mutator — permanent dusk: your own spotlight, militia as glints */
  private applyDusk() {
    this.duskMode = true;
    this.lights.setAmbientColor(0x2e2e40);
    this.playerLight = this.lights.addLight(this.player.x, this.player.y, 220, 0xffe9b0, 1.7);
    this.chaserLights = this.chasers.map((c) =>
      this.lights.addLight(c.x, c.y, 70, 0xff5050, 0.8),
    );
  }

  private collectToken(t: Sprite) {
    if (this.phase !== 'play') return;
    // bitter kola — trickster decoy. Same coat, no water inside.
    if (this.decoys.has(t)) {
      this.decoys.delete(t);
      this.burst(t.x, t.y, 0x9a6b3a, 10, 140);
      this.floatText(t.x, t.y, 'BITTER KOLA!');
      sfx.freeze();
      t.destroy();
      return;
    }
    this.burst(t.x, t.y, 0x7fd8f0, 12, 160);
    this.floatText(t.x, t.y, 'WATER DROP!');
    sfx.pickup();
    t.destroy();
    this.objGot++;
    if (
      this.level?.twist &&
      !this.collectPhase2 &&
      this.objGot >= this.level.objective.count
    ) {
      this.triggerTwist();
    }
  }

  // ---------- refuge — the gold safe ring ----------

  private spawnRefuge() {
    // center band — never sits on top of the player's spawn corner
    const p = this.randomFreePos(this.arenaW * 0.25, this.arenaW * 0.75);
    this.refugePos = { x: p.x, y: p.y, r: REFUGE_RADIUS };

    const g = this.add.graphics().setDepth(1.4);
    this.lit(g);
    this.refugeGfx = g;
    this.refugeLabel = this.lit(
      this.add
        .text(p.x, p.y - REFUGE_RADIUS - 18, 'SAFE RING', {
          fontFamily: DISPLAY_FONT,
          fontSize: '13px',
          color: '#c98a00',
          stroke: '#2b2115',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(1.4),
    );
    this.drawRefuge();
    if (!REDUCED_MOTION) {
      this.tweens.add({
        targets: this.refugeLabel,
        y: this.refugeLabel.y - 6,
        duration: 900,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  private drawRefuge() {
    const g = this.refugeGfx;
    const pos = this.refugePos;
    if (!g || !pos) return;
    const charge = this.refugeMs / REFUGE_COVER_MS;
    g.clear();
    g.fillStyle(0xffd54a, 0.1 + charge * 0.14);
    g.lineStyle(4, 0xffd54a, 0.35 + charge * 0.6);
    g.fillCircle(pos.x, pos.y, pos.r);
    g.strokeCircle(pos.x, pos.y, pos.r);
    g.lineStyle(2, 0xffffff, 0.5);
    g.strokeCircle(pos.x, pos.y, pos.r - 9);
  }

  /** is this runner currently under the ring's cover? */
  private inRefuge(r: Sprite): boolean {
    if (!this.refugePos || this.refugeMs <= 0) return false;
    return (
      Phaser.Math.Distance.Between(r.x, r.y, this.refugePos.x, this.refugePos.y) <=
      this.refugePos.r
    );
  }

  private updateRefuge(dt: number) {
    if (!this.refugePos) return;
    const inside = this.inRefuge(this.player);
    if (inside) {
      this.refugeMs = Math.max(0, this.refugeMs - dt * 1000);
      if (this.refugeMs === 0) {
        this.announce('RING DRIED UP — MOVE!');
        this.shake(140, 0.006);
      }
    } else {
      // cools back while you're out running — half rate, so dips cost you
      const before = this.refugeMs;
      this.refugeMs = Math.min(REFUGE_COVER_MS, this.refugeMs + dt * 500);
      if (before === 0 && this.refugeMs > 0) this.announce('RING IS BACK');
    }
    this.drawRefuge();
    this.refugeLabel?.setColor(this.refugeMs > 0 ? '#c98a00' : '#8a8a8a');
  }

  // ---------- collect twist — the water fights back ----------

  /** quota reached: leftover drops freeze into hunters, exit ring opens */
  /** a frozen water drop that hunts — small, cold, half your speed */
  private addIceling(x: number, y: number) {
    const c = this.lit(
      this.physics.add
        .sprite(x, y, this.sheetMilitia ?? 'chaser')
        .setScale(this.sheetMilitia ? 0.5 : 0.65)
        .setTint(CONFIG.colors.frozen)
        .setDepth(3),
    ) as Sprite;
    if (this.sheetMilitia) (c.body as Body).setCircle(16, 48 - 16, 54 - 16);
    else (c.body as Body).setCircle(CONFIG.chaser.radius * 0.8);
    this.chasers.push(c);
    const cst = this.freshChaser(c);
    cst.sheet = this.sheetMilitia ?? undefined;
    cst.speedMult = 0.55; // hunters run cold — you can outpace them
    cst.nextBarkAt = Number.MAX_SAFE_INTEGER; // drops don't bark
    cst.noTagUntil = this.time.now + 1600; // freeze-in grace — no spawn-tag
    this.cState.set(c, cst);
    this.collideWithWorld(c);
    this.burst(x, y, CONFIG.colors.frozen, 10, 140);
  }

  private triggerTwist() {
    this.collectPhase2 = true;
    sfx.freeze();
    this.showBanner('THE WATER TURNS!', 'Reach the gold ring — don\'t let it touch you');
    this.time.delayedCall(2600, () => this.clearBanner());

    const kids = this.collectGroup.getChildren() as Sprite[];
    for (const drop of kids) {
      this.addIceling(drop.x, drop.y);
      drop.destroy();
    }

    // exit ring — far side of the neighborhood from wherever you are
    const { arena } = CONFIG;
    const ex = this.player.x < this.arenaW / 2 ? this.arenaW * 0.8 : this.arenaW * 0.2;
    const p = this.randomFreePos(ex - 150, ex + 150);
    this.exitPos = { x: p.x, y: p.y, r: 70 };
    this.exitGfx = this.lit(this.add.graphics().setDepth(1.4));
    this.drawExit();
    if (!REDUCED_MOTION) {
      this.tweens.add({
        targets: this.exitGfx,
        alpha: { from: 1, to: 0.55 },
        duration: 500,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  private drawExit() {
    const g = this.exitGfx;
    const pos = this.exitPos;
    if (!g || !pos) return;
    g.clear();
    g.fillStyle(0xffd54a, 0.2);
    g.lineStyle(5, 0xffd54a, 0.95);
    g.fillCircle(pos.x, pos.y, pos.r);
    g.strokeCircle(pos.x, pos.y, pos.r);
    g.lineStyle(2, 0xffffff, 0.6);
    g.strokeCircle(pos.x, pos.y, pos.r - 12);
  }

  private reachedExit(): boolean {
    if (!this.exitPos) return false;
    return (
      Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        this.exitPos.x,
        this.exitPos.y,
      ) <= this.exitPos.r
    );
  }

  // ---------- HUD ----------

  private pin<T extends HudItem['obj']>(obj: T, ax: number, ay: number, ox = 0, oy = 0): T {
    return pinHud(this.hudItems, obj, ax, ay, ox, oy) as T;
  }

  /** re-place every pinned HUD item for the current canvas size + zoom */
  private relayout() {
    const w = this.scale.width;
    const h = this.scale.height;
    const z = CONFIG.camera.zoom;
    layoutHud(this.hudItems, w, h, z);
    // vignette covers the whole screen, centered
    this.vignette.setPosition(w / 2, h / 2).setDisplaySize((w * 1.25) / z, (h * 1.25) / z);
  }

  private buildHud() {
    const style = { fontFamily: UI_FONT, fontSize: '19px', fontStyle: '600', color: '#1c2a3a' };

    this.pin(panel(this, 14, 8, this.level ? 340 : 240, this.level ? 78 : 62), 0, 0);
    this.timeText = this.pin(
      this.add.text(0, 0, '', { ...style, fontFamily: DISPLAY_FONT, fontSize: '17px' }).setDepth(10),
      0, 0, 28, 14,
    );
    this.infoText = this.pin(
      this.add.text(0, 0, '', { ...style, fontSize: '14px', fontStyle: '500', color: '#5a7184' }).setDepth(10),
      0, 0, 28, 40,
    );
    this.itemText = this.pin(
      this.add.text(0, 0, '', { ...style, fontSize: '16px', align: 'right' })
        .setOrigin(1, 0)
        .setDepth(10)
        .setInteractive()
        .on('pointerdown', () => this.useSkill()), // the skill label doubles as the touch button
      1, 0, -16, 14,
    );
    // adventure objective line — landmark name + what the level wants
    this.objText = this.pin(
      this.add.text(0, 0, '', { ...style, fontSize: '12px', fontStyle: '500', color: '#c98a00' }).setDepth(10),
      0, 0, 28, 60,
    );

    // team status dots — one per runner
    for (let i = 0; i < this.runners.length; i++) {
      this.teamDots.push(
        this.pin(
          this.add.sprite(0, 0, 'dot').setTint(CONFIG.colors.runner).setDepth(10).setScale(1.6),
          0, 0, 150 + i * 18, 50,
        ),
      );
    }

    this.bannerText = this.pin(
      this.add.text(0, 0, '', {
        fontFamily: DISPLAY_FONT,
        fontSize: '54px',
        color: '#e84393',
        stroke: '#9c2160',
        strokeThickness: 10,
      }).setOrigin(0.5).setDepth(20),
      0.5, 0.5, 0, -40,
    );

    this.subBannerText = this.pin(
      this.add.text(0, 0, '', {
        fontFamily: UI_FONT,
        fontSize: '20px',
        fontStyle: '500',
        color: '#d8e6ee',
        stroke: '#081420',
        strokeThickness: 5,
        align: 'center',
        lineSpacing: 8,
      }).setOrigin(0.5).setDepth(20),
      0.5, 0.5, 0, 30,
    );

    this.countText = this.pin(
      this.add.text(0, 0, '', {
        fontFamily: DISPLAY_FONT,
        fontSize: '110px',
        color: '#7fd8f0',
        stroke: '#081420',
        strokeThickness: 12,
      }).setOrigin(0.5).setDepth(20),
      0.5, 0.5, 0, -30,
    );

    const isTouch = TouchControls.isTouchDevice();
    const exitLabel = this.level ? 'T — the road' : 'T — title';
    const hintText = this.pin(
      this.add.text(0, 0, isTouch
          ? 'left thumb — move   ·   RUN — sprint   ·   H₂O — use item   ·   ↻ — restart'
          : `arrows — move   shift — sprint   E — pure water   R — restart   ${exitLabel}`,
        { fontFamily: UI_FONT, fontSize: '13px', fontStyle: '600', color: '#f5efe0' },
      ).setOrigin(0.5, 1).setDepth(10),
      0.5, 1, 0, -12,
    );
    // dark keycap chip behind the hint — the "Select Ⓛ" affordance
    const chip = this.pin(this.add.graphics().setDepth(9), 0.5, 1, 0, -12);
    chip
      .fillStyle(0x0a1420, 0.6)
      .fillRoundedRect(
        -hintText.width / 2 - 14,
        -hintText.height - 9,
        hintText.width + 28,
        hintText.height + 11,
        9,
      );

    this.staminaGfx = this.add.graphics().setDepth(9);
    this.minimap = this.pin(this.add.graphics().setDepth(26), 0, 0) as Phaser.GameObjects.Graphics;
    // pinned identically to minimapDots — same layout transform keeps the
    // mask glued to the contents it clips
    this.minimapMaskGfx = this.pin(this.add.graphics().setDepth(27), 0, 0) as Phaser.GameObjects.Graphics;
    this.minimapMaskGfx.setVisible(false); // geometry masks clip even when hidden
    this.minimapDots = this.pin(this.add.graphics().setDepth(27), 0, 0) as Phaser.GameObjects.Graphics;
    this.minimapDots.setMask(this.minimapMaskGfx.createGeometryMask());
  }

  /** circular radar — shows only the neighbourhood around YOU, not the
   *  whole battlefield. Distant militia stay out of sight. */
  private drawMinimap() {
    const R = 58; // radar radius, screen px
    const RANGE = 820; // world units of coverage
    const cx = this.scale.width - R - 16;
    const cy = 52 + R;
    const s = R / RANGE;
    const g = this.minimap;
    const d = this.minimapDots;
    const m = this.minimapMaskGfx;

    g.clear();
    d.clear();
    m.clear();

    // chrome — shadow, white rim, ink face
    g.fillStyle(0x0a1420, 0.55).fillCircle(cx, cy, R + 7);
    g.fillStyle(0xffffff, 0.95).fillCircle(cx, cy, R + 4);
    g.fillStyle(UI.ink, 0.92).fillCircle(cx, cy, R + 1);
    // range rings + crosshair
    g.lineStyle(1, 0x7fd8f0, 0.22);
    g.strokeCircle(cx, cy, R * 0.66).strokeCircle(cx, cy, R * 0.33);
    g.lineStyle(1, 0x7fd8f0, 0.14);
    g.lineBetween(cx - R, cy, cx + R, cy).lineBetween(cx, cy - R, cx, cy + R);
    // rotating sweep
    if (!REDUCED_MOTION) {
      const a = (this.time.now / 1600) % (Math.PI * 2);
      g.lineStyle(2, 0x7fd8f0, 0.45);
      g.lineBetween(cx, cy, cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    }

    // contents — everything clipped to the circle
    m.fillStyle(0xffffff).fillCircle(cx, cy, R);
    const px = this.player.x;
    const py = this.player.y;
    const toMapX = (wx: number) => cx + (wx - px) * s;
    const toMapY = (wy: number) => cy + (wy - py) * s;

    // arena walls when near an edge
    d.lineStyle(2, 0xffffff, 0.28);
    d.strokeRect(toMapX(0), toMapY(0), this.arenaW * s, this.arenaH * s);

    // obstacle blocks in range
    d.fillStyle(0x4a3f2e, 0.9);
    for (const r of this.obstacleRects) {
      const rx = r.x + r.width / 2;
      const ry = r.y + r.height / 2;
      if (Math.abs(rx - px) > RANGE + 300 || Math.abs(ry - py) > RANGE + 300) continue;
      d.fillRect(
        toMapX(rx) - (r.width * s) / 2,
        toMapY(ry) - (r.height * s) / 2,
        r.width * s,
        r.height * s,
      );
    }

    const inRange = (wx: number, wy: number) =>
      Math.abs(wx - px) <= RANGE && Math.abs(wy - py) <= RANGE;
    const dot = (wx: number, wy: number, color: number, rad: number) => {
      if (!inRange(wx, wy)) return;
      d.fillStyle(color, 0.95);
      d.fillCircle(toMapX(wx), toMapY(wy), rad);
    };

    // rings worth navigating to
    if (this.refugePos) {
      const p = this.refugePos;
      dot(p.x, p.y, 0xffd54a, 4);
    }
    if (this.exitPos) {
      const p = this.exitPos;
      dot(p.x, p.y, 0xffd54a, 4);
    }
    // danfo
    if (this.bus) dot(this.bus.x, this.bus.y, 0xf7bd14, 3.4);
    // militia — only what the sweep can see
    for (const c of this.chasers) dot(c.x, c.y, CONFIG.colors.chaser, 2.8);
    for (const r of this.runners) {
      const st = this.rState.get(r)!;
      if (st.isPlayer) continue;
      dot(r.x, r.y, st.frozen ? CONFIG.colors.frozen : CONFIG.colors.runner, 2.4);
    }
    // YOU — always dead center, white ring
    d.fillStyle(0xffffff, 1).fillCircle(cx, cy, 3.6);
    d.lineStyle(1.4, 0x2f9bff, 0.9).strokeCircle(cx, cy, 5.4);
  }

  private showBanner(main: string, sub = '') {
    if (this.bannerTween) this.bannerTween.stop();
    this.bannerText.setText(main);
    this.subBannerText.setText(sub);
    const targets = [this.bannerText, this.subBannerText];
    for (const t of targets) t.setAlpha(1);
    if (main) {
      this.bannerText.setScale(0.5);
      this.bannerTween = this.tweens.add({
        targets: this.bannerText,
        scale: HUD_SCALE,
        duration: 380,
        ease: 'Back.easeOut',
      });
    }
    if (sub) {
      this.subBannerText.setAlpha(0);
      this.tweens.add({ targets: this.subBannerText, alpha: 1, delay: 120, duration: 300 });
    }
  }

  private clearBanner() {
    if (this.phase === 'play') {
      this.tweens.add({
        targets: [this.bannerText, this.subBannerText],
        alpha: 0,
        duration: 220,
      });
    }
  }

  /** Fall Guys-style result ribbon — a full-width band slides in, giant
   *  outlined word pops, hex badge lands under it, holds ~1.4s, exits,
   *  then the caller lands the detail banner + pills. */
  private playResultRibbon(won: boolean, timedOut: boolean) {
    // any mid-round banner still up (level intro, event line) must vacate —
    // clearBanner() no-ops in 'over' phase so we fade it directly
    this.tweens.add({ targets: [this.bannerText, this.subBannerText], alpha: 0, duration: 180 });
    const vw = this.scale.width;
    const bandCol = won ? 0x29b6f6 : 0xe84393; // cyan band on a win, pink on a loss
    const strokeCol = won ? '#e84393' : '#29b6f6'; // outline flips, like the ref
    const final = this.level?.n === TOTAL_LEVELS;
    const word = won
      ? final
        ? 'JOURNEY COMPLETE!'
        : 'CLEARED!'
      : timedOut
        ? 'OUT OF TIME!'
        : 'CAUGHT!';
    const note = won ? 'cleared!' : timedOut ? 'out of time' : 'frozen!';

    const c = this.add.container(0, 0).setDepth(55);
    const band = this.add.container(0, 0);
    const g = this.add.graphics();
    const BW = vw + 200;
    const BH = 92;
    // angled pill caps poking past the band's ends — dark base under each
    const cap = (cx: number, fill: number) => {
      g.fillStyle(0x17151f, 1).fillRoundedRect(cx - 80, -BH / 2 + 12, 160, 58, 29);
      g.fillStyle(fill, 1).fillRoundedRect(cx - 80, -BH / 2 + 6, 160, 58, 29);
    };
    cap(-BW / 2 + 40, won ? 0x17151f : 0x29b6f6);
    cap(BW / 2 - 40, won ? 0xe84393 : 0x17151f);
    g.fillStyle(bandCol, 1).fillRect(-BW / 2, -BH / 2, BW, BH);
    g.fillStyle(0xffffff, 1).fillRect(-BW / 2, -BH / 2 - 4, BW, 4).fillRect(-BW / 2, BH / 2, BW, 4);
    // faint crown stamps baked into the band, like their patterned ribbon
    g.fillStyle(0xffffff, 0.09);
    for (let i = 0; i < 15; i++) {
      const cx = -BW / 2 + 60 + i * ((BW - 120) / 14);
      const cy2 = i % 2 ? -18 : 22;
      const s = 9;
      g.beginPath();
      g.moveTo(cx - s, cy2 + s * 0.7);
      g.lineTo(cx - s, cy2 - s * 0.5);
      g.lineTo(cx - s * 0.5, cy2 + s * 0.1);
      g.lineTo(cx, cy2 - s * 0.8);
      g.lineTo(cx + s * 0.5, cy2 + s * 0.1);
      g.lineTo(cx + s, cy2 - s * 0.5);
      g.lineTo(cx + s, cy2 + s * 0.7);
      g.closePath();
      g.fillPath();
    }
    band.add(g);
    band.setX(-vw - 40); // parked off-screen left
    band.setAngle(-2); // the slight FG tilt

    const t = this.add
      .text(0, -6, word, {
        fontFamily: DISPLAY_FONT,
        fontSize: word.length > 14 ? '56px' : '82px',
        color: '#ffffff',
        stroke: strokeCol,
        strokeThickness: 14,
      })
      .setOrigin(0.5)
      .setScale(0)
      .setShadow(0, 5, 'rgba(0,0,0,0.35)', 0, true, false);

    // hex badge under the band — gold + star on a win, ink + ✕ on a loss
    const bg = this.add.graphics();
    const hexAt = (r: number) => {
      bg.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const px = Math.cos(a) * r;
        const py = 78 + Math.sin(a) * r;
        if (i === 0) bg.moveTo(px, py);
        else bg.lineTo(px, py);
      }
      bg.closePath();
      bg.fillPath();
    };
    bg.fillStyle(0xffffff, 1);
    hexAt(30);
    bg.fillStyle(won ? 0xf7bd14 : 0x17151f, 1);
    hexAt(26);
    const icon = this.add
      .text(0, 74, won ? '★' : '✕', {
        fontFamily: DISPLAY_FONT,
        fontSize: '24px',
        color: won ? '#17151f' : '#ffffff',
      })
      .setOrigin(0.5);
    const noteT = this.add
      .text(0, 116, note, {
        fontFamily: UI_FONT,
        fontSize: '15px',
        fontStyle: '700',
        color: '#ffffff',
        stroke: 'rgba(10,8,18,0.55)',
        strokeThickness: 4,
      })
      .setOrigin(0.5);
    bg.setAlpha(0);
    icon.setAlpha(0);
    noteT.setAlpha(0);

    c.add([band, t, bg, icon, noteT]);
    this.pin(c, 0.5, 0.5, 0, -14);
    this.relayout(); // pin() only registers — place it now

    if (REDUCED_MOTION) {
      band.setX(0).setAngle(0);
      t.setScale(1);
      bg.setAlpha(1);
      icon.setAlpha(1);
      noteT.setAlpha(1);
    } else {
      this.tweens.add({ targets: band, x: 0, duration: 330, ease: 'Cubic.easeOut' });
      this.tweens.add({ targets: t, scale: 1, duration: 320, delay: 150, ease: 'Back.easeOut' });
      this.tweens.add({ targets: [bg, icon, noteT], alpha: 1, duration: 220, delay: 380 });
    }

    this.time.delayedCall(REDUCED_MOTION ? 900 : 1400, () => {
      this.tweens.add({
        targets: c,
        alpha: 0,
        y: -40,
        duration: 240,
        onComplete: () => {
          c.destroy();
          this.hudItems = this.hudItems.filter((i) => i.obj !== (c as unknown as HudItem['obj']));
        },
      });
    });
  }

  // ---------- fx helpers ----------

  private burst(x: number, y: number, tint: number, count = 14, speed = 200) {
    const em = this.add.particles(x, y, 'dot', {
      speed: { min: speed * 0.35, max: speed },
      lifespan: { min: 220, max: 480 },
      scale: { start: 1, end: 0 },
      tint,
      emitting: false,
    });
    em.setDepth(15);
    em.explode(count);
    this.time.delayedCall(600, () => em.destroy());
  }

  private shake(ms = 120, amount = 0.006) {
    if (REDUCED_MOTION) return;
    this.cameras.main.shake(ms, amount);
  }

  private hitstop(ms = 90) {
    this.hitstopUntil = this.time.now + ms;
  }

  private floatText(x: number, y: number, msg: string, color = '#2b2115') {
    const t = this.add
      .text(x, y - 30, msg, {
        fontFamily: UI_FONT,
        fontSize: '16px',
        fontStyle: '600',
        color,
        stroke: '#f5efe0',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(16);
    this.tweens.add({
      targets: t,
      y: t.y - 34,
      alpha: 0,
      duration: 900,
      onComplete: () => t.destroy(),
    });
  }

  // ---------- interactions ----------

  private tryTag(chaser: Sprite, runner: Sprite) {
    if (this.phase !== 'play') return;
    const st = this.rState.get(runner)!;
    if (st.frozen || this.time.now < st.immuneUntil) return;
    if (this.time.now < (this.cState.get(chaser)?.noTagUntil ?? 0)) return;
    if (this.inRefuge(runner)) return; // under the gold ring's cover

    const d = Phaser.Math.Distance.Between(chaser.x, chaser.y, runner.x, runner.y);
    if (d > CONFIG.tagRange + CONFIG.runner.radius) return;

    if (st.charm) {
      st.charm = false;
      st.immuneUntil = this.time.now + CONFIG.charmImmunityMs;
      sfx.charm();
      this.burst(runner.x, runner.y, CONFIG.colors.charm, 16, 240);
      this.floatText(runner.x, runner.y, 'JUJU BLOCKED IT!');
      return;
    }
    this.freeze(runner);
  }

  // hunt levels — the player is the chaser. Catches stay down the whole round.
  private tryHuntTag(runner: Sprite) {
    if (!this.huntMode || this.phase !== 'play' || runner === this.player) return;
    const st = this.rState.get(runner)!;
    if (st.frozen || this.time.now < st.immuneUntil) return;

    const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, runner.x, runner.y);
    if (d > CONFIG.tagRange + CONFIG.runner.radius) return;

    this.freeze(runner);
    this.objGot++;
    this.barkNear(this.player, 'catch');
  }

  private freeze(runner: Sprite) {
    const st = this.rState.get(runner)!;
    st.frozen = true;
    const body = runner.body as Body;
    body.setVelocity(0, 0);
    body.moves = false;
    if (st.sheet) runner.play(st.sheet + '-splat'); // knocked flat, dizzy eyes

    st.iceBlock = this.lit(
      this.add
        .sprite(runner.x, runner.y, 'iceblock')
        .setDepth(4)
        .setAngle(Phaser.Math.Between(-12, 12)),
    );

    sfx.freeze();
    this.burst(runner.x, runner.y, CONFIG.colors.frozen, 18, 230);
    this.shake(110, 0.005);
    this.hitstop(85);

    if (st.isPlayer) {
      this.playerFreezes++;
      this.showBanner('FROZEN!', 'press E / H2O — call your crew!');
      this.shake(180, 0.009);
    }

    // pulse the frozen runner's team dot
    const idx = this.runners.indexOf(runner);
    const dot = this.teamDots[idx];
    if (dot) this.tweens.add({ targets: dot, scale: 3, duration: 150, yoyo: true });
    this.barkNear(runner, 'catch');
  }

  private thaw(runner: Sprite, rescuer?: Sprite) {
    const st = this.rState.get(runner)!;
    st.frozen = false;
    st.immuneUntil = this.time.now + CONFIG.thawImmunityMs;
    (runner.body as Body).moves = true;
    runner.clearTint();
    runner.setAlpha(1);

    if (st.iceBlock) {
      const ice = st.iceBlock;
      this.tweens.add({
        targets: ice,
        scale: 1.4,
        alpha: 0,
        duration: 250,
        onComplete: () => ice.destroy(),
      });
      st.iceBlock = null;
    }

    sfx.thaw();
    this.burst(runner.x, runner.y, CONFIG.colors.water, 16, 210);
    this.floatText(runner.x, runner.y, 'WATER!');
    if (st.sheet) runner.play(st.sheet + '-idle');
    const base = st.sheet ? 0.8 : 1; // beans dress at 0.8
    runner.setScale(base * 1.25);
    this.tweens.add({ targets: runner, scale: base, duration: 200 });

    if (rescuer && this.rState.get(rescuer)!.isPlayer) this.playerRescues++;
    if (st.isPlayer) this.clearBanner();
  }

  private pickupItem(runner: Sprite, item: Sprite) {
    const st = this.rState.get(runner);
    if (!st || st.frozen || this.phase !== 'play') return;

    const type = this.itemType.get(item)!;
    if (type === 'slippers') {
      st.slipperUntil = this.time.now + CONFIG.items.slippers.durationMs;
      if (st.isPlayer) this.floatText(runner.x, runner.y, 'LUCKY SLIPPERS!');
    } else if (type === 'charm') {
      st.charm = true;
      if (st.isPlayer) this.floatText(runner.x, runner.y, 'JUJU CHARM!');
    } else {
      st.water++;
      if (st.isPlayer) {
        this.floatText(runner.x, runner.y, 'PURE WATER +1');
      }
    }

    if (st.isPlayer) sfx.pickup();
    this.burst(item.x, item.y, CONFIG.colors[type], 8, 120);

    this.itemType.delete(item);
    item.destroy();
    // market days restock fast
    this.time.delayedCall(
      CONFIG.items.respawnMs * (this.mutator === 'market' ? 0.5 : 1),
      () => {
      const p = this.randomFreePos();
      const s = this.lit(this.itemGroup.create(p.x, p.y, type)) as Sprite;
      s.setDepth(1.6);
      this.itemType.set(s, type);
    });
  }

  // ---------- per-frame ----------

  update(_time: number, delta: number) {
    const now = this.time.now;

    // mechanic intro card owns the round until dismissed — countdown waits
    if (this.introActive) {
      this.updatePresentation(delta);
      return;
    }

    if (this.paused) {
      if (
        Phaser.Input.Keyboard.JustDown(this.keys.ESC) ||
        Phaser.Input.Keyboard.JustDown(this.keys.SPACE)
      ) {
        this.resume();
      }
      return;
    }

    if (this.phase === 'countdown') {
      if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) return this.togglePause();
      this.countdownLeft -= delta / 1000;
      const shown = Math.ceil(this.countdownLeft);
      if (shown !== this.countdownShown && shown > 0) {
        this.countdownShown = shown;
        this.countText.setText(String(shown));
        this.countText.setScale(1.4 * HUD_SCALE);
        this.tweens.add({ targets: this.countText, scale: HUD_SCALE, duration: 250 });
        sfx.tick();
      }
      if (this.countdownLeft <= 0) {
        this.phase = 'play';
        this.countText.setText('GO!');
        if (this.level) {
          const L = this.level;
          this.showBanner(
            L.milestone ? `MILESTONE ${L.milestone} — ${L.town.toUpperCase()}` : `LEVEL ${L.n}`,
            `${L.boss ? L.boss + ' — ' : ''}${L.name}\n${objectiveText(L)} · ${this.chasers.length} militia · ${L.seconds}s`,
          );
        }
        this.tweens.add({
          targets: this.countText,
          alpha: 0,
          scale: 1.6,
          duration: 600,
          onComplete: () => this.countText.setText('').setAlpha(1).setScale(1),
        });
        sfx.whistle();
        sfx.startMusic();
      }
      this.updatePresentation(delta);
      return;
    }

    if (this.phase === 'over') {
      if (
        Phaser.Input.Keyboard.JustDown(this.keys.R) ||
        Phaser.Input.Keyboard.JustDown(this.keys.SPACE)
      ) {
        if (this.level && this.lastResult?.won && this.level.n < TOTAL_LEVELS) {
          this.transitionToNextLevel();
        } else {
          this.transitionTo('game', true);
        }
      }
      if (Phaser.Input.Keyboard.JustDown(this.keys.T) || Phaser.Input.Keyboard.JustDown(this.keys.ESC)) {
        this.transitionTo(this.level ? 'adventure' : 'title');
      }
      if (Phaser.Input.Keyboard.JustDown(this.keys.S)) this.shareScore(false);
      if (Phaser.Input.Keyboard.JustDown(this.keys.M)) this.shareScore(true);
      this.updatePresentation(delta);
      return;
    }

    // hitstop — freeze the sim for a beat so tags feel punchy
    if (now < this.hitstopUntil) return;

    const dt = delta / 1000;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      // survive levels pay out for outlasting the clock. collect/rescue
      // levels: the objective IS the job — clock zero without it fails.
      const o = this.level?.objective;
      const done =
        !o ||
        o.kind === 'survive' ||
        o.kind === 'refuge' ||
        (o.kind === 'collect' && !this.level?.twist && this.objGot >= o.count) ||
        (o.kind === 'collect' && this.level?.twist && this.collectPhase2 && this.reachedExit()) ||
        (o.kind === 'rescue' && this.playerRescues >= o.count) ||
        (o.kind === 'hunt' && this.objGot >= o.count);
      return this.endGame(!done, true);
    }

    if (!this.reinforced && this.timeLeft <= this.roundSeconds * this.reinforceFrac) {
      this.spawnReinforcement();
    }

    this.updatePlayer(dt);
    for (const r of this.runners) if (!this.rState.get(r)!.isPlayer) this.updateAiRunner(r, delta);
    for (const c of this.chasers) this.updateChaser(c, delta);

    // on hunt stops your catches stay down — nobody thaws them
    if (!this.huntMode) {
      this.resolveThaws();
      this.aiUseWater();
    }
    this.updateEvents(dt);
    this.updateBoss();
    this.updateNepaLights();
    this.updateRefuge(dt);
    this.updateDanger();
    this.updateHud();
    this.updatePresentation(delta);
    this.checkWin();

    // adventure objectives can end the round early — done ≠ merely surviving
    if (this.level) {
      const o = this.level.objective;
      const done =
        (o.kind === 'collect' && !this.level.twist && this.objGot >= o.count) ||
        (o.kind === 'collect' && this.collectPhase2 && this.reachedExit()) ||
        (o.kind === 'rescue' && this.playerRescues >= o.count) ||
        (o.kind === 'hunt' && this.objGot >= o.count);
      if (done) return this.endGame(false);
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) this.transitionTo('game', true);
    if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) return this.togglePause();
    if (Phaser.Input.Keyboard.JustDown(this.keys.T)) {
      this.transitionTo(this.level ? 'adventure' : 'title');
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.E)) this.useItem(this.player);
    if (Phaser.Input.Keyboard.JustDown(this.keys.F)) this.useSkill();
  }

  private transitionTo(key: string, restart = false) {
    if (this.transitioning) return;
    this.transitioning = true;
    this.cameras.main.fadeOut(220, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      if (restart) this.scene.restart();
      else this.scene.start(key);
    });
  }

  private transitionToNextLevel() {
    if (this.transitioning || !this.level) return;
    this.transitioning = true;
    // back to the road first — the map marches the marker to the next stop,
    // and the player taps the next node (PLAY) to actually enter the level
    const cleared = this.level.n;
    this.cameras.main.fadeOut(220, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      this.scene.start('adventure', { advance: cleared }),
    );
  }

  private spawnReinforcement() {
    this.reinforced = true;
    for (let i = 0; i < this.reinforceCount; i++) {
      const p = this.randomFreePos(CONFIG.arena.wall + 40, this.arenaW * 0.4);
      const c = this.physics.add.sprite(p.x, p.y, this.sheetMilitia ?? 'chaser');
      this.dressBean(c, this.sheetMilitia);
      if (!this.sheetMilitia) (c.body as Body).setCircle(CONFIG.chaser.radius + 2);
      this.chasers.push(c);
      const cst = this.freshChaser(c);
      cst.sheet = this.sheetMilitia ?? undefined;
      this.cState.set(c, cst);
      if (this.sheetMilitia) c.play(this.sheetMilitia + '-idle');
      this.collideWithWorld(c);
      this.burst(p.x, p.y, CONFIG.colors.chaser, 20, 260);
    }
    // the danfo collider was built from a snapshot — re-arm it so the new
    // squad doesn't ghost straight through the bus
    if (this.bus) {
      this.busCollider?.destroy();
      this.busCollider = this.physics.add.collider(this.bus, [...this.runners, ...this.chasers]);
    }
    sfx.shortWhistle();
    this.showBanner('', 'MILITIA REINFORCEMENTS!');
    this.time.delayedCall(1500, () => this.clearBanner());
  }

  private isLastFree(st: RunnerState): boolean {
    if (st.frozen) return false;
    return this.runners.filter((r) => !this.rState.get(r)!.frozen).length === 1;
  }

  private updatePlayer(dt: number) {
    const st = this.rState.get(this.player)!;
    if (st.frozen) return;

    const dir = new Phaser.Math.Vector2(0, 0);
    if (this.keys.A.isDown || this.keys.LEFT.isDown) dir.x -= 1;
    if (this.keys.D.isDown || this.keys.RIGHT.isDown) dir.x += 1;
    if (this.keys.W.isDown || this.keys.UP.isDown) dir.y -= 1;
    if (this.keys.S.isDown || this.keys.DOWN.isDown) dir.y += 1;

    // virtual joystick overrides when a thumb is down
    if (this.touch && this.touch.dir.lengthSq() > 0) dir.copy(this.touch.dir);

    const moving = dir.lengthSq() > 0;
    st.sprinting =
      moving && (this.keys.SHIFT.isDown || (this.touch?.sprint ?? false)) && st.stamina > 0;
    st.stamina = Phaser.Math.Clamp(
      st.stamina +
        (st.sprinting
          ? -CONFIG.runner.sprintDrain * this.staminaDrainMult
          : CONFIG.runner.staminaRegen) *
          dt,
      0,
      1,
    );

    let speed = st.sprinting ? CONFIG.runner.sprintSpeed : CONFIG.runner.speed;
    if (this.time.now < st.slipperUntil) speed *= CONFIG.items.slippers.speedMult;
    if (this.time.now < (st.skillUntil ?? 0)) speed *= 1.5; // inherited RAGE burst
    if (this.isLastFree(st)) speed *= CONFIG.runner.adrenalineMult;

    if (moving) {
      dir.normalize();
      this.lastDir.copy(dir); // blink dashes along the held heading
    }
    const body = this.player.body as Body;
    // rain = wet ground, everything slides
    const accel =
      this.time.now < this.slipperyUntil
        ? CONFIG.runner.accel * CONFIG.events.rain.accelMult
        : CONFIG.runner.accel;
    const k = Math.min(1, accel * dt);
    body.velocity.x += (dir.x * speed - body.velocity.x) * k;
    body.velocity.y += (dir.y * speed - body.velocity.y) * k;
    this.beanAnim(this.player, st.sheet, body.velocity.x, body.velocity.lengthSq());
  }

  private updateAiRunner(r: Sprite, delta: number) {
    const st = this.rState.get(r)!;
    if (st.backupUntil && this.time.now > st.backupUntil) {
      this.removeBackup();
      return;
    }
    if (st.frozen) return;

    st.decideIn -= delta;
    if (st.decideIn <= 0) {
      st.decideIn = CONFIG.ai.runnerThinkMs;

      const p = st.personality;
      const chaser = this.nearestOf(this.huntMode ? [this.player] : this.chasers, r);
      const chaserDist = chaser
        ? Phaser.Math.Distance.Between(r.x, r.y, chaser.x, chaser.y)
        : Infinity;
      const frozenAlly = this.nearestOf(
        this.runners.filter((o) => this.rState.get(o)!.frozen),
        r,
      );
      const wantsRescue = Math.random() < (p?.rescue ?? 0.7);
      // COME SAVE ME — brave mates punch straight through to you and only
      // break off when a militia is basically on top of them
      const answeringCall =
        this.time.now < this.helpUntil &&
        this.rState.get(this.player)!.frozen &&
        (p?.rescue ?? 0) >= 0.5;

      if (chaserDist < (answeringCall ? 70 : CONFIG.ai.fleeRadius * (p?.fleeMult ?? 1)) && chaser) {
        st.aiDir
          .set(r.x - chaser.x, r.y - chaser.y)
          .normalize()
          .rotate(Phaser.Math.FloatBetween(-0.45, 0.45));
      } else if (answeringCall) {
        st.aiDir.set(this.player.x - r.x, this.player.y - r.y).normalize();
      } else if (frozenAlly && wantsRescue) {
        st.aiDir.set(frozenAlly.x - r.x, frozenAlly.y - r.y).normalize();
      } else if (p?.seeksItems && this.seekItem(r, st)) {
        /* seekItem set aiDir */
      } else if (st.aiDir.lengthSq() === 0 || Math.random() < 0.25) {
        st.aiDir.setToPolar(Math.random() * Math.PI * 2, 1);
      }
      st.aiDir = this.steer(r, st.aiDir);
    }

    let speed = CONFIG.runner.speed * (st.personality?.speedMult ?? 0.92);
    if (this.time.now < st.slipperUntil) speed *= CONFIG.items.slippers.speedMult;
    if (this.isLastFree(st)) speed *= CONFIG.runner.adrenalineMult;
    const body = r.body as Body;
    if (this.time.now < this.slipperyUntil) {
      // slippery — AI slides too
      const k = Math.min(1, 3 * (delta / 1000));
      body.velocity.x += (st.aiDir.x * speed - body.velocity.x) * k;
      body.velocity.y += (st.aiDir.y * speed - body.velocity.y) * k;
    } else {
      body.setVelocity(st.aiDir.x * speed, st.aiDir.y * speed);
    }
    this.beanAnim(r, st.sheet, body.velocity.x, body.velocity.lengthSq());
  }

  private updateChaser(c: Sprite, delta: number) {
    const st = this.cState.get(c)!;
    const dash = CONFIG.chaser.dash;

    // dash lifecycle: telegraph flash → burst of speed
    if (this.time.now >= st.nextDashAt && st.warnUntil === 0) {
      st.warnUntil = this.time.now + dash.warnMs;
      st.nextDashAt = this.time.now + dash.cooldownMs + dash.warnMs;
    }
    if (st.warnUntil > 0 && this.time.now >= st.warnUntil) {
      st.warnUntil = 0;
      st.dashUntil = this.time.now + dash.durMs;
      sfx.dash();
    }
    // dash ended empty-handed → frustrated bark
    if (st.dashUntil > 0 && this.time.now >= st.dashUntil) {
      st.dashUntil = 0;
      const near = this.nearestOf(
        this.runners.filter((r) => !this.rState.get(r)!.frozen),
        c,
      );
      if (
        near &&
        Phaser.Math.Distance.Between(c.x, c.y, near.x, near.y) > 90 &&
        Math.random() < 0.45
      ) {
        this.bark(c, 'dodge');
      }
    }
    // hunting chatter
    if (this.time.now >= st.nextBarkAt) {
      st.nextBarkAt = this.time.now + Phaser.Math.Between(5000, 9000);
      if (Math.random() < 0.55) this.bark(c, 'hunt');
    }
    c.setTintFill(
      st.warnUntil > 0
        ? 0xffc46b
        : this.time.now < (st.rageUntil ?? 0)
          ? 0xff2d2d
          : (st.tint ?? 0xffffff),
    );
    if (st.warnUntil === 0 && st.tint === undefined && this.time.now >= (st.rageUntil ?? 0))
      c.clearTint();
    st.tag?.setPosition(c.x, c.y - CONFIG.chaser.radius - 30);

    // stuck detection
    st.checkIn -= delta;
    if (st.checkIn <= 0) {
      st.checkIn = CONFIG.ai.stuckWindowMs;
      if (st.lastPos.distance(new Phaser.Math.Vector2(c.x, c.y)) < CONFIG.ai.stuckDist) {
        st.strafeDir.set(Math.random() - 0.5, Math.random() - 0.5).normalize();
        st.strafeUntil = this.time.now + CONFIG.ai.strafeMs;
      }
      st.lastPos.set(c.x, c.y);
    }

    st.decideIn -= delta;
    if (st.decideIn <= 0) {
      st.decideIn = CONFIG.ai.chaserThinkMs;
      const free = this.runners.filter((r) => !this.rState.get(r)!.frozen);
      const target = this.nearestOf(free, c);
      if (target) {
        // lead the target slightly — aim where they're going
        const tv = (target.body as Body).velocity;
        const lead = new Phaser.Math.Vector2(target.x + tv.x * 0.18 - c.x, target.y + tv.y * 0.18 - c.y).normalize();
        const strafing = this.time.now < st.strafeUntil;
        const dir = strafing
          ? lead.clone().add(st.strafeDir.clone().scale(1.2)).normalize()
          : lead;
        const steered = this.steer(c, dir);
        const speed =
          (this.time.now < st.dashUntil ? this.chaserSpeed * dash.mult : this.chaserSpeed) *
          st.speedMult *
          (this.time.now < (st.rageUntil ?? 0) ? 1.7 : 1);
        st.desired.set(steered.x * speed, steered.y * speed);
      } else {
        st.desired.set(0, 0);
      }
    }

    // rain makes everyone slide — militia included
    const body = c.body as Body;
    if (this.time.now < this.slipperyUntil) {
      const k = Math.min(1, 3 * (delta / 1000));
      body.velocity.x += (st.desired.x - body.velocity.x) * k;
      body.velocity.y += (st.desired.y - body.velocity.y) * k;
    } else {
      body.setVelocity(st.desired.x, st.desired.y);
    }
    this.beanAnim(c, st.sheet, body.velocity.x, body.velocity.lengthSq());
  }

  /** Militia chatter — a Pidgin bark floats up from a chaser */
  private bark(c: Sprite, kind: BarkKind) {
    const lines = CONFIG.barks[kind] as readonly string[];
    const line = lines[Math.floor(Math.random() * lines.length)];
    this.floatText(c.x, c.y - 22, line, '#e84848');
    sfx.voice(line);
  }

  private barkNear(runner: Sprite, kind: BarkKind, chance = 0.5) {
    const c = this.nearestOf(this.chasers, runner);
    if (c && Math.random() < chance) this.bark(c, kind);
  }

  /** Smart runners drift toward loose items. Returns true if aiDir was set. */
  private seekItem(r: Sprite, st: RunnerState): boolean {
    const items = this.itemGroup.getChildren() as Sprite[];
    const item = this.nearestOf(items, r);
    if (!item) return false;
    st.aiDir.set(item.x - r.x, item.y - r.y).normalize();
    return true;
  }

  private steer(sprite: Sprite, dir: Phaser.Math.Vector2): Phaser.Math.Vector2 {
    const ahead = CONFIG.ai.probeAhead;
    if (!this.blocked(sprite.x + dir.x * ahead, sprite.y + dir.y * ahead)) return dir;
    for (let i = 1; i <= 4; i++) {
      for (const sign of [1, -1]) {
        const rotated = dir.clone().rotate((i * Math.PI * sign) / 4);
        if (!this.blocked(sprite.x + rotated.x * ahead, sprite.y + rotated.y * ahead)) {
          return rotated;
        }
      }
    }
    return dir.clone().negate();
  }

  private blocked(x: number, y: number): boolean {
    const { arena } = CONFIG;
    const m = arena.wall + 16;
    if (x < m || x > this.arenaW - m || y < m || y > this.arenaH - m) return true;
    return this.obstacleRects
      .some((r) =>
        Phaser.Geom.Rectangle.Contains(
          new Phaser.Geom.Rectangle(r.x - 16, r.y - 16, r.width + 32, r.height + 32),
          x,
          y,
        ),
      );
  }

  private nearestOf(list: Sprite[], from: Sprite): Sprite | null {
    let best: Sprite | null = null;
    let bestD = Infinity;
    for (const s of list) {
      const d = Phaser.Math.Distance.Between(from.x, from.y, s.x, s.y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private resolveThaws() {
    for (const frozen of this.runners) {
      if (!this.rState.get(frozen)!.frozen) continue;
      for (const free of this.runners) {
        const st = this.rState.get(free)!;
        if (free === frozen || st.frozen) continue;
        if (
          Phaser.Math.Distance.Between(frozen.x, frozen.y, free.x, free.y) <=
          CONFIG.thawRange + CONFIG.runner.radius
        ) {
          this.thaw(frozen, free);
          break;
        }
      }
    }
  }

  private aiUseWater() {
    for (const r of this.runners) {
      const st = this.rState.get(r)!;
      if (st.isPlayer || st.frozen || st.water <= 0) continue;
      const frozen = this.nearestOf(
        this.runners.filter((o) => this.rState.get(o)!.frozen),
        r,
      );
      if (
        frozen &&
        Phaser.Math.Distance.Between(r.x, r.y, frozen.x, frozen.y) <= CONFIG.items.water.thawRange
      ) {
        st.water--;
        this.thaw(frozen, r);
      }
    }
  }

  private useItem(runner: Sprite) {
    const st = this.rState.get(runner)!;
    if (st.frozen) {
      if (st.isPlayer) this.cryForHelp(); // E / H2O while frozen = shout for the crew
      return;
    }
    if (st.water <= 0) return;

    // pure water — thaw the nearest frozen mate from range
    const frozen = this.nearestOf(
      this.runners.filter((o) => this.rState.get(o)!.frozen),
      runner,
    );
    if (
      frozen &&
      Phaser.Math.Distance.Between(runner.x, runner.y, frozen.x, frozen.y) <=
        CONFIG.items.water.thawRange
    ) {
      st.water--;
      this.thaw(frozen, runner);
    }
  }

  /** Shout for the crew — brave mates (rescue >= .5) run to you even under
   * pressure for ~5s. Cowards (Emeka .25) keep their distance. */
  private cryForHelp() {
    const now = this.time.now;
    if (now < this.helpUntil - 2000) return; // already screaming
    this.helpUntil = now + 5200;
    this.floatText(this.player.x, this.player.y - 32, 'COME SAVE ME!', '#7dd0ff');
    this.burst(this.player.x, this.player.y, 0x7dd0ff, 14, 140);

    // one brave mate answers out loud with the recorded voice
    const savior = this.runners.find((r) => {
      const s = this.rState.get(r)!;
      return !s.isPlayer && !s.frozen && (s.personality?.rescue ?? 0) >= 0.5;
    });
    if (savior) {
      this.time.delayedCall(650, () => {
        this.floatText(savior.x, savior.y - 24, 'I dey come o!', '#7dd0ff');
        sfx.voice('I dey come o!');
      });
    }
  }

  /** Vignette + heartbeat when a militia is closing on the player */
  private updateDanger() {
    const st = this.rState.get(this.player)!;
    const chaser = this.nearestOf(this.chasers, this.player);
    const dist = chaser
      ? Phaser.Math.Distance.Between(this.player.x, this.player.y, chaser.x, chaser.y)
      : Infinity;

    const { radius, minMs, maxMs } = CONFIG.heartbeat;
    const danger = st.frozen ? 1 : Phaser.Math.Clamp(1 - (dist - 60) / (radius - 60), 0, 1);
    this.vignette.setAlpha(danger * 0.75);

    if (danger > 0.25 && this.time.now >= this.nextThumpAt) {
      sfx.thump();
      this.nextThumpAt = this.time.now + Phaser.Math.Linear(maxMs, minMs, danger);
    }
  }

  private checkWin() {
    if (this.runners.every((r) => this.rState.get(r)!.frozen)) this.endGame(true);
  }

  private announce(msg: string, ms = 1700) {
    this.showBanner('', msg);
    sfx.voice(msg.split('—')[0].trim()); // "NEPA DON TAKE LIGHT!" not the explainer
    this.time.delayedCall(ms, () => this.clearBanner());
  }

  // ---------- random events ----------

  private updateEvents(dt: number) {
    if (!this.eventsEnabled) return;
    const now = this.time.now;

    // storm mutator — the sky keeps opening up all round
    if (this.mutator === 'storm' && now >= this.nextStormAt) {
      this.nextStormAt = now + 20000;
      this.startRain();
    }

    // NEPA blackout ends
    if (this.nepaUntil > 0 && now >= this.nepaUntil) this.endNepa();

    // bus rolls through
    if (this.bus) {
      if (this.bus.x > this.arenaW + 90 || this.bus.x < -90) {
        this.busCollider?.destroy();
        this.bus.destroy();
        this.bus = null;
      }
    }

    if (now < this.nextEventAt) return;
    this.nextEventAt =
      now + Phaser.Math.Between(CONFIG.events.delayMs.min, CONFIG.events.delayMs.max);

    const pool: EventKind[] = (['danfo', 'nepa', 'rain'] as EventKind[]).filter(
      // dusk already owns the dark — NEPA has nothing left to take
      (e) => e !== this.lastEvent && !(e === 'nepa' && this.duskMode),
    );
    const kind = Phaser.Utils.Array.GetRandom(pool);
    this.lastEvent = kind;

    if (kind === 'danfo') this.spawnDanfo();
    else if (kind === 'nepa') this.startNepa();
    else this.startRain();
  }

  private spawnDanfo() {
    const { arena, events } = CONFIG;
    const y = Phaser.Math.Between(arena.wall + 80, this.arenaH - arena.wall - 80);
    const fromLeft = Math.random() < 0.5;
    const bus = this.lit(
      this.physics.add.sprite(fromLeft ? -80 : this.arenaW + 80, y, 'bus'),
    ) as Sprite;
    bus.setFlipX(!fromLeft);
    bus.setDepth(3);
    const body = bus.body as Body;
    body.setImmovable(true);
    body.setSize(146, 56);
    body.setVelocityX(events.danfo.speed * (fromLeft ? 1 : -1));
    this.bus = bus;

    const group = [...this.runners, ...this.chasers];
    this.busCollider = this.physics.add.collider(bus, group);

    sfx.honk();
    this.announce('DANFO!');
  }

  private startNepa() {
    const now = this.time.now;
    this.nepaUntil = now + CONFIG.events.nepa.durationMs;
    sfx.powerDown();

    // flicker before it dies
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 700,
      onUpdate: (tw) => {
        const v = tw.getValue() ?? 0;
        this.lights.setAmbientColor(v > 0.6 ? 0x16161c : 0xffffff);
      },
      onComplete: () => {
        this.lights.setAmbientColor(0x16161c);
        // spotlight on the player, faint glints on the militia
        this.playerLight = this.lights.addLight(
          this.player.x,
          this.player.y,
          CONFIG.events.nepa.lightRadius,
          0xffe9b0,
          2.2,
        );
        this.chaserLights = this.chasers.map((c) =>
          this.lights.addLight(c.x, c.y, 70, 0xff4040, 0.8),
        );
      },
    });
    this.announce('NEPA DON TAKE LIGHT!');
  }

  private endNepa() {
    this.nepaUntil = 0;
    sfx.powerUp();
    this.lights.setAmbientColor(0xffffff);
    if (this.playerLight) {
      this.lights.removeLight(this.playerLight);
      this.playerLight = null;
    }
    for (const l of this.chaserLights) this.lights.removeLight(l);
    this.chaserLights = [];
    this.announce('UP NEPA!');
  }

  private startRain() {
    const { arena, events } = CONFIG;
    this.slipperyUntil = this.time.now + events.rain.durationMs;
    sfx.rain();

    const em = this.add.particles(0, -20, 'dot', {
      x: { min: 0, max: this.arenaW },
      y: -20,
      speedY: { min: 420, max: 560 },
      speedX: { min: -60, max: -20 },
      scale: { start: 0.7, end: 0.4 },
      alpha: 0.5,
      tint: 0x7fb8e0,
      lifespan: 3400, // world is tall now — drops need to reach the ground
      frequency: 8,
      quantity: 2,
    });
    em.setDepth(16);
    this.time.delayedCall(events.rain.durationMs, () => em.destroy());

    this.announce('RAIN — watch your footing!');
  }

  /** the player's inherited champion skill — F key, 14s cooldown.
   *  summon → a backup mate drops beside you and pulls the militia's eyes
   *  rage   → your own burst: 1.5x speed for 3.2s
   *  blink  → dash-teleport ~230px along the held direction */
  private useSkill() {
    const move = this.playerMove;
    if (!move || this.phase !== 'play' || this.time.now < this.moveReadyAt) return;
    const st = this.rState.get(this.player);
    if (!st || st.frozen) return;
    this.moveReadyAt = this.time.now + 14000;
    sfx.pickup();

    if (move === 'summon') {
      this.floatText(this.player.x, this.player.y - 40, 'BACKUP!', '#7df2a8');
      this.spawnBackup();
    } else if (move === 'rage') {
      st.skillUntil = this.time.now + 3200;
      this.player.setTint(0xffd54f);
      this.time.delayedCall(3200, () => this.player.active && this.player.clearTint());
      this.floatText(this.player.x, this.player.y - 40, 'RAGE!', '#ffd54f');
    } else {
      // blink — same violet materialize as the bosses', along your heading
      const d = this.lastDir.lengthSq() > 0 ? this.lastDir : new Phaser.Math.Vector2(1, 0);
      const nx = Phaser.Math.Clamp(this.player.x + d.x * 230, 60, this.arenaW - 60);
      const ny = Phaser.Math.Clamp(this.player.y + d.y * 230, 60, this.arenaH - 60);
      this.burst(this.player.x, this.player.y, 0xc4b5fd, 14, 200);
      this.player.setPosition(nx, ny);
      (this.player.body as Body).velocity.set(0, 0);
      this.burst(nx, ny, 0xc4b5fd, 14, 200);
      this.floatText(nx, ny - 30, 'BLINK!', '#c4b5fd');
    }
  }

  private spawnBackup() {
    this.removeBackup(); // one helper at a time
    const r = this.physics.add.sprite(
      Phaser.Math.Clamp(this.player.x + 44, 60, this.arenaW - 60),
      Phaser.Math.Clamp(this.player.y + 8, 60, this.arenaH - 60),
      this.sheetCrew ?? 'runner',
    );
    this.dressBean(r, this.sheetCrew);
    this.runners.push(r);
    const st = this.freshRunner(r, 'BACKUP', null);
    st.sheet = this.sheetCrew ?? undefined;
    st.backupUntil = this.time.now + 12000; // peels off after 12s
    this.rState.set(r, st);
    if (this.sheetCrew) r.play(this.sheetCrew + '-idle');
    this.collideWithWorld(r);
    this.burst(r.x, r.y, 0x7df2a8, 14, 200);
    this.backup = r;
  }

  private removeBackup() {
    const r = this.backup;
    if (!r) return;
    this.backup = undefined;
    this.tweens.add({
      targets: r,
      alpha: 0,
      duration: 300,
      onComplete: () => {
        this.runners = this.runners.filter((o) => o !== r);
        const st = this.rState.get(r);
        st?.shadow.destroy();
        st?.label.destroy();
        st?.iceBlock?.destroy();
        this.rState.delete(r);
        r.destroy();
      },
    });
  }

  /** milestone champions get a signature move — on a 16s cadence */
  private updateBoss() {
    const move = this.level?.bossMove;
    if (!move || this.phase !== 'play' || !this.chasers.length) return;
    if (this.time.now < this.nextBossMoveAt) return;
    this.nextBossMoveAt = this.time.now + 16000;

    const boss = this.chasers[0];
    const st = this.cState.get(boss);
    if (!st || !boss.active) return;

    if (move === 'summon') {
      this.floatText(boss.x, boss.y - 40, 'RALLY!', '#ffb0b0');
      this.addIceling(boss.x + 36, boss.y + 10);
    } else if (move === 'rage') {
      st.rageUntil = this.time.now + 3200;
      this.floatText(boss.x, boss.y - 40, 'RAGE!', '#ff5050');
      sfx.freeze();
    } else {
      // blink — warn flash, then materialize beside the player
      st.warnUntil = this.time.now + 650;
      this.time.delayedCall(650, () => {
        if (this.phase !== 'play' || !boss.active) return;
        const a = Math.random() * Math.PI * 2;
        const x = Phaser.Math.Clamp(
          this.player.x + Math.cos(a) * 260,
          80,
          this.arenaW - 80,
        );
        const y = Phaser.Math.Clamp(
          this.player.y + Math.sin(a) * 260,
          80,
          this.arenaH - 80,
        );
        this.burst(boss.x, boss.y, 0xc4b5fd, 14, 200);
        boss.setPosition(x, y);
        this.burst(x, y, 0xc4b5fd, 14, 200);
        st.noTagUntil = this.time.now + 500; // blink-in grace
        this.floatText(x, y - 30, 'BEHIND YOU!', '#c4b5fd');
      });
    }
  }

  private updateNepaLights() {
    if (this.nepaUntil <= 0 && !this.duskMode) return;
    if (this.playerLight) this.playerLight.setPosition(this.player.x, this.player.y);
    this.chasers.forEach((c, i) => {
      const l = this.chaserLights[i];
      if (l) l.setPosition(c.x, c.y);
    });
  }

  private endGame(militiaWon: boolean, timedOut = false) {
    this.phase = 'over';
    sfx.stopMusic();
    this.vignette.setAlpha(0);
    this.tweens.killTweensOf(this.countText);
    this.countText.setText('').setAlpha(1).setScale(1);

    for (const s of [...this.runners, ...this.chasers]) {
      (s.body as Body).setVelocity(0, 0);
      (s.body as Body).moves = false;
    }

    const survived = Math.round(this.roundSeconds - Math.max(0, this.timeLeft));
    const rec = recordResult(!militiaWon, survived);
    this.lastResult = { won: !militiaWon, survived };
    const caught = 'Frozen';
    const stats = `${caught} ${this.playerFreezes}x  ·  Rescues ${this.playerRescues}  ·  ${survived}s survived`;
    // touch devices get tappable buttons instead of key hints in the sub-line
    const isTouch = TouchControls.isTouchDevice();

    // dim the field so the result reads clean — screen space
    const { width, height } = this.scale;
    const dim = this.pin(
      this.add.rectangle(0, 0, width * 3, height * 3, 0x081420, 0.6),
      0.5, 0.5,
    ).setDepth(18).setAlpha(0);
    this.tweens.add({ targets: dim, alpha: 1, duration: 400 });

    // the FG ribbon gets the first beat; the detail banner + pills land after it
    const landResult = (main: string, sub: string, won: boolean) => {
      this.time.delayedCall(REDUCED_MOTION ? 950 : 1450, () => {
        this.showBanner(main, sub);
        this.showEndButtons(won);
      });
    };

    if (militiaWon) {
      sfx.lose();
      this.playResultRibbon(false, timedOut);
      landResult(
        this.level
          ? `LEVEL ${this.level.n} — ${timedOut ? 'OUT OF TIME' : 'CAUGHT'}`
          : 'MILITIA WINS',
        this.level
          ? `${stats}${isTouch ? '' : '\nR — retry   T — the road'}`
          : `${stats}\nstreak ${rec.streak} · best ${rec.bestSurvived}s${isTouch ? '' : '\nR / SPACE — run it back   T — title   S — share'}`,
        false,
      );
      this.shake(250, 0.01);
    } else {
      sfx.win();
      let stars = 0;
      if (this.level) {
        // ★ survive · ★★ at most one freeze · ★★★ untouched
        stars = this.playerFreezes === 0 ? 3 : this.playerFreezes === 1 ? 2 : 1;
        recordLevel(this.level.n, stars as 1 | 2 | 3);
        submitAdventureScore();
      }
      const finalLevel = this.level?.n === TOTAL_LEVELS;
      const sub = this.level
        ? `${stats}${finalLevel ? '\nyou ran the whole of Nigeria — legend' : ''}${
            isTouch ? '' : finalLevel ? '\nT — the road' : '\nSPACE — on to the next stop   T — the road'
          }`
        : `${stats}\nwin streak ${rec.streak} 🔥 · best ${rec.bestSurvived}s${isTouch ? '' : '\nR / SPACE — play again   T — title   S — share'}`;
      this.playResultRibbon(true, false);
      landResult(
        finalLevel
          ? 'JOURNEY COMPLETE!'
          : this.level
            ? `LEVEL ${this.level.n} CLEAR ${'★'.repeat(stars)}`
            : 'RUNNERS WIN!',
        sub,
        true,
      );
      for (let i = 0; i < 3; i++) {
        this.time.delayedCall(i * 180, () =>
          this.burst(
            this.player.x + Phaser.Math.Between(-60, 60),
            this.player.y + Phaser.Math.Between(-60, 60),
            [0xffd54a, 0x4ecb71, 0x4dd0e1][i],
            18,
            260,
          ),
        );
      }
    }
    this.touch?.setActive(false); // pads off — the dashboard owns the taps now
  }

  /** screen-space hit test for dashboard pills — reliable on real touch hardware */
  private onEndTap(p: Phaser.Input.Pointer) {
    if (this.phase !== 'over') return;
    const w = this.scale.width;
    const h = this.scale.height;
    for (const b of this.endHitZones) {
      const sx = b.ax * w + b.ox;
      const sy = b.ay * h + b.oy;
      if (Math.abs(p.x - sx) <= b.bw / 2 + 8 && Math.abs(p.y - sy) <= b.bh / 2 + 8) {
        b.go();
        return;
      }
    }
  }

  /** same manual hit test for the pause menu's pills */
  private onPauseTap(p: Phaser.Input.Pointer) {
    if (!this.paused) return;
    const w = this.scale.width;
    const h = this.scale.height;
    for (const b of this.pauseHitZones) {
      const sx = b.ax * w + b.ox;
      const sy = b.ay * h + b.oy;
      if (Math.abs(p.x - sx) <= b.bw / 2 + 8 && Math.abs(p.y - sy) <= b.bh / 2 + 8) {
        b.go();
        return;
      }
    }
  }

  // ---------- pause — single-player only; net play never freezes ----------

  private togglePause() {
    if (this.phase === 'over' || this.transitioning || this.paused) return;
    this.paused = true;
    this.touch?.setActive(false); // pads off — the menu owns the taps
    this.physics.pause();
    this.time.paused = true; // freezes the event clock — no bus/NEPA/rain mid-pause
    this.tweens.pauseAll(); // entity anims freeze; menu tweens added after are unaffected
    this.buildPauseMenu();
  }

  private resume() {
    if (!this.paused) return;
    const gone = new Set<unknown>(this.pauseObjs);
    for (const o of this.pauseObjs) o.destroy();
    this.pauseObjs = [];
    this.pauseHitZones = [];
    this.hudItems = this.hudItems.filter((it) => !gone.has(it.obj));
    this.paused = false;
    this.physics.resume();
    this.time.paused = false;
    this.tweens.resumeAll();
    this.touch?.setActive(true);
  }

  /** pause card — a menu, so paper card + candy pills (unlike the banner-only result) */
  private buildPauseMenu() {
    const W = 330;
    const H = 340;
    const cy = -10;
    const track = <T extends HudItem['obj']>(o: T, ax = 0.5, ay = 0.5, ox = 0, oy = 0): T => {
      this.pin(o, ax, ay, ox, oy);
      this.pauseObjs.push(o as unknown as { destroy: () => void });
      return o;
    };

    const dim = this.add.graphics().setDepth(40);
    dim.fillStyle(0x0a1420, 0.62).fillRect(-1600, -1200, 3200, 2400);
    track(dim);
    track(panel(this, -W / 2, cy - H / 2, W, H, { depth: 41 }), 0.5, 0.5, 0, 0);

    track(
      this.add
        .text(0, 0, 'PAUSED', {
          fontFamily: DISPLAY_FONT,
          fontSize: '30px',
          color: '#e84393',
        })
        .setOrigin(0.5)
        .setDepth(42)
        .setShadow(0, 4, '#9c2160', 0, true, false),
      0.5, 0.5, 0, cy - H / 2 + 46,
    );
    track(
      this.add
        .text(0, 0, 'take a breather — the militia can wait', {
          fontFamily: UI_FONT,
          fontSize: '12px',
          fontStyle: '600',
          color: '#7a8a99',
        })
        .setOrigin(0.5)
        .setDepth(42),
      0.5, 0.5, 0, cy - H / 2 + 72,
    );

    const bw = 210;
    const bh = 46;
    const lip = 6;
    const pill = (
      oy: number,
      label: string,
      fill: number,
      go: () => void,
      inkText = true,
    ) => {
      const c = this.add.container(0, 0).setDepth(42);
      const g = this.add.graphics();
      g.fillStyle(shade(fill, -38), 1).fillRoundedRect(-bw / 2, -bh / 2 - 2, bw, bh, bh / 2);
      g.fillStyle(fill, 1).fillRoundedRect(-bw / 2, -bh / 2 - lip, bw, bh - 2, bh / 2);
      g.fillStyle(0xffffff, 0.2).fillRoundedRect(-bw / 2 + 7, -bh / 2 - lip + 4, bw - 14, bh * 0.34, bh / 4);
      const t = this.add
        .text(0, -lip / 2 - 1, label, {
          fontFamily: DISPLAY_FONT,
          fontSize: '15px',
          color: inkText ? '#1c1626' : '#f5efe0',
        })
        .setOrigin(0.5);
      c.add([g, t]);
      track(c, 0.5, 0.5, 0, oy);
      this.pauseHitZones.push({ ax: 0.5, ay: 0.5, ox: 0, oy, bw, bh, go });
    };

    pill(cy - 34, 'RESUME', UI.danfo, () => this.resume());
    pill(cy + 22, 'RESTART', 0x29b6f6, () => {
      this.resume();
      this.transitionTo('game', true);
    }, false);
    pill(cy + 78, this.level ? 'QUIT — THE ROAD' : 'QUIT — TITLE', UI.ink, () => {
      this.resume();
      this.transitionTo(this.level ? 'adventure' : 'title');
    }, false);

    // sound toggle — a live chip reflecting sfx mute state
    const sg = this.add.graphics().setDepth(42);
    const st = this.add
      .text(0, -1, '', { fontFamily: DISPLAY_FONT, fontSize: '13px', color: '#ffffff' })
      .setOrigin(0.5)
      .setDepth(42);
    const sw = 130;
    const sh = 32;
    const soy = cy + 128;
    const drawSound = () => {
      const on = !sfx.isMuted;
      sg.clear();
      sg.fillStyle(0x0a0710, 1).fillRoundedRect(-sw / 2, -sh / 2 + 2, sw, sh, sh / 2);
      sg.fillStyle(on ? 0x29b6f6 : 0x5a7184, 1).fillRoundedRect(-sw / 2, -sh / 2 - 2, sw, sh - 2, sh / 2);
      sg.fillStyle(0xffffff, 0.18).fillRoundedRect(-sw / 2 + 6, -sh / 2 - 2 + 3, sw - 12, sh * 0.32, sh / 4);
      st.setText(on ? 'SOUND ON' : 'SOUND OFF');
    };
    drawSound();
    track(sg, 0.5, 0.5, 0, soy);
    track(st, 0.5, 0.5, 0, soy - 2);
    this.pauseHitZones.push({ ax: 0.5, ay: 0.5, ox: 0, oy: soy, bw: sw, bh: sh, go: () => { sfx.toggleMute(); drawSound(); } });

    track(
      this.add
        .text(0, 0, 'esc — resume', { fontFamily: UI_FONT, fontSize: '11px', fontStyle: '600', color: '#b9c4cf' })
        .setOrigin(1, 1)
        .setDepth(42),
      0.5, 0.5, W / 2 - 16, cy + H / 2 - 14,
    );
    this.relayout(); // pinned post-create — place everything now
  }

  /** touch-first result dashboard — big tappable pills under the banner */
  private showEndButtons(won: boolean) {
    this.hudItems = this.hudItems.filter((it) => !this.endButtons.includes(it.obj as Phaser.GameObjects.Container));
    for (const c of this.endButtons) c.destroy();
    this.endButtons = [];
    this.endHitZones = [];
    // no result card — the banner + pills float over the dimmed field,
    // like Fall Guys' ELIMINATED/QUALIFIED screens. Banner keeps its
    // pink signature; the sub-line stays white-on-dark for the dim.
    this.bannerText.setShadow(0, 0, '#000000', 0, false, false);
    this.subBannerText.setColor('#f5efe0').setStroke('#081420', 5);
    const L = this.level;
    const canNext = !!L && won && L.n < TOTAL_LEVELS;
    const acts: { label: string; short?: string; fill: number; inkText?: boolean; go: () => void }[] = [];
    if (canNext) {
      acts.push({
        label: 'NEXT MISSION ▶',
        short: 'NEXT ▶',
        fill: UI.leaf,
        inkText: true,
        go: () => this.transitionToNextLevel(),
      });
    } else {
      acts.push({
        label: won ? 'PLAY AGAIN' : 'RETRY',
        fill: won ? UI.leaf : UI.danger,
        inkText: won,
        go: () => this.transitionTo('game', true),
      });
    }
    // always offer the road — classic players should funnel into the campaign
    acts.push({
      label: 'THE ROAD',
      fill: UI.danfo,
      inkText: true,
      go: () => this.transitionTo('adventure'),
    });
    acts.push({ label: 'SHARE', fill: UI.ink, go: () => this.shareScore(false) });

    // fit the row inside the viewport; shrink pills before they'd clip
    const gap = 12;
    const bw = Phaser.Math.Clamp((this.scale.width - 60 - gap * (acts.length - 1)) / acts.length, 104, 190);
    const bh = 50;
    const lip = 7;
    const total = acts.length * bw + gap * (acts.length - 1);
    acts.forEach((b, i) => {
      const ox = -total / 2 + i * (bw + gap) + bw / 2;
      const c = this.add.container(0, 0).setDepth(21).setAlpha(0);
      const g = this.add.graphics();
      // lip + candy body + sheen — same language as the menu pills
      g.fillStyle(shade(b.fill, -38), 1).fillRoundedRect(-bw / 2, -bh / 2 - 2, bw, bh, bh / 2);
      g.fillStyle(b.fill, 1).fillRoundedRect(-bw / 2, -bh / 2 - lip, bw, bh - 2, bh / 2);
      g.fillStyle(0xffffff, 0.2).fillRoundedRect(-bw / 2 + 7, -bh / 2 - lip + 4, bw - 14, bh * 0.34, bh / 4);
      const t = this.add
        .text(0, -lip / 2 - 1, bw < 150 && b.short ? b.short : b.label, {
          fontFamily: DISPLAY_FONT,
          fontSize: bw < 150 ? '13px' : '15px',
          color: b.inkText ? '#1c1626' : '#f5efe0',
        })
        .setOrigin(0.5);
      c.add([g, t]);
      this.pin(c, 0.5, 0.5, ox, 128);
      this.endButtons.push(c);
      this.endHitZones.push({ ax: 0.5, ay: 0.5, ox, oy: 128, bw, bh, go: b.go });
      this.tweens.add({ targets: c, alpha: 1, duration: 350, delay: 320 + i * 90 });
    });
    this.relayout(); // pinned post-create — place them now, not on next resize
  }

  /** S = share on X (or native share sheet on mobile), M = WhatsApp */
  private shareScore(whatsapp: boolean) {
    if (!this.lastResult) return;
    const { won, survived } = this.lastResult;
    const where = this.level ? `level ${this.level.n} of the adventure` : `${this.diff.label} — ICE & WATER`;
    const text = won
      ? `My crew survived ${survived}s on ${where} in ICE 'N' WATER 🔥 Think you can do better?`
      : `The militia got us after ${survived}s on ${where} in ICE 'N' WATER. Out for revenge 😤`;

    if (whatsapp) {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
      return;
    }
    if ('share' in navigator) {
      void navigator.share({ title: "Ice 'N' Water", text }).catch(() => {});
    } else {
      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
        '_blank',
      );
    }
  }

  private updateHud() {
    const st = this.rState.get(this.player)!;
    const frozenCount = this.runners.filter((r) => this.rState.get(r)!.frozen).length;

    const secs = Math.max(0, Math.ceil(this.timeLeft));
    if (secs !== this.lastShownSec) {
      this.lastShownSec = secs;
      this.timeText.setText(
        `TIME ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
      );
      if (secs <= 10) {
        this.timeText.setColor('#d63a4a');
        this.tweens.add({ targets: this.timeText, scale: 1.3, duration: 110, yoyo: true });
      }
    }
    const lvl = this.level ? `LVL ${this.level.n} · ` : '';
    this.infoText.setText(
      this.huntMode
        ? `${lvl}TARGETS ${this.runners.length - frozenCount - 1} free · ${frozenCount} caught`
        : `${lvl}CREW ${this.runners.length - frozenCount} free${frozenCount ? ` · ${frozenCount} frozen` : ''}`,
    );

    if (this.level) {
      const o = this.level.objective;
      if (this.collectPhase2) {
        this.objText.setText(`${this.level.name} · REACH THE GOLD RING!`);
      } else {
        const prog =
          o.kind === 'collect'
            ? ` · ${this.objGot}/${o.count}`
            : o.kind === 'rescue'
              ? ` · ${this.playerRescues}/${o.count}`
              : o.kind === 'refuge'
                ? ` · ring ${(this.refugeMs / 1000).toFixed(0)}s`
                : o.kind === 'hunt'
                  ? ` · tagged ${this.objGot}/${o.count}`
                  : '';
        this.objText.setText(
          `${this.level.name}${this.level.boss ? ' — ' + this.level.boss : ''} · ${objectiveText(this.level)}${prog}${this.mutator ? ' · ' + MUT_LABEL[this.mutator] : ''}`,
        );
      }
    }

    this.teamDots.forEach((dot, i) => {
      const r = this.runners[i];
      if (!r) return;
      const s = this.rState.get(r)!;
      dot.setTint(
        s.frozen ? CONFIG.colors.frozen : s.isPlayer ? CONFIG.colors.player : CONFIG.colors.runner,
      );
    });

    const held: string[] = [];
    if (this.time.now < st.slipperUntil) {
      held.push(`SLIPPERS ${((st.slipperUntil - this.time.now) / 1000).toFixed(0)}s`);
    }
    if (st.charm) held.push('JUJU CHARM');
    if (st.water > 0) {
      held.push(`WATER x${st.water} (E)`);
    }
    if (this.playerMove) {
      const cd = Math.ceil((this.moveReadyAt - this.time.now) / 1000);
      held.push(cd > 0 ? `${this.playerMove.toUpperCase()} ${cd}s` : `${this.playerMove.toUpperCase()} (F)`);
    }
    this.itemText.setText(held.join('  |  '));

    // "last one standing" adrenaline callout
    const lastFree = this.isLastFree(st) && this.runners.length > 1;
    if (lastFree && !this.adrenalineOn) {
      this.adrenalineOn = true;
      this.floatText(this.player.x, this.player.y - 20, 'LAST ONE STANDING!', '#e84848');
    } else if (!lastFree) {
      this.adrenalineOn = false;
    }

    // stamina bar under the player
    this.staminaGfx.clear();
    if (!st.frozen) {
      const w = 34;
      this.staminaGfx.fillStyle(0x000000, 0.35);
      this.staminaGfx.fillRect(this.player.x - w / 2, this.player.y + 22, w, 5);
      this.staminaGfx.fillStyle(st.sprinting ? 0xffd54a : 0x4ecb71, 1);
      this.staminaGfx.fillRect(this.player.x - w / 2, this.player.y + 22, w * st.stamina, 5);
    }
  }

  /** visuals that run every frame regardless of phase: shadows, facing, bob, fx emitters */
  private updatePresentation(delta: number) {
    const dt = delta / 1000;
    const t = this.time.now;

    const present = (
      s: Sprite,
      st: {
        frozen?: boolean;
        shadow?: Phaser.GameObjects.Sprite;
        bobPhase?: number;
        iceBlock?: Phaser.GameObjects.Sprite | null;
      },
    ) => {
      const body = s.body as Body;
      if (st.shadow) st.shadow.setPosition(s.x, s.y + CONFIG.runner.radius + 2);
      s.setDepth(2 + s.y * 0.002);
      const speed = Math.hypot(body.velocity.x, body.velocity.y);
      if (!st.frozen && speed > 12) {
        const target = Math.atan2(body.velocity.y, body.velocity.x);
        s.rotation = Phaser.Math.Angle.RotateTo(s.rotation, target, 9 * dt);
        const bob = st.bobPhase !== undefined ? 1 + Math.sin(t / 70 + st.bobPhase) * 0.045 : 1;
        s.setScale(bob);
      } else if (!st.frozen) {
        s.setScale(1);
      }
      if (st.iceBlock) st.iceBlock.setPosition(s.x, s.y);
    };

    for (const r of this.runners) {
      const st = this.rState.get(r)!;
      present(r, st);
      this.emitMoveFx(r, st, delta);
      st.label.setPosition(r.x, r.y - 24);
      st.label.setAlpha(st.frozen ? 0.4 : 1);
      // immune blink
      if (!st.frozen && t < st.immuneUntil) {
        r.setAlpha(Math.floor(t / 90) % 2 === 0 ? 0.45 : 1);
      } else if (!st.frozen && r.alpha !== 1) {
        r.setAlpha(1);
      }
    }
    for (const c of this.chasers) {
      present(c, this.cState.get(c)!);
    }
    this.drawMinimap();
  }

  private emitMoveFx(r: Sprite, st: RunnerState, delta: number) {
    if (st.frozen) return;
    const body = r.body as Body;
    const speed = Math.hypot(body.velocity.x, body.velocity.y);
    if (speed < 40) return;

    // sprint dust
    if (st.sprinting || speed > CONFIG.runner.speed * 1.15) {
      st.dustIn -= delta;
      if (st.dustIn <= 0) {
        st.dustIn = 90;
        const puff = this.add
          .sprite(r.x - body.velocity.x * 0.04, r.y - body.velocity.y * 0.04 + 8, 'dust')
          .setDepth(1.4)
          .setAlpha(0.7);
        this.tweens.add({
          targets: puff,
          alpha: 0,
          scale: 2,
          duration: 350,
          onComplete: () => puff.destroy(),
        });
      }
    }

    // lucky slipper trail
    if (this.time.now < st.slipperUntil) {
      st.trailIn -= delta;
      if (st.trailIn <= 0) {
        st.trailIn = 70;
        const dot = this.add
          .sprite(r.x, r.y + 10, 'dot')
          .setTint(CONFIG.colors.slippers)
          .setDepth(1.4)
          .setAlpha(0.9);
        this.tweens.add({
          targets: dot,
          alpha: 0,
          duration: 320,
          onComplete: () => dot.destroy(),
        });
      }
    }
  }
}
