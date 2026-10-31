// Match sim — entities, teams, tag/freeze/rescue rules, AI brains,
// camera follow. Rendering lives in beans/world; this is the brain.
import * as THREE from 'three';
import { makeBean, setFrozen, animBean, squashOnLand, emoteTexture, type Bean } from './beans';
import { ICE_CREW, MILITIA_NAMES, MILITIA_DEF, CREW_DEF, charDefById, charMove, type CharDef, type CharMove } from './chars';
import { type World } from './world';
import { type InputState } from './input';
import { clamp, lerp, rand, dist2 } from './util';
import * as AU from './audio';

export type Mode = 'classic' | 'battle' | 'survival' | 'practice' | 'drops';
export interface ModeCfg {
  key: Mode; name: string; sub: string;
  ice: number; water: number; seconds: number; aiSkill: number; ramp: boolean;
}
export const MODES: ModeCfg[] = [
  { key: 'classic', name: 'CLASSIC', sub: '4v4 · the real rules · 90s', ice: 4, water: 4, seconds: 90, aiSkill: .7, ramp: false },
  { key: 'drops', name: 'WATER RUN', sub: 'collect 6 drops · leftovers hunt you', ice: 4, water: 3, seconds: 100, aiSkill: .65, ramp: false },
  { key: 'battle', name: 'TEAM BATTLE', sub: '3v5 · outnumbered · 2 min', ice: 3, water: 5, seconds: 120, aiSkill: .7, ramp: false },
  { key: 'survival', name: 'SURVIVAL', sub: 'they get faster · survive 2 min', ice: 4, water: 4, seconds: 120, aiSkill: .62, ramp: true },
  { key: 'practice', name: 'PRACTICE', sub: 'easy opponents · learn the pitch', ice: 4, water: 3, seconds: 90, aiSkill: .35, ramp: false },
];

const WALK = 6.4, SPRINT = 10.2, AI_WALK = 5.6, AI_SPRINT = 9.4;
const TAG_R = 1.15, RESCUE_R = 1.3;
const NEAR_R = TAG_R * 1.9; // a tag that just missed
const SAFE_MAX = 4;         // seconds of refuge inside the zone

/** chapter mutators — the road north tweaks one rule per stop */
export interface Mut {
  nepa?: boolean;  // blackout for the whole match
  rain?: boolean;  // permanent rain — stamina slick
}

/** THE ROAD NORTH — Lagos to Maiduguri, one mutator per stop */
export interface Chapter {
  city: string; sub: string; cfg: ModeCfg; map: 'street' | 'school'; mut: Mut;
}
const C = (k: Mode) => MODES.find((m) => m.key === k)!;
export const ROAD_NORTH: Chapter[] = [
  { city: 'LAGOS', sub: 'where it all starts · classic rules', cfg: C('classic'), map: 'street', mut: {} },
  { city: 'IBADAN', sub: 'the water run · mind the police post', cfg: C('drops'), map: 'street', mut: {} },
  { city: 'ILORIN', sub: 'it rained all day — stamina is slick', cfg: C('classic'), map: 'school', mut: { rain: true } },
  { city: 'ABUJA', sub: 'outnumbered on the assembly ground', cfg: C('battle'), map: 'school', mut: {} },
  { city: 'JOS', sub: 'the plateau cold — they never slow down', cfg: C('survival'), map: 'street', mut: {} },
  { city: 'MAIDUGURI', sub: 'NEPA took the light — finish in the dark', cfg: C('drops'), map: 'street', mut: { nepa: true } },
];

export type Team = 'water' | 'ice';
export interface Ent {
  bean: Bean;
  team: Team;
  isPlayer: boolean;
  name: string;
  x: number; z: number; y: number;
  vx: number; vz: number; vy: number;
  yaw: number;
  stamina: number;
  frozen: boolean;
  air: boolean;
  ring: THREE.Mesh;
  // ai
  brave: number; skill: number;
  thinkT: number; wx: number; wz: number; tgt: Ent | null;
  tags: number; rescues: number;
  safeT: number; // refuge seconds left
}

export type MatchEvent =
  | 'frozen' | 'thaw' | 'tagged' | 'rescued' | 'tick' | 'end' | 'shout'
  | 'drop' | 'twist' | 'nepa' | 'rain' | 'exit'
  | 'nearmiss' | 'marked' | 'safe' | 'safeout';

export interface Stats { frozenByYou: number; timesFrozen: number; rescuesByYou: number; yourTeam: Team; won: boolean }

export class Match {
  ents: Ent[] = [];
  player!: Ent;
  timeLeft: number;
  over = false;
  winTeam: Team | null = null;
  phase: 'countdown' | 'play' | 'over' = 'countdown';
  cd = 3;
  camYaw = 0;
  camDist = 15.5;
  camPos = new THREE.Vector3(0, 11, 16);
  stats: Stats;
  onEvent: (e: MatchEvent, ent?: Ent) => void;
  private scene: THREE.Scene;
  world: World;
  private cfg: ModeCfg;
  private aiRamp = 0;
  private tickT = 0;
  // water-run objective
  drops: { m: THREE.Group; x: number; z: number; taken: boolean }[] = [];
  dropsNeed = 6;
  dropsGot = 0;
  twistDone = false;
  exitRing: THREE.Group | null = null;
  exitX = 0; exitZ = 0;
  // COME SAVE ME ping
  pingT = 0;
  pingRing: THREE.Mesh | null = null;
  // player skill (inherited boss move)
  playerMove: CharMove;
  skillT = 0;
  rageT = 0;
  // street events — NEPA outage / rain burst
  event: 'none' | 'nepa' | 'rain' = 'none';
  eventT = 0;
  eventAt: number;
  torch: THREE.PointLight | null = null;
  rainPts: THREE.Points | null = null;
  landed = false;
  backups: { e: Ent; t: number }[] = [];
  // juice — shakes, near-miss flashes, taunts, emotes
  shakeT = 0;
  shakeAmp = 0;
  missFx: { m: THREE.Mesh; t: number }[] = [];
  nearPairs = new Set<string>();
  nearMisses = 0;
  tauntT = 0;   // speed boost window after a brave shout
  markT = 0;    // hunters heard you — you're marked
  emotes: { e: Ent; t: number }[] = [];
  safeInside = false;
  private mut: Mut;
  private persistNepa = false;
  private nepaTimer: ReturnType<typeof setTimeout> | null = null;
  private rainTimer: ReturnType<typeof setTimeout> | null = null;
  // NEPA blackout snapshot — every light + sky IBL dimmed, restored on UP NEPA
  private dimmed: Map<THREE.Light, number> | null = null;
  private envI = 1;
  private fogNear = 70;
  private fogHex = 0xe8c9a0;
  private bgHex: number | null = null;
  private mutFired = false;

  constructor(scene: THREE.Scene, world: World, cfg: ModeCfg, charId: string, onEvent: (e: MatchEvent, ent?: Ent) => void, mut: Mut = {}) {
    this.scene = scene; this.world = world; this.cfg = cfg; this.onEvent = onEvent; this.mut = mut;
    this.timeLeft = cfg.seconds;
    this.stats = { frozenByYou: 0, timesFrozen: 0, rescuesByYou: 0, yourTeam: 'ice', won: false };

    const playerDef = charDefById(charId);
    this.playerMove = charMove(charId);
    // drops mode always puts you on the running side — you're the collector
    const playerTeam: Team = cfg.key === 'drops' ? 'ice' : (Math.random() < .5 ? 'water' : 'ice');
    this.stats.yourTeam = playerTeam;
    this.eventAt = rand(22, 42); // a street event lands mid-match
    const crew = [...ICE_CREW].filter((c) => c.def.id !== charId);
    const mnames = [...MILITIA_NAMES].sort(() => Math.random() - .5);

    // ICE south, WATER north
    const mk = (team: Team, i: number, n: number, isPlayer = false) => {
      const mate = team === 'ice' && !isPlayer ? crew[i] : null;
      const def: CharDef = isPlayer ? playerDef
        : mate ? mate.def
        : team === 'ice' ? CREW_DEF : MILITIA_DEF;
      const name = isPlayer ? 'YOU' : mate ? mate.name : mnames.pop() ?? (team === 'ice' ? 'CREW' : 'MILITIA');
      const bean = makeBean(def);
      const spread = (i - (n - 1) / 2) * 4.5;
      const zBase = team === 'ice' ? world.bounds.maxZ - 8 : world.bounds.minZ + 8;
      const x = clamp(spread + rand(-1.5, 1.5), world.bounds.minX + 2, world.bounds.maxX - 2);
      const z = zBase + rand(-3, 3);
      bean.root.position.set(x, 0, z);
      // team ring under feet — brand colours: militia water-cyan, runners paper
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(.5, .68, 24),
        new THREE.MeshBasicMaterial({ color: team === 'water' ? 0x4dd0e1 : 0xf5efe0, transparent: true, opacity: .8, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2; ring.position.y = .03;
      bean.root.add(ring);
      const you = isPlayer ? new THREE.Mesh(
        new THREE.RingGeometry(.78, .86, 24),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .9, depthWrite: false }),
      ) : null;
      if (you) { you.rotation.x = -Math.PI / 2; you.position.y = .035; bean.root.add(you); }
      scene.add(bean.root);
      const e: Ent = {
        bean, team, isPlayer, name,
        x, z, y: 0, vx: 0, vz: 0, vy: 0, yaw: team === 'ice' ? Math.PI : 0,
        stamina: 1, frozen: false, air: false, ring,
        brave: mate ? mate.brave : rand(.2, 1), skill: cfg.aiSkill * rand(.85, 1.15),
        thinkT: rand(.4), wx: x, wz: z, tgt: null, tags: 0, rescues: 0, safeT: SAFE_MAX,
      };
      bean.root.rotation.y = e.yaw;
      this.ents.push(e);
      return e;
    };

    const iceN = this.cfg.ice, waterN = this.cfg.water;
    let pi = 0, pw = 0;
    if (playerTeam === 'ice') this.player = mk('ice', 0, iceN, true), pi = 1;
    else this.player = mk('water', 0, waterN, true), pw = 1;
    for (; pi < iceN; pi++) mk('ice', pi, iceN);
    for (; pw < waterN; pw++) mk('water', pw, waterN);

    // ---- WATER RUN: scatter the drops — quota + 2 spares like the 2D game
    if (cfg.key === 'drops') {
      const dropMat = new THREE.MeshStandardMaterial({ color: 0x6fd4ff, roughness: .2, emissive: 0x1a4a66 });
      for (let i = 0; i < this.dropsNeed + 2; i++) {
        const g = new THREE.Group();
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(.22, 12, 10), dropMat);
        bulb.position.y = .22;
        const tip = new THREE.Mesh(new THREE.ConeGeometry(.14, .3, 10), dropMat);
        tip.position.y = .48;
        g.add(bulb, tip);
        const x = rand(world.bounds.minX + 3, world.bounds.maxX - 3);
        const z = rand(world.bounds.minZ + 3, world.bounds.maxZ - 3);
        g.position.set(x, 0, z);
        scene.add(g);
        this.drops.push({ m: g, x, z, taken: false });
      }
    }

    // ---- rescue ping ring (hidden until called)
    this.pingRing = new THREE.Mesh(
      new THREE.RingGeometry(.4, .6, 32),
      new THREE.MeshBasicMaterial({ color: 0x7fd8f0, transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.pingRing.rotation.x = -Math.PI / 2;
    this.pingRing.visible = false;
    scene.add(this.pingRing);
  }

  dispose() {
    for (const e of this.ents) this.scene.remove(e.bean.root);
    for (const d of this.drops) this.scene.remove(d.m);
    for (const o of [this.pingRing, this.exitRing, this.torch, this.rainPts])
      if (o) this.scene.remove(o);
    for (const f of this.missFx) this.scene.remove(f.m);
    if (this.nepaTimer) clearTimeout(this.nepaTimer);
    if (this.rainTimer) clearTimeout(this.rainTimer);
    this.restoreLights();
  }

  // ---------- helpers ----------
  private live(e: Ent) { return !e.frozen; }
  private iceFree() { return this.ents.filter((e) => e.team === 'ice' && !e.frozen); }
  private iceFrozen() { return this.ents.filter((e) => e.team === 'ice' && e.frozen); }
  private waters() { return this.ents.filter((e) => e.team === 'water'); }

  private collide(e: Ent) {
    const B = this.world.bounds;
    e.x = clamp(e.x, B.minX + .55, B.maxX - .55);
    e.z = clamp(e.z, B.minZ + .55, B.maxZ - .55);
    for (const o of this.world.obstacles) {
      const d2 = dist2(e.x, e.z, o.x, o.z), rr = o.r + .45;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        e.x = o.x + (e.x - o.x) / d * rr;
        e.z = o.z + (e.z - o.z) / d * rr;
      }
    }
  }

  private move(e: Ent, dx: number, dz: number, speed: number, dt: number) {
    const m = Math.hypot(dx, dz);
    if (m > .01) {
      const tx = dx / Math.max(m, 1) * speed, tz = dz / Math.max(m, 1) * speed;
      e.vx = lerp(e.vx, tx, 1 - Math.exp(-10 * dt));
      e.vz = lerp(e.vz, tz, 1 - Math.exp(-10 * dt));
      const want = Math.atan2(e.vx, e.vz);
      let d = want - e.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      e.yaw += d * Math.min(1, 12 * dt);
    } else {
      e.vx = lerp(e.vx, 0, 1 - Math.exp(-8 * dt));
      e.vz = lerp(e.vz, 0, 1 - Math.exp(-8 * dt));
    }
    e.x += e.vx * dt; e.z += e.vz * dt;
    this.collide(e);
  }

  private shake(t: number, amp: number) { this.shakeT = Math.max(this.shakeT, t); this.shakeAmp = Math.max(this.shakeAmp, amp); }

  private freeze(target: Ent, by: Ent) {
    target.frozen = true;
    target.vx = target.vz = 0;
    setFrozen(target.bean, true);
    by.tags++;
    AU.sTag(); setTimeout(() => AU.sFreeze(), 90);
    if (by.isPlayer) { this.stats.frozenByYou++; AU.vTagged(); this.shake(.18, .2); }
    if (target.isPlayer) { this.stats.timesFrozen++; AU.vFrozen(); this.shake(.4, .5); }
    else if (Math.random() < .35 && by.isPlayer) AU.crowdCheer();
    this.onEvent('frozen', target);
    this.checkEnd();
  }

  private thaw(target: Ent, by: Ent) {
    target.frozen = false;
    setFrozen(target.bean, false);
    target.bean.squash = .7;
    by.rescues++;
    AU.sThaw();
    if (by.isPlayer) { this.stats.rescuesByYou++; AU.vFree(); }
    else if (target.isPlayer) AU.vFree();
    else if (Math.random() < .3) AU.vRescue();
    this.onEvent('thaw', target);
  }

  // a tag that just missed — the flash + the crowd's gasp
  private nearMiss(w: Ent, t: Ent) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(.5, .72, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .8, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set((w.x + t.x) / 2, .06, (w.z + t.z) / 2);
    this.scene.add(ring);
    this.missFx.push({ m: ring, t: 0 });
    this.nearMisses++;
    AU.crowdOoh();
    if (t.isPlayer) this.shake(.14, .15);
    this.onEvent('nearmiss', t);
  }

  // shouting near hunters: +speed, but now they know where you are
  private taunt() {
    const p = this.player;
    AU.vTaunt();
    this.onEvent('shout', p);
    if (p.team !== 'ice') return; // hunters don't hunt their own
    let heard = 0;
    for (const w of this.waters()) {
      if (dist2(w.x, w.z, p.x, p.z) < 14 * 14) { w.tgt = p; w.thinkT = 0; heard++; }
    }
    if (heard > 0) {
      this.tauntT = 3.5;
      this.markT = 3;
      this.onEvent('marked', p);
    }
  }

  // floating glyph over a bean — '…' for the cowards
  private showEmote(e: Ent, txt: string, dur = 2.4) {
    (e.bean.emote.material as THREE.SpriteMaterial).map = emoteTexture(txt);
    (e.bean.emote.material as THREE.SpriteMaterial).needsUpdate = true;
    e.bean.emote.visible = true;
    this.emotes.push({ e, t: dur });
  }

  private checkEnd() {
    if (this.iceFree().length === 0) this.end('water');
  }

  private end(team: Team) {
    if (this.over) return;
    this.over = true; this.phase = 'over';
    this.winTeam = team;
    this.stats.won = this.player.team === team;
    if (this.stats.won) { AU.sWin(); AU.crowdCheer(); } else AU.sLose();
    this.onEvent('end');
  }

  // ---------- AI ----------
  private aiThink(e: Ent, dt: number) {
    e.thinkT -= dt;
    const skill = e.skill + this.aiRamp;
    if (e.team === 'water') {
      // nearest free ice, with lead pursuit
      if (!e.tgt || e.tgt.frozen || Math.random() < .002) {
        let best: Ent | null = null, bd = 1e9;
        for (const t of this.iceFree()) {
          const d = dist2(e.x, e.z, t.x, t.z);
          if (d < bd) { bd = d; best = t; }
        }
        e.tgt = best;
      }
    } else if (e.thinkT <= 0) {
      // ICE: rescue call if a mate is frozen and no water too close to it
      e.thinkT = .25 + Math.random() * .2;
      // COME SAVE ME — the player's ping overrides caution for the brave
      if (this.pingT > 0 && this.player.frozen && e.brave >= .5) { e.tgt = this.player; return; }
      const frozen = this.iceFrozen();
      let rescue: Ent | null = null, bd = 1e9;
      for (const f of frozen) {
        // nearest water to that frozen mate
        let wd = 1e9;
        for (const w of this.waters()) wd = Math.min(wd, dist2(w.x, w.z, f.x, f.z));
        if (wd > 5 * 5 && e.brave > .4) {
          const d = dist2(e.x, e.z, f.x, f.z);
          if (d < bd) { bd = d; rescue = f; }
        }
      }
      e.tgt = rescue;
      if (!rescue && Math.random() < .4) {
        // wander somewhere away from walls
        const B = this.world.bounds;
        e.wx = rand(B.minX + 3, B.maxX - 3);
        e.wz = rand(B.minZ + 3, B.maxZ - 3);
      }
    }
  }

  private aiMove(e: Ent, dt: number) {
    let dx = 0, dz = 0, sprint = false;
    const skill = e.skill + this.aiRamp;
    if (e.team === 'water') {
      const t = e.tgt;
      if (t) {
        // predictive intercept
        const d = Math.hypot(t.x - e.x, t.z - e.z);
        const lead = clamp(d / 8, 0, 1.2) * skill;
        dx = t.x + t.vx * lead - e.x;
        dz = t.z + t.vz * lead - e.z;
        sprint = d < 14 && e.stamina > .12;
      }
    } else {
      // flee nearest water within threat radius
      let threat: Ent | null = null, td = 1e9;
      for (const w of this.waters()) {
        const d = dist2(e.x, e.z, w.x, w.z);
        if (d < td) { td = d; threat = w; }
      }
      const threatR = 9 + skill * 3;
      if (e.tgt) { dx = e.tgt.x - e.x; dz = e.tgt.z - e.z; }
      else if (threat && td < threatR * threatR) {
        const d = Math.sqrt(td);
        dx = (e.x - threat.x) / d; dz = (e.z - threat.z) / d;
        // juke — a little perpendicular sidestep
        const j = Math.sin(e.thinkT * 13 + e.x) * .6 * skill;
        dx += -dz * j; dz += dx * j * .5;
        sprint = d < 7 && e.stamina > .1;
        // don't flee into a wall corner — bias toward centre-ish open space
        const B = this.world.bounds;
        if (e.x < B.minX + 4) dx += .8; if (e.x > B.maxX - 4) dx -= .8;
        if (e.z < B.minZ + 4) dz += .8; if (e.z > B.maxZ - 4) dz -= .8;
      } else { dx = e.wx - e.x; dz = e.wz - e.z; if (Math.hypot(dx, dz) < 1) { dx = dz = 0; } }
      // rescue overrides flee when the way is clear
      if (e.tgt && threat && td > 5 * 5) { dx = e.tgt.x - e.x; dz = e.tgt.z - e.z; sprint = td > 64; }
    }
    // obstacle steer: push away from close obstacles
    for (const o of this.world.obstacles) {
      const d2 = dist2(e.x + dx * .4, e.z + dz * .4, o.x, o.z);
      const rr = o.r + 1.1;
      if (d2 < rr * rr) {
        const d = Math.sqrt(Math.max(d2, .01));
        dx += (e.x - o.x) / d * 1.6;
        dz += (e.z - o.z) / d * 1.6;
      }
    }
    const speed = (sprint ? AI_SPRINT : AI_WALK) * (1 + this.aiRamp * .5) * (this.cfg.key === 'practice' ? .88 : 1);
    if (sprint) e.stamina = Math.max(0, e.stamina - dt * .25); else e.stamina = Math.min(1, e.stamina + dt * .2);
    this.move(e, dx, dz, speed, dt);
  }

  // ---------- per-frame ----------
  update(dt: number, inp: InputState, cam: THREE.PerspectiveCamera, frozenView = false) {
    if (this.phase === 'countdown') {
      this.cd -= dt;
      // the drop-in — your bean falls out of the sky onto the pitch
      if (!this.landed) {
        const dropT = 3 - this.cd; // seconds into countdown
        const y = Math.max(0, 24 - dropT * 20);
        this.player.y = y;
        this.player.bean.root.position.set(this.player.x, y, this.player.z);
        if (y <= 0) { this.landed = true; squashOnLand(this.player.bean); AU.sLand(); }
      }
      if (this.cd <= 0) { this.phase = 'play'; AU.sWhistle(); AU.startCrowd(); }
      return;
    }
    if (this.over) {
      for (const e of this.ents) animBean(e.bean, dt, Math.hypot(e.vx, e.vz), e.air, e.frozen);
      return;
    }

    this.timeLeft -= dt;
    this.tickT += dt;
    if (this.timeLeft <= 10.5 && this.tickT > 1) { this.tickT = 0; AU.sTick(); }
    if (this.timeLeft <= 0) { this.end('ice'); return; }
    if (this.cfg.ramp) this.aiRamp = Math.min(.5, (this.cfg.seconds - this.timeLeft) / this.cfg.seconds * .5);

    const p = this.player;

    // ---- chapter mutators fire once play starts
    if (!this.mutFired) {
      this.mutFired = true;
      if (this.mut.nepa) { this.persistNepa = true; this.event = 'nepa'; this.nepaOn(); this.onEvent('nepa'); }
      if (this.mut.rain) { this.event = 'rain'; this.rainOn(); this.onEvent('rain'); }
    }
    // ---- juice decay
    this.shakeT = Math.max(0, this.shakeT - dt);
    this.tauntT = Math.max(0, this.tauntT - dt);
    this.markT = Math.max(0, this.markT - dt);
    for (let i = this.emotes.length - 1; i >= 0; i--) {
      const em = this.emotes[i];
      em.t -= dt;
      em.e.bean.emote.position.y = 1.95 + Math.sin(em.e.bean.t * 3) * .08;
      if (em.t <= 0) { em.e.bean.emote.visible = false; this.emotes.splice(i, 1); }
    }
    for (let i = this.missFx.length - 1; i >= 0; i--) {
      const f = this.missFx[i];
      f.t += dt;
      const k = f.t / .5;
      f.m.scale.setScalar(.4 + k * 2.6);
      (f.m.material as THREE.MeshBasicMaterial).opacity = .8 * (1 - k);
      if (k >= 1) { this.scene.remove(f.m); this.missFx.splice(i, 1); }
    }

    // ---- street event: NEPA blackout or a rain burst, once per match
    this.eventT += dt;
    if (this.event === 'none' && this.eventT > this.eventAt) {
      this.event = Math.random() < .55 ? 'nepa' : 'rain';
      if (this.event === 'nepa') this.nepaOn(); else this.rainOn();
      this.onEvent(this.event);
    }
    if (this.event === 'nepa' && this.torch) this.torch.position.set(p.x, 2.6, p.z);
    if (this.rainPts) this.rainFall(dt, p);

    // ---- drops objective
    this.updateDrops(dt);

    // ---- COME SAVE ME — frozen player pings the crew
    if (this.pingT > 0) {
      this.pingT -= dt;
      if (this.pingRing) {
        const k = (5 - this.pingT) % 1;
        this.pingRing.scale.setScalar(1 + k * 9);
        (this.pingRing.material as THREE.MeshBasicMaterial).opacity = .9 * (1 - k);
      }
    }

    // ---- skill: inherited boss move on F, 16s cooldown
    this.skillT = Math.max(0, this.skillT - dt);
    this.rageT = Math.max(0, this.rageT - dt);
    if (inp.skillDown && !p.frozen && this.skillT <= 0) {
      this.skillT = 16;
      if (this.playerMove === 'rage') { this.rageT = 3.2; this.onEvent('shout', p); }
      else if (this.playerMove === 'blink') {
        p.x += Math.sin(p.yaw) * 4.5; p.z += Math.cos(p.yaw) * 4.5;
        this.collide(p);
      } else this.spawnBackup();
    }

    // ---- summoned backups expire
    for (let i = this.backups.length - 1; i >= 0; i--) {
      const b = this.backups[i];
      b.t -= dt;
      if (b.t <= 0) { this.scene.remove(b.e.bean.root); this.ents.splice(this.ents.indexOf(b.e), 1); this.backups.splice(i, 1); }
    }

    // ---- player
    if (!p.frozen && !frozenView) {
      const cy = this.camYaw;
      const fx = -Math.sin(cy), fz = -Math.cos(cy);
      const rx = Math.cos(cy), rz = -Math.sin(cy);
      let dx = inp.mx * rx + inp.mz * fx;
      let dz = inp.mx * rz + inp.mz * fz;
      const moving = Math.hypot(dx, dz) > .01;
      const canSprint = inp.sprint && p.stamina > .05;
      const speed = (canSprint && moving ? SPRINT : WALK) * (this.rageT > 0 ? 1.5 : 1) * (this.tauntT > 0 ? 1.18 : 1);
      const drain = .32 * (this.event === 'rain' ? 1.5 : 1);
      const regen = .2 * (this.event === 'rain' ? .55 : 1);
      if (canSprint && moving) p.stamina = Math.max(0, p.stamina - dt * drain);
      else p.stamina = Math.min(1, p.stamina + dt * regen);
      this.move(p, dx, dz, speed, dt);
      if (inp.jumpDown && !p.air) { p.vy = 6.4; p.air = true; AU.sJump(); }
    } else {
      p.vx = lerp(p.vx, 0, .1); p.vz = lerp(p.vz, 0, .1);
    }
    if (inp.shoutDown) {
      if (p.frozen) this.pingCrew();       // COME SAVE ME
      else this.taunt();
    }

    // jump physics
    if (p.air) {
      p.y += p.vy * dt; p.vy -= 20 * dt;
      if (p.y <= 0) { p.y = 0; p.vy = 0; p.air = false; squashOnLand(p.bean); AU.sLand(); }
    }

    // ---- AI
    for (const e of this.ents) {
      if (e.isPlayer || e.frozen) continue;
      // drop-ins fall to the pitch before joining the game
      if (e.air) {
        e.y += e.vy * dt; e.vy -= 20 * dt;
        if (e.y <= 0) { e.y = 0; e.vy = 0; e.air = false; squashOnLand(e.bean); AU.sLand(); }
        continue;
      }
      this.aiThink(e, dt);
      this.aiMove(e, dt);
    }

    // ---- safe zone (police post refuge): protection drains inside, refills outside
    const sz = this.world.safeZone;
    if (sz) {
      for (const e of this.ents) {
        const inside = dist2(e.x, e.z, sz.x, sz.z) < sz.r * sz.r;
        if (inside && e.team === 'ice' && !e.frozen) {
          e.safeT = Math.max(0, e.safeT - dt);
          if (e.isPlayer && !this.safeInside) { this.safeInside = true; this.onEvent('safe', e); }
          if (e.safeT <= 0) {
            // refuge expired — the post pushes you back out
            const d = Math.sqrt(dist2(e.x, e.z, sz.x, sz.z)) || .01;
            e.x = sz.x + (e.x - sz.x) / d * (sz.r + .4);
            e.z = sz.z + (e.z - sz.z) / d * (sz.r + .4);
            if (e.isPlayer) { this.safeInside = false; this.onEvent('safeout', e); }
          }
        } else {
          e.safeT = Math.min(SAFE_MAX, e.safeT + dt * 1.2);
          if (e.isPlayer && this.safeInside && !inside) this.safeInside = false;
        }
      }
    }
    const protectedIce = (t: Ent) =>
      !!sz && t.safeT > 0 && dist2(t.x, t.z, sz.x, sz.z) < sz.r * sz.r;

    // ---- interactions
    const seen = new Set<string>();
    for (const w of this.waters()) {
      for (const t of this.iceFree()) {
        if (t.y > .45) continue; // hopped over the tag
        const d2 = dist2(w.x, w.z, t.x, t.z);
        if (d2 < TAG_R * TAG_R) {
          if (!protectedIce(t)) this.freeze(t, w);
          continue;
        }
        // arm the pair while they're inside brush distance
        if (d2 < NEAR_R * NEAR_R) {
          this.nearPairs.add(`${this.ents.indexOf(w)}:${this.ents.indexOf(t)}`);
          seen.add(`${this.ents.indexOf(w)}:${this.ents.indexOf(t)}`);
        }
      }
    }
    // an armed pair that separated without a tag = the crowd's "oooOOOH!"
    for (const key of this.nearPairs) {
      if (seen.has(key)) continue;
      this.nearPairs.delete(key);
      const [wi, ti] = key.split(':').map(Number);
      const w = this.ents[wi], t = this.ents[ti];
      if (w && t && !t.frozen && !this.over &&
          dist2(w.x, w.z, t.x, t.z) > NEAR_R * NEAR_R * 1.4) this.nearMiss(w, t);
    }
    for (const a of this.iceFree()) {
      for (const f of this.iceFrozen()) {
        if (a === f) continue;
        if (dist2(a.x, a.z, f.x, f.z) < RESCUE_R * RESCUE_R) this.thaw(f, a);
      }
    }

    // soft push players apart
    for (let i = 0; i < this.ents.length; i++)
      for (let j = i + 1; j < this.ents.length; j++) {
        const a = this.ents[i], b = this.ents[j];
        if (a.frozen || b.frozen) continue;
        const d2 = dist2(a.x, a.z, b.x, b.z);
        if (d2 < .8 * .8 && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (.8 - d) * .5;
          a.x += (a.x - b.x) / d * push; a.z += (a.z - b.z) / d * push;
          b.x -= (a.x - b.x) / d * push; b.z -= (a.z - b.z) / d * push;
        }
      }

    // ---- write to beans + camera
    for (const e of this.ents) {
      e.bean.root.position.set(e.x, e.y, e.z);
      e.bean.root.rotation.y = e.yaw;
      e.ring.visible = !e.frozen;
      animBean(e.bean, dt, Math.hypot(e.vx, e.vz), e.air, e.frozen);
    }
    this.updateCam(dt, inp, cam);
  }

  // ---------- COME SAVE ME ----------
  private pingCrew() {
    this.pingT = 5;
    AU.vTaunt();
    this.onEvent('shout', this.player);
    if (this.pingRing) {
      this.pingRing.position.set(this.player.x, .05, this.player.z);
      this.pingRing.visible = true;
    }
    let snubbed = false;
    for (const e of this.iceFree()) {
      if (e.isPlayer) continue;
      if (e.brave >= .5) { e.tgt = this.player; e.thinkT = 0; }
      else { this.showEmote(e, '…'); snubbed = true; } // the Emekas pretend they didn't hear
      if (e.brave >= .8) AU.vRescue();
    }
    if (snubbed) AU.vDismiss();
  }

  // ---------- inherited moves ----------
  private spawnBackup() {
    // a mate drops in beside you — on YOUR side (militia if you're water)
    const team = this.player.team;
    const def = team === 'ice' ? CREW_DEF : MILITIA_DEF;
    const bean = makeBean(def);
    const x = this.player.x + rand(-2, 2), z = this.player.z + rand(-2, 2);
    bean.root.position.set(x, 14, z); // drops from the sky like you did
    this.scene.add(bean.root);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(.5, .68, 24),
      new THREE.MeshBasicMaterial({ color: team === 'water' ? 0x4dd0e1 : 0xf5efe0, transparent: true, opacity: .8, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = .03;
    bean.root.add(ring);
    const e: Ent = {
      bean, team, isPlayer: false, name: 'BACKUP',
      x, z, y: 14, vx: 0, vz: 0, vy: 0, yaw: 0,
      stamina: 1, frozen: false, air: true, ring,
      brave: .9, skill: this.cfg.aiSkill * 1.1, thinkT: 0, wx: x, wz: z, tgt: null, tags: 0, rescues: 0, safeT: SAFE_MAX,
    };
    this.ents.push(e);
    this.backups.push({ e, t: 14 });
    AU.vRescue();
  }

  // ---------- drops objective ----------
  private updateDrops(dt: number) {
    const p = this.player;
    for (const d of this.drops) {
      if (d.taken) continue;
      d.m.rotation.y += dt * 2.4;
      d.m.position.y = Math.sin((d.x + performance.now() / 900) * 2) * .08 + .05;
      if (!p.frozen && dist2(p.x, p.z, d.x, d.z) < 1.1 * 1.1) {
        d.taken = true; this.scene.remove(d.m); this.dropsGot++;
        AU.sTick(); this.onEvent('drop', p);
        if (this.dropsGot >= this.dropsNeed && !this.twistDone) this.twist();
      }
    }
    if (this.exitRing) {
      this.exitRing.rotation.y += dt;
      const s = 1 + Math.sin(performance.now() / 300) * .1;
      this.exitRing.scale.setScalar(s);
      if (!p.frozen && dist2(p.x, p.z, this.exitX, this.exitZ) < 1.4 * 1.4) { this.onEvent('exit', p); this.end('ice'); }
    }
  }

  private twist() {
    this.twistDone = true;
    this.onEvent('twist', this.player);
    // every drop you left on the ground wakes up — as a hunter
    const mnames = [...MILITIA_NAMES];
    for (const d of this.drops) {
      if (d.taken) continue;
      d.taken = true;
      this.scene.remove(d.m);
      const bean = makeBean(MILITIA_DEF);
      bean.root.position.set(d.x, 10, d.z);
      this.scene.add(bean.root);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(.5, .68, 24),
        new THREE.MeshBasicMaterial({ color: 0x4dd0e1, transparent: true, opacity: .8, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2; ring.position.y = .03;
      bean.root.add(ring);
      this.ents.push({
        bean, team: 'water', isPlayer: false, name: mnames.pop() ?? 'MILITIA',
        x: d.x, z: d.z, y: 10, vx: 0, vz: 0, vy: 0, yaw: 0,
        stamina: 1, frozen: false, air: true, ring,
        brave: .6, skill: this.cfg.aiSkill, thinkT: rand(.4), wx: d.x, wz: d.z, tgt: null, tags: 0, rescues: 0, safeT: SAFE_MAX,
      });
    }
    // the exit — a glowing ring at a wall edge
    const B = this.world.bounds;
    const side = Math.floor(rand(4));
    this.exitX = side === 0 ? B.minX + 1.6 : side === 1 ? B.maxX - 1.6 : rand(B.minX + 4, B.maxX - 4);
    this.exitZ = side === 2 ? B.minZ + 1.6 : side === 3 ? B.maxZ - 1.6 : rand(B.minZ + 4, B.maxZ - 4);
    const g = new THREE.Group();
    const ringM = new THREE.Mesh(
      new THREE.TorusGeometry(1, .16, 10, 28),
      new THREE.MeshStandardMaterial({ color: 0x4ecb71, emissive: 0x1d5c2e, roughness: .3 }),
    );
    ringM.rotation.x = Math.PI / 2;
    g.add(ringM);
    g.position.set(this.exitX, .5, this.exitZ);
    this.scene.add(g);
    this.exitRing = g;
  }

  // ---------- street events ----------
  private nepaOn() {
    // a real blackout takes EVERYTHING — sun, hemisphere, bounce fill AND the
    // sky IBL (scene.environment lights the standard materials more than sun does)
    if (!this.dimmed) {
      this.dimmed = new Map();
      this.scene.traverse((o) => {
        const l = o as THREE.Light;
        if (l.isLight) this.dimmed!.set(l, l.intensity);
      });
      for (const [l, i] of this.dimmed) l.intensity = i * .12;
      this.envI = this.scene.environmentIntensity;
      this.scene.environmentIntensity = .05;
      const fog = this.scene.fog as THREE.Fog;
      this.fogNear = fog.near; this.fogHex = fog.color.getHex();
      fog.near = 32; fog.color.setHex(0x111a2a);
      if (this.scene.background instanceof THREE.Color) {
        this.bgHex = this.scene.background.getHex();
        this.scene.background.setHex(0x0c1320);
      }
    }
    this.torch = new THREE.PointLight(0xffc98a, 4, 16);
    this.torch.position.set(this.player.x, 2.6, this.player.z);
    this.scene.add(this.torch);
    AU.vNepa();
    if (!this.persistNepa) this.nepaTimer = setTimeout(() => this.nepaOff(), 6000);
  }
  private restoreLights() {
    if (!this.dimmed) return;
    for (const [l, i] of this.dimmed) l.intensity = i;
    this.dimmed = null;
    this.scene.environmentIntensity = this.envI;
    const fog = this.scene.fog as THREE.Fog;
    fog.near = this.fogNear; fog.color.setHex(this.fogHex);
    if (this.scene.background instanceof THREE.Color && this.bgHex !== null)
      this.scene.background.setHex(this.bgHex);
  }
  private nepaOff() {
    this.restoreLights();
    if (this.torch) { this.scene.remove(this.torch); this.torch = null; }
    AU.vUpNepa();
    this.eventT = 0; this.event = 'none';
  }
  private rainOn() {
    const geo = new THREE.BufferGeometry();
    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rand(-30, 30); pos[i * 3 + 1] = rand(0, 26); pos[i * 3 + 2] = rand(-30, 30);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rainPts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xbfdcff, size: .12, transparent: true, opacity: .75 }));
    this.scene.add(this.rainPts);
    AU.vRain();
    if (!this.mut.rain) {
      this.rainTimer = setTimeout(() => {
        if (this.rainPts) { this.scene.remove(this.rainPts); this.rainPts = null; }
        this.event = 'none';
      }, 9000);
    }
  }
  private rainFall(dt: number, p: Ent) {
    const pos = this.rainPts!.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) - dt * 22;
      if (y < 0) { y = rand(20, 26); pos.setX(i, p.x + rand(-30, 30)); pos.setZ(i, p.z + rand(-30, 30)); }
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
  }

  private updateCam(dt: number, inp: InputState, cam: THREE.PerspectiveCamera) {
    this.camYaw += inp.camDelta;
    this.camDist = clamp(this.camDist + inp.zoomDelta * 1.4, 10, 24);
    const p = this.player;
    // look ahead of velocity
    const lx = p.x + p.vx * .35, lz = p.z + p.vz * .35;
    const ty = 7.2 + this.camDist * .38;
    const tx = lx + Math.sin(this.camYaw) * this.camDist;
    const tz = lz + Math.cos(this.camYaw) * this.camDist;
    const k = 1 - Math.exp(-5 * dt);
    this.camPos.x = lerp(this.camPos.x, tx, k);
    this.camPos.y = lerp(this.camPos.y, ty, k);
    this.camPos.z = lerp(this.camPos.z, tz, k);
    cam.position.copy(this.camPos);
    if (this.shakeT > 0) {
      const a = this.shakeAmp * (this.shakeT / .4);
      cam.position.x += rand(-a, a);
      cam.position.y += rand(-a, a) * .6;
      cam.position.z += rand(-a, a);
    }
    cam.lookAt(lx, 1, lz);
  }

  /** intro flyover before countdown */
  introCam(t: number, cam: THREE.PerspectiveCamera) {
    const a = t * .25;
    cam.position.set(Math.sin(a) * 34, 22 - t * 3.4, Math.cos(a) * 34);
    cam.lookAt(0, 1, 0);
    this.camYaw = Math.atan2(cam.position.x - this.player.x, cam.position.z - this.player.z) + Math.PI;
    this.camPos.copy(cam.position);
  }

  get iceFreeCount() { return this.iceFree().length; }
  get iceFrozenCount() { return this.iceFrozen().length; }
}
