// Podium3D — menu character preview built on the live bean rig.
// Drop-in replacement for the old hero3d podium: same construction +
// canvas/ok/update/dispose surface, so scenes swap one line.
import * as THREE from 'three';
import { makeBean, ensureEnv, type Bean, type Bean3DModel } from './bean';

export class Podium3D {
  ok = false;
  furQ: unknown = 0;  // accepted for API compat — the 3D rig has no fur pass
  skydiving = false;
  trickOn = false;    // the adventure-map bean does the occasional backflip

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private bean!: Bean;
  private model: Bean3DModel;
  private gazeX = 0; private gazeY = 0;
  private spinYaw = 0;
  private lastT = 0;
  private trickT = 0;
  private trickPhase = -1;
  private cv!: HTMLCanvasElement;

  constructor(w: number, h: number, camZ = 5.0, camY = 1.3, lookY = 1.3, model: Bean3DModel = { body: 0x8a4f24 }) {
    this.model = model;
    try {
      this.cv = document.createElement('canvas');
      this.cv.width = w; this.cv.height = h;
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.cv, antialias: true, alpha: true, preserveDrawingBuffer: true,
      });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.1;
      this.renderer.setSize(w, h, false);
      this.scene = new THREE.Scene();
      ensureEnv(this.renderer, this.scene);
      this.scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x8a5a34, 1.1));
      const key = new THREE.DirectionalLight(0xffe2b0, 2.4);
      key.position.set(-3, 6, 4);
      this.scene.add(key);
      const rim = new THREE.DirectionalLight(0x9fd8ff, .9);
      rim.position.set(3, 4, -4);
      this.scene.add(rim);
      // podium disc
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(1.15, 1.3, .22, 28),
        new THREE.MeshStandardMaterial({ color: 0x241f30, roughness: .6 }));
      disc.position.y = -.11;
      this.scene.add(disc);
      this.camera = new THREE.PerspectiveCamera(38, w / h, .1, 60);
      this.camera.position.set(0, camY, camZ);
      this.camera.lookAt(0, lookY, 0);
      this.rebuild(model);
      this.ok = true;
    } catch {
      this.ok = false;
    }
  }

  get canvas(): HTMLCanvasElement | undefined { return this.ok ? this.cv : undefined; }

  private rebuild(model: Bean3DModel) {
    this.model = model;
    if (this.bean) this.scene.remove(this.bean.root);
    this.bean = makeBean(model);
    this.scene.add(this.bean.root);
  }

  /** repaint the coat without remounting — the outfit screen's recolour */
  setVariant(body: number, skin?: number) {
    if (!this.ok) return;
    this.bean.bodyMat.color.setHex(body);
    this.bean.baseColor = body;
    if (skin !== undefined) this.bean.face.material = new THREE.MeshStandardMaterial({ color: skin, roughness: .55 });
  }

  /** eyes track the pointer — px,py in canvas pixels, negative = ignore */
  setGaze(x: number, y: number) {
    this.gazeX = x < 0 ? 0 : (x / this.cv.width - .5) * .12;
    this.gazeY = y < 0 ? 0 : (y / this.cv.height - .5) * .08;
  }

  /** the little bounce when you tap the preview */
  poke() { if (this.ok) this.bean.squash = .62; }

  /** drag-to-turn on the podium */
  spin(dx: number) { this.spinYaw += dx * .01; }

  /** the fur overlay pass — the 3D rig renders fur as geometry, so the
   *  petting overlay is a no-op; kept so callers don't branch */
  drawFur(_ctx: CanvasRenderingContext2D, _px: number, _py: number) { /* 3D fur is real */ }

  update(t: number) {
    if (!this.ok) return;
    const b = this.bean;
    b.root.rotation.y = t * .0005 + this.spinYaw;
    // poke squash decays back to standing tall
    if (b.squash < 1) {
      b.squash = Math.min(1, b.squash + (1 - b.squash) * .12);
      b.root.scale.set(1 + (1 - b.squash) * .5, b.squash, 1 + (1 - b.squash) * .5);
    } else b.root.scale.set(1, 1, 1);
    // idle breathing + arm sway
    const s = 1 + Math.sin(t * .0022) * .015;
    const bs = b.figure.userData.bs as THREE.Vector3 | undefined;
    b.figure.scale.set((bs?.x ?? 1) * s, (bs?.y ?? 1) * (1 + Math.sin(t * .0022) * .02), (bs?.z ?? 1) * s);
    b.armL.rotation.x = Math.sin(t * .0022) * .07;
    b.armR.rotation.x = -Math.sin(t * .0022) * .07;
    if (this.skydiving) {
      b.root.rotation.x = -.35;
      b.armL.rotation.z = -1.5; b.armR.rotation.z = 1.5;
      b.footL.position.y = b.footR.position.y = .24;
    } else {
      b.root.rotation.x = 0;
    }
    // the pratfall — a lazy backflip every few seconds on the map podium
    if (this.trickOn) {
      const dt = this.lastT ? t - this.lastT : 16;
      this.trickT += dt;
      if (this.trickPhase < 0 && this.trickT > 3800) {
        this.trickPhase = 0;
        this.trickT = 0;
      }
      if (this.trickPhase >= 0) {
        const k = this.trickT / 720;
        if (k >= 1) {
          this.trickPhase = -1;
          b.root.rotation.x = 0;
          b.root.position.y = 0;
        } else {
          b.root.rotation.x = -k * Math.PI * 2;
          b.root.position.y = Math.sin(k * Math.PI) * .65;
        }
      }
    }
    this.lastT = t;
    // gaze — eyes slide a touch toward the pointer
    b.eyeL.position.x = -.11 + this.gazeX; b.eyeR.position.x = .11 + this.gazeX;
    b.eyeL.position.y = .97 + this.gazeY; b.eyeR.position.y = .97 + this.gazeY;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    try { this.renderer.dispose(); } catch { /* already gone */ }
    this.ok = false;
  }
}
