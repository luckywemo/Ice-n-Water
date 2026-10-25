// Real-time 3D podium hero — the naked bean: glossy chocolate-brown
// vinyl body, pale tan face oval, tall black eyes, droopy arms with
// hand nubs, molded same-material feet. Clearcoat physical material +
// room environment reflections for the toy-render sheen. Renders into
// an offscreen canvas that the scene wraps in a Phaser texture.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { REDUCED_MOTION } from './ui';

const BODY = 0x8a4f24; // glossy milk-chocolate brown
const SKIN = 0xecc98e; // warm pale tan face oval
const DARK = 0x160c08; // eyes

export class Hero3D {
  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private group?: THREE.Group;
  private torso?: THREE.Mesh;
  private armL?: THREE.Mesh;
  private armR?: THREE.Mesh;
  private eyeL?: THREE.Mesh;
  private eyeR?: THREE.Mesh;
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
  private yaw = 0; // user spin
  private yawVel = 0;
  ok = false;

  /** drag-to-rotate — pixel delta feeds spin velocity */
  spin(dx: number) {
    this.yawVel += dx * 0.008;
  }

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

    // feet — molded rounded shoes in the same body material, toes angled out
    const foot = (x: number, ry: number) => {
      const f = mesh(new THREE.SphereGeometry(0.2, 18, 14), body, x, 0.12, 0.12);
      f.scale.set(1.0, 0.55, 1.55);
      f.rotation.y = ry;
      return f;
    };
    foot(-0.27, 0.22);
    foot(0.27, -0.22);

    // the bean — one tall capsule body, belly-forward like the reference
    this.torso = mesh(new THREE.CapsuleGeometry(0.66, 0.82, 10, 32), body, 0, 1.16, 0);
    this.torso.scale.set(1, 1, 0.95);

    // penguin flippers — flat tapered blades angled out from the
    // shoulders, swept slightly back, no separate hand
    const arm = (side: -1 | 1) => {
      const a = mesh(new THREE.CapsuleGeometry(0.16, 0.62, 6, 16), body, side * 0.68, 1.08, -0.02);
      a.scale.set(1.15, 1, 0.35);
      a.rotation.z = side * 0.5;
      a.rotation.y = side * -0.18;
      a.rotation.x = -0.06;
      return a;
    };
    this.armL = arm(-1);
    this.armR = arm(1);

    // face oval — big pale patch high on the front, proud of the surface
    mesh(new THREE.SphereGeometry(0.46, 30, 24), skin, 0, 1.58, 0.5).scale.set(0.86, 1.05, 0.38);
    // eyes — two tall thin dark ovals, close-set
    const eye = (x: number) => {
      const m = mesh(new THREE.SphereGeometry(0.07, 14, 12), dark, x, 1.58, 0.66);
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
    if (this.armL) this.armL.rotation.z = -0.5 + this.sq * 0.55;
    if (this.armR) this.armR.rotation.z = 0.5 - this.sq * 0.55;

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
      this.eyeL.position.x = -0.16 + this.gx * 0.07;
      this.eyeL.position.y = 1.58 + this.gy * 0.05;
    }
    if (this.eyeR) {
      this.eyeR.position.x = 0.16 + this.gx * 0.07;
      this.eyeR.position.y = 1.58 + this.gy * 0.05;
    }

    // drag spin — velocity decays smoothly
    this.yaw += this.yawVel;
    this.yawVel *= Math.exp(-3.5 * dt);

    // idle — breathing bob, slow sway, gaze lean, user spin
    grp.position.y = Math.sin(s * 1.6) * 0.045 * idle + this.hopY;
    grp.rotation.y = this.yaw + Math.sin(s * 0.7) * 0.18 * idle + this.gx * 0.22;
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
