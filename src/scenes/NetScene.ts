import Phaser from 'phaser';
import { Client, Room, getStateCallbacks } from '@colyseus/sdk';
import { SERVER_URL } from '../net';
import { CONFIG } from '../config';
import { makeTextures, decorateYard } from '../art';
import { Sfx } from '../audio';
import { DISPLAY_FONT, UI_FONT, UI, panel, popIn, pinHud, layoutHud, HudItem, shade, viewZoom, hudFactor } from '../ui';
import { TouchControls, keyHintsOn } from '../mobile';
import { loadPicks } from '../meta';
import { viaWipe, wipeTo } from '../wipe';
import { generateLayout, seededRng } from '../mapgen';

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
  targetX: number;
  targetY: number;
  targetAngle: number;
}

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
  private fromWipe = false;
  private me!: Phaser.Physics.Arcade.Sprite;
  private meLabel!: Phaser.GameObjects.Text;
  private myTeam = 'water';
  private remotes = new Map<string, RemoteSprite>();
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private touch: TouchControls | null = null;
  private sendIn = 0;
  private wallBodies: Phaser.GameObjects.Rectangle[] = [];
  private obstacleGroup!: Phaser.Physics.Arcade.StaticGroup;
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
  private connText: Phaser.GameObjects.Text | null = null;
  private hudItems: HudItem[] = [];

  constructor() {
    super('net');
  }

  init(data: { room: Room<NetState>; iwWipe?: boolean }) {
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
    const { arena } = CONFIG;
    this.physics.world.setBounds(0, 0, arena.width, arena.height);
    this.buildArena();
    if (this.room.state.mapSeed) this.rebuildMap(this.room.state.mapSeed);

    const myId = this.room.sessionId;
    this.myTeam = this.room.state.players?.get(myId)?.team ?? 'water';

    // my sprite — ice hunts, water runs
    const myTex = this.myTeam === 'ice' ? 'chaser' : 'player';
    this.me = this.physics.add.sprite(
      arena.width / 2 + Phaser.Math.Between(-80, 80),
      arena.height / 2 + Phaser.Math.Between(-80, 80),
      myTex,
    );
    (this.me.body as Body).setCircle(CONFIG.runner.radius + 2);
    (this.me.body as Body).setCollideWorldBounds(true);
    for (const w of this.wallBodies) this.physics.add.collider(this.me, w);
    this.physics.add.collider(this.me, this.obstacleGroup);

    // camera rides on you — the neighborhood is bigger than the screen
    this.cameras.main
      .setBounds(0, 0, arena.width, arena.height)
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
    this.add.rectangle(width / 2, height / 2, width, height, colors.ground);
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
    this.obstacleGroup = this.physics.add.staticGroup();
  }

  /** Server picked a new map seed — rebuild blocks + set dressing. */
  private rebuildMap(seed: number) {
    this.mapSeed = seed;
    this.obstacleGroup.clear(true, true);
    for (const d of this.decor) d.destroy();
    this.decor = [];
    this.obstacleRects = [];
    for (const o of generateLayout(seed)) {
      const rect = this.add.rectangle(o.x, o.y, o.w, o.h, CONFIG.colors.obstacle);
      this.obstacleGroup.add(rect);
      this.obstacleRects.push(new Phaser.Geom.Rectangle(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h));
    }
    this.decor = decorateYard(this, this.obstacleRects, seededRng(seed ^ 0x9e3779b9));
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

    // ── frozen overlay on me ──────────────────────────────────
    if (frozen !== (this.myIce?.visible ?? false)) {
      this.myIce ??= this.add.image(this.me.x, this.me.y, 'iceblock').setDepth(7);
      this.myIce.setVisible(frozen);
    }
    if (this.myIce?.visible) this.myIce.setPosition(this.me.x, this.me.y);

    // ── my movement (locked while frozen / not playing) ──────
    const dir = new Phaser.Math.Vector2(0, 0);
    if (playing && !frozen) {
      if (this.keys.A.isDown || this.keys.LEFT.isDown) dir.x -= 1;
      if (this.keys.D.isDown || this.keys.RIGHT.isDown) dir.x += 1;
      if (this.keys.W.isDown || this.keys.UP.isDown) dir.y -= 1;
      if (this.keys.S.isDown || this.keys.DOWN.isDown) dir.y += 1;
      if (this.touch && this.touch.dir.lengthSq() > 0) dir.copy(this.touch.dir);
    }
    const speed =
      this.keys.SHIFT.isDown || (this.touch?.sprint ?? false)
        ? CONFIG.runner.sprintSpeed
        : SPEED;
    if (dir.lengthSq() > 0) dir.normalize();
    (this.me.body as Body).setVelocity(dir.x * speed, dir.y * speed);
    const v = (this.me.body as Body).velocity;
    if (Math.hypot(v.x, v.y) > 12) this.me.rotation = Math.atan2(v.y, v.x);
    this.meLabel.setPosition(this.me.x, this.me.y - 24);

    // send position (server ignores us when frozen anyway)
    if (playing && !frozen) {
      this.sendIn -= delta;
      if (this.sendIn <= 0) {
        this.sendIn = SEND_EVERY_MS;
        this.room.send('move', { x: this.me.x, y: this.me.y, angle: this.me.rotation });
      }
    }

    // remotes — lerp toward server position + frozen overlays
    for (const [id, r] of this.remotes) {
      const p = s.players?.get(id);
      if (!p) continue;
      r.targetX = p.x;
      r.targetY = p.y;
      r.targetAngle = p.angle;
      r.sprite.x += (r.targetX - r.sprite.x) * Math.min(1, 12 * dt);
      r.sprite.y += (r.targetY - r.sprite.y) * Math.min(1, 12 * dt);
      r.sprite.rotation = Phaser.Math.Angle.RotateTo(r.sprite.rotation, r.targetAngle, 10 * dt);
      r.sprite.setDepth(2 + r.sprite.y * 0.002);
      r.label.setPosition(r.sprite.x, r.sprite.y - 24);
      // team flip live (infection conversion)
      const tex = p.team === 'ice' ? 'chaser' : 'runner';
      if (r.sprite.texture.key !== tex) r.sprite.setTexture(tex);
      // frozen overlay
      if (p.out !== (r.ice?.visible ?? false)) {
        r.ice ??= this.add.image(r.sprite.x, r.sprite.y, 'iceblock').setDepth(6.5);
        r.ice.setVisible(p.out);
      }
      if (r.ice?.visible) r.ice.setPosition(r.sprite.x, r.sprite.y);
    }
    this.me.setDepth(2 + this.me.y * 0.002);
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
    (sprite.body as Body).setCircle(CONFIG.runner.radius + 2);
    for (const w of this.wallBodies) this.physics.add.collider(sprite, w);
    this.physics.add.collider(sprite, this.obstacleGroup);
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
    this.remotes.set(id, { sprite, label, targetX: p.x, targetY: p.y, targetAngle: 0 });
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
    void this.room?.leave();
    wipeTo(this, 'title');
  }
}
