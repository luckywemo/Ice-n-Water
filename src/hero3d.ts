// Real-time 3D podium hero — the naked bean: glossy chocolate-brown
// vinyl body, pale tan face oval, tall black eyes, droopy arms with
// hand nubs, molded same-material feet. Clearcoat physical material +
// room environment reflections for the toy-render sheen. Renders into
// an offscreen canvas that the scene wraps in a Phaser texture.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import { REDUCED_MOTION } from './ui';

const BODY = 0x8a4f24; // glossy milk-chocolate brown
const SKIN = 0xecc98e; // warm pale tan face oval
const DARK = 0x160c08; // eyes

export class Hero3D {
  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private group?: THREE.Group;
  private mc?: MarchingCubes;
  private eyeL?: THREE.Mesh;
  private eyeR?: THREE.Mesh;
  private armLag = 0; // smoothed arm droop, lags the squash spring
  // --- animation state ---
  private sq = 0; // jelly: + stretch, − squash
  private sqVel = 0;
  private hopY = 0;
  private hopV = 0;
  private gx = 0; // gaze −1..1
  private gy = 0;
  private blinkUntil = 0;
  private nextBlink = 2400;
  private nextHop = 5200;
  private lastT = -1;
  ok = false;

  /** cursor follow — normalized −1..1 from screen centre */
  setGaze(x: number, y: number) {
    this.gx = Math.max(-1, Math.min(1, x));
    this.gy = Math.max(-1, Math.min(1, y));
  }

  /** poke reaction — deep squash + a little startle hop */
  poke() {
    this.sqVel -= 4.2;
    if (this.hopY === 0) this.hopV = 1.5;
  }

  get canvas(): HTMLCanvasElement | undefined {
    return this.renderer?.domElement;
  }

  constructor(w: number, h: number) {
    try {
      // own offscreen canvas — the scene reads it into a canvas texture
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      return;
    }
    // 1:1 — the buffer is re-uploaded as a Phaser texture every frame;
    // pixelRatio>1 would multiply that upload for no visible gain
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = (this.scene = new THREE.Scene());
    const grp = (this.group = new THREE.Group());
    scene.add(grp);

    const mat = (color: number, rough = 0.5) =>
      new THREE.MeshPhysicalMaterial({
        color,
        roughness: rough,
        metalness: 0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.18,
      });
    const mesh = (
      geo: THREE.BufferGeometry,
      m: THREE.Material,
      x = 0,
      y = 0,
      z = 0,
    ) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z);
      grp.add(o);
      return o;
    };

    const body = mat(BODY, 0.3);
    const skin = mat(SKIN, 0.38);
    const dark = mat(DARK, 0.25);

    // the bean — one fused metaball surface: torso + belly + crown +
    // arm chains + hands with finger nubs + feet, all one continuous
    // skin. Rebuilt per-frame in update() so squash jiggles organically.
    this.mc = new MarchingCubes(48, body, false, false, 80000);
    this.mc.isolation = 80;
    // MC emits verts in a [-1,1] box — scale is half-extents
    this.mc.scale.set(0.82, 1.15, 0.78);
    this.mc.position.set(0, 1.08, 0);
    grp.add(this.mc);
    this.buildBody();

    // face oval — pale patch in the upper third, ~55% of body width
    mesh(new THREE.SphereGeometry(0.44, 30, 24), skin, 0, 1.55, 0.58).scale.set(0.52, 0.68, 0.28);
    // eyes — two tall thin dark ovals, close-set
    const eye = (x: number) => {
      const m = mesh(new THREE.SphereGeometry(0.065, 14, 12), dark, x, 1.55, 0.7);
      m.scale.set(0.55, 1.45, 0.45);
      return m;
    };
    this.eyeL = eye(-0.16);
    this.eyeR = eye(0.16);

    // soft contact shadow — grounds the feet on the podium
    const shC = document.createElement('canvas');
    shC.width = shC.height = 128;
    const sg = shC.getContext('2d')!;
    const grad = sg.createRadialGradient(64, 64, 6, 64, 64, 62);
    grad.addColorStop(0, 'rgba(20,10,5,0.4)');
    grad.addColorStop(0.6, 'rgba(20,10,5,0.18)');
    grad.addColorStop(1, 'rgba(20,10,5,0)');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 1.4),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(shC),
        transparent: true,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.005, 0.15);
    grp.add(shadow);

    // environment reflections — the toy-render sheen lives here
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // studio lighting — key high left-front so the crown catches its streak
    scene.add(new THREE.HemisphereLight(0xffffff, 0x4a3828, 0.9));
    const key = new THREE.DirectionalLight(0xfff2dd, 2.4);
    key.position.set(-2.4, 4.6, 3.2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xcfe4ff, 1.0);
    rim.position.set(3, 2.2, -2.6);
    scene.add(rim);

    this.camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 20);
    this.camera.position.set(0, 1.12, 4.45);
    this.camera.lookAt(0, 1.08, 0);

    this.ok = true;
  }

  /** Rebuild the metaball field — positions live in [0,1] field space */
  private buildBody() {
    const mc = this.mc;
    if (!mc) return;
    mc.reset();
    const b = (x: number, y: number, z: number, s: number) => mc.addBall(x, y, z, s, 14);
    const lag = this.armLag * 0.05; // arms trail the squash a beat
    // torso — a fat vertical chain; the base blob clips the field floor
    // flat, and two foot nubs poke out at the front like the reference
    b(0.5, 0.14, 0.52, 2.1); // flat base
    b(0.5, 0.32, 0.52, 2.6); // belly
    b(0.5, 0.5, 0.5, 2.6); // core
    b(0.5, 0.65, 0.5, 2.3); // chest
    b(0.5, 0.77, 0.5, 1.7); // crown cap
    for (const sx of [-1, 1] as const) {
      b(0.5 + sx * 0.3, 0.66 + lag, 0.5, 0.9); // shoulder
      b(0.5 + sx * 0.37, 0.5 + lag * 1.6, 0.51, 0.75); // upper arm
      b(0.5 + sx * 0.41, 0.36 + lag * 2.2, 0.52, 0.6); // wrist
      b(0.5 + sx * 0.425, 0.28 + lag * 2.6, 0.53, 0.5); // hand
      b(0.5 + sx * 0.45, 0.245 + lag * 2.8, 0.55, 0.22); // finger nubs
      b(0.5 + sx * 0.425, 0.225 + lag * 2.8, 0.56, 0.22);
      b(0.5 + sx * 0.4, 0.245 + lag * 2.8, 0.55, 0.22);
      b(0.5 + sx * 0.2, 0.05, 0.6, 0.5); // foot
      b(0.5 + sx * 0.2, 0.035, 0.68, 0.3); // toe
    }
    mc.update();
  }

  update(t: number) {
    if (!this.renderer || !this.scene || !this.camera || !this.group) return;
    const dt = this.lastT < 0 ? 0.016 : Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    const s = t / 1000;
    const grp = this.group;
    const idle = REDUCED_MOTION ? 0 : 1;

    // jelly spring — squash(−)/stretch(+), roughly volume-preserving; the
    // group's origin sits at the feet so the plant stays grounded
    this.sqVel += (-170 * this.sq - 11 * this.sqVel) * dt;
    this.sq = Math.max(-0.38, Math.min(0.5, this.sq + this.sqVel * dt));
    grp.scale.set(1 - this.sq * 0.5, 1 + this.sq, 1 - this.sq * 0.45);
    this.armLag += (this.sq - this.armLag) * Math.min(1, dt * 7);
    this.buildBody();

    // scheduled hop — stretch at take-off, squash on landing
    if (!REDUCED_MOTION && t > this.nextHop) {
      this.nextHop = t + 5200 + Math.random() * 5200;
      if (this.hopY === 0) {
        this.hopV = 2.7;
        this.sqVel += 2.2;
      }
    }
    if (this.hopV !== 0 || this.hopY > 0) {
      this.hopY += this.hopV * dt;
      this.hopV -= 10 * dt;
      if (this.hopY <= 0) {
        this.hopY = 0;
        this.sqVel += this.hopV * 0.85;
        this.hopV = 0;
      }
    }

    // blink — a fast lid dip every 2–5s
    if (t > this.nextBlink) {
      this.nextBlink = t + 2200 + Math.random() * 3400;
      this.blinkUntil = t + 130;
    }
    const lids = t < this.blinkUntil ? 0.12 : 1.45;
    if (this.eyeL) this.eyeL.scale.y = lids;
    if (this.eyeR) this.eyeR.scale.y = lids;

    // gaze — eyes drift, body leans toward the cursor
    if (this.eyeL) {
      this.eyeL.position.x = -0.1 + this.gx * 0.04;
      this.eyeL.position.y = 1.55 + this.gy * 0.04;
    }
    if (this.eyeR) {
      this.eyeR.position.x = 0.1 + this.gx * 0.04;
      this.eyeR.position.y = 1.55 + this.gy * 0.04;
    }

    // idle — breathing bob, slow sway, gaze lean
    grp.position.y = Math.sin(s * 1.6) * 0.045 * idle + this.hopY;
    grp.rotation.y = Math.sin(s * 0.7) * 0.18 * idle + this.gx * 0.22;
    grp.rotation.z = Math.sin(s * 1.1) * 0.02 * idle - this.gx * 0.06;

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer?.dispose();
    this.scene?.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mm = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
      else mm?.dispose?.();
    });
    this.renderer = undefined;
    this.scene = undefined;
    this.camera = undefined;
    this.group = undefined;
  }
}
