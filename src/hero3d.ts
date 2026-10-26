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
const DARK = 0x0c0c0c; // eyes — negro neutro (sin tinte cálido)

// model vocabulary — the shared skeleton gets dressed differently:
// shape reshapes the torso capsule (+ fur shells + face/limb placement),
// gear bolts a head-mounted extra onto the crown. Pickable cast lives
// in characters.ts.
export type BeanShape = 'bean' | 'round' | 'tall';
export type BeanGear = 'none' | 'cap' | 'hardhat' | 'band' | 'spikes' | 'crown' | 'frost';
export interface BeanModel {
  shape?: BeanShape;
  gear?: BeanGear;
  /** angry brow-V over the eyes — the hunters' glare */
  rage?: boolean;
  /** coat strand length multiplier — the ice runs shaggy */
  furLen?: number;
}

export class Hero3D {
  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private group?: THREE.Group;
  private torso?: THREE.Mesh;
  private bodyMat?: THREE.MeshPhysicalMaterial;
  private skinMat?: THREE.MeshPhysicalMaterial;
  private shellMats: THREE.MeshStandardMaterial[] = [];
  private flipL?: { root: THREE.Group; elbow: THREE.Group };
  private flipR?: { root: THREE.Group; elbow: THREE.Group };
  private footL?: THREE.Group;
  private footR?: THREE.Group;
  private eyeL?: THREE.Mesh;
  private eyeR?: THREE.Mesh;
  private dizzyL?: THREE.Group; // X-cross eyes shown while flattened
  private dizzyR?: THREE.Group;
  private eyeXs = 0.16; // shape-dependent eye placement — gaze/pose resets use these
  private eyeZs = 0.72;
  private faceMesh?: THREE.Mesh;
  private shadowMesh?: THREE.Mesh;
  private shellMeshes: THREE.Mesh[] = [];
  private gearParts: THREE.Object3D[] = [];
  private gearCv?: HTMLCanvasElement;
  private gearCtx?: CanvasRenderingContext2D;
  private furLen = 1; // drawFur strand-length multiplier
  // --- animation state ---
  private sq = 0; // jelly: + stretch, − squash
  private sqVel = 0;
  private hopY = 0;
  private hopV = 0;
  /** enables the pratfall routine — launch, midair backflip, flat splat,
   *  dizzy eyes, recover. The map statue's signature; lobby leaves it off. */
  trickOn = false;
  /** skydive pose for the drop-in loading screen — arms out, feet trailing,
   *  belly leaned toward camera. Suppresses hops/tricks while set. */
  skydiving = false;
  private tricking = false;
  private flipX = 0; // airborne backflip angle
  private dizzyUntil = 0;
  private nextTrick = 3400;
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

  private W = 520;
  private H = 540;

  constructor(w: number, h: number, camZ = 5.0, camY = 1.3, lookY = 1.3, model: BeanModel = {}) {
    this.W = w;
    this.H = h;
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

    // body silhouette — 'round' is the chubby low-rider, 'tall' the lanky
    // runner. Every placement that touches the skin (face, eyes, flippers,
    // feet, gear) derives from these scales.
    const shape = model.shape ?? 'bean';
    const shX = shape === 'round' ? 1.22 : shape === 'tall' ? 0.8 : 1;
    const shY = shape === 'round' ? 0.9 : shape === 'tall' ? 1.1 : 1;
    const shZ = shape === 'round' ? 1.18 : shape === 'tall' ? 0.78 : 0.95;
    const faceZ = 0.55 * (shZ / 0.95); // keep the face proud of the surface
    const eyeZ = 0.72 * (shZ / 0.95);
    const eyeX = 0.16 * (shape === 'tall' ? 0.8 : 1);
    this.furLen = model.furLen ?? 1;

    const body = (this.bodyMat = mat(BODY, 0.3));
    const skin = (this.skinMat = mat(SKIN, 0.38));
    // ojos: MeshBasic — las luces cálidas de la escena teñían de marrón
    // cualquier material iluminado; el basic rinde negro plano siempre
    const dark = new THREE.MeshBasicMaterial({ color: DARK });

    // feet — pivoted groups at the hip; each foot is a flat forward-
    // pointing shoe, toes angled slightly out
    const footG = (side: -1 | 1) => {
      const root = new THREE.Group();
      root.position.set(side * 0.27 * shX, 0.32, 0.04);
      root.rotation.y = side * 0.18; // toes out
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.3, 6, 14), body);
      f.rotation.x = Math.PI / 2; // capsule axis points forward (+z)
      f.scale.set(1.05, 1, 0.55); // flatten vertically (local z → world y)
      f.position.set(0, -0.22, 0.1);
      root.add(f);
      grp.add(root);
      return root;
    };
    this.footL = footG(-1);
    this.footR = footG(1);

    // the bean — one tall capsule body, belly-forward like the reference
    this.torso = mesh(new THREE.CapsuleGeometry(0.66, 0.82, 10, 32), body, 0, 1.16, 0);
    this.torso.scale.set(shX, shY, shZ);

    // shell fur — N copies of the torso displaced along normals with a
    // strand-dot alpha texture; alphaTest rises per shell so the coat
    // thins toward the tips like real hair
    {
      const fc = document.createElement('canvas');
      fc.width = fc.height = 128;
      const fg = fc.getContext('2d')!;
      for (let i = 0; i < 2400; i++) {
        fg.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.65})`;
        fg.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
      }
      const furTex = new THREE.CanvasTexture(fc);
      furTex.wrapS = furTex.wrapT = THREE.RepeatWrapping;
      const src = this.torso.geometry as THREE.BufferGeometry;
      const pos = src.attributes.position as THREE.BufferAttribute;
      const nor = src.attributes.normal as THREE.BufferAttribute;
      const SHELLS = 12;
      for (let i = 1; i <= SHELLS; i++) {
        const t = i / SHELLS;
        const g = src.clone();
        const gp = g.attributes.position as THREE.BufferAttribute;
        const gn = g.attributes.normal as THREE.BufferAttribute;
        for (let v = 0; v < gp.count; v++)
          gp.setXYZ(
            v,
            pos.getX(v) + gn.getX(v) * 0.04 * t * (1 + (this.furLen - 1) * 0.5),
            pos.getY(v) + gn.getY(v) * 0.04 * t * (1 + (this.furLen - 1) * 0.5),
            pos.getZ(v) + gn.getZ(v) * 0.04 * t * (1 + (this.furLen - 1) * 0.5),
          );
        const shellMat = new THREE.MeshStandardMaterial({
          color: BODY,
          roughness: 1,
          alphaMap: furTex,
          alphaTest: 0.08 + t * 0.6,
          side: THREE.FrontSide,
        });
        this.shellMats.push(shellMat);
        const m = new THREE.Mesh(g, shellMat);
        m.position.copy(this.torso.position);
        m.scale.copy(this.torso.scale);
        this.shellMeshes.push(m);
        grp.add(m);
      }
    }

    // penguin flippers — detached two-segment blades: shoulder pivot +
    // elbow joint so the tip bends. Held just off the body surface.
    const flipper = (side: -1 | 1) => {
      const root = new THREE.Group();
      root.position.set(side * 0.65 * shX, 1.42, 0.0);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.34, 6, 14), body);
      upper.position.y = -0.22;
      upper.scale.set(0.38, 1, 1.15); // broad face pressed to the body's side
      root.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.46;
      const tip = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.3, 6, 14), body);
      tip.position.y = -0.18;
      tip.scale.set(0.34, 1, 1.1);
      elbow.add(tip);
      root.add(elbow);
      grp.add(root);
      return { root, elbow };
    };
    this.flipL = flipper(-1);
    this.flipR = flipper(1);

    // face oval — big pale patch high on the front, proud of the surface
    this.faceMesh = mesh(new THREE.SphereGeometry(0.46, 30, 24), skin, 0, 1.58, faceZ);
    this.faceMesh.scale.set(0.86 * shX, 1.05, 0.38);
    // eyes — two black pills, close-set
    const eye = (x: number) =>
      mesh(new THREE.CapsuleGeometry(0.05, 0.12, 6, 14), dark, x, 1.58, eyeZ);
    this.eyeL = eye(-eyeX);
    this.eyeR = eye(eyeX);
    // dizzy X-eyes — two crossed bars per eye, swapped in while flattened
    const dizzyEye = (x: number) => {
      const g = new THREE.Group();
      g.position.set(x, 1.58, eyeZ);
      for (const rz of [Math.PI / 4, -Math.PI / 4]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.2, 0.03), dark);
        b.rotation.z = rz;
        g.add(b);
      }
      g.visible = false;
      grp.add(g);
      return g;
    };
    this.dizzyL = dizzyEye(-eyeX);
    this.dizzyR = dizzyEye(eyeX);
    this.eyeXs = eyeX;
    this.eyeZs = eyeZ;

    // --- gear — head-mounted extras, one per model. Lives in grp so it
    // rides every squash/splat/spin automatically. ---
    {
      const topY = 1.16 + 1.07 * shY; // crown of the torso capsule

      // rage brows — the V-glare that turns a bean into a hunter. Not
      // headgear, but riding gearParts keeps the fur off them.
      if (model.rage) {
        for (const side of [-1, 1] as const) {
          const brow = mesh(new THREE.CapsuleGeometry(0.045, 0.18, 6, 12), dark, 0, 0, 0);
          brow.position.set(side * eyeX * 1.15, 1.78, eyeZ + 0.02);
          brow.rotation.z = side * 0.6; // inner ends dive toward the nose
          this.gearParts.push(brow);
        }
      }

      const gear = model.gear ?? 'none';
      if (gear === 'cap' || gear === 'hardhat') {
        const hatMat =
          gear === 'cap' ? mat(0x23262e, 0.55) : mat(0xffc400, 0.4); // conductor dark / site yellow
        const dome = mesh(
          new THREE.SphereGeometry(0.36, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
          hatMat,
          0,
          topY - 0.16,
          0.02,
        );
        dome.scale.set(shX * 1.05, 0.8, shZ * 1.05);
        this.gearParts.push(dome);
        if (gear === 'cap') {
          // brim — half-disc sticking forward like a baseball cap
          const brim = mesh(
            new THREE.CylinderGeometry(0.36, 0.36, 0.045, 24, 1, false, 0, Math.PI),
            hatMat,
            0,
            topY - 0.13,
            0.14,
          );
          brim.rotation.y = -Math.PI / 2; // flat edge faces back, bill out +z
          brim.scale.z = shZ;
          this.gearParts.push(brim);
        } else {
          // helmet — full brim ring all the way round
          const rim = mesh(
            new THREE.CylinderGeometry(0.44, 0.44, 0.035, 24),
            hatMat,
            0,
            topY - 0.15,
            0.01,
          );
          rim.scale.set(shX, 1, shZ);
          this.gearParts.push(rim);
        }
      } else if (gear === 'band') {
        // sweatband — FRONT ARC only (arc=π sweeps local +x→+y→−x = world
        // +x→+z→−x after rotation.x): a full ring's back half would stamp
        // over the face during the gear re-draw
        const band = mesh(
          new THREE.TorusGeometry(0.58, 0.06, 10, 36, Math.PI),
          mat(0xd23b3b, 0.6),
          0,
          1.85 + (shY - 1) * 0.4,
          0.02,
        );
        band.rotation.x = Math.PI / 2;
        band.scale.set(shX, shZ, 1); // z of the ring plane
        this.gearParts.push(band);
      } else if (gear === 'spikes') {
        // mohawk — five coat-coloured cones fanned LEFT-TO-RIGHT across the
        // crown so the whole row reads from the front view
        for (let i = 0; i < 5; i++) {
          const x = -0.3 + i * 0.15;
          const spike = mesh(
            new THREE.ConeGeometry(0.095, 0.46 - Math.abs(i - 2) * 0.07, 10),
            body,
            x * shX,
            topY - 0.12 - Math.abs(x) * 0.35,
            0.02,
          );
          spike.rotation.z = -x * 0.9; // fan outward along the crown curve
          this.gearParts.push(spike);
        }
      } else if (gear === 'crown') {
        // the Oba's crown — small gold circlet, five points
        const gold = new THREE.MeshStandardMaterial({
          color: 0xf6c90e,
          metalness: 0.75,
          roughness: 0.3,
        });
        const circlet = mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.14, 16), gold, 0, topY - 0.02, 0);
        circlet.rotation.z = 0.1; // worn at a jaunty tilt
        this.gearParts.push(circlet);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          this.gearParts.push(
            mesh(
              new THREE.ConeGeometry(0.032, 0.11, 8),
              gold,
              Math.cos(a) * 0.165,
              topY + 0.1,
              Math.sin(a) * 0.165 + 0.02,
            ),
          );
        }
      } else if (gear === 'frost') {
        // icicles — translucent drips hanging off the coat's crown edge,
        // like the melt is still deciding whether to freeze you
        const ice = new THREE.MeshPhysicalMaterial({
          color: 0xc9ecf8,
          transparent: true,
          opacity: 0.82,
          roughness: 0.12,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.1,
        });
        for (let i = 0; i < 6; i++) {
          const x = -0.42 + i * 0.17 + (i % 2) * 0.04;
          const icicle = mesh(
            new THREE.ConeGeometry(0.045 + (i % 3) * 0.015, 0.22 + (i % 2) * 0.12, 8),
            ice,
            x * shX,
            topY - 0.42 - (i % 2) * 0.06,
            0.12 + (i % 3) * 0.05,
          );
          icicle.rotation.x = Math.PI; // point down
          icicle.rotation.z = x * 0.35; // splay with the crown curve
          this.gearParts.push(icicle);
        }
      }
    }

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
    this.shadowMesh = shadow;
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
    // framed with hop headroom — crown + hop lift stays in view; the map's
    // pratfall passes camZ>5 for flip + splat headroom on a taller buffer
    this.camera.position.set(0, camY, camZ);
    this.camera.lookAt(0, lookY, 0);

    this.ok = true;
  }

  // --- pettable 2D fur coat (faithful port of feral-fur, MIT) ---
  // Their structure: dark undercoat gradient inside the silhouette +
  // blots + sheen, then three strand layers (thick undercoat, mid coat
  // with lit-tip second pass, sparse highlights) + perimeter fringe.
  // Strands carry curl + a bend spring; pointer velocity pushes bend
  // perpendicular to the strand direction. Bend state lives in a coarse
  // grid that survives the per-frame rebuild and springs back
  // (SPRING 0.1 / DAMP 0.88). The face is kept by masking interior fur
  // to body-coloured pixels (saturated mid-brown) — pale face and dark
  // desaturated eyes are skipped automatically.
  private furBend = new Map<number, { x: number; y: number; vx: number; vy: number }>();
  private furLastP = { x: -1, y: -1 };
  private furCv: HTMLCanvasElement | null = null;
  private furCvCtx: CanvasRenderingContext2D | null = null;
  // coat preset — scenes assign the Bean FPS tier's FurQuality at create
  furQ = { fluff: 0.85, mess: 0.3, density: 1.0 };

  /** Draw the fur coat over the composited bean frame.
   *  Call AFTER the WebGL frame is drawn into `ctx`.
   *  `px,py` = pointer in canvas pixels, negative = no petting. */
  drawFur(ctx: CanvasRenderingContext2D, px: number, py: number) {
    const W = this.W,
      H = this.H,
      CELLS = 8,
      GW = Math.ceil(W / CELLS),
      R = 52,
      R2 = R * R;
    const d = ctx.getImageData(0, 0, W, H).data;
    // floor before indexing — furQ strides are fractional
    const a = (x: number, y: number) =>
      x < 0 || y < 0 || x >= W || y >= H ? 0 : d[((y | 0) * W + (x | 0)) * 4 + 3];
    // face mask via flood fill — a local colour test can't separate the
    // face from big specular sheens, so we flood the pale region from a
    // seed in the face's expected area. Disconnected highlights stay
    // furred; the mask is then dilated ~12px so eyes and the face rim
    // stay covered too. Back view → seed isn't pale → no mask, full fur.
    const FM = 2,
      FW = Math.ceil(W / FM),
      FH = Math.ceil(H / FM);
    const palePx = (x: number, y: number) => {
      if (a(x, y) < 140) return false;
      const i = (y * W + x) * 4;
      const r = d[i] / 255,
        g = d[i + 1] / 255,
        b = d[i + 2] / 255;
      // warm-neutral pale only — faces and white speculars. Cool blues
      // (the ice militia's coat is 0.73 lightness!) must not flood the mask.
      return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 > 0.68 && r > b - 0.07;
    };
    const face = new Uint8Array(FW * FH);
    let seeded = false;
    const stack: number[] = [];
    for (const fy of [0.3, 0.34, 0.26, 0.38])
      for (const fx of [0.5, 0.44, 0.56]) {
        if (seeded) break;
        const sx = (W * fx) | 0,
          sy = (H * fy) | 0;
        if (!palePx(sx, sy)) continue;
        seeded = true;
        stack.push(((sy / FM) | 0) * FW + ((sx / FM) | 0));
      }
    const MAXFACE = FW * FH * 0.12; // a real face is ~5% of the canvas
    let filled = 0,
      overflow = false;
    while (stack.length) {
      const c = stack.pop()!;
      if (face[c]) continue;
      face[c] = 1;
      if (++filled > MAXFACE) {
        overflow = true;
        break;
      }
      const cx = c % FW,
        cy = (c / FW) | 0;
      if (cx > 0 && !face[c - 1] && palePx((cx - 1) * FM + 1, cy * FM + 1)) stack.push(c - 1);
      if (cx < FW - 1 && !face[c + 1] && palePx((cx + 1) * FM + 1, cy * FM + 1)) stack.push(c + 1);
      if (cy > 0 && !face[c - FW] && palePx(cx * FM + 1, (cy - 1) * FM + 1)) stack.push(c - FW);
      if (cy < FH - 1 && !face[c + FW] && palePx(cx * FM + 1, (cy + 1) * FM + 1)) stack.push(c + FW);
    }
    // hole-fill: the flood only marks pale cells, so dark eyes are unmarked
    // islands inside the face and fur roots on them — fill every row
    // between its leftmost and rightmost face cell
    if (!overflow)
      for (let cy = 0; cy < FH; cy++) {
        let lo = -1,
          hi = -1;
        for (let cx = 0; cx < FW; cx++)
          if (face[cy * FW + cx]) {
            if (lo < 0) lo = cx;
            hi = cx;
          }
        for (let cx = lo; lo >= 0 && cx <= hi; cx++) face[cy * FW + cx] = 1;
      }
    // dilate the mask ~8px (4 cells) — strands that would stroke into the
    // face rim are culled on their tips, so the rim stays furred
    const fd = overflow ? face : new Uint8Array(FW * FH);
    if (!overflow)
      for (let cy = 0; cy < FH; cy++)
        for (let cx = 0; cx < FW; cx++) {
          if (!face[cy * FW + cx]) continue;
          for (let dy = -4; dy <= 4; dy++)
            for (let dx = -4; dx <= 4; dx++) {
              const nx = cx + dx,
                ny = cy + dy;
              if (nx >= 0 && ny >= 0 && nx < FW && ny < FH) fd[ny * FW + nx] = 1;
            }
        }
    const faceCoreAt = (x: number, y: number) =>
      x < 0 || y < 0 || x >= W || y >= H ? false : face[((y / FM) | 0) * FW + ((x / FM) | 0)] === 1;
    const faceRingAt = (x: number, y: number) =>
      x < 0 || y < 0 || x >= W || y >= H ? false : fd[((y / FM) | 0) * FW + ((x / FM) | 0)] === 1;
    const body = (x: number, y: number) => a(x, y) >= 140 && !faceCoreAt(x, y);
    // deterministic per-position noise
    const nz = (x: number, y: number, s: number) => {
      const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
      return h - Math.floor(h);
    };

    // pointer velocity — their push is velocity-projected, not positional
    let pvx = 0,
      pvy = 0;
    if (px >= 0 && this.furLastP.x >= 0) {
      pvx = px - this.furLastP.x;
      pvy = py - this.furLastP.y;
    }
    this.furLastP = { x: px, y: py };

    if ((pvx || pvy) && px >= 0) {
      const gx = Math.floor(px / CELLS),
        gy = Math.floor(py / CELLS);
      for (let cy = gy - 7; cy <= gy + 7; cy++)
        for (let cx = gx - 7; cx <= gx + 7; cx++) {
          const mx = cx * CELLS + CELLS / 2 - px,
            my = cy * CELLS + CELLS / 2 - py;
          const d2 = mx * mx + my * my;
          if (d2 > R2) continue;
          const g = 1 - d2 / R2;
          const key = cy * GW + cx;
          const b = this.furBend.get(key) ?? { x: 0, y: 0, vx: 0, vy: 0 };
          b.vx += pvx * g * 0.35;
          b.vy += pvy * g * 0.35;
          this.furBend.set(key, b);
        }
    }
    // spring: v += -SPRING*b; v *= DAMP; b += v — then prune settled cells
    for (const [k, b] of this.furBend) {
      b.vx += -0.1 * b.x;
      b.vy += -0.1 * b.y;
      b.vx *= 0.88;
      b.vy *= 0.88;
      b.x += b.vx;
      b.y += b.vy;
      if (b.x * b.x + b.y * b.y + b.vx * b.vx + b.vy * b.vy < 0.004)
        this.furBend.delete(k);
    }

    // ---- undercoat: dark gradient inside body pixels + blots + sheen ----
    if (!this.furCv) {
      this.furCv = document.createElement('canvas');
      this.furCv.width = W;
      this.furCv.height = H;
      this.furCvCtx = this.furCv.getContext('2d', { willReadFrequently: true });
    }
    const uc = this.furCvCtx!;
    const T = this.furTint;
    const uimg = uc.createImageData(W, H);
    const ud = uimg.data;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!body(x, y)) continue;
        const o = (y * W + x) * 4,
          v = y / H;
        // undercoat in the fur's own shade — mild vertical darkening only
        ud[o] = (96 - v * 40) * T.r;
        ud[o + 1] = (52 - v * 22) * T.g;
        ud[o + 2] = (25 - v * 11) * T.b;
        ud[o + 3] = 255;
      }
    uc.putImageData(uimg, 0, 0);
    uc.globalCompositeOperation = 'source-atop';
    // blots — their coat depth patches
    for (let i = 0; i < 16; i++) {
      const bx = W * nz(i, 9, 11),
        by = H * nz(i, 13, 12);
      if (!body(bx | 0, by | 0)) continue;
      const r = 14 + nz(i, 7, 13) * 22,
        dark = nz(i, 5, 14) < 0.68;
      const rg = uc.createRadialGradient(bx, by, 0, bx, by, r);
      rg.addColorStop(
        0,
        dark
          ? `rgba(${(28 * T.r) | 0},${(12 * T.g) | 0},${(4 * T.b) | 0},0.16)`
          : `rgba(${Math.min(255, 255 * T.r) | 0},${(214 * T.g) | 0},${(160 * T.b) | 0},0.10)`,
      );
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      uc.fillStyle = rg;
      uc.fillRect(bx - r, by - r, r * 2, r * 2);
    }
    const rg = uc.createRadialGradient(W / 2, H * 0.42, 20, W / 2, H * 0.42, W * 0.55);
    rg.addColorStop(0, 'rgba(255,255,255,0.14)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    uc.fillStyle = rg;
    uc.fillRect(0, 0, W, H);
    uc.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.furCv!, 0, 0);

    // ---- strands ----
    // the furQ preset drives stride (density), strand length (fluff),
    // and the jitter/curve amplitudes (mess)
    const cowX = W * 0.5,
      cowY = H * 0.3,
      down = Math.PI / 2;
    const q = this.furQ,
      stride = 3 / Math.sqrt(q.density),
      fstride = 5 / Math.sqrt(q.density),
      FL = this.furLen; // per-model coat length — multiplies the tier's fluff
    const restAngle = (x: number, y: number) => {
      const fromCow = Math.atan2(y - cowY, x - cowX);
      const clump = (Math.sin(x * 0.04) + Math.cos(y * 0.035)) * 0.3;
      let an = fromCow + (((down - fromCow + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 0.5;
      an += clump * 0.35 + (nz(x, y, 1) - 0.5) * q.mess;
      return an;
    };
    type Strand = { x: number; y: number; a: number; l: number; c: number; s: number };
    const under: Strand[] = [],
      mid: Strand[] = [],
      hi: Strand[] = [],
      fringe: Strand[] = [];

    // interior coat — fractional stride sample of body pixels
    for (let y = 4; y < H - 4; y += stride)
      for (let x = 4; x < W - 4; x += stride) {
        if (!body(x, y)) continue;
        const len = (9 + nz(x, y, 4) * 8) * q.fluff * FL;
        const ang = restAngle(x, y);
        // skip strands that would stroke into the face region
        const tx = x + Math.cos(ang) * len,
          ty = y + Math.sin(ang) * len;
        if (faceRingAt(tx, ty)) continue;
        const roll = nz(x, y, 6);
        const s: Strand = {
          x,
          y,
          a: ang,
          l: len,
          c: (nz(x, y, 5) - 0.5) * len * q.mess,
          s: nz(x, y, 8),
        };
        (roll < 0.4 ? under : roll < 0.92 ? mid : hi).push(s);
      }
    // fringe — perimeter strands pointing outward
    for (let y = 5; y < H - 5; y += fstride)
      for (let x = 5; x < W - 5; x += fstride) {
        if (!body(x, y)) continue;
        if (
          a(x - 6, y) > 100 &&
          a(x + 6, y) > 100 &&
          a(x, y - 6) > 100 &&
          a(x, y + 6) > 100
        )
          continue;
        let nx = a(x - 6, y) - a(x + 6, y),
          ny = a(x, y - 6) - a(x, y + 6);
        const nl = Math.hypot(nx, ny) || 1;
        const out = Math.atan2(ny / nl, nx / nl);
        let an = out + (((down - out + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 0.25;
        an += (nz(x, y, 3) - 0.5) * q.mess;
        const len = (9 + nz(x, y, 4) * 8) * q.fluff * FL;
        fringe.push({ x, y, a: an, l: len, c: (nz(x, y, 5) - 0.5) * len * q.mess, s: nz(x, y, 8) });
      }

    ctx.save();
    ctx.lineCap = 'round';
    const stroke = (s: Strand, tip: boolean) => {
      const b = this.furBend.get(
        Math.floor(s.y / CELLS) * GW + Math.floor(s.x / CELLS),
      );
      const bx = b?.x ?? 0,
        by = b?.y ?? 0;
      const ba = s.a + (bx * -Math.sin(s.a) + by * Math.cos(s.a)) * 0.04;
      const pnx = -Math.sin(s.a),
        pny = Math.cos(s.a);
      const cxp = s.x + Math.cos(s.a) * s.l * 0.55 + pnx * s.c + bx * 0.5;
      const cyp = s.y + Math.sin(s.a) * s.l * 0.55 + pny * s.c + by * 0.5;
      const tx = s.x + Math.cos(ba) * s.l + bx,
        ty = s.y + Math.sin(ba) * s.l + by;
      ctx.beginPath();
      if (tip) ctx.moveTo((s.x + 2 * cxp + tx) / 4, (s.y + 2 * cyp + ty) / 4);
      else ctx.moveTo(s.x, s.y);
      ctx.quadraticCurveTo(cxp, cyp, tx, ty);
      ctx.stroke();
    };

    // undercoat strands — darkest, thickest
    for (const s of under) {
      const sh = 42 + s.s * 22;
      ctx.strokeStyle = `rgba(${(sh * T.r) | 0},${(sh * 0.55 * T.g) | 0},${(sh * 0.28 * T.b) | 0},0.6)`;
      ctx.lineWidth = 1.6 + s.s * 1.0;
      stroke(s, false);
    }
    // mid coat + lit tips on the outer half
    for (const s of mid) {
      const sh = 78 + s.s * 26;
      ctx.strokeStyle = `rgba(${(sh * T.r) | 0},${(sh * 0.55 * T.g) | 0},${(sh * 0.3 * T.b) | 0},0.85)`;
      ctx.lineWidth = 0.9 + s.s * 0.6;
      stroke(s, false);
    }
    for (const s of mid) {
      const sh = 115 + s.s * 30;
      ctx.strokeStyle = `rgba(${(sh * T.r) | 0},${(sh * 0.6 * T.g) | 0},${(sh * 0.34 * T.b) | 0},0.5)`;
      ctx.lineWidth = (0.9 + s.s * 0.6) * 0.8;
      stroke(s, true);
    }
    // sparse highlights
    for (const s of hi) {
      const sh = 140 + s.s * 28;
      ctx.strokeStyle = `rgba(${(sh * T.r) | 0},${(sh * 0.62 * T.g) | 0},${(sh * 0.36 * T.b) | 0},0.55)`;
      ctx.lineWidth = 0.7 + s.s * 0.4;
      stroke(s, false);
    }
    // fringe last so it pokes past the silhouette
    for (const s of fringe) {
      const sh = 84 + s.s * 32;
      ctx.strokeStyle = `rgba(${(sh * T.r) | 0},${(sh * 0.56 * T.g) | 0},${(sh * 0.3 * T.b) | 0},0.8)`;
      ctx.lineWidth = 1.1;
      stroke(s, false);
    }
    for (const s of fringe) {
      const sh = 120 + s.s * 28;
      ctx.strokeStyle = `rgba(${(sh * T.r) | 0},${(sh * 0.6 * T.g) | 0},${(sh * 0.34 * T.b) | 0},0.45)`;
      ctx.lineWidth = 0.9;
      stroke(s, true);
    }
    ctx.restore();
    // gear stays vinyl-clean — re-stamp it over the finished coat
    if (this.gearCv) ctx.drawImage(this.gearCv, 0, 0);
  }

  update(t: number) {
    if (!this.renderer || !this.scene || !this.camera || !this.group) return;
    const dt = this.lastT < 0 ? 0.016 : Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    const s = t / 1000;
    const grp = this.group;
    const idle = REDUCED_MOTION ? 0 : 1;

    // jelly spring — squash(−)/stretch(+), roughly volume-preserving; the
    // group's origin sits at the feet so the plant stays grounded. Low
    // damping lets a hard landing ring: squash → rebound stretch → settle
    this.sqVel += (-170 * this.sq - 8 * this.sqVel) * dt;
    this.sq = Math.max(-0.45, Math.min(0.5, this.sq + this.sqVel * dt));
    grp.scale.set(1 - this.sq * 0.5, 1 + this.sq, 1 - this.sq * 0.45);

    if (this.skydiving) {
      // T-pose dive — arms spread horizontal, trembling in the wind
      const wind = Math.sin(s * 9) * 0.05 * idle + Math.sin(s * 23) * 0.025 * idle;
      if (this.flipL) {
        this.flipL.root.rotation.z = -1.3 + wind;
        this.flipL.elbow.rotation.z = -0.1;
      }
      if (this.flipR) {
        this.flipR.root.rotation.z = 1.3 - wind;
        this.flipR.elbow.rotation.z = 0.1;
      }
      // feet trail up behind the dive — the leaner it gets the higher they kick
      if (this.footL) this.footL.rotation.x = 0.9;
      if (this.footR) this.footR.rotation.x = 0.9;
    } else {
      // flippers — idle wave, hard flap while airborne, elbow trails a beat
      const flap = Math.sin(s * 3.4) * 0.1 * idle + (this.hopY > 0 ? Math.sin(s * 18) * 0.45 : 0);
      const bend = Math.sin(s * 3.4 - 0.7) * 0.18 * idle + (this.hopY > 0 ? Math.sin(s * 18 - 0.8) * 0.3 : 0);
      if (this.flipL) {
        this.flipL.root.rotation.z = -0.18 - flap + this.sq * 0.3;
        this.flipL.elbow.rotation.z = -bend;
      }
      if (this.flipR) {
        this.flipR.root.rotation.z = 0.18 + flap - this.sq * 0.3;
        this.flipR.elbow.rotation.z = bend;
      }

      // feet — alternating waddle wiggle; toes kick down mid-hop
      const kick = this.hopY > 0 ? 0.55 : 0;
      if (this.footL) {
        this.footL.rotation.z = -Math.sin(s * 1.8) * 0.1 * idle;
        this.footL.rotation.x = -kick - Math.sin(s * 2.2) * 0.05 * idle;
      }
      if (this.footR) {
        this.footR.rotation.z = Math.sin(s * 1.8 + 1.2) * 0.1 * idle;
        this.footR.rotation.x = -kick - Math.sin(s * 2.2 + 0.9) * 0.05 * idle;
      }
    }

    // scheduled hop — stretch at take-off, squash on landing
    if (!REDUCED_MOTION && !this.trickOn && !this.skydiving && t > this.nextHop) {
      this.nextHop = t + 5200 + Math.random() * 5200;
      if (this.hopY === 0) {
        this.hopV = 2.7;
        this.sqVel += 2.2;
      }
    }
    // the pratfall routine — launch, midair backflip, SPLAT flat on the
    // podium, X-eyes while it lies there, then it staggers back up
    if (this.trickOn && !this.skydiving && !REDUCED_MOTION && t > this.nextTrick) {
      this.nextTrick = t + 4200 + Math.random() * 4600;
      if (this.hopY === 0) {
        this.hopV = 3.6;
        this.sqVel += 2.4;
        this.tricking = true;
      }
    }
    if (this.tricking && this.hopY > 0) this.flipX -= 8.73 * dt; // 360° backflip over the 0.72s arc
    if (this.hopV !== 0 || this.hopY > 0) {
      this.hopY += this.hopV * dt;
      this.hopV -= 10 * dt;
      if (this.hopY <= 0) {
        this.hopY = 0;
        // impact squeeze — the fall speed drives how hard it flattens
        this.sqVel += this.hopV * (this.tricking ? 2.2 : 1.3);
        this.hopV = 0;
        if (this.tricking) {
          this.tricking = false;
          this.flipX = 0;
          this.dizzyUntil = t + 2100;
        }
      }
    }
    const dizzy = t < this.dizzyUntil;
    // lie flat for a beat, then stagger back up — X-eyes stay through the
    // whole get-up and a breath after it's standing again
    const splatT = this.dizzyUntil - t;
    const splat = dizzy ? Math.min(1, Math.max(0, (splatT - 300) / 1100)) : 0;
    // rotation.x −66°: flat on its back, feet toward camera, face tilted
    // up enough that the X-eyes still read
    grp.rotation.x = this.flipX - splat * 1.15 + (this.skydiving ? 0.22 : 0); // belly tips down — the high camera keeps the face readable
    // lying flat → world-Y thinness comes from local Z; squash it into a
    // pancake and let it spread sideways under the impact
    grp.scale.z *= 1 - splat * 0.2;
    grp.scale.x *= 1 + splat * 0.12;
    // flip pivots at the feet — translate so it spins around body centre
    grp.position.z = -1.16 * Math.sin(this.flipX);

    // blink — a fast lid dip every 2–5s
    if (t > this.nextBlink) {
      this.nextBlink = t + 2200 + Math.random() * 3400;
      this.blinkUntil = t + 130;
    }
    const lids = t < this.blinkUntil ? 0.12 : 1;
    if (this.eyeL) {
      this.eyeL.scale.y = lids;
      this.eyeL.visible = !dizzy;
    }
    if (this.eyeR) {
      this.eyeR.scale.y = lids;
      this.eyeR.visible = !dizzy;
    }
    if (this.dizzyL) {
      this.dizzyL.visible = dizzy;
      this.dizzyL.rotation.z = Math.sin(s * 7) * 0.5; // wobbling crosses
    }
    if (this.dizzyR) {
      this.dizzyR.visible = dizzy;
      this.dizzyR.rotation.z = -Math.sin(s * 7) * 0.5;
    }

    // gaze — eyes drift, body leans toward the cursor
    if (this.eyeL) {
      this.eyeL.position.x = -this.eyeXs + this.gx * 0.07;
      this.eyeL.position.y = 1.58 + this.gy * 0.05;
    }
    if (this.eyeR) {
      this.eyeR.position.x = this.eyeXs + this.gx * 0.07;
      this.eyeR.position.y = 1.58 + this.gy * 0.05;
    }

    // drag spin — velocity decays smoothly
    this.yaw += this.yawVel;
    this.yawVel *= Math.exp(-3.5 * dt);

    // idle — breathing bob, slow sway, gaze lean, user spin
    grp.position.y = Math.sin(s * 1.6) * 0.045 * idle + this.hopY + 1.16 * (1 - Math.cos(this.flipX));
    grp.rotation.y = this.yaw + Math.sin(s * 0.7) * 0.18 * idle + this.gx * 0.22;
    grp.rotation.z = Math.sin(s * 1.1) * (this.skydiving ? 0.11 : 0.02) * idle - this.gx * 0.06;

    // gear pass — render gear alone into a side canvas so drawFur can
    // re-stamp it AFTER the strand pass (fur must not grow on hats)
    if (this.gearParts.length) {
      const hidden = (
        [
          this.torso,
          ...this.shellMeshes,
          this.faceMesh,
          this.eyeL,
          this.eyeR,
          this.dizzyL,
          this.dizzyR,
          this.flipL?.root,
          this.flipR?.root,
          this.footL,
          this.footR,
          this.shadowMesh,
        ] as (THREE.Object3D | undefined)[]
      ).filter((o): o is THREE.Object3D => !!o);
      const was = hidden.map((o) => o.visible);
      for (const o of hidden) o.visible = false;
      this.renderer.render(this.scene, this.camera);
      if (!this.gearCv) {
        this.gearCv = document.createElement('canvas');
        this.gearCv.width = this.W;
        this.gearCv.height = this.H;
        this.gearCtx = this.gearCv.getContext('2d')!;
      }
      this.gearCtx!.clearRect(0, 0, this.W, this.H);
      this.gearCtx!.drawImage(this.renderer.domElement, 0, 0);
      hidden.forEach((o, i) => (o.visible = was[i]));
    }

    this.renderer.render(this.scene, this.camera);
  }

  /** re-dress the bean — recolors the vinyl body, fur shells and face oval */
  setVariant(body: number, skin: number) {
    this.bodyMat?.color.set(body);
    this.skinMat?.color.set(skin);
    for (const m of this.shellMats) m.color.set(body);
    // the 2D fur overlay draws its strands in code — retint them relative
    // to the default coat so variants show through the fur too
    const br = (BODY >> 16) & 0xff,
      bg = (BODY >> 8) & 0xff,
      bb = BODY & 0xff;
    this.furTint = {
      r: ((body >> 16) & 0xff) / br,
      g: ((body >> 8) & 0xff) / bg,
      b: (body & 0xff) / bb,
    };
  }

  private furTint = { r: 1, g: 1, b: 1 };

  /** ¾-down camera for sprite baking — classic top-down-art angle: face
   *  reads, crown shows, feet ground the pose */
  bakeCam() {
    if (!this.camera) return;
    this.camera.position.set(0, 2.95, 4.5);
    this.camera.lookAt(0, 1.15, 0);
    this.camera.updateProjectionMatrix();
  }

  /** deterministic rig pose — sets every animated channel directly (no
   *  springs, no randomness) and renders immediately. Used by the sprite
   *  baker to capture run-cycle / idle / splat frames. */
  poseFor(kind: 'run' | 'idle' | 'splat', ph: number) {
    const g = this.group;
    if (!g || !this.renderer || !this.scene || !this.camera) return;
    const t = ph * Math.PI * 2;
    // reset every channel update() drives
    g.rotation.set(0, 0, 0);
    g.position.set(0, 0, 0);
    g.scale.set(1, 1, 1);
    if (this.footL) this.footL.rotation.set(0, -0.18, 0);
    if (this.footR) this.footR.rotation.set(0, 0.18, 0);
    if (this.flipL) {
      this.flipL.root.rotation.set(0, 0, -0.18);
      this.flipL.elbow.rotation.set(0, 0, 0);
    }
    if (this.flipR) {
      this.flipR.root.rotation.set(0, 0, 0.18);
      this.flipR.elbow.rotation.set(0, 0, 0);
    }
    const eyesFlat = kind === 'splat';
    if (this.eyeL) {
      this.eyeL.visible = !eyesFlat;
      this.eyeL.scale.y = 1;
      this.eyeL.position.set(-this.eyeXs, 1.58, this.eyeZs);
    }
    if (this.eyeR) {
      this.eyeR.visible = !eyesFlat;
      this.eyeR.scale.y = 1;
      this.eyeR.position.set(this.eyeXs, 1.58, this.eyeZs);
    }
    if (this.dizzyL) {
      this.dizzyL.visible = eyesFlat;
      this.dizzyL.rotation.z = 0.2;
    }
    if (this.dizzyR) {
      this.dizzyR.visible = eyesFlat;
      this.dizzyR.rotation.z = -0.2;
    }

    if (kind === 'run') {
      // stride cycle — alternating foot lifts, counter-swinging flippers,
      // bob + waddle roll + a breath of squash on each footfall
      const q = Math.abs(Math.sin(t)) * 0.09;
      g.scale.set(1 - q * 0.5, 1 + q, 1 - q * 0.45);
      g.position.y = Math.abs(Math.sin(t)) * 0.1;
      g.rotation.z = Math.sin(t) * 0.055;
      g.rotation.x = 0.14; // forward lean into the run
      if (this.footL) {
        this.footL.rotation.x = -Math.max(0, Math.sin(t)) * 0.85;
        this.footL.rotation.z = -Math.sin(t) * 0.14;
      }
      if (this.footR) {
        this.footR.rotation.x = -Math.max(0, Math.sin(t + Math.PI)) * 0.85;
        this.footR.rotation.z = Math.sin(t) * 0.14;
      }
      if (this.flipL) {
        this.flipL.root.rotation.z = -0.3 - Math.sin(t) * 0.32;
        this.flipL.elbow.rotation.z = -Math.sin(t - 0.6) * 0.28;
      }
      if (this.flipR) {
        this.flipR.root.rotation.z = 0.3 - Math.sin(t) * 0.32;
        this.flipR.elbow.rotation.z = Math.sin(t - 0.6) * 0.28;
      }
    } else if (kind === 'idle') {
      // breathing sway — same channels, a third of the energy
      const q = Math.sin(t) * 0.03;
      g.scale.set(1 - q * 0.5, 1 + q, 1 - q * 0.45);
      g.position.y = Math.sin(t) * 0.045;
      g.rotation.z = Math.sin(t) * 0.022;
      g.rotation.y = Math.sin(t * 0.6) * 0.14;
      if (this.flipL) this.flipL.root.rotation.z = -0.18 - Math.sin(t) * 0.09;
      if (this.flipR) this.flipR.root.rotation.z = 0.18 + Math.sin(t) * 0.09;
    } else {
      // splat — flat on the back (ph scales how flat: 1 = pancake, 0.5 = half up)
      const splat = 1 - ph * 0.6;
      g.rotation.x = -1.15 * splat;
      g.scale.z = 1 - splat * 0.2;
      g.scale.x = 1 + splat * 0.12;
      if (this.flipL) this.flipL.root.rotation.z = -0.9;
      if (this.flipR) this.flipR.root.rotation.z = 0.9;
    }

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
