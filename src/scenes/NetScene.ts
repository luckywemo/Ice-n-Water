import Phaser from 'phaser';
import { Client, Room, getStateCallbacks } from '@colyseus/sdk';
import { SERVER_URL } from '../net';
import { CONFIG } from '../config';
import { makeTextures } from '../art';
import { Sfx } from '../audio';
import { DISPLAY_FONT, UI_FONT, UI, panel, popIn, pinHud, layoutHud, HudItem, shade, viewZoom, hudFactor } from '../ui';
import { TouchControls, keyHintsOn } from '../mobile';
import { loadPicks } from '../meta';
import { generateLayout } from '../mapgen';
import { viaWipe, wipeTo } from '../wipe';
import { PitchStage } from '../b3d/stage';
import { currentChar, CREW_DEF, MILITIA_DEF, type CharDef } from '../characters';
import { PALETTE } from '../b3d/bean';
import { bakeBeanSheet, sheetCanvas } from '../beanbake';

type Body = Phaser.Physics.Arcade.Body;

type NetPlayer = {
  name: string;
  team: string;
  x: number;
  y: number;
  angle: number;
  out: boolean;
};

type NetState = {
  mode: string;
  phase: string;
  host: string;
  round: number;
  timeLeft: number;
  intermissionLeft: number;
  iceScore: number;
  waterScore: number;
  message: string;
  winner: string;
  mapSeed: number;
  players: Map<string, NetPlayer>;
};

interface RemoteSprite {
  sprite: Phaser.Physics.Arcade.Sprite;
  label: Phaser.GameObjects.Text;
  ice?: Phaser.GameObjects.Image;
  entId: number;
  team: string;
  targetX: number;
  targetY: number;
  targetAngle: number;
}

/** stable per-player coat for remote runners — same faces every round */
const remoteIndex = (id: string) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % PALETTE.length;
};
const remoteModel = (id: string) => PALETTE[remoteIndex(id)];

const sfx = Sfx.inst;
const SEND_EVERY_MS = 66; // ~15 pos updates per second
const SPEED = 205;

/**
 * Online match — the server is authoritative for rules (tags, freezes,
 * team conversions, round wins). Clients report positions; everyone
 * renders remote players from state with lerp + team/frozen overlays.
 */
export class NetScene extends Phaser.Scene {
  private room!: Room<NetState>;
  private me!: Phaser.Physics.Arcade.Sprite;
  private meLabel!: Phaser.GameObjects.Text;
  private myTeam = 'water';
  private remotes = new Map<string, RemoteSprite>();
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private touch: TouchControls | null = null;
  private sendIn = 0;
  private wallBodies: Phaser.GameObjects.Rectangle[] = [];
  private obstacleGroup!: Phaser.Physics.Arcade.StaticGroup;
  private worldObstacleGroup!: Phaser.Physics.Arcade.StaticGroup;
  private obstacleRects: Phaser.Geom.Rectangle[] = [];
  private decor: Phaser.GameObjects.GameObject[] = [];
  private mapSeed = -1;
  private minimap!: Phaser.GameObjects.Graphics;
  private infoText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private myIce: Phaser.GameObjects.Image | null = null;
  private lastMessage = '';
  private lastRound = 0;
  private endedShown = false;
  private endLayer: Phaser.GameObjects.Container | null = null;
  // screen-space tap rects for the end screen — pinned-container children
  // miss input under the camera scroll, so taps are checked manually
  private endHit: { x: number; y: number; w: number; h: number; fn: () => void }[] = [];
  private net = new Client(SERVER_URL);
  private reconnToken = '';
  private leaving = false;
  private fromWipe = false; // arrived via wipeTo — the blade already revealed us
  private connText: Phaser.GameObjects.Text | null = null;
  private hudItems: HudItem[] = [];
  // 3D stage — the street world renders behind the HUD canvas
  private st3 = PitchStage.get();
  private myEnt = -1;
  private stObstacles: { x: number; y: number; r: number }[] = [];

  constructor() {
    super('net');
  }

  /** baked bean sheet → billboard payload for the stage (cached texture is global) */
  private bbFor(key: string, def: CharDef) {
    if (!bakeBeanSheet(this, key, def)) return undefined;
    return sheetCanvas(this, key);
  }

  private myBb() {
    if (this.myTeam === 'ice') return this.bbFor('bean-militia', MILITIA_DEF);
    const me = currentChar();
    return this.bbFor(`bean-you-net-${me.id}`, me);
  }

  private remoteBb(id: string, team: string) {
    if (team === 'ice') return this.bbFor('bean-militia', MILITIA_DEF);
    const i = remoteIndex(id);
    const m = PALETTE[i];
    return this.bbFor(`bean-pal-${i}`, { id: `pal-${i}`, skin: 0xf0d5a5, ...m });
  }

  init(data: { room: Room<NetState> }) {
    this.room = data.room;
    this.fromWipe = viaWipe(data);
  }

  create() {
    this.remotes.clear();
    this.wallBodies = [];
    this.obstacleRects = [];
    this.leaving = false;
    this.endedShown = false;
    this.myIce = null;
    this.reconnToken = this.room.reconnectionToken ?? '';
    this.room.onLeave((code) => {
      if (!this.leaving) void this.tryReconnect(code);
    });
    makeTextures(this);
    if (!this.fromWipe) this.cameras.main.fadeIn(250, 0, 0, 0);
    // 3D street owns the battlefield look; the sim keeps its pixel space
    this.st3.buildMap('street');
    this.st3.show();
    this.st3.clearEnts();
    this.st3.clearPickups();
    this.st3.clearProps();
    this.st3.resetOrbit();
    {
      const p = loadPicks();
      this.st3.setView(p.camView);
      this.st3.setRange(p.camRange);
      this.st3.setFacing(p.camFacing);
    }
    // the server simulates in the classic landscape arena — keep that pixel
    // space so positions line up, and stretch-map it onto the 3D pitch
    const stMap = this.st3.setPxSpace(CONFIG.arena.width, CONFIG.arena.height);
    this.stObstacles = stMap.obstacles;
    this.physics.world.setBounds(0, 0, CONFIG.arena.width, CONFIG.arena.height);
    this.buildArena();
    if (this.room.state.mapSeed) this.rebuildMap(this.room.state.mapSeed);

    // drag the right half (or any mouse drag) to orbit the follow-cam
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown || this.touch?.isJoyPointer(p)) return;
      if (p.wasTouch && p.downX < this.scale.width * 0.45) return;
      this.st3.orbit(p.velocity.x, p.velocity.y);
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) =>
      this.st3.zoomBy(dy),
    );

    const myId = this.room.sessionId;
    this.myTeam = this.room.state.players?.get(myId)?.team ?? 'water';

    // my sprite — ice hunts, water runs (invisible; the bean is the look)
    const myTex = this.myTeam === 'ice' ? 'chaser' : 'player';
    this.me = this.physics.add.sprite(
      CONFIG.arena.width / 2 + Phaser.Math.Between(-80, 80),
      CONFIG.arena.height / 2 + Phaser.Math.Between(-80, 80),
      myTex,
    );
    this.me.setVisible(false);
    this.myEnt = this.st3.spawnEnt(
      this.myTeam === 'ice' ? MILITIA_DEF : currentChar(),
      0xffc93c,
      this.me.x,
      this.me.y,
      this.myBb(),
    );
    (this.me.body as Body).setCircle(CONFIG.runner.radius + 2);
    (this.me.body as Body).setCollideWorldBounds(true);
    for (const w of this.wallBodies) this.physics.add.collider(this.me, w);
    this.physics.add.collider(this.me, this.obstacleGroup);

    // camera rides on you — the neighborhood is bigger than the screen
    this.cameras.main
      .setBounds(0, 0, CONFIG.arena.width, CONFIG.arena.height)
      .setZoom(viewZoom(this.scale.width, this.scale.height))
      .setDeadzone(CONFIG.camera.deadzone.w, CONFIG.camera.deadzone.h)
      .startFollow(this.me, true, 0.1, 0.1);

    this.meLabel = this.add
      .text(this.me.x, this.me.y - 26, 'YOU', {
        fontFamily: UI_FONT,
        fontSize: '11px',
        fontStyle: '600',
        color: '#ffffff',
        stroke: '#2b2115',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(8);

    this.bindRemotes();

    this.keys = this.input.keyboard!.addKeys(
      'W,A,S,D,SHIFT,UP,DOWN,LEFT,RIGHT,ESC',
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
    this.input.keyboard!.on('keydown-ESC', () => this.leave());

    this.touch = new TouchControls(this, { onWater: () => {}, onRestart: () => {} }, loadPicks().joy);

    // HUD — all pinned to the screen, not the world
    this.pin(panel(this, 14, 8, 400, 62), 0, 0);
    this.pin(
      this.add
        .text(0, 0, `${this.room.state.mode.toUpperCase()} — room ${this.room.roomId}`, {
          fontFamily: DISPLAY_FONT,
          fontSize: '15px',
          color: '#0f7fb8',
        })
        .setDepth(10),
      0, 0, 28, 14,
    );
    this.infoText = this.pin(
      this.add.text(0, 0, '', { fontFamily: UI_FONT, fontSize: '14px', fontStyle: '600', color: '#5a7184' }).setDepth(10),
      0, 0, 28, 40,
    );
    this.timeText = this.pin(
      this.add
        .text(0, 0, '', { fontFamily: DISPLAY_FONT, fontSize: '20px', color: '#1c2a3a' })
        .setOrigin(1, 0)
        .setDepth(10),
      0, 0, 396, 16,
    );
    this.scoreText = this.pin(
      this.add
        .text(0, 0, '', { fontFamily: UI_FONT, fontSize: '13px', fontStyle: '600', color: '#5a7184' })
        .setOrigin(1, 0)
        .setDepth(10),
      0, 0, 396, 44,
    );
    if (keyHintsOn())
      this.pin(
        this.add
          .text(0, 0, 'ice freezes water · mates thaw the frozen   ·   esc — leave', {
            fontFamily: UI_FONT,
            fontSize: '13px',
            color: '#4a3f2e',
          })
          .setOrigin(0.5, 1)
          .setDepth(10),
        0.5, 1, 0, -12,
      );
    this.minimap = this.pin(this.add.graphics().setDepth(26), 0, 0) as Phaser.GameObjects.Graphics;
    this.relayout();
    this.scale.on('resize', this.relayout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.relayout, this));
    // any exit drops the 3D layer — re-shown on the next match's create()
    this.events.once('shutdown', () => this.st3.hide());
    this.input.on('pointerdown', this.onEndTap, this);
    this.events.once('shutdown', () => this.input.off('pointerdown', this.onEndTap, this));

    sfx.ensure();
    sfx.whistle();
  }

  private pin<T extends HudItem['obj']>(obj: T, ax: number, ay: number, ox = 0, oy = 0): T {
    return pinHud(this.hudItems, obj, ax, ay, ox, oy) as T;
  }

  private unpin(obj: HudItem['obj']) {
    this.hudItems = this.hudItems.filter((i) => i.obj !== obj);
  }

  private relayout() {
    const w = this.scale.width;
    const h = this.scale.height;
    layoutHud(this.hudItems, w, h, viewZoom(w, h), hudFactor(w, h));
  }

  private buildArena() {
    const { arena, colors } = CONFIG;
    const { width, height, wall } = arena;
    // invisible physics walls — the 3D stage draws the real ground + walls
    const walls = [
      { x: width / 2, y: wall / 2, w: width, h: wall },
      { x: width / 2, y: height - wall / 2, w: width, h: wall },
      { x: wall / 2, y: height / 2, w: wall, h: height },
      { x: width - wall / 2, y: height / 2, w: wall, h: height },
    ];
    for (const r of walls) {
      const rect = this.add.rectangle(r.x, r.y, r.w, r.h, colors.wall);
      rect.setVisible(false);
      this.physics.add.existing(rect, true);
      this.wallBodies.push(rect);
    }
    this.obstacleGroup = this.physics.add.staticGroup();
    // the street's furniture is physical too — its own group so the round
    // rebuilds don't strip it
    this.worldObstacleGroup = this.physics.add.staticGroup();
    for (const wo of this.stObstacles) {
      const rect = this.add
        .rectangle(wo.x, wo.y, wo.r * 1.7, wo.r * 1.7, 0)
        .setVisible(false);
      this.worldObstacleGroup.add(rect);
    }
  }

  /** Server picked a new map seed — rebuild blocks + matching 3D cover. */
  private rebuildMap(seed: number) {
    this.mapSeed = seed;
    this.obstacleGroup.clear(true, true);
    for (const d of this.decor) d.destroy();
    this.decor = [];
    this.obstacleRects = [];
    this.st3.clearProps();
    for (const o of generateLayout(seed)) {
      const rect = this.add.rectangle(o.x, o.y, o.w, o.h, CONFIG.colors.obstacle);
      rect.setVisible(false);
      this.obstacleGroup.add(rect);
      this.obstacleRects.push(new Phaser.Geom.Rectangle(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h));
      this.st3.addProp(o.x, o.y, o.w, o.h);
    }
  }

  /** corner radar — everyone, colored by team */
  private drawMinimap() {
    const { arena } = CONFIG;
    const mw = 178;
    const mh = Math.round((mw * arena.height) / arena.width);
    const x0 = this.scale.width - mw - 10;
    const y0 = 44;
    const sx = mw / arena.width;
    const sy = mh / arena.height;
    const g = this.minimap;

    g.clear();
    g.fillStyle(UI.ink, 0.85);
    g.fillRoundedRect(x0 - 5, y0 - 5, mw + 10, mh + 10, 10);
    g.lineStyle(2, UI.rim, 0.5);
    g.strokeRoundedRect(x0 - 5, y0 - 5, mw + 10, mh + 10, 10);

    g.fillStyle(0x4a3f2e, 0.9);
    for (const r of this.obstacleRects) {
      g.fillRect(x0 + r.x * sx, y0 + r.y * sy, r.width * sx, r.height * sy);
    }

    const myId = this.room.sessionId;
    this.room.state.players?.forEach((p, id) => {
      if (id === myId) return;
      const color = p.team === 'ice' ? CONFIG.colors.chaser : p.out ? CONFIG.colors.frozen : CONFIG.colors.runner;
      g.fillStyle(color, 0.95);
      g.fillCircle(x0 + p.x * sx, y0 + p.y * sy, 2.4);
    });
    if (this.me) {
      g.fillStyle(0xffffff, 0.95);
      g.fillCircle(x0 + this.me.x * sx, y0 + this.me.y * sy, 3.4);
    }
  }

  update(_t: number, delta: number) {
    const dt = delta / 1000;
    const s = this.room.state;
    const myId = this.room.sessionId;
    const myState = s.players?.get(myId);
    const playing = s.phase === 'playing';
    const frozen = myState?.out ?? false;

    // ── new round → server dealt a new neighborhood ──────────
    if (s.mapSeed && s.mapSeed !== this.mapSeed) this.rebuildMap(s.mapSeed);

    // ── team conversion (infection) ──────────────────────────
    if (myState && myState.team && myState.team !== this.myTeam) {
      this.myTeam = myState.team;
      this.me.setTexture(this.myTeam === 'ice' ? 'chaser' : 'player');
      this.st3.removeEnt(this.myEnt);
      this.myEnt = this.st3.spawnEnt(
        this.myTeam === 'ice' ? MILITIA_DEF : currentChar(),
        0xffc93c,
        this.me.x,
        this.me.y,
        this.myBb(),
      );
      if (this.myTeam === 'ice') this.banner("YOU'RE ICE NOW — go freeze them!", '#e84848');
    }

    // ── round respawn — server scattered everyone ────────────
    if (myState && s.round !== this.lastRound) {
      this.lastRound = s.round;
      if (myState.x !== 0 || myState.y !== 0) {
        this.me.setPosition(myState.x, myState.y);
        (this.me.body as Body).setVelocity(0, 0);
      }
      for (const [, r] of this.remotes) r.ice?.setVisible(false);
    }

    // ── frozen overlay on me — the 3D ice shell does the work now ──
    if (frozen !== (this.myIce?.visible ?? false)) {
      this.myIce ??= this.add.image(this.me.x, this.me.y, 'iceblock').setDepth(7).setVisible(false);
      this.myIce.setVisible(false); // kept for state, never drawn
    }

    // ── my movement (locked while frozen / not playing) ──────
    const dir = new Phaser.Math.Vector2(0, 0);
    if (playing && !frozen) {
      if (this.keys.A.isDown || this.keys.LEFT.isDown) dir.x -= 1;
      if (this.keys.D.isDown || this.keys.RIGHT.isDown) dir.x += 1;
      if (this.keys.W.isDown || this.keys.UP.isDown) dir.y -= 1;
      if (this.keys.S.isDown || this.keys.DOWN.isDown) dir.y += 1;
      if (this.touch && this.touch.dir.lengthSq() > 0) dir.copy(this.touch.dir);
      // camera-relative controls — intent rotates with the orbit yaw
      const rot = this.st3.rotateInput(dir.x, dir.y);
      dir.set(rot.x, rot.y);
    }
    const speed =
      this.keys.SHIFT.isDown || (this.touch?.sprint ?? false)
        ? CONFIG.runner.sprintSpeed
        : SPEED;
    if (dir.lengthSq() > 0) dir.normalize();
    (this.me.body as Body).setVelocity(dir.x * speed, dir.y * speed);
    const v = (this.me.body as Body).velocity;
    if (Math.hypot(v.x, v.y) > 12) this.me.rotation = Math.atan2(v.y, v.x);
    {
      const lp = this.st3.project(this.me.x, this.me.y, 2.1);
      this.meLabel.setScrollFactor(0).setDepth(40).setPosition(lp.x, lp.y);
    }
    this.st3.syncEnt(this.myEnt, this.me.x, this.me.y, v.x, v.y, frozen);

    // send position (server ignores us when frozen anyway)
    if (playing && !frozen) {
      this.sendIn -= delta;
      if (this.sendIn <= 0) {
        this.sendIn = SEND_EVERY_MS;
        this.room.send('move', { x: this.me.x, y: this.me.y, angle: this.me.rotation });
      }
    }

    // remotes — lerp toward server position + frozen overlays
    const myTeam = s.players?.get(this.room.sessionId)?.team;
    let dangerNear = 0;
    for (const [id, r] of this.remotes) {
      const p = s.players?.get(id);
      if (!p) continue;
      r.targetX = p.x;
      r.targetY = p.y;
      r.targetAngle = p.angle;
      r.sprite.x += (r.targetX - r.sprite.x) * Math.min(1, 12 * dt);
      r.sprite.y += (r.targetY - r.sprite.y) * Math.min(1, 12 * dt);
      r.sprite.rotation = Phaser.Math.Angle.RotateTo(r.sprite.rotation, r.targetAngle, 10 * dt);
      // nearest live hunter → camera danger pull-back (skipped when I hunt)
      if (myTeam !== 'ice' && p.team === 'ice' && !p.out) {
        const d = Phaser.Math.Distance.Between(this.me.x, this.me.y, r.sprite.x, r.sprite.y);
        dangerNear = Math.max(
          dangerNear,
          Phaser.Math.Clamp(1 - (d - 60) / (CONFIG.heartbeat.radius - 60), 0, 1),
        );
      }
      const lp = this.st3.project(r.sprite.x, r.sprite.y, 2.1);
      r.label.setScrollFactor(0).setDepth(40).setPosition(lp.x, lp.y);
      // team flip live (infection conversion) — swap the bean's coat
      if (p.team !== r.team) {
        r.team = p.team;
        this.st3.removeEnt(r.entId);
        r.entId = this.st3.spawnEnt(
          p.team === 'ice' ? MILITIA_DEF : remoteModel(id),
          p.team === 'ice' ? 0x9fd8ff : 0x4dd0e1,
          r.sprite.x,
          r.sprite.y,
          this.remoteBb(id, p.team),
        );
      }
      // remotes lerp, they don't simulate — the chase delta stands in for
      // velocity so the bean's facing + run cycle read correctly
      this.st3.syncEnt(
        r.entId, r.sprite.x, r.sprite.y,
        (r.targetX - r.sprite.x) * 12, (r.targetY - r.sprite.y) * 12, p.out,
      );
    }
    this.st3.render(dt, {
      fx: this.me.x, fy: this.me.y, vx: v.x, vy: v.y,
      spectate: frozen,
      danger: frozen ? 0 : dangerNear,
    });
    this.drawMinimap();

    // ── HUD ──────────────────────────────────────────────────
    const counts = { ice: 0, water: 0 };
    s.players?.forEach((p) => {
      if (p.team === 'ice') counts.ice++;
      else if (!p.out) counts.water++;
    });
    this.infoText.setText(
      `${counts.ice} ice / ${counts.water} water free${counts.water === 0 && counts.ice === 0 ? ` · ${s.players?.size ?? 0} players` : ''}`,
    );
    this.timeText.setText(
      s.phase === 'intermission' ? `next in ${Math.ceil(s.intermissionLeft)}` : this.fmtTime(s.timeLeft),
    );
    this.timeText.setColor(s.timeLeft < 10 && playing ? '#e84848' : '#1c2a3a');
    this.scoreText.setText(
      s.mode === 'rounds' ? `ROUND ${s.round} · ICE ${s.iceScore} — ${s.waterScore} WATER` : '',
    );

    // ── server message feed → banners ────────────────────────
    if (s.message && s.message !== this.lastMessage) {
      this.lastMessage = s.message;
      this.banner(s.message, '#7fd8f0');
      sfx.voice(s.message);
    }

    // ── match end / rematch reset ────────────────────────────
    if (s.phase === 'ended' && !this.endedShown) {
      this.endedShown = true;
      this.touch?.setActive(false); // pads off — the end screen owns the taps
      this.showEnd();
    } else if (s.phase === 'playing' && this.endedShown) {
      if (this.endLayer) this.unpin(this.endLayer);
      this.endLayer?.destroy();
      this.endLayer = null;
      this.endHit = [];
      this.endedShown = false;
      this.touch?.setActive(true);
    }
  }

  private fmtTime(sec: number): string {
    const t = Math.max(0, Math.ceil(sec));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  private banner(text: string, color: string) {
    const t = this.pin(
      this.add
        .text(0, 0, text, {
          fontFamily: DISPLAY_FONT,
          fontSize: '26px',
          color,
          stroke: '#081420',
          strokeThickness: 6,
        })
        .setOrigin(0.5)
        .setDepth(20),
      0.5, 0, 0, 150,
    );
    this.relayout();
    popIn(this, t);
    this.tweens.add({
      targets: t,
      alpha: 0,
      y: t.y - 30 / viewZoom(this.scale.width, this.scale.height),
      delay: 2100,
      duration: 350,
      onComplete: () => {
        this.unpin(t);
        t.destroy();
      },
    });
  }

  private showEnd() {
    const { width, height } = this.scale;
    const s = this.room.state;
    const layer = this.pin(this.add.container(0, 0).setDepth(30), 0, 0);
    this.endLayer = layer;

    layer.add(this.add.rectangle(-width, -height, width * 3, height * 3, 0x000000, 0.62).setOrigin(0));
    // result card — same paper panel as the solo end card. Children of this
    // pinned layer land on screen at local·hf — so the screen centre in local
    // coords is viewport/(2·hf), otherwise the card drifts left on mobile.
    const hf = hudFactor(width, height);
    const cw = 560;
    const ch = 330;
    const cx = width / (2 * hf);
    const cy = height / (2 * hf);
    layer.add(panel(this, cx - cw / 2, cy - ch / 2, cw, ch, { alpha: 0.97 }));
    layer.add(
      this.add
        .text(cx, cy - 80, s.winner === 'ice' ? 'ICE WINS' : 'WATER WINS', {
          fontFamily: DISPLAY_FONT,
          fontSize: '52px',
          color: s.winner === 'ice' ? '#e84848' : '#0f7fb8',
        })
        .setOrigin(0.5)
        .setShadow(0, 4, '#d8cfb8', 0, true, false),
    );
    layer.add(
      this.add
        .text(cx, cy - 14, s.message, {
          fontFamily: UI_FONT,
          fontSize: '18px',
          color: '#5a7184',
        })
        .setOrigin(0.5),
    );

    // lipped pills drawn at the hit rects — same language as menu buttons
    const drawPill = (cx: number, cy: number, w: number, h: number, fill: number) => {
      const pg = this.add.graphics();
      const lip = 7;
      pg.fillStyle(shade(fill, -38), 1).fillRoundedRect(cx - w / 2, cy - h / 2 - 2, w, h, h / 2);
      pg.fillStyle(fill, 1).fillRoundedRect(cx - w / 2, cy - h / 2 - lip, w, h - 2, h / 2);
      pg.fillStyle(0xffffff, 0.2).fillRoundedRect(cx - w / 2 + 7, cy - h / 2 - lip + 4, w - 14, h * 0.34, h / 4);
      layer.add(pg);
    };
    const isHost = this.room.sessionId === s.host;
    if (isHost) drawPill(cx, cy + 53, 230, 50, UI.leaf);
    const again = this.add
      .text(cx, cy + 49, isHost ? 'PLAY AGAIN  (space)' : 'waiting for host to rematch…', {
        fontFamily: DISPLAY_FONT,
        fontSize: '17px',
        color: isHost ? '#1c1626' : '#5a7184',
      })
      .setOrigin(0.5);
    layer.add(again);
    if (isHost) {
      again.setPadding(14, 10, 14, 10);
      this.input.keyboard!.on('keydown-SPACE', () => {
        if (this.room.state.phase === 'ended') this.room.send('restart');
      });
    }
    drawPill(cx, cy + 104, 190, 46, UI.ink);
    const leaveBtn = this.add
      .text(cx, cy + 100, 'LEAVE  (esc)', {
        fontFamily: DISPLAY_FONT,
        fontSize: '15px',
        color: '#f5efe0',
      })
      .setOrigin(0.5)
      .setPadding(14, 10, 14, 10);
    layer.add(leaveBtn);
    // screen-space tap rects — container children miss input under camera
    // scroll; local coords land at ·hf on screen, so map them through hf
    const sr = (lx: number, ly: number, lw: number, lh: number) => ({
      x: lx * hf,
      y: ly * hf,
      w: lw * hf,
      h: lh * hf,
    });
    this.endHit = [
      ...(isHost
        ? [{ ...sr(cx - 110, cy + 30, 220, 46), fn: () => this.room.send('restart') }]
        : []),
      { ...sr(cx - 90, cy + 82, 180, 44), fn: () => this.leave() },
    ];
    this.relayout();
  }

  /** manual hit test for the end screen buttons */
  private onEndTap(p: Phaser.Input.Pointer) {
    if (!this.endHit.length) return;
    for (const z of this.endHit) {
      if (p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h) {
        z.fn();
        return;
      }
    }
  }

  /** Register onAdd/onRemove on the live room's player collection. */
  private bindRemotes() {
    const $ = getStateCallbacks(this.room);
    if ($) {
      $(this.room.state.players).onAdd((p: NetPlayer, id: string) => this.spawnRemote(p, id));
      $(this.room.state.players).onRemove((_p: NetPlayer, id: string) => {
        const r = this.remotes.get(id);
        if (r) {
          this.st3.removeEnt(r.entId);
          r.sprite.destroy();
          r.label.destroy();
          r.ice?.destroy();
          this.remotes.delete(id);
        }
      });
    }
    this.room.state.players?.forEach((p, id) => this.spawnRemote(p, id));
  }

  private spawnRemote(p: NetPlayer, id: string) {
    if (id === this.room.sessionId || this.remotes.has(id)) return;
    const sprite = this.physics.add.sprite(p.x, p.y, p.team === 'ice' ? 'chaser' : 'runner');
    sprite.setVisible(false);
    (sprite.body as Body).setCircle(CONFIG.runner.radius + 2);
    for (const w of this.wallBodies) this.physics.add.collider(sprite, w);
    this.physics.add.collider(sprite, this.obstacleGroup);
    this.physics.add.collider(sprite, this.worldObstacleGroup);
    const entId = this.st3.spawnEnt(
      p.team === 'ice' ? MILITIA_DEF : remoteModel(id),
      p.team === 'ice' ? 0x9fd8ff : 0x4dd0e1,
      p.x,
      p.y,
      this.remoteBb(id, p.team),
    );
    const label = this.add
      .text(p.x, p.y - 26, p.name, {
        fontFamily: UI_FONT,
        fontSize: '11px',
        fontStyle: '600',
        color: '#ffffff',
        stroke: '#2b2115',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(8);
    this.remotes.set(id, {
      sprite, label, entId, team: p.team,
      targetX: p.x, targetY: p.y, targetAngle: 0,
    });
  }

  /** Dropped connection — keep trying the reconnection token for ~25s. */
  private async tryReconnect(code: number) {
    if (this.connText) return; // already trying
    this.connText = this.pin(
      this.add
        .text(0, 0, `connection lost — reconnecting…`, {
          fontFamily: DISPLAY_FONT,
          fontSize: '18px',
          color: '#ffb74d',
          stroke: '#081420',
          strokeThickness: 5,
        })
        .setOrigin(0.5)
        .setDepth(40),
      0.5, 0, 0, 92,
    );
    this.relayout();

    for (let i = 0; i < 12 && !this.leaving; i++) {
      try {
        const room = await this.net.reconnect<NetState>(this.reconnToken);
        this.room = room;
        this.reconnToken = room.reconnectionToken ?? this.reconnToken;
        this.room.onLeave((c) => {
          if (!this.leaving) void this.tryReconnect(c);
        });
        this.bindRemotes(); // new decoder — re-register collection callbacks
        if (this.connText) this.unpin(this.connText);
        this.connText?.destroy();
        this.connText = null;
        this.banner('back in the game!', '#7fd8f0');
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    this.connText?.setText(`couldn't reconnect (${code}) — esc to leave`);
  }

  private leave() {
    this.leaving = true;
    this.st3.hide();
    void this.room?.leave();
    wipeTo(this, 'title');
  }
}
