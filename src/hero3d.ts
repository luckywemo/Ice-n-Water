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
  private flipL?: { root: THREE.Group; elbow: THREE.Group };
  private flipR?: { root: THREE.Group; elbow: THREE.Group };
  private footL?: THREE.Group;
  private footR?: THREE.Group;
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

    // feet — pivoted groups at the hip; each foot is a flat forward-
    // pointing shoe, toes angled slightly out
    const footG = (side: -1 | 1) => {
      const root = new THREE.Group();
      root.position.set(side * 0.27, 0.32, 0.04);
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
    this.torso.scale.set(1, 1, 0.95);

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
            pos.getX(v) + gn.getX(v) * 0.04 * t,
            pos.getY(v) + gn.getY(v) * 0.04 * t,
            pos.getZ(v) + gn.getZ(v) * 0.04 * t,
          );
        const m = new THREE.Mesh(
          g,
          new THREE.MeshStandardMaterial({
            color: BODY,
            roughness: 1,
            alphaMap: furTex,
            alphaTest: 0.08 + t * 0.6,
            side: THREE.FrontSide,
          }),
        );
        m.position.copy(this.torso.position);
        m.scale.copy(this.torso.scale);
        grp.add(m);
      }
    }

    // penguin flippers — detached two-segment blades: shoulder pivot +
    // elbow joint so the tip bends. Held just off the body surface.
    const flipper = (side: -1 | 1) => {
      const root = new THREE.Group();
      root.position.set(side * 0.65, 1.42, 0.0);
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
    mesh(new THREE.SphereGeometry(0.46, 30, 24), skin, 0, 1.58, 0.55).scale.set(0.86, 1.05, 0.38);
    // eyes — two tall thin dark ovals, close-set
    const eye = (x: number) => {
      const m = mesh(new THREE.SphereGeometry(0.07, 14, 12), dark, x, 1.58, 0.72);
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
    // framed with hop headroom — crown + ~0.4 hop lift stays in view
    this.camera.position.set(0, 1.3, 5.0);
    this.camera.lookAt(0, 1.3, 0);

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

  /** Draw the fur coat over the composited bean frame.
   *  Call AFTER the WebGL frame is drawn into `ctx`.
   *  `px,py` = pointer in canvas pixels, negative = no petting. */
  drawFur(ctx: CanvasRenderingContext2D, px: number, py: number) {
    const W = 440,
      H = 540,
      CELLS = 8,
      GW = Math.ceil(W / CELLS),
      R = 52,
      R2 = R * R;
    const d = ctx.getImageData(0, 0, W, H).data;
    const a = (x: number, y: number) =>
      x < 0 || y < 0 || x >= W || y >= H ? 0 : d[(y * W + x) * 4 + 3];
    // body test — saturated mid-tone pixels only; pale face, black eyes
    // and the grey contact shadow are excluded so fur never covers them
    const body = (x: number, y: number) => {
      if (a(x, y) < 140) return false;
      const i = (y * W + x) * 4;
      const r = d[i] / 255,
        g = d[i + 1] / 255,
        b = d[i + 2] / 255;
      const mx = Math.max(r, g, b),
        mn = Math.min(r, g, b),
        lum = (mx + mn) / 2;
      const sat = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * lum - 1) || 1);
      return sat > 0.28 && lum > 0.07 && lum < 0.62;
    };
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
    const uimg = uc.createImageData(W, H);
    const ud = uimg.data;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!body(x, y)) continue;
        const o = (y * W + x) * 4,
          v = y / H;
        // undercoat in the fur's own brown — mild vertical darkening only
        ud[o] = 112 - v * 48;
        ud[o + 1] = 62 - v * 27;
        ud[o + 2] = 30 - v * 13;
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
        dark ? 'rgba(28,12,4,0.16)' : 'rgba(255,214,160,0.10)',
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
    const cowX = W * 0.5,
      cowY = H * 0.3,
      down = Math.PI / 2;
    const restAngle = (x: number, y: number) => {
      const fromCow = Math.atan2(y - cowY, x - cowX);
      const clump = (Math.sin(x * 0.04) + Math.cos(y * 0.035)) * 0.3;
      let an = fromCow + (((down - fromCow + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 0.5;
      an += clump * 0.35 + (nz(x, y, 1) - 0.5) * 0.55;
      return an;
    };
    type Strand = { x: number; y: number; a: number; l: number; c: number; s: number };
    const under: Strand[] = [],
      mid: Strand[] = [],
      hi: Strand[] = [],
      fringe: Strand[] = [];

    // interior coat — stride-3 sample of body pixels, layered like theirs
    for (let y = 4; y < H - 4; y += 3)
      for (let x = 4; x < W - 4; x += 3) {
        if (!body(x, y)) continue;
        const len = 9 + nz(x, y, 4) * 8;
        const roll = nz(x, y, 6);
        const s: Strand = {
          x,
          y,
          a: restAngle(x, y),
          l: len,
          c: (nz(x, y, 5) - 0.5) * len * 0.7,
          s: nz(x, y, 8),
        };
        (roll < 0.4 ? under : roll < 0.92 ? mid : hi).push(s);
      }
    // fringe — perimeter strands pointing outward
    for (let y = 5; y < H - 5; y += 5)
      for (let x = 5; x < W - 5; x += 5) {
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
        an += (nz(x, y, 3) - 0.5) * 0.5;
        const len = 9 + nz(x, y, 4) * 8;
        fringe.push({ x, y, a: an, l: len, c: (nz(x, y, 5) - 0.5) * len * 0.7, s: nz(x, y, 8) });
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
      const sh = 52 + s.s * 26;
      ctx.strokeStyle = `rgba(${sh | 0},${(sh * 0.55) | 0},${(sh * 0.28) | 0},0.6)`;
      ctx.lineWidth = 1.6 + s.s * 1.0;
      stroke(s, false);
    }
    // mid coat + lit tips on the outer half
    for (const s of mid) {
      const sh = 95 + s.s * 30;
      ctx.strokeStyle = `rgba(${sh | 0},${(sh * 0.55) | 0},${(sh * 0.3) | 0},0.85)`;
      ctx.lineWidth = 0.9 + s.s * 0.6;
      stroke(s, false);
    }
    for (const s of mid) {
      const sh = 140 + s.s * 35;
      ctx.strokeStyle = `rgba(${sh | 0},${(sh * 0.6) | 0},${(sh * 0.34) | 0},0.5)`;
      ctx.lineWidth = (0.9 + s.s * 0.6) * 0.8;
      stroke(s, true);
    }
    // sparse highlights
    for (const s of hi) {
      const sh = 165 + s.s * 30;
      ctx.strokeStyle = `rgba(${sh | 0},${(sh * 0.62) | 0},${(sh * 0.36) | 0},0.55)`;
      ctx.lineWidth = 0.7 + s.s * 0.4;
      stroke(s, false);
    }
    // fringe last so it pokes past the silhouette
    for (const s of fringe) {
      const sh = 100 + s.s * 40;
      ctx.strokeStyle = `rgba(${sh | 0},${(sh * 0.56) | 0},${(sh * 0.3) | 0},0.8)`;
      ctx.lineWidth = 1.1;
      stroke(s, false);
    }
    for (const s of fringe) {
      const sh = 150 + s.s * 30;
      ctx.strokeStyle = `rgba(${sh | 0},${(sh * 0.6) | 0},${(sh * 0.34) | 0},0.45)`;
      ctx.lineWidth = 0.9;
      stroke(s, true);
    }
    ctx.restore();
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
