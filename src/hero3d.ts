// Real-time 3D podium hero — a glossy bean silhouette in our materials:
// navy costume with cyan sprinkles, skin face oval, danfo headband wrap.
// Built from Three.js primitives, studio-lit, renders into an offscreen
// canvas that the scene wraps in a Phaser texture — a real display-list
// object, so modals cover it and it dies with the scene.
import * as THREE from 'three';

const BODY = 0x26214e; // glossy deep navy costume
const SPRINKLE = 0x2ec9e8; // cyan sprinkle dashes
const SKIN = 0x8d5524;
const DARK = 0x1d1512;
const BAND = 0xf2c531;

export class Hero3D {
  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private group?: THREE.Group;
  ok = false;

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
      new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
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

    const body = mat(BODY, 0.22);
    const skin = mat(SKIN, 0.45);
    const dark = mat(DARK, 0.5);
    const band = mat(BAND, 0.3);
    const sprk = mat(SPRINKLE, 0.35);

    // feet — two small stubs under the bean
    mesh(new THREE.CapsuleGeometry(0.15, 0.16, 6, 14), dark, -0.24, 0.14, 0.08).rotation.x =
      Math.PI / 2 - 0.15;
    mesh(new THREE.CapsuleGeometry(0.15, 0.16, 6, 14), dark, 0.24, 0.14, 0.08).rotation.x =
      Math.PI / 2 - 0.15;

    // the bean — one tall capsule body, wide and glossy
    const torso = mesh(new THREE.CapsuleGeometry(0.62, 0.85, 10, 28), body, 0, 1.18, 0);
    torso.scale.set(1, 1, 0.92);

    // stub arms — short capsules hanging at the sides, angled slightly out
    const armL = mesh(new THREE.CapsuleGeometry(0.14, 0.5, 6, 14), body, -0.66, 1.05, 0.02);
    armL.rotation.z = 0.16;
    armL.rotation.x = -0.08;
    const armR = mesh(new THREE.CapsuleGeometry(0.14, 0.5, 6, 14), body, 0.66, 1.05, 0.02);
    armR.rotation.z = -0.16;
    armR.rotation.x = -0.08;

    // face oval — sits lower so the gele has the crown; proud of the body so the seam is clean
    mesh(new THREE.SphereGeometry(0.44, 28, 22), skin, 0, 1.55, 0.47).scale.set(0.8, 1.0, 0.36);
    // eyes — two tall dark ovals on the face
    const eye = (x: number) =>
      mesh(new THREE.SphereGeometry(0.055, 12, 10), mat(0x12090a, 0.35), x, 1.55, 0.6).scale.set(
        0.75,
        1.35,
        0.45,
      );
    eye(-0.15);
    eye(0.15);

    // danfo gele — cap shell on the crown; rim lands as a brow line above the face
    mesh(
      new THREE.SphereGeometry(0.645, 28, 12, 0, Math.PI * 2, 0, Math.PI * 0.42),
      band,
      0,
      1.6,
      0,
    ).scale.set(1, 1, 0.92);

    // cyan sprinkles — small dashes scattered on the costume's front half
    const sprinkleAt = (x: number, y: number, z: number, rx: number, ry: number, rz: number) => {
      const s = mesh(new THREE.CapsuleGeometry(0.04, 0.1, 4, 8), sprk, x, y, z);
      s.rotation.set(rx, ry, rz);
    };
    sprinkleAt(0.32, 1.72, 0.44, 0.5, 0.2, 0.7);
    sprinkleAt(-0.36, 1.45, 0.42, 0.4, -0.3, -0.5);
    sprinkleAt(0.16, 1.02, 0.5, 0.3, 0.1, 1.1);
    sprinkleAt(-0.2, 0.85, 0.48, 0.6, -0.2, 0.3);
    sprinkleAt(0.46, 1.2, 0.3, 0.2, 0.5, -0.8);
    sprinkleAt(-0.52, 1.68, 0.24, 0.5, -0.5, 0.4);
    sprinkleAt(0.5, 1.78, 0.2, 0.3, 0.6, 1.4);
    sprinkleAt(-0.42, 1.28, 0.44, 0.4, -0.3, -0.9);
    sprinkleAt(0.28, 0.62, 0.44, 0.7, 0.3, 0.2);
    sprinkleAt(-0.44, 1.05, 0.32, 0.3, -0.4, 1.2);
    sprinkleAt(0.42, 0.88, 0.38, 0.5, 0.4, 0.8);
    sprinkleAt(-0.3, 0.6, 0.4, 0.5, -0.3, -1.0);

    // studio lighting — key + fill + rim for the soft-render look
    scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 1.1));
    const key = new THREE.DirectionalLight(0xfff2dd, 2.2);
    key.position.set(2.2, 4, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fd4ff, 1.1);
    rim.position.set(-3, 2.4, -2.4);
    scene.add(rim);

    this.camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 20);
    this.camera.position.set(0, 1.05, 3.85);
    this.camera.lookAt(0, 1.05, 0);

    this.ok = true;
  }

  update(t: number) {
    if (!this.renderer || !this.scene || !this.camera || !this.group) return;
    const s = t / 1000;
    this.group.position.y = Math.sin(s * 1.6) * 0.045;
    this.group.rotation.y = Math.sin(s * 0.7) * 0.3;
    this.group.rotation.z = Math.sin(s * 1.1) * 0.02;
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
