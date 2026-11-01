// PitchStage — the 3D playground layer. The Phaser scenes keep the whole
// sim (physics, tagging, objectives, HUD); this renders the street /
// school world + bean cast on a Three.js canvas behind the transparent
// game canvas. All public coordinates are PHASER PIXELS — the stage maps
// to world units internally.
import * as THREE from 'three';
import { makeBean, animBean, setFrozen, ensureEnv, emoteTexture, type Bean, type Bean3DModel } from './bean';
import { buildWorld, buildSchool, updateWorld, disposeWorld, type World, type MapId } from './world';
import { clamp, lerp, pick } from './util';
import type { CamView } from '../meta';

const SCALE = 44;          // px per world unit — arena ~1619x2411 on street
const PROP_COLS = [0x8a5a2a, 0x5d6b73, 0x1c1c1e, 0x74563c];

// camera presets — dist/height are the base rig; the user's Range pick and
// the drag/pinch deviators stack multiplicatively on top of dist
const CAM_PRESETS: Record<CamView, { dist: number; height: number; fov: number }> = {
  third: { dist: 7.5, height: 3.4, fov: 56 },   // over the shoulder
  classic: { dist: 13, height: 9.5, fov: 50 },  // the chase cam
  wide: { dist: 20, height: 17.5, fov: 48 },    // near top-down — the old 2D read
};

interface Ent3D {
  root: THREE.Group;
  bean: Bean | null;
  bb?: {
    sprite: THREE.Sprite;
    tex: THREE.Texture;
    marker: THREE.Sprite;
    emote: THREE.Sprite;
    t: number;
    frames: number;
    rows: number;   // facing rows on the strip (1 = legacy front-only)
    row: number;    // active row — picked from screen-space travel dir
  };
  ring: THREE.Mesh;
  x: number; y: number;   // phaser px
  vx: number; vy: number;
  frozen: boolean;
  scale: number;          // boss 1.45, iceling .55 — animBean owns root.scale so this multiplies on top
  label?: Phaser.GameObjects.Text; // scene may anchor its own text via project()
}

/** a baked bean strip (beanbake.ts) — ents wear it as a 2.5D billboard
 *  instead of the 3D rig: our sprite design standing in the street */
export interface SheetDef {
  canvas: HTMLCanvasElement;
  frames: number; // cells per row (14 = run/idle/splat cycle)
  rows: number;   // facing rows: 0 front, 1 left, 2 back, 3 right
}

export class PitchStage {
  private static inst: PitchStage | null = null;
  static get(): PitchStage {
    if (!PitchStage.inst) PitchStage.inst = new PitchStage();
    return PitchStage.inst;
  }

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private canvas!: HTMLCanvasElement;
  private world: World | null = null;
  private mapId: MapId = 'street';
  private ents = new Map<number, Ent3D>();
  private nextId = 1;
  private pickups = new Map<number, THREE.Object3D>();
  private nextPickup = 1;
  private props: THREE.Object3D[] = [];
  private busMesh: THREE.Group | null = null;
  private exitMesh: THREE.Mesh | null = null;
  private refugeMesh: THREE.Mesh | null = null;

  // arena rect this map occupies in PHASER px (walls included)
  arenaW = 0; arenaH = 0;
  // px → world scale per axis — same value for the solo game; the net
  // scene maps the server's landscape arena onto the portrait pitch
  private sX = SCALE;
  private sZ = SCALE;
  // camera rig
  private camYaw = 0;            // drag offset
  private camPitch = 1;
  private camDist = 1;
  private camView: CamView = 'classic'; // Settings › GAME › View preset
  private camRange = 1;                 // Settings › GAME › Range (0.7–1.6)
  private camX = 0; private camZ = 0;
  private shakeT = 0; private shakeAmp = 0;
  // NEPA / rain
  private dimmed: Map<THREE.Light, number> | null = null;
  private envI = 1;
  private bgHex: number | null = null;
  private fogHex = 0xe8c9a0; private fogNear = 70;
  private torch: THREE.PointLight | null = null;
  private torchX = 0; private torchZ = 0;
  private rainPts: THREE.Points | null = null;

  private constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'stage3d';
    this.canvas.style.cssText =
      'position:fixed;inset:0;width:100vw;height:100vh;z-index:0;display:none;';
    document.body.prepend(this.canvas); // behind the Phaser canvas
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe8c9a0);
    this.camera = new THREE.PerspectiveCamera(50, 1, .1, 300);
    ensureEnv(this.renderer, this.scene);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  show() { this.canvas.style.display = 'block'; this.resize(); }
  hide() { this.canvas.style.display = 'none'; }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- coordinate mapping ----------
  toWX(px: number) { return (px - this.arenaW / 2) / this.sX; }
  toWZ(py: number) { return (py - this.arenaH / 2) / this.sZ; }
  toPX(wx: number) { return this.arenaW / 2 + wx * this.sX; }
  toPY(wz: number) { return this.arenaH / 2 + wz * this.sZ; }
  get pxPerUnit() { return this.sX; }

  /** map an arbitrary phaser-space rect onto the pitch — the online scene's
   *  server arena (landscape) squeezes onto the street (portrait) */
  setPxSpace(w: number, h: number) {
    this.arenaW = w;
    this.arenaH = h;
    const b = this.world!.bounds;
    this.sX = w / (b.maxX - b.minX + 2.8);
    this.sZ = h / (b.maxZ - b.minZ + 2.8);
    return this.mapInfo();
  }
  private mapInfo() {
    const w = this.world!;
    return {
      arenaW: this.arenaW,
      arenaH: this.arenaH,
      obstacles: w.obstacles.map((o) => ({ x: this.toPX(o.x), y: this.toPY(o.z), r: o.r * this.sX })),
      safeZone: w.safeZone ? { x: this.toPX(w.safeZone.x), y: this.toPY(w.safeZone.z), r: w.safeZone.r * this.sX } : null,
    };
  }

  // ---------- world ----------
  /** (re)build a map; returns arena size + obstacles in PHASER px */
  buildMap(id: MapId = 'street'): {
    arenaW: number; arenaH: number;
    obstacles: { x: number; y: number; r: number }[];
    safeZone: { x: number; y: number; r: number } | null;
  } {
    if (this.world) { disposeWorld(this.scene, this.world); this.world = null; }
    this.mapId = id;
    const w = id === 'school' ? buildSchool(this.scene) : buildWorld(this.scene);
    this.world = w;
    this.restoreLights();
    const b = w.bounds;
    // arena = playable pitch + a 1.4u apron so entities can't leave the walls
    this.sX = this.sZ = SCALE;
    this.arenaW = Math.round((b.maxX - b.minX + 2.8) * SCALE);
    this.arenaH = Math.round((b.maxZ - b.minZ + 2.8) * SCALE);
    return this.mapInfo();
  }
  worldBoundsPx() {
    const b = this.world!.bounds;
    return {
      minX: this.toPX(b.minX), maxX: this.toPX(b.maxX),
      minY: this.toPY(b.minZ), maxY: this.toPY(b.maxZ),
    };
  }

  /** a cover prop standing in for one generated physics rect */
  addProp(px: number, py: number, w: number, h: number): void {
    const uw = Math.max(w, 20) / SCALE, uh = Math.max(h, 20) / SCALE;
    let o: THREE.Object3D;
    if (Math.abs(uw - uh) < .5 && uw < 1.4) {
      // squarish small cover → tyre stack
      const g = new THREE.Group();
      const m = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: .95 });
      const n = Math.max(1, Math.round(uw * 2));
      for (let i = 0; i < n; i++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(.38, .16, 8, 16), m);
        t.rotation.x = Math.PI / 2;
        t.position.y = .16 + i * .28;
        t.castShadow = true;
        g.add(t);
      }
      g.position.set(this.toWX(px), 0, this.toWZ(py));
      o = g;
    } else {
      // rectangular cover → crate / low wall block
      const m = new THREE.MeshStandardMaterial({ color: pick(PROP_COLS), roughness: .95 });
      const mh = clamp(Math.min(uw, uh) * .8, .4, 1.6);
      o = new THREE.Mesh(new THREE.BoxGeometry(uw, mh, uh), m);
      o.position.set(this.toWX(px), mh / 2, this.toWZ(py));
      (o as THREE.Mesh).castShadow = true;
    }
    this.scene.add(o);
    this.props.push(o);
  }
  clearProps() {
    for (const p of this.props) this.scene.remove(p);
    this.props = [];
  }

  // ---------- entities ----------
  spawnEnt(model: Bean3DModel, ringColor: number, px: number, py: number, sheet?: SheetDef): number {
    let bean: Bean | null = null;
    let bb: Ent3D['bb'];
    let root: THREE.Group;
    if (sheet) {
      root = new THREE.Group();
      const tex = new THREE.CanvasTexture(sheet.canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.repeat.set(1 / sheet.frames, 1 / sheet.rows);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        alphaTest: .02, // cut fully-empty texels so their depth doesn't punch holes
      }));
      sprite.center.set(.5, .12); // baked feet land on the ground plane
      sprite.scale.set(1.9, 1.9, 1);
      const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: emoteTexture('!', '#ffd25e'), depthTest: false }));
      marker.scale.setScalar(.5); marker.position.y = 1.9; marker.visible = false;
      const emote = new THREE.Sprite(new THREE.SpriteMaterial({ map: emoteTexture('…'), depthTest: false, transparent: true }));
      emote.scale.setScalar(.42); emote.position.y = 1.9; emote.visible = false;
      root.add(sprite, marker, emote);
      bb = { sprite, tex, marker, emote, t: Math.random() * 10, frames: sheet.frames, rows: sheet.rows, row: 0 };
    } else {
      bean = makeBean(model);
      root = bean.root;
    }
    root.position.set(this.toWX(px), 0, this.toWZ(py));
    this.scene.add(root);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(.5, .66, 24),
      new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: .85, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = .04;
    root.add(ring);
    const id = this.nextId++;
    this.ents.set(id, { root, bean, bb, ring, x: px, y: py, vx: 0, vy: 0, frozen: false, scale: 1 });
    return id;
  }
  scaleEnt(id: number, s: number) {
    const e = this.ents.get(id);
    if (e) e.scale = s;
  }
  syncEnt(id: number, px: number, py: number, vx = 0, vy = 0, frozen?: boolean) {
    const e = this.ents.get(id);
    if (!e) return;
    e.x = px; e.y = py; e.vx = vx; e.vy = vy;
    if (frozen !== undefined && frozen !== e.frozen) {
      e.frozen = frozen;
      if (e.bean) setFrozen(e.bean, frozen);
      else if (e.bb) e.bb.marker.visible = frozen; // splat frames carry the ice
    }
  }
  setEmote(id: number, txt: string | null) {
    const e = this.ents.get(id);
    const emote = e?.bean ? e.bean.emote : e?.bb?.emote;
    if (!e || !emote) return;
    if (txt) {
      (emote.material as THREE.SpriteMaterial).map = emoteTexture(txt);
      emote.visible = true;
    } else emote.visible = false;
  }
  removeEnt(id: number) {
    const e = this.ents.get(id);
    if (!e) return;
    this.scene.remove(e.root);
    if (e.bb) {
      e.bb.tex.dispose(); // per-ent CanvasTexture over the shared strip
      (e.bb.sprite.material as THREE.Material).dispose();
      // marker/emote MAPS are texCache-shared — dispose materials only
      (e.bb.marker.material as THREE.Material).dispose();
      (e.bb.emote.material as THREE.Material).dispose();
    }
    this.ents.delete(id);
  }
  clearEnts() { for (const id of [...this.ents.keys()]) this.removeEnt(id); }
  entScreenPos(id: number): { x: number; y: number } | null {
    const e = this.ents.get(id);
    return e ? this.project(e.x, e.y, 2.1) : null;
  }

  // ---------- pickups / markers ----------
  private dropMesh(kind: string): THREE.Object3D {
    if (kind === 'water' || kind === 'collect' || kind === 'decoy') {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(.34, 0),
        new THREE.MeshStandardMaterial({ color: kind === 'decoy' ? 0x8fb8c8 : 0x4dd0e1, roughness: .2, metalness: .1 }));
      return m;
    }
    if (kind === 'charm') {
      return new THREE.Mesh(new THREE.OctahedronGeometry(.34, 0),
        new THREE.MeshStandardMaterial({ color: 0xd9a02a, roughness: .3, metalness: .4 }));
    }
    if (kind === 'slippers') {
      const g = new THREE.Group();
      const m = new THREE.MeshStandardMaterial({ color: 0xd84f2e, roughness: .8 });
      for (const sx of [-.16, .16]) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(.18, .06, .46), m);
        s.position.set(sx, .03, 0); s.castShadow = true;
        g.add(s);
      }
      return g;
    }
    return new THREE.Mesh(new THREE.SphereGeometry(.3, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xf5efe0, roughness: .7 }));
  }
  addPickup(px: number, py: number, kind: string): number {
    const m = this.dropMesh(kind);
    m.position.set(this.toWX(px), .55, this.toWZ(py));
    this.scene.add(m);
    const id = this.nextPickup++;
    this.pickups.set(id, m);
    return id;
  }
  removePickup(id: number) {
    const m = this.pickups.get(id);
    if (m) { this.scene.remove(m); this.pickups.delete(id); }
  }
  clearPickups() { for (const id of [...this.pickups.keys()]) this.removePickup(id); }

  /** the glowing exit ring (twist end / objective exit) */
  showExit(px: number, py: number, on: boolean) {
    if (on && !this.exitMesh) {
      this.exitMesh = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.3, 36),
        new THREE.MeshBasicMaterial({ color: 0x4ecb71, transparent: true, opacity: .75, depthWrite: false, side: THREE.DoubleSide }));
      this.exitMesh.rotation.x = -Math.PI / 2;
      this.scene.add(this.exitMesh);
    }
    if (this.exitMesh) {
      this.exitMesh.visible = on;
      this.exitMesh.position.set(this.toWX(px), .05, this.toWZ(py));
    }
  }
  showRefuge(px: number, py: number, r: number, on: boolean) {
    if (on && !this.refugeMesh) {
      this.refugeMesh = new THREE.Mesh(new THREE.RingGeometry(.8, 1, 40),
        new THREE.MeshBasicMaterial({ color: 0x4dd0e1, transparent: true, opacity: .5, depthWrite: false, side: THREE.DoubleSide }));
      this.refugeMesh.rotation.x = -Math.PI / 2;
      this.scene.add(this.refugeMesh);
    }
    if (this.refugeMesh) {
      this.refugeMesh.visible = on;
      this.refugeMesh.scale.setScalar(r / SCALE);
      this.refugeMesh.position.set(this.toWX(px), .05, this.toWZ(py));
    }
  }

  /** drive a moving prop — the danfo bus hazard */
  setBus(px: number, py: number, angle = 0) {
    if (!this.busMesh) {
      const g = new THREE.Group();
      const yellow = new THREE.MeshStandardMaterial({ color: 0xf2b70d, roughness: .5 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.7, 5.6), yellow);
      body.position.y = 1.15; body.castShadow = true;
      g.add(body);
      const win = new THREE.Mesh(new THREE.BoxGeometry(2.24, .5, 5.4),
        new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: .3 }));
      win.position.y = 1.55; g.add(win);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.24, .14, 5.6),
        new THREE.MeshStandardMaterial({ color: 0x1d1d1d }));
      stripe.position.y = .78; g.add(stripe);
      const wg = new THREE.CylinderGeometry(.42, .42, .3, 14);
      const wm = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: .9 });
      for (const [wx, wz] of [[-1.05, -1.8], [1.05, -1.8], [-1.05, 1.8], [1.05, 1.8]]) {
        const w = new THREE.Mesh(wg, wm);
        w.rotation.z = Math.PI / 2; w.position.set(wx, .42, wz);
        g.add(w);
      }
      this.busMesh = g;
      this.scene.add(g);
    }
    this.busMesh.position.set(this.toWX(px), 0, this.toWZ(py));
    this.busMesh.rotation.y = angle;
  }
  hideBus() { if (this.busMesh) { this.scene.remove(this.busMesh); this.busMesh = null; } }

  // ---------- weather / light ----------
  nepa(on: boolean, px = 0, py = 0) {
    // power cut kills the sky too — the dark fog + background take over
    if (this.world?.sky) this.world.sky.visible = !on;
    if (on) {
      if (!this.dimmed) {
        this.dimmed = new Map();
        this.scene.traverse((o) => {
          const l = o as THREE.Light;
          if (l.isLight && l !== this.torch) this.dimmed!.set(l, l.intensity);
        });
        for (const [l, i] of this.dimmed) l.intensity = i * .12;
        this.envI = this.scene.environmentIntensity;
        this.scene.environmentIntensity = .05;
        const fog = this.scene.fog as THREE.Fog;
        if (fog) { this.fogNear = fog.near; this.fogHex = fog.color.getHex(); fog.near = 32; fog.color.setHex(0x111a2a); }
        if (this.scene.background instanceof THREE.Color) {
          this.bgHex = this.scene.background.getHex();
          this.scene.background.setHex(0x0c1320);
        }
      }
      if (!this.torch) {
        this.torch = new THREE.PointLight(0xffc98a, 4, 16);
        this.scene.add(this.torch);
      }
      this.torchX = this.toWX(px); this.torchZ = this.toWZ(py);
      this.torch.position.set(this.torchX, 2.6, this.torchZ);
    } else {
      this.restoreLights();
      if (this.torch) { this.scene.remove(this.torch); this.torch = null; }
    }
  }
  private restoreLights() {
    if (!this.dimmed) return;
    for (const [l, i] of this.dimmed) l.intensity = i;
    this.dimmed = null;
    this.scene.environmentIntensity = this.envI;
    const fog = this.scene.fog as THREE.Fog;
    if (fog) { fog.near = this.fogNear; fog.color.setHex(this.fogHex); }
    if (this.scene.background instanceof THREE.Color && this.bgHex !== null)
      this.scene.background.setHex(this.bgHex);
  }
  rain(on: boolean) {
    if (on && !this.rainPts) {
      const n = 700, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() - .5) * 60;
        pos[i * 3 + 1] = Math.random() * 26;
        pos[i * 3 + 2] = (Math.random() - .5) * 60;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.rainPts = new THREE.Points(geo, new THREE.PointsMaterial({
        color: 0xbfdcff, size: .12, transparent: true, opacity: .75 }));
      this.scene.add(this.rainPts);
    } else if (!on && this.rainPts) {
      this.scene.remove(this.rainPts); this.rainPts = null;
    }
  }

  // ---------- camera ----------
  orbit(dx: number, dy: number) {
    this.camYaw = clamp(this.camYaw - dx * .005, -1.2, 1.2);
    this.camPitch = clamp(this.camPitch + dy * .004, .6, 1.5);
  }
  zoomBy(d: number) { this.camDist = clamp(this.camDist + d * .002, .7, 1.6); }
  resetOrbit() { this.camYaw = 0; this.camPitch = 1; this.camDist = 1; }
  setView(v: CamView) { this.camView = v; }          // preset swap — fov eases over in updateCam
  setRange(pct: number) { this.camRange = clamp(pct / 100, .7, 1.6); }

  /** screen-space intent (px) → camera-relative: "up" is always up-screen
   *  even after orbiting. Same formula in phaser-px space since +px→+X, +py→+Z */
  rotateInput(x: number, y: number) {
    const c = Math.cos(this.camYaw), s = Math.sin(this.camYaw);
    return { x: x * c + y * s, y: -x * s + y * c };
  }
  shake(amp = .5) { this.shakeT = .3; this.shakeAmp = amp; }

  private camTarget = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private updateCam(dt: number, fx: number, fy: number) {
    const tx = this.toWX(fx), tz = this.toWZ(fy);
    const yaw = this.camYaw, pitch = this.camPitch;
    const p = CAM_PRESETS[this.camView];
    const dist = p.dist * this.camDist * this.camRange, h = p.height * pitch;
    this.camPos.set(
      tx + Math.sin(yaw) * dist,
      h,
      tz + Math.cos(yaw) * dist);
    // ease the fov toward the active preset — a hard jump on swap reads as a pop
    if (Math.abs(this.camera.fov - p.fov) > 0.05) {
      this.camera.fov += (p.fov - this.camera.fov) * Math.min(1, dt * 6);
      this.camera.updateProjectionMatrix();
    }
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const s = this.shakeAmp * this.shakeT;
      this.camPos.x += (Math.random() - .5) * s;
      this.camPos.y += (Math.random() - .5) * s * .6;
    }
    this.camera.position.lerp(this.camPos, Math.min(1, dt * 8));
    this.camTarget.set(tx, 1, tz);
    this.camera.lookAt(this.camTarget);
  }

  /** phaser px → CSS screen px, for anchoring name labels / popups */
  private projV = new THREE.Vector3();
  project(px: number, py: number, h = 1.6): { x: number; y: number } {
    this.projV.set(this.toWX(px), h, this.toWZ(py)).project(this.camera);
    return {
      x: (this.projV.x * .5 + .5) * innerWidth,
      y: (-this.projV.y * .5 + .5) * innerHeight,
    };
  }

  // ---------- per-frame ----------
  render(dt: number, followX?: number, followY?: number) {
    if (this.world) updateWorld(this.world, dt);
    const t = performance.now() / 1000;
    for (const e of this.ents.values()) {
      e.root.position.set(this.toWX(e.x), e.root.position.y, this.toWZ(e.y));
      const speedPx = Math.hypot(e.vx, e.vy);
      if (e.bb) {
        // 2.5D billboard — sheet frames do the acting: run 0–7 @13,
        // idle 8–11 @6, splat 12–13 @5 (frozen). The row shows the side
        // facing travel — front/left/back/right, measured in SCREEN space
        // so orbiting the cam keeps the facing honest.
        const bb = e.bb;
        bb.t += dt;
        bb.row = 0;
        if (!e.frozen && speedPx > 26 && bb.rows > 1) {
          const p0 = this.project(e.x, e.y, 1);
          const p1 = this.project(e.x + e.vx * 0.04, e.y + e.vy * 0.04, 1);
          const a = Math.atan2(p1.y - p0.y, p1.x - p0.x); // screen, +y down
          bb.row =
            Math.abs(a) > (3 * Math.PI) / 4 ? 1 : // left
            a > Math.PI / 4 ? 0 :                 // down-screen → front
            a > -Math.PI / 4 ? 3 :                // right
            2;                                    // up-screen → back
        }
        const [base, fps, count] = e.frozen ? [12, 5, 2] : speedPx > 26 ? [0, 13, 8] : [8, 6, 4];
        bb.tex.offset.x = (base + (Math.floor(bb.t * fps) % count)) / bb.frames;
        bb.tex.offset.y = 1 - (bb.row + 1) / bb.rows;
        bb.sprite.scale.set(1.9 * e.scale, 1.9 * e.scale, 1);
        continue;
      }
      const b = e.bean!;
      const speed = speedPx / SCALE;
      if (speed > .3 && !e.frozen) {
        const yaw = Math.atan2(e.vx / SCALE, e.vy / SCALE);
        let d = yaw - b.root.rotation.y;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        b.root.rotation.y += d * Math.min(1, dt * 10);
      }
      animBean(b, dt, speed, false, e.frozen);
      // frozen early-returns inside animBean before its squash reset —
      // normalize or the scale multiply below compounds every frame
      if (e.frozen) b.root.scale.set(1, 1, 1);
      if (e.scale !== 1) b.root.scale.multiplyScalar(e.scale);
    }
    // pickups bob + spin
    for (const m of this.pickups.values()) {
      m.rotation.y += dt * 2;
      m.position.y = .55 + Math.sin(t * 3 + m.id) * .1;
    }
    if (this.exitMesh?.visible) this.exitMesh.rotation.z += dt * .8;
    if (this.rainPts) {
      const pos = this.rainPts.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - dt * 18;
        if (y < 0) y = 26;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }
    if (followX !== undefined && followY !== undefined) this.updateCam(dt, followX, followY);
    this.renderer.render(this.scene, this.camera);
  }
}
